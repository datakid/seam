import { crc32 } from './crc32.js';
import { crcShift, crcShiftOne } from './crc-math.js';
import { inflateProbe } from './inflate-tolerant.js';
import { findEocdPosition } from './zip-read.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_DESCRIPTOR = 0x08074b50;
const CR = 0x0d;
const LF = 0x0a;
const STORED_PAIR_LIMIT = 1500;
const STORED_TRIPLE_LIMIT = 3000;
const STORED_DEEP_LIMIT = 8;
const DEFLATE_WINDOWS = [512, 4096, 32768, 1 << 30];
const DEFLATE_BRANCH = 3;
const DEFLATE_PROBES = 600;
const DEFLATE_MS = 4000;
const TOTAL_MS = 10000;
const DEFLATE_EXHAUSTIVE = 40000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function u16(b, i) {
  return b[i] | (b[i + 1] << 8);
}

function u32(b, i) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

function u32be(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function sameBytes(a, aAt, b, bAt, length) {
  for (let i = 0; i < length; i++) if (a[aAt + i] !== b[bAt + i]) return false;
  return true;
}

function readCentral(bytes) {
  const eocd = findEocdPosition(bytes);
  if (eocd === -1 || eocd + 22 > bytes.length) return null;
  const count = u16(bytes, eocd + 10);
  const size = u32(bytes, eocd + 12);
  const offset = u32(bytes, eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff || count === 0) return null;
  const start = eocd - size;
  if (start < 0 || u32(bytes, start) !== SIG_CENTRAL) return null;
  const entries = [];
  let at = start;
  while (at + 46 <= eocd && u32(bytes, at) === SIG_CENTRAL) {
    const nameLength = u16(bytes, at + 28);
    const entry = {
      flags: u16(bytes, at + 8),
      method: u16(bytes, at + 10),
      crc: u32(bytes, at + 16),
      csize: u32(bytes, at + 20),
      usize: u32(bytes, at + 24),
      lho: u32(bytes, at + 42),
      nameAt: at + 46,
      nameLength
    };
    if (entry.csize === 0xffffffff || entry.usize === 0xffffffff || entry.lho === 0xffffffff) return null;
    entries.push(entry);
    at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
  }
  if (entries.length !== count) return null;
  entries.sort((a, b) => a.lho - b.lho);
  return { entries, start, offset };
}

function localSignatures(bytes, end) {
  const found = [];
  for (let i = 0; i + 4 <= end; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) found.push(i);
  }
  return found;
}

function descriptorLength(bytes, next) {
  if (next >= 16 && u32(bytes, next - 16) === SIG_DESCRIPTOR) return 16;
  return 12;
}

export function readLayout(bytes) {
  const central = readCentral(bytes);
  if (!central) return null;
  const { entries } = central;
  const sigs = localSignatures(bytes, central.start);
  const layout = [];
  let at = entries[0].lho;
  let lost = 0;
  for (let k = 0; k < entries.length; k++) {
    const entry = entries[k];
    if (at + 30 > bytes.length || u32(bytes, at) !== SIG_LOCAL) return null;
    if (u16(bytes, at + 26) !== entry.nameLength || !sameBytes(bytes, at + 30, bytes, entry.nameAt, entry.nameLength)) return null;
    const dataAt = at + 30 + entry.nameLength + u16(bytes, at + 28);
    let next = -1;
    if (k + 1 < entries.length) {
      const following = entries[k + 1];
      for (const sig of sigs) {
        if (sig < dataAt) continue;
        if (u16(bytes, sig + 26) !== following.nameLength || !sameBytes(bytes, sig + 30, bytes, following.nameAt, following.nameLength)) continue;
        const gap = (sig - dataAt) - (entry.flags & 8 ? descriptorLength(bytes, sig) : 0);
        if (entry.csize - gap < 0 || entry.csize - gap > entry.csize) continue;
        next = sig;
        break;
      }
    } else {
      next = central.start;
    }
    if (next === -1) return null;
    const descriptor = entry.flags & 8 ? descriptorLength(bytes, next) : 0;
    const dataLength = next - dataAt - descriptor;
    const missing = entry.csize - dataLength;
    if (dataLength < 0 || missing < 0 || missing > entry.csize) return null;
    layout.push({ entry, dataAt, dataLength, missing });
    lost += missing;
    at = next;
  }
  if (central.offset - central.start !== lost) return null;
  return layout;
}

