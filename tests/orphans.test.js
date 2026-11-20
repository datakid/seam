import { test, assert, eq, bytesEqual, env } from './harness.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';
import { prng, words, randomBytes, docxEntries, xlsxEntries, pptxEntries, pack, unpack } from './fixtures.js';
import { localEntry, deleteDirectory } from './corrupt.js';
import { strictRead } from '../js/core/zip-read.js';
import { recoverEntries } from '../js/core/zip-recover.js';
import { findOrphans } from '../js/core/zip-orphans.js';
import { identifyContent } from '../js/core/orphan-kinds.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';
import { KINDS, damage } from '../tools/damage.mjs';

const FORMATS = { docx: docxEntries, xlsx: xlsxEntries, pptx: pptxEntries };
const enc = (text) => new TextEncoder().encode(text);

function zeroHeader(bytes, name) {
  const info = localEntry(bytes, name);
  const out = bytes.slice();
  out.fill(0, info.header, info.dataStart);
  return out;
}

function bigDocx(count = 400) {
  const paragraphs = [];
  for (let i = 0; i < count; i++) paragraphs.push(`<w:p><w:r><w:t>${words(900 + i, 8)} ${i}</w:t></w:r></w:p>`);
  return pack(docxEntries(false).map(([name, content]) => (name === 'word/document.xml' ? [name, content.replace('<w:body>', `<w:body>${paragraphs.join('')}`)] : [name, content])));
}

function runsOf(bytes) {
  const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
  return Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g), (m) => m[1]);
}

async function run(name, bytes) {
  const main = bytes.slice();
  return runPipeline({ name, size: main.length, buffer: main.buffer }, env);
}

function codes(result) {
  return result.findings.map((f) => f.code);
}

async function verified(result, key) {
  assert(result.output, `no output: ${result.outcome} ${JSON.stringify(codes(result))}`);
  const bytes = new Uint8Array(result.output.bytes);
  const verdict = await verifyPackage(bytes, env, { key, ext: key });
  assert(verdict.ok, `verification failed: ${JSON.stringify(verdict.failed)}`);
  return unzipSync(bytes);
}

for (const [format, build] of Object.entries(FORMATS)) {
  test(`orphans: ${format} with a destroyed local header and an intact directory returns every part byte-identical`, () => {
    const original = pack(build());
    const expected = new Map(unpack(original));
    for (const [name] of unpack(original)) {
      if (expected.get(name).length < 2) continue;
      const broken = zeroHeader(original, name);
      assert(!strictRead(broken, 0).intact, `${name}: strict should fail`);
      const result = recoverEntries(broken, strictRead(broken, 0).entries);
      const got = result.entries.find((e) => e.name === name);
      assert(got && got.state === 'ok', `${name}: ${got && got.state}`);
      assert(bytesEqual(got.data, expected.get(name)), `${name}: bytes differ`);
    }
  });

  test(`orphans: ${format} with a destroyed local header and no directory yields one orphan with the exact bytes`, () => {
    const original = pack(build());
    const expected = new Map(unpack(original));
    for (const [name, data] of unpack(original)) {
      if (data.length < 16) continue;
      const broken = deleteDirectory(zeroHeader(original, name));
      const result = recoverEntries(broken);
      eq(result.orphans.length, 1, `${name}: orphans`);
      assert(bytesEqual(result.orphans[0].data, data), `${name}: orphan bytes differ`);
      assert(!result.entries.some((e) => e.name === name), `${name}: still listed`);
      for (const [other, otherData] of expected) {
        if (other === name || otherData.length === 0) continue;
        const e = result.entries.find((x) => x.name === other);
        assert(e && e.state === 'ok' && bytesEqual(e.data, otherData), `${other} lost`);
      }
    }
  });
}

test('orphans: random bytes between parts never become an orphan and the parts stay intact', () => {
  const original = bigDocx(300);
  const at = localEntry(original, 'word/document.xml').header;
  for (let seed = 1; seed <= 12; seed++) {
    const noise = randomBytes(seed, 200 + seed * 400);
    const broken = new Uint8Array(original.length + noise.length);
    broken.set(original.subarray(0, at), 0);
    broken.set(noise, at);
    broken.set(original.subarray(at), at + noise.length);
    const result = recoverEntries(broken);
    eq(result.orphans.length, 0, `seed ${seed}`);
    assert(result.entries.every((e) => e.state === 'ok'), `seed ${seed}: entries`);
  }
});

