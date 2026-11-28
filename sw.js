const CACHE = 'seam-app';
const ENTRY = 'index.html';
const STAMP = 'refreshed.stamp';
const FRESH_MS = 3600000;
const WAIT_MS = 4000;

const ROOT = new URL('./', self.location.href);
const ENTRY_URL = new URL(ENTRY, ROOT).href;
const STAMP_URL = new URL(STAMP, ROOT).href;

const SCRIPT_REF = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"\s]+)\1/g;
const WORKER_REF = /new\s+URL\(\s*(['"])(\.{1,2}\/[^'"\s]+)\1\s*,\s*import\.meta\.url/g;
const CSS_REF = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g;
const CSS_IMPORT = /@import\s+(['"])([^'"\s]+)\1/g;
const HTML_REF = /<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*(['"])([^'"\s]+)\1/gi;

function patterns(url) {
  const path = new URL(url).pathname;
  if (path.endsWith('.js')) return [SCRIPT_REF, WORKER_REF];
  if (path.endsWith('.css')) return [CSS_REF, CSS_IMPORT];
  if (path.endsWith('.html')) return [HTML_REF];
  return [];
}

function references(url, text) {
  const found = new Set();
  for (const pattern of patterns(url)) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(match[2])) continue;
      const target = new URL(match[2], url);
      target.search = '';
      target.hash = '';
      if (target.href.startsWith(ROOT.href) && target.href !== ROOT.href && target.href !== self.location.href) found.add(target.href);
    }
  }
  return found;
}

async function load(url) {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) return { status: response.status };
    return { status: 200, body: await response.arrayBuffer(), type: response.headers.get('content-type') || '' };
  } catch {
    return null;
  }
}

async function collect() {
  const seen = new Map();
  const tried = new Set([ENTRY_URL]);
  let failed = 0;
  let layer = [ENTRY_URL];
  while (layer.length > 0) {
    const answers = await Promise.all(layer.map(load));
    const next = [];
    for (let i = 0; i < layer.length; i++) {
      const entry = answers[i];
      if (entry === null || entry.status >= 500) {
        failed++;
        continue;
      }
      if (entry.status !== 200) continue;
      seen.set(layer[i], entry);
      const text = patterns(layer[i]).length > 0 ? new TextDecoder().decode(entry.body) : '';
      for (const ref of references(layer[i], text)) {
        if (!tried.has(ref)) {
          tried.add(ref);
          next.push(ref);
        }
      }
    }
    layer = next;
  }
  return { seen, failed };
}

function stored(entry) {
  return new Response(entry.body, { headers: entry.type ? { 'content-type': entry.type } : {} });
}

async function refresh() {
  const { seen, failed } = await collect();
  if (failed > 0 || !seen.has(ENTRY_URL)) throw new Error('refresh incomplete');
  const cache = await caches.open(CACHE);
  const keep = new Set([ROOT.href, STAMP_URL]);
  for (const [url, entry] of seen) {
    keep.add(url);
    await cache.put(url, stored(entry));
  }
  await cache.put(ROOT.href, stored(seen.get(ENTRY_URL)));
  for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
  await cache.put(STAMP_URL, new Response(String(Date.now())));
}

async function refreshIfStale() {
  try {
    const cache = await caches.open(CACHE);
    const stamp = await cache.match(STAMP_URL);
    if (stamp && Date.now() - Number(await stamp.text()) < FRESH_MS) return;
    await refresh();
  } catch {
    return;
  }
}

function keyOf(url) {
  const key = new URL(url);
  key.search = '';
  key.hash = '';
  return key.href;
}

function within(promise, ms) {
  if (!ms) return promise;
  return Promise.race([promise, new Promise((resolve, reject) => setTimeout(reject, ms))]);
}

async function answer(request, event) {
  const cache = await caches.open(CACHE);
  const key = keyOf(request.url);
  const cached = await cache.match(key);
  const navigating = request.mode === 'navigate';
  if (navigating) event.waitUntil(refreshIfStale());
  let response = null;
  try {
    response = await within(fetch(request), cached ? WAIT_MS : 0);
  } catch {
    response = null;
  }
  if (response !== null && response.status < 500) {
    if (response.ok && cached) event.waitUntil(cache.put(key, response.clone()));
    return response;
  }
  if (cached) return cached;
  if (navigating) {
    const entry = await cache.match(ENTRY_URL);
    if (entry) return entry;
  }
  return response || Response.error();
}

self.addEventListener('install', (event) => {
  event.waitUntil(refresh().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== ROOT.origin || !url.href.startsWith(ROOT.href)) return;
  event.respondWith(answer(request, event));
});
