import { inflateSync } from '../../vendor/fflate.module.js';
import { inflateTolerant } from './inflate-tolerant.js';
import { crc32 } from './crc32.js';
import { SIG } from './constants.js';
import { indexOfBytes } from './identify.js';
import { decodeName, validNameBytes, normalizeName, dosToDate, findEocdPosition, zip64Extra } from './zip-read.js';
import { looksWellFormed } from './xml-repair.js';
import { recoverHeaderless, findOrphans } from './zip-orphans.js';

const MAX_CANDIDATES = 64;
const MAX_INFLATED = 1 << 28;
const INFLATE_BUDGET_MS = 4000;

function u16(bytes, at) {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function parseLocal(bytes, p) {
  const n = bytes.length;
  if (p + 30 > n) return { cut: true, headerCut: true, p };
  const flags = u16(bytes, p + 6);
  const method = u16(bytes, p + 8);
  const nlen = u16(bytes, p + 26);
  const elen = u16(bytes, p + 28);
  if (nlen === 0 || nlen > 1024 || method > 99) return null;
  if (p + 30 + nlen > n) return { cut: true, p };
  const nameBytes = bytes.subarray(p + 30, p + 30 + nlen);
  if (!validNameBytes(nameBytes)) return null;
  let csize = u32(bytes, p + 18);
  let usize = u32(bytes, p + 22);
  let zip64 = false;
  if (elen >= 4) {
    const extra = zip64Extra(bytes, p + 30 + nlen, elen, { usize: usize === 0xffffffff, csize: csize === 0xffffffff });
    if (extra.found) {
      zip64 = true;
      if (extra.usize !== undefined) usize = extra.usize;
      if (extra.csize !== undefined) csize = extra.csize;
    }
  }
  return {
    p,
    flags,
    method,
    time: u16(bytes, p + 10),
    date: u16(bytes, p + 12),
    crc: u32(bytes, p + 14),
    csize,
    usize,
    zip64,
    nlen,
    elen,
    nameBytes,
    dataStart: p + 30 + nlen + elen
  };
}

export function inflatePartial(slice, expectedSize) {
  const result = inflateTolerant(slice, { maxOut: MAX_INFLATED, budgetMs: INFLATE_BUDGET_MS, expectedSize, zeroRuns: true });
  if (result.holes.length === 0) return { data: result.data, complete: result.complete, holes: [], whole: null };
  const head = result.data.slice(0, result.holes[0][0]);
  if (!result.aligned) return { data: head, complete: false, holes: [], whole: null };
  return { data: head, complete: false, holes: result.holes, whole: result.data };
}

function partialFrom(slice, method, expectedSize) {
  if (method === 0) return { data: slice.slice(), complete: false, holes: [], whole: null };
  return inflatePartial(slice, expectedSize === null ? undefined : expectedSize);
}

function partialEntry(base, part, nextPos) {
  const entry = { ...base, data: part.data, state: part.data.length > 0 ? 'partial' : 'unreadable', nextPos };
  if (part.holes.length > 0) {
    entry.holes = part.holes;
    entry.whole = part.whole;
  }
  return entry;
}

function tryDecode(slice, method) {
  if (method === 0) return slice.slice();
  try {
    return inflateSync(slice);
  } catch (error) {
    return null;
  }
}

function candidatesAfter(bytes, from) {
  const found = [];
  const n = bytes.length;
  let i = bytes.indexOf(0x50, from);
  while (i !== -1 && i + 3 < n && found.length < MAX_CANDIDATES) {
    if (bytes[i + 1] === 0x4b) {
      const a = bytes[i + 2];
      const b = bytes[i + 3];
      if ((a === 3 && b === 4) || (a === 1 && b === 2) || (a === 5 && b === 6) || (a === 7 && b === 8)) found.push({ at: i, kind: a === 7 ? 'descriptor' : 'header' });
    }
    i = bytes.indexOf(0x50, i + 1);
  }
  return found;
}

function recoverEntry(bytes, header, hint) {
  const n = bytes.length;
  let h = header;
  if ((h.flags & 8) !== 0 && hint && hint.dataStart === h.dataStart && hint.csize !== undefined && h.csize === 0) {
    h = { ...h, flags: h.flags & ~8, csize: hint.csize, usize: hint.expectedSize, crc: hint.crc };
  }
  const base = { method: h.method, mtime: dosToDate(h.time, h.date), expectedSize: null, data: new Uint8Array(0), state: 'unreadable', rawName: null };
  if ((h.flags & 1) !== 0 || (h.method !== 0 && h.method !== 8)) {
    return { ...base, state: 'unsupported', nextPos: Math.min(n, h.dataStart) };
  }
  const hasDescriptor = (h.flags & 8) !== 0;
  if (h.dataStart > n) return { ...base, nextPos: n };

  if (!hasDescriptor) {
    base.expectedSize = h.usize;
    if (h.csize === 0) {
      if (h.usize === 0 || h.crc === 0) return { ...base, state: 'ok', nextPos: h.dataStart };
    } else {
      const end = h.dataStart + h.csize;
      if (end <= n) {
        const slice = bytes.subarray(h.dataStart, end);
        const data = tryDecode(slice, h.method);
        if (data) {
          if (crc32(data) === h.crc && data.length === h.usize) return { ...base, data, state: 'ok', nextPos: end };
          if (h.method === 8) {
            const part = partialFrom(slice, h.method, base.expectedSize);
            if (part.holes.length > 0 && part.data.length > 0) return partialEntry(base, part, end);
          }
          return { ...base, data, state: 'crcMismatch', nextPos: end };
        }
        return partialEntry(base, partialFrom(slice, h.method, base.expectedSize), end);
      }
      return partialEntry(base, partialFrom(bytes.subarray(h.dataStart, n), h.method, base.expectedSize), n);
    }
  }

  const candidates = candidatesAfter(bytes, h.dataStart);
  let mismatch = null;
  for (const c of candidates) {
    let end = c.at;
    let expected = h.crc !== 0 ? h.crc : null;
    let size = null;
    let next = c.at;
    if (c.kind === 'descriptor') {
      expected = u32(bytes, c.at + 4);
      size = h.zip64 ? u32(bytes, c.at + 16) : u32(bytes, c.at + 12);
      next = c.at + 4;
    } else if (c.at - 12 >= h.dataStart && u32(bytes, c.at - 8) === c.at - 12 - h.dataStart) {
      end = c.at - 12;
      expected = u32(bytes, c.at - 12);
      size = u32(bytes, c.at - 4);
    }
    const data = tryDecode(bytes.subarray(h.dataStart, end), h.method);
    if (!data) continue;
    if (expected === null || crc32(data) === expected) return { ...base, data, state: 'ok', expectedSize: data.length, nextPos: next };
    if (!mismatch) {
      mismatch = { ...base, data, state: 'crcMismatch', expectedSize: data.length, nextPos: next };
      if (h.method === 8) {
        const part = partialFrom(bytes.subarray(h.dataStart, end), h.method, size);
        if (part.holes.length > 0 && part.data.length > 0) mismatch = partialEntry({ ...base, expectedSize: size }, part, next);
      }
    }
  }
  if (mismatch) return mismatch;
  const extent = candidates.length > 0 ? candidates[0].at : n;
  return partialEntry(base, partialFrom(bytes.subarray(h.dataStart, extent), h.method, base.expectedSize), extent);
}

export function recoverEntries(bytes, hints = []) {
  const spans = new Map();
  for (const hint of hints) if (hint.dataStart !== undefined) spans.set(hint.name.toLowerCase(), hint);
  const n = bytes.length;
  const entries = [];
  const dropped = [];
  const covered = [];
  let pos = 0;
  let lastEnd = 0;
  let headerCut = false;
  for (;;) {
    const p = indexOfBytes(bytes, SIG.LOCAL, pos);
    if (p === -1) break;
    const h = parseLocal(bytes, p);
    if (!h) {
      pos = p + 1;
      continue;
    }
    if (h.headerCut) {
      headerCut = true;
      break;
    }
    if (h.cut) {
      const raw = decodeName(bytes.subarray(p + 30, n), false);
      const name = normalizeName(raw);
      if (name) entries.push({ name, method: 0, mtime: null, data: new Uint8Array(0), state: 'unreadable', expectedSize: null, nextPos: n });
      covered.push([p, n]);
      lastEnd = n;
      break;
    }
    const raw = decodeName(h.nameBytes, (h.flags & 0x800) !== 0);
    const name = normalizeName(raw);
    const entry = recoverEntry(bytes, h, name ? spans.get(name.toLowerCase()) : undefined);
    if (name === null || name === '') dropped.push(raw);
    else if (!name.endsWith('/')) entries.push({ ...entry, name });
    covered.push([p, entry.nextPos]);
    lastEnd = Math.max(lastEnd, entry.nextPos);
    pos = Math.max(entry.nextPos, p + 4);
  }
  const central = indexOfBytes(bytes, SIG.CENTRAL, lastEnd);
  const endsEarly = headerCut || (central !== -1 && findEocdPosition(bytes) === -1);
  const scanned = new Set(entries.map((entry) => entry.name.toLowerCase()));
  for (const entry of recoverHeaderless(bytes, hints, scanned)) {
    entries.push(entry);
    covered.push(entry.span);
  }
  const orphans = findOrphans(bytes, covered, central === -1 ? n : central);
  return { entries, dropped, endsEarly, lastEnd, orphans };
}

const RANK = { ok: 4, crcMismatch: 3, partial: 2, unreadable: 1, unsupported: 0 };

function rankOf(entry) {
  return RANK[entry.state] + (entry.holes ? 1.5 : 0);
}

function wellFormedXml(entry) {
  if (!/\.(xml|rels)$/i.test(entry.name) || entry.data.length === 0) return 0;
  return looksWellFormed(new TextDecoder().decode(entry.data)) ? 1 : 0;
}

function checksum(entry) {
  if (entry.checksum === undefined) entry.checksum = crc32(entry.data);
  return entry.checksum;
}

function sameBytes(a, b) {
  if (a.data.length !== b.data.length) return false;
  if (checksum(a) !== checksum(b)) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

function better(entry, existing, existingIsPrimary) {
  const a = rankOf(entry);
  const b = rankOf(existing);
  if (a !== b) return a > b;
  if (existingIsPrimary && existing.state === 'ok') return false;
  const x = wellFormedXml(entry);
  const y = wellFormedXml(existing);
  if (x !== y) return x > y;
  return entry.data.length > existing.data.length;
}

export function mergeEntries(primary, secondary) {
  const map = new Map();
  const order = [];
  const central = new Set(primary);
  for (const list of [primary, secondary]) {
    for (const entry of list) {
      const key = entry.name.toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, entry);
        order.push(key);
        continue;
      }
      const differs = !sameBytes(entry, existing);
      const winner = better(entry, existing, central.has(existing)) ? entry : existing;
      if (differs) winner.rejected = (winner.rejected || 0) + 1 + (winner === entry ? existing.rejected || 0 : entry.rejected || 0);
      map.set(key, winner);
    }
  }
  return order.map((key) => map.get(key));
}