function insertCarriageReturns(data, positions) {
  const out = new Uint8Array(data.length + positions.length);
  let from = 0;
  let at = 0;
  for (const p of positions) {
    out.set(data.subarray(from, p), at);
    at += p - from;
    out[at++] = CR;
    from = p;
  }
  out.set(data.subarray(from), at);
  return out;
}

function lineFeeds(data) {
  const found = [];
  for (let i = 0; i < data.length; i++) if (data[i] === LF) found.push(i);
  return found;
}

export function pngIntact(bytes) {
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = u32be(bytes, at);
    if (at + 12 + length > bytes.length) return false;
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== u32be(bytes, at + 8 + length)) return false;
    const ends = bytes[at + 4] === 0x49 && bytes[at + 5] === 0x45 && bytes[at + 6] === 0x4e && bytes[at + 7] === 0x44;
    at += 12 + length;
    if (ends) return true;
  }
  return false;
}

function isPng(data) {
  return data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
}

function deltas(data, positions) {
  const n = data.length;
  const carriage = crc32(Uint8Array.of(CR));
  const out = new Uint32Array(positions.length);
  let c = 0;
  let from = 0;
  for (let i = 0; i < positions.length; i++) {
    const q = positions[i];
    c = crc32(data.subarray(from, q), c);
    from = q;
    const u = crcShift(c, n - q);
    out[i] = (crcShiftOne(u) ^ u ^ crcShift(carriage, n - q)) >>> 0;
  }
  return out;
}

function shifted(values, times) {
  const out = new Uint32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let v = values[i];
    for (let t = 0; t < times; t++) v = crcShiftOne(v);
    out[i] = v;
  }
  return out;
}

function lookup(map, key) {
  return map.get(key >>> 0) || null;
}

function add(map, key, value) {
  const k = key >>> 0;
  const list = map.get(k);
  if (list) list.push(value);
  else map.set(k, [value]);
}

function candidateSets(d, r, target) {
  const m = d.length;
  const found = [];
  if (r === 1) {
    for (let i = 0; i < m; i++) if (d[i] === target) found.push([i]);
    return found;
  }
  if (r === 2) {
    const s1 = shifted(d, 1);
    const map = new Map();
    for (let i = 0; i < m; i++) add(map, s1[i], i);
    for (let j = 0; j < m; j++) for (const i of lookup(map, target ^ d[j]) || []) if (i < j) found.push([i, j]);
    return found;
  }
  if (r === 3) {
    const s2 = shifted(d, 2);
    const s1 = shifted(d, 1);
    const map = new Map();
    for (let i = 0; i < m; i++) add(map, s2[i], i);
    for (let j = 0; j < m; j++) {
      for (let k = j + 1; k < m; k++) {
        for (const i of lookup(map, target ^ s1[j] ^ d[k]) || []) if (i < j) found.push([i, j, k]);
      }
    }
    return found;
  }
  const s3 = shifted(d, 3);
  const s2 = shifted(d, 2);
  const s1 = shifted(d, 1);
  const map = new Map();
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) add(map, s3[i] ^ s2[j], i * m + j);
  for (let k = 0; k < m; k++) {
    for (let l = k + 1; l < m; l++) {
      for (const packed of lookup(map, target ^ s1[k] ^ d[l]) || []) {
        const i = Math.floor(packed / m);
        const j = packed % m;
        if (j < k) found.push([i, j, k, l]);
      }
    }
  }
  return found;
}

export function solveStored(data, missing, expected, accept = null) {
  const positions = lineFeeds(data);
  const m = positions.length;
  if (missing > m) return null;
  if (missing === m) {
    const all = insertCarriageReturns(data, positions);
    return crc32(all) === expected ? all : null;
  }
  if (missing > 4) return null;
  if (missing >= 3 && !accept) return null;
  if (missing === 3 && m > STORED_TRIPLE_LIMIT) return null;
  if (missing === 4 && m > STORED_PAIR_LIMIT) return null;
  const d = deltas(data, positions);
  const target = (expected ^ crc32(data)) >>> 0;
  const accepted = [];
  for (const set of candidateSets(d, missing, target)) {
    const built = insertCarriageReturns(data, set.map((i) => positions[i]));
    if (crc32(built) !== expected) continue;
    if (accept && !accept(built)) continue;
    accepted.push(built);
    if (accepted.length > 1) return null;
  }
  return accepted.length === 1 ? accepted[0] : null;
}

