import { test, assert, eq } from './harness.js';
import { parseTree, documentElement, serializeTree } from '../js/core/xml-repair.js';
import { completeSpine, findViolations } from '../js/core/schema-close.js';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const el = (ns, local, min = 1) => ({ ns, local, min, max: 1 });

const TABLE = {
  elements: {
    [`${P}|sp`]: { kind: 'sequence', items: [el(P, 'nvSpPr'), el(P, 'spPr'), el(P, 'style', 0), el(P, 'txBody', 0), el(P, 'extLst', 0)], attrs: [] },
    [`${P}|nvSpPr`]: { kind: 'sequence', items: [el(P, 'cNvPr'), el(P, 'cNvSpPr'), el(P, 'nvPr')], attrs: [] },
    [`${P}|cNvPr`]: { kind: 'sequence', items: [], attrs: [{ local: 'id', required: true, type: 'integer' }, { local: 'name', required: true, type: 'string' }, { local: 'descr', required: false }] },
    [`${P}|cNvSpPr`]: { kind: 'sequence', items: [], attrs: [] },
    [`${P}|nvPr`]: { kind: 'sequence', items: [], attrs: [] },
    [`${P}|spPr`]: { kind: 'sequence', items: [], attrs: [] },
    [`${P}|spTree`]: { kind: 'sequence', items: [el(P, 'nvGrpSpPr'), el(P, 'grpSpPr'), { kind: 'choice', min: 0, max: null, items: [el(P, 'sp'), el(P, 'pic')] }], attrs: [] },
    [`${P}|nvGrpSpPr`]: { kind: 'sequence', items: [], attrs: [] },
    [`${P}|grpSpPr`]: { kind: 'sequence', items: [], attrs: [] },
    [`${P}|notesMaster`]: { kind: 'sequence', items: [el(P, 'cSld'), el(P, 'clrMap')], attrs: [] },
    [`${P}|cSld`]: { kind: 'sequence', items: [el(P, 'spTree')], attrs: [] },
    [`${P}|clrMap`]: { kind: 'sequence', items: [], attrs: [{ local: 'bg1', required: true, type: 'enum', values: ['lt1', 'dk1'] }, { local: 'tx1', required: true, type: 'enum', values: ['dk1', 'lt1'] }] },
    [`${P}|pick`]: { kind: 'sequence', items: [{ kind: 'choice', min: 1, max: 1, items: [el(P, 'one'), el(P, 'two')] }], attrs: [] },
    [`${S}|worksheet`]: { kind: 'sequence', items: [el(S, 'dimension', 0), el(S, 'sheetData'), el(S, 'pageMargins', 0)], attrs: [] },
    [`${S}|sheetData`]: { kind: 'sequence', items: [], attrs: [] }
  }
};

const NSP = `xmlns:p="${P}"`;

function fix(xml, table = TABLE) {
  const tree = parseTree(xml);
  const result = completeSpine(documentElement(tree), table);
  return { text: serializeTree(tree), result };
}

test('schema: a shape cut off after its first child gets the missing required child in order', () => {
  const { text, result } = fix(`<p:sp ${NSP}><p:nvSpPr><p:cNvPr id="2" name="A"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr></p:sp>`);
  eq(text, `<p:sp ${NSP}><p:nvSpPr><p:cNvPr id="2" name="A"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>`);
  eq(result.added.map((a) => `${a.parent}>${a.child}`), ['sp>spPr']);
  eq(result.unresolved, []);
});

test('schema: an empty shape gets every required child, and each of those gets its own, with required attributes', () => {
  const { text } = fix(`<p:sp ${NSP}/>`);
  eq(text, `<p:sp ${NSP}><p:nvSpPr><p:cNvPr id="0" name=""/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>`);
});

test('schema: a missing required child goes before a later optional sibling that is already there', () => {
  const { text } = fix(`<p:sp ${NSP}><p:nvSpPr><p:cNvPr id="1" name="x"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:style/></p:sp>`);
  assert(text.indexOf('<p:spPr/>') < text.indexOf('<p:style/>'), 'spPr before style');
});

test('schema: only the elements open at the cut are completed, earlier siblings are left alone', () => {
  const xml = `<p:spTree ${NSP}><p:nvGrpSpPr/><p:grpSpPr/><p:sp/><p:sp><p:nvSpPr><p:cNvPr id="1" name="x"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr></p:sp></p:spTree>`;
  const { text } = fix(xml);
  assert(text.includes('<p:sp/>'), 'earlier shape untouched');
  assert(text.endsWith('<p:spPr/></p:sp></p:spTree>'), 'last shape completed');
});

test('schema: the chain from the root down the last children is completed at every level', () => {
  const { text, result } = fix(`<p:notesMaster ${NSP}><p:cSld><p:spTree><p:nvGrpSpPr/></p:spTree></p:cSld></p:notesMaster>`);
  assert(text.includes('<p:grpSpPr/>'), 'spTree completed');
  assert(text.endsWith('<p:clrMap bg1="lt1" tx1="dk1"/></p:notesMaster>'), 'root completed with enum defaults');
  eq(result.added.length, 2);
});

