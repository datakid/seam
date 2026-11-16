import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

function decode(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(lt|gt|amp|quot|apos);/g, (m) => ENTITIES[m]);
}

function runs(xml, tagName) {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${tagName}(?:\\s[^>]*)?>([^<]*)</(?:[A-Za-z0-9]+:)?${tagName}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(decode(m[1]));
  return out;
}

function sharedStrings(xml) {
  const items = [];
  const re = /<(?:[A-Za-z0-9]+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?si>/g;
  let m;
  while ((m = re.exec(xml))) items.push(runs(m[1], 't').join(''));
  return items;
}

function attr(tagText, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tagText);
  return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
}

function sheetCells(xml, shared) {
  const out = [];
  const re = /<(?:[A-Za-z0-9]+:)?c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?c>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const head = m[1] || '';
    const body = m[2] || '';
    const type = attr(head, 't');
    if (type === 'inlineStr') {
      const t = runs(body, 't').join('');
      if (t) out.push(t);
      continue;
    }
    const v = runs(body, 'v')[0];
    if (v === undefined || v === '') continue;
    if (type === 's') {
      const s = shared[Number(v)];
      if (s) out.push(s);
    } else out.push(v);
  }
  return out;
}

function naturalSort(names) {
  return names.sort((a, b) => {
    const na = Number((/(\d+)\.xml$/.exec(a) || [0, 0])[1]);
    const nb = Number((/(\d+)\.xml$/.exec(b) || [0, 0])[1]);
    return na - nb || a.localeCompare(b);
  });
}

export function extractText(bytes) {
  let files;
  try {
    files = unzipSync(bytes, { filter: (f) => /\.xml$/i.test(f.name) });
  } catch {
    return { ok: false, tokens: [] };
  }
  const names = Object.keys(files);
  const tokens = [];
  const push = (text) => {
    for (const t of text.split(/\s+/)) if (t) tokens.push(t);
  };
  const doc = names.find((n) => /^word\/document\.xml$/i.test(n));
  if (doc) {
    const xml = strFromU8(files[doc]);
    const paragraphs = xml.split(/<\/(?:[A-Za-z0-9]+:)?p>/);
    for (const p of paragraphs) push(runs(p, 't').join(''));
    for (const extra of naturalSort(names.filter((n) => /^word\/(footnotes|endnotes|comments)\.xml$/i.test(n)))) {
      for (const p of strFromU8(files[extra]).split(/<\/(?:[A-Za-z0-9]+:)?p>/)) push(runs(p, 't').join(''));
    }
  }
  const sst = names.find((n) => /^xl\/sharedStrings\.xml$/i.test(n));
  const shared = sst ? sharedStrings(strFromU8(files[sst])) : [];
  const sheets = naturalSort(names.filter((n) => /^xl\/worksheets\/[^/]+\.xml$/i.test(n)));
  for (const s of sheets) for (const cell of sheetCells(strFromU8(files[s]), shared)) push(cell);
  const slides = naturalSort(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n)));
  for (const s of slides) {
    for (const p of strFromU8(files[s]).split(/<\/(?:[A-Za-z0-9]+:)?p>/)) push(runs(p, 't').join(''));
  }
  return { ok: true, tokens };
}

function lcsLength(a, b, maxD) {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const limit = Math.min(max, maxD);
  for (let d = 0; d <= limit; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return (n + m - d) / 2;
    }
  }
  return -1;
}

function greedyLength(a, b) {
  const positions = new Map();
  for (let i = 0; i < a.length; i++) {
    if (!positions.has(a[i])) positions.set(a[i], []);
    positions.get(a[i]).push(i);
  }
  let pointer = 0;
  let matched = 0;
  for (const token of b) {
    const list = positions.get(token);
    if (!list) continue;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < pointer) lo = mid + 1;
      else hi = mid;
    }
    if (lo < list.length) {
      pointer = list[lo] + 1;
      matched++;
    }
  }
  return matched;
}

export function recall(pristine, output) {
  if (pristine.length === 0) return output.length === 0 ? 1 : 1;
  if (output.length === 0) return 0;
  const lcs = lcsLength(pristine, output, 4000);
  const matched = lcs >= 0 ? lcs : greedyLength(pristine, output);
  return Math.min(1, matched / pristine.length);
}
