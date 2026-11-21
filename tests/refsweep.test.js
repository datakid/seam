import { test, assert, eq, env } from './harness.js';
import { unzipSync, strToU8, strFromU8 } from '../vendor/fflate.module.js';
import { docxEntries, xlsxEntries, pptxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';
import { REF_POLICY, REF_LOSS_NAMES } from '../js/core/data/ref-policy.js';

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_STALE = 'stale/gone.xml';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';

async function run(name, bytes) {
  const copy = bytes.slice();
  return runPipeline({ name, size: copy.length, buffer: copy.buffer }, env);
}

function change(entries, name, fn) {
  return entries.map(([n, data]) => (n === name ? [n, strToU8(fn(typeof data === 'string' ? data : strFromU8(data)))] : [n, data]));
}

function lost(result, loss, part) {
  return result.findings.filter((f) => f.code === 'REF_REMOVED' && f.data.loss === loss && (!part || f.part === part));
}

function stale(entries) {
  return change(entries, '[Content_Types].xml', (t) => t.replace('</Types>', `<Override PartName="/${NS_STALE}" ContentType="application/xml"/></Types>`));
}

async function accepted(result, key) {
  assert(result.output, `no output: ${JSON.stringify(result.findings.map((f) => f.code))}`);
  const bytes = new Uint8Array(result.output.bytes);
  const verdict = await verifyPackage(bytes, env, { key, ext: key });
  assert(verdict.ok, `verification failed: ${JSON.stringify(verdict.failed)}`);
  return unzipSync(bytes);
}

test('ref policy: every entry has a known action, a container list where needed and a named loss', () => {
  const actions = new Set(['remove', 'unwrap', 'removeContainer', 'keep']);
  for (const [key, entry] of Object.entries(REF_POLICY)) {
    assert(key === '*' || /^[A-Za-z0-9]+@[A-Za-z0-9*]+$/.test(key), `bad key ${key}`);
    assert(actions.has(entry.action), `${key}: action ${entry.action}`);
    if (entry.action === 'removeContainer') assert(Array.isArray(entry.container) && entry.container.length > 0, `${key}: container`);
    if (entry.action !== 'keep') assert(REF_LOSS_NAMES[entry.loss], `${key}: loss ${entry.loss} has no name`);
  }
  eq(REF_POLICY['*'].action, 'keep');
});

test('ref sweep: a picture reference that points nowhere is removed from an otherwise intact package', async () => {
  const entries = change(docxEntries(), 'word/document.xml', (t) => t.replace('r:embed="rId2"', 'r:embed="rId99"'));
  const result = await run('a.docx', pack(entries));
  eq(lost(result, 'image', 'word/document.xml').length, 1);
  eq(result.outcome, 'partial');
  const parts = await accepted(result, 'docx');
  assert(!strFromU8(parts['word/document.xml']).includes('rId99'), 'reference gone');
  const second = await run('a.docx', new Uint8Array(result.output.bytes));
  eq(second.outcome, 'noProblems');
});

test('ref sweep: a reference whose prefix is declared on the element itself is found', async () => {
  const chart = `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="9" name="Chart 1"/><a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:rel="${NS_R}" rel:id="rId50"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const entries = change(docxEntries(), 'word/document.xml', (t) => t.replace('</w:body>', `${chart}</w:body>`));
  const result = await run('a.docx', pack(stale(entries)));
  eq(lost(result, 'chart', 'word/document.xml').length, 1);
  const parts = await accepted(result, 'docx');
  const xml = strFromU8(parts['word/document.xml']);
  assert(!xml.includes('rId50') && !xml.includes('Chart 1'), 'the whole drawing is gone');
  assert(xml.includes('First paragraph of the fixture document.'), 'text kept');
});

test('ref sweep: a link in a part other than the main part is unwrapped and its text kept', async () => {
  let entries = docxEntries();
  entries = change(entries, '[Content_Types].xml', (t) => t.replace('</Types>', `<Override PartName="/word/header1.xml" ContentType="${WML}header+xml"/></Types>`));
  entries = change(entries, 'word/_rels/document.xml.rels', (t) => t.replace('</Relationships>', `<Relationship Id="rId8" Type="${NS_R}/header" Target="header1.xml"/></Relationships>`));
  entries.push(['word/header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:p><w:hyperlink r:id="rId7"><w:r><w:t>Header link text</w:t></w:r></w:hyperlink></w:p></w:hdr>`]);
  const result = await run('a.docx', pack(stale(entries)));
  eq(lost(result, 'link', 'word/header1.xml').length, 1);
  const parts = await accepted(result, 'docx');
  const header = strFromU8(parts['word/header1.xml']);
  assert(header.includes('Header link text') && !header.includes('hyperlink'), 'text kept, link gone');
});

