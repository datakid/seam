const WIN = 32768;
const PAD = 16;
const DEFAULT_MAX = 536870912;
const DEFAULT_BUDGET = 3000;
const DEFAULT_SEARCH = 262144;
const PROBE_LIMIT = 16 * 1024 * 1024;
const ZERO_RUN = 64;
const ERR_EOF = 1;
const ERR_BAD = 2;
const ERR_LIMIT = 3;
const ERR_TIME = 4;
const ERR_PAUSE = 5;
const UNKNOWN = 0xffff;
const CONTINUE_SPAN = 64;
const UNTRUSTED_DEFAULT = 256;
const UNTRUSTED_MARGIN = 32;
const MERGE_FIRST = 256;
const MERGE_MAX = 65536;
const MAX_GROUPS = 6;
const CHAIN_MIN = 2048;
const MAX_HITS = 4;

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const EMPTY_TABLE = { t: new Int32Array(1), bits: 0 };
const NO_RUNS = { start: [], end: [], n: 0 };
const codeLengths = new Uint8Array(320);
const clLengths = new Uint8Array(19);
const lengthCounts = new Uint16Array(16);
const nextCodes = new Uint16Array(16);

let fixedTables = null;
let headerEof = false;

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function word(src, p) {
  const i = p >>> 3;
  return (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> (p & 7);
}

function buildTable(lens, from, n, strict) {
  lengthCounts.fill(0);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const l = lens[from + i];
    lengthCounts[l]++;
    if (l > max) max = l;
  }
  lengthCounts[0] = 0;
  if (max === 0) return EMPTY_TABLE;
  let left = 1;
  for (let l = 1; l <= max; l++) {
    left = (left << 1) - lengthCounts[l];
    if (left < 0) return null;
  }
  if (left > 0 && (strict || max !== 1)) return null;
  let code = 0;
  for (let l = 1; l <= max; l++) {
    code = (code + lengthCounts[l - 1]) << 1;
    nextCodes[l] = code;
  }
  const size = 1 << max;
  const t = new Int32Array(size);
  for (let s = 0; s < n; s++) {
    const l = lens[from + s];
    if (l === 0) continue;
    let c = nextCodes[l]++;
    let r = 0;
    for (let b = 0; b < l; b++) {
      r = (r << 1) | (c & 1);
      c >>= 1;
    }
    const entry = (l << 16) | s;
    for (let k = r; k < size; k += 1 << l) t[k] = entry;
  }
  return { t, bits: max };
}

function fixed() {
  if (fixedTables) return fixedTables;
  const lit = new Uint8Array(288);
  lit.fill(8, 0, 144);
  lit.fill(9, 144, 256);
  lit.fill(7, 256, 280);
  lit.fill(8, 280, 288);
  const dist = new Uint8Array(32).fill(5);
  fixedTables = { lit: buildTable(lit, 0, 288, true), dist: buildTable(dist, 0, 32, true) };
  return fixedTables;
}

function findZeroRuns(src, srcLen) {
  const start = [];
  const end = [];
  let i = 0;
  while (i < srcLen) {
    if (src[i] !== 0) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < srcLen && src[j] === 0) j++;
    if (j - i >= ZERO_RUN) {
      start.push(i);
      end.push(j);
    }
    i = j;
  }
  return { start, end, n: start.length };
}

function refreshBarrier(st, bit) {
  const runs = st.runs;
  let lo = 0;
  let hi = runs.n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (runs.end[mid] * 8 <= bit) lo = mid + 1;
    else hi = mid;
  }
  st.barrier = lo < runs.n ? Math.max(runs.start[lo] * 8, bit) : Infinity;
  st.stop = Math.min(st.endBit, st.barrier);
}

function createState(src, srcLen, runs, tail, room, initial) {
  const base = tail ? WIN : 0;
  const size = Math.max(base + 1024, Math.min(base + room + 258, initial + base));
  const ref = tail ? new Uint16Array(size) : null;
  if (tail) for (let i = 0; i < WIN; i++) ref[i] = i + 1;
  return { src, srcLen, runs, endBit: srcLen * 8, barrier: Infinity, stop: srcLen * 8, tail, base, out: new Uint8Array(size), ref, op: base, pos: 0, limit: base + room, pause: Infinity, pauseBit: Infinity, err: 0, errBit: 0, byBarrier: false, tables: null, blockFinal: false, final: false };
}

