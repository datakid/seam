import { test, assert, env } from './harness.js';
import { docxEntries, xlsxEntries, pptxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';
import { damage, KINDS, caseSeed } from '../tools/damage.mjs';

const OUTCOMES = new Set(['noProblems', 'repaired', 'partial', 'salvaged', 'failed', 'notSupported']);
const TIME_BUDGET_MS = 20000;

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function outputBytes(result) {
  if (!result.output) return null;
  return result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

async function execute(name, bytes) {
  const buffer = bytes.slice().buffer;
  const started = performance.now();
  const result = await Promise.race([
    runPipeline({ name, size: buffer.byteLength, buffer, lastModified: 0 }, env),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), TIME_BUDGET_MS))
  ]);
  return { result, ms: performance.now() - started, buffer };
}

async function checkSubject(subject, other, seeds) {
  const problems = [];
  for (const kind of KINDS) {
    for (let index = 0; index < seeds; index++) {
      const id = `${subject.id}|${kind}|${index}`;
      const damaged = damage(subject.bytes, kind, caseSeed(subject.id, kind, index), kind === 'concat' ? { other: other.bytes } : null).bytes;
      const name = `${subject.id}.${subject.ext}`;
      const before = damaged.slice();
      const { result, ms, buffer } = await execute(name, damaged);
      if (result.timedOut) {
        problems.push(`${id}: exceeded ${TIME_BUDGET_MS} ms`);
        continue;
      }
      if (!OUTCOMES.has(result.outcome)) problems.push(`${id}: unknown outcome ${result.outcome}`);
      if ((result.findings || []).some((f) => f.code === 'INTERNAL_ERROR') || ms > TIME_BUDGET_MS) problems.push(`${id}: internal error or too slow`);
      if (!sameBytes(new Uint8Array(buffer), before)) problems.push(`${id}: input bytes changed`);
      const out = outputBytes(result);
      const losses = (result.findings || []).filter((f) => f.severity === 'loss');
      if (losses.length > 0 && (result.outcome === 'noProblems' || result.outcome === 'repaired')) problems.push(`${id}: ${result.outcome} with a loss finding (${losses[0].code})`);
      if (result.outcome === 'noProblems' && out) problems.push(`${id}: no problems but an output exists`);
      if (result.outcome === 'repaired') {
        if (!out) problems.push(`${id}: repaired without output`);
        else {
          const verdict = await verifyPackage(out, env, { key: result.detected.kind, ext: extensionOf(result.output.name) });
          if (!verdict.ok) problems.push(`${id}: repaired but verification fails (${JSON.stringify(verdict.failed)})`);
        }
      }
      if (out && ['repaired', 'partial', 'salvaged'].includes(result.outcome)) {
        const second = await execute(result.output.name, out);
        if (second.result.timedOut) problems.push(`${id}: second pass exceeded ${TIME_BUDGET_MS} ms`);
        else if (second.result.outcome !== 'noProblems') problems.push(`${id}: second pass gave ${second.result.outcome}`);
      }
    }
  }
  return problems;
}

const FIXTURES = [
  { id: 'fixture-docx', ext: 'docx', bytes: pack(docxEntries()) },
  { id: 'fixture-xlsx', ext: 'xlsx', bytes: pack(xlsxEntries()) },
  { id: 'fixture-pptx', ext: 'pptx', bytes: pack(pptxEntries()) }
];

for (let i = 0; i < FIXTURES.length; i++) {
  const subject = FIXTURES[i];
  test(`property: ${subject.id} survives every damage kind with honest labels`, async () => {
    const problems = await checkSubject(subject, FIXTURES[(i + 1) % FIXTURES.length], 2);
    assert(problems.length === 0, problems.slice(0, 6).join('; '));
  });
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const listing = await fetch('../corpus/manifest/property-set.json').then((r) => (r.ok ? r.json() : []), () => []);

for (let i = 0; i < listing.length; i++) {
  const entry = listing[i];
  test(`property: corpus file ${entry.id} survives every damage kind with honest labels`, async () => {
    const load = async (e) => {
      const response = await fetch(`../corpus/cache/files/${e.id}.${e.ext}`).catch(() => null);
      if (!response || !response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert((await sha256(bytes)) === e.sha256, `${e.id} hash differs from the manifest`);
      return { id: e.id, ext: e.ext, bytes };
    };
    const subject = await load(entry);
    if (!subject) {
      console.log(`SKIP property: ${entry.id} is not in corpus/cache/files`);
      return;
    }
    const other = (await load(listing[(i + 1) % listing.length])) || FIXTURES[0];
    const problems = await checkSubject(subject, other, 1);
    assert(problems.length === 0, problems.slice(0, 6).join('; '));
  });
}