function withTables(entries, listed, existing) {
  let out = change(entries, 'xl/worksheets/sheet1.xml', (t) => t.replace(`<worksheet xmlns="${NS_S}">`, `<worksheet xmlns="${NS_S}" xmlns:r="${NS_R}">`).replace('</worksheet>', `<tableParts count="${listed.length}">${listed.map((id) => `<tablePart r:id="${id}"/>`).join('')}</tableParts></worksheet>`));
  if (existing) {
    out = change(out, '[Content_Types].xml', (t) => t.replace('</Types>', `<Override PartName="/xl/tables/table1.xml" ContentType="${SML}table+xml"/></Types>`));
    out.push(['xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${NS_R}/table" Target="../tables/table1.xml"/></Relationships>`]);
    out.push(['xl/tables/table1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<table xmlns="${NS_S}" id="1" name="Table1" displayName="Table1" ref="A1:C3" totalsRowShown="0"><autoFilter ref="A1:C3"/><tableColumns count="3"><tableColumn id="1" name="Item"/><tableColumn id="2" name="Price"/><tableColumn id="3" name="Total"/></tableColumns></table>`]);
  }
  return out;
}

test('ref sweep: a table entry that points nowhere is removed, and an emptied list goes with it', async () => {
  const result = await run('a.xlsx', pack(stale(withTables(xlsxEntries(), ['rId1'], false))));
  eq(lost(result, 'table', 'xl/worksheets/sheet1.xml').length, 1);
  const parts = await accepted(result, 'xlsx');
  assert(!strFromU8(parts['xl/worksheets/sheet1.xml']).includes('tablePart'), 'list removed');
});

test('ref sweep: the count of a list is kept in step when one entry is removed and another stays', async () => {
  const result = await run('a.xlsx', pack(stale(withTables(xlsxEntries(), ['rId1', 'rId2'], true))));
  eq(lost(result, 'table', 'xl/worksheets/sheet1.xml').length, 1);
  const parts = await accepted(result, 'xlsx');
  const sheet = strFromU8(parts['xl/worksheets/sheet1.xml']);
  assert(sheet.includes('<tableParts count="1">') && sheet.includes('r:id="rId2"') && !sheet.includes('rId1"'), sheet.slice(-200));
});

test('ref sweep: healthy fixtures are not touched', async () => {
  for (const [name, entries] of [['a.docx', docxEntries()], ['a.xlsx', xlsxEntries()], ['a.pptx', pptxEntries()]]) {
    const result = await run(name, pack(entries));
    eq(result.outcome, 'noProblems', name);
    eq(result.findings.filter((f) => f.code === 'REF_REMOVED' || f.code === 'REF_DANGLING').length, 0, name);
  }
});

test('ref sweep: a dangling data link in an otherwise intact package is left alone', async () => {
  const chart = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${NS_C}" xmlns:r="${NS_R}"><c:chart><c:plotArea/></c:chart><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
  let entries = change(xlsxEntries(), '[Content_Types].xml', (t) => t.replace('</Types>', '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>'));
  entries.push(['xl/charts/chart1.xml', chart]);
  const result = await run('a.xlsx', pack(entries));
  eq(result.outcome, 'noProblems');
  eq(lost(result, 'data').length, 0);
});

test('ref sweep: the same data link is removed once the package is being repaired for another reason', async () => {
  const chart = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${NS_C}" xmlns:r="${NS_R}"><c:chart><c:plotArea/></c:chart><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
  let entries = change(xlsxEntries(), '[Content_Types].xml', (t) => t.replace('</Types>', '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>'));
  entries.push(['xl/charts/chart1.xml', chart]);
  const result = await run('a.xlsx', pack(stale(entries)));
  eq(lost(result, 'data', 'xl/charts/chart1.xml').length, 1);
});
