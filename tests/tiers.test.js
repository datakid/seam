import { test, assert, eq, env } from './harness.js';
import { docxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';
import { TIER_FAILED, TIER_STRUCTURAL, TIER_CONTENT, contentChecks, tierOf, tierFor, registerCheck } from '../js/core/tiers.js';

const CLEAN = { findings: [] };
const DANGLING = { findings: [{ code: 'REF_DANGLING', severity: 'loss', part: 'word/document.xml', data: { n: 1 } }] };

function reset() {
  registerCheck('schemaLite', null);
  registerCheck('familyRules', null);
}

test('tiers: the three levels are ordered', () => {
  eq([TIER_FAILED, TIER_STRUCTURAL, TIER_CONTENT], [0, 1, 2]);
});

test('tiers: a package that fails the structural checks is tier 0 whatever else is clean', () => {
  eq(tierOf(false, [{ id: 'references', state: 'clean' }]), TIER_FAILED);
});

test('tiers: tier 2 is unreachable while the schema check and family rules do not exist', () => {
  reset();
  const checks = contentChecks(CLEAN);
  eq(checks.map((c) => `${c.id}:${c.state}`), ['references:clean', 'schemaLite:unavailable', 'familyRules:unavailable']);
  eq(tierFor(CLEAN, true), TIER_STRUCTURAL);
});

test('tiers: tier 2 needs every content check clean', () => {
  reset();
  registerCheck('schemaLite', () => true);
  registerCheck('familyRules', () => true);
  eq(tierFor(CLEAN, true), TIER_CONTENT);
  registerCheck('familyRules', () => false);
  eq(tierFor(CLEAN, true), TIER_STRUCTURAL);
  registerCheck('familyRules', () => true);
  eq(tierFor(DANGLING, true), TIER_STRUCTURAL);
  eq(contentChecks(DANGLING)[0].state, 'dirty');
  reset();
});

test('tiers: a check that does not exist cannot be registered', () => {
  let threw = false;
  try {
    registerCheck('nonsense', () => true);
  } catch (error) {
    threw = true;
  }
  assert(threw, 'unknown id refused');
});

test('tiers: verifyPackage reports tier 1 for a sound package and tier 0 for a broken one', async () => {
  const whole = pack(docxEntries());
  eq((await verifyPackage(whole, env, { key: 'docx', ext: 'docx' })).tier, TIER_STRUCTURAL);
  eq((await verifyPackage(whole.slice(0, whole.length - 40), env, { key: 'docx', ext: 'docx' })).tier, TIER_FAILED);
});

test('tiers: a repaired package carries tier 1 and a healthy one carries none', async () => {
  reset();
  const whole = pack(docxEntries());
  const healthy = await runPipeline({ name: 'a.docx', size: whole.length, buffer: whole.slice().buffer }, env);
  eq(healthy.outcome, 'noProblems');
  eq(healthy.tier, undefined);
  const cut = whole.slice(0, whole.length - 30);
  const result = await runPipeline({ name: 'b.docx', size: cut.length, buffer: cut.slice().buffer }, env);
  assert(result.output, 'output produced');
  eq(result.tier, TIER_STRUCTURAL);
});
