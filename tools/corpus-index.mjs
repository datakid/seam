import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { OOXML_EXT, BROKEN_NAME, familyOfExt, sha256, analyze } from './corpus-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const only = flag('source', null);
const maxBytes = Number(flag('max-bytes', String(20 * 1024 * 1024)));
const manifestPath = join(root, 'corpus', 'cache', 'catalog.json');
const sources = JSON.parse(readFileSync(join(root, 'corpus', 'sources.json'), 'utf8')).filter((s) => !only || s.id === only);
const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const kept = existing.filter((e) => !sources.some((s) => s.id === e.source));

function git(cwd, ...gitArgs) {
  return execFileSync('git', gitArgs, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function download(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
      last = new Error(`${response.status} ${url}`);
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  throw last;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const at = next++;
      out[at] = await fn(items[at], at);
    }
  }));
  return out;
}

const entries = [...kept];
const seen = new Set(kept.map((e) => e.sha256));

for (const source of sources) {
  const work = mkdtempSync(join(tmpdir(), `seam-${source.id}-`));
  process.stderr.write(`${source.id}: cloning tree\n`);
  git(work, 'clone', '--depth', '1', '--filter=blob:none', '--no-checkout', `https://github.com/${source.repo}.git`, 'repo');
  const repo = join(work, 'repo');
  const commit = git(repo, 'rev-parse', 'HEAD').trim();
  const listing = git(repo, 'ls-tree', '-r', 'HEAD', ...source.paths).split('\n').filter(Boolean);
  const files = listing
    .map((line) => {
      const [, path] = line.split('\t');
      return { path };
    })
    .filter((f) => OOXML_EXT.test(f.path));
  process.stderr.write(`${source.id}: ${files.length} candidates at ${commit.slice(0, 8)}\n`);
  let done = 0;
  const rows = await pool(files, 8, async (f) => {
    const url = `https://raw.githubusercontent.com/${source.repo}/${commit}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
    try {
      const bytes = await download(url);
      if (bytes.length === 0 || bytes.length > maxBytes) return null;
      done++;
      if (done % 100 === 0) process.stderr.write(`${source.id}: ${done}/${files.length}\n`);
      return { f, url, bytes };
    } catch (error) {
      process.stderr.write(`${source.id}: failed ${f.path}: ${error.message}\n`);
      return null;
    }
  });
  for (const row of rows) {
    if (!row) continue;
    const hash = sha256(row.bytes);
    if (seen.has(hash)) continue;
    seen.add(hash);
    const info = analyze(row.bytes);
    const name = basename(row.f.path);
    const stem = name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]/g, '_');
    const entry = {
      id: `${source.id}-${stem}`,
      url: row.url,
      sha256: hash,
      licence: source.licence,
      source: source.id,
      path: row.f.path,
      commit,
      family: familyOfExt(name),
      ext: name.split('.').pop().toLowerCase(),
      producer: info.ok ? info.producer : 'unknown',
      producerClass: info.ok ? info.producerClass : 'unknown',
      features: info.ok ? info.features : [],
      bytes: row.bytes.length,
      broken: !info.ok || BROKEN_NAME.test(name),
      brokenReason: !info.ok ? info.reason : BROKEN_NAME.test(name) ? 'name' : null
    };
    entries.push(entry);
  }
  rmSync(work, { recursive: true, force: true });
}

const ids = new Set();
for (const e of entries) {
  let id = e.id;
  for (let n = 2; ids.has(id); n++) id = `${e.id}-${n}`;
  e.id = id;
  ids.add(id);
}
entries.sort((a, b) => a.id.localeCompare(b.id));
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(entries, null, 1) + '\n');
const healthy = entries.filter((e) => !e.broken);
console.log(`manifest: ${entries.length} entries, ${healthy.length} healthy, ${entries.length - healthy.length} broken`);
