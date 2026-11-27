import { copy } from './copy.js';
import { domWellFormed } from './core/xml-repair.js';
import { failedResult, notProcessedResult, formatLocalDate } from './core/report.js';

export const LIMITS = { files: 50, bytes: 200 * 1024 * 1024, concurrency: 2, budgetMs: 120000, copies: 4 };

const WANTS_COPIES = new Set(['partial', 'salvaged', 'failed']);

const WANTS_DONOR = new Set(['partial', 'salvaged']);

export function canAddDonor(item) {
  return item.status === 'done' && item.file !== null && item.result !== null && WANTS_DONOR.has(item.result.outcome);
}

export function canAddCopy(item) {
  return item.status === 'done' && item.file !== null && item.result !== null && WANTS_COPIES.has(item.result.outcome);
}

function fileKey(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function createQueue(handlers) {
  const workerUrl = new URL('./worker.js', import.meta.url);
  let items = [];
  let keys = new Set();
  let workers = [];
  let nextId = 1;
  let generation = 0;
  let announcedBusy = false;
  const urls = new Set();

  function spawn() {
    const worker = new Worker(workerUrl, { type: 'module' });
    const slot = { worker, busy: false, itemId: null, timer: null };
    worker.onmessage = (event) => onMessage(slot, event.data);
    worker.onerror = (event) => {
      if (event && event.preventDefault) event.preventDefault();
      if (slot.itemId !== null) fail(slot, 'INTERNAL_ERROR', copy.reasons.internal);
    };
    return slot;
  }

  function ensureWorkers() {
    while (workers.length < LIMITS.concurrency) workers.push(spawn());
  }

  function findItem(id) {
    return items.find((item) => item.id === id);
  }

  function release(slot) {
    clearTimeout(slot.timer);
    slot.busy = false;
    slot.itemId = null;
    slot.timer = null;
  }

  function replace(slot) {
    clearTimeout(slot.timer);
    slot.worker.terminate();
    const index = workers.indexOf(slot);
    if (index !== -1) workers[index] = spawn();
  }

  function finish(item, result) {
    item.result = result;
    item.status = 'done';
    item.pct = 100;
    if (!WANTS_COPIES.has(result.outcome)) {
      item.file = null;
      item.copies = [];
      item.donor = null;
    }
    handlers.onItem(item);
    handlers.onSummary();
    pump();
    checkIdle();
  }

  function fail(slot, code, reason) {
    const item = findItem(slot.itemId);
    replace(slot);
    if (item) finish(item, failedResult(code, reason));
  }

  function onMessage(slot, msg) {
    if (msg.type === 'xmlcheck') {
      let ok;
      try {
        ok = domWellFormed(msg.text);
      } catch (error) {
        ok = false;
      }
      slot.worker.postMessage({ type: 'xmlresult', req: msg.req, ok });
      return;
    }
    const item = findItem(msg.id);
    if (!item || slot.itemId !== msg.id) return;
    if (msg.type === 'progress') {
      item.pct = msg.pct;
      item.stage = msg.stage;
      handlers.onItem(item);
      return;
    }
    if (msg.type === 'result') {
      release(slot);
      finish(item, msg.result);
    }
  }

  async function start(item, slot) {
    const run = generation;
    item.status = 'working';
    item.pct = 0;
    slot.busy = true;
    slot.itemId = item.id;
    handlers.onItem(item);
    let buffer;
    let donor = null;
    const copies = [];
    try {
      buffer = await item.file.arrayBuffer();
      for (const extra of item.copies) copies.push({ name: extra.name, buffer: await extra.arrayBuffer() });
      if (item.donor) donor = { name: item.donor.name, buffer: await item.donor.arrayBuffer() };
    } catch (error) {
      if (run !== generation) return;
      release(slot);
      finish(item, failedResult('INTERNAL_ERROR', copy.reasons.internal));
      return;
    }
    if (run !== generation) return;
    slot.timer = setTimeout(() => fail(slot, 'TIMEOUT', copy.reasons.timeout), LIMITS.budgetMs * (1 + copies.length + (donor ? 1 : 0)));
    slot.worker.postMessage({ type: 'process', id: item.id, name: item.name, size: item.size, lastModified: item.lastModified, buffer, copies, donor }, [buffer, ...copies.map((extra) => extra.buffer), ...(donor ? [donor.buffer] : [])]);
  }

  function pump() {
    ensureWorkers();
    for (const slot of workers) {
      if (slot.busy) continue;
      const item = items.find((candidate) => candidate.status === 'queued');
      if (!item) break;
      start(item, slot);
    }
  }

  function pending() {
    return items.filter((item) => item.status !== 'done').length;
  }

  function checkIdle() {
    if (announcedBusy && pending() === 0) {
      announcedBusy = false;
      handlers.onIdle();
    }
  }

  function add(files) {
    const notices = { duplicates: 0, overflow: false };
    const fresh = [];
    for (const file of files) {
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (keys.has(key)) {
        notices.duplicates++;
        continue;
      }
      if (items.length + fresh.length >= LIMITS.files) {
        notices.overflow = true;
        continue;
      }
      keys.add(key);
      fresh.push({ id: nextId++, key, file, name: file.name, size: file.size, lastModified: file.lastModified, status: 'queued', pct: 0, stage: null, result: null, copies: [], donor: null });
    }
    for (const item of fresh) {
      items.push(item);
      if (item.size > LIMITS.bytes) {
        item.file = null;
        item.status = 'done';
        item.result = notProcessedResult(copy.notice.tooLarge);
      }
    }
    handlers.onList(items, notices);
    const waiting = fresh.filter((item) => item.status === 'queued').length;
    if (waiting > 0) {
      if (!announcedBusy) {
        announcedBusy = true;
        handlers.onBusy(waiting);
      }
      pump();
    } else {
      handlers.onSummary();
    }
    return notices;
  }

  function addCopies(id, files) {
    const notices = { duplicates: 0, overflow: false, copiesFull: false, tooLarge: false };
    const item = findItem(id);
    if (!item || !canAddCopy(item)) return notices;
    let added = 0;
    for (const file of files) {
      const key = fileKey(file);
      if (key === item.key || item.copies.some((extra) => fileKey(extra) === key)) {
        notices.duplicates++;
        continue;
      }
      if (item.copies.length >= LIMITS.copies) {
        notices.copiesFull = true;
        continue;
      }
      if (file.size > LIMITS.bytes) {
        notices.tooLarge = true;
        continue;
      }
      item.copies.push(file);
      added++;
    }
    if (added === 0) {
      handlers.onList(items, notices);
      return notices;
    }
    item.result = null;
    item.status = 'queued';
    item.pct = 0;
    item.stage = null;
    handlers.onList(items, notices);
    if (!announcedBusy) {
      announcedBusy = true;
      handlers.onBusy(1);
    }
    pump();
    return notices;
  }

  function addDonor(id, file) {
    const notices = { duplicates: 0, overflow: false, copiesFull: false, tooLarge: false };
    const item = findItem(id);
    if (!item || !canAddDonor(item)) return notices;
    if (file.size > LIMITS.bytes) {
      notices.tooLarge = true;
      handlers.onList(items, notices);
      return notices;
    }
    if (fileKey(file) === item.key || (item.donor && fileKey(item.donor) === fileKey(file))) {
      notices.duplicates++;
      handlers.onList(items, notices);
      return notices;
    }
    item.donor = file;
    item.result = null;
    item.status = 'queued';
    item.pct = 0;
    item.stage = null;
    handlers.onList(items, notices);
    if (!announcedBusy) {
      announcedBusy = true;
      handlers.onBusy(1);
    }
    pump();
    return notices;
  }

  function createUrl(bytes, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    urls.add(url);
    setTimeout(() => {
      URL.revokeObjectURL(url);
      urls.delete(url);
    }, 60000);
    return url;
  }

  function save(bytes, mime, name) {
    const url = createUrl(bytes, mime);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadOutput(item, which = 'output') {
    const out = item.result && item.result[which];
    if (out) save(out.bytes, out.mime, out.name);
  }

  function exportOutput(item, kind) {
    const out = item.result && item.result.output;
    if (!out) return Promise.resolve(false);
    const stem = item.name.replace(/\.[^.]+$/, '');
    return new Promise((resolve) => {
      const worker = new Worker(workerUrl, { type: 'module' });
      const finish = (ok) => {
        worker.terminate();
        resolve(ok);
      };
      worker.onmessage = (event) => {
        if (event.data.type !== 'exported') return;
        if (event.data.ok) save(event.data.buffer, event.data.mime, event.data.name);
        finish(event.data.ok);
      };
      worker.onerror = () => finish(false);
      const buffer = out.bytes.slice(0);
      worker.postMessage({ type: 'export', req: 1, kind, stem, buffer }, [buffer]);
    });
  }

  function uniqueName(name, used) {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 2;
    while (used.has(`${stem} (${n})${ext}`)) n++;
    const result = `${stem} (${n})${ext}`;
    used.add(result);
    return result;
  }

  function downloadAll() {
    const used = new Set();
    const files = [];
    for (const item of items) {
      const out = item.result && item.result.output;
      if (out) files.push({ name: uniqueName(out.name, used), buffer: out.bytes.slice(0) });
    }
    if (files.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const worker = new Worker(workerUrl, { type: 'module' });
      worker.onmessage = (event) => {
        if (event.data.type !== 'zipped') return;
        save(event.data.buffer, 'application/zip', `Seam repaired files ${formatLocalDate(new Date())}.zip`);
        worker.terminate();
        resolve();
      };
      worker.postMessage({ type: 'zip', req: 1, files }, files.map((file) => file.buffer));
    });
  }

  function clear() {
    generation++;
    for (const slot of workers) {
      clearTimeout(slot.timer);
      slot.worker.terminate();
    }
    workers = [];
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    items = [];
    keys = new Set();
    announcedBusy = false;
    handlers.onList(items, { duplicates: 0, overflow: false });
    handlers.onSummary();
    ensureWorkers();
  }

  function inject(entries) {
    for (const entry of entries) {
      const item = { id: nextId++, key: `demo-${nextId}`, file: null, name: entry.name, size: entry.size, lastModified: 0, status: 'done', pct: 100, stage: null, result: entry.result, copies: [], donor: null };
      items.push(item);
    }
    handlers.onList(items, { duplicates: 0, overflow: false });
    handlers.onSummary();
  }

  ensureWorkers();

  return { add, addCopies, addDonor, clear, downloadOutput, downloadAll, exportOutput, inject, items: () => items, save };
}
