import { CT_MAIN, CT_NS, PKG_REL_NS, REL_OFFICE_DOC, OUTPUT_MIME, REL_BASE } from './constants.js';
import { writeZip } from './zip-write.js';
import { encodeUtf8 } from './xml-clean.js';
import { decodeEntities, escapeText, escapeAttr } from './xml-repair.js';

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
const REL_RELS = 'application/vnd.openxmlformats-package.relationships+xml';

const DOCX_TOKEN = /<w:p(?=[\s\/>])[^>]*>|<w:t(?=[\s\/>])[^>]*?(?:\/>|>([^<]*))|<w:tab\s*\/>|<w:br\b[^>]*>/g;
const PPTX_TOKEN = /<a:p(?=[\s\/>])[^>]*>|<a:t(?=[\s\/>])[^>]*?(?:\/>|>([^<]*))|<a:br\b[^>]*>/g;
const INVALID = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function clean(text) {
  return text.replace(INVALID, '');
}

function trimEmpty(list) {
  const out = list.slice();
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  while (out.length > 0 && out[0].trim() === '') out.shift();
  return out;
}

export function extractParagraphs(text, token, brLocal) {
  const paragraphs = [];
  let current = null;
  const open = () => {
    if (!current) {
      current = [];
      paragraphs.push(current);
    }
    return current;
  };
  for (const match of text.matchAll(token)) {
    const tag = match[0];
    if (/^<[wa]:p[\s\/>]/.test(tag)) {
      current = [];
      paragraphs.push(current);
    } else if (/^<[wa]:t[\s\/>]/.test(tag)) {
      if (match[1] !== undefined) open().push(clean(decodeEntities(match[1])));
    } else if (tag.startsWith('<w:tab')) {
      open().push('\t');
    } else if (tag.startsWith(brLocal)) {
      open().push('\n');
    }
  }
  return paragraphs.map((p) => p.join(''));
}

function naturalKey(name) {
  const match = /(\d+)\.xml$/i.exec(name);
  return match ? Number(match[1]) : 0;
}

function textParts(sources, test) {
  return Array.from(sources.keys()).filter(test).sort((a, b) => naturalKey(a) - naturalKey(b) || a.localeCompare(b));
}

function docxParagraphs(sources) {
  const names = sources.has('word/document.xml') ? ['word/document.xml'] : textParts(sources, (n) => /^word\/.*\.xml$/i.test(n) && sources.get(n).includes('<w:t'));
  const paragraphs = [];
  for (const name of names) paragraphs.push(...extractParagraphs(sources.get(name), DOCX_TOKEN, '<w:br'));
  return trimEmpty(paragraphs);
}

function pptxParagraphs(sources) {
  const slides = textParts(sources, (n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n));
  const out = [];
  for (const name of slides) {
    const number = naturalKey(name);
    const lines = extractParagraphs(sources.get(name), PPTX_TOKEN, '<a:br').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    out.push({ text: `Slide ${number}`, bold: true });
    for (const line of lines) out.push({ text: line, bold: false });
  }
  return out;
}

function cellValue(attrs, inner, strings) {
  const type = /\bt="([^"]*)"/.exec(attrs);
  const kind = type ? type[1] : 'n';
  if (kind === 'inlineStr') {
    const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner);
    if (!is) return null;
    const parts = [];
    for (const m of is[1].matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)) parts.push(m[1]);
    return parts.length === 0 ? null : { kind: 'inlineStr', value: clean(decodeEntities(parts.join(''))) };
  }
  const v = /<v>([^<]*)<\/v>/.exec(inner);
  if (!v) return null;
  const raw = decodeEntities(v[1]);
  if (kind === 's') {
    const index = Number(raw);
    return Number.isInteger(index) && strings[index] !== undefined ? { kind: 'inlineStr', value: strings[index] } : null;
  }
  if (kind === 'str' || kind === 'd') return { kind: 'inlineStr', value: clean(raw) };
  if (kind === 'b') return { kind: 'b', value: raw.trim() === '1' ? '1' : '0' };
  if (kind === 'e') return { kind: 'e', value: clean(raw) };
  return Number.isFinite(Number(raw)) && raw.trim() !== '' ? { kind: 'n', value: raw.trim() } : null;
}

