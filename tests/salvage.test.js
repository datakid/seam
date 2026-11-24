import { test, assert, eq, env } from './harness.js';
import { salvage, extractParagraphs, buildDocx, buildXlsx } from '../js/core/salvage.js';
import { verifyPackage } from '../js/core/verify.js';
import { strictRead } from '../js/core/zip-read.js';
import { docx, xlsx, pptx, unpack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { zeroMain, hollowMain, truncate } from './corrupt.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function docText(entries) {
  const found = strictRead(entries, 0).entries.find((e) => e.name === 'word/document.xml');
  return new TextDecoder().decode(found.data);
}

function sources(map) {
  return new Map(Object.entries(map));
}

test('salvage docx: paragraphs, tabs, breaks, entities and spaces', () => {
  const xml = `<w:document ${W}><w:body><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>One</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve"> two &amp; &#65;</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>three</w:t></w:r></w:p><w:p/><w:p w:rsidR="00AA"><w:r><w:t/></w:r><w:r><w:t>Second &lt;paragraph&gt;</w:t></w:r></w:p></w:body></w:document>`;
  const result = salvage(sources({ 'word/document.xml': xml }), 'docx', 'Memo');
  assert(result.ok, 'ok');
  eq(result.key, 'docx');
  eq(result.name, 'Memo (salvaged text).docx');
  eq(result.preview, 'One\t two & A\nthree\n\nSecond <paragraph>');
});

test('salvage docx: truncated text at the end is kept up to the cut', () => {
  const xml = `<w:document ${W}><w:body><w:p><w:r><w:t>complete paragraph</w:t></w:r></w:p><w:p><w:r><w:t>cut off wor`;
  const result = salvage(sources({ 'word/document.xml': xml }), 'docx', 'x');
  assert(result.ok, 'ok');
  eq(result.preview, 'complete paragraph\ncut off wor');
});

test('salvage docx: table, picture and property elements do not leak into the text', () => {
  const xml = `<w:document ${W}><w:body><w:tbl><w:tr><w:tc><w:p><w:pPr/><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:pict/><w:proofErr/><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
  eq(extractParagraphs(xml, /<w:p(?=[\s\/>])[^>]*>|<w:t(?=[\s\/>])[^>]*?(?:\/>|>([^<]*))|<w:tab\s*\/>|<w:br\b[^>]*>/g, '<w:br').join('|'), 'cell|after');
});

test('salvage docx: zero characters means no output', () => {
  const xml = `<w:document ${W}><w:body><w:p><w:r><w:t>   </w:t></w:r></w:p></w:body></w:document>`;
  eq(salvage(sources({ 'word/document.xml': xml }), 'docx', 'x').ok, false);
  eq(salvage(sources({}), null, 'x').ok, false);
});

test('salvage docx: the built file passes the structural checks', async () => {
  const bytes = buildDocx([{ text: 'Slide 1', bold: true }, 'line one\tcolumn\nnext', '', 'A & B <tag>']);
  const verdict = await verifyPackage(bytes, env, { key: 'docx', ext: 'docx' });
  assert(verdict.ok, JSON.stringify(verdict.failed));
});

const SHEET_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

test('salvage xlsx: shared strings, inline strings, booleans, errors, numbers and formulas', () => {
  const sst = `<sst ${SHEET_NS}><si><t>Name</t></si><si><r><t>Rich </t></r><r><t>text</t></r><rPh sb="0"><t>ignored</t></rPh></si><si/><si><t>cut`;
  const sheet = `<worksheet ${SHEET_NS}><sheetData><row r="2"><c r="B2" t="s"><v>1</v></c><c r="A2"><v>12.5</v></c></row><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>inline</t></is></c><c r="C1" t="b"><v>1</v></c><c r="D1" t="e"><v>#N/A</v></c><c r="E1" t="str"><f>A1&amp;B1</f><v>Cached</v></c><c r="F1" t="s"><v>999</v></c><c r="G1"/></row><row r="3"><c r="A3"><f>SUM(A1:A2)</f><v>7</v></c><c r="B3"><v>unfinished`;
  const result = salvage(sources({ 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet }), 'xlsx', 'Book');
  assert(result.ok, 'ok');
  eq(result.key, 'xlsx');
  eq(result.name, 'Book (salvaged text).xlsx');
  eq(result.preview.split('\n')[0], 'Sheet1');
  eq(result.preview.split('\n')[1], 'Name\tinline\t1\t#N/A\tCached');
  eq(result.preview.split('\n')[2], '12.5\tRich text');
  eq(result.preview.split('\n')[3], '7');
});

