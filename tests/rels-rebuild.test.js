import { test, assert, eq, env } from './harness.js';
import { docxEntries, xlsxEntries, pptxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';

async function run(name, entries) {
  const bytes = pack(entries).slice();
  return runPipeline({ name, size: bytes.length, buffer: bytes.buffer }, env);
}

const without = (entries, ...names) => entries.filter(([name]) => !names.includes(name));
const codes = (result) => result.findings.map((f) => f.code);

function files(result) {
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  return unzipSync(out);
}

const text = (result, name) => strFromU8(files(result)[name]);

async function verified(result, key) {
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const verdict = await verifyPackage(out, env, { key, ext: key });
  assert(verdict.ok, JSON.stringify(verdict.failed));
}

const PPTX_RELS = ['ppt/_rels/presentation.xml.rels', 'ppt/slideMasters/_rels/slideMaster1.xml.rels', 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', 'ppt/slideLayouts/_rels/slideLayout2.xml.rels'];

test('rels rebuild: a deck that lost the relationships of its presentation, master and layouts gets them back from the names of its parts', async () => {
  const result = await run('d.pptx', without(pptxEntries(), '_rels/.rels', ...PPTX_RELS));
  assert(result.output, JSON.stringify(codes(result)));
  eq(result.outcome, 'repaired', JSON.stringify(codes(result)));
  assert(codes(result).includes('RELS_REBUILT') && codes(result).includes('PPTX_SLIDE_ORDER_GUESSED'), JSON.stringify(codes(result)));
  const presentation = text(result, 'ppt/_rels/presentation.xml.rels');
  assert(presentation.includes('Id="rId1"') && presentation.includes('Target="slideMasters/slideMaster1.xml"'), presentation);
  for (const [id, slide] of [['rId2', 'slide1'], ['rId3', 'slide2'], ['rId4', 'slide3']]) {
    assert(presentation.includes(`Id="${id}"`) && presentation.includes(`Target="slides/${slide}.xml"`), `${id} to ${slide}`);
  }
  assert(presentation.includes('Target="theme/theme1.xml"'), 'theme linked');
  const master = text(result, 'ppt/slideMasters/_rels/slideMaster1.xml.rels');
  assert(master.includes('Id="rId1"') && master.includes('slideLayout1.xml') && master.includes('Id="rId2"') && master.includes('slideLayout2.xml'), master);
  assert(text(result, 'ppt/slideLayouts/_rels/slideLayout2.xml.rels').includes('Target="../slideMasters/slideMaster1.xml"'), 'layout points at its master');
  eq(result.findings.filter((f) => f.code === 'PPTX_SLIDE_REMOVED').length, 0);
  await verified(result, 'pptx');
});

test('rels rebuild: with two masters the layouts are shared out in file order by the number each master lists', async () => {
  const entries = pptxEntries();
  const two = entries.map(([name, content]) => {
    if (name === 'ppt/slideMasters/slideMaster1.xml') return [name, content.replace('<p:sldLayoutId id="2147483650" r:id="rId2"/>', '')];
    return [name, content];
  });
  const master2 = two.find(([name]) => name === 'ppt/slideMasters/slideMaster1.xml')[1].replace('<p:sldLayoutId id="2147483649" r:id="rId1"/>', '<p:sldLayoutId id="2147483651" r:id="rId1"/>');
  const extended = [...two, ['ppt/slideMasters/slideMaster2.xml', master2]];
  const result = await run('d.pptx', without(extended, ...PPTX_RELS));
  assert(result.output, JSON.stringify(codes(result)));
  assert(text(result, 'ppt/slideMasters/_rels/slideMaster1.xml.rels').includes('slideLayout1.xml'), 'master 1 has the first layout');
  assert(text(result, 'ppt/slideMasters/_rels/slideMaster2.xml.rels').includes('slideLayout2.xml'), 'master 2 has the second');
  assert(text(result, 'ppt/slideLayouts/_rels/slideLayout2.xml.rels').includes('slideMaster2.xml'), 'layout 2 points at master 2');
});

test('rels rebuild: a deck that lost its presentation part is given a new one that lists the masters and slides that remain', async () => {
  const result = await run('d.pptx', without(pptxEntries(), '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'));
  assert(result.output, JSON.stringify(codes(result)));
  eq(result.outcome, 'partial', JSON.stringify(codes(result)));
  const note = result.findings.find((f) => f.code === 'PPTX_PRESENTATION_REBUILT');
  assert(note, JSON.stringify(codes(result)));
  eq(note.severity, 'loss');
  eq(note.data.n, 3);
  const presentation = text(result, 'ppt/presentation.xml');
  eq((presentation.match(/<p:sldId /g) || []).length, 3);
  assert(presentation.includes('<p:sldMasterId id="2147483651"'), 'master id above every layout id');
  assert(presentation.includes('cx="9144000" cy="6858000"'), 'four to three when nothing says otherwise');
  assert(text(result, 'ppt/slides/slide2.xml').includes('Slide 2'), 'slide content kept');
  await verified(result, 'pptx');
});

test('rels rebuild: a workbook that lost its relationships gets its sheets and styles linked again', async () => {
  const result = await run('w.xlsx', without(xlsxEntries(), 'xl/_rels/workbook.xml.rels'));
  assert(result.output, JSON.stringify(codes(result)));
  assert(codes(result).includes('RELS_REBUILT'), JSON.stringify(codes(result)));
  const rels = text(result, 'xl/_rels/workbook.xml.rels');
  assert(rels.includes('Target="worksheets/sheet1.xml"') && rels.includes('Target="worksheets/sheet2.xml"'), rels);
  assert(rels.includes('Target="styles.xml"') && rels.includes('Target="sharedStrings.xml"'), rels);
  eq(text(result, 'xl/workbook.xml').match(/<sheet /g).length, 2);
  await verified(result, 'xlsx');
});

test('rels rebuild: a workbook that lost its workbook part is given a new one with numbered sheet names, and the loss is reported', async () => {
  const result = await run('w.xlsx', without(xlsxEntries(), '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels'));
  assert(result.output, JSON.stringify(codes(result)));
  eq(result.outcome, 'partial', JSON.stringify(codes(result)));
  const note = result.findings.find((f) => f.code === 'XLSX_WORKBOOK_REBUILT');
  assert(note, JSON.stringify(codes(result)));
  eq(note.severity, 'loss');
  eq(note.data.n, 2);
  const workbook = text(result, 'xl/workbook.xml');
  assert(workbook.includes('name="Sheet1"') && workbook.includes('name="Sheet2"'), workbook);
  assert(text(result, 'xl/worksheets/sheet1.xml').includes('<sheetData>'), 'sheet data kept');
  await verified(result, 'xlsx');
});

test('rels rebuild: a document that lost its relationships keeps its styles', async () => {
  const result = await run('d.docx', without(docxEntries(), 'word/_rels/document.xml.rels'));
  assert(result.output, JSON.stringify(codes(result)));
  assert(codes(result).includes('RELS_REBUILT'), JSON.stringify(codes(result)));
  const rels = text(result, 'word/_rels/document.xml.rels');
  assert(rels.includes('Target="styles.xml"'), rels);
  await verified(result, 'docx');
});

test('rels rebuild: a package whose relationships are all there is left alone', async () => {
  for (const [name, entries] of [['a.docx', docxEntries()], ['a.xlsx', xlsxEntries()], ['a.pptx', pptxEntries()]]) {
    const result = await run(name, entries);
    assert(!codes(result).includes('RELS_REBUILT') && !codes(result).includes('XLSX_WORKBOOK_REBUILT') && !codes(result).includes('PPTX_PRESENTATION_REBUILT'), `${name} ${JSON.stringify(codes(result))}`);
  }
});
