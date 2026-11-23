import { test, assert, eq, env } from './harness.js';
import { docxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';
import { TIER_FAILED, TIER_STRUCTURAL, TIER_CONTENT, contentChecks, tierOf, tierFor, registerCheck, checkRunner } from '../js/core/tiers.js';

const CLEAN = { findings: [] };
const DANGLING = { findings: [{ code: 'REF_DANGLING', severity: 'loss', part: 'word/document.xml', data: { n: 1 } }] };
const clean = (id) => ({ id, state: 'clean' });

test('tiers: the three levels are ordered', () => {
  eq([TIER_FAILED, TIER_STRUCTURAL, TIER_CONTENT], [0, 1, 2]);
});

test('tiers: a package that fails the structural checks is tier 0 whatever else is clean', () => {
  eq(tierOf(false, [clean('references')]), TIER_FAILED);
});

test('tiers: tier 2 needs every content check clean', () => {
  const all = [clean('references'), clean('schemaLite'), clean('familyRules')];
  eq(tierOf(true, all), TIER_CONTENT);
  eq(tierOf(true, [all[0], { id: 'schemaLite', state: 'dirty' }, all[2]]), TIER_STRUCTURAL);
  eq(tierOf(true, [all[0], all[1], { id: 'familyRules', state: 'unavailable' }]), TIER_STRUCTURAL);
});

test('tiers: the shipped checks are references, the schema and the family rules, and a missing table keeps tier 2 out of reach', () => {
  eq(contentChecks(CLEAN).map((c) => `${c.id}:${c.state}`), ['references:clean', 'schemaLite:dirty', 'familyRules:clean']);
  eq(tierFor(CLEAN, true), TIER_STRUCTURAL);
  eq(contentChecks(DANGLING)[0].state, 'dirty');
});

test('tiers: a registered check decides its own state and the original can be put back', () => {
  const saved = checkRunner('schemaLite');
  assert(typeof saved === 'function', 'the schema check is registered');
  registerCheck('schemaLite', () => true);
  eq(tierFor(CLEAN, true), TIER_CONTENT);
  eq(tierFor(DANGLING, true), TIER_STRUCTURAL);
  registerCheck('schemaLite', saved);
  eq(checkRunner('schemaLite'), saved);
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

test('tiers: a repaired package carries a tier of at least 1 and a healthy one carries none', async () => {
  const whole = pack(docxEntries());
  const healthy = await runPipeline({ name: 'a.docx', size: whole.length, buffer: whole.slice().buffer }, env);
  eq(healthy.outcome, 'noProblems');
  eq(healthy.tier, undefined);
  const cut = whole.slice(0, whole.length - 30);
  const result = await runPipeline({ name: 'b.docx', size: cut.length, buffer: cut.slice().buffer }, env);
  assert(result.output, 'output produced');
  assert(result.tier >= TIER_STRUCTURAL, `tier ${result.tier}`);
});
