import { test, assert, eq, env } from './harness.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';
import { docxEntries, xlsxEntries, pptxEntries, pack, unpack } from './fixtures.js';
import { localEntry, removeEntry } from './corrupt.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';
import { isBorrowable } from '../js/core/donor.js';

async function run(name, bytes, donor) {
  const main = bytes.slice();
  const input = { name, size: main.length, buffer: main.buffer };
  if (donor) input.donor = { name: donor.name, buffer: donor.bytes.slice().buffer };
  return runPipeline(input, env);
}

function codes(result) {
  return result.findings.map((f) => f.code);
}

function borrowed(result) {
  return result.findings.filter((f) => f.code === 'DONOR_PART_BORROWED').map((f) => f.part).sort();
}

function lossCount(result) {
  return result.findings.filter((f) => f.severity === 'loss').length;
}

async function verified(result, key) {
  assert(result.output, `no output: ${result.outcome} ${JSON.stringify(codes(result))}`);
  const bytes = new Uint8Array(result.output.bytes);
  const verdict = await verifyPackage(bytes, env, { key, ext: key });
  assert(verdict.ok, `verification failed: ${JSON.stringify(verdict.failed)}`);
  return unzipSync(bytes);
}

function styledXlsx() {
  return xlsxEntries().map(([name, content]) => {
    if (name === 'xl/worksheets/sheet1.xml') return [name, content.replace('<c r="A2">', '<c r="A2" s="1">').replace('<c r="B2">', '<c r="B2" s="1">')];
    if (name === 'xl/styles.xml') return [name, content.replace('<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>', '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>')];
    return [name, content];
  });
}

function zeroIn(bytes, name) {
  const entry = localEntry(bytes, name);
  const out = bytes.slice();
  out.fill(0, entry.dataStart + 4, entry.dataStart + Math.max(8, entry.csize - 4));
  return out;
}

const without = (entries, ...names) => entries.filter(([name]) => !names.includes(name));

test('donor: only non-content parts may be borrowed', () => {
  for (const name of [
    'word/styles.xml', 'word/numbering.xml', 'word/fontTable.xml', 'word/settings.xml', 'word/webSettings.xml', 'word/theme/theme1.xml',
    'xl/styles.xml', 'xl/theme/theme1.xml', 'ppt/theme/theme2.xml', 'ppt/tableStyles.xml', 'ppt/slideLayouts/slideLayout3.xml',
    'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/_rels/slideLayout3.xml.rels', 'ppt/slideMasters/_rels/slideMaster1.xml.rels'
  ]) assert(isBorrowable(name), `should be borrowable: ${name}`);
  for (const name of [
    'word/document.xml', 'word/comments.xml', 'word/footnotes.xml', 'word/header1.xml', 'word/media/image1.png', 'word/_rels/document.xml.rels', 'word/vbaProject.bin',
    'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml', 'xl/calcChain.xml', 'xl/charts/chart1.xml', 'xl/drawings/drawing1.xml',
    'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/notesSlides/notesSlide1.xml', 'ppt/media/image1.png', 'ppt/embeddings/oleObject1.bin',
    '[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml'
  ]) assert(!isBorrowable(name), `must not be borrowable: ${name}`);
});

