import { test, assert, eq, env } from './harness.js';
import { docxEntries, pptxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

async function run(name, bytes) {
  const copyOf = bytes.slice();
  return runPipeline({ name, size: copyOf.length, buffer: copyOf.buffer }, env);
}

function bytesOf(result) {
  return result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
}

function partText(result, name) {
  return strFromU8(unzipSync(bytesOf(result))[name]);
}

function withoutPart(entries, name) {
  return entries.filter(([n]) => n !== name);
}

function replaceIn(entries, name, from, to) {
  return entries.map(([n, content]) => (n === name ? [n, content.split(from).join(to)] : [n, content]));
}

test('relationships: a part whose relationships root is misspelled is corrected, and a second pass finds nothing', async () => {
  const rels = 'word/_rels/document.xml.rels';
  assert(docxEntries().some(([n]) => n === rels), 'fixture has document rels');
  const entries = replaceIn(replaceIn(docxEntries(), rels, '<Relationships', '<Reiationships'), rels, '</Relationships>', '</Reiationships>');
  const first = await run('sample.docx', pack(entries));
  assert(first.findings.map((f) => f.code).includes('RELS_ROOT_FIXED'), JSON.stringify(first.findings.map((f) => f.code)));
  assert(/<Relationships[\s>]/.test(partText(first, rels)) && !partText(first, rels).includes('Reiationships'), partText(first, rels).slice(0, 200));
  const second = await run('sample.docx', bytesOf(first));
  eq(second.outcome, 'noProblems');
});

test('relationships: a slide whose relationships root is misspelled keeps its layout link and is not relinked again', async () => {
  const rels = 'ppt/slides/_rels/slide1.xml.rels';
  assert(pptxEntries().some(([n]) => n === rels), 'fixture has slide rels');
  const entries = replaceIn(replaceIn(pptxEntries(), rels, '<Relationships', '<Relat2yesDips'), rels, '</Relationships>', '</Relat2yesDips>');
  const first = await run('sample.pptx', pack(entries));
  const codes = first.findings.map((f) => f.code);
  assert(codes.includes('RELS_ROOT_FIXED') && !codes.includes('PPTX_LAYOUT_RELINKED'), JSON.stringify(codes));
  const second = await run('sample.pptx', bytesOf(first));
  eq(second.outcome, 'noProblems');
});

test('content types: a rebuilt list types a part through its relationship, so a second pass finds nothing', async () => {
  const withExtra = docxEntries().map(([name, content]) => (name === '_rels/.rels' ? [name, content.replace('</Relationships>', `<Relationship Id="rId9" Type="${R}custom-properties" Target="docProps/extra-custom.xml"/></Relationships>`)] : [name, content]));
  withExtra.push(['docProps/extra-custom.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>']);
  const first = await run('sample.docx', pack(withoutPart(withExtra, '[Content_Types].xml')));
  assert(first.findings.map((f) => f.code).includes('CT_REBUILT'), JSON.stringify(first.findings.map((f) => f.code)));
  assert(partText(first, '[Content_Types].xml').includes('/docProps/extra-custom.xml'), partText(first, '[Content_Types].xml'));
  const second = await run('sample.docx', bytesOf(first));
  eq(second.outcome, 'noProblems');
});
