import { PARTS, FORMATS, DEFAULT_TYPES } from './data/parts.js';

export { PARTS, FORMATS, DEFAULT_TYPES };

const NS_TRANSITIONAL = 'http://schemas.openxmlformats.org/';
const NS_STRICT = 'http://purl.oclc.org/ooxml/';

export function toTransitionalNs(ns) {
  if (!ns.startsWith(NS_STRICT)) return ns;
  const [first, ...rest] = ns.slice(NS_STRICT.length).split('/');
  return `${NS_TRANSITIONAL}${[first, '2006', ...rest].join('/')}`;
}

export function toStrictNs(ns) {
  if (!ns.startsWith(NS_TRANSITIONAL)) return ns;
  const [first, year, ...rest] = ns.slice(NS_TRANSITIONAL.length).split('/');
  return /^\d{4}$/.test(year) ? `${NS_STRICT}${[first, ...rest].join('/')}` : ns;
}

const byKind = new Map();
const byRel = new Map();
const byContentType = new Map();
const byRoot = new Map();
const byPath = new Map();
const patterned = [];

function push(map, key, row) {
  const list = map.get(key);
  if (list) list.push(row);
  else map.set(key, [row]);
}

for (const row of PARTS) {
  byKind.set(row.kind, row);
  if (row.relType) push(byRel, row.relType, row);
  if (row.relTypeStrict) push(byRel, row.relTypeStrict, row);
  for (const alt of row.relTypeAlt) push(byRel, alt, row);
  if (row.contentType) byContentType.set(row.contentType, row);
  for (const alt of row.contentTypeAlt) byContentType.set(alt, row);
  if (row.root) push(byRoot, `${row.root.ns}|${row.root.name}`, row);
  if (row.path) byPath.set(row.path.toLowerCase(), row);
  if (row.pathPattern) patterned.push(row);
}

export function rowOfKind(kind) {
  return byKind.get(kind) || null;
}

export function rowsOfRelType(type) {
  return byRel.get(type) || [];
}

export function rowOfContentType(type) {
  return byContentType.get(type) || null;
}

export function rowsOfRoot(local, ns) {
  return byRoot.get(`${toTransitionalNs(ns)}|${local}`) || [];
}

export function rowOfPath(path) {
  const fixed = byPath.get(path.toLowerCase());
  if (fixed) return fixed;
  for (const row of patterned) if (row.pathPattern.test(path)) return row;
  return null;
}

export function formatOfKey(key) {
  return FORMATS.find((format) => format.key === key) || null;
}

export function mainRow(family) {
  return PARTS.find((row) => row.main && row.family === family) || null;
}

export function overrideTypeFor(path) {
  const row = rowOfPath(path);
  if (!row || row.main || !row.contentType || row.kind === 'relationships') return null;
  return row.contentType;
}

export function isBorrowable(path) {
  const row = rowOfPath(path);
  return Boolean(row && row.borrow);
}

export function hasBorrowableRels(path) {
  const row = rowOfPath(path);
  return Boolean(row && row.borrowRels);
}

export function relTypeKnown(type) {
  return byRel.has(type);
}