test('orphans: a large gap of random bytes is scanned within the time limit and gives nothing', () => {
  const noise = randomBytes(5, 4 * 1024 * 1024);
  const started = Date.now();
  const orphans = findOrphans(noise, [], noise.length);
  assert(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
  eq(orphans.length, 0);
});

test('orphans: zero runs and repeated bytes are not mistaken for streams', () => {
  const zeros = new Uint8Array(100000);
  eq(findOrphans(zeros, [], zeros.length).length, 0);
  const fill = new Uint8Array(100000).fill(0x55);
  eq(findOrphans(fill, [], fill.length).length, 0);
});

test('orphans: content is identified by root element and magic bytes', () => {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const s = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const cases = [
    [`<?xml version="1.0"?>\n<w:document xmlns:w="${w}"/>`, 'word/document.xml'],
    [`<w:styles xmlns:w="${w}"/>`, 'word/styles.xml'],
    [`<workbook xmlns="${s}"/>`, 'xl/workbook.xml'],
    [`<styleSheet xmlns="${s}"/>`, 'xl/styles.xml'],
    [`<p:presentation xmlns:p="${p}"/>`, 'ppt/presentation.xml'],
    [`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`, '[Content_Types].xml'],
    [`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`, '_rels/.rels'],
    [`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`, 'xl/_rels/workbook.xml.rels']
  ];
  for (const [text, path] of cases) eq(identifyContent(enc(text)).path, path, text.slice(0, 60));
  eq(identifyContent(enc(`<worksheet xmlns="${s}"/>`)).kind, 'xlWorksheet');
  eq(identifyContent(enc(`<p:sld xmlns:p="${p}"/>`)).kind, 'pptSlide');
  eq(identifyContent(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])).kind, 'png');
  eq(identifyContent(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])).kind, 'jpeg');
  eq(identifyContent(enc('just some notes')).kind, 'unknown');
  eq(identifyContent(enc('<other xmlns="urn:x"/>')).kind, 'xml');
});

test('orphans: a document whose main part lost its header and the directory comes back with every text run', async () => {
  const original = bigDocx(500);
  const expected = runsOf(original);
  const broken = deleteDirectory(zeroHeader(original, 'word/document.xml'));
  const result = await run('Letter.docx', broken);
  eq(result.outcome, 'repaired', JSON.stringify(codes(result)));
  const named = result.findings.filter((f) => f.code === 'ZIP_ORPHAN_NAMED');
  eq(named.map((f) => f.part), ['word/document.xml']);
  eq(named[0].severity, 'repaired');
  const out = await verified(result, 'docx');
  eq(Array.from(strFromU8(out['word/document.xml']).matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g), (m) => m[1]), expected);
});

test('orphans: a part whose header is gone but whose directory entry survives is restored without an orphan finding', async () => {
  const original = bigDocx(200);
  const expected = runsOf(original);
  const broken = zeroHeader(original, 'word/document.xml');
  const result = await run('Letter.docx', broken);
  eq(result.outcome, 'repaired', JSON.stringify(codes(result)));
  assert(!codes(result).includes('ZIP_ORPHAN_NAMED'), 'named through the directory, not by content');
  assert(!result.findings.some((f) => f.severity === 'loss'), 'no loss');
  const out = await verified(result, 'docx');
  eq(Array.from(strFromU8(out['word/document.xml']).matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g), (m) => m[1]), expected);
});

test('orphans: the relationships and the picture of a document are named from their content when they are referenced', async () => {
  const original = pack(docxEntries());
  for (const name of ['word/_rels/document.xml.rels', 'word/media/image1.png', 'word/styles.xml']) {
    const broken = deleteDirectory(zeroHeader(original, name));
    const result = await run('Letter.docx', broken);
    const named = result.findings.filter((f) => f.code === 'ZIP_ORPHAN_NAMED').map((f) => f.part);
    eq(named, [name], `${name}: ${JSON.stringify(codes(result))}`);
    eq(result.outcome, 'repaired', `${name}: ${result.outcome}`);
    const out = await verified(result, 'docx');
    assert(out[name], `${name} present`);
  }
});

