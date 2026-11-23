import { test, assert, eq, env } from './harness.js';
import { pptxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';
import { parseTree } from '../js/core/xml-repair.js';
import { checkTree } from '../js/core/schema-fit.js';
import { SCHEMA_LITE } from '../js/core/data/schema-lite.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const THEME = 'ppt/theme/theme1.xml';
const colour = (name, value) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;
const font = (name) => `<a:${name}><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:${name}>`;

const THEME_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${A}" name="Cut"><a:themeElements><a:clrScheme name="Cut">${colour('dk1', '000000')}${colour('lt1', 'FFFFFF')}${colour('dk2', '44546A')}${colour('lt2', 'E7E6E6')}${['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((n, i) => colour(n, `4472C${i}`)).join('')}${colour('hlink', '0563C1')}${colour('folHlink', '954F72')}</a:clrScheme><a:fontScheme name="Cut">${font('majorFont')}${font('minorFont')}</a:fontScheme><a:fmtScheme name="Cut"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`;

async function run(entries) {
  const bytes = pack(entries).slice();
  return runPipeline({ name: 's.pptx', size: bytes.length, buffer: bytes.buffer }, env);
}

function part(result, name) {
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  return strFromU8(unzipSync(out)[name]);
}

function between(text, tag) {
  const found = text.match(new RegExp(`<a:${tag}>(.*?)</a:${tag}>`, 's'));
  return found ? found[1] : null;
}

const count = (text, tag) => (text.match(new RegExp(`<a:${tag}[ />]`, 'g')) || []).length;

test('schema fill: a theme cut off inside its fill list is completed to a valid theme by the shipped table', async () => {
  const result = await run(pptxEntries().map(([name, content]) => (name === THEME ? [name, THEME_HEAD] : [name, content])));
  const codes = result.findings.map((f) => f.code);
  assert(codes.includes('XML_TRUNCATED_CLOSED'), 'tree was closed');
  assert(codes.includes('SCHEMA_COMPLETED'), 'schema pass ran');
  assert(!codes.includes('SCHEMA_UNRESOLVED'), 'nothing was left unresolved');
  const text = part(result, THEME);
  assert(text.includes('<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'), 'the fill that survived is kept');
  eq(count(between(text, 'fillStyleLst'), 'solidFill') + count(between(text, 'fillStyleLst'), 'noFill'), 3, 'three fills');
  eq(count(between(text, 'lnStyleLst'), 'ln'), 3, 'three line styles');
  eq(count(between(text, 'effectStyleLst'), 'effectStyle'), 3, 'three effect styles');
  eq(count(between(text, 'bgFillStyleLst'), 'solidFill') + count(between(text, 'bgFillStyleLst'), 'noFill'), 3, 'three background fills');
  const hard = checkTree(SCHEMA_LITE, parseTree(text), Infinity).findings.filter((f) => f.kind !== 'order');
  eq(hard.map((f) => `${f.kind}:${f.name}`), [], 'the table finds nothing wrong with the result');
});

test('schema fill: a package that was not cut off is not touched by the schema pass', async () => {
  const result = await run(pptxEntries());
  const codes = result.findings.map((f) => f.code);
  eq(result.outcome, 'noProblems');
  assert(!codes.includes('SCHEMA_COMPLETED') && !codes.includes('SCHEMA_UNRESOLVED'), 'no schema findings');
});
