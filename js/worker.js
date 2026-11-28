import { runPipeline } from './core/pipeline.js';
import { failedResult } from './core/report.js';
import { copy } from './copy.js';
import { zipSync } from '../vendor/fflate.module.js';
import { buildView } from './core/preview.js';
import { buildExport } from './core/export.js';
import { makeWellFormed } from './core/xml-check.js';

let counter = 0;
const pending = new Map();

function checker(id) {
  return (text) =>
    new Promise((resolve) => {
      const req = ++counter;
      pending.set(req, resolve);
      self.postMessage({ type: 'xmlcheck', id, req, text });
    });
}

function detach(result) {
  const transfer = [];
  for (const key of ['output', 'extraOutput']) {
    const out = result[key];
    if (out) {
      const copyBytes = new Uint8Array(out.bytes);
      out.bytes = copyBytes.buffer;
      transfer.push(copyBytes.buffer);
    }
  }
  return transfer;
}

async function handleProcess(msg) {
  const env = {
    isWellFormed: makeWellFormed(checker(msg.id)),
    progress: (stage, pct) => self.postMessage({ type: 'progress', id: msg.id, stage, pct })
  };
  let result;
  try {
    result = await runPipeline({ name: msg.name, size: msg.size, buffer: msg.buffer, lastModified: msg.lastModified, copies: msg.copies || [], donor: msg.donor || null }, env);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    result = failedResult('INTERNAL_ERROR', copy.reasons.internal);
  }
  attachView(result);
  const transfer = detach(result);
  self.postMessage({ type: 'result', id: msg.id, result }, transfer);
}

function attachView(result) {
  if (!result.output) return;
  try {
    const bytes = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
    result.view = buildView(bytes);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    result.view = null;
  }
}

function handleExport(msg) {
  let made = null;
  try {
    made = buildExport(msg.kind, new Uint8Array(msg.buffer), msg.stem);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
  }
  if (!made) {
    self.postMessage({ type: 'exported', req: msg.req, ok: false });
    return;
  }
  const buffer = made.bytes.buffer.slice(made.bytes.byteOffset, made.bytes.byteOffset + made.bytes.byteLength);
  self.postMessage({ type: 'exported', req: msg.req, ok: true, name: made.name, mime: made.mime, buffer }, [buffer]);
}

function handleZip(msg) {
  const files = {};
  for (const file of msg.files) files[file.name] = [new Uint8Array(file.buffer), { level: 0 }];
  const bytes = zipSync(files);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  self.postMessage({ type: 'zipped', req: msg.req, buffer }, [buffer]);
}

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'xmlresult') {
    const resolve = pending.get(msg.req);
    if (resolve) {
      pending.delete(msg.req);
      resolve(msg.ok);
    }
    return;
  }
  if (msg.type === 'process') {
    handleProcess(msg);
    return;
  }
  if (msg.type === 'zip') handleZip(msg);
  if (msg.type === 'export') handleExport(msg);
};
