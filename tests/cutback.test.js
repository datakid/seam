import { test, assert, eq, env } from './harness.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';
import { docxEntries, xlsxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';

function lcg(seed) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function entrySpan(bytes, name) {
  const target = Array.from(name).map((c) => c.charCodeAt(0));
  for (let i = 0; i + 30 + target.length < bytes.length; i++) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 3 || bytes[i + 3] !== 4) continue;
    const nameLength = bytes[i + 26] | (bytes[i + 27] << 8);
    if (nameLength !== target.length || !target.every((c, k) => bytes[i + 30 + k] === c)) continue;
    const extra = bytes[i + 28] | (bytes[i + 29] << 8);
    const size = (bytes[i + 18] | (bytes[i + 19] << 8) | (bytes[i + 20] << 16) | (bytes[i + 21] << 24)) >>> 0;
    return { start: i + 30 + nameLength + extra, size };
  }
  throw new Error(`no entry ${name}`);
}

function ruined(whole, name, share, length, seed) {
  const next = lcg(seed);
  const out = whole.slice();
  const span = entrySpan(whole, name);
  const from = span.start + Math.floor(span.size * share);
  for (let i = 0; i < length && from + i < span.start + span.size; i++) out[from + i] = Math.floor(next() * 256);
  return out;
}

async function run(name, bytes) {
  const copy = bytes.slice();
  return runPipeline({ name, size: copy.length, buffer: copy.buffer }, env);
}

for (const [label, entries, main, root] of [['docx', docxEntries, 'word/document.xml', '<w:document'], ['xlsx', xlsxEntries, 'xl/worksheets/sheet1.xml', '<worksheet']]) {
  test(`damaged: a ${label} main part whose compressed stream turns to noise keeps the text before the noise`, async () => {
    const whole = pack(entries());
    const original = strFromU8(unzipSync(whole)[main]);
    const first = original.slice(0, Math.floor(original.length * 0.3));
    const words = first.match(/>[^<>]{6,}</g) || [];
    for (let seed = 1; seed <= 40; seed++) {
      const result = await run(`sample.${label}`, ruined(whole, main, 0.5, 100000, seed * 7919));
      assert(result.outcome === 'partial' || result.outcome === 'repaired', `seed ${seed}: ${result.outcome}`);
      const parts = unzipSync(result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes));
      const text = strFromU8(parts[main]);
      assert(text.includes(root), `seed ${seed}: main part kept`);
      for (const w of words.slice(0, 3)) assert(text.includes(w), `seed ${seed}: early text kept`);
    }
  });
}

test('damaged: an untouched package is not affected by the cut-back', async () => {
  const whole = pack(docxEntries());
  const result = await run('sample.docx', whole);
  eq(result.outcome, 'noProblems');
});