test('orphans: a worksheet is placed at the one sheet path that is referenced and free', async () => {
  const original = pack(xlsxEntries());
  const broken = deleteDirectory(zeroHeader(original, 'xl/worksheets/sheet2.xml'));
  const result = await run('Book.xlsx', broken);
  eq(result.findings.filter((f) => f.code === 'ZIP_ORPHAN_NAMED').map((f) => f.part), ['xl/worksheets/sheet2.xml']);
  eq(result.outcome, 'repaired', JSON.stringify(codes(result)));
  const out = await verified(result, 'xlsx');
  eq(strFromU8(out['xl/worksheets/sheet2.xml']), strFromU8(new Map(unpack(original)).get('xl/worksheets/sheet2.xml')));
});

test('orphans: two missing sheets are ambiguous, so both are kept under seam-recovered and nothing is guessed', async () => {
  const original = pack(xlsxEntries());
  const broken = deleteDirectory(zeroHeader(zeroHeader(original, 'xl/worksheets/sheet2.xml'), 'xl/worksheets/sheet1.xml'));
  const result = await run('Book.xlsx', broken);
  const kept = result.findings.filter((f) => f.code === 'ZIP_ORPHAN_KEPT');
  eq(kept.map((f) => f.part).sort(), ['seam-recovered/part1.xml', 'seam-recovered/part2.xml']);
  assert(kept.every((f) => f.severity === 'noted'), 'noted');
  eq(result.findings.filter((f) => f.code === 'ZIP_ORPHAN_NAMED').length, 0);
});

test('orphans: a part of an unknown kind is kept at a recovered path and reported', async () => {
  const entries = docxEntries();
  entries.push(['custom/notes.txt', enc(`${words(3, 60)} meeting notes`)]);
  const original = pack(entries);
  const broken = deleteDirectory(zeroHeader(original, 'custom/notes.txt'));
  const result = await run('Letter.docx', broken);
  eq(result.findings.filter((f) => f.code === 'ZIP_ORPHAN_KEPT').map((f) => f.part), ['seam-recovered/part1.bin']);
  const out = await verified(result, 'docx');
  assert(bytesEqual(out['seam-recovered/part1.bin'], enc(`${words(3, 60)} meeting notes`)), 'bytes kept');
});

test('orphans: damage that leaves every header alone adds no orphan finding', async () => {
  const original = bigDocx(300);
  const random = prng(4);
  for (let seed = 0; seed < 4; seed++) {
    const info = localEntry(original, 'word/document.xml');
    const broken = original.slice();
    const at = info.dataStart + Math.floor(random() * (info.csize - 600));
    broken.fill(0, at, at + 512);
    const result = await run('Letter.docx', broken);
    assert(!codes(result).includes('ZIP_ORPHAN_NAMED') && !codes(result).includes('ZIP_ORPHAN_KEPT'), JSON.stringify(codes(result)));
  }
});

test('orphans: under every damage kind a part named from its content is a part of the original, and unharmed kinds return it byte for byte', async () => {
  for (const [format, build] of Object.entries(FORMATS)) {
    const original = pack(build());
    const parts = new Map(unpack(original));
    for (const kind of KINDS) {
      for (let seed = 1; seed <= 8; seed++) {
        const broken = damage(original, kind, seed, kind === 'concat' ? { other: pack(docxEntries()) } : null).bytes;
        const result = await run(`File.${format}`, broken);
        for (const f of result.findings.filter((x) => x.code === 'ZIP_ORPHAN_NAMED')) {
          assert(parts.has(f.part), `${format} ${kind} ${seed}: ${f.part} is not an original part`);
          if (kind === 'bitflip' || !result.output) continue;
          const out = unzipSync(new Uint8Array(result.output.bytes));
          assert(out[f.part] && bytesEqual(out[f.part], parts.get(f.part)), `${format} ${kind} ${seed}: ${f.part} differs`);
        }
      }
    }
  }
});