function sharedStrings(sources) {
  const name = Array.from(sources.keys()).find((n) => /^xl\/sharedStrings\.xml$/i.test(n));
  if (!name) return [];
  const out = [];
  for (const match of sources.get(name).matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    const body = (match[1] || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    const parts = [];
    for (const t of body.matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)) parts.push(t[1]);
    out.push(clean(decodeEntities(parts.join(''))));
  }
  return out;
}

function columnIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function sheetNames(sources) {
  const map = new Map();
  const workbook = sources.get('xl/workbook.xml');
  const rels = sources.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) return map;
  const targets = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0]);
    const target = /\bTarget="([^"]*)"/.exec(m[0]);
    if (id && target) targets.set(id[1], target[1]);
  }
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0]);
    const id = /\br:id="([^"]*)"/.exec(m[0]);
    if (name && id && targets.has(id[1])) {
      const target = targets.get(id[1]).replace(/^\/?(xl\/)?/, 'xl/');
      map.set(target.toLowerCase(), clean(decodeEntities(name[1])));
    }
  }
  return map;
}

function xlsxSheets(sources) {
  const strings = sharedStrings(sources);
  const names = sheetNames(sources);
  const parts = textParts(sources, (n) => /^xl\/worksheets\/[^\/]+\.xml$/i.test(n));
  const sheets = [];
  const used = new Set();
  parts.forEach((part, order) => {
    const cells = new Map();
    for (const match of sources.get(part).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)(\d+)"/.exec(match[1]);
      if (!ref || match[2] === undefined) continue;
      const value = cellValue(match[1], match[2], strings);
      if (value) cells.set(`${ref[2]}:${ref[1]}`, { row: Number(ref[2]), col: columnIndex(ref[1]), letters: ref[1], ...value });
    }
    if (cells.size === 0) return;
    let name = (names.get(part.toLowerCase()) || `Sheet${order + 1}`).replace(/[\[\]:*?\/\\]/g, '_').slice(0, 31) || `Sheet${order + 1}`;
    let n = 2;
    const base = name;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 28)} (${n++})`;
    used.add(name.toLowerCase());
    const rows = new Map();
    for (const cell of cells.values()) {
      if (!rows.has(cell.row)) rows.set(cell.row, []);
      rows.get(cell.row).push(cell);
    }
    const ordered = Array.from(rows.keys()).sort((a, b) => a - b).map((row) => ({ row, cells: rows.get(row).sort((a, b) => a.col - b.col) }));
    sheets.push({ name, rows: ordered });
  });
  return sheets;
}

function runsXml(text) {
  const out = [];
  for (const piece of text.split(/(\t|\n)/)) {
    if (piece === '\t') out.push('<w:r><w:tab/></w:r>');
    else if (piece === '\n') out.push('<w:r><w:br/></w:r>');
    else if (piece !== '') out.push(`<w:r><w:t xml:space="preserve">${escapeText(piece)}</w:t></w:r>`);
  }
  return out.join('');
}

function pack(entries) {
  const now = new Date();
  return writeZip(entries.map(([name, text]) => ({ name, data: encodeUtf8(text), mtime: now })));
}

function contentTypes(overrides) {
  const items = overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('');
  return `${DECL}<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="${REL_RELS}"/><Default Extension="xml" ContentType="application/xml"/>${items}</Types>`;
}

function relationships(list) {
  const items = list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('');
  return `${DECL}<Relationships xmlns="${PKG_REL_NS}">${items}</Relationships>`;
}

export function buildDocx(paragraphs) {
  const body = paragraphs
    .map((p) => {
      const item = typeof p === 'string' ? { text: p, bold: false } : p;
      if (item.bold) return `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeText(item.text)}</w:t></w:r></w:p>`;
      return item.text === '' ? '<w:p/>' : `<w:p>${runsXml(item.text)}</w:p>`;
    })
    .join('');
  return pack([
    ['[Content_Types].xml', contentTypes([['/word/document.xml', CT_MAIN.docx]])],
    ['_rels/.rels', relationships([['rId1', REL_OFFICE_DOC, 'word/document.xml']])],
    ['word/document.xml', `${DECL}<w:document xmlns:w="${NS_W}"><w:body>${body}</w:body></w:document>`]
  ]);
}

export function buildXlsx(sheets) {
  const overrides = [['/xl/workbook.xml', CT_MAIN.xlsx]];
  const sheetRefs = [];
  const relList = [];
  const entries = [];
  sheets.forEach((sheet, i) => {
    const n = i + 1;
    overrides.push([`/xl/worksheets/sheet${n}.xml`, `${SML}worksheet+xml`]);
    sheetRefs.push(`<sheet name="${escapeAttr(sheet.name)}" sheetId="${n}" r:id="rId${n}"/>`);
    relList.push([`rId${n}`, `${REL_BASE}worksheet`, `worksheets/sheet${n}.xml`]);
    const rows = sheet.rows
      .map((row) => {
        const cells = row.cells
          .map((cell) => {
            const ref = `${cell.letters}${cell.row}`;
            if (cell.kind === 'inlineStr') return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeText(cell.value)}</t></is></c>`;
            if (cell.kind === 'b') return `<c r="${ref}" t="b"><v>${cell.value}</v></c>`;
            if (cell.kind === 'e') return `<c r="${ref}" t="e"><v>${escapeText(cell.value)}</v></c>`;
            return `<c r="${ref}"><v>${cell.value}</v></c>`;
          })
          .join('');
        return `<row r="${row.row}">${cells}</row>`;
      })
      .join('');
    entries.push([`xl/worksheets/sheet${n}.xml`, `${DECL}<worksheet xmlns="${NS_S}"><sheetData>${rows}</sheetData></worksheet>`]);
  });
  return pack([
    ['[Content_Types].xml', contentTypes(overrides)],
    ['_rels/.rels', relationships([['rId1', REL_OFFICE_DOC, 'xl/workbook.xml']])],
    ['xl/workbook.xml', `${DECL}<workbook xmlns="${NS_S}" xmlns:r="${NS_R}"><sheets>${sheetRefs.join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', relationships(relList)],
    ...entries
  ]);
}

function pickFamily(sources, hint) {
  const names = Array.from(sources.keys());
  const has = {
    docx: names.some((n) => /^word\/.*\.xml$/i.test(n) && sources.get(n).includes('<w:t')),
    xlsx: names.some((n) => /^xl\/worksheets\/[^\/]+\.xml$/i.test(n)),
    pptx: names.some((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
  };
  if (hint && has[hint]) return hint;
  for (const key of ['docx', 'xlsx', 'pptx']) if (has[key]) return key;
  return hint || null;
}

export function salvage(sources, hint, base) {
  const family = pickFamily(sources, hint);
  const result = { ok: false, family, key: null, bytes: null, name: null, mime: null, preview: null, length: 0 };
  if (family === 'xlsx') {
    const sheets = xlsxSheets(sources);
    if (sheets.length === 0) return result;
    const lines = [];
    let length = 0;
    for (const sheet of sheets) {
      lines.push(sheet.name);
      for (const row of sheet.rows) {
        lines.push(row.cells.map((c) => c.value).join('\t'));
        for (const cell of row.cells) length += cell.value.length;
      }
    }
    if (length === 0) return result;
    return { ok: true, family, key: 'xlsx', bytes: buildXlsx(sheets), name: `${base} (salvaged text).xlsx`, mime: OUTPUT_MIME.xlsx, preview: lines.join('\n').slice(0, 600), length };
  }
  let paragraphs;
  if (family === 'pptx') paragraphs = pptxParagraphs(sources);
  else {
    const found = docxParagraphs(sources);
    if (found.length === 0 && family !== 'docx') {
      const generic = [];
      for (const [, text] of sources) generic.push(...extractParagraphs(text, DOCX_TOKEN, '<w:br'));
      paragraphs = trimEmpty(generic);
    } else paragraphs = found;
  }
  const plain = paragraphs.map((p) => (typeof p === 'string' ? p : p.text));
  const length = plain.join('').replace(/\s/g, '').length;
  if (length === 0) return result;
  return { ok: true, family, key: 'docx', bytes: buildDocx(paragraphs), name: `${base} (salvaged text).docx`, mime: OUTPUT_MIME.docx, preview: plain.join('\n').slice(0, 600), length };
}