function grow(st, need) {
  const size = Math.min(st.limit + 258, Math.max(st.out.length * 2, need));
  const out = new Uint8Array(size);
  out.set(st.out.subarray(0, st.op));
  st.out = out;
  if (st.ref) {
    const ref = new Uint16Array(size);
    ref.set(st.ref.subarray(0, st.op));
    st.ref = ref;
  }
}

function fail(st, code, bit, barrier) {
  st.err = code;
  st.errBit = bit;
  st.byBarrier = barrier === true;
}

function inflateBlock(st, lit, dist) {
  const src = st.src;
  const endBit = st.endBit;
  const stop = st.stop;
  const litT = lit.t;
  const litMask = (1 << lit.bits) - 1;
  const distT = dist.t;
  const distMask = (1 << dist.bits) - 1;
  const tail = st.tail;
  const limit = st.limit;
  const pause = st.pause;
  const pauseBit = st.pauseBit;
  let out = st.out;
  let ref = st.ref;
  let op = st.op;
  let pos = st.pos;
  for (;;) {
    if (op >= limit || op >= pause || pos >= pauseBit) {
      st.op = op;
      st.pos = pos;
      fail(st, op >= limit ? ERR_LIMIT : ERR_PAUSE, pos);
      return;
    }
    if (op + 258 > out.length) {
      st.op = op;
      grow(st, op + 258);
      out = st.out;
      ref = st.ref;
    }
    const e = litT[word(src, pos) & litMask];
    if (e === 0) {
      st.op = op;
      st.pos = pos;
      fail(st, pos + lit.bits > endBit ? ERR_EOF : ERR_BAD, pos);
      return;
    }
    let np = pos + (e >>> 16);
    if (np > stop) {
      st.op = op;
      st.pos = pos;
      fail(st, stop < endBit ? ERR_BAD : ERR_EOF, pos, stop < endBit);
      return;
    }
    const sym = e & 0xffff;
    if (sym < 256) {
      out[op++] = sym;
      pos = np;
      continue;
    }
    if (sym === 256) {
      st.op = op;
      st.pos = np;
      return;
    }
    const li = sym - 257;
    if (li >= 29) {
      st.op = op;
      st.pos = pos;
      fail(st, ERR_BAD, pos);
      return;
    }
    let len = LEN_BASE[li];
    const leb = LEN_EXTRA[li];
    if (leb !== 0) {
      len += word(src, np) & ((1 << leb) - 1);
      np += leb;
    }
    const de = distT[word(src, np) & distMask];
    if (de === 0 || (de & 0xffff) >= 30) {
      st.op = op;
      st.pos = pos;
      fail(st, np + dist.bits > endBit ? ERR_EOF : ERR_BAD, pos);
      return;
    }
    const ds = de & 0xffff;
    np += de >>> 16;
    let d = DIST_BASE[ds];
    const deb = DIST_EXTRA[ds];
    if (deb !== 0) {
      d += word(src, np) & ((1 << deb) - 1);
      np += deb;
    }
    if (np > stop) {
      st.op = op;
      st.pos = pos;
      fail(st, stop < endBit ? ERR_BAD : ERR_EOF, pos, stop < endBit);
      return;
    }
    if (!tail && d > op) {
      st.op = op;
      st.pos = pos;
      fail(st, ERR_BAD, pos);
      return;
    }
    let truncated = false;
    if (op + len > limit) {
      len = limit - op;
      truncated = true;
    }
    let from = op - d;
    if (tail) {
      for (let k = 0; k < len; k++) {
        out[op] = out[from];
        ref[op] = ref[from];
        op++;
        from++;
      }
    } else {
      for (let k = 0; k < len; k++) out[op++] = out[from++];
    }
    if (truncated) {
      st.op = op;
      st.pos = np;
      fail(st, ERR_LIMIT, np);
      return;
    }
    pos = np;
  }
}

