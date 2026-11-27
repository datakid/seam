import { unzipSync, strFromU8 } from '../../vendor/fflate.module.js';

const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const PREFIX = '(?:[\\w.-]+:)?';

export function decodeText(text) {
  return text
    .replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g, (match, hex, dec, name) => {
      if (name) return NAMED[name];
      const code = hex ? parseInt(hex, 16) : Number(dec);
      const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : '';
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (match, hex) => {
      const code = parseInt(hex, 16);
      return code >= 0x20 || code === 9 || code === 10 || code === 13 ? String.fromCharCode(code) : '';
    });
}

function attr(head, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(head);
  if (!match) return null;
  return decodeText(match[1] !== undefined ? match[1] : match[2]);
}

function localTexts(xml) {
  const out = [];
  const pattern = new RegExp(`<${PREFIX}t(?=[\\s>])[^>]*>([^<]*)</${PREFIX}t>`, 'g');
  let match;
  while ((match = pattern.exec(xml)) !== null) out.push(decodeText(match[1]));
  return out;
}

function paragraphText(xml) {
  let out = '';
  const pattern = new RegExp(`<${PREFIX}(t|tab|br|cr)(?=[\\s/>])[^>]*?(?:/>|>([^<]*)</${PREFIX}t>|>)`, 'g');
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    if (match[1] === 't') out += match[2] === undefined ? '' : decodeText(match[2]);
    else if (match[1] === 'tab') out += '\t';
    else out += '\n';
  }
  return out;
}

function withoutNoise(xml) {
  return xml
    .replace(new RegExp(`<${PREFIX}tabs\\b[\\s\\S]*?</${PREFIX}tabs>`, 'g'), '')
    .replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '');
}

function splitParagraphs(xml) {
  return withoutNoise(xml).split(new RegExp(`</${PREFIX}p>`)).slice(0, -1).map(paragraphText);
}

function naturalNames(names) {
  const number = (name) => Number((/(\d+)\.xml$/i.exec(name) || [0, 0])[1]);
  return names.slice().sort((a, b) => number(a) - number(b) || a.localeCompare(b));
}

function resolveTarget(basePart, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = basePart.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.' && piece !== '') parts.push(piece);
  }
  return parts.join('/');
}

function relationshipTargets(files, partName) {
  const slash = partName.lastIndexOf('/');
  const relsName = `${partName.slice(0, slash + 1)}_rels/${partName.slice(slash + 1)}.rels`;
  const out = new Map();
  if (!files[relsName]) return out;
  const text = strFromU8(files[relsName]);
  const pattern = /<(?:[\w.-]+:)?Relationship\b([^>]*?)\/?>/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const id = attr(match[1], 'Id');
    const target = attr(match[1], 'Target');
    if (id && target && attr(match[1], 'TargetMode') !== 'External') out.set(id, resolveTarget(partName, target));
  }
  return out;
}

export function packageParts(bytes, filter) {
  try {
    return unzipSync(bytes, { filter });
  } catch {
    return null;
  }
}

export function packageNames(bytes) {
  const names = [];
  try {
    unzipSync(bytes, {
      filter(file) {
        names.push(file.name);
        return false;
      }
    });
  } catch {
    return [];
  }
  return names;
}

export function packageKind(names) {
  const has = (name) => names.some((n) => n.toLowerCase() === name);
  if (has('word/document.xml')) return 'document';
  if (has('xl/workbook.xml')) return 'workbook';
  if (has('ppt/presentation.xml')) return 'presentation';
  return null;
}

export function documentParagraphs(files) {
  const main = files['word/document.xml'];
  if (!main) return [];
  const out = splitParagraphs(strFromU8(main));
  for (const name of naturalNames(Object.keys(files).filter((n) => /^word\/(footnotes|endnotes|comments)\.xml$/.test(n)))) {
    const extra = splitParagraphs(strFromU8(files[name])).filter((p) => p.trim() !== '');
    if (extra.length > 0) out.push('', ...extra);
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out;
}

function sharedStrings(files) {
  const part = files['xl/sharedStrings.xml'];
  if (!part) return [];
  const items = [];
  const pattern = new RegExp(`<${PREFIX}si\\b[^>]*?(?:/>|>([\\s\\S]*?)</${PREFIX}si>)`, 'g');
  const text = strFromU8(part);
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const body = (match[1] || '').replace(new RegExp(`<${PREFIX}rPh\\b[\\s\\S]*?</${PREFIX}rPh>`, 'g'), '');
    items.push(localTexts(body).join(''));
  }
  return items;
}

