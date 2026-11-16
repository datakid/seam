export const KINDS = [
  'truncate', 'zero512', 'zero4096', 'losttail', 'head', 'crlf', 'bitflip',
  'insert', 'dropblock', 'prefix', 'suffix', 'concat', 'padzero'
];

export const ERROR_PAGE = '<!DOCTYPE html>\r\n<html><head><title>404 Not Found</title></head>\r\n<body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>\r\n';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    bytes: (n) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = Math.floor(next() * 256);
      return out;
    }
  };
}

export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function caseSeed(id, kind, index) {
  return hashString(`${id}|${kind}|${index}`);
}

function meta(kind, seed, input, output, extra) {
  return { kind, seed, lengthBefore: input.length, lengthAfter: output.length, changed: [], removed: [], ...extra };
}

function concatBytes(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function truncate(bytes, rng, seed) {
  const pct = rng.pick([10, 30, 50, 70, 90, 99]);
  const cut = Math.max(1, Math.floor((bytes.length * pct) / 100));
  const out = bytes.slice(0, cut);
  return { bytes: out, meta: meta('truncate', seed, bytes, out, { params: { pct }, removed: [[cut, bytes.length]] }) };
}

function zeroBlocks(kind, size) {
  return (bytes, rng, seed) => {
    const n = bytes.length;
    const out = bytes.slice();
    const maxBlocks = Math.max(1, Math.floor(n / 3 / size));
    const count = Math.min(rng.int(1, 8), maxBlocks);
    const thirdStart = Math.floor(n / 3);
    const thirdEnd = Math.floor((2 * n) / 3);
    const firstSlot = Math.ceil(thirdStart / size);
    const lastSlot = Math.floor(thirdEnd / size) - count;
    const slot = lastSlot >= firstSlot ? rng.int(firstSlot, lastSlot) : Math.max(0, Math.floor(n / 2 / size) - Math.floor(count / 2));
    const start = Math.min(slot * size, Math.max(0, n - 1));
    const end = Math.min(n, start + count * size);
    out.fill(0, start, end);
    return { bytes: out, meta: meta(kind, seed, bytes, out, { params: { block: size, count }, changed: [[start, end]] }) };
  };
}

function losttail(bytes, rng, seed) {
  const n = bytes.length;
  const want = rng.int(1, 64) * 1024;
  const len = Math.min(want, Math.max(1, Math.floor(n / 2)));
  const out = bytes.slice();
  out.fill(0, n - len, n);
  return { bytes: out, meta: meta('losttail', seed, bytes, out, { params: { bytes: len }, changed: [[n - len, n]] }) };
}

function head(bytes, rng, seed) {
  const size = Math.min(rng.pick([512, 4096]), bytes.length);
  const out = bytes.slice();
  out.set(rng.bytes(size), 0);
  return { bytes: out, meta: meta('head', seed, bytes, out, { params: { size }, changed: [[0, size]] }) };
}

function crlf(bytes, rng, seed) {
  const parts = [];
  let added = 0;
  let originalCrlf = 0;
  let from = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue;
    if (i > 0 && bytes[i - 1] === 0x0d) {
      originalCrlf++;
      continue;
    }
    parts.push(bytes.subarray(from, i), Uint8Array.of(0x0d));
    from = i;
    added++;
  }
  parts.push(bytes.subarray(from));
  const out = concatBytes(parts);
  return { bytes: out, meta: meta('crlf', seed, bytes, out, { params: { added, originalCrlf } }) };
}

function bitflip(bytes, rng, seed) {
  const count = rng.pick([1, 8, 64]);
  const out = bytes.slice();
  const seen = new Set();
  const flips = [];
  const limit = Math.min(count, bytes.length * 8);
  while (flips.length < limit) {
    const bit = Math.floor(rng.next() * bytes.length * 8);
    if (seen.has(bit)) continue;
    seen.add(bit);
    out[bit >> 3] ^= 1 << (bit & 7);
    flips.push(bit);
  }
  flips.sort((a, b) => a - b);
  const changed = [...new Set(flips.map((b) => b >> 3))].map((o) => [o, o + 1]);
  return { bytes: out, meta: meta('bitflip', seed, bytes, out, { params: { count: flips.length, bits: flips }, changed }) };
}

function insert(bytes, rng, seed) {
  const size = 4096;
  const slots = Math.max(1, Math.floor(bytes.length / size));
  const offset = Math.min(bytes.length, rng.int(0, slots) * size);
  const block = rng.bytes(size);
  const out = concatBytes([bytes.subarray(0, offset), block, bytes.subarray(offset)]);
  return { bytes: out, meta: meta('insert', seed, bytes, out, { params: { offset, size }, changed: [[offset, offset + size]] }) };
}

function dropblock(bytes, rng, seed) {
  const base = bytes.length >= 3 * 4096 ? 4096 : 512;
  const size = Math.max(1, Math.min(base, Math.floor(bytes.length / 2)));
  const slots = Math.max(1, Math.floor(bytes.length / size) - 1);
  const slot = rng.int(0, slots - 1);
  const start = Math.min(slot * size, Math.max(0, bytes.length - size));
  const end = Math.min(bytes.length, start + size);
  const out = concatBytes([bytes.subarray(0, start), bytes.subarray(end)]);
  return { bytes: out, meta: meta('dropblock', seed, bytes, out, { params: { block: size }, removed: [[start, end]] }) };
}

function page(where) {
  return (bytes, rng, seed) => {
    const html = new TextEncoder().encode(ERROR_PAGE);
    const out = where === 'prefix' ? concatBytes([html, bytes]) : concatBytes([bytes, html]);
    const at = where === 'prefix' ? 0 : bytes.length;
    return { bytes: out, meta: meta(where, seed, bytes, out, { params: { size: html.length }, changed: [[at, at + html.length]] }) };
  };
}

function concat(bytes, rng, seed, options) {
  if (!options || !options.other) throw new Error('concat needs options.other');
  const out = concatBytes([bytes, options.other]);
  return { bytes: out, meta: meta('concat', seed, bytes, out, { params: { otherLength: options.other.length }, changed: [[bytes.length, out.length]] }) };
}

function padzero(bytes, rng, seed) {
  const pct = rng.int(50, 90);
  const cut = Math.max(1, Math.floor((bytes.length * pct) / 100));
  const out = bytes.slice();
  out.fill(0, cut);
  return { bytes: out, meta: meta('padzero', seed, bytes, out, { params: { pct }, changed: [[cut, bytes.length]] }) };
}

const IMPLEMENTATIONS = {
  truncate,
  zero512: zeroBlocks('zero512', 512),
  zero4096: zeroBlocks('zero4096', 4096),
  losttail,
  head,
  crlf,
  bitflip,
  insert,
  dropblock,
  prefix: page('prefix'),
  suffix: page('suffix'),
  concat,
  padzero
};

export function damage(bytes, kind, seed, options = null) {
  const fn = IMPLEMENTATIONS[kind];
  if (!fn) throw new Error(`unknown damage kind: ${kind}`);
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error('damage needs a non-empty Uint8Array');
  return fn(bytes, makeRng(seed), seed >>> 0, options);
}