function readDynamic(st) {
  const src = st.src;
  let pos = st.pos;
  headerEof = false;
  const w = word(src, pos);
  const hlit = (w & 31) + 257;
  const hdist = ((w >>> 5) & 31) + 1;
  const hclen = ((w >>> 10) & 15) + 4;
  pos += 14;
  if (hlit > 286 || hdist > 30) return null;
  clLengths.fill(0);
  for (let i = 0; i < hclen; i++) {
    clLengths[CL_ORDER[i]] = word(src, pos) & 7;
    pos += 3;
  }
  if (pos > st.stop) {
    headerEof = st.stop >= st.endBit;
    return null;
  }
  const cl = buildTable(clLengths, 0, 19, true);
  if (cl === null || cl.bits === 0) return null;
  const clT = cl.t;
  const clMask = (1 << cl.bits) - 1;
  const total = hlit + hdist;
  let i = 0;
  while (i < total) {
    const e = clT[word(src, pos) & clMask];
    if (e === 0) return null;
    pos += e >>> 16;
    const sym = e & 0xffff;
    if (sym < 16) {
      codeLengths[i++] = sym;
    } else {
      const x = word(src, pos);
      let rep;
      let val = 0;
      if (sym === 16) {
        if (i === 0) return null;
        val = codeLengths[i - 1];
        rep = 3 + (x & 3);
        pos += 2;
      } else if (sym === 17) {
        rep = 3 + (x & 7);
        pos += 3;
      } else {
        rep = 11 + (x & 127);
        pos += 7;
      }
      if (i + rep > total) return null;
      while (rep-- > 0) codeLengths[i++] = val;
    }
    if (pos > st.stop) {
      headerEof = st.stop >= st.endBit;
      return null;
    }
  }
  if (codeLengths[256] === 0) return null;
  const lit = buildTable(codeLengths, 0, hlit, false);
  if (lit === null) return null;
  const dist = buildTable(codeLengths, hlit, hdist, false);
  if (dist === null) return null;
  st.pos = pos;
  return { lit, dist };
}

function storedBlock(st, start, finalBit) {
  const src = st.src;
  const p = (st.pos + 7) >>> 3;
  if (p + 4 > st.srcLen) {
    fail(st, ERR_EOF, start);
    return;
  }
  const len = src[p] | (src[p + 1] << 8);
  const nlen = src[p + 2] | (src[p + 3] << 8);
  if ((len ^ nlen) !== 0xffff) {
    fail(st, ERR_BAD, start);
    return;
  }
  const q = p + 4;
  const avail = Math.min(len, st.srcLen - q);
  const take = Math.min(avail, st.limit - st.op);
  if (st.op + take + 258 > st.out.length) grow(st, st.op + take + 258);
  st.out.set(src.subarray(q, q + take), st.op);
  st.op += take;
  st.pos = (q + take) * 8;
  if (take < len) {
    fail(st, take < avail ? ERR_LIMIT : ERR_EOF, st.pos);
    return;
  }
  st.final = finalBit;
}

function decodeBlock(st) {
  const start = st.pos;
  st.final = false;
  st.tables = null;
  refreshBarrier(st, start);
  if (start + 3 > st.stop) {
    fail(st, st.stop < st.endBit ? ERR_BAD : ERR_EOF, start);
    return;
  }
  const w = word(st.src, start);
  const finalBit = (w & 1) === 1;
  const type = (w >>> 1) & 3;
  st.pos = start + 3;
  if (type === 0) {
    storedBlock(st, start, finalBit);
    return;
  }
  let tables;
  if (type === 1) {
    tables = fixed();
  } else if (type === 2) {
    tables = readDynamic(st);
    if (tables === null) {
      st.pos = start;
      fail(st, headerEof ? ERR_EOF : ERR_BAD, start);
      return;
    }
  } else {
    st.pos = start;
    fail(st, ERR_BAD, start);
    return;
  }
  st.tables = tables;
  st.blockFinal = finalBit;
  inflateBlock(st, tables.lit, tables.dist);
  if (st.err === 0) st.final = finalBit;
}

