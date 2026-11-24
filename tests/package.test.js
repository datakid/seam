import { test, assert, eq, bytesEqual, env } from './harness.js';
import { docxEntries, xlsxEntries, pptxEntries, pack, randomBytes } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';
import { unzipSync, strToU8 } from '../vendor/fflate.module.js';
import { localEntry } from './corrupt.js';
import { resolveTarget, relsPathFor, sourceOfRels, relativeTarget, normalizePartPath } from '../js/core/package.js';

async function run(name, bytes) {
  const copyOf = bytes.slice();
  return runPipeline({ name, size: copyOf.length, buffer: copyOf.buffer }, env);
}

function change(entries, name, fn) {
  return entries.map(([n, data]) => (n === name ? [n, strToU8(fn(typeof data === 'string' ? data : new TextDecoder().decode(data)))] : [n, data]));
}

function drop(entries, ...names) {
  return entries.filter(([n]) => !names.includes(n));
}

function codes(result) {
  return result.findings.map((f) => f.code);
}

async function textOf(result, part) {
  const parts = unzipSync(new Uint8Array(result.output.bytes));
  return new TextDecoder().decode(parts[part]);
}

async function verified(result, key) {
  const verdict = await verifyPackage(new Uint8Array(result.output.bytes), env, { key, ext: key });
  assert(verdict.ok, JSON.stringify(verdict.failed));
}

test('paths: targets resolve relative to the source folder, with ../ and absolute forms', () => {
  eq(resolveTarget('word/document.xml', 'media/image1.png'), 'word/media/image1.png');
  eq(resolveTarget('ppt/slides/slide1.xml', '../slideLayouts/slideLayout1.xml'), 'ppt/slideLayouts/slideLayout1.xml');
  eq(resolveTarget('word/document.xml', '/docProps/core.xml'), 'docProps/core.xml');
  eq(resolveTarget('', 'word/document.xml'), 'word/document.xml');
  eq(resolveTarget('word/document.xml', 'my%20image.png'), 'word/my image.png');
  eq(normalizePartPath('a/./b/../c'), 'a/c');
});

test('paths: relationship file names map to their sources and back', () => {
  eq(relsPathFor('word/document.xml'), 'word/_rels/document.xml.rels');
  eq(relsPathFor(''), '_rels/.rels');
  eq(relsPathFor('workbook.xml'), '_rels/workbook.xml.rels');
  eq(sourceOfRels('word/_rels/document.xml.rels'), 'word/document.xml');
  eq(sourceOfRels('_rels/.rels'), '');
  eq(relativeTarget('ppt/slides/slide1.xml', 'ppt/slideLayouts/slideLayout2.xml'), '../slideLayouts/slideLayout2.xml');
  eq(relativeTarget('word/document.xml', 'word/styles.xml'), 'styles.xml');
});

test('content types: a wrong main type is fixed and reported', async () => {
  const entries = change(docxEntries(), '[Content_Types].xml', (t) => t.replace('document.main+xml', 'template.main+xml'));
  const result = await run('a.docx', pack(entries));
  eq(result.outcome, 'repaired', JSON.stringify(codes(result)));
  assert(codes(result).includes('CT_MAIN_FIXED'), 'main fixed');
  await verified(result, 'docx');
});

test('content types: overrides for missing parts are removed and missing ones are added', async () => {
  let entries = change(docxEntries(), '[Content_Types].xml', (t) => t.replace('<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>', '<Override PartName="/word/ghost.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'));
  const result = await run('a.docx', pack(entries));
  eq(result.outcome, 'repaired');
  assert(codes(result).includes('CT_OVERRIDE_REMOVED') && codes(result).includes('CT_OVERRIDE_ADDED'), JSON.stringify(codes(result)));
  const ct = await textOf(result, '[Content_Types].xml');
  assert(!ct.includes('ghost') && ct.includes('/word/styles.xml'), ct);
});

