import { createHash } from 'node:crypto';
import { unzipSync } from '../vendor/fflate.module.js';

export const OOXML_EXT = /\.(docx|docm|dotx|dotm|xlsx|xlsm|xltx|xltm|pptx|pptm|potx|potm|ppsx|ppsm)$/i;
export const BROKEN_NAME = /(crash|fuzz|ofz|corrupt|invalid|broken|truncat|malform|poc|bomb|damaged|garbage|bad[-_ ]?zip|zero[-_ ]?byte|empty)/i;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function familyOfExt(name) {
  const m = /\.(docx|docm|dotx|dotm|xlsx|xlsm|xltx|xltm|pptx|pptm|potx|potm|ppsx|ppsm)$/i.exec(name);
  if (!m) return null;
  const e = m[1].toLowerCase();
  if (e.startsWith('doc') || e.startsWith('dot')) return 'docx';
  if (e.startsWith('xls') || e.startsWith('xlt')) return 'xlsx';
  return 'pptx';
}

export function producerClass(text) {
  if (!text) return 'unknown';
  if (/apache poi/i.test(text)) return 'poi';
  if (/libreoffice|openoffice|staroffice/i.test(text)) return 'libreoffice';
  if (/google/i.test(text)) return 'google';
  if (/wps|kingsoft/i.test(text)) return 'wps';
  if (/keynote|pages|numbers|apple/i.test(text)) return 'apple';
  if (/python-docx|python-pptx|openpyxl/i.test(text)) return 'python';
  if (/aspose|syncfusion|spire|docx4j|npoi|closedxml|epplus|clickhouse|sheetjs/i.test(text)) return 'other-library';
  if (/microsoft.*(word)|word/i.test(text)) return 'word';
  if (/microsoft.*excel|excel/i.test(text)) return 'excel';
  if (/powerpoint/i.test(text)) return 'powerpoint';
  return 'other';
}

function tag(xml, name) {
  const m = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xml);
  return m ? m[1].trim() : '';
}

function text(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function analyze(bytes) {
  let names = [];
  let sizes = new Map();
  let files;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        sizes.set(f.name, f.originalSize);
        return /^(docProps\/(app|core)\.xml|word\/document\.xml|\[Content_Types\]\.xml)$/.test(f.name);
      }
    });
  } catch (error) {
    return { ok: false, reason: 'unzip', message: String(error.message || error) };
  }
  if (!names.includes('[Content_Types].xml')) return { ok: false, reason: 'no-content-types' };
  const app = files['docProps/app.xml'] ? text(files['docProps/app.xml']) : '';
  const core = files['docProps/core.xml'] ? text(files['docProps/core.xml']) : '';
  const application = tag(app, 'Application');
  const version = tag(app, 'AppVersion');
  const lastModifiedBy = tag(core, 'cp:lastModifiedBy');
  const creator = tag(core, 'dc:creator');
  const producer = [application, version].filter(Boolean).join(' ') || (lastModifiedBy || creator || 'unknown');
  const probe = application || `${creator} ${lastModifiedBy}`;
  const doc = files['word/document.xml'] ? text(files['word/document.xml']) : '';
  const features = [];
  const has = (re) => names.some((n) => re.test(n));
  if (has(/\/charts\/chart[^/]*\.xml$/i)) features.push('charts');
  if (has(/(comments[^/]*\.xml$)|(commentAuthors\.xml$)/i)) features.push('comments');
  if (/<w:(ins|del)\s/.test(doc)) features.push('trackedChanges');
  if (has(/\/embeddings\//i)) features.push('embeddings');
  if (has(/vbaProject\.bin$/i)) features.push('macros');
  if (has(/pivotTables\//i)) features.push('pivot');
  if (has(/\/diagrams\//i)) features.push('smartart');
  if (has(/\/media\/[^/]+\.(mp4|mov|avi|wmv|m4v|mpg|mpeg)$/i)) features.push('video');
  if ([...sizes.values()].some((s) => s > 10 * 1024 * 1024)) features.push('bigPart');
  return { ok: true, producer, producerClass: producerClass(probe), features, parts: names.length };
}
