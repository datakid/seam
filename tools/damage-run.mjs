import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { damage, KINDS, caseSeed, hashString } from './damage.mjs';
import { loadManifest, cachePath } from './corpus-fetch.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const out = resolve(root, flag('out', 'results/work/damaged'));
const sample = Number(flag('sample', '0.1'));
const seeds = Number(flag('seeds', '3'));
const kinds = flag('kinds', KINDS.join(',')).split(',');
const maxBytes = Number(flag('max-bytes', String(8 * 1024 * 1024)));
const shardSpec = flag('shard', '0/1').split('/').map(Number);
const shardIndex = shardSpec[0];
const shardCount = shardSpec[1] || 1;

const entries = loadManifest('healthy')
  .filter((e) => existsSync(cachePath(e)))
  .sort((a, b) => a.id.localeCompare(b.id));
mkdirSync(join(out, 'files'), { recursive: true });
const cases = {};
const cache = new Map();

function bytesOf(entry) {
  if (!cache.has(entry.id)) {
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    cache.set(entry.id, new Uint8Array(readFileSync(cachePath(entry))));
  }
  return cache.get(entry.id);
}

for (const entry of entries) {
  if (entry.bytes > maxBytes) continue;
  for (const kind of kinds) {
    for (let index = 0; index < seeds; index++) {
      const id = `${entry.id}__${kind}__${index}`;
      if (hashString(id) % 100000 >= sample * 100000) continue;
      if (hashString(`shard|${id}`) % shardCount !== shardIndex) continue;
      const seed = caseSeed(entry.id, kind, index);
      const options = kind === 'concat' ? { other: bytesOf(entries[hashString(id) % entries.length]) } : null;
      const { bytes, meta } = damage(bytesOf(entry), kind, seed, options);
      writeFileSync(join(out, 'files', `${id}.${entry.ext}`), bytes);
      cases[id] = { source: entry.id, family: entry.family, producerClass: entry.producerClass, producer: entry.producer, ext: entry.ext, kind, seedIndex: index, seed, meta };
    }
  }
}

writeFileSync(join(out, 'cases.json'), JSON.stringify(cases));
const perKind = {};
for (const c of Object.values(cases)) perKind[c.kind] = (perKind[c.kind] || 0) + 1;
console.log(`${Object.keys(cases).length} cases`, JSON.stringify(perKind));
