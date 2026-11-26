import { test, assert, eq, env } from './harness.js';
import { docxEntries, xlsxEntries, pptxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const OFFICE = 'application/vnd.openxmlformats-officedocument.';

async function run(name, bytes) {
  const copyOf = bytes.slice();
  return runPipeline({ name, size: copyOf.length, buffer: copyOf.buffer }, env);
}

function overrides(result) {
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const text = strFromU8(unzipSync(out)['[Content_Types].xml']);
  const map = new Map();
  for (const m of text.matchAll(/<Override\s[^>]*>/g)) map.set(/PartName="([^"]*)"/.exec(m[0])[1], /ContentType="([^"]*)"/.exec(m[0])[1]);
  return map;
}

function addRel(entries, relsPath, id, type, target) {
  return entries.map(([name, content]) => (name === relsPath ? [name, content.replace('</Relationships>', `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`)] : [name, content]));
}

test('content types: a part at a non-standard path gets the type its relationship names', async () => {
  const entries = addRel(docxEntries(), '_rels/.rels', 'rId9', `${R}custom-properties`, 'docProps/extra-custom.xml');
  entries.push(['docProps/extra-custom.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>']);
  const result = await run('sample.docx', pack(entries));
  eq(result.outcome, 'repaired');
  eq(overrides(result).get('/docProps/extra-custom.xml'), `${OFFICE}custom-properties+xml`);
  assert(result.findings.map((f) => f.code).includes('CT_OVERRIDE_ADDED'), 'added');
});

test('content types: a corrupted specific type is corrected to the one the relationship names', async () => {
  const entries = docxEntries().map(([name, content]) => (name === '[Content_Types].xml' ? [name, content.replace('core-properties+xml', 'core-propertieZ+xml')] : [name, content]));
  assert(entries.some(([n]) => n === 'docProps/core.xml'), 'fixture has core.xml');
  const result = await run('sample.docx', pack(entries));
  eq(result.outcome, 'repaired');
  eq(overrides(result).get('/docProps/core.xml'), 'application/vnd.openxmlformats-package.core-properties+xml');
  assert(result.findings.map((f) => f.code).includes('CT_OVERRIDE_FIXED'), 'fixed');
});

test('content types: a worksheet typed as a chartsheet is corrected through the workbook relationship', async () => {
  const entries = xlsxEntries().map(([name, content]) => (name === '[Content_Types].xml' ? [name, content.replace(/(PartName="\/xl\/worksheets\/sheet1.xml" ContentType=")[^"]*(")/, `$1${OFFICE}spreadsheetml.chartsheet+xml$2`)] : [name, content]));
  const result = await run('sample.xlsx', pack(entries));
  eq(result.outcome, 'repaired');
  eq(overrides(result).get('/xl/worksheets/sheet1.xml'), `${OFFICE}spreadsheetml.worksheet+xml`);
});

test('content types: a pptx slide typed as a layout is corrected through the presentation relationship', async () => {
  const entries = pptxEntries().map(([name, content]) => (name === '[Content_Types].xml' ? [name, content.replace(/(PartName="\/ppt\/slides\/slide1.xml" ContentType=")[^"]*(")/, `$1${OFFICE}presentationml.slideLayout+xml$2`)] : [name, content]));
  const result = await run('sample.pptx', pack(entries));
  eq(result.outcome, 'repaired');
  eq(overrides(result).get('/ppt/slides/slide1.xml'), `${OFFICE}presentationml.slide+xml`);
});

test('content types: a relationship type the registry does not know changes nothing', async () => {
  const entries = addRel(docxEntries(), '_rels/.rels', 'rId9', 'http://example.com/relationships/mystery', 'docProps/mystery.xml');
  entries.push(['docProps/mystery.xml', '<?xml version="1.0" encoding="UTF-8"?><mystery/>']);
  const result = await run('sample.docx', pack(entries));
  eq(result.findings.map((f) => f.code).filter((c) => c.startsWith('CT_')), []);
});

test('content types: a healthy package is left alone by the relationship pass', async () => {
  for (const [name, entries] of [['sample.docx', docxEntries()], ['sample.xlsx', xlsxEntries()], ['sample.pptx', pptxEntries()]]) {
    const result = await run(name, pack(entries));
    eq(result.outcome, 'noProblems', name);
  }
});

test('content types: an OLE object that is a legacy workbook keeps its own type', async () => {
  const entries = addRel(xlsxEntries(), 'xl/_rels/workbook.xml.rels', 'rId9', `${R}oleObject`, 'embeddings/old.xls').map(([name, content]) => (name === '[Content_Types].xml' ? [name, content.replace('</Types>', '<Default Extension="xls" ContentType="application/vnd.ms-excel"/></Types>')] : [name, content]));
  entries.push(['xl/embeddings/old.xls', 'legacy workbook bytes']);
  const result = await run('sample.xlsx', pack(entries));
  eq(result.outcome, 'noProblems');
  eq(result.findings.map((f) => f.code), []);
});

function withContentTypes(entries, edit) {
  return entries.map(([name, content]) => (name === '[Content_Types].xml' ? [name, edit(content)] : [name, content]));
}

function typesText(result) {
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  return strFromU8(unzipSync(out)['[Content_Types].xml']);
}

function everyEntryIsValid(text) {
  const entries = [...text.matchAll(/<(Default|Override)\b([^>]*)\/>/g)];
  assert(entries.length > 0, 'has entries');
  const names = new Set();
  for (const [, kind, attrs] of entries) {
    const pairs = [...attrs.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]);
    const allowed = kind === 'Default' ? ['Extension', 'ContentType'] : ['PartName', 'ContentType'];
    eq(pairs.map(([n]) => n).sort(), allowed.slice().sort(), `${kind} attributes`);
    const key = pairs.find(([n]) => n === allowed[0])[1].toLowerCase();
    assert(!names.has(`${kind}${key}`), `duplicate ${kind} ${key}`);
    names.add(`${kind}${key}`);
    assert(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(pairs.find(([n]) => n === 'ContentType')[1]), `content type of ${key}`);
  }
}

const GARBLED = [
  ['a Default with no extension', (t) => t.replace('<Default Extension="xml" ContentType="application/xml"/>', '<Default ContentType="application/xml"/>')],
  ['a Default with a garbled content type', (t) => t.replace(/(<Default Extension="rels" ContentType=")[^"]*(")/, '$1application/vnd.openxmlformats.-officedocumntT.presntTtion/ml.pritenrSettng=s$2')],
  ['a Default with a stray attribute', (t) => t.replace('<Default Extension="xml" ContentType="application/xml"/>', '<Default Extension="xml" ContentType="application/xml" PartNam="a/docProps/ppl.mlf"/>')],
  ['a duplicate Default extension', (t) => t.replace('<Default Extension="xml" ContentType="application/xml"/>', '<Default Extension="xml" ContentType="application/xml"/><Default Extension="XML" ContentType="text/xml"/>')],
  ['an unknown element', (t) => t.replace('</Types>', '<Foo Bar="1"/></Types>')],
  ['an Override with no part name', (t) => t.replace('</Types>', '<Override ContentType="application/xml"/></Types>')]
];

for (const [label, edit] of GARBLED) {
  for (const [key, entries] of [['docx', docxEntries], ['xlsx', xlsxEntries], ['pptx', pptxEntries]]) {
    test(`content types: ${label} is cleaned in a ${key}`, async () => {
      const result = await run(`sample.${key}`, pack(withContentTypes(entries(), edit)));
      eq(result.outcome, 'repaired');
      assert(result.findings.map((f) => f.code).includes('CT_ENTRIES_CLEANED'), 'cleaned');
      everyEntryIsValid(typesText(result));
    });
  }
}

test('content types: an override that names a non-ASCII part with percent-encoding is left alone', async () => {
  const entries = docxEntries().map(([name, content]) => (name === '[Content_Types].xml' ? [name, content.replace('</Types>', '<Override PartName="/word/Cort%C3%A1zar.xml" ContentType="application/xml"/></Types>')] : [name, content]));
  entries.push(['word/Cortázar.xml', '<?xml version="1.0" encoding="UTF-8"?><note/>']);
  const result = await run('sample.docx', pack(entries));
  eq(result.outcome, 'noProblems');
  eq(result.findings.map((f) => f.code), []);
});

test('content types: an override for a part with a space in its name, percent-encoded, is left alone', async () => {
  const entries = xlsxEntries().map(([name, content]) => (name === '[Content_Types].xml' ? [name, content.replace('</Types>', '<Override PartName="/xl/my%20notes.xml" ContentType="application/xml"/></Types>')] : [name, content]));
  entries.push(['xl/my notes.xml', '<?xml version="1.0" encoding="UTF-8"?><note/>']);
  const result = await run('sample.xlsx', pack(entries));
  eq(result.outcome, 'noProblems');
});

test('content types: an override added for a non-ASCII part is written percent-encoded', async () => {
  const entries = addRel(docxEntries(), '_rels/.rels', 'rId9', `${R}custom-properties`, 'docProps/extra-%C3%BC.xml');
  entries.push(['docProps/extra-ü.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>']);
  const result = await run('sample.docx', pack(entries));
  const names = [...overrides(result).keys()];
  assert(names.includes('/docProps/extra-%C3%BC.xml'), `got ${names.filter((n) => n.includes('extra')).join(',')}`);
});

function renameEntry(entries, from, to) {
  return entries.map(([name, content]) => (name === from ? [to, content] : [name, content]));
}

function outputNames(result) {
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  return Object.keys(unzipSync(out));
}

test('part names: a part spelled differently from its references takes their spelling', async () => {
  const entries = renameEntry(docxEntries(), 'docProps/core.xml', 'docProps/Core.xml');
  const result = await run('sample.docx', pack(entries));
  eq(result.outcome, 'repaired');
  const names = outputNames(result);
  assert(names.includes('docProps/core.xml'), 'uses the referenced spelling');
  assert(!names.includes('docProps/Core.xml'), 'drops the damaged spelling');
  const fixed = result.findings.find((f) => f.code === 'PART_NAME_CASE_FIXED');
  assert(fixed && fixed.data.n === 1, 'one part reported');
  eq(overrides(result).get('/docProps/core.xml'), 'application/vnd.openxmlformats-package.core-properties+xml');
});

test('part names: the repaired output is stable', async () => {
  const entries = renameEntry(docxEntries(), 'docProps/core.xml', 'docProps/Core.xml');
  const first = await run('sample.docx', pack(entries));
  const out = first.output.bytes instanceof Uint8Array ? first.output.bytes : new Uint8Array(first.output.bytes);
  const second = await run('sample.docx', out);
  eq(second.outcome, 'noProblems');
});

test('part names: matching spellings produce no finding', async () => {
  const result = await run('sample.docx', pack(docxEntries()));
  eq(result.outcome, 'noProblems');
  assert(!result.findings.some((f) => f.code === 'PART_NAME_CASE_FIXED'), 'no case finding');
});

test('part names: a part that nothing references keeps its name', async () => {
  const entries = docxEntries();
  entries.push(['word/Notes.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><x/>']);
  const result = await run('sample.docx', pack(entries));
  assert(!result.findings.some((f) => f.code === 'PART_NAME_CASE_FIXED'), 'no case finding');
});
