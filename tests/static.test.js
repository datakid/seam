import { test, assert } from './harness.js';

const JS = [
  'main', 'ui', 'queue', 'worker', 'copy', 'theme', 'theme-init',
  'core/identify', 'core/crc32', 'core/zip-read', 'core/zip-recover', 'core/zip-write', 'core/xml-clean', 'core/xml-repair', 'core/package',
  'core/verify', 'core/salvage', 'core/report', 'core/constants', 'core/pipeline',
  'core/formats/docx', 'core/formats/xlsx', 'core/formats/pptx'
].map((name) => `../js/${name}.js`);

async function text(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cannot load ${url}`);
  return response.text();
}

test('no network: no fetch, XMLHttpRequest, WebSocket, sendBeacon or remote import in js/', async () => {
  for (const url of JS) {
    const source = await text(url);
    for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', "import('http", 'import("http', 'EventSource']) {
      assert(!source.includes(banned), `${url} contains ${banned}`);
    }
  }
});

test('csp present: connect-src none and strict defaults', async () => {
  const html = await text('../index.html');
  assert(html.includes("connect-src 'none'"), 'connect-src none missing');
  const expected = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
  assert(html.includes(`content="${expected}"`), 'csp does not match the spec');
});

test('index.html: no inline scripts, no inline styles, no third-party origins', async () => {
  const html = await text('../index.html');
  assert(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html), 'inline script');
  assert(!/\sstyle=/.test(html), 'inline style attribute');
  assert(!/<style/i.test(html), 'style element');
  assert(!/(src|href)="https?:/.test(html), 'third-party origin');
  assert(html.includes('<link rel="icon" href="brand/favicon.svg" type="image/svg+xml">'), 'favicon link');
  assert(html.includes('<title>Seam — repair damaged Office files</title>'), 'title');
});

test('index.html: one module script, css order, landmarks, dialog', async () => {
  const html = await text('../index.html');
  assert((html.match(/type="module"/g) || []).length === 1, 'exactly one module script');
  const order = ['css/tokens.css', 'css/fonts.css', 'css/app.css'].map((p) => html.indexOf(p));
  assert(order[0] < order[1] && order[1] < order[2], 'css order');
  for (const tag of ['<header', '<main', '<footer', '<dialog']) assert(html.includes(tag), `missing ${tag}`);
});

test('tokens.css is a verbatim copy of brand/tokens.css', async () => {
  assert((await text('../css/tokens.css')) === (await text('../brand/tokens.css')), 'tokens differ');
});

test('theme: dark overrides exist and follow the system by default', async () => {
  const css = await text('../css/themes.css');
  assert(css.includes(':root[data-theme="dark"]'), 'dark block');
  assert(css.includes('color-scheme: dark'), 'dark color-scheme');
  const init = await text('../js/theme-init.js');
  assert(init.includes('prefers-color-scheme: dark') && init.includes("'system'"), 'system default');
});

test('fonts and vendor files are present and sized', async () => {
  for (const file of ['InstrumentSans-Regular', 'InstrumentSans-Medium', 'InstrumentSans-SemiBold', 'JetBrainsMono-Regular']) {
    const buffer = await (await fetch(`../fonts/${file}.woff2`)).arrayBuffer();
    assert(buffer.byteLength > 10240, `${file} too small`);
  }
  const lib = await text('../vendor/fflate.module.js');
  assert(lib.includes('export function zipSync') && lib.includes('export function unzipSync'), 'fflate is not the esm build');
  assert((await text('../vendor/fflate.LICENSE')).includes('MIT'), 'fflate licence');
});
