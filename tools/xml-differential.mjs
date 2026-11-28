import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';
import { strictWellFormed } from '../js/core/xml-strict.js';
import { docxEntries, xlsxEntries, pptxEntries } from '../tests/fixtures.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const browserName = flag('browser', 'chromium');
const oracle = flag('oracle', 'dom');
const cases = Number(flag('cases', '100000'));
const seed = Number(flag('seed', '1'));
const show = Number(flag('show', '12'));
const maxPart = Number(flag('max-part', '6000'));
const filesDir = resolve(root, flag('files', 'corpus/cache/files'));

function mulberry32(start) {
  let a = start >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const next = mulberry32(seed);
const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
const pick = (list) => list[Math.floor(next() * list.length)];

const HAND = [
  '<a/>',
  '<a></a>',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a xmlns="urn:x" xmlns:b="http://example.com/b"><b:c b:d="1" e="2">text &amp; more &#65; &#x42;</b:c><!-- note --><![CDATA[ x < y ]]><?pi data?></a>',
  '<?xml version="1.0"?><root><child attr=\'v\' other="w"/></root>',
  '<a xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t xml:space="preserve"> x </w:t></w:r></w:p></a>',
  '<a xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheet r:id="rId1" name="S"/></a>',
  '<a><b><c><d/></c></b></a>',
  '<a>\u00e9\u4e2d\u{1F600}</a>',
  '<\u00e9\u4e2d a="\u00e9"/>',
  '<a b="1" c="2" d="3" e="4" f="5" g="6" h="7" i="8" j="9" k="10" l="11" m="12" n="13"/>',
  '<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet href="a"?><a/>',
  '<a><!--x--></a><!--y--><?p q?>',
  '<a xmlns:x="u" xmlns:y="u" x:k="1" y:k="2"/>',
  '<a:b xmlns:a="u"><a:c/></a:b>'
];

function seeds() {
  const out = HAND.slice();
  for (const entries of [docxEntries(), xlsxEntries(), pptxEntries()]) {
    for (const [name, data] of entries) if (/\.(xml|rels)$/i.test(name) && typeof data === 'string') out.push(data);
  }
  let files = [];
  try {
    files = readdirSync(filesDir).filter((name) => /\.(docx|xlsx|pptx|docm|xlsm|pptm)$/i.test(name)).sort();
  } catch {
    files = [];
  }
  for (const name of files) {
    try {
      const parts = unzipSync(new Uint8Array(readFileSync(join(filesDir, name))), { filter: (f) => /\.(xml|rels)$/i.test(f.name) && f.originalSize < maxPart });
      for (const key of Object.keys(parts)) out.push(strFromU8(parts[key]));
    } catch {
      continue;
    }
  }
  return out;
}

const NASTY = ['<', '>', '&', '"', "'", '/', '=', ':', ';', '#', ' ', '\n', '\t', '\r', '-', '--', '?', '!', ']', ']]>', '&amp;', '&nbsp;', '&#0;', '&#x1F600;', '&#xD800;', '&#65', '&#X41;', '&;', '\u0000', '\u0001', '\u000b', '\ufffe', '\uffff', '\ud800', '\udc00', '\u00a0', '\ufeff', '\u2028', '<!--', '-->', '<![CDATA[', '<?', '?>', 'xmlns', 'xmlns:', 'xml:', 'a:', ':', '::', '<a>', '</a>', '<a/>', '\u00e9', '\u{1F600}', '\u0301', '\u00b7', '\u2070', '1', '.', '_'];
const URIS = ['', 'foo', 'a b', 'urn:x', 'http://x.y/z?q=1&amp;r=2', 'http://[::1]/', 'http://a:b/', 'http://a:80/', '%zz', '%41', 'ht tp://x', 'x:y z', ':', '::', '1:2', 'http://x/<', '\u00e9', 'http://\u00e9.com/', 'a/../b', '//x', '?', '#', '#a b', 'http://x/y z', 'http://x/{a}', 'http://x/|', 'http://x/^', 'http://x/`', 'http://x/\\', 'http://x/[a]', 'http://x/%', 'http://x/%4', 'urn:a:b:c', 'file:///x', 'mailto:a@b.c', 'http://u@h/', 'x://y', 'HTTP://X', 'http://x/\t', 'http://x/&amp;', '/a/b', './a', '../a', 'a?b#c', 'http://x?', 'http://x#', 'http:', 'a:', 'ä:b', 'http://h:99999/', 'http://:80/', 'http://x/a b'];

function mutate(text) {
  let s = text;
  const rounds = int(1, 3);
  for (let r = 0; r < rounds; r++) {
    const op = int(0, 9);
    const at = int(0, s.length);
    if (op === 0) s = s.slice(0, at) + s.slice(at + int(1, 6));
    else if (op === 1) s = s.slice(0, at) + pick(NASTY) + s.slice(at);
    else if (op === 2) s = s.slice(0, at) + pick(NASTY) + s.slice(at + 1);
    else if (op === 3) s = s.slice(0, at);
    else if (op === 4) {
      const len = int(1, 40);
      s = s.slice(0, at) + s.slice(at, at + len) + s.slice(at);
    } else if (op === 5) {
      const code = next() < 0.5 ? int(0, 0x2ff) : next() < 0.7 ? int(0x300, 0xffff) : int(0x10000, 0x1ffff);
      s = s.slice(0, at) + String.fromCodePoint(code >= 0xd800 && code <= 0xdfff ? 0x41 : code) + s.slice(at + 1);
    } else if (op === 6) {
      const matches = Array.from(s.matchAll(/xmlns(?::[A-Za-z0-9]+)?="([^"]*)"/g));
      if (matches.length > 0) {
        const m = pick(matches);
        const start = m.index + m[0].indexOf('"') + 1;
        s = s.slice(0, start) + pick(URIS) + s.slice(start + m[1].length);
      }
    } else if (op === 7) {
      const tags = Array.from(s.matchAll(/<\/?([A-Za-z][\w:.-]*)/g));
      if (tags.length > 0) {
        const m = pick(tags);
        const start = m.index + m[0].length - m[1].length;
        s = s.slice(0, start) + pick(['x', 'q:x', 'b:', ':b', 'a:b:c', 'xml:x', 'xmlns:x', '1a', '\u00e9', 'A']) + s.slice(start + m[1].length);
      }
    } else if (op === 8) {
      const a = int(0, s.length);
      const b = int(0, s.length);
      const [x, y] = a < b ? [a, b] : [b, a];
      s = s.slice(0, x) + s.slice(y) + s.slice(x, y);
    } else {
      s = s.replace(pick([/"/, /'/, /=/, /\s/, /\//, />/]), pick(['', ' ', '"', "'", '<', '&', '>']));
    }
  }
  return s;
}

const pool = seeds();
console.log(`seeds ${pool.length}, cases ${cases}, seed ${seed}, oracle ${oracle === 'saxes' ? 'saxes' : browserName}`);

const LENIENT = ['less-than in attribute', 'duplicate attribute', 'declaration', 'qualified name'];
const allowed = oracle === 'dom' && (browserName === 'chromium' || browserName === 'webkit') ? new Set(LENIENT.map((reason) => `oracle-ok|${reason}`)) : new Set();
const stats = { cases: 0, sure: 0, unsure: 0, bad: 0, good: 0, disagree: 0, tolerated: 0 };
const found = new Map();

function around(text, at) {
  if (at === undefined || at === null) return text.slice(0, 160);
  return `${text.slice(Math.max(0, at - 70), at)}\u2192${text.slice(at, at + 70)}`;
}

function record(item) {
  const key = `${item.dom ? 'oracle-ok' : 'oracle-bad'}|${item.reason}`;
  if (allowed.has(key)) {
    stats.tolerated++;
    return;
  }
  stats.disagree++;
  if (!found.has(key)) found.set(key, []);
  found.get(key).push(item);
}

function saxesVerdict(text) {
  const { SaxesParser } = createRequire(import.meta.url)('saxes');
  const parser = new SaxesParser({ xmlns: true });
  let message = null;
  parser.on('error', (error) => {
    if (message === null) message = error.message;
  });
  try {
    parser.write(text).close();
  } catch (error) {
    if (message === null) message = String(error.message);
  }
  return { ok: message === null, message: message === null ? '' : message };
}

async function runSaxes(list) {
  const out = [];
  let sure = 0;
  let unsure = 0;
  let good = 0;
  for (const text of list) {
    const verdict = strictWellFormed(text);
    if (verdict === null) {
      unsure++;
      continue;
    }
    sure++;
    const reference = saxesVerdict(text);
    if (reference.ok) good++;
    if (reference.ok !== verdict.ok) out.push({ text, dom: reference.ok, reason: verdict.reason || 'ok', at: verdict.at, message: reference.message });
  }
  return { out, sure, unsure, good };
}

let page = null;
let browser = null;
let server = null;
if (oracle !== 'saxes') {
  server = await serve({ root });
  browser = await launch(browserName);
  page = await browser.newPage();
  await page.goto(`${server.url}/tools/harness/`);
}

async function runDom(batch) {
  return page.evaluate(async (list) => {
    const { strictWellFormed: strict } = await import('/js/core/xml-strict.js');
    const parser = new DOMParser();
    const out = [];
    let sure = 0;
    let unsure = 0;
    let good = 0;
    for (const text of list) {
      const verdict = strict(text);
      if (verdict === null) {
        unsure++;
        continue;
      }
      sure++;
      const doc = parser.parseFromString(text, 'application/xml');
      const dom = doc.getElementsByTagName('parsererror').length === 0;
      if (dom) good++;
      if (dom !== verdict.ok) out.push({ text, dom, reason: verdict.reason || 'ok', at: verdict.at, message: dom ? '' : (doc.getElementsByTagName('parsererror')[0].textContent || '').slice(0, 160) });
    }
    return { out, sure, unsure, good };
  }, batch);
}

let batch = [];
let batchChars = 0;
const flush = async () => {
  if (batch.length === 0) return;
  const result = oracle === 'saxes' ? await runSaxes(batch) : await runDom(batch);
  stats.cases += batch.length;
  stats.sure += result.sure;
  stats.unsure += result.unsure;
  stats.good += result.good;
  stats.bad += result.sure - result.good;
  for (const item of result.out) record(item);
  batch = [];
  batchChars = 0;
};

for (let i = 0; i < pool.length; i++) {
  batch.push(pool[i]);
  batchChars += pool[i].length;
  if (batch.length >= 2000 || batchChars > 8000000) await flush();
}
await flush();
for (let i = 0; i < cases; i++) {
  batch.push(mutate(pick(pool)));
  if (batch.length >= 2000) await flush();
}
await flush();
console.log(JSON.stringify(stats));

const keys = Array.from(found.keys()).sort((a, b) => found.get(b).length - found.get(a).length);
const per = Math.max(2, Math.floor(show / Math.max(1, keys.length)));
for (const key of keys) {
  const list = found.get(key);
  console.log(`\n${key}  x${list.length}`);
  const shown = new Set();
  const byLength = list.slice().sort((a, b) => a.text.length - b.text.length);
  for (const item of byLength) {
    if (shown.size >= per) break;
    const view = around(item.text, item.at);
    if (shown.has(view)) continue;
    shown.add(view);
    console.log(JSON.stringify({ at: item.at, context: view, message: item.message }));
  }
}
if (browser) await browser.close();
if (server) await server.close();
process.exit(stats.disagree > 0 ? 1 : 0);
