import { inflateSync } from '../../vendor/fflate.module.js';
import { inflateTolerant } from './inflate-tolerant.js';
import { crc32 } from './crc32.js';
import { SIG } from './constants.js';
import { indexOfBytes } from './identify.js';
import { identifyContent } from './orphan-kinds.js';

const MIN_GAP = 24;
const MIN_DATA = 8;
const MIN_NAMED = 32;
const SCAN_SPAN = 800;
const PROBE_BYTES = 2048;
const MAX_ORPHANS = 64;
const MAX_ORPHAN_OUT = 1 << 27;
const TRIAL_MS = 400;
const TOTAL_MS = 3000;
const DESCRIPTOR_SIG = 0x08074b50;
const IEND = [0x49, 0x45, 0x4e, 0x44];

function u32(bytes, at) {
  if (at < 0 || at + 4 > bytes.length) return -1;
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function tryDecode(slice, method) {
  if (method === 0) return slice.slice();
  try {
    return inflateSync(slice);
  } catch (error) {
    return null;
  }
}

export function recoverHeaderless(bytes, hints, scanned) {
  const n = bytes.length;
  const lhos = hints.filter((h) => h.lho !== undefined).map((h) => h.lho).sort((a, b) => a - b);
  const found = [];
  for (const hint of hints) {
    if (hint.lho === undefined || hint.dataStart !== undefined || hint.csize === undefined) continue;
    if (hint.state !== 'unreadable' || (hint.method !== 0 && hint.method !== 8)) continue;
    if (scanned.has(hint.name.toLowerCase()) || hint.csize === 0) continue;
    const floor = hint.lho + 30;
    const next = lhos.find((v) => v > hint.lho);
    const central = indexOfBytes(bytes, SIG.CENTRAL, floor);
    const bounds = new Set();
    for (const edge of [next, central === -1 ? undefined : central, n]) {
      if (edge === undefined || edge > n) continue;
      for (const d of [0, 12, 16, 24]) bounds.add(edge - d);
    }
    const starts = new Set();
    for (const end of bounds) if (end - hint.csize >= floor) starts.add(end - hint.csize);
    if (hint.method === 8) {
      const nameLength = new TextEncoder().encode(hint.name).length;
      for (let s = floor + Math.max(0, nameLength - 8); s <= floor + nameLength + 400 && s + hint.csize <= n; s++) starts.add(s);
    }
    for (const s of starts) {
      const end = s + hint.csize;
      if (end > n) continue;
      const data = tryDecode(bytes.subarray(s, end), hint.method);
      if (data && data.length === hint.expectedSize && crc32(data) === hint.crc) {
        found.push({ name: hint.name, method: hint.method, mtime: hint.mtime, data, state: 'ok', expectedSize: data.length, nextPos: end, span: [hint.lho, end] });
        break;
      }
    }
  }
  return found;
}

function closeAt(bytes, end, b, data) {
  const sum = crc32(data);
  if (end === b) return { next: b, verified: false };
  for (const d of [24, 16, 12]) {
    if (end + d !== b) continue;
    const signed = d !== 12;
    if (signed && u32(bytes, end) !== DESCRIPTOR_SIG) continue;
    if (u32(bytes, signed ? end + 4 : end) === sum) return { next: b, verified: true };
  }
  if (u32(bytes, end) === DESCRIPTOR_SIG && u32(bytes, end + 4) === sum && end + 16 <= b) {
    return { next: end + (u32(bytes, end + 12) === data.length ? 16 : 24), verified: true };
  }
  return null;
}

function probe(bytes, s, b) {
  const result = inflateTolerant(bytes.subarray(s, Math.min(b, s + PROBE_BYTES)), { maxOut: 1 << 20, budgetMs: 50, searchBytes: 1 });
  return result.gaps.length === 0 && result.data.length > 0;
}

function deflated(bytes, s, b) {
  const result = inflateTolerant(bytes.subarray(s, b), { maxOut: MAX_ORPHAN_OUT, budgetMs: TRIAL_MS, searchBytes: 1 });
  if (!result.complete || result.data.length < MIN_DATA) return null;
  const end = s + result.consumed;
  const closed = closeAt(bytes, end, b, result.data);
  if (closed) return { data: result.data, method: 8, verified: closed.verified, span: [s, closed.next] };
  if (result.data.length >= MIN_NAMED && identifyContent(result.data).kind !== 'unknown') return { data: result.data, method: 8, verified: false, span: [s, end] };
  return null;
}

function storedMedia(bytes, s, b) {
  const png = bytes[s] === 0x89 && bytes[s + 1] === 0x50 && bytes[s + 2] === 0x4e && bytes[s + 3] === 0x47;
  const jpeg = bytes[s] === 0xff && bytes[s + 1] === 0xd8 && bytes[s + 2] === 0xff;
  const gif = bytes[s] === 0x47 && bytes[s + 1] === 0x49 && bytes[s + 2] === 0x46 && bytes[s + 3] === 0x38;
  if (!png && !jpeg && !gif) return null;
  const ends = [];
  if (png) {
    const at = indexOfBytes(bytes.subarray(0, b), IEND, s + 8);
    if (at !== -1) ends.push(at + 8);
  } else {
    for (const d of [0, 12, 16, 24]) {
      const end = b - d;
      if (end <= s + MIN_DATA) continue;
      const marker = jpeg ? bytes[end - 2] === 0xff && bytes[end - 1] === 0xd9 : bytes[end - 1] === 0x3b;
      if (marker) ends.push(end);
    }
  }
  for (const end of ends) {
    if (end > b || end - s < MIN_DATA) continue;
    const data = bytes.subarray(s, end);
    const closed = closeAt(bytes, end, b, data);
    if (closed && (closed.verified || png)) return { data: data.slice(), method: 0, verified: closed.verified, span: [s, closed.next] };
  }
  return null;
}

export function findOrphans(bytes, spans, limit) {
  const sorted = spans.slice().sort((x, y) => x[0] - y[0]);
  const gaps = [];
  let at = 0;
  for (const [start, end] of sorted) {
    if (start > at) gaps.push([at, start]);
    if (end > at) at = end;
  }
  if (limit > at) gaps.push([at, limit]);
  const deadline = now() + TOTAL_MS;
  const orphans = [];
  for (const [a, b] of gaps) {
    let from = a;
    while (b - from >= MIN_GAP && orphans.length < MAX_ORPHANS && now() < deadline) {
      const last = Math.min(b - MIN_DATA, from + SCAN_SPAN);
      let hit = null;
      for (let s = from; s < last && hit === null; s++) {
        if ((bytes[s] & 6) !== 6 && probe(bytes, s, b)) hit = deflated(bytes, s, b);
        if (hit === null) hit = storedMedia(bytes, s, b);
      }
      if (hit === null) break;
      orphans.push(hit);
      from = hit.span[1];
    }
  }
  return orphans;
}
