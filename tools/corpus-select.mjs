import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { BROKEN_NAME } from './corpus-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const target = Number(flag('target', '300'));
const wildTarget = Number(flag('wild', '100'));
const softMax = Number(flag('soft-max-bytes', String(1536 * 1024)));
const catalog = JSON.parse(readFileSync(join(root, 'corpus', 'cache', 'catalog.json'), 'utf8'));
const FEATURES = ['charts', 'comments', 'trackedChanges', 'embeddings', 'macros', 'pivot', 'smartart', 'video', 'bigPart'];
const CLASSES = ['word', 'excel', 'powerpoint', 'libreoffice', 'wps', 'poi', 'google', 'apple', 'python'];

const quarantinePath = join(root, 'corpus', 'manifest', 'quarantine.json');
const quarantine = existsSync(quarantinePath) ? JSON.parse(readFileSync(quarantinePath, 'utf8')) : {};
for (const e of catalog) {
  const name = e.path.split('/').pop();
  if (!e.broken && (BROKEN_NAME.test(name) || quarantine[e.id])) {
    e.broken = true;
    e.brokenReason = quarantine[e.id] ? 'quarantine' : 'name';
  }
}
const healthy = catalog.filter((e) => !e.broken).sort((a, b) => a.sha256.localeCompare(b.sha256));
const picked = new Map();
const take = (e) => {
  if (!picked.has(e.id)) picked.set(e.id, e);
};
const count = (fn) => [...picked.values()].filter(fn).length;
const small = (e) => e.bytes <= softMax;

for (const feature of FEATURES) {
  const candidates = healthy.filter((e) => e.features.includes(feature));
  const byClass = new Map();
  for (const e of candidates) {
    if (!byClass.has(e.producerClass)) byClass.set(e.producerClass, []);
    byClass.get(e.producerClass).push(e);
  }
  const order = [...byClass.values()].map((list) => list.sort((a, b) => (small(b) - small(a)) || a.bytes - b.bytes));
  let guard = 0;
  while (count((e) => e.features.includes(feature)) < 6 && guard++ < 100) {
    let progressed = false;
    for (const list of order) {
      const next = list.find((e) => !picked.has(e.id));
      if (next) {
        take(next);
        progressed = true;
      }
      if (count((e) => e.features.includes(feature)) >= 6) break;
    }
    if (!progressed) break;
  }
}

for (const klass of CLASSES) {
  const candidates = healthy.filter((e) => e.producerClass === klass && small(e));
  for (const e of candidates) {
    if (count((x) => x.producerClass === klass) >= 8) break;
    take(e);
  }
}

const perFamily = Math.ceil(target / 3);
for (const family of ['docx', 'xlsx', 'pptx']) {
  const pool = healthy.filter((e) => e.family === family && small(e) && !picked.has(e.id));
  const buckets = new Map();
  for (const e of pool) {
    const key = `${e.producerClass}|${e.ext}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }
  const lists = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, list]) => list);
  let progressed = true;
  while (count((e) => e.family === family) < perFamily && progressed) {
    progressed = false;
    for (const list of lists) {
      if (count((e) => e.family === family) >= perFamily) break;
      const seenProducers = new Set([...picked.values()].filter((e) => e.family === family).map((e) => e.producer));
      let at = list.findIndex((e) => !picked.has(e.id) && !seenProducers.has(e.producer));
      if (at < 0) at = list.findIndex((e) => !picked.has(e.id));
      if (at >= 0) {
        take(list[at]);
        progressed = true;
      }
    }
  }
}

const selected = [...picked.values()].sort((a, b) => a.id.localeCompare(b.id));
const broken = catalog.filter((e) => e.broken).sort((a, b) => a.sha256.localeCompare(b.sha256));
const wildBuckets = new Map();
for (const e of broken) {
  const key = `${e.source}|${e.family}`;
  if (!wildBuckets.has(key)) wildBuckets.set(key, []);
  wildBuckets.get(key).push(e);
}
const wild = [];
const wildLists = [...wildBuckets.values()];
for (let i = 0; wild.length < wildTarget && wildLists.some((l) => i < l.length); i++) {
  for (const list of wildLists) if (i < list.length && wild.length < wildTarget) wild.push(list[i]);
}
wild.sort((a, b) => a.id.localeCompare(b.id));

writeFileSync(join(root, 'corpus', 'manifest', 'healthy.json'), JSON.stringify(selected, null, 1) + '\n');
writeFileSync(join(root, 'corpus', 'manifest', 'wild-public.json'), JSON.stringify(wild, null, 1) + '\n');

const tally = (list, fn) => list.reduce((m, e) => ((m[fn(e)] = (m[fn(e)] || 0) + 1), m), {});
console.log(`healthy: ${selected.length}, wild-public: ${wild.length}, MB: ${(selected.reduce((s, e) => s + e.bytes, 0) / 1048576).toFixed(1)}`);
console.log('family', tally(selected, (e) => e.family));
console.log('class', tally(selected, (e) => e.producerClass));
console.log('source', tally(selected, (e) => e.source));
const f = {};
for (const e of selected) for (const x of e.features) f[x] = (f[x] || 0) + 1;
console.log('features', f);
