import { test, assert, eq, env } from './harness.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';
import { prng, words, randomBytes, docxEntries, pack } from './fixtures.js';
import { localEntry, truncate, deleteDirectory } from './corrupt.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';
import { mergeCopies } from '../js/core/zip-recover.js';

function variant(count, seedBase) {
  const paragraphs = [];
  for (let i = 0; i < count; i++) {
    const text = `${words(seedBase + i, 8)} ${1000 + i}`;
    paragraphs.push(`<w:p w14:paraId="${(0x10000000 + i * 7919).toString(16)}"><w:r><w:t>${text}</w:t></w:r></w:p>`);
  }
  const entries = docxEntries(false).map(([name, content]) => {
    if (name !== 'word/document.xml') return [name, content];
    return [name, content.replace('<w:document', '<w:document xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"').replace('<w:body>', `<w:body>${paragraphs.join('')}`)];
  });
  return pack(entries);
}

function textRuns(xml) {
  const out = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function runsOf(bytes) {
  return textRuns(strFromU8(unzipSync(bytes)['word/document.xml']));
}

function zeroIn(bytes, name, fraction, length) {
  const entry = localEntry(bytes, name);
  const out = bytes.slice();
  const at = entry.dataStart + Math.max(0, Math.min(entry.csize - length, Math.floor(entry.csize * fraction)));
  out.fill(0, at, at + Math.min(length, entry.csize));
  return out;
}

function flipIn(bytes, name, fraction, length) {
  const entry = localEntry(bytes, name);
  const out = bytes.slice();
  const at = entry.dataStart + Math.max(0, Math.min(entry.csize - length, Math.floor(entry.csize * fraction)));
  for (let i = 0; i < length; i++) out[at + i] ^= 0xff;
  return out;
}

async function run(name, bytes, copies = []) {
  const main = bytes.slice();
  const extra = copies.map((c) => ({ name: c.name, buffer: c.bytes.slice().buffer }));
  return runPipeline({ name, size: main.length, buffer: main.buffer, copies: extra }, env);
}

function codes(result) {
  return result.findings.map((f) => f.code);
}

function lossCount(result) {
  return result.findings.filter((f) => f.severity === 'loss').length;
}

async function verified(result) {
  assert(result.output, `no output: ${result.outcome} ${JSON.stringify(codes(result))}`);
  const bytes = new Uint8Array(result.output.bytes);
  const verdict = await verifyPackage(bytes, env, { key: 'docx', ext: 'docx' });
  assert(verdict.ok, `verification failed: ${JSON.stringify(verdict.failed)}`);
  return bytes;
}

function entry(name, state, data, extra = {}) {
  return { name, state, data, mtime: null, expectedSize: data.length, ...extra };
}

test('copies: a part damaged in one copy comes from the other and the file reaches Repaired with every text run', async () => {
  const original = variant(3000, 500);
  const expected = runsOf(original);
  const a = zeroIn(original, 'word/document.xml', 0.3, 512);
  const b = flipIn(zeroIn(original, 'word/styles.xml', 0.4, 16), 'word/media/image1.png', 0.5, 16);
  const alone = await run('File.docx', a);
  eq(alone.outcome, 'partial');
  const result = await run('File.docx', a, [{ name: 'Backup.docx', bytes: b }]);
  eq(result.outcome, 'repaired');
  eq(lossCount(result), 0);
  const from = result.findings.filter((f) => f.code === 'MULTI_PART_FROM');
  assert(from.some((f) => f.part === 'word/document.xml' && f.data.from === 'Backup.docx'), JSON.stringify(from));
  assert(from.every((f) => f.severity === 'noted'), 'noted severity');
  const out = await verified(result);
  eq(runsOf(out), expected);
});

test('copies: the order of the copies does not matter', async () => {
  const original = variant(3000, 500);
  const expected = runsOf(original);
  const a = zeroIn(original, 'word/document.xml', 0.6, 1024);
  const b = flipIn(original, 'word/media/image1.png', 0.5, 16);
  for (const [first, second] of [[a, b], [b, a]]) {
    const result = await run('File.docx', first, [{ name: 'Other.docx', bytes: second }]);
    eq(result.outcome, 'repaired');
    eq(runsOf(await verified(result)), expected);
  }
});

test('copies: two copies damaged with different seeds reach Repaired with every text run', async () => {
  const original = variant(2500, 700);
  const expected = runsOf(original);
  const others = ['word/styles.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/media/image1.png'];
  const lengths = [64, 512, 2048];
  for (let seed = 1; seed <= 8; seed++) {
    const random = prng(seed);
    const a = zeroIn(original, 'word/document.xml', 0.1 + random() * 0.8, lengths[Math.floor(random() * lengths.length)]);
    const part = others[Math.floor(random() * others.length)];
    const b = random() < 0.5 ? zeroIn(original, part, 0.2 + random() * 0.5, 12) : flipIn(original, part, 0.2 + random() * 0.5, 12);
    const result = await run('File.docx', a, [{ name: 'Second.docx', bytes: b }]);
    assert(['repaired', 'noProblems'].includes(result.outcome), `seed ${seed} ${part}: ${result.outcome} ${JSON.stringify(codes(result))}`);
    eq(runsOf(await verified(result)), expected, `seed ${seed} text`);
  }
});

test('copies: a truncated file and a complete copy give Repaired and no cut-short finding', async () => {
  const original = variant(3000, 500);
  const expected = runsOf(original);
  for (const fraction of [0.5, 0.9]) {
    const cut = truncate(original, fraction);
    const alone = await run('File.docx', cut);
    assert(['partial', 'salvaged'].includes(alone.outcome), `alone ${alone.outcome}`);
    const result = await run('File.docx', cut, [{ name: 'Full.docx', bytes: deleteDirectory(original) }]);
    eq(result.outcome, 'repaired', `${fraction} ${JSON.stringify(codes(result))}`);
    assert(!codes(result).includes('ZIP_ENDS_EARLY'), 'cut-short finding');
    eq(runsOf(await verified(result)), expected);
  }
});

test('copies: a copy that is not a package is ignored and reported', async () => {
  const original = variant(1500, 500);
  const a = zeroIn(original, 'word/document.xml', 0.3, 512);
  const alone = await run('File.docx', a);
  const result = await run('File.docx', a, [{ name: 'Notes.docx', bytes: new TextEncoder().encode('%PDF-1.7 not a package') }]);
  eq(result.outcome, alone.outcome);
  const unused = result.findings.filter((f) => f.code === 'MULTI_COPY_UNUSED');
  eq(unused.length, 1);
  eq(unused[0].data, { name: 'Notes.docx', why: 'unreadable' });
  assert(unused[0].text.includes('Notes.docx'), unused[0].text);
});

test('copies: a different version of the document is refused and nothing is mixed in', async () => {
  const one = variant(2000, 500);
  const two = variant(2000, 9000);
  const a = zeroIn(one, 'word/document.xml', 0.4, 512);
  const alone = await run('File.docx', a);
  const result = await run('File.docx', a, [{ name: 'Newer.docx', bytes: two }]);
  eq(result.outcome, alone.outcome);
  const unused = result.findings.filter((f) => f.code === 'MULTI_COPY_UNUSED');
  eq(unused.map((f) => f.data.why), ['different']);
  assert(!codes(result).includes('MULTI_PART_FROM'), 'part taken from a different version');
  const otherRuns = new Set(runsOf(two));
  const mine = new Set(runsOf(one));
  for (const t of runsOf(new Uint8Array(result.output.bytes))) {
    if (otherRuns.has(t)) assert(mine.has(t), `text from the other version: ${t}`);
  }
});

test('copies: an identical copy changes nothing and is reported as unused', async () => {
  const original = variant(1500, 500);
  const a = zeroIn(original, 'word/document.xml', 0.3, 512);
  const alone = await run('File.docx', a);
  const result = await run('File.docx', a, [{ name: 'Same.docx', bytes: a }]);
  eq(result.outcome, alone.outcome);
  eq(result.findings.filter((f) => f.code === 'MULTI_COPY_UNUSED').map((f) => f.data.why), ['unused']);
  assert(!codes(result).includes('MULTI_PART_FROM'), 'nothing to take');
});

test('copies: the same part damaged in both copies still gives an output and no internal error', async () => {
  const original = variant(2500, 500);
  const a = zeroIn(original, 'word/document.xml', 0.2, 512);
  const b = zeroIn(original, 'word/document.xml', 0.7, 512);
  const result = await run('File.docx', a, [{ name: 'Second.docx', bytes: b }]);
  assert(result.output, `no output ${result.outcome}`);
  assert(!codes(result).includes('INTERNAL_ERROR'), 'internal error');
  const out = await verified(result);
  const expected = new Set(runsOf(original));
  const runs = runsOf(out);
  assert(runs.length > expected.size * 0.5, `kept ${runs.length} of ${expected.size}`);
});

test('mergeCopies: ties keep the earlier copy and a strictly better part comes from the later one', () => {
  const bytes = randomBytes(1, 400);
  const first = [entry('a.bin', 'ok', bytes), entry('b.bin', 'partial', bytes.slice(0, 100)), entry('c.bin', 'ok', bytes.slice(0, 50))];
  const second = [entry('a.bin', 'ok', bytes), entry('B.bin', 'ok', bytes), entry('d.bin', 'ok', bytes.slice(0, 20))];
  const merged = mergeCopies([first, second]);
  eq(merged.used, [true, true]);
  eq(merged.entries.map((e) => `${e.name}:${e.copy}`), ['a.bin:0', 'B.bin:1', 'c.bin:0', 'd.bin:1']);
});

test('mergeCopies: a copy with no part verified identical is not used', () => {
  const first = [entry('a.bin', 'partial', randomBytes(1, 400)), entry('b.bin', 'unreadable', new Uint8Array(0))];
  const second = [entry('a.bin', 'ok', randomBytes(2, 400)), entry('b.bin', 'ok', randomBytes(3, 400))];
  const merged = mergeCopies([first, second]);
  eq(merged.used, [true, false]);
  eq(merged.entries.map((e) => e.copy), [0, 0]);
});

test('mergeCopies: two intact parts that differ mark the copy as a different version', () => {
  const first = [entry('a.bin', 'ok', randomBytes(1, 400)), entry('b.bin', 'ok', randomBytes(4, 400))];
  const second = [entry('a.bin', 'ok', randomBytes(1, 400)), entry('b.bin', 'ok', randomBytes(5, 400))];
  eq(mergeCopies([first, second]).used, [true, false]);
});

test('mergeCopies: the known bytes of a damaged part must match the intact copy', () => {
  const good = randomBytes(1, 9000);
  const head = good.slice(0, 6000);
  const stranger = randomBytes(9, 6000);
  stranger.set(good.slice(0, 300), 0);
  const shared = entry('s.bin', 'ok', randomBytes(6, 300));
  const agree = mergeCopies([[entry('a.bin', 'partial', head), shared], [entry('a.bin', 'ok', good), shared]]);
  eq(agree.used, [true, true]);
  eq(agree.entries[0].copy, 1);
  const clash = mergeCopies([[entry('a.bin', 'partial', stranger), shared], [entry('a.bin', 'ok', good), shared]]);
  eq(clash.used, [true, false]);
  eq(clash.entries[0].copy, 0);
});

test('mergeCopies: a damaged part that is mostly garbage but shares a long run with the copy is not a conflict', () => {
  const good = randomBytes(1, 9000);
  const garbled = good.slice(0, 6000);
  const noise = randomBytes(4, 4000);
  garbled.set(noise, 2000);
  const shared = entry('s.bin', 'ok', randomBytes(6, 300));
  eq(mergeCopies([[entry('a.bin', 'partial', garbled), shared], [entry('a.bin', 'ok', good), shared]]).used, [true, true]);
});

test('mergeCopies: bytes after a hole are compared as well', () => {
  const good = randomBytes(1, 9000);
  const shared = entry('s.bin', 'ok', randomBytes(6, 300));
  const same = good.slice();
  same.fill(0, 0, 1000);
  const agree = entry('a.bin', 'partial', new Uint8Array(0), { holes: [[0, 1000]], whole: same });
  eq(mergeCopies([[agree, shared], [entry('a.bin', 'ok', good), shared]]).used, [true, true]);
  const other = randomBytes(8, 9000);
  other.fill(0, 0, 1000);
  const clash = entry('a.bin', 'partial', new Uint8Array(0), { holes: [[0, 1000]], whole: other });
  eq(mergeCopies([[clash, shared], [entry('a.bin', 'ok', good), shared]]).used, [true, false]);
});

test('mergeCopies: a copy that is empty or unreadable never contributes', () => {
  const first = [entry('a.bin', 'ok', randomBytes(1, 100))];
  const merged = mergeCopies([first, [], first.map((e) => ({ ...e }))]);
  eq(merged.used, [true, false, true]);
});
