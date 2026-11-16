import { resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const dirs = process.argv.slice(2).map((d) => resolve(d));
if (dirs.length < 2) {
  console.error('usage: node tools/compare-browsers.mjs <run-dir> <run-dir> [...]');
  process.exit(2);
}

const runs = dirs.map((dir) => {
  const data = JSON.parse(readFileSync(join(dir, 'seam.json'), 'utf8'));
  return { dir, browser: data.browser, cases: data.cases };
});

const base = runs[0];
const differences = [];
for (const [id, c] of Object.entries(base.cases)) {
  const codes = [...new Set(c.findings.map((f) => f.code))].sort().join(',');
  for (const other of runs.slice(1)) {
    const o = other.cases[id];
    if (!o) {
      differences.push(`${id}: missing in ${other.browser}`);
      continue;
    }
    const otherCodes = [...new Set(o.findings.map((f) => f.code))].sort().join(',');
    if (o.outcome !== c.outcome || otherCodes !== codes) differences.push(`${id}: ${base.browser} ${c.outcome} [${codes}] vs ${other.browser} ${o.outcome} [${otherCodes}]`);
  }
}

console.log(`${Object.keys(base.cases).length} cases across ${runs.map((r) => r.browser).join(', ')}: ${differences.length} differences`);
for (const line of differences.slice(0, 40)) console.log(`  ${line}`);
process.exit(differences.length === 0 ? 0 : 1);
