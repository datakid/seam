import { decodeEntities, escapeAttr, localName, prefixOf } from './xml-repair.js';
import { CT_NS, PKG_REL_NS, REL_NS } from './constants.js';

const OX = 'http://schemas.openxmlformats.org/';
const MS = 'http://schemas.microsoft.com/office/';

const WORD_NS = `${OX}wordprocessingml/2006/main`;
const SHEET_NS = `${OX}spreadsheetml/2006/main`;
const SLIDE_NS = `${OX}presentationml/2006/main`;
const DRAWING_NS = `${OX}drawingml/2006/main`;
const EXTENDED_NS = `${OX}officeDocument/2006/extended-properties`;
const CORE_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';

const KNOWN = [
  WORD_NS, SHEET_NS, SLIDE_NS, DRAWING_NS, REL_NS, PKG_REL_NS, CT_NS, EXTENDED_NS, CORE_NS,
  `${OX}officeDocument/2006/math`,
  `${OX}officeDocument/2006/custom-properties`,
  `${OX}officeDocument/2006/docPropsVTypes`,
  `${OX}drawingml/2006/chart`,
  `${OX}drawingml/2006/diagram`,
  `${OX}drawingml/2006/picture`,
  `${OX}drawingml/2006/wordprocessingDrawing`,
  `${OX}drawingml/2006/spreadsheetDrawing`,
  `${OX}markup-compatibility/2006`,
  'urn:schemas-microsoft-com:office:office',
  'urn:schemas-microsoft-com:vml',
  'urn:schemas-microsoft-com:office:word',
  'urn:schemas-microsoft-com:office:excel',
  'urn:schemas-microsoft-com:office:powerpoint',
  `${MS}word/2010/wordml`,
  `${MS}word/2012/wordml`,
  `${MS}word/2006/wordml`,
  `${MS}spreadsheetml/2009/9/ac`,
  `${MS}spreadsheetml/2009/9/main`,
  `${MS}excel/2006/main`,
  `${MS}powerpoint/2010/main`,
  `${MS}drawing/2010/main`,
  'http://purl.org/dc/elements/1.1/',
  'http://purl.org/dc/terms/',
  'http://purl.org/dc/dcmitype/',
  'http://www.w3.org/2001/XMLSchema-instance',
  'http://www.w3.org/XML/1998/namespace'
];

const ROOT_DEFAULTS = {
  Types: CT_NS,
  Relationships: PKG_REL_NS,
  coreProperties: CORE_NS,
  Properties: EXTENDED_NS,
  worksheet: SHEET_NS,
  workbook: SHEET_NS,
  styleSheet: SHEET_NS,
  sst: SHEET_NS,
  table: SHEET_NS,
  presentation: SLIDE_NS,
  sld: SLIDE_NS,
  sldLayout: SLIDE_NS,
  sldMaster: SLIDE_NS,
  theme: DRAWING_NS,
  document: WORD_NS,
  styles: WORD_NS,
  numbering: WORD_NS,
  settings: WORD_NS,
  footnotes: WORD_NS,
  endnotes: WORD_NS,
  fonts: WORD_NS,
  comments: WORD_NS,
  hdr: WORD_NS,
  ftr: WORD_NS
};

const INVALID_ONE = /[\s"<>\\^`{|}\u0000-\u001f\u007f]/;
const INVALID_ALL = /[\s"<>\\^`{|}\u0000-\u001f\u007f]/g;
const START_TAG = /<([A-Za-z_][^\s/>]*)((?:\s[^<>]*)?)>/g;
const DECLARATION = /(\s)(xmlns(?::[^\s=]+)?)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const MAX_DISTANCE = 3;

function distance(a, b, limit = MAX_DISTANCE) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = row[0];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (row[j] < best) best = row[j];
    }
    if (best > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length];
}

