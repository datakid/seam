import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://example.test';
const BASE = `${ORIGIN}/seam/`;
const source = readFileSync(join(root, 'sw.js'), 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function appFiles() {
  const files = ['index.html', 'vendor/fflate.module.js', 'brand/favicon.svg'];
  for (const dir of ['js', 'css', 'fonts']) files.push(...walk(dir).filter((path) => !path.endsWith('.txt')));
  return files.sort();
}

function makeCache() {
  const store = new Map();
  const name = (key) => (typeof key === 'string' ? key : key.url);
  return {
    store,
    async put(key, response) {
      store.set(name(key), await response.arrayBuffer().then((buffer) => ({ buffer, status: response.status, headers: Array.from(response.headers) })));
    },
    async match(key) {
      const hit = store.get(name(key));
      return hit ? new Response(hit.buffer, { status: hit.status, headers: hit.headers }) : undefined;
    },
    async keys() {
      return Array.from(store.keys(), (url) => ({ url }));
    },
    async delete(key) {
      return store.delete(name(key));
    }
  };
}

function boot({ online = true, missing = new Set(), failing = new Set() } = {}) {
  const listeners = {};
  const requested = [];
  const caches = new Map();
  const state = { online, skipped: false, claimed: false };
  const sandbox = {
    URL,
    Response,
    Request,
    TextDecoder,
    Promise,
    Date,
    Number,
    String,
    Set,
    Map,
    Array,
    Error,
    setTimeout,
    clearTimeout,
    self: {
      location: { href: `${BASE}sw.js` },
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      skipWaiting() {
        state.skipped = true;
        return Promise.resolve();
      },
      clients: {
        claim() {
          state.claimed = true;
          return Promise.resolve();
        }
      }
    },
    caches: {
      async open(name) {
        if (!caches.has(name)) caches.set(name, makeCache());
        return caches.get(name);
      },
      async keys() {
        return Array.from(caches.keys());
      },
      async delete(name) {
        return caches.delete(name);
      }
    },
    async fetch(input) {
      const url = typeof input === 'string' ? input : input.url;
      requested.push(url);
      if (!state.online) throw new TypeError('offline');
      const path = decodeURIComponent(new URL(url).pathname.slice('/seam/'.length)) || 'index.html';
      if (failing.has(path)) return new Response('', { status: 503 });
      if (missing.has(path) || !existsSync(join(root, path))) return new Response('', { status: 404 });
      const type = path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      return new Response(readFileSync(join(root, path)), { status: 200, headers: { 'content-type': type } });
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const waits = [];
  const dispatch = async (type, extra = {}) => {
    const event = { ...extra, waitUntil: (promise) => waits.push(promise) };
    if (type === 'fetch') {
      let answered = null;
      event.respondWith = (promise) => {
        answered = promise;
      };
      listeners.fetch(event);
      const response = answered === null ? null : await answered;
      await Promise.allSettled(waits);
      return response;
    }
    listeners[type](event);
    await Promise.all(waits);
    return null;
  };
  const get = (path, mode = 'cors', method = 'GET') => ({ url: `${BASE}${path}`, method, mode });
  return { caches, state, requested, dispatch, get, listeners };
}

test('offline: installing caches exactly the app files, found by following the page, scripts and styles', async () => {
  const app = boot();
  await app.dispatch('install');
  const cache = app.caches.get('seam-app');
  const cached = Array.from(cache.store.keys()).map((url) => url.slice(BASE.length)).filter((path) => path !== '' && path !== 'refreshed.stamp').sort();
  assert.deepEqual(cached, appFiles());
  assert.ok(cache.store.has(BASE), 'the start address is cached too');
  assert.ok(app.state.skipped);
});

test('offline: every fetch the worker makes is a same-origin address inside its own folder', async () => {
  const app = boot();
  await app.dispatch('install');
  await app.dispatch('fetch', { request: app.get('js/queue.js') });
  for (const url of app.requested) assert.ok(url.startsWith(BASE), url);
  for (const banned of ['XMLHttpRequest', 'WebSocket', 'sendBeacon', 'importScripts', 'EventSource', 'http:', 'https:']) assert.ok(!source.includes(banned), banned);
});

test('offline: an install that cannot fetch everything fails and leaves any earlier cache alone', async () => {
  const flaky = boot({ failing: new Set(['js/ui.js']) });
  await assert.rejects(flaky.dispatch('install'));
  assert.ok(!flaky.caches.has('seam-app') || flaky.caches.get('seam-app').store.size === 0);
  const down = boot({ online: false });
  await assert.rejects(down.dispatch('install'));
});

test('offline: with no network the cached files are served, and a page visit falls back to the start page', async () => {
  const app = boot();
  await app.dispatch('install');
  await app.dispatch('activate');
  assert.ok(app.state.claimed);
  app.state.online = false;
  for (const path of ['js/worker.js', 'js/core/data/schema-lite.js', 'fonts/InstrumentSans-Regular.woff2', 'css/app.css']) {
    const response = await app.dispatch('fetch', { request: app.get(path) });
    assert.equal(response.status, 200, path);
    assert.equal(Buffer.compare(Buffer.from(await response.arrayBuffer()), readFileSync(join(root, path))), 0, path);
  }
  const page = await app.dispatch('fetch', { request: app.get('', 'navigate') });
  assert.ok((await page.text()).includes('<title>Seam'));
  const search = await app.dispatch('fetch', { request: app.get('index.html?demo=1', 'navigate') });
  assert.ok((await search.text()).includes('<title>Seam'));
  const unknown = await app.dispatch('fetch', { request: app.get('js/not-there.js') });
  assert.equal(unknown.type, 'error');
});

test('offline: online the network answer wins and refreshes the cached copy; a server error falls back to the cache', async () => {
  const app = boot();
  await app.dispatch('install');
  const cache = app.caches.get('seam-app');
  cache.store.set(`${BASE}css/app.css`, { buffer: new TextEncoder().encode('old').buffer, status: 200, headers: [] });
  const fresh = await app.dispatch('fetch', { request: app.get('css/app.css') });
  assert.equal(Buffer.compare(Buffer.from(await fresh.arrayBuffer()), readFileSync(join(root, 'css/app.css'))), 0);
  assert.equal(Buffer.compare(Buffer.from(cache.store.get(`${BASE}css/app.css`).buffer), readFileSync(join(root, 'css/app.css'))), 0);
  const broken = boot();
  await broken.dispatch('install');
  const store = broken.caches.get('seam-app').store;
  broken.state.online = true;
  const fallback = boot({ failing: new Set(['css/app.css']) });
  fallback.caches.set('seam-app', makeCache());
  for (const [key, value] of store) fallback.caches.get('seam-app').store.set(key, value);
  const served = await fallback.dispatch('fetch', { request: fallback.get('css/app.css') });
  assert.equal(served.status, 200);
});

test('offline: other methods, other origins and other folders are left to the browser', async () => {
  const app = boot();
  await app.dispatch('install');
  assert.equal(await app.dispatch('fetch', { request: app.get('js/queue.js', 'cors', 'POST') }), null);
  assert.equal(await app.dispatch('fetch', { request: { url: 'https://other.test/seam/js/queue.js', method: 'GET', mode: 'cors' } }), null);
  assert.equal(await app.dispatch('fetch', { request: { url: `${ORIGIN}/elsewhere/x.js`, method: 'GET', mode: 'cors' } }), null);
  assert.equal(await app.dispatch('fetch', { request: { url: 'blob:https://example.test/abc', method: 'GET', mode: 'cors' } }), null);
});

test('offline: an update drops files that left the app and keeps the stamp', async () => {
  const app = boot();
  await app.dispatch('install');
  const cache = app.caches.get('seam-app');
  cache.store.set(`${BASE}js/gone.js`, { buffer: new ArrayBuffer(1), status: 200, headers: [] });
  cache.store.set(`${BASE}refreshed.stamp`, { buffer: new TextEncoder().encode('0').buffer, status: 200, headers: [] });
  await app.dispatch('fetch', { request: app.get('', 'navigate') });
  assert.ok(!cache.store.has(`${BASE}js/gone.js`));
  assert.ok(cache.store.has(`${BASE}refreshed.stamp`));
});

test('offline: the page registers the worker only in a top-level secure page', () => {
  const page = readFileSync(join(root, 'js/offline.js'), 'utf8');
  assert.ok(page.includes('isSecureContext') && page.includes('window.self !== window.top'));
  assert.ok(readFileSync(join(root, 'js/main.js'), 'utf8').includes('registerOffline();'));
  assert.ok(relative(root, join(root, 'sw.js')) === 'sw.js');
});

test('network: no file under js/ uses a network API', () => {
  for (const path of walk('js').filter((file) => file.endsWith('.js'))) {
    const text = readFileSync(join(root, path), 'utf8');
    for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', "import('http", 'import("http', 'EventSource']) assert.ok(!text.includes(banned), `${path} contains ${banned}`);
  }
});