function runBlocks(st, deadline) {
  for (;;) {
    decodeBlock(st);
    if (st.err !== 0 || st.final) return;
    if (deadline !== 0 && now() > deadline) {
      fail(st, ERR_TIME, st.pos);
      return;
    }
  }
}

function plausibleText(st, from, to) {
  const out = st.out;
  const ref = st.ref;
  let known = 0;
  let bad = 0;
  for (let i = from; i < to; i++) {
    if (ref[i] !== 0) continue;
    const b = out[i];
    known++;
    if (b >= 32 && b < 127) continue;
    if (b === 9 || b === 10 || b === 13) continue;
    let need = 0;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) need = 2;
    else if (b >= 0xf0 && b <= 0xf4) need = 3;
    else {
      bad++;
      continue;
    }
    let ok = i + need < to;
    for (let k = 1; ok && k <= need; k++) {
      const c = out[i + k];
      if (ref[i + k] !== 0 || (c & 0xc0) !== 0x80) ok = false;
    }
    if (!ok) bad++;
    else i += need;
  }
  return known >= 2048 && bad * 20 <= known;
}

function resetProbe(st) {
  if (st.op > st.base) st.ref.fill(0, st.base, st.op);
  st.op = st.base;
  st.err = 0;
  st.pauseBit = Infinity;
  st.final = false;
}

function probeBlock(st, s, type) {
  st.pos = s;
  decodeBlock(st);
  let accepted = st.err === 0;
  if (accepted && type === 1) accepted = plausibleText(st, st.base, st.op);
  if (accepted && !st.final) {
    resetProbe(st);
    decodeBlock(st);
    accepted = st.err === 0;
  }
  resetProbe(st);
  return accepted;
}

function probeStored(st, p) {
  const src = st.src;
  if (p + 4 > st.srcLen) return false;
  const len = src[p] | (src[p + 1] << 8);
  const nlen = src[p + 2] | (src[p + 3] << 8);
  if (len === 0 || (len ^ nlen) !== 0xffff) return false;
  const end = p + 4 + len;
  if (end === st.srcLen) return true;
  if (end > st.srcLen) return false;
  st.pos = end * 8;
  decodeBlock(st);
  const accepted = st.err === 0;
  resetProbe(st);
  return accepted;
}

function search(probe, from, to, deadline) {
  const src = probe.src;
  for (let s = from; s < to; s++) {
    if ((s & 8191) === 0 && now() > deadline) return -1;
    const type = (word(src, s) >>> 1) & 3;
    if ((type === 1 || type === 2) && probeBlock(probe, s, type)) return s;
    if (((s + 3) & 7) === 0 && probeStored(probe, (s + 3) >>> 3)) return s;
  }
  return -1;
}

function addHole(holes, start, end) {
  const last = holes.length - 1;
  if (last >= 0 && holes[last][1] >= start) {
    if (end > holes[last][1]) holes[last][1] = end;
    return;
  }
  holes.push([start, end]);
}

function assemble(segments, gapLengths, expected, resolve) {
  let total = 0;
  for (let i = 0; i < segments.length; i++) {
    total += segments[i].op - segments[i].base;
    if (i > 0) total += gapLengths[i - 1];
  }
  const data = new Uint8Array(total);
  const holes = [];
  const head = segments[0];
  let at = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i > 0) {
      addHole(holes, at, at + gapLengths[i - 1]);
      at += gapLengths[i - 1];
    }
    const length = seg.op - seg.base;
    data.set(seg.out.subarray(seg.base, seg.op), at);
    if (seg.ref) {
      let runStart = -1;
      for (let k = seg.base; k < seg.op; k++) {
        const v = seg.ref[k];
        let unknown = v !== 0;
        if (unknown && resolve && i === 1 && v !== UNKNOWN) {
          const c = expected - seg.op + (v - 1);
          if (c >= 0 && c < head.op) {
            data[at + k - seg.base] = head.out[c];
            unknown = false;
          }
        }
        if (unknown) {
          if (runStart < 0) runStart = k;
        } else if (runStart >= 0) {
          addHole(holes, at + (runStart - seg.base), at + (k - seg.base));
          runStart = -1;
        }
      }
      if (runStart >= 0) addHole(holes, at + (runStart - seg.base), at + length);
    }
    at += length;
  }
  return { data, holes };
}