const WRONG_TOLERANCE = 0.005;
const MIN_EVIDENCE = 256;
const MIN_CONTRAST = 4096;
const SHARED_RUN = 512;

function knownAgree(damaged, good) {
  if (damaged.state !== 'partial') return null;
  const aligned = Boolean(damaged.holes && damaged.whole);
  const source = aligned ? damaged.whole : damaged.data;
  const target = good.data;
  const limit = Math.min(source.length, target.length);
  const spans = [];
  let at = 0;
  if (aligned) {
    for (const [start, end] of damaged.holes) {
      if (start > at) spans.push([at, Math.min(start, limit)]);
      if (end > at) at = end;
    }
  }
  if (at < limit) spans.push([at, limit]);
  let known = 0;
  let wrong = 0;
  let run = 0;
  let longest = 0;
  for (const [a, b] of spans) {
    run = 0;
    for (let i = a; i < b; i++) {
      known++;
      if (source[i] === target[i]) {
        run++;
        if (run > longest) longest = run;
      } else {
        wrong++;
        run = 0;
      }
    }
  }
  if (known < MIN_EVIDENCE) return null;
  if (wrong <= known * WRONG_TOLERANCE) return true;
  if (known >= MIN_CONTRAST && longest < SHARED_RUN && wrong > known * 0.5) return false;
  return null;
}

