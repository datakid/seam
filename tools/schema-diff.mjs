import { readFileSync, readdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from '../vendor/fflate.module.js';
import { parseTree, documentElement } from '../js/core/xml-repair.js';
import { findViolations } from '../js/core/schema-close.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const tablePath = flag('table', null);
if (!tablePath) {
  console.error('usage: node tools/schema-diff.mjs --table <schema-lite.json|.js> [--corpus dir] [--scoreboard scoreboard.json] [--top 15]');
  process.exit(2);
}
const corpus = resolve(flag('corpus', 'corpus/cache/files'));
const top = Number(flag('top', '15'));
const scoreboardPath = flag('scoreboard', null);

async function loadTable(path) {
  const full = resolve(path);
  if (extname(full) === '.json') return JSON.parse(readFileSync(full, 'utf8'));
  const module = await import(pathToFileURL(full).href);
  return module.SCHEMA_LITE || module.default;
}

function decode(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  return new TextDecoder('utf-8').decode(bytes);
}

const table = await loadTable(tablePath);
const groups = new Map();
const perFile = {};
let files = 0;
let parts = 0;
let partsWithViolations = 0;

for (const name of readdirSync(corpus)) {
  if (!/\.(docx|docm|dotx|dotm|xlsx|xlsm|xltx|xltm|pptx|pptm|potx|potm|ppsx|ppsm)$/i.test(name)) continue;
  let zip;
  try {
    zip = unzipSync(new Uint8Array(readFileSync(resolve(corpus, name))), { filter: (f) => /^(word|xl|ppt)\/.*\.xml$/.test(f.name) && f.originalSize < 3e6 });
  } catch {
    continue;
  }
  files++;
  const id = name.replace(/\.[^.]+$/, '');
  for (const [partName, data] of Object.entries(zip)) {
    let root;
    try {
      root = documentElement(parseTree(decode(data)));
    } catch {
      continue;
    }
    if (!root) continue;
    parts++;
    const found = findViolations(root, table, 50);
    if (found.length > 0) {
      partsWithViolations++;
      perFile[id] = (perFile[id] || 0) + found.length;
    }
    for (const v of found) {
      const key = `${v.problem} ${v.element}>${v.child}`.slice(0, 100);
      const entry = groups.get(key) || { n: 0, example: `${name}:${partName}` };
      entry.n++;
      groups.set(key, entry);
    }
  }
}

console.log(`files ${files}, xml parts ${parts}, parts with a violation ${partsWithViolations}, files with a violation ${Object.keys(perFile).length}`);
for (const [key, entry] of [...groups.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, top)) console.log(`${String(entry.n).padStart(6)}  ${key.padEnd(60)} ${entry.example.slice(0, 70)}`);

if (scoreboardPath) {
  const board = JSON.parse(readFileSync(resolve(scoreboardPath), 'utf8'));
  const rows = (board.healthyCases || []).filter((r) => r.oxml && r.oxml.opens);
  let both = 0;
  let onlyTable = 0;
  let onlySdk = 0;
  let neither = 0;
  for (const r of rows) {
    const sdk = r.oxml.errors > 0;
    const mine = Boolean(perFile[r.id]);
    if (sdk && mine) both++;
    else if (mine) onlyTable++;
    else if (sdk) onlySdk++;
    else neither++;
  }
  console.log('');
  console.log(`agreement with the SDK's errors on ${rows.length} healthy files it opens`);
  console.log(`  table flags and SDK errors   ${both}`);
  console.log(`  table flags only             ${onlyTable}`);
  console.log(`  SDK errors only              ${onlySdk}`);
  console.log(`  neither                      ${neither}`);
  console.log(`  agreement ${(((both + neither) / rows.length) * 100).toFixed(1)}%, of the files the table flags the SDK also errors on ${both + onlyTable === 0 ? 'n/a' : ((both / (both + onlyTable)) * 100).toFixed(0) + '%'}`);
}