test('salvage xlsx: sheet names come from the workbook when it is readable and sheets sort naturally', () => {
  const workbook = `<workbook ${SHEET_NS} xmlns:r="urn:r"><sheets><sheet name="Totals" sheetId="1" r:id="rId1"/><sheet name="Detail" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const rels = `<Relationships xmlns="urn:rels"><Relationship Id="rId1" Target="worksheets/sheet10.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`;
  const cell = (v) => `<worksheet ${SHEET_NS}><sheetData><row r="1"><c r="A1"><v>${v}</v></c></row></sheetData></worksheet>`;
  const result = salvage(sources({ 'xl/workbook.xml': workbook, 'xl/_rels/workbook.xml.rels': rels, 'xl/worksheets/sheet10.xml': cell(10), 'xl/worksheets/sheet2.xml': cell(2) }), 'xlsx', 'B');
  eq(result.preview, 'Detail\n2\nTotals\n10');
});

test('salvage xlsx: the built workbook passes the structural checks', async () => {
  const sheet = { name: 'Data & more', rows: [{ row: 1, cells: [{ row: 1, col: 1, letters: 'A', kind: 'inlineStr', value: 'x < y' }, { row: 1, col: 2, letters: 'B', kind: 'n', value: '4' }] }] };
  const verdict = await verifyPackage(buildXlsx([sheet, { ...sheet, name: 'Second' }]), env, { key: 'xlsx', ext: 'xlsx' });
  assert(verdict.ok, JSON.stringify(verdict.failed));
});

test('salvage pptx: slides in numeric order with a heading each, line breaks and empty slides skipped', () => {
  const slide = (text) => `<p:sld xmlns:a="urn:a" xmlns:p="urn:p"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r><a:br/><a:r><a:t>second line</a:t></a:r></a:p><a:p><a:pPr/><a:r><a:t>next</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const empty = '<p:sld xmlns:a="urn:a" xmlns:p="urn:p"><p:cSld/></p:sld>';
  const result = salvage(sources({ 'ppt/slides/slide10.xml': slide('ten'), 'ppt/slides/slide2.xml': slide('two'), 'ppt/slides/slide3.xml': empty, 'ppt/slides/slide1.xml': slide('one') }), 'pptx', 'Deck');
  assert(result.ok, 'ok');
  eq(result.key, 'docx');
  eq(result.name, 'Deck (salvaged text).docx');
  eq(result.preview.split('\n').filter((l) => l.startsWith('Slide')).join(','), 'Slide 1,Slide 2,Slide 10');
  assert(result.preview.includes('one\nsecond line'), result.preview);
});

test('salvage without a hint picks the family from the parts present', () => {
  const sheet = `<worksheet ${SHEET_NS}><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`;
  eq(salvage(sources({ 'xl/worksheets/sheet1.xml': sheet }), null, 'x').family, 'xlsx');
  eq(salvage(sources({ 'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>` }), null, 'x').family, 'docx');
});

test('pipeline: a zeroed docx main part is Could not repair with no output', async () => {
  const broken = zeroMain(docx(), 'docx').slice();
  const result = await runPipeline({ name: 'Letter.docx', size: broken.length, buffer: broken.buffer }, env);
  eq(result.outcome, 'failed');
  assert(result.output === null, 'no output');
  assert(result.sentence.startsWith('This file could not be repaired.'), result.sentence);
});