function relation(a, b) {
  if (a.state === 'ok' && b.state === 'ok') return sameBytes(a, b) ? 'same' : 'conflict';
  let verdict = null;
  if (a.state === 'ok') verdict = knownAgree(b, a);
  else if (b.state === 'ok') verdict = knownAgree(a, b);
  if (verdict === null) return 'unknown';
  return verdict ? 'same' : 'conflict';
}

function agrees(accepted, other) {
  const index = new Map();
  for (const list of accepted) {
    for (const entry of list) {
      const key = entry.name.toLowerCase();
      const bucket = index.get(key);
      if (bucket) bucket.push(entry);
      else index.set(key, [entry]);
    }
  }
  let shared = 0;
  for (const entry of other) {
    const bucket = index.get(entry.name.toLowerCase());
    if (!bucket) continue;
    for (const known of bucket) {
      const verdict = relation(known, entry);
      if (verdict === 'conflict') return false;
      if (verdict === 'same') shared++;
    }
  }
  return shared > 0;
}

export function mergeCopies(lists) {
  const used = lists.map((list, i) => i === 0);
  const accepted = [0];
  for (let i = 1; i < lists.length; i++) {
    if (agrees(accepted.map((k) => lists[k]), lists[i])) {
      used[i] = true;
      accepted.push(i);
    }
  }
  const map = new Map();
  const order = [];
  for (const i of accepted) {
    for (const entry of lists[i]) {
      entry.copy = i;
      const key = entry.name.toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, entry);
        order.push(key);
      } else if (better(entry, existing, true)) {
        map.set(key, entry);
      }
    }
  }
  return { entries: order.map((key) => map.get(key)), used };
}
