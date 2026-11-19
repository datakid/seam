import { test, assert, eq, bytesEqual } from './harness.js';
import { deflateSync, inflateSync, strToU8 } from '../vendor/fflate.module.js';
import { prng, words, randomBytes, docx, xlsx, pptx, docm, unpack, pack } from './fixtures.js';
import { inflateTolerant } from '../js/core/inflate-tolerant.js';
import { recoverEntries } from '../js/core/zip-recover.js';
import { localEntry } from './corrupt.js';

function xmlText(seed, size) {
  const rand = prng(seed);
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
  const parts = [head];
  let length = head.length;
  for (let i = 0; length < size; i++) {
    const paragraph = `<w:p w14:paraId="${Math.floor(rand() * 4294967295).toString(16)}"><w:r><w:t>${words(seed + i, 6 + (i % 9))} ${Math.floor(rand() * 100000)}</w:t></w:r></w:p>`;
    parts.push(paragraph);
    length += paragraph.length;
  }
  parts.push('</w:body></w:document>');
  return strToU8(parts.join(''));
}

function holeMask(holes, length) {
  const mask = new Uint8Array(length);
  for (const [start, end] of holes) {
    for (let i = start; i < Math.min(end, length); i++) mask[i] = 1;
  }
  return mask;
}

function coverage(result, original) {
  const mask = holeMask(result.holes, result.data.length);
  const firstHoleEnd = result.holes.length > 0 ? result.holes[0][1] : 0;
  let correct = 0;
  let badAfterFirstHole = 0;
  const limit = Math.min(result.data.length, original.length);
  for (let i = 0; i < limit; i++) {
    if (mask[i]) continue;
    if (result.data[i] === original[i]) correct++;
    else if (i >= firstHoleEnd && result.holes.length > 0) badAfterFirstHole++;
  }
  return { correct, badAfterFirstHole };
}

function damageStream(stream, kind, seed) {
  const rand = prng(seed);
  const n = stream.length;
  const third = Math.floor(n / 3);
  const place = (align) => third + Math.floor((rand() * third) / align) * align;
  const out = stream.slice();
  if (kind === 'zero512' || kind === 'zero4096' || kind === 'zero32768') {
    const size = kind === 'zero512' ? 512 : kind === 'zero4096' ? 4096 : 32768;
    const at = place(size);
    out.fill(0, at, Math.min(n, at + size));
    return { bytes: out, at };
  }
  if (kind === 'junk') {
    const at = place(512);
    const noise = randomBytes(seed + 99, 512);
    out.set(noise, at);
    return { bytes: out, at };
  }
  if (kind === 'bitflip') {
    const at = place(1);
    out[at] ^= 1 << Math.floor(rand() * 8);
    return { bytes: out, at };
  }
  if (kind === 'insert') {
    const at = place(4096);
    const noise = randomBytes(seed + 7, 4096);
    const bytes = new Uint8Array(n + 4096);
    bytes.set(stream.subarray(0, at), 0);
    bytes.set(noise, at);
    bytes.set(stream.subarray(at), at + 4096);
    return { bytes, at };
  }
  if (kind === 'dropblock') {
    const at = place(4096);
    const bytes = new Uint8Array(n - 4096);
    bytes.set(stream.subarray(0, at), 0);
    bytes.set(stream.subarray(at + 4096), at);
    return { bytes, at };
  }
  throw new Error(`unknown damage ${kind}`);
}

function prefixLength(data, original) {
  const limit = Math.min(data.length, original.length);
  let i = 0;
  while (i < limit && data[i] === original[i]) i++;
  return i;
}

test('inflate: round trip matches fflate on 200 mixed buffers', () => {
  const rand = prng(11);
  const levels = [0, 1, 6, 9];
  for (let i = 0; i < 200; i++) {
    const size = Math.floor(rand() * 70000);
    const kind = i % 4;
    let data;
    if (kind === 0) data = randomBytes(i + 1, size);
    else if (kind === 1) data = strToU8(words(i + 1, Math.floor(size / 6)));
    else if (kind === 2) data = new Uint8Array(size).fill(i & 255);
    else data = xmlText(i + 1, size);
    const level = levels[i % levels.length];
    const packed = deflateSync(data, { level });
    const result = inflateTolerant(packed, { maxOut: 1 << 28, budgetMs: 5000 });
    assert(bytesEqual(result.data, data), `case ${i} level ${level} size ${data.length}: output differs`);
    eq(result.holes, [], `case ${i} holes`);
    eq(result.gaps, [], `case ${i} gaps`);
    assert(result.complete === true, `case ${i} not complete`);
  }
});

