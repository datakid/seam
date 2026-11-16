import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from '../vendor/fflate.module.js';
import { extractText, recall } from '../tools/text-extract.mjs';

function pack(files) {
  const entries = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return zipSync(entries);
}

test('word paragraphs and runs are read in order', () => {
  const xml = '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> big</w:t></w:r></w:p><w:p><w:r><w:t>world &amp; more</w:t></w:r></w:p></w:body></w:document>';
  const { ok, tokens } = extractText(pack({ 'word/document.xml': xml }));
  assert.ok(ok);
  assert.deepEqual(tokens, ['Hello', 'big', 'world', '&', 'more']);
});

test('shared strings, inline strings and numbers come out of cells', () => {
  const sst = '<sst><si><t>alpha</t></si><si><r><t>be</t></r><r><t>ta</t></r></si></sst>';
  const sheet = '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>42</v></c><c r="D1" t="inlineStr"><is><t>inline text</t></is></c><c r=\'E1\' t=\'s\'><v>0</v></c></row></sheetData></worksheet>';
  const { tokens } = extractText(pack({ 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet }));
  assert.deepEqual(tokens, ['alpha', 'beta', '42', 'inline', 'text', 'alpha']);
});

test('slides are read in numeric order', () => {
  const slide = (t) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
  const { tokens } = extractText(pack({ 'ppt/slides/slide10.xml': slide('ten'), 'ppt/slides/slide2.xml': slide('two') }));
  assert.deepEqual(tokens, ['two', 'ten']);
});

test('a broken archive reports not ok', () => {
  assert.equal(extractText(Uint8Array.from([1, 2, 3, 4])).ok, false);
});

test('recall is matched tokens over pristine tokens', () => {
  assert.equal(recall(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']), 1);
  assert.equal(recall(['a', 'b', 'c', 'd'], ['a', 'c']), 0.5);
  assert.equal(recall(['a', 'b', 'c', 'd'], []), 0);
  assert.equal(recall(['a', 'b'], ['x', 'a', 'y', 'b', 'z']), 1);
  assert.equal(recall([], []), 1);
});

test('recall falls back to a greedy match on very different inputs', () => {
  const a = Array.from({ length: 6000 }, (_, i) => `a${i}`);
  const b = Array.from({ length: 6000 }, (_, i) => `b${i}`).concat(a.slice(0, 3000));
  const r = recall(a, b);
  assert.ok(r >= 0.49 && r <= 0.51, String(r));
});
