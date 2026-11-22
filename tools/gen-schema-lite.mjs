import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { buildTable, tableText } from './lib/schema-lite-build.mjs';
import { collectDefaults, applyDefaults } from './lib/schema-lite-defaults.mjs';

const args = process.argv.slice(2);
function option(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

const sdk = option('sdk', null);
if (!sdk) {
  console.error('usage: node tools/gen-schema-lite.mjs --sdk <Open-XML-SDK checkout> [--out <file.js|file.json>] [--commit <sha>] [--drop <uri fragment,...>] [--corpus <dir of healthy packages>] [--report]');
  process.exit(2);
}
const out = resolve(option('out', 'js/core/data/schema-lite.js'));
let commit = option('commit', '');
if (!commit) {
  try {
    commit = execFileSync('git', ['-C', sdk, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    commit = 'unknown';
  }
}
const drops = option('drop', 'urn:schemas-microsoft-com:').split(',').filter(Boolean);
const patchPath = resolve(option('patches', 'tools/data/schema-lite-patches.json'));
let patches = {};
try {
  patches = JSON.parse(readFileSync(patchPath, 'utf8'));
} catch {}

const dir = join(sdk, 'data', 'schemas');
const schemas = readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
const namespaces = JSON.parse(readFileSync(join(sdk, 'data', 'namespaces.json'), 'utf8'));
const { table, stats } = buildTable({
  schemas,
  namespaces,
  source: { repo: 'dotnet/Open-XML-SDK', commit, licence: 'MIT' },
  dropNamespace: (ns) => drops.some((fragment) => ns.includes(fragment)),
  patches,
});
const corpus = option('corpus', '');
if (corpus) {
  const collected = collectDefaults(table, resolve(corpus));
  const applied = applyDefaults(table, collected);
  table.source.defaults = `most common value of each required attribute in ${collected.files} healthy packages`;
  console.log(`${applied} required attributes got a default from ${collected.files} healthy packages`);
}
const text = tableText(table, out);
writeFileSync(out, text);
console.log(`${stats.elements} elements, ${stats.types} content models, ${table.namespaces.length} namespaces, ${text.length} bytes`);
console.log(`${stats.ambiguous.length} element names have several definitions and are reached only through their parent; ${stats.conflicts.length} type conflicts; ${stats.open.length} open types`);
console.log(`patches applied: ${stats.patches.tolerated.length} tolerated elements, ${stats.patches.opened.length} opened${stats.patches.unknown.length > 0 ? `, ${stats.patches.unknown.length} not found (${stats.patches.unknown.join(', ')})` : ''}`);
if (stats.problems.length > 0) console.log(`problems: ${stats.problems.slice(0, 8).join('; ')}${stats.problems.length > 8 ? ` and ${stats.problems.length - 8} more` : ''}`);
if (args.includes('--report')) console.log(JSON.stringify({ ambiguous: stats.ambiguous, conflicts: stats.conflicts, open: stats.open }, null, 1));
