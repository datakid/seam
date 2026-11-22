import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from '../vendor/fflate.module.js';
import { parseTree } from '../js/core/xml-repair.js';
import { readTableFile } from './lib/schema-lite-build.mjs';
import { openTable, checkTree } from '../js/core/schema-fit.js';

const args = process.argv.slice(2);
function option(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

const tablePath = resolve(option('table', 'js/core/data/schema-lite.js'));
const dir = resolve(option('files', 'corpus/cache/files'));
const outPath = option('out', '');
const sampleCount = Number(option('samples', '3'));
const table = openTable(readTableFile(tablePath));
const manifestPath = resolve(option('manifest', 'corpus/manifest/healthy.json'));
const producers = new Map();
try {
  for (const entry of JSON.parse(readFileSync(manifestPath, 'utf8'))) producers.set(`${entry.id}.${entry.ext}`, entry.producerClass || 'unknown');
} catch {}
const officeClasses = new Set(['excel', 'word', 'powerpoint']);

function decode(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return new TextDecoder('utf-8').decode(bytes);
}

const groups = new Map();
let files = 0;
let parts = 0;
let checked = 0;
let constrained = 0;
let hardFiles = 0;
let orderOnlyFiles = 0;
let flaggedFiles = 0;
let flaggedParts = 0;
let unreadable = 0;

for (const name of readdirSync(dir).sort()) {
  if (!/\.(docx|docm|dotx|dotm|xlsx|xlsm|xltx|xltm|pptx|pptm|potx|potm|ppsx|ppsm)$/i.test(name)) continue;
  let entries;
  try {
    entries = unzipSync(new Uint8Array(readFileSync(join(dir, name))), { filter: (file) => /\.(xml|vml)$/i.test(file.name) });
  } catch {
    unreadable++;
    continue;
  }
  files++;
  let flagged = false;
  let hard = false;
  for (const [part, bytes] of Object.entries(entries)) {
    parts++;
    let tree;
    try {
      tree = parseTree(decode(bytes));
    } catch {
      continue;
    }
    const result = checkTree(table, tree);
    checked += result.checked;
    constrained += result.constrained;
    if (result.findings.length > 0) {
      flagged = true;
      flaggedParts++;
    }
    for (const finding of result.findings) {
      if (finding.kind !== 'order') hard = true;
      const key = [finding.kind, finding.name, finding.found || '', finding.expected.join(' | ')].join('\u0001');
      let group = groups.get(key);
      if (!group) {
        group = { kind: finding.kind, element: finding.name, found: finding.found, expected: finding.expected, count: 0, files: new Set(), officeFiles: new Set(), samples: [] };
        groups.set(key, group);
      }
      group.count++;
      group.files.add(name);
      if (officeClasses.has(producers.get(name))) group.officeFiles.add(name);
      if (group.samples.length < sampleCount) group.samples.push({ file: name, part, path: finding.path, near: finding.near ? finding.near.join(' ') : '' });
    }
  }
  if (flagged) flaggedFiles++;
  if (hard) hardFiles++;
  else if (flagged) orderOnlyFiles++;
}

const ordered = [...groups.values()].sort((a, b) => b.officeFiles.size - a.officeFiles.size || b.files.size - a.files.size || b.count - a.count);
const officeOnly = ordered.filter((g) => g.officeFiles.size > 0);
console.log(`${files} files (${unreadable} unreadable), ${parts} parts, ${checked} elements checked against the table, ${constrained} of them with a required child or attribute`);
console.log(`${hardFiles} files with a missing, unexpected or repeated child or a missing attribute, ${orderOnlyFiles} more with child order only`);
console.log(`${flaggedFiles} files and ${flaggedParts} parts have at least one disagreement; ${ordered.length} distinct disagreements, ${officeOnly.length} of them in files written by Word, Excel or PowerPoint`);
for (const group of ordered.slice(0, Number(option('top', '40')))) {
  console.log(`\n${group.kind} in <${group.element}>${group.found ? ` at <${group.found}>` : ''}: expected ${group.expected.join(' | ') || '(nothing more)'}`);
  console.log(`  ${group.count} times in ${group.files.size} files (${group.officeFiles.size} written by Office), e.g. ${group.samples.map((s) => `${s.file} ${s.part} ${s.path} near [${s.near}]`).join('; ')}`);
}
if (outPath) {
  writeFileSync(
    outPath,
    JSON.stringify(
      ordered.map((g) => ({ ...g, files: [...g.files], officeFiles: [...g.officeFiles] })),
      null,
      1,
    ),
  );
}
if (args.includes('--strict') && ordered.length > 0) process.exit(1);
