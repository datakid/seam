import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { runSeam } from './run-seam.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const runDir = resolve(root, flag('run', 'results/work/damaged'));
const browserName = flag('browser', 'chromium');
const first = JSON.parse(readFileSync(join(runDir, 'seam.json'), 'utf8')).cases;
const failures = [];

for (const [id, c] of Object.entries(first)) {
  if (c.outcome === 'timeout') failures.push(`${id}: timed out`);
  else if (c.outcome === 'harness-error') failures.push(`${id}: threw ${c.error}`);
  else if (c.findings.some((f) => f.code === 'INTERNAL_ERROR')) failures.push(`${id}: internal error`);
}
const neverThrows = failures.length;

const secondDir = join(runDir, 'second-pass');
rmSync(secondDir, { recursive: true, force: true });
const outputsDir = join(runDir, 'outputs');
let second = { cases: {} };
if (existsSync(outputsDir)) {
  second = await runSeam({ input: outputsDir, output: secondDir, browserName, timeoutMs: 60000, pages: Number(flag('pages', '1')) });
}
let checked = 0;
for (const [id, c] of Object.entries(second.cases)) {
  if (id.endsWith('.extra')) continue;
  checked++;
  if (c.outcome !== 'noProblems') failures.push(`${id}: second pass gave ${c.outcome}`);
}

console.log(`never throws or hangs: ${neverThrows === 0 ? 'pass' : `${neverThrows} failures`} (${Object.keys(first).length} cases)`);
console.log(`second pass reports no problems: ${failures.length === neverThrows ? 'pass' : `${failures.length - neverThrows} failures`} (${checked} outputs)`);
for (const line of failures.slice(0, 30)) console.log(`  ${line}`);
process.exit(failures.length === 0 ? 0 : 1);
