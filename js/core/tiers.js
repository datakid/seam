export const TIER_FAILED = 0;
export const TIER_STRUCTURAL = 1;
export const TIER_CONTENT = 2;

const CHECKS = [
  { id: 'references', run: (ctx) => !ctx.findings.some((f) => f.code === 'REF_DANGLING') },
  { id: 'schemaLite', run: null },
  { id: 'familyRules', run: () => true }
];

export function registerCheck(id, run) {
  const check = CHECKS.find((entry) => entry.id === id);
  if (!check) throw new Error(`unknown content check ${id}`);
  check.run = run;
}

export function checkRunner(id) {
  const check = CHECKS.find((entry) => entry.id === id);
  return check ? check.run : null;
}

export function contentChecks(ctx) {
  return CHECKS.map(({ id, run }) => ({ id, state: run === null ? 'unavailable' : run(ctx) ? 'clean' : 'dirty' }));
}

export function tierOf(structuralOk, checks) {
  if (!structuralOk) return TIER_FAILED;
  return checks.every((check) => check.state === 'clean') ? TIER_CONTENT : TIER_STRUCTURAL;
}

export function tierFor(ctx, structuralOk) {
  return tierOf(structuralOk, contentChecks(ctx));
}