function nearest(value, limit = MAX_DISTANCE) {
  let best = null;
  let bestDistance = limit + 1;
  let tie = false;
  for (const known of KNOWN) {
    const d = distance(value, known, limit);
    if (d < bestDistance) {
      best = known;
      bestDistance = d;
      tie = false;
    } else if (d === bestDistance) {
      tie = true;
    }
  }
  return best !== null && !tie && bestDistance <= limit ? best : null;
}

function isValid(name, decoded) {
  if (decoded.length === 0) return name === 'xmlns';
  return !INVALID_ONE.test(decoded);
}

function replacement(name, decoded, rootName) {
  const stripped = decoded.replace(INVALID_ALL, '');
  if (stripped.length > 0 && KNOWN.includes(stripped)) return stripped;
  const snapped = stripped.length > 0 ? nearest(stripped) : null;
  if (snapped !== null) return snapped;
  if (name === 'xmlns' && rootName !== null && ROOT_DEFAULTS[rootName]) return ROOT_DEFAULTS[rootName];
  return stripped.length > 0 ? stripped : null;
}

export function repairNamespaces(text) {
  if (text.indexOf('xmlns') === -1) return { text, count: 0 };
  let count = 0;
  let first = true;
  const out = text.replace(START_TAG, (tag, name, attrs) => {
    const isRoot = first;
    first = false;
    if (attrs.indexOf('xmlns') === -1) return tag;
    const rootName = isRoot ? localName(name) : null;
    const fixed = attrs.replace(DECLARATION, (match, space, attr, doubleQuoted, singleQuoted) => {
      const raw = doubleQuoted !== undefined ? doubleQuoted : singleQuoted;
      const decoded = decodeEntities(raw);
      if (isValid(attr, decoded)) return match;
      count++;
      const value = replacement(attr, decoded, rootName);
      return value === null ? '' : `${space}${attr}="${escapeAttr(value)}"`;
    });
    return fixed === attrs ? tag : `<${name}${fixed}>`;
  });
  return { text: out, count };
}

export function snapNamespaces(root) {
  if (!root) return 0;
  const rootLocal = localName(root.name);
  const own = prefixOf(root.name) || '';
  const expected = ROOT_DEFAULTS[rootLocal] || null;
  let count = 0;
  root.attrs = root.attrs.map(([name, value]) => {
    if (name !== 'xmlns' && !name.startsWith('xmlns:')) return [name, value];
    const decoded = decodeEntities(value);
    if (decoded.length === 0 || KNOWN.includes(decoded)) return [name, value];
    const prefix = name === 'xmlns' ? '' : name.slice(6);
    const ownDeclaration = prefix === own && expected !== null && !decoded.includes('purl.oclc.org/ooxml');
    const target = ownDeclaration ? expected : nearest(decoded, 2);
    if (target === null || target === decoded) return [name, value];
    count++;
    return [name, escapeAttr(target)];
  });
  return count;
}

const KNOWN_ENCODING = /^(utf-?8|utf-?16(le|be)?|ucs-?2|us-ascii|ascii|latin-?1|iso-8859-\d{1,2}|windows-125\d|cp125\d|shift_jis|euc-jp|euc-kr|gb2312|gbk|big5|koi8-r)$/i;

export function repairDeclaration(text) {
  if (!text.startsWith('<?xml')) return { text, count: 0 };
  const end = text.indexOf('?>');
  if (end === -1 || end > 400) return { text, count: 0 };
  const decl = text.slice(0, end);
  const at = decl.indexOf('encoding');
  if (at === -1) return { text, count: 0 };
  let q = at + 8;
  while (q < decl.length && (decl[q] === ' ' || decl[q] === '=')) q++;
  const quote = decl[q];
  if (quote !== '"' && quote !== "'") return { text, count: 0 };
  const close = decl.indexOf(quote, q + 1);
  if (close === -1) return { text, count: 0 };
  const value = decl.slice(q + 1, close);
  if (KNOWN_ENCODING.test(value)) return { text, count: 0 };
  return { text: `${decl.slice(0, q + 1)}UTF-8${decl.slice(close)}${text.slice(end)}`, count: 1 };
}