function failurePoint(result) {
  return result.ok ? result.consumed : result.errByte;
}

function toSource(errByte, chosen) {
  let before = 0;
  for (let i = 0; i < chosen.length; i++) if (chosen[i] + i < errByte) before++;
  return errByte - before;
}

function combinations(n, k) {
  let total = 1;
  for (let i = 1; i <= k; i++) total = (total * (n - k + i)) / i;
  return total;
}

function solveDeflate(data, missing, entry, deadline) {
  const feeds = lineFeeds(data);
  const state = { probes: 0, deadline: Math.min(deadline, now() + DEFLATE_MS) };
  const maxOut = entry.usize + 1024;
  const probe = (chosen) => {
    state.probes++;
    return inflateProbe(insertCarriageReturns(data, chosen), maxOut);
  };
  const finished = (result) => result.consumed === data.length + missing && result.out.length === entry.usize && crc32(result.out) === entry.crc;
  const descend = (chosen, result) => {
    if (result.ok && finished(result)) return chosen.length === missing ? chosen : null;
    if (chosen.length === missing || state.probes >= DEFLATE_PROBES || now() > state.deadline) return null;
    const last = chosen.length > 0 ? chosen[chosen.length - 1] : -1;
    const errAt = toSource(failurePoint(result), chosen);
    const seen = new Set();
    for (const window of DEFLATE_WINDOWS) {
      let scored = [];
      for (const p of feeds) {
        if (p <= last || p > errAt + 1 || p < errAt - window || seen.has(p)) continue;
        if (state.probes >= DEFLATE_PROBES || now() > state.deadline) break;
        seen.add(p);
        const next = chosen.concat(p);
        const outcome = probe(next);
        scored.push({ p, outcome, reach: outcome.ok && finished(outcome) ? Infinity : toSource(failurePoint(outcome), next) });
      }
      scored = scored.filter((s) => s.reach > errAt).sort((a, b) => b.reach - a.reach).slice(0, DEFLATE_BRANCH);
      for (const s of scored) {
        const found = descend(chosen.concat(s.p), s.outcome);
        if (found) return found;
      }
      if (state.probes >= DEFLATE_PROBES || now() > state.deadline) return null;
    }
    return null;
  };
  const exhaust = () => {
    const picked = [];
    const walk = (from) => {
      if (picked.length === missing) {
        const positions = picked.map((i) => feeds[i]);
        const result = probe(positions);
        return result.ok && finished(result) ? positions : null;
      }
      for (let i = from; i < feeds.length; i++) {
        if (now() > state.deadline) return null;
        picked.push(i);
        const found = walk(i + 1);
        picked.pop();
        if (found) return found;
      }
      return null;
    };
    return walk(0);
  };
  const effort = combinations(feeds.length, missing) * Math.max(1, data.length / 16384);
  let chosen = null;
  if (effort <= DEFLATE_EXHAUSTIVE) {
    chosen = exhaust();
  } else {
    chosen = descend([], probe([]));
    if (!chosen && missing <= 3) chosen = exhaust();
  }
  return chosen ? insertCarriageReturns(data, chosen) : null;
}

function solveEntry(bytes, item, deadline) {
  const { entry, dataAt, dataLength, missing } = item;
  if (entry.flags & 1) return null;
  const data = bytes.subarray(dataAt, dataAt + dataLength);
  if (entry.method === 0) return entry.usize === entry.csize ? solveStored(data, missing, entry.crc, isPng(data) ? pngIntact : null) : null;
  if (entry.method === 8) return solveDeflate(data, missing, entry, deadline);
  return null;
}

export function restoreCarriageReturns(bytes) {
  const layout = readLayout(bytes);
  if (!layout) return null;
  const pending = layout.filter((item) => item.missing > 0);
  if (pending.length === 0) return null;
  const deadline = now() + TOTAL_MS;
  const pieces = [];
  let cursor = 0;
  let restored = 0;
  const failed = [];
  for (const item of pending) {
    const fixed = solveEntry(bytes, item, deadline);
    if (!fixed) {
      failed.push(item.entry);
      continue;
    }
    pieces.push(bytes.subarray(cursor, item.dataAt), fixed);
    cursor = item.dataAt + item.dataLength;
    restored++;
  }
  if (restored === 0) return null;
  pieces.push(bytes.subarray(cursor));
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return { bytes: out, restored, failed: failed.length, entries: pending.length };
}
