import { test, assert, eq, env } from './harness.js';
import { docxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { packageFits, loadSchemaTable, PART_LIMIT } from '../js/core/schema-check.js';
import { SCHEMA_LITE } from '../js/core/data/schema-lite.js';
import { TIER_CONTENT, TIER_STRUCTURAL } from '../js/core/tiers.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';
import { parseTree } from '../js/core/xml-repair.js';
import { checkTree } from '../js/core/schema-fit.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const doc = (body) => `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
const ctxOf = (parts) => ({ parts: new Map(parts.map(([name, text]) => [name, { name, text, isXml: typeof text === 'string' }])) });

test('schema check: a part that follows the schema fits', () => {
  assert(packageFits(ctxOf([['word/document.xml', doc('<w:p><w:r><w:t>text</w:t></w:r></w:p><w:sectPr/>')]]), SCHEMA_LITE), 'fits');
});

test('schema check: children out of order do not fit', () => {
  assert(!packageFits(ctxOf([['word/document.xml', doc('<w:sectPr/><w:p/>')]]), SCHEMA_LITE), 'sectPr must come last');
});

test('schema check: a required child that is missing does not fit', () => {
  const theme = `<a:theme xmlns:a="${A}" name="t"><a:themeElements/></a:theme>`;
  assert(!packageFits(ctxOf([['ppt/theme/theme1.xml', theme]]), SCHEMA_LITE), 'themeElements needs its three schemes');
});

test('schema check: one part that does not fit is enough, however many do', () => {
  const parts = [['word/a.xml', doc('<w:p/>')], ['word/b.xml', doc('<w:p/>')], ['word/c.xml', doc('<w:sectPr/><w:p/>')]];
  assert(!packageFits(ctxOf(parts), SCHEMA_LITE), 'the third breaks it');
});

test('schema check: a part in a namespace the table does not know passes through, and so do parts that are not XML', () => {
  const parts = [['x/other.xml', '<q:x xmlns:q="urn:none"><q:y/></q:x>'], ['media/a.png', null]];
  assert(packageFits(ctxOf(parts), SCHEMA_LITE), 'nothing to say about it');
});

test('schema check: without a table, or with a part too large to check, it does not claim a fit', () => {
  const ok = ctxOf([['word/document.xml', doc('<w:p/>')]]);
  assert(!packageFits(ok, null), 'no table');
  assert(!packageFits(ok, {}), 'not a table');
  const big = ctxOf([['word/big.xml', `<q:x xmlns:q="urn:none"/>${' '.repeat(PART_LIMIT)}`]]);
  assert(!packageFits(big, SCHEMA_LITE), 'too large');
});

test('schema check: a table given by the environment wins, and null means there is none', async () => {
  eq(await loadSchemaTable({ schemaTable: null }), null);
  eq(await loadSchemaTable({ schemaTable: 'x' }), 'x');
  assert((await loadSchemaTable({})).elements, 'the shipped table by default');
});

function failing(result) {
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const names = [];
  for (const [name, bytes] of Object.entries(unzipSync(out))) {
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const found = checkTree(SCHEMA_LITE, parseTree(strFromU8(bytes)), 1).findings;
    if (found.length > 0) names.push(`${name}: ${found[0].kind} ${found[0].name} ${found[0].found || ''}`);
  }
  return names;
}

test('schema check: a repaired package whose parts all fit the schema reaches tier 2, and one with a part that does not stays at tier 1', async () => {
  const clean = docxEntries().map(([name, content]) => (name === 'word/document.xml' ? [name, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${doc('<w:p><w:r><w:t>One paragraph.</w:t></w:r></w:p><w:sectPr/>')}`] : [name, content]));
  const whole = pack(clean);
  const cut = whole.slice(0, whole.length - 30);
  const result = await runPipeline({ name: 'c.docx', size: cut.length, buffer: cut.slice().buffer }, env);
  assert(result.output, 'output produced');
  eq(failing(result), [], 'every part fits');
  eq(result.tier, TIER_CONTENT);

  const broken = clean.map(([name, content]) => (name === 'word/document.xml' ? [name, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${doc('<w:sectPr/><w:p><w:r><w:t>One paragraph.</w:t></w:r></w:p>')}`] : [name, content]));
  const whole2 = pack(broken);
  const cut2 = whole2.slice(0, whole2.length - 30);
  const result2 = await runPipeline({ name: 'd.docx', size: cut2.length, buffer: cut2.slice().buffer }, env);
  assert(result2.output, 'output produced');
  eq(result2.tier, TIER_STRUCTURAL);
});
