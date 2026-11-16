import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative, basename, extname } from 'node:path';
import { readdirSync, statSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile() && !entry.name.startsWith('.') && entry.name !== 'cases.json') out.push(full);
  }
  return out.sort();
}

export async function runSeam({ input, output, browserName = 'chromium', timeoutMs = 60000, pages = 2, resume = false, onProgress = null, only = null }) {
  const inputDir = resolve(input);
  const outputDir = resolve(output);
  const outputsDir = join(outputDir, 'outputs');
  mkdirSync(outputsDir, { recursive: true });
  const resultsPath = join(outputDir, 'seam.json');
  const previous = resume && existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')).cases : {};
  const results = { ...previous };

  let files = listFiles(inputDir).map((full) => ({ full, rel: relative(inputDir, full).split('\\').join('/'), id: basename(full, extname(full)) }));
  if (only) {
    const wanted = new Set(only);
    files = files.filter((f) => wanted.has(f.id));
  }
  const seen = new Set();
  for (const f of files) {
    if (seen.has(f.id)) throw new Error(`duplicate case id ${f.id}`);
    seen.add(f.id);
  }
  const queue = files.filter((f) => !results[f.id]);

  const server = await serve({ root, mounts: { '/__in/': inputDir }, uploadDir: outputsDir });
  const browser = await launch(browserName);

  async function freshPage() {
    const page = await browser.newPage();
    page.on('pageerror', () => {});
    await page.goto(`${server.url}/tools/harness/`);
    await page.waitForFunction('window.seamReady === true');
    return page;
  }

  let done = 0;
  async function worker() {
    let page = await freshPage();
    while (queue.length > 0) {
      const item = queue.shift();
      const url = `/__in/${item.rel.split('/').map(encodeURIComponent).join('/')}`;
      let timer;
      const timeout = new Promise((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout({ timedOut: true }), timeoutMs);
      });
      const started = Date.now();
      const run = page.evaluate(([u, n, id]) => window.seamRun(u, n, id), [url, basename(item.full), item.id]).then((value) => ({ value }), (error) => ({ error }));
      const settled = await Promise.race([run, timeout]);
      clearTimeout(timer);
      if (settled.timedOut) {
        results[item.id] = { outcome: 'timeout', ms: Date.now() - started, findings: [], outputs: {}, verified: false };
        await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
        page = await freshPage();
      } else if (settled.error) {
        results[item.id] = { outcome: 'harness-error', error: String(settled.error.message || settled.error).slice(0, 300), ms: Date.now() - started, findings: [], outputs: {}, verified: false };
        await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
        page = await freshPage();
      } else {
        results[item.id] = settled.value;
      }
      done++;
      if (onProgress) onProgress(done, files.length - Object.keys(previous).length, item.id);
      if (done % 50 === 0) writeFileSync(resultsPath, JSON.stringify({ browser: browserName, cases: results }));
    }
    await page.close().catch(() => {});
  }

  await Promise.all(Array.from({ length: Math.max(1, pages) }, worker));
  const version = browser.version();
  await browser.close();
  await server.close();
  const payload = { browser: browserName, browserVersion: version, cases: results };
  writeFileSync(resultsPath, JSON.stringify(payload));
  return payload;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 ? args[at + 1] : fallback;
  };
  const input = flag('in');
  const output = flag('out');
  if (!input || !output) {
    console.error('usage: node tools/run-seam.mjs --in <dir> --out <dir> [--browser chromium] [--timeout 60000] [--pages 2] [--resume]');
    process.exit(2);
  }
  const payload = await runSeam({
    input,
    output,
    browserName: flag('browser', 'chromium'),
    timeoutMs: Number(flag('timeout', '60000')),
    pages: Number(flag('pages', '2')),
    resume: args.includes('--resume'),
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) process.stderr.write(`\r${done}/${total}`);
    }
  });
  process.stderr.write('\n');
  const counts = {};
  for (const c of Object.values(payload.cases)) counts[c.outcome] = (counts[c.outcome] || 0) + 1;
  console.log(JSON.stringify(counts));
}