test('content types: a missing default for an extension is added', async () => {
  const entries = change(docxEntries(), '[Content_Types].xml', (t) => t.replace('<Default Extension="png" ContentType="image/png"/>', ''));
  const result = await run('a.docx', pack(entries));
  assert(codes(result).includes('CT_DEFAULT_ADDED'), JSON.stringify(codes(result)));
  assert((await textOf(result, '[Content_Types].xml')).includes('Extension="png"'), 'png default');
});

test('content types: an unknown part type is noted and left alone', async () => {
  const entries = [...docxEntries(), ['custom/data.xyz', strToU8('payload')]];
  const result = await run('a.docx', pack(entries));
  assert(codes(result).includes('CT_UNKNOWN_PART'), JSON.stringify(codes(result)));
  const note = result.findings.find((f) => f.code === 'CT_UNKNOWN_PART');
  eq(note.part, 'custom/data.xyz');
  eq(note.severity, 'noted');
});

test('content types: an unknown part is left alone while the package is not rewritten', async () => {
  const entries = [...docxEntries(), ['docProps/core.xml~', strToU8('backup')]];
  const result = await run('a.docx', pack(entries));
  eq(result.outcome, 'noProblems');
  assert(codes(result).includes('CT_UNKNOWN_PART') && !codes(result).includes('CT_PART_TYPED'), JSON.stringify(codes(result)));
});

test('content types: an unknown part gets a generic type when the package is rewritten, so the repair still verifies', async () => {
  const entries = [...docxEntries(), ['docProps/core.xml~', strToU8('backup')]];
  const whole = pack(entries);
  const bytes = new Uint8Array(whole.length + 120);
  bytes.fill(0x37, 0, 120);
  bytes.set(whole, 120);
  const result = await run('a.docx', bytes);
  eq(result.outcome, 'repaired', JSON.stringify(codes(result)));
  const typed = result.findings.find((f) => f.code === 'CT_PART_TYPED');
  assert(typed, JSON.stringify(codes(result)));
  eq(typed.part, 'docProps/core.xml~');
  eq(typed.severity, 'repaired');
  assert(!codes(result).includes('CT_UNKNOWN_PART'), 'the note about it is replaced');
  assert((await textOf(result, '[Content_Types].xml')).includes('<Override PartName="/docProps/core.xml~" ContentType="application/octet-stream"/>'), 'override written');
  eq(new TextDecoder().decode(unzipSync(new Uint8Array(result.output.bytes))['docProps/core.xml~']), 'backup');
  await verified(result, 'docx');
});

test('content types: the generic override for an untyped part with a space in its name is written percent-encoded', async () => {
  const entries = [...docxEntries(), ['docProps/my notes.xyz', strToU8('backup')]];
  const whole = pack(entries);
  const bytes = new Uint8Array(whole.length + 40);
  bytes.fill(0x37, 0, 40);
  bytes.set(whole, 40);
  const result = await run('a.docx', bytes);
  assert(codes(result).includes('CT_PART_TYPED'), JSON.stringify(codes(result)));
  assert((await textOf(result, '[Content_Types].xml')).includes('PartName="/docProps/my%20notes.xyz"'), 'encoded');
  await verified(result, 'docx');
});

test('root rels: a relationship pointing at the wrong main part is repointed', async () => {
  const entries = change(docxEntries(), '_rels/.rels', (t) => t.replace('Target="word/document.xml"', 'Target="word/documnet.xml"'));
  const result = await run('a.docx', pack(entries));
  eq(result.outcome, 'repaired', JSON.stringify(codes(result)));
  assert(codes(result).includes('ROOT_RELS_FIXED'), 'fixed');
  assert(!codes(result).includes('REL_REMOVED'), 'not reported as removed');
  await verified(result, 'docx');
});

test('rels: dangling relationships are removed per file with the targets listed', async () => {
  const entries = change(docxEntries(), 'word/_rels/document.xml.rels', (t) => t.replace('</Relationships>', '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer9.xml"/></Relationships>'));
  const result = await run('a.docx', pack(entries));
  const finding = result.findings.find((f) => f.code === 'REL_REMOVED');
  eq(finding.data.n, 1);
  eq(finding.data.targets, ['footer9.xml']);
  eq(finding.part, 'word/_rels/document.xml.rels');
});