test('inflate: round trip on every fixture part', () => {
  for (const build of [docx, xlsx, pptx, docm]) {
    for (const [name, data] of unpack(build())) {
      const packed = deflateSync(data, { level: 6 });
      const result = inflateTolerant(packed, { maxOut: 1 << 28 });
      assert(bytesEqual(result.data, data), `${name}: output differs`);
      assert(result.complete && result.holes.length === 0, `${name}: not clean`);
    }
  }
});

test('inflate: an empty and a one byte stream decode', () => {
  for (const data of [new Uint8Array(0), new Uint8Array([65])]) {
    const result = inflateTolerant(deflateSync(data), { maxOut: 1024 });
    assert(bytesEqual(result.data, data) && result.complete, 'tiny stream');
  }
});

test('inflate: a cut stream keeps an exact prefix and reports no holes', () => {
  const original = xmlText(3, 1 << 20);
  const packed = deflateSync(original, { level: 6 });
  for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
    const cut = packed.subarray(0, Math.floor(packed.length * fraction));
    const result = inflateTolerant(cut, { maxOut: 1 << 28 });
    assert(prefixLength(result.data, original) === result.data.length, `cut ${fraction}: output is not a prefix`);
    assert(result.data.length >= original.length * fraction * 0.9 - 70000, `cut ${fraction}: only ${result.data.length} bytes kept`);
    assert(result.complete === false, `cut ${fraction}: marked complete`);
    eq(result.holes, [], `cut ${fraction}: holes`);
  }
});

test('inflate: a cut inside the last symbols loses at most a few bytes', () => {
  const original = xmlText(4, 200000);
  const packed = deflateSync(original, { level: 6 });
  const full = inflateTolerant(packed, { maxOut: 1 << 28 });
  assert(full.complete && bytesEqual(full.data, original), 'baseline');
  const cut = inflateTolerant(packed.subarray(0, packed.length - 6), { maxOut: 1 << 28 });
  assert(original.length - cut.data.length < 600, `lost ${original.length - cut.data.length} bytes`);
  assert(prefixLength(cut.data, original) === cut.data.length, 'prefix');
});

const MIN_GAIN = { zero512: 0.15, zero4096: 0.005, zero32768: 0.003 };

for (const kind of ['zero512', 'zero4096', 'zero32768']) {
  test(`inflate: damage ${kind} is cut at the zeros and the rest is recovered`, () => {
    const original = xmlText(5, 1 << 20);
    const packed = deflateSync(original, { level: 6 });
    for (let seed = 1; seed <= 6; seed++) {
      const { bytes, at } = damageStream(packed, kind, seed);
      const plain = inflateTolerant(bytes, { maxOut: 1 << 28 });
      const result = inflateTolerant(bytes, { maxOut: 1 << 28, budgetMs: 10000, expectedSize: original.length, zeroRuns: true });
      assert(result.holes.length > 0, `${kind}/${seed}: no resynchronisation`);
      const head = prefixLength(result.data, original);
      assert(head === result.holes[0][0], `${kind}/${seed}: head is not exact up to the first hole (${head} against ${result.holes[0][0]})`);
      assert(head >= Math.floor((at / packed.length) * original.length * 0.9), `${kind}/${seed}: cut far before the damage`);
      const { correct, badAfterFirstHole } = coverage(result, original);
      eq(badAfterFirstHole, 0, `${kind}/${seed}: known bytes after the first hole differ from the original`);
      const reference = coverage(plain, original).correct;
      assert(correct >= reference + original.length * MIN_GAIN[kind], `${kind}/${seed}: ${correct} correct bytes against ${reference} without the zero run rule`);
    }
  });
}

for (const kind of ['junk', 'bitflip', 'insert', 'dropblock']) {
  test(`inflate: damage ${kind} never throws and any hole is honest`, () => {
    const original = xmlText(5, 1 << 20);
    const packed = deflateSync(original, { level: 6 });
    for (let seed = 1; seed <= 6; seed++) {
      const { bytes, at } = damageStream(packed, kind, seed);
      for (const zeroRuns of [false, true]) {
        const result = inflateTolerant(bytes, { maxOut: 1 << 28, budgetMs: 10000, expectedSize: original.length, zeroRuns });
        assert(result.data instanceof Uint8Array, 'data type');
        assert(Array.isArray(result.holes) && Array.isArray(result.gaps), 'shape');
        const head = prefixLength(result.data, original);
        assert(head >= Math.floor((at / packed.length) * original.length * 0.5), `${kind}/${seed}: lost data far before the damage (kept ${head})`);
        if (result.holes.length === 0) continue;
        eq(coverage(result, original).badAfterFirstHole, 0, `${kind}/${seed}: known bytes after the first hole differ`);
      }
    }
  });
}

