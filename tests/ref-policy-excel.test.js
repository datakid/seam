import { test, assert, eq, env } from './harness.js';
import { xlsxEntries, pptxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';

const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const MC_NS = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

async function run(name, bytes) {
  const copyOf = bytes.slice();
  return runPipeline({ name, size: copyOf.length, buffer: copyOf.buffer }, env);
}

function partText(result, name) {
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  return strFromU8(unzipSync(out)[name]);
}

function edit(entries, name, change) {
  return entries.map(([n, content]) => (n === name ? [n, change(content)] : [n, content]));
}

function inSheet(entries, extra) {
  return edit(entries, 'xl/worksheets/sheet1.xml', (t) => t.replace('<worksheet ', `<worksheet ${R_NS} `).replace('</sheetData>', `</sheetData>${extra}`));
}

function inWorkbook(entries, extra) {
  return edit(entries, 'xl/workbook.xml', (t) => t.replace('</sheets>', `</sheets>${extra}`));
}

function inSlide(entries, extra) {
  return edit(entries, 'ppt/slides/slide3.xml', (t) => t.replace('</p:cSld>', `</p:cSld>${extra}`));
}

function inSlideTree(entries, extra) {
  return edit(entries, 'ppt/slides/slide3.xml', (t) => t.replace('</p:spTree>', `</p:spTree>${extra}`));
}

function sheetRels(entries) {
  return [...entries, ['xl/worksheets/_rels/sheet1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://example.com" TargetMode="External"/></Relationships>']];
}

function trigger(entries) {
  return edit(entries, '[Content_Types].xml', (t) => t.replace('</Types>', '<Foo/></Types>'));
}

const damaged = (entries) => pack(trigger(entries));

function swept(result, part, count) {
  const finding = result.findings.find((f) => f.code === 'REF_REMOVED' && f.part === part);
  assert(finding, `REF_REMOVED for ${part}`);
  if (count !== undefined) eq(finding.data.n, count);
  assert(!result.findings.some((f) => f.code === 'REF_DANGLING'), 'no dangling reference left');
}

test('sweep: a page setup that points at lost printer settings loses only the link', async () => {
  const result = await run('s.xlsx', damaged(inSheet(xlsxEntries(), '<pageSetup orientation="portrait" r:id="rId7"/>')));
  swept(result, 'xl/worksheets/sheet1.xml', 1);
  const text = partText(result, 'xl/worksheets/sheet1.xml');
  assert(text.includes('<pageSetup orientation="portrait"/>'), 'element kept without the link');
});

test('sweep: table parts that point at lost tables are removed with their list', async () => {
  const result = await run('s.xlsx', damaged(inSheet(xlsxEntries(), '<tableParts count="2"><tablePart r:id="rId7"/><tablePart r:id="rId8"/></tableParts>')));
  swept(result, 'xl/worksheets/sheet1.xml', 2);
  assert(!partText(result, 'xl/worksheets/sheet1.xml').includes('tablePart'), 'list removed');
});

test('sweep: when some table parts survive the count follows', async () => {
  const entries = sheetRels(inSheet(xlsxEntries(), '<tableParts count="2"><tablePart r:id="rId1"/><tablePart r:id="rId7"/></tableParts>'));
  const result = await run('s.xlsx', damaged(entries));
  swept(result, 'xl/worksheets/sheet1.xml', 1);
  const text = partText(result, 'xl/worksheets/sheet1.xml');
  assert(text.includes('<tableParts count="1">'), 'count updated');
  assert(text.includes('rId1') && !text.includes('rId7'), 'surviving part kept');
});

test('sweep: a pivot cache that points at a lost cache is removed with its list', async () => {
  const result = await run('s.xlsx', damaged(inWorkbook(xlsxEntries(), '<pivotCaches><pivotCache cacheId="1" r:id="rId9"/></pivotCaches>')));
  swept(result, 'xl/workbook.xml', 1);
  assert(!partText(result, 'xl/workbook.xml').includes('pivotCache'), 'list removed');
});

test('sweep: a form control that points at lost data is removed with its wrapper and list', async () => {
  const control = '<control shapeId="1025" r:id="rId9" name="Check Box 1"/>';
  const extra = `<controls><mc:AlternateContent ${MC_NS}><mc:Choice Requires="x14">${control}</mc:Choice><mc:Fallback>${control}</mc:Fallback></mc:AlternateContent></controls>`;
  const result = await run('s.xlsx', damaged(inSheet(xlsxEntries(), extra)));
  swept(result, 'xl/worksheets/sheet1.xml');
  const text = partText(result, 'xl/worksheets/sheet1.xml');
  assert(!text.includes('control') && !text.includes('AlternateContent'), 'wrapper and list removed');
});

test('sweep: an external workbook reference that points at a lost link is removed with its list', async () => {
  const result = await run('s.xlsx', damaged(inWorkbook(xlsxEntries(), '<externalReferences><externalReference r:id="rId9"/></externalReferences>')));
  swept(result, 'xl/workbook.xml', 1);
  assert(!partText(result, 'xl/workbook.xml').includes('externalReference'), 'list removed');
});

test('sweep: an embedded object in a worksheet is removed with its wrapper and list', async () => {
  const ole = '<oleObject progId="Package" shapeId="1026" r:id="rId9"><objectPr defaultSize="0" r:id="rId10"/></oleObject>';
  const extra = `<oleObjects><mc:AlternateContent ${MC_NS}><mc:Choice Requires="x14">${ole}</mc:Choice><mc:Fallback>${ole}</mc:Fallback></mc:AlternateContent></oleObjects>`;
  const result = await run('s.xlsx', damaged(inSheet(xlsxEntries(), extra)));
  swept(result, 'xl/worksheets/sheet1.xml');
  const text = partText(result, 'xl/worksheets/sheet1.xml');
  assert(!text.includes('oleObject') && !text.includes('AlternateContent'), 'object, wrapper and list removed');
});

test('sweep: a transition sound that points at a lost file is removed with its action', async () => {
  const result = await run('s.pptx', damaged(inSlide(pptxEntries(), '<p:transition><p:sndAc><p:stSnd><p:snd r:embed="rId9" name="chime.wav"/></p:stSnd></p:sndAc></p:transition>')));
  swept(result, 'ppt/slides/slide3.xml');
  const text = partText(result, 'ppt/slides/slide3.xml');
  assert(!text.includes('sndAc') && !text.includes('p:snd'), 'sound removed');
  assert(text.includes('p:transition'), 'transition kept');
});

test('sweep: custom data tags that point at lost tags are removed with their list', async () => {
  const result = await run('s.pptx', damaged(inSlideTree(pptxEntries(), '<p:custDataLst><p:tags r:id="rId9"/></p:custDataLst>')));
  swept(result, 'ppt/slides/slide3.xml', 1);
  assert(!partText(result, 'ppt/slides/slide3.xml').includes('custDataLst'), 'list removed');
});

test('sweep: a reference to a relationship that exists is left alone', async () => {
  const entries = sheetRels(inSheet(xlsxEntries(), '<pageSetup orientation="portrait" r:id="rId1"/>'));
  const result = await run('s.xlsx', pack(entries));
  eq(result.outcome, 'noProblems');
  eq(result.findings.map((f) => f.code), []);
});
