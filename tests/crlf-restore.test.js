import { test, assert, eq, bytesEqual, env } from './harness.js';
import { zipSync, unzipSync, strToU8 } from '../vendor/fflate.module.js';
import { docxEntries } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { crc32 } from '../js/core/crc32.js';
import { crcCombine, crcShift, crcShiftOne } from '../js/core/crc-math.js';
import { findTextModeTransfer, removeAddedCarriageReturns } from '../js/core/identify.js';
import { restoreCarriageReturns, readLayout, solveStored, pngIntact } from '../js/core/crlf-restore.js';
import { inflateProbe } from '../js/core/inflate-tolerant.js';

function lcg(seed) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function noiseBytes(length, seed, lineFeeds) {
  const next = lcg(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const b = Math.floor(next() * 256);
    out[i] = b === 0x0a || b === 0x0d ? 0x41 : b;
  }
  const used = new Set();
  while (used.size < lineFeeds) used.add(8 + Math.floor(next() * (length - 16)));
  for (const at of used) out[at] = 0x0a;
  return out;
}

function proseText(seed, lines) {
  const next = lcg(seed);
  const vocab = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango'];
  const rows = [];
  for (let i = 0; i < lines; i++) {
    const row = [];
    for (let k = 0; k < 14; k++) row.push(vocab[Math.floor(next() * vocab.length)] + Math.floor(next() * 1000));
    rows.push(`<row n="${i}">${row.join(' ')}</row>`);
  }
  return `<rows>\n${rows.join('\n')}\n</rows>`;
}

function transfer(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a && (i === 0 || bytes[i - 1] !== 0x0d)) out.push(0x0d);
    out.push(bytes[i]);
  }
  return Uint8Array.from(out);
}

function pairs(bytes) {
  let n = 0;
  for (let i = 1; i < bytes.length; i++) if (bytes[i] === 0x0a && bytes[i - 1] === 0x0d) n++;
  return n;
}

function pack(entries) {
  const files = {};
  for (const [name, content, level] of entries) {
    files[name] = [typeof content === 'string' ? strToU8(content) : content, { level: level === undefined ? 6 : level, mtime: new Date(2026, 0, 2, 3, 4, 6) }];
  }
  return zipSync(files);
}

function baseEntries() {
  return docxEntries().map(([name, content]) => [name, content, 6]);
}

function withExtra(extra) {
  return pack(baseEntries().concat(extra));
}

function seeded(build, accept) {
  for (let seed = 1; seed < 6000; seed++) {
    const whole = build(seed);
    if (accept(whole, seed)) return { whole, seed };
  }
  throw new Error('no fixture found');
}

function damageOf(whole) {
  return removeAddedCarriageReturns(transfer(whole));
}

async function run(name, bytes) {
  const copy = bytes.slice();
  return runPipeline({ name, size: copy.length, buffer: copy.buffer }, env);
}

function equalParts(a, b) {
  const left = unzipSync(a);
  const right = unzipSync(b);
  const names = Object.keys(right);
  return Object.keys(left).length === names.length && names.every((n) => left[n] && bytesEqual(left[n], right[n]));
}

test('crc math: combine, shift and one-byte shift agree with direct crc', () => {
  const a = noiseBytes(1000, 1, 5);
  const b = noiseBytes(333, 2, 3);
  const joined = new Uint8Array(1333);
  joined.set(a);
  joined.set(b, 1000);
  eq(crcCombine(crc32(a), crc32(b), 333), crc32(joined));
  eq(crcShift(crc32(a), 1), crcShiftOne(crc32(a)));
  eq(crcShift(0, 77), 0);
});

test('crlf: the base fixture has no carriage return pair of its own', () => {
  eq(pairs(pack(baseEntries())), 0);
});

for (const [missing, size, feeds] of [[1, 3000, 40], [2, 3000, 40], [2, 20000, 200], [3, 5000, 80], [4, 8000, 90]]) {
  test(`stored: ${missing} lost carriage return${missing > 1 ? 's' : ''} among ${feeds} line feeds are put back by the checksum`, () => {
    const next = lcg(size * 31 + missing);
    const original = noiseBytes(size, size + missing, feeds);
    const at = [];
    for (let i = 0; i < original.length; i++) if (original[i] === 0x0a) at.push(i);
    const picked = [];
    while (picked.length < missing) {
      const candidate = at[Math.floor(next() * at.length)];
      if (!picked.includes(candidate)) picked.push(candidate);
    }
    picked.sort((x, y) => x - y);
    const whole = [];
    const reduced = [];
    for (let i = 0; i < original.length; i++) {
      if (picked.includes(i)) whole.push(0x0d);
      whole.push(original[i]);
      reduced.push(original[i]);
    }
    const target = Uint8Array.from(whole);
    const found = solveStored(Uint8Array.from(reduced), missing, crc32(target), () => true);
    assert(found && bytesEqual(found, target), 'restored bytes match');
  });
}

