import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const browserName = flag('browser', 'chromium');
const only = flag('only', '');
const limitMs = Number(flag('timeout', '240000'));

const server = await serve({ root });
const browser = await launch(browserName);
const page = await browser.newPage();
const lines = [];
page.on('console', (message) => lines.push(message.text()));
page.on('pageerror', (error) => lines.push(`PAGEERROR ${error.message}`));
await page.goto(`${server.url}/tests/${only ? `?only=${only}` : ''}`);
const started = Date.now();
while (Date.now() - started < limitMs && !lines.some((line) => line.startsWith('RESULT '))) {
  await new Promise((r) => setTimeout(r, 250));
}
const result = lines.find((line) => line.startsWith('RESULT ')) || 'RESULT none';
const failures = lines.filter((line) => line.startsWith('FAIL') || line.startsWith('PAGEERROR'));
await browser.close();
await server.close();
console.log(`${browserName}: ${result}`);
for (const line of failures.slice(0, 40)) console.log(line);
if (process.env.GITHUB_ACTIONS) {
  for (const line of failures.slice(0, 10)) console.log(`::error title=${browserName} test failure::${line.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
  if (!result.includes('RESULT pass')) console.log(`::error title=${browserName} no result::${result}`);
}
process.exit(result.includes('fail=0') && failures.length === 0 ? 0 : 1);
