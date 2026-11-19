import { test, assert, eq, bytesEqual } from './harness.js';
import { Zip, ZipDeflate } from '../vendor/fflate.module.js';
import { docx, xlsx, pptx, docm, unpack, words } from './fixtures.js';
import { deleteDirectory, prefixRandom, truncate, localEntry } from './corrupt.js';
import { identify } from '../js/core/identify.js';
import { strictRead, normalizeName } from '../js/core/zip-read.js';
import { recoverEntries, mergeEntries } from '../js/core/zip-recover.js';
import { writeZip } from '../js/core/zip-write.js';
import { crc32 } from '../js/core/crc32.js';

const BUILDERS = { docx, xlsx, pptx, docm };

function streamed(entries) {
  const chunks = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  for (const [name, data] of entries) {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(data, true);
  }
  zip.end();
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function sameParts(recovered, original) {
  const map = new Map(recovered.map((e) => [e.name, e]));
  for (const [name, data] of original) {
    const entry = map.get(name);
    assert(entry, `missing ${name}`);
    assert(entry.state === 'ok', `${name} state ${entry.state}`);
    assert(bytesEqual(entry.data, data), `${name} differs`);
  }
}

test('crc32 matches the known check value', () => {
  eq(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

for (const name of ['docx', 'xlsx', 'pptx', 'docm']) {
  test(`strict read: ${name} is intact`, () => {
    const read = strictRead(BUILDERS[name](), 0);
    assert(read.intact, `errors: ${read.errors}`);
  });
}

test('C16: an untouched file is intact under the strict read', () => {
  for (const build of [docx, xlsx, pptx]) assert(strictRead(build(), 0).intact, 'intact');
});

test('C2: central directory removed, recovery returns every part byte-identical', () => {
  for (const name of ['docx', 'xlsx', 'pptx']) {
    const original = BUILDERS[name]();
    const broken = deleteDirectory(original);
    assert(!strictRead(broken, 0).intact, 'strict should fail');
    const result = recoverEntries(broken);
    sameParts(result.entries, unpack(original));
    assert(!result.endsEarly, 'a removed directory is not flagged as cut short');
  }
});

test('C17: docm with the directory removed keeps vbaProject.bin byte-identical', () => {
  const original = docm();
  const result = recoverEntries(deleteDirectory(original));
  sameParts(result.entries, unpack(original));
  assert(result.entries.some((e) => e.name === 'word/vbaProject.bin'), 'vbaProject.bin present');
});

test('C3: 512 random bytes in front are detected and the strict read works with the offset', () => {
  const original = docx();
  const prefixed = prefixRandom(original);
  const id = identify(prefixed);
  eq(id.prefixGarbage, 512);
  const read = strictRead(prefixed, id.prefix);
  assert(read.intact, `prefixed strict read: ${read.errors}`);
  sameParts(read.entries, unpack(original));
  sameParts(recoverEntries(prefixed).entries, unpack(original));
});

test('C1: truncation produces partial entries or an early end', () => {
  for (const name of ['docx', 'xlsx', 'pptx']) {
    for (const fraction of [0.5, 0.75, 0.9, 0.99]) {
      const broken = truncate(BUILDERS[name](), fraction);
      assert(!strictRead(broken, 0).intact, 'strict should fail');
      const result = recoverEntries(broken);
      const flagged = result.endsEarly || result.entries.some((e) => e.state === 'partial' || e.state === 'unreadable');
      assert(flagged, `${name} ${fraction} not flagged`);
    }
  }
});

test('truncation inside the last stored entry reports a partial prefix', () => {
  const original = docx();
  const info = localEntry(original, 'word/media/image1.png');
  const broken = original.slice(0, info.dataStart + 30);
  const result = recoverEntries(broken);
  const png = result.entries.find((e) => e.name === 'word/media/image1.png');
  eq(png.state, 'partial');
  eq(png.data.length, 30);
});

test('bit flip in a stored entry gives crcMismatch and keeps the data', () => {
  const original = docx();
  const info = localEntry(original, 'word/media/image1.png');
  const broken = original.slice();
  broken[info.dataStart + 40] ^= 0xff;
  const read = strictRead(broken, 0);
  assert(!read.intact, 'strict should fail');
  eq(read.entries.find((e) => e.name === 'word/media/image1.png').state, 'crcMismatch');
  const result = recoverEntries(broken);
  eq(result.entries.find((e) => e.name === 'word/media/image1.png').state, 'crcMismatch');
});

test('bit flips inside a deflate stream keep the bytes produced so far', () => {
  const original = docx();
  const info = localEntry(original, 'word/document.xml');
  const broken = original.slice();
  const start = info.dataStart + Math.floor(info.csize / 2) - 32;
  for (let i = 0; i < 64; i++) broken[start + i] ^= 0xff;
  const result = recoverEntries(broken);
  const part = result.entries.find((e) => e.name === 'word/document.xml');
  assert(part.state === 'partial' || part.state === 'crcMismatch', `state ${part.state}`);
  assert(part.data.length > 0, 'some bytes recovered');
});

test('data descriptors: streamed archives recover without a directory', () => {
  const entries = [['a.txt', new TextEncoder().encode(words(1, 400))], ['b/c.xml', new TextEncoder().encode('<r>' + words(2, 300) + '</r>')], ['empty.txt', new Uint8Array(0)]];
  const archive = streamed(entries);
  assert(strictRead(archive, 0).intact, 'strict read of streamed archive');
  const eocd = archive.length - 22;
  let cd = -1;
  for (let i = eocd; i >= 0; i--) {
    if (archive[i] === 0x50 && archive[i + 1] === 0x4b && archive[i + 2] === 1 && archive[i + 3] === 2) cd = i;
    if (archive[i] === 0x50 && archive[i + 1] === 0x4b && archive[i + 2] === 7 && archive[i + 3] === 8) break;
  }
  const result = recoverEntries(archive.slice(0, cd));
  const names = result.entries.map((e) => e.name);
  assert(names.includes('a.txt') && names.includes('b/c.xml'), `names ${names}`);
  for (const [name, data] of entries.filter(([n]) => n !== 'empty.txt')) {
    const entry = result.entries.find((e) => e.name === name);
    eq(entry.state, 'ok');
    assert(bytesEqual(entry.data, data), `${name} bytes`);
  }
});

test('names: backslashes, leading slash and dot segments are normalised; dot-dot is rejected', () => {
  eq(normalizeName('word\\media\\image1.png'), 'word/media/image1.png');
  eq(normalizeName('/word/document.xml'), 'word/document.xml');
  eq(normalizeName('./word/./document.xml'), 'word/document.xml');
  eq(normalizeName('../evil.xml'), null);
  eq(normalizeName('word/../../evil.xml'), null);
  eq(normalizeName('word/'), 'word/');
});

test('merge: ok beats crcMismatch beats partial, an ok central copy keeps a tie', () => {
  const a = { name: 'x', state: 'partial', data: new Uint8Array(5) };
  const b = { name: 'X', state: 'ok', data: new Uint8Array(3) };
  const c = { name: 'y', state: 'ok', data: new Uint8Array(1) };
  const d = { name: 'y', state: 'ok', data: new Uint8Array(2) };
  const merged = mergeEntries([a, c], [b, d]);
  eq(merged.length, 2);
  eq(merged[0].state, 'ok');
  eq(merged[1].data.length, 1);
});

test('writeZip: Content_Types first, then root rels, then original order; reads back strictly', () => {
  const parts = unpack(docx()).reverse().map(([name, data]) => ({ name, data, mtime: new Date(2026, 1, 3) }));
  const bytes = writeZip(parts);
  const read = strictRead(bytes, 0);
  assert(read.intact, 'intact');
  eq(read.entries[0].name, '[Content_Types].xml');
  eq(read.entries[1].name, '_rels/.rels');
  const png = localEntry(bytes, 'word/media/image1.png');
  eq(png.csize, png.usize);
});