test('stored: three or more lost carriage returns are not guessed without a structural check', () => {
  const original = noiseBytes(5000, 9, 80);
  const reduced = original.slice();
  eq(solveStored(reduced, 3, crc32(original)), null);
});

test('stored: a wrong checksum finds nothing', () => {
  const original = noiseBytes(3000, 4, 40);
  eq(solveStored(original, 1, 0x12345678), null);
});

test('stored: when every line feed lost its carriage return they are all put back', () => {
  const original = noiseBytes(2000, 11, 30);
  const whole = [];
  for (const b of original) {
    if (b === 0x0a) whole.push(0x0d);
    whole.push(b);
  }
  const target = Uint8Array.from(whole);
  const found = solveStored(original, 30, crc32(target));
  assert(found && bytesEqual(found, target), 'all restored');
});

function crcChunk(type, data) {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

function pngWith(seed, lineFeeds, ownPairs) {
  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const header = new Uint8Array(13);
  header[3] = 1;
  header[7] = 1;
  header[8] = 8;
  const body = noiseBytes(9000, seed, lineFeeds);
  let given = 0;
  for (let i = 1; i < body.length && given < ownPairs; i++) {
    if (body[i] === 0x0a) {
      body[i - 1] = 0x0d;
      given++;
    }
  }
  const parts = [signature, crcChunk('IHDR', header), crcChunk('IDAT', body), crcChunk('IDAT', noiseBytes(4000, seed + 1, 20)), crcChunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

test('png: the chunk structure confirms an intact image and rejects a damaged one', () => {
  const png = pngWith(3, 40, 0);
  assert(pngIntact(png), 'intact');
  const bent = png.slice();
  bent[200] ^= 0x10;
  assert(!pngIntact(bent), 'damaged');
});

test('stored: a PNG with several carriage returns of its own is restored using its chunk checksums', () => {
  const png = pngWith(5, 120, 3);
  assert(pngIntact(png), 'fixture is a valid image');
  const reduced = [];
  for (let i = 0; i < png.length; i++) if (!(png[i] === 0x0d && png[i + 1] === 0x0a)) reduced.push(png[i]);
  const data = Uint8Array.from(reduced);
  const missing = png.length - data.length;
  assert(missing >= 4, 'fixture lost several carriage returns');
  const found = solveStored(data, missing, crc32(png), pngIntact);
  assert(found && bytesEqual(found, png), 'png restored');
});

test('restore: a package with no carriage return pair of its own needs nothing', () => {
  const whole = pack(baseEntries());
  eq(restoreCarriageReturns(damageOf(whole)), null);
  assert(readLayout(damageOf(whole)), 'layout read');
});

test('restore: stored text whose every line ended in CRLF comes back byte for byte', () => {
  const crlf = proseText(3, 30).replace(/\n/g, '\r\n');
  const whole = withExtra([['word/stored.xml', crlf, 0]]);
  const damaged = damageOf(whole);
  const restored = restoreCarriageReturns(damaged);
  assert(restored && restored.restored === 1, 'one entry restored');
  assert(bytesEqual(restored.bytes, whole), 'identical to the original package');
});

test('restore: stored text with a few CRLF among many LF comes back byte for byte', () => {
  const lines = proseText(4, 40).split('\n');
  const mixed = lines.map((line, i) => (i === 9 || i === 27 ? line + '\r\n' : line + '\n')).join('');
  const whole = withExtra([['word/stored.xml', mixed, 0]]);
  const restored = restoreCarriageReturns(damageOf(whole));
  assert(restored && restored.failed === 0, 'restored');
  assert(bytesEqual(restored.bytes, whole), 'identical');
});

for (const [missing, size] of [[1, 2600], [2, 5200]]) {
  test(`restore: a deflated entry that holds ${missing} CRLF pair${missing > 1 ? 's' : ''} in its compressed bytes is restored`, () => {
    const { whole } = seeded(
      (seed) => withExtra([['word/deflated.xml', proseText(seed, size / 10), 6]]),
      (zip) => pairs(zip) === missing
    );
    const reversed = damageOf(whole);
    const restored = restoreCarriageReturns(reversed);
    assert(restored && restored.restored === 1 && restored.failed === 0, 'restored');
    assert(bytesEqual(restored.bytes, whole), 'identical');
  });
}

test('restore: entries of several kinds in one package are all restored', () => {
  const { whole } = seeded(
    (seed) => withExtra([
      ['word/a.xml', proseText(seed, 260), 6],
      ['word/b.xml', proseText(seed + 7, 20).replace(/\n/g, '\r\n'), 0],
      ['word/c.bin', noiseBytes(4000, seed, 30), 0]
    ]),
    (zip) => pairs(zip) >= 20 && pairs(zip) < 60
  );
  const restored = restoreCarriageReturns(damageOf(whole));
  assert(restored && restored.failed === 0, `restored: ${JSON.stringify(restored && { r: restored.restored, f: restored.failed })}`);
  assert(bytesEqual(restored.bytes, whole), 'identical');
});

test('restore: an entry it cannot solve is left alone and the others are still restored', () => {
  const { whole } = seeded(
    (seed) => withExtra([
      ['word/a.xml', proseText(seed, 120).replace(/\n/g, '\r\n'), 0],
      ['word/hard.bin', noiseBytes(30000, seed, 400), 0]
    ]),
    (zip) => pairs(zip) >= 100
  );
  const restored = restoreCarriageReturns(damageOf(whole));
  assert(restored, 'something restored');
  eq(restored.entries, restored.restored + restored.failed);
});

test('restore: a package whose directory is gone is not touched', () => {
  const whole = withExtra([['word/stored.xml', proseText(3, 30).replace(/\n/g, '\r\n'), 0]]);
  const damaged = damageOf(whole).slice(0, whole.length - 60);
  eq(restoreCarriageReturns(damaged), null);
});

test('inflate probe: reports success, the end of the stream and the output', () => {
  const text = strToU8(proseText(2, 50));
  const packed = zipSync({ 'a.txt': [text, { level: 6 }] });
  const nameLength = packed[26] | (packed[27] << 8);
  const dataAt = 30 + nameLength;
  const size = packed[18] | (packed[19] << 8) | (packed[20] << 16) | (packed[21] << 24);
  const stream = packed.subarray(dataAt, dataAt + size);
  const ok = inflateProbe(stream, text.length + 16);
  assert(ok.ok && ok.consumed === stream.length && bytesEqual(ok.out, text), 'whole stream');
  const cut = inflateProbe(stream.subarray(0, stream.length - 20), text.length + 16);
  assert(!cut.ok && cut.errByte >= 0, 'truncated stream fails');
});

test('pipeline: a text-mode transfer over a package with CRLF in stored and deflated parts is fully recovered', async () => {
  const { whole } = seeded(
    (seed) => withExtra([
      ['word/crlf-stored.xml', proseText(seed, 40).replace(/\n/g, '\r\n'), 0],
      ['word/mixed.xml', proseText(seed + 3, 200), 6]
    ]),
    (zip) => pairs(zip) >= 41 && pairs(zip) <= 44
  );
  const transferred = transfer(whole);
  assert(findTextModeTransfer(transferred), 'transfer detected');
  const result = await run('sample.docx', transferred);
  eq(result.outcome, 'repaired');
  assert(result.findings.some((f) => f.code === 'TRANSFER_CRLF_REVERSED'), 'transfer reported');
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const recovered = unzipSync(out);
  const original = unzipSync(whole);
  for (const name of ['word/crlf-stored.xml', 'word/mixed.xml', 'word/document.xml']) {
    const a = recovered[name];
    const b = original[name];
    let at = -1;
    for (let i = 0; a && i < Math.min(a.length, b.length) && at < 0; i++) if (a[i] !== b[i]) at = i;
    assert(a && bytesEqual(a, b), `${name} recovered byte for byte: len ${a && a.length}/${b.length} first diff ${at} findings ${result.findings.map((f) => f.code).join(',')}`);
  }
});

test('pipeline: the finding says how many parts had their own carriage returns put back', async () => {
  const { whole } = seeded(
    (seed) => withExtra([['word/crlf-stored.xml', proseText(seed, 40).replace(/\n/g, '\r\n'), 0]]),
    (zip) => pairs(zip) >= 39
  );
  const result = await run('sample.docx', transfer(whole));
  const finding = result.findings.find((f) => f.code === 'TRANSFER_CRLF_REVERSED');
  assert(finding && finding.data.restored === 1, `restored count: ${JSON.stringify(finding)}`);
});
