import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, copyFileSync } from 'node:fs';
import { sha256 } from './corpus-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const cacheDir = join(root, 'corpus', 'cache');
const filesDir = join(cacheDir, 'files');
const wildDir = join(cacheDir, 'wild');
const set = flag('set', 'healthy');
const reportOnly = args.includes('--report') && args.includes('--no-download');

const GATE_CLASSES = [
  ['word', 'Word'],
  ['excel', 'Excel'],
  ['powerpoint', 'PowerPoint'],
  ['libreoffice', 'LibreOffice'],
  ['google', 'Google'],
  ['apple', 'Apple'],
  ['wps', 'WPS'],
  ['python', 'python-docx, openpyxl or python-pptx'],
  ['poi', 'Apache POI']
];
const GATE_FEATURES = ['charts', 'comments', 'trackedChanges', 'embeddings', 'macros', 'pivot', 'smartart', 'video', 'bigPart'];

export function loadManifest(which) {
  const file = join(root, 'corpus', 'manifest', which === 'wild' ? 'wild-public.json' : 'healthy.json');
  const entries = JSON.parse(readFileSync(file, 'utf8'));
  if (which !== 'wild') {
    const generated = join(cacheDir, 'generated', 'manifest.json');
    if (existsSync(generated)) entries.push(...JSON.parse(readFileSync(generated, 'utf8')));
  }
  return entries;
}

export function cachePath(entry) {
  return join(entry.broken ? wildDir : filesDir, `${entry.id}.${entry.ext}`);
}

async function download(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
      last = new Error(`${response.status}`);
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw last;
}

export function coverage(entries) {
  const healthy = entries.filter((e) => !e.broken);
  const classes = {};
  for (const e of healthy) classes[e.producerClass] = (classes[e.producerClass] || 0) + 1;
  const features = {};
  for (const e of healthy) for (const f of e.features) features[f] = (features[f] || 0) + 1;
  const families = {};
  for (const e of healthy) families[e.family] = (families[e.family] || 0) + 1;
  const gaps = [];
  for (const [key, label] of GATE_CLASSES) if ((classes[key] || 0) < 5) gaps.push(`${label}: ${classes[key] || 0} of 5 files`);
  for (const f of GATE_FEATURES) if ((features[f] || 0) < 3) gaps.push(`feature ${f}: ${features[f] || 0} of 3 files`);
  for (const fam of ['docx', 'xlsx', 'pptx']) if ((families[fam] || 0) < 80) gaps.push(`${fam}: ${families[fam] || 0} of 80 files`);
  return { total: healthy.length, families, classes, features, gaps };
}

async function main() {
  const entries = loadManifest(set);
  mkdirSync(filesDir, { recursive: true });
  mkdirSync(wildDir, { recursive: true });
  const todo = entries.filter((e) => !e.generated);
  if (!reportOnly) {
    for (const e of entries.filter((x) => x.generated)) {
      const source = join(cacheDir, 'generated', `${e.id}.${e.ext}`);
      if (existsSync(source)) copyFileSync(source, cachePath(e));
    }
  }
  let bad = [];
  let fetched = 0;
  if (!reportOnly) {
    let next = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (next < todo.length) {
        const e = todo[next++];
        const target = cachePath(e);
        if (existsSync(target) && sha256(readFileSync(target)) === e.sha256) continue;
        try {
          const bytes = await download(e.url);
          if (sha256(bytes) !== e.sha256) {
            bad.push(`${e.id}: hash changed`);
            continue;
          }
          writeFileSync(target, bytes);
          fetched++;
        } catch (error) {
          bad.push(`${e.id}: ${error.message}`);
        }
      }
    }));
  }
  if (!reportOnly) {
    const dir = set === 'wild' ? wildDir : filesDir;
    const keep = new Set(entries.map((e) => `${e.id}.${e.ext}`));
    let pruned = 0;
    for (const name of readdirSync(dir)) {
      if (!keep.has(name)) {
        unlinkSync(join(dir, name));
        pruned++;
      }
    }
    if (pruned > 0) console.log(`pruned ${pruned} files not in the manifest`);
  }
  const report = coverage(entries);
  writeFileSync(join(cacheDir, `coverage-${set}.json`), JSON.stringify(report, null, 1));
  console.log(`${set}: ${entries.length} entries, ${fetched} downloaded, ${bad.length} failed`);
  if (args.includes('--report')) {
    console.log(`families ${JSON.stringify(report.families)}`);
    console.log(`producers ${JSON.stringify(report.classes)}`);
    console.log(`features ${JSON.stringify(report.features)}`);
    console.log(report.gaps.length ? `gaps:\n  ${report.gaps.join('\n  ')}` : 'gaps: none');
  }
  for (const line of bad) console.error(line);
  process.exit(bad.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