test('pipeline: a zeroed workbook part is rebuilt from the worksheets, so the sheets stay sheets, and the loss is reported', async () => {
  const broken = zeroMain(xlsx(), 'xlsx').slice();
  const result = await runPipeline({ name: 'Ledger.xlsx', size: broken.length, buffer: broken.buffer }, env);
  eq(result.outcome, 'partial');
  eq(result.output.name, 'Ledger (repaired).xlsx');
  assert(result.findings.some((f) => f.code === 'XLSX_WORKBOOK_REBUILT' && f.severity === 'loss'), 'rebuild finding');
  const verdict = await verifyPackage(new Uint8Array(result.output.bytes), env, { key: 'xlsx', ext: 'xlsx' });
  assert(verdict.ok, 'verifies');
});

test('pipeline: a workbook part that is not a workbook is salvaged from the worksheets and the output verifies', async () => {
  const broken = hollowMain(xlsx(), 'xlsx').slice();
  const result = await runPipeline({ name: 'Ledger.xlsx', size: broken.length, buffer: broken.buffer }, env);
  eq(result.outcome, 'salvaged');
  eq(result.output.name, 'Ledger (salvaged text).xlsx');
  assert(result.preview.includes('Item'), result.preview);
  assert(result.findings.some((f) => f.code === 'SALVAGE_TEXT_ONLY'), 'salvage finding');
  const verdict = await verifyPackage(new Uint8Array(result.output.bytes), env, { key: 'xlsx', ext: 'xlsx' });
  assert(verdict.ok, 'verifies');
});

test('pipeline: a zeroed presentation part is rebuilt from the masters and slides, so the deck stays a deck', async () => {
  const broken = zeroMain(pptx(), 'pptx').slice();
  const result = await runPipeline({ name: 'Deck.pptx', size: broken.length, buffer: broken.buffer }, env);
  eq(result.outcome, 'partial');
  eq(result.output.name, 'Deck (repaired).pptx');
  assert(result.findings.some((f) => f.code === 'PPTX_PRESENTATION_REBUILT' && f.severity === 'loss'), 'rebuild finding');
  const verdict = await verifyPackage(new Uint8Array(result.output.bytes), env, { key: 'pptx', ext: 'pptx' });
  assert(verdict.ok, 'verifies');
});

test('pipeline: a presentation part that is not a presentation is salvaged into a docx', async () => {
  const broken = hollowMain(pptx(), 'pptx').slice();
  const result = await runPipeline({ name: 'Deck.pptx', size: broken.length, buffer: broken.buffer }, env);
  eq(result.outcome, 'salvaged');
  eq(result.output.name, 'Deck (salvaged text).docx');
  assert(result.preview.includes('Slide 1'), result.preview);
});

test('pipeline: a docx cut inside the document part keeps the text before the cut', async () => {
  const original = docx();
  const broken = truncate(original, 0.5).slice();
  const result = await runPipeline({ name: 'Cut.docx', size: broken.length, buffer: broken.buffer }, env);
  assert(['partial', 'salvaged'].includes(result.outcome), result.outcome);
  const bytes = new Uint8Array(result.output.bytes);
  const read = strictRead(bytes, 0);
  const doc = read.entries.find((e) => e.name === 'word/document.xml');
  assert(new TextDecoder().decode(doc.data).includes('First paragraph of the fixture document.'), 'text before the cut kept');
});

test('pipeline: an empty list of entries is Could not repair', async () => {
  const bytes = Uint8Array.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const result = await runPipeline({ name: 'Empty.docx', size: bytes.length, buffer: bytes.buffer }, env);
  eq(result.outcome, 'failed');
  assert(result.findings.some((f) => f.code === 'NO_MAIN_PART'), 'no main part');
});

test('salvage docx: unused helper keeps entries accessible', () => {
  assert(docText(docx()).includes('<w:body>'), 'fixture body');
  assert(unpack(docx()).length > 3, 'fixture parts');
});