test('inflate: zero runs are only treated as damage when asked', () => {
  const data = new Uint8Array(70000).fill(58);
  const packed = deflateSync(data, { level: 6 });
  const plain = inflateTolerant(packed, { maxOut: 1 << 28 });
  assert(bytesEqual(plain.data, data) && plain.complete, 'default decode is exact');
  const asked = inflateTolerant(packed, { maxOut: 1 << 28, zeroRuns: true });
  assert(asked.data.length < data.length || asked.holes.length > 0, 'a long zero run in the compressed data is cut when requested');
});

test('inflate: aligned output has the original length and matching tail', () => {
  const original = xmlText(6, 1 << 20);
  const packed = deflateSync(original, { level: 6 });
  const { bytes } = damageStream(packed, 'zero4096', 2);
  const result = inflateTolerant(bytes, { maxOut: 1 << 28, expectedSize: original.length, zeroRuns: true });
  assert(result.gaps.length === 1, `gaps ${result.gaps.length}`);
  assert(result.aligned === true, 'not aligned');
  eq(result.data.length, original.length, 'length');
  assert(result.complete === false, 'complete with a gap');
  const mask = holeMask(result.holes, result.data.length);
  const lastHole = result.holes[result.holes.length - 1][1];
  for (let i = lastHole + 70000; i < original.length; i++) {
    if (!mask[i] && result.data[i] !== original[i]) throw new Error(`tail byte ${i} differs`);
  }
});

test('inflate: holes cover every byte that differs from the original after the first hole', () => {
  const original = xmlText(8, 1 << 19);
  const packed = deflateSync(original, { level: 6 });
  for (const kind of ['zero4096', 'insert', 'dropblock']) {
    const { bytes } = damageStream(packed, kind, 3);
    const result = inflateTolerant(bytes, { maxOut: 1 << 28, expectedSize: original.length, zeroRuns: true });
    if (result.holes.length === 0) continue;
    const { badAfterFirstHole } = coverage(result, original);
    eq(badAfterFirstHole, 0, kind);
  }
});

test('inflate: stored blocks resynchronise on the length check', () => {
  const original = randomBytes(21, 300000);
  const packed = deflateSync(original, { level: 0 });
  const damaged = packed.slice();
  damaged.fill(0xaa, 65541, 65545);
  const result = inflateTolerant(damaged, { maxOut: 1 << 28, expectedSize: original.length });
  eq(result.gaps.length, 1, 'gaps');
  assert(result.aligned === true, 'aligned');
  eq(result.data.length, original.length, 'length');
  eq(result.holes, [[65535, 131070]], 'hole is the lost block');
  assert(bytesEqual(result.data.subarray(0, 65535), original.subarray(0, 65535)), 'head');
  assert(bytesEqual(result.data.subarray(131070), original.subarray(131070)), 'tail');
});

test('inflate: without an expected size the splice point is a zero length hole', () => {
  const original = randomBytes(22, 300000);
  const packed = deflateSync(original, { level: 0 });
  const damaged = packed.slice();
  damaged.fill(0xaa, 65541, 65545);
  const result = inflateTolerant(damaged, { maxOut: 1 << 28 });
  assert(result.aligned === false, 'aligned without a size');
  eq(result.holes, [[65535, 65535]], 'splice point');
  assert(bytesEqual(result.data.subarray(0, 65535), original.subarray(0, 65535)), 'head');
  assert(bytesEqual(result.data.subarray(65535), original.subarray(131070)), 'tail follows the head directly');
});

test('inflate: two damaged areas give two gaps', () => {
  const original = randomBytes(23, 500000);
  const packed = deflateSync(original, { level: 0 });
  const damaged = packed.slice();
  damaged.fill(0xaa, 65541, 65545);
  damaged.fill(0xbb, 5 * 65540 + 1, 5 * 65540 + 5);
  const result = inflateTolerant(damaged, { maxOut: 1 << 28, expectedSize: original.length });
  eq(result.gaps.length, 2, 'gaps');
  assert(result.complete === false, 'complete');
  assert(bytesEqual(result.data.subarray(0, 65535), original.subarray(0, 65535)), 'head');
});

test('inflate: back references into lost data become holes, literals stay known', () => {
  const original = xmlText(9, 600000);
  const packed = deflateSync(original, { level: 6 });
  const { bytes } = damageStream(packed, 'zero4096', 4);
  const result = inflateTolerant(bytes, { maxOut: 1 << 28, expectedSize: original.length, zeroRuns: true });
  assert(result.gaps.length >= 1, 'no gap');
  const mask = holeMask(result.holes, result.data.length);
  const gapStart = result.holes[0][0];
  const gapEnd = result.holes[0][1];
  let unknownAfter = 0;
  for (let i = gapEnd; i < Math.min(result.data.length, gapEnd + 32768); i++) unknownAfter += mask[i];
  assert(unknownAfter > 0, 'no unknown window bytes after the gap');
  assert(unknownAfter < 32768, 'every byte after the gap is unknown');
  assert(gapStart < gapEnd, 'empty first hole');
});