test('schema: a default namespace is reused for the element that is added', () => {
  const { text } = fix(`<worksheet xmlns="${S}"><dimension ref="A1"/></worksheet>`);
  eq(text, `<worksheet xmlns="${S}"><dimension ref="A1"/><sheetData/></worksheet>`);
});

test('schema: a required choice with nothing chosen is reported, not guessed', () => {
  const { text, result } = fix(`<p:pick ${NSP}/>`);
  eq(text, `<p:pick ${NSP}/>`);
  eq(result.added, []);
  eq(result.unresolved.length, 1);
  eq(result.unresolved[0].child, 'one|two');
});

test('schema: a required child in a namespace that is not declared is reported', () => {
  const root = documentElement(parseTree('<sp xmlns="urn:other"/>'));
  const table = { elements: { 'urn:other|sp': { kind: 'sequence', items: [{ ns: 'urn:missing', local: 'x', min: 1, max: 1 }], attrs: [] } } };
  const result = completeSpine(root, table);
  eq(result.added, []);
  eq(result.unresolved.length, 1);
});

test('schema: an element with no table entry, and foreign children, are left alone', () => {
  const { text, result } = fix(`<p:sp ${NSP} xmlns:x="urn:x"><x:note/><p:nvSpPr><p:cNvPr id="1" name="a"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>`);
  eq(result.added, []);
  assert(text.includes('<x:note/>'), 'foreign child kept');
  eq(fix('<unknown/>').result.added, []);
});

test('schema: a complete tree is returned unchanged', () => {
  const xml = `<p:sp ${NSP}><p:nvSpPr><p:cNvPr id="1" name="a"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>`;
  eq(fix(xml).text, xml);
});

test('schema: violations report a missing required child anywhere in the tree', () => {
  const root = documentElement(parseTree(`<p:spTree ${NSP}><p:nvGrpSpPr/><p:grpSpPr/><p:sp/></p:spTree>`));
  const found = findViolations(root, TABLE);
  assert(found.some((v) => v.problem === 'missing' && v.element === 'sp' && v.child === 'nvSpPr'), 'nvSpPr');
  assert(found.some((v) => v.problem === 'missing' && v.element === 'sp' && v.child === 'spPr'), 'spPr');
});

test('schema: violations report children out of order and say nothing about a valid tree', () => {
  const bad = documentElement(parseTree(`<p:sp ${NSP}><p:spPr/><p:nvSpPr><p:cNvPr id="1" name="a"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr></p:sp>`));
  assert(findViolations(bad, TABLE).some((v) => v.problem === 'order'), 'order');
  const good = documentElement(parseTree(`<p:sp ${NSP}><p:nvSpPr><p:cNvPr id="1" name="a"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>`));
  eq(findViolations(good, TABLE), []);
});

test('schema: after completion the tree has no violations', () => {
  const root = documentElement(parseTree(`<p:notesMaster ${NSP}><p:cSld><p:spTree><p:nvGrpSpPr/></p:spTree></p:cSld></p:notesMaster>`));
  completeSpine(root, TABLE);
  eq(findViolations(root, TABLE), []);
});

import { pptxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { env } from './harness.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';

const SLIDE_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ${NSP}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`;

async function runTruncatedSlide(extraEnv) {
  const entries = pptxEntries().map(([name, content]) => (name === 'ppt/slides/slide3.xml' ? [name, SLIDE_HEAD] : [name, content]));
  const bytes = pack(entries).slice();
  return runPipeline({ name: 's.pptx', size: bytes.length, buffer: bytes.buffer }, { ...env, ...extraEnv });
}

function slideText(result) {
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  return strFromU8(unzipSync(out)['ppt/slides/slide3.xml']);
}

test('schema pipeline: a slide cut off inside a shape gets the shape completed when a table is available', async () => {
  const result = await runTruncatedSlide({ schemaTable: TABLE });
  const codes = result.findings.map((f) => f.code);
  assert(codes.includes('XML_TRUNCATED_CLOSED'), 'tree was closed');
  assert(codes.includes('SCHEMA_COMPLETED'), 'schema pass ran');
  assert(slideText(result).includes('<p:spPr/></p:sp>'), 'required child added in place');
  eq(findViolations(documentElement(parseTree(slideText(result))), TABLE).filter((v) => v.element === 'sp'), []);
});

test('schema pipeline: without a table the slide is closed as before and nothing is added', async () => {
  const result = await runTruncatedSlide({ schemaTable: null });
  const codes = result.findings.map((f) => f.code);
  assert(codes.includes('XML_TRUNCATED_CLOSED'), 'tree was closed');
  assert(!codes.includes('SCHEMA_COMPLETED') && !codes.includes('SCHEMA_UNRESOLVED'), 'no schema findings');
  assert(!slideText(result).includes('<p:spPr/>'), 'nothing added');
});