function runEndBit(runs, bit) {
  let lo = 0;
  let hi = runs.n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (runs.end[mid] * 8 <= bit) lo = mid + 1;
    else hi = mid;
  }
  return lo < runs.n ? runs.end[lo] * 8 : -1;
}

function syncBoundary(probe, s, tables, bit) {
  probe.pos = s;
  probe.err = 0;
  probe.op = probe.base;
  refreshBarrier(probe, s);
  probe.pauseBit = bit;
  inflateBlock(probe, tables.lit, tables.dist);
  const at = probe.err === ERR_PAUSE ? probe.pos : -1;
  resetProbe(probe);
  return at;
}

function mergeBit(probe, group, tables, from) {
  if (group.length === 1) return -1;
  for (let span = MERGE_FIRST; span <= MERGE_MAX; span *= 2) {
    const target = from + CONTINUE_SPAN + span;
    let at = -2;
    let same = true;
    for (const s of group) {
      const here = syncBoundary(probe, s, tables, target);
      if (here < 0) return Infinity;
      if (at === -2) at = here;
      else if (here !== at) same = false;
    }
    if (same) return at;
  }
  return Infinity;
}

function trialContinue(probe, s, tables, blockFinal) {
  probe.pos = s;
  probe.err = 0;
  probe.op = probe.base;
  refreshBarrier(probe, s);
  inflateBlock(probe, tables.lit, tables.dist);
  if (probe.err !== 0) {
    resetProbe(probe);
    return null;
  }
  const end = probe.pos;
  let ok = true;
  if (!blockFinal) {
    decodeBlock(probe);
    ok = probe.err === 0;
  }
  resetProbe(probe);
  return ok ? end : -1;
}

function chainReaches(src, srcLen, runs, bit, room, deadline) {
  const st = createState(src, srcLen, runs, true, room, Math.max(65536, (srcLen - (bit >>> 3)) * 4));
  st.pos = bit;
  st.startBit = bit;
  runBlocks(st, deadline);
  if (st.final && st.err === 0) return true;
  return st.byBarrier === true && st.op - st.base >= CHAIN_MIN;
}

function earliestBlock(probe, src, srcLen, runs, from, to, room, deadline) {
  let at = from;
  for (let hits = 0; hits < MAX_HITS && at < to; hits++) {
    const found = search(probe, at, to, deadline);
    if (found < 0) return -1;
    if (chainReaches(src, srcLen, runs, found, room, deadline)) return found;
    at = found + 1;
  }
  return -1;
}

function continueBlock(prev, probe, runs, src, srcLen, room, deadline) {
  const runEnd = runEndBit(runs, prev.errBit);
  if (runEnd < 0) return null;
  const tables = prev.tables;
  const blockFinal = prev.blockFinal;
  const byEnd = new Map();
  for (let k = 0; k < CONTINUE_SPAN; k++) {
    const s = runEnd + k;
    if (s + 3 > prev.endBit) break;
    const end = trialContinue(probe, s, tables, blockFinal);
    if (end < 0) continue;
    const list = byEnd.get(end);
    if (list === undefined) byEnd.set(end, [s]);
    else list.push(s);
    if (now() > deadline) return null;
  }
  if (byEnd.size === 0) return null;
  const ranked = Array.from(byEnd).sort((a, b) => b[1].length - a[1].length).slice(0, MAX_GROUPS);
  let reach = 0;
  for (const [end] of ranked) reach = Math.max(reach, end);
  const earlier = earliestBlock(probe, src, srcLen, runs, runEnd, reach, room, deadline);
  let group = null;
  for (const [end, list] of ranked) {
    if (now() > deadline) return null;
    if (earlier >= 0 && earlier < end) continue;
    if (blockFinal || chainReaches(src, srcLen, runs, end, room, deadline)) {
      group = list;
      break;
    }
  }
  if (group === null) return null;
  const chosen = group[0];
  const merged = mergeBit(probe, group, tables, runEnd);
  const next = createState(src, srcLen, runs, true, room, Math.max(65536, (srcLen - (chosen >>> 3)) * 4));
  next.pos = chosen;
  next.startBit = chosen;
  refreshBarrier(next, chosen);
  if (merged === Infinity) {
    inflateBlock(next, tables.lit, tables.dist);
  } else if (merged >= 0) {
    next.pauseBit = merged;
    inflateBlock(next, tables.lit, tables.dist);
    if (next.err === ERR_PAUSE) {
      next.err = 0;
      next.pauseBit = Infinity;
      next.pause = next.op + UNTRUSTED_MARGIN;
      inflateBlock(next, tables.lit, tables.dist);
    }
  } else {
    next.pause = next.base + UNTRUSTED_DEFAULT;
    inflateBlock(next, tables.lit, tables.dist);
  }
  const paused = next.err === ERR_PAUSE;
  if (paused || next.err === 0) next.ref.fill(UNKNOWN, next.base, next.op);
  if (paused) {
    next.err = 0;
    next.pause = Infinity;
    next.pauseBit = Infinity;
    inflateBlock(next, tables.lit, tables.dist);
  }
  if (next.err === 0) {
    next.final = blockFinal;
    if (!next.final) runBlocks(next, deadline);
  }
  return next;
}

