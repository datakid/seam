import { Inflate, inflateSync } from '../../vendor/fflate.module.js';
import { crc32 } from './crc32.js';
import { SIG } from './constants.js';
import { indexOfBytes } from './identify.js';
import { decodeName, validNameBytes, normalizeName, dosToDate, findEocdPosition } from './zip-read.js';

const MAX_CANDIDATES = 16;

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
  return {
    p,
    flags,
    method,
    time: u16(bytes, p + 10),
    date: u16(bytes, p + 12),
    crc: u32(bytes, p + 14),
    csize: u32(bytes, p + 18),
    usize: u32(bytes, p + 22),
    nlen,
    elen,
    nameBytes,
    dataStart: p + 30 + nlen + elen
  };
}

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function pushRange(inflater, slice, from, to, size) {
  let at = from;
  while (at < to) {
    const next = Math.min(to, at + size);
    try {
      inflater.push(slice.subarray(at, next), false);
    } catch (error) {
      return at;
    }
    at = next;
  }
  return -1;
}

function collector() {
  const state = { chunks: [], total: 0 };
  state.inflater = new Inflate((chunk) => {
    if (chunk.length > 0) {
      state.chunks.push(chunk);
      state.total += chunk.length;
    }
  });
  return state;
}

export function inflatePartial(slice) {
  const first = collector();
  const failedAt = pushRange(first.inflater, slice, 0, slice.length, 65536);
  if (failedAt === -1) {
    try {
      first.inflater.push(new Uint8Array(0), true);
      return { data: concat(first.chunks, first.total), complete: true };
    } catch (error) {
      return { data: concat(first.chunks, first.total), complete: false };
    }
  }
  const second = collector();
  pushRange(second.inflater, slice, 0, failedAt, 65536);
  pushRange(second.inflater, slice, failedAt, Math.min(slice.length, failedAt + 65536), 96);
  return { data: concat(second.chunks, second.total), complete: false };
}

function partialFrom(slice, method) {
  if (method === 0) return { data: slice.slice(), complete: false };
  return inflatePartial(slice);
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

function recoverEntry(bytes, h) {
  const n = bytes.length;
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
          const ok = crc32(data) === h.crc && data.length === h.usize;
          return { ...base, data, state: ok ? 'ok' : 'crcMismatch', nextPos: end };
        }
        const part = partialFrom(slice, h.method);
        return { ...base, data: part.data, state: part.data.length > 0 ? 'partial' : 'unreadable', nextPos: end };
      }
      const part = partialFrom(bytes.subarray(h.dataStart, n), h.method);
      return { ...base, data: part.data, state: part.data.length > 0 ? 'partial' : 'unreadable', nextPos: n };
    }
  }

  const candidates = candidatesAfter(bytes, h.dataStart);
  let mismatch = null;
  for (const c of candidates) {
    let end = c.at;
    let expected = h.crc !== 0 ? h.crc : null;
    let next = c.at;
    if (c.kind === 'descriptor') {
      expected = u32(bytes, c.at + 4);
      next = c.at + 4;
    } else if (c.at - 12 >= h.dataStart && u32(bytes, c.at - 8) === c.at - 12 - h.dataStart) {
      end = c.at - 12;
      expected = u32(bytes, c.at - 12);
    }
    const data = tryDecode(bytes.subarray(h.dataStart, end), h.method);
    if (!data) continue;
    if (expected === null || crc32(data) === expected) return { ...base, data, state: 'ok', expectedSize: data.length, nextPos: next };
    if (!mismatch) mismatch = { ...base, data, state: 'crcMismatch', expectedSize: data.length, nextPos: next };
  }
  if (mismatch) return mismatch;
  const extent = candidates.length > 0 ? candidates[0].at : n;
  const part = partialFrom(bytes.subarray(h.dataStart, extent), h.method);
  return { ...base, data: part.data, state: part.data.length > 0 ? 'partial' : 'unreadable', nextPos: extent };
}

export function recoverEntries(bytes) {
  const n = bytes.length;
  const entries = [];
  const dropped = [];
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
      lastEnd = n;
      break;
    }
    const entry = recoverEntry(bytes, h);
    const raw = decodeName(h.nameBytes, (h.flags & 0x800) !== 0);
    const name = normalizeName(raw);
    if (name === null || name === '') dropped.push(raw);
    else if (!name.endsWith('/')) entries.push({ ...entry, name });
    lastEnd = Math.max(lastEnd, entry.nextPos);
    pos = Math.max(entry.nextPos, p + 4);
  }
  const hasCentral = indexOfBytes(bytes, SIG.CENTRAL, lastEnd) !== -1;
  const endsEarly = headerCut || (hasCentral && findEocdPosition(bytes) === -1);
  return { entries, dropped, endsEarly, lastEnd };
}

const RANK = { ok: 4, crcMismatch: 3, partial: 2, unreadable: 1, unsupported: 0 };

export function mergeEntries(primary, secondary) {
  const map = new Map();
  const order = [];
  for (const list of [primary, secondary]) {
    for (const entry of list) {
      const key = entry.name.toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, entry);
        order.push(key);
      } else if (RANK[entry.state] > RANK[existing.state] || (RANK[entry.state] === RANK[existing.state] && list === secondary && entry.data.length > existing.data.length)) {
        map.set(key, entry);
      }
    }
  }
  return order.map((key) => map.get(key));
}

