import { test, assert, eq, env } from './harness.js';
import { docxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

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

test('namespace repair: a damaged content types namespace is restored and the part is kept', async () => {
  const entries = edit(docxEntries(), '[Content_Types].xml', (t) => t.replace(CT_NS, 'hdh eenytp'));
  const result = await run('sample.docx', pack(entries));
  assert(result.output, 'output produced');
  const fixed = result.findings.find((f) => f.code === 'XML_NAMESPACE_FIXED');
  assert(fixed && fixed.data.n === 1, 'namespace repair reported once');
  assert(!result.findings.some((f) => f.code === 'XML_UNRECOVERABLE'), 'nothing removed');
  assert(files(result)['[Content_Types].xml'].includes(`xmlns="${CT_NS}"`), 'namespace restored');
});

test('namespace repair: a damaged prefixed namespace in the main part is repaired and the text survives', async () => {
  const entries = edit(docxEntries(), 'word/document.xml', (t) => t.replace('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"', 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships&quot;"'));
  const result = await run('sample.docx', pack(entries));
  assert(result.output, 'output produced');
  assert(result.findings.some((f) => f.code === 'XML_NAMESPACE_FIXED'), 'namespace repair reported');
  assert(!result.findings.some((f) => f.code === 'XML_UNRECOVERABLE'), 'nothing removed');
  assert(files(result)['word/document.xml'].includes('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'), 'namespace restored');
});

test('namespace repair: intact files get no namespace finding', async () => {
  const result = await run('sample.docx', pack(docxEntries()));
  eq(result.outcome, 'noProblems');
});

test('declaration repair: a damaged encoding name is corrected before the engine sees the part', async () => {
  const entries = edit(docxEntries(), 'docProps/core.xml', (t) => t.replace(/encoding="[^"]*"/, 'encoding="WTF-8"'));
  assert(entries.some(([n, c]) => n === 'docProps/core.xml' && c.includes('WTF-8')), 'fixture carries the damage');
  const result = await run('sample.docx', pack(entries));
  eq(result.outcome, 'repaired');
  const fixed = result.findings.find((f) => f.code === 'XML_DECLARATION_FIXED');
  assert(fixed && fixed.part === 'docProps/core.xml', 'reported on the part');
  assert(!result.findings.some((f) => f.code === 'XML_UNRECOVERABLE'), 'nothing removed');
  assert(files(result)['docProps/core.xml'].includes('encoding="UTF-8"'), 'declares UTF-8');
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const second = await run('sample.docx', out);
  eq(second.outcome, 'noProblems');
});

test('declaration repair: a usual encoding name is not a finding', async () => {
  const entries = edit(docxEntries(), 'docProps/core.xml', (t) => t.replace(/encoding="[^"]*"/, 'encoding="utf-8"'));
  const result = await run('sample.docx', pack(entries));
  eq(result.outcome, 'noProblems');
});