test('rels: duplicate ids that nothing refers to are renamed', async () => {
  const entries = change(docxEntries(), 'word/_rels/document.xml.rels', (t) => t.replace('</Relationships>', '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="styles.xml"/></Relationships>'));
  const result = await run('a.docx', pack(entries));
  assert(codes(result).includes('REL_ID_RENAMED') || codes(result).includes('REL_DUPLICATE_DROPPED'), JSON.stringify(codes(result)));
  const rels = await textOf(result, 'word/_rels/document.xml.rels');
  const ids = Array.from(rels.matchAll(/Id="([^"]+)"/g)).map((m) => m[1]);
  eq(new Set(ids).size, ids.length);
});

test('rels: a relationships file whose source part is missing is dropped', async () => {
  const entries = [...docxEntries(), ['word/_rels/ghost.xml.rels', strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')]];
  const result = await run('a.docx', pack(entries));
  assert(codes(result).includes('REL_FILE_REMOVED'), JSON.stringify(codes(result)));
  assert(!unzipSync(new Uint8Array(result.output.bytes))['word/_rels/ghost.xml.rels'], 'file dropped');
});

test('zip: an entry path containing .. is dropped and reported', async () => {
  const entries = pack([...docxEntries(), ['../escape.xml', strToU8('<a/>')]]);
  const result = await run('a.docx', entries);
  assert(codes(result).includes('ZIP_PATH_DROPPED'), JSON.stringify(codes(result)));
  assert(Object.keys(unzipSync(new Uint8Array(result.output.bytes))).every((n) => !n.includes('..')), 'no unsafe path in the output');
});

test('docx: a document without a body gets one around the existing content', async () => {
  const entries = change(docxEntries(), 'word/document.xml', (t) => t.replace('<w:body>', '').replace('</w:body>', ''));
  const result = await run('a.docx', pack(entries));
  assert(codes(result).includes('DOCX_BODY_ADDED'), JSON.stringify(codes(result)));
  const xml = await textOf(result, 'word/document.xml');
  assert(xml.includes('<w:body>') && xml.includes('First paragraph of the fixture document.'), 'body wraps the text');
  await verified(result, 'docx');
});

test('docx: a dangling hyperlink is unwrapped and its text kept', async () => {
  const entries = change(docxEntries(), 'word/_rels/document.xml.rels', (t) => t.replace(/<Relationship Id="rId3"[^>]*\/>/, ''));
  const result = await run('a.docx', pack(entries));
  assert(result.findings.some((f) => f.code === 'REF_REMOVED' && f.data.loss === 'link'), JSON.stringify(codes(result)));
  eq(result.outcome, 'partial');
  const xml = await textOf(result, 'word/document.xml');
  assert(xml.includes('A link to the project page') && !xml.includes('<w:hyperlink'), 'text kept, link gone');
});

test('docx: missing styles relationship is added for the existing styles part', async () => {
  const entries = change(docxEntries(), 'word/_rels/document.xml.rels', (t) => t.replace(/<Relationship Id="rId1"[^>]*\/>/, ''));
  const result = await run('a.docx', pack(entries));
  assert(codes(result).includes('DOCX_REL_ADDED'), JSON.stringify(codes(result)));
  assert((await textOf(result, 'word/_rels/document.xml.rels')).includes('Target="styles.xml"'), 'styles linked');
  eq(result.outcome, 'repaired');
});

test('docx: list formatting with a missing numbering part is noted', async () => {
  const entries = change(docxEntries(), 'word/document.xml', (t) => t.replace('<w:body>', '<w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>'));
  const result = await run('a.docx', pack(entries));
  assert(codes(result).includes('DOCX_NUMBERING_MISSING'), JSON.stringify(codes(result)));
});

test('xlsx: removing the first sheet re-indexes defined names that point at later sheets', async () => {
  const entries = drop(xlsxEntries(), 'xl/worksheets/sheet1.xml');
  const result = await run('a.xlsx', pack(entries));
  eq(result.outcome, 'partial');
  const xml = await textOf(result, 'xl/workbook.xml');
  assert(xml.includes('localSheetId="0"'), xml);
  assert(!xml.includes('Name="Data"') && !xml.includes('name="Data"'), 'sheet removed');
  await verified(result, 'xlsx');
});

test('xlsx: duplicate and over-long sheet names are made unique and shortened', async () => {
  const long = 'L'.repeat(40);
  const entries = change(xlsxEntries(), 'xl/workbook.xml', (t) => t.replace('name="Notes"', 'name="data"').replace('name="Data"', `name="${long}"`));
  const result = await run('a.xlsx', pack(entries));
  const renamed = result.findings.filter((f) => f.code === 'XLSX_SHEET_RENAMED');
  eq(renamed.length, 1);
  eq(renamed[0].data.to.length, 31);
  const xml = await textOf(result, 'xl/workbook.xml');
  assert(xml.includes(`name="${'L'.repeat(31)}"`), xml);
});

test('xlsx: an intact workbook keeps its calc chain and counts; a repaired one drops them', async () => {
  const intact = await run('a.xlsx', pack(xlsxEntries()));
  eq(intact.outcome, 'noProblems');
  const damaged = await run('a.xlsx', pack(change(xlsxEntries(), 'xl/worksheets/sheet1.xml', (t) => t.replace('<c r="A1" t="s"><v>0</v>', '<c r="A1" t="s"><v>77</v>'))));
  assert(codes(damaged).includes('XLSX_CALCCHAIN_REMOVED') && codes(damaged).includes('XLSX_DIMENSION_REMOVED'), JSON.stringify(codes(damaged)));
  const parts = unzipSync(new Uint8Array(damaged.output.bytes));
  assert(!parts['xl/calcChain.xml'], 'calc chain removed');
  assert(!new TextDecoder().decode(parts['[Content_Types].xml']).includes('calcChain'), 'override removed');
  assert(!new TextDecoder().decode(parts['xl/_rels/workbook.xml.rels']).includes('calcChain'), 'relationship removed');
  const sst = new TextDecoder().decode(parts['xl/sharedStrings.xml']);
  assert(sst.includes('uniqueCount="5"') && !/\scount=/.test(sst), sst);
});

test('xlsx: cleared cells lose their type and value but keep the cell', async () => {
  const entries = change(xlsxEntries(), 'xl/worksheets/sheet1.xml', (t) => t.replace('<c r="B1" t="s"><v>1</v></c>', '<c r="B1" t="s"><v>abc</v></c>'));
  const result = await run('a.xlsx', pack(entries));
  const finding = result.findings.find((f) => f.code === 'XLSX_CELL_CLEARED');
  eq(finding.data.n, 1);
  const xml = await textOf(result, 'xl/worksheets/sheet1.xml');
  assert(xml.includes('<c r="B1"></c>') && xml.includes('<c r="A1" t="s"><v>0</v></c>'), 'only the bad cell changed');
});

test('xlsx: a drawing reference with no relationship is removed', async () => {
  const entries = change(xlsxEntries(), 'xl/worksheets/sheet2.xml', (t) => t.replace('</sheetData>', '</sheetData><drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId7"/>'));
  const result = await run('a.xlsx', pack(entries));
  assert(codes(result).includes('XLSX_DRAWING_REMOVED'), JSON.stringify(codes(result)));
  assert(!(await textOf(result, 'xl/worksheets/sheet2.xml')).includes('<drawing'), 'drawing gone');
});

test('pptx: slides with duplicate ids are renumbered', async () => {
  const entries = change(pptxEntries(), 'ppt/presentation.xml', (t) => t.replace('id="257"', 'id="256"'));
  const result = await run('a.pptx', pack(entries));
  assert(codes(result).includes('PPTX_SLIDE_IDS'), JSON.stringify(codes(result)));
  const ids = Array.from((await textOf(result, 'ppt/presentation.xml')).matchAll(/<p:sldId id="(\d+)"/g)).map((m) => m[1]);
  eq(new Set(ids).size, 3);
});

test('pptx: a slide whose layout is missing is relinked to the first layout of the first master', async () => {
  const entries = drop(pptxEntries(), 'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/_rels/slideLayout1.xml.rels');
  const result = await run('a.pptx', pack(entries));
  const relinked = result.findings.filter((f) => f.code === 'PPTX_LAYOUT_RELINKED');
  eq(relinked.length, 3);
  assert((await textOf(result, 'ppt/slides/_rels/slide1.xml.rels')).includes('slideLayout2.xml'), 'relinked to layout 2');
  await verified(result, 'pptx');
});

test('pptx: removing a slide part removes its entry and reports its number', async () => {
  const entries = drop(pptxEntries(), 'ppt/slides/slide2.xml');
  const result = await run('a.pptx', pack(entries));
  const removed = result.findings.find((f) => f.code === 'PPTX_SLIDE_REMOVED');
  eq(removed.data.number, 2);
  eq(result.outcome, 'partial');
  eq((await textOf(result, 'ppt/presentation.xml')).match(/<p:sldId /g).length, 2);
});

test('pptx: no slides left but a valid master is a valid empty presentation, Partially repaired', async () => {
  const entries = drop(pptxEntries(), 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide3.xml');
  const result = await run('a.pptx', pack(entries));
  eq(result.outcome, 'partial');
  eq(result.findings.filter((f) => f.code === 'PPTX_SLIDE_REMOVED').length, 3);
  await verified(result, 'pptx');
});

test('pptx: no master left falls back to salvage or failure, never a broken output', async () => {
  const entries = drop(pptxEntries(), 'ppt/slideMasters/slideMaster1.xml');
  const result = await run('a.pptx', pack(entries));
  assert(['salvaged', 'failed'].includes(result.outcome), result.outcome);
});

test('output: media is stored, xml is deflated, original bytes are kept for media', async () => {
  const original = pack(docxEntries());
  const broken = new Uint8Array(original.length - 30);
  broken.set(original.subarray(0, broken.length));
  const info = localEntry(original, 'word/media/image1.png');
  const cut = original.slice(0, info.dataStart + info.csize);
  const result = await run('a.docx', cut);
  const out = new Uint8Array(result.output.bytes);
  const png = localEntry(out, 'word/media/image1.png');
  eq(png.csize, png.usize);
  const doc = localEntry(out, 'word/document.xml');
  assert(doc.csize < doc.usize, 'xml deflated');
});

test('output: modification times of untouched entries are kept', async () => {
  const original = pack(docxEntries());
  const read = unzipSync(original);
  assert(Object.keys(read).length > 3, 'fixture');
  const result = await run('a.docx', original.slice(0, original.length - 22));
  const view = new DataView(new Uint8Array(result.output.bytes).buffer);
  const header = localEntry(new Uint8Array(result.output.bytes), 'word/document.xml').header;
  eq(view.getUint16(header + 10, true), (3 << 11) | (4 << 5) | 3);
});

test('large package: several megabytes of media pass through intact', async () => {
  const media = randomBytes(9, 6 * 1024 * 1024);
  const entries = [...docxEntries(), ['word/media/big.png', media]];
  const original = pack(entries);
  const broken = original.slice(0, original.length);
  const started = performance.now();
  const result = await run('big.docx', broken.subarray(0, broken.length - 0));
  eq(result.outcome, 'noProblems');
  const cut = await run('big.docx', original.slice(0, original.length - 22 - 100));
  assert(cut.output, 'output for the damaged copy');
  const out = unzipSync(new Uint8Array(cut.output.bytes));
  assert(!out['word/media/big.png'] || bytesEqual(out['word/media/big.png'], media), 'media identical');
  assert(performance.now() - started < 20000, 'finished in time');
});
