import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const browser = args[0];
const files = args.slice(1);
const lenient = new Set(['less-than in attribute', 'duplicate attribute', 'declaration', 'qualified name']);
const tolerant = browser === 'chromium' || browser === 'webkit';
const total = { files: 0, compared: 0, fallback: 0, tolerated: 0, unexpected: 0 };
const samples = [];
for (const file of files) {
  const cases = JSON.parse(readFileSync(file, 'utf8')).cases;
  for (const [id, entry] of Object.entries(cases)) {
    const checks = entry.checks;
    if (!checks) continue;
    total.files++;
    total.compared += checks.compared;
    total.fallback += checks.fallback;
    if (!checks.disagreements) continue;
    const excused = (s) => (tolerant && s.dom === true && lenient.has(s.reason)) || (browser === 'webkit' && s.dom === false && /not a valid URI/.test(s.message || ''));
    const allTolerated = checks.samples.length === checks.disagreements && checks.samples.every(excused);
    if (allTolerated) total.tolerated += checks.disagreements;
    else {
      total.unexpected += checks.disagreements;
      if (samples.length < 8) samples.push({ id, samples: checks.samples });
    }
  }
}
const rate = total.compared + total.fallback > 0 ? total.fallback / (total.compared + total.fallback) : 0;
console.log(`${browser}: ${JSON.stringify(total)} fallback rate ${(rate * 100).toFixed(3)}%`);
for (const sample of samples) console.log(JSON.stringify(sample).slice(0, 700));
process.exit(total.unexpected > 0 || total.files === 0 || rate > 0.01 ? 1 : 0);
