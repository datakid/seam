import { registry } from './harness.js';

const files = [
  './copy.test.js',
  './static.test.js',
  './identify.test.js',
  './fixtures.test.js',
  './healthy.test.js',
  './zip.test.js',
  './inflate.test.js',
  './holes.test.js',
  './zip-hardening.test.js',
  './copies.test.js',
  './donor.test.js',
  './orphans.test.js',
  './crlf-restore.test.js',
  './cutback.test.js',
  './tiers.test.js',
  './parts.test.js',
  './ct-fix.test.js',
  './idempotence.test.js',
  './xlsx-rules.test.js',
  './schema-close.test.js',
  './schema-fill.test.js',
  './schema-check.test.js',
  './rels-rebuild.test.js',
  './notes-rule.test.js',
  './parts-extra.test.js',
  './ref-policy-excel.test.js',
  './refsweep.test.js',
  './xml.test.js',
  './package.test.js',
  './property.test.js',
  './salvage.test.js',
  './pipeline.test.js',
  './report.test.js',
  './theme.test.js',
  './queue.test.js',
  './ui.test.js'
];

const only = new URLSearchParams(location.search).get('only');
const out = document.getElementById('out');

function log(line) {
  console.log(line);
  out.textContent += line + '\n';
}

for (const file of files) {
  if (only && !only.split(',').some((name) => file.includes(name))) continue;
  try {
    await import(file);
  } catch (error) {
    if (error && /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/.test(String(error.message))) continue;
    log(`FAIL load ${file}: ${error && error.message}`);
  }
}

let pass = 0;
let fail = 0;
for (const { name, fn } of registry) {
  try {
    await fn();
    pass++;
    log(`PASS ${name}`);
  } catch (error) {
    fail++;
    log(`FAIL ${name}: ${error && error.message ? error.message : error}`);
  }
}
log(`RESULT pass=${pass} fail=${fail}`);
