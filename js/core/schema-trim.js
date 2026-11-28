import { documentElement, localName, prefixOf } from './xml-repair.js';
import { getTree, touch, addFinding } from './package.js';
import { checkTree } from './schema-fit.js';
import { keyOf, orderOf, openedTable } from './schema-fill.js';
import { PART_LIMIT } from './schema-check.js';
import { snapNamespaces } from './ns-repair.js';

const DAMAGE = new Set(['XML_TRUNCATED_CLOSED', 'XML_REPAIRED', 'XML_INVALID_BYTES', 'XML_HOLE_DROPPED', 'ZIP_ENTRY_TRUNCATED', 'ZIP_ENTRY_CRC']);
const MAX_PASSES = 6;
const LIMIT = 200;

function reorder(table, finding) {
  const node = finding.node;
  const order = orderOf(table, finding.entry);
  const slots = [];
  const known = [];
  node.children.forEach((child, index) => {
    if (child.type !== 'el') return;
    const rank = order.get(keyOf(table, child));
    if (rank === undefined) return;
    slots.push(index);
    known.push({ child, rank });
  });
  const sorted = known.slice().sort((a, b) => a.rank - b.rank);
  if (sorted.every((item, index) => item === known[index])) return null;
  const before = node.children.slice();
  slots.forEach((slot, index) => {
    node.children[slot] = sorted[index].child;
  });
  return () => {
    node.children = before;
  };
}

function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (row[j] < best) best = row[j];
    }
    if (best > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length];
}

function keyOwner(child, table) {
  const key = keyOf(table, child);
  return key.slice(0, key.lastIndexOf('|'));
}

function snapName(finding, table) {
  const child = finding.child;
  if (!child || !child.parent || !finding.entry) return null;
  const found = localName(child.name);
  if (found.length < 3) return null;
  const limit = found.length >= 6 ? 2 : 1;
  const owner = keyOwner(child, table);
  const candidates = [];
  for (const key of orderOf(table, finding.entry).keys()) {
    const cut = key.lastIndexOf('|');
    if (key.slice(0, cut) === owner) candidates.push(key.slice(cut + 1));
  }
  if (candidates.includes(found)) return null;
  const scored = candidates
    .map((name) => ({ name, d: name.startsWith(found) ? 0 : distance(found, name, limit) }))
    .filter((item) => item.d <= limit);
  scored.sort((a, b) => a.d - b.d);
  if (scored.length === 0 || (scored.length > 1 && scored[1].d === scored[0].d)) return null;
  return scored[0].name;
}

function renameChild(finding, table) {
  const target = snapName(finding, table);
  if (target === null) return null;
  const child = finding.child;
  const before = child.name;
  const prefix = prefixOf(before);
  child.name = prefix ? `${prefix}:${target}` : target;
  return () => {
    child.name = before;
  };
}

function violations(table, document) {
  return checkTree(table, document, LIMIT).findings;
}

export function trimTree(table, document) {
  let moved = 0;
  let renamed = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const before = violations(table, document);
    if (before.length === 0) break;
    const undo = [];
    const touched = new Set();
    let moves = 0;
    let names = 0;
    for (const finding of before) {
      if (!finding.node || !finding.entry || touched.has(finding.node)) continue;
      touched.add(finding.node);
      const revert = finding.kind === 'order' ? reorder(table, finding) : finding.kind === 'unexpected' ? renameChild(finding, table) : null;
      if (!revert) continue;
      undo.push(revert);
      if (finding.kind === 'order') moves++;
      else names++;
    }
    if (undo.length === 0) break;
    if (violations(table, document).length >= before.length) {
      for (let i = undo.length - 1; i >= 0; i--) undo[i]();
      break;
    }
    moved += moves;
    renamed += names;
  }
  return { moved, renamed };
}

export function trimSchema(ctx, table) {
  const names = [...new Set(ctx.findings.filter((f) => DAMAGE.has(f.code) && f.part).map((f) => f.part))];
  if (names.length === 0 || !table || !table.elements) return { checked: false };
  const opened = openedTable(table);
  let moved = 0;
  let renamed = 0;
  let spelled = 0;
  let parts = 0;
  for (const name of names) {
    const part = ctx.parts.get(name);
    if (!part || (typeof part.text === 'string' && part.text.length > PART_LIMIT)) continue;
    const tree = getTree(ctx, name);
    const root = tree ? documentElement(tree) : null;
    if (!root) continue;
    const spaces = snapNamespaces(root);
    spelled += spaces;
    const result = trimTree(opened, tree);
    if (spaces > 0) touch(ctx, name);
    if (result.moved + result.renamed === 0) continue;
    touch(ctx, name);
    parts++;
    moved += result.moved;
    renamed += result.renamed;
  }
  if (moved > 0) addFinding(ctx, 'SCHEMA_REORDERED', null, { n: moved, parts });
  if (renamed > 0) addFinding(ctx, 'SCHEMA_NAMES_FIXED', null, { n: renamed, parts });
  if (spelled > 0) addFinding(ctx, 'XML_NAMESPACE_FIXED', null, { n: spelled });
  return { checked: true, moved, renamed };
}