export function inflateTolerant(bytes, options) {
  const opts = options || {};
  const maxOut = opts.maxOut > 0 ? Math.floor(opts.maxOut) : DEFAULT_MAX;
  const budgetMs = opts.budgetMs > 0 ? opts.budgetMs : DEFAULT_BUDGET;
  const searchBits = (opts.searchBytes > 0 ? opts.searchBytes : DEFAULT_SEARCH) * 8;
  let expected = Number.isFinite(opts.expectedSize) && opts.expectedSize >= 0 ? Math.floor(opts.expectedSize) : null;
  if (expected !== null && expected > maxOut) expected = null;
  const srcLen = bytes.length;
  const src = new Uint8Array(srcLen + PAD);
  src.set(bytes);
  const deadline = now() + budgetMs;
  const runs = opts.zeroRuns === true ? findZeroRuns(src, srcLen) : NO_RUNS;

  const head = createState(src, srcLen, runs, false, maxOut, Math.max(65536, srcLen * 4));
  runBlocks(head, 0);
  const segments = [head];
  const gaps = [];
  let cur = head;
  let total = head.op;
  let probe = null;
  while (!cur.final && cur.err === ERR_BAD && total < maxOut) {
    if (probe === null) probe = createState(src, srcLen, runs, true, PROBE_LIMIT, 1 << 18);
    let next = null;
    if (cur.byBarrier && cur.tables !== null) next = continueBlock(cur, probe, runs, src, srcLen, maxOut - total, deadline);
    if (next === null) {
      const from = cur.errBit + 1;
      const to = Math.min(cur.endBit - 2, from + searchBits);
      const found = from < to ? search(probe, from, to, deadline) : -1;
      if (found < 0) {
        gaps.push([cur.errBit, cur.endBit]);
        break;
      }
      next = createState(src, srcLen, runs, true, maxOut - total, Math.max(65536, (srcLen - (found >>> 3)) * 4));
      next.pos = found;
      next.startBit = found;
      runBlocks(next, deadline);
    }
    gaps.push([cur.errBit, next.startBit]);
    segments.push(next);
    total += next.op - WIN;
    cur = next;
  }

  const gapLengths = new Array(segments.length - 1).fill(0);
  let aligned = true;
  if (segments.length > 1) {
    aligned = false;
    if (expected !== null && cur.final && segments.length === 2) {
      const unknown = expected - (head.op - head.base) - (cur.op - cur.base);
      if (unknown >= 0) {
        gapLengths[0] = unknown;
        aligned = true;
      }
    }
  }
  const { data, holes } = assemble(segments, gapLengths, expected, aligned && segments.length === 2 && expected !== null);
  const complete = segments.length === 1 && head.final && head.err === 0;
  return { data, holes, gaps, complete, aligned, consumed: complete ? (head.pos + 7) >>> 3 : -1 };
}
