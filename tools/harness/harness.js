import { runPipeline } from '../../js/core/pipeline.js';

function heapBytes() {
  return performance.memory ? performance.memory.usedJSHeapSize : 0;
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : 'bin';
}

async function upload(path, ext, bytes) {
  const response = await fetch(path, { method: 'PUT', headers: { 'x-ext': ext }, body: bytes });
  if (!response.ok) throw new Error(`upload failed ${response.status}`);
}

window.seamRun = async (sourceUrl, name, outId) => {
  const response = await fetch(sourceUrl);
  const buffer = await response.arrayBuffer();
  const base = heapBytes();
  let peak = base;
  const sample = () => {
    const now = heapBytes();
    if (now > peak) peak = now;
  };
  const env = {
    isWellFormed: async (text) => {
      sample();
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      return doc.getElementsByTagName('parsererror').length === 0;
    },
    progress: sample
  };
  const started = performance.now();
  const result = await runPipeline({ name, size: buffer.byteLength, buffer, lastModified: 0 }, env);
  const ms = performance.now() - started;
  sample();
  const outputs = {};
  for (const key of ['output', 'extraOutput']) {
    const out = result[key];
    if (!out) continue;
    const ext = extensionOf(out.name);
    const id = key === 'output' ? outId : `${outId}.extra`;
    await upload(`/__out/${id}.${ext}`, ext, out.bytes);
    outputs[key] = { file: `${id}.${ext}`, name: out.name, bytes: out.bytes.length };
  }
  return {
    outcome: result.outcome,
    detected: result.detected ? result.detected.kind : null,
    verified: result.verified === true,
    tier: typeof result.tier === 'number' ? result.tier : null,
    findings: (result.findings || []).map((f) => ({ code: f.code, severity: f.severity, part: f.part, elements: f.data && f.data.elements ? f.data.elements : undefined })),
    sentence: result.sentence || '',
    outputs,
    ms: Math.round(ms),
    peakMB: Math.max(0, Math.round(((peak - base) / 1048576) * 10) / 10),
    heapMethod: performance.memory ? 'js-heap-sampled' : 'unavailable'
  };
};

window.seamReady = true;
