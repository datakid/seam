import { test, assert, eq, env } from './harness.js';
import { docxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';

async function run(name, bytes) {
  const copyOf = bytes.slice();
  return runPipeline({ name, size: copyOf.length, buffer: copyOf.buffer }, env);
}

function files(result) {
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const zipped = unzipSync(out);
  return Object.fromEntries(Object.keys(zipped).map((name) => [name, strFromU8(zipped[name])]));
}

function edit(entries, name, change) {
  return entries.map(([entry, content]) => (entry === name ? [entry, change(content)] : [entry, content]));
}

const GARBLED = '<w:p><w:pPq><w:jc w:val="center"/></w:pPq><w:r><w:t>Centred</w:t></w:r></w:p>';

test('schema trim: a damaged element name in a part that was cut short is snapped back to the allowed name', async () => {
  const entries = edit(docxEntries(), 'word/document.xml', (text) => {
    const cut = text.indexOf('<w:body>') + '<w:body>'.length;
    return `${text.slice(0, cut)}${GARBLED}<w:p><w:r><w:t>Tail`;
  });
  const result = await run('sample.docx', pack(entries));
  assert(result.output, 'output produced');
  assert(result.findings.some((f) => f.code === 'XML_TRUNCATED_CLOSED'), 'part was cut short');
  const fixed = result.findings.find((f) => f.code === 'SCHEMA_NAMES_FIXED');
  assert(fixed && fixed.data.n >= 1, 'name fix reported');
  const text = files(result)['word/document.xml'];
  assert(text.includes('<w:pPr>') && !text.includes('pPq'), 'name restored');
  assert(text.includes('Centred'), 'text kept');
});

test('schema trim: the same garbled name in an intact part is not touched', async () => {
  const entries = edit(docxEntries(), 'word/document.xml', (text) => text.replace('<w:body>', `<w:body>${GARBLED}`));
  const result = await run('sample.docx', pack(entries));
  eq(result.outcome, 'noProblems');
});