test('donor: a slide master and layouts that are gone come from the donor and the slides stay untouched', async () => {
  const healthy = pack(pptxEntries());
  const broken = pack(without(pptxEntries(), 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/slideLayout2.xml'));
  const alone = await run('Deck.pptx', broken);
  assert(['partial', 'salvaged'].includes(alone.outcome), `alone ${alone.outcome}`);
  const result = await run('Deck.pptx', broken, { name: 'Template.pptx', bytes: healthy });
  eq(result.outcome, 'repaired', JSON.stringify(codes(result)));
  eq(lossCount(result), 0);
  const names = borrowed(result);
  assert(names.includes('ppt/slideMasters/slideMaster1.xml') && names.includes('ppt/slideLayouts/slideLayout1.xml') && names.includes('ppt/slideLayouts/slideLayout2.xml'), names.join(','));
  assert(result.findings.filter((f) => f.code === 'DONOR_PART_BORROWED').every((f) => f.severity === 'noted' && f.data.from === 'Template.pptx'), 'noted and named');
  const parts = await verified(result, 'pptx');
  const original = Object.fromEntries(unpack(broken));
  for (const name of Object.keys(original)) {
    if (/^ppt\/slides\/slide\d\.xml$/.test(name)) eq(strFromU8(parts[name]), strFromU8(original[name]), `${name} changed`);
  }
});

test('donor: a workbook that lost its styles keeps its cell formats', async () => {
  const healthy = pack(styledXlsx());
  const broken = pack(without(styledXlsx(), 'xl/styles.xml'));
  const alone = await run('Book.xlsx', broken);
  assert(codes(alone).includes('XLSX_STYLE_CLEARED'), `alone ${JSON.stringify(codes(alone))}`);
  const result = await run('Book.xlsx', broken, { name: 'Last month.xlsx', bytes: healthy });
  assert(!codes(result).includes('XLSX_STYLE_CLEARED'), JSON.stringify(codes(result)));
  eq(borrowed(result), ['xl/styles.xml']);
  const parts = await verified(result, 'xlsx');
  assert(strFromU8(parts['xl/worksheets/sheet1.xml']).includes(' s="1"'), 'style references kept');
  eq(result.outcome, 'repaired');
});

test('donor: a damaged styles part is replaced and its own loss lines go away', async () => {
  const healthy = pack(docxEntries());
  const broken = zeroIn(healthy, 'word/styles.xml');
  const alone = await run('Letter.docx', broken);
  assert(alone.findings.some((f) => f.part === 'word/styles.xml' && f.severity === 'loss'), `alone ${JSON.stringify(codes(alone))}`);
  const result = await run('Letter.docx', broken, { name: 'Other letter.docx', bytes: healthy });
  eq(borrowed(result), ['word/styles.xml']);
  assert(!result.findings.some((f) => f.part === 'word/styles.xml' && f.severity === 'loss'), JSON.stringify(result.findings.map((f) => `${f.code}:${f.part}`)));
  eq(result.outcome, 'repaired');
  await verified(result, 'docx');
});

test('donor: text, cells, slides, comments and pictures are never taken from it', async () => {
  const healthy = pack(docxEntries());
  const noImage = pack(without(docxEntries(), 'word/media/image1.png'));
  const alone = await run('Letter.docx', noImage);
  const result = await run('Letter.docx', noImage, { name: 'Healthy.docx', bytes: healthy });
  eq(result.outcome, alone.outcome);
  eq(borrowed(result), []);
  eq(result.findings.filter((f) => f.code === 'DONOR_UNUSED').map((f) => f.data.why), ['nothing']);
  const parts = await verified(result, 'docx');
  assert(!parts['word/media/image1.png'], 'picture was not borrowed');
  const mainLost = pack(without(docxEntries(), 'word/document.xml'));
  const aloneMain = await run('Letter.docx', mainLost);
  const second = await run('Letter.docx', mainLost, { name: 'Healthy.docx', bytes: healthy });
  eq(second.outcome, aloneMain.outcome);
  eq(borrowed(second), []);
  eq(second.findings.filter((f) => f.code === 'DONOR_UNUSED').map((f) => f.data.why), ['nothing']);
});

test('donor: a part that is intact in the file is never replaced', async () => {
  const entries = docxEntries();
  const otherStyles = entries.map(([name, content]) => (name === 'word/styles.xml' ? [name, content.replace('<w:docDefaults/>', '<w:docDefaults/><w:style w:styleId="Extra"/>')] : [name, content]));
  const mine = pack(entries);
  const donor = pack(otherStyles);
  const broken = zeroIn(mine, 'docProps/core.xml');
  const result = await run('Letter.docx', broken, { name: 'Donor.docx', bytes: donor });
  eq(borrowed(result), []);
  const parts = await verified(result, 'docx');
  assert(!strFromU8(parts['word/styles.xml']).includes('Extra'), 'styles replaced');
});

test('donor: a part the file does not refer to is not borrowed', async () => {
  const withNumbering = docxEntries().map(([name, content]) => {
    if (name === '[Content_Types].xml') return [name, content.replace('</Types>', '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>')];
    if (name === 'word/_rels/document.xml.rels') return [name, content.replace('</Relationships>', '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>')];
    return [name, content];
  });
  withNumbering.push(['word/numbering.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>']);
  const donor = pack(withNumbering);
  const broken = pack(without(docxEntries(), 'word/styles.xml'));
  const result = await run('Letter.docx', broken, { name: 'Donor.docx', bytes: donor });
  eq(borrowed(result), ['word/styles.xml']);
  const parts = await verified(result, 'docx');
  assert(!parts['word/numbering.xml'], 'numbering was borrowed without a reference');
});

test('donor: a donor that is not a package or not the same kind is reported and ignored', async () => {
  const broken = pack(without(docxEntries(), 'word/styles.xml'));
  const alone = await run('Letter.docx', broken);
  const junk = await run('Letter.docx', broken, { name: 'Notes.docx', bytes: new TextEncoder().encode('%PDF-1.7 not a package') });
  eq(junk.outcome, alone.outcome);
  eq(junk.findings.filter((f) => f.code === 'DONOR_UNUSED').map((f) => f.data), [{ name: 'Notes.docx', why: 'unreadable' }]);
  const other = await run('Letter.docx', broken, { name: 'Book.xlsx', bytes: pack(styledXlsx()) });
  eq(other.outcome, alone.outcome);
  eq(other.findings.filter((f) => f.code === 'DONOR_UNUSED').map((f) => f.data.why), ['kind']);
  eq(borrowed(other), []);
});

test('donor: a damaged donor part is not used', async () => {
  const healthy = pack(docxEntries());
  const damagedDonor = zeroIn(healthy, 'word/styles.xml');
  const broken = pack(without(docxEntries(), 'word/styles.xml'));
  const result = await run('Letter.docx', broken, { name: 'Donor.docx', bytes: damagedDonor });
  eq(borrowed(result), []);
  eq(result.findings.filter((f) => f.code === 'DONOR_UNUSED').map((f) => f.data.why), ['nothing']);
});

test('donor: it works together with the removal of a part from the same zip by the helper', async () => {
  const healthy = pack(docxEntries());
  const broken = removeEntry(healthy, 'word/styles.xml');
  const result = await run('Letter.docx', broken, { name: 'Healthy.docx', bytes: healthy });
  eq(borrowed(result), ['word/styles.xml']);
  eq(result.outcome, 'repaired');
});