function columnIndex(ref) {
  const letters = /^[A-Za-z]+/.exec(ref);
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[0].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function cellValue(head, body, shared) {
  const type = attr(head, 't');
  if (type === 'inlineStr') return localTexts(body).join('');
  const match = new RegExp(`<${PREFIX}v(?=[\\s>])[^>]*>([^<]*)</${PREFIX}v>`).exec(body);
  if (!match) return '';
  const raw = decodeText(match[1]);
  if (type === 's') return shared[Number(raw)] !== undefined ? shared[Number(raw)] : '';
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  return raw;
}

export function sheetRows(xml, shared, limit = Infinity) {
  const rows = [];
  const rowPattern = new RegExp(`<${PREFIX}row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${PREFIX}row>)`, 'g');
  const cellPattern = new RegExp(`<${PREFIX}c(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</${PREFIX}c>)`, 'g');
  let rowMatch;
  let nextRow = 0;
  while ((rowMatch = rowPattern.exec(xml)) !== null && rows.length < limit) {
    const declared = attr(rowMatch[1], 'r');
    const index = declared !== null && /^\d+$/.test(declared) ? Number(declared) - 1 : nextRow;
    nextRow = index + 1;
    const cells = [];
    let nextCol = 0;
    let cellMatch;
    cellPattern.lastIndex = 0;
    const body = rowMatch[2] || '';
    while ((cellMatch = cellPattern.exec(body)) !== null) {
      const ref = attr(cellMatch[1], 'r');
      const col = ref !== null && columnIndex(ref) >= 0 ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      cells[col] = cellValue(cellMatch[1], cellMatch[2] || '', shared);
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    rows.push({ index, cells });
  }
  return rows;
}

export function workbookSheets(files, options = {}) {
  const shared = sharedStrings(files);
  const book = files['xl/workbook.xml'];
  const listed = [];
  if (book) {
    const targets = relationshipTargets(files, 'xl/workbook.xml');
    const pattern = /<(?:[\w.-]+:)?sheet\b([^>]*?)\/?>/g;
    const text = strFromU8(book);
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const id = attr(match[1], 'r:id') || attr(match[1], 'id');
      const part = id ? targets.get(id) : null;
      if (part && files[part]) listed.push({ name: attr(match[1], 'name') || `Sheet${listed.length + 1}`, part });
    }
  }
  if (listed.length === 0) {
    for (const part of naturalNames(Object.keys(files).filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)))) {
      listed.push({ name: `Sheet${listed.length + 1}`, part });
    }
  }
  return listed.map(({ name, part }) => {
    let xml = strFromU8(files[part]);
    if (options.sample && xml.length > options.sample) xml = xml.slice(0, options.sample);
    return { name, rows: sheetRows(xml, shared, options.rowLimit) };
  });
}

function shapeTitle(shape) {
  const marker = new RegExp(`<${PREFIX}ph\\b[^>]*\\btype\\s*=\\s*["'](?:title|ctrTitle)["']`);
  return marker.test(shape);
}

export function presentationSlides(files) {
  let parts = [];
  const presentation = files['ppt/presentation.xml'];
  if (presentation) {
    const targets = relationshipTargets(files, 'ppt/presentation.xml');
    const pattern = /<(?:[\w.-]+:)?sldId\b([^>]*?)\/?>/g;
    const text = strFromU8(presentation);
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const id = attr(match[1], 'r:id');
      const part = id ? targets.get(id) : null;
      if (part && files[part]) parts.push(part);
    }
  }
  if (parts.length === 0) parts = naturalNames(Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)));
  return parts.map((part, index) => {
    const xml = strFromU8(files[part]);
    const lines = splitParagraphs(xml).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p !== '');
    const shapes = xml.match(new RegExp(`<${PREFIX}sp\\b[\\s\\S]*?</${PREFIX}sp>`, 'g')) || [];
    let title = '';
    for (const shape of shapes) {
      if (shapeTitle(shape)) {
        title = splitParagraphs(shape).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p !== '').join(' ');
        if (title) break;
      }
    }
    return { number: index + 1, title: title || lines[0] || '', lines };
  });
}
