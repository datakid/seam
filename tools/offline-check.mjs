import { launch } from './browser.mjs';
import { serve } from './serve.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docx } from '../tests/fixtures.js';
import { deleteDirectory } from '../tests/corrupt.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserName = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : 'chromium';
const dir = mkdtempSync(join(tmpdir(), 'seam-offline-'));
const file = join(dir, 'Letter.docx');
writeFileSync(file, deleteDirectory(docx()));

const server = await serve({ root });
const browser = await launch(browserName);
let failure = null;
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${server.url}/index.html`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const cached = await page.evaluate(async () => {
    const cache = await caches.open('seam-app');
    return (await cache.keys()).length;
  });
  if (cached < 40) throw new Error(`only ${cached} files cached`);
  await server.close();
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('drop-label') && document.getElementById('drop-label').textContent !== '', null, { timeout: 15000 });
  await page.setInputFiles('#file-input', file);
  await page.waitForFunction(() => {
    const badge = document.querySelector('#list .item .badge');
    return badge && !/Queued|Checking/.test(badge.textContent);
  }, null, { timeout: 30000 });
  const label = await page.evaluate(() => document.querySelector('#list .item .badge').textContent);
  if (label !== 'Repaired') throw new Error(`offline run gave "${label}"`);
  console.log(`${browserName}: offline ok, ${cached} files cached, label ${label}`);
} catch (error) {
  failure = error;
}
await browser.close().catch(() => {});
await server.close().catch(() => {});
if (failure) {
  console.error(`${browserName}: offline check failed: ${failure.message}`);
  process.exit(1);
}
process.exit(0);