test('inflate: random input never throws', () => {
  for (let i = 0; i < 150; i++) {
    const size = (i * 977) % 20000;
    const result = inflateTolerant(randomBytes(i + 500, size), { maxOut: 1 << 24, budgetMs: 2000 });
    assert(result.data instanceof Uint8Array && typeof result.complete === 'boolean', `case ${i}`);
    assert(result.data.length <= 1 << 24, 'over the cap');
  }
});

test('inflate: output is capped at maxOut', () => {
  const bomb = deflateSync(new Uint8Array(40 * 1024 * 1024), { level: 9 });
  const result = inflateTolerant(bomb, { maxOut: 1 << 20 });
  assert(result.data.length <= 1 << 20, `kept ${result.data.length}`);
  assert(result.complete === false, 'complete past the cap');
});

test('inflate: the time budget stops the resync search', () => {
  const head = deflateSync(xmlText(10, 300000), { level: 6 }).subarray(0, 4000);
  const junk = randomBytes(31, 6 * 1024 * 1024);
  const input = new Uint8Array(head.length + junk.length);
  input.set(head, 0);
  input.set(junk, head.length);
  const started = performance.now();
  const result = inflateTolerant(input, { maxOut: 1 << 28, budgetMs: 30 });
  const elapsed = performance.now() - started;
  assert(elapsed < 600, `took ${Math.round(elapsed)} ms`);
  assert(result.data.length > 0 && result.complete === false, 'head kept');
});

test('inflate: undamaged speed is within twice fflate on a 20 MB part', () => {
  const original = xmlText(12, 20 * 1024 * 1024);
  const packed = deflateSync(original, { level: 6 });
  const best = (fn) => {
    let low = Infinity;
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      fn();
      low = Math.min(low, performance.now() - t);
    }
    return low;
  };
  const reference = best(() => inflateSync(packed));
  let result = null;
  const own = best(() => {
    result = inflateTolerant(packed, { maxOut: 1 << 30 });
  });
  assert(bytesEqual(result.data, original) && result.complete, 'output');
  assert(own <= reference * 2, `tolerant ${Math.round(own)} ms against fflate ${Math.round(reference)} ms`);
});

function zeroInside(bytes, name, fraction, length) {
  const entry = localEntry(bytes, name);
  const damaged = bytes.slice();
  const at = entry.dataStart + Math.floor(entry.csize * fraction);
  damaged.fill(0, at, at + length);
  return damaged;
}

test('zip recovery: a zeroed run inside a deflate entry keeps the head exact and reports the holes', () => {
  const original = xmlText(7, 600000);
  const zip = pack([['a.xml', original], ['b.xml', xmlText(8, 3000)]]);
  const { entries } = recoverEntries(zeroInside(zip, 'a.xml', 0.4, 512));
  const entry = entries.find((e) => e.name === 'a.xml');
  eq(entry.state, 'partial');
  assert(entry.holes && entry.holes.length > 0, 'holes recorded');
  assert(entry.whole && entry.whole.length === original.length, 'whole has the original length');
  assert(entry.data.length === entry.holes[0][0], 'head ends at the first hole');
  assert(bytesEqual(entry.data, original.subarray(0, entry.data.length)), 'head is exact');
  const mask = holeMask(entry.holes, entry.whole.length);
  let wrong = 0;
  let known = 0;
  for (let i = 0; i < original.length; i++) {
    if (mask[i]) continue;
    known++;
    if (entry.whole[i] !== original[i]) wrong++;
  }
  eq(wrong, 0);
  assert(known > original.length * 0.7, `only ${known} bytes known`);
  eq(entries.find((e) => e.name === 'b.xml').state, 'ok');
});

test('zip recovery: an entry without damage is still read by the plain path', () => {
  const original = xmlText(9, 80000);
  const zip = pack([['a.xml', original]]);
  const { entries } = recoverEntries(zip);
  eq(entries[0].state, 'ok');
  assert(entries[0].holes === undefined, 'no holes');
  assert(bytesEqual(entries[0].data, original), 'data');
});

test('zip recovery: a truncated deflate entry keeps an exact prefix and no holes', () => {
  const original = xmlText(10, 400000);
  const zip = pack([['a.xml', original]]);
  const entry = localEntry(zip, 'a.xml');
  const cut = zip.subarray(0, entry.dataStart + Math.floor(entry.csize * 0.6));
  const { entries } = recoverEntries(cut);
  eq(entries[0].state, 'partial');
  assert(entries[0].holes === undefined, 'no holes');
  assert(bytesEqual(entries[0].data, original.subarray(0, entries[0].data.length)), 'prefix');
  assert(entries[0].data.length > original.length * 0.4, `kept ${entries[0].data.length}`);
});
