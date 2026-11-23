import { createElement, decodeEntities, elementChildren, escapeAttr, localName, prefixOf } from './xml-repair.js';
import { checkTree, minimalElement, openTable, planItem } from './schema-fit.js';

const OPENED = new WeakMap();

function opened(table) {
  if (typeof table.normalise === 'function') return table;
  if (!OPENED.has(table)) OPENED.set(table, openTable(table));
  return OPENED.get(table);
}

function declaration(node, wanted) {
  for (let current = node; current && current.type === 'el'; current = current.parent) {
    for (const [key, value] of current.attrs) if (key === wanted) return decodeEntities(value);
  }
  return null;
}

function namespaceOf(node) {
  const prefix = prefixOf(node.name);
  const found = declaration(node, prefix ? `xmlns:${prefix}` : 'xmlns');
  return found === null ? '' : found;
}

function prefixFor(node, table, ns) {
  const wanted = table.normalise(ns);
  for (let current = node; current && current.type === 'el'; current = current.parent) {
    for (const [key, value] of current.attrs) {
      if (key !== 'xmlns' && !key.startsWith('xmlns:')) continue;
      if (table.normalise(decodeEntities(value)) !== wanted) continue;
      const prefix = key === 'xmlns' ? '' : key.slice(6);
      if (declaration(node, prefix ? `xmlns:${prefix}` : 'xmlns') === decodeEntities(value)) return prefix;
    }
  }
  return null;
}

function keyOf(table, node) {
  return `${table.normalise(namespaceOf(node))}|${localName(node.name)}`;
}

function leafKeys(table, item, out = new Set()) {
  if (item.local !== undefined) out.add(`${table.normalise(item.ns)}|${item.local}`);
  else for (const child of item.items || []) leafKeys(table, child, out);
  return out;
}

function orderOf(table, entry) {
  const order = new Map();
  const walk = (items) => {
    for (const item of items) {
      if (item.items) walk(item.items);
      else if (item.local !== undefined) {
        const key = `${table.normalise(item.ns)}|${item.local}`;
        if (!order.has(key)) order.set(key, order.size);
      }
    }
  };
  walk(entry.items);
  return order;
}

function render(table, parent, made, state) {
  let prefix = prefixFor(parent, table, made.ns);
  const attrs = [];
  if (prefix === null) {
    prefix = '';
    attrs.push(['xmlns', made.ns]);
  }
  const node = createElement(prefix ? `${prefix}:${made.local}` : made.local, attrs);
  node.parent = parent;
  for (const attr of made.attrs) {
    if (!attr.ns) {
      node.attrs.push([attr.local, escapeAttr(attr.value)]);
      continue;
    }
    const owner = prefixFor(node, table, attr.ns);
    if (owner === null || owner === '') state.unresolved.push({ parent: made.local, child: `@${attr.local}`, reason: 'namespace' });
    else node.attrs.push([`${owner}:${attr.local}`, escapeAttr(attr.value)]);
  }
  for (const child of made.children) {
    const built = render(table, node, child, state);
    built.parent = node;
    node.children.push(built);
  }
  for (const reason of made.unresolved) state.unresolved.push({ parent: localName(parent.name), child: made.local, reason });
  node.parent = null;
  return node;
}

function place(table, node, entry, order, made, key) {
  if (entry.kind !== 'sequence') return node.children.length;
  const wanted = order.get(key);
  if (wanted === undefined) return node.children.length;
  let after = -1;
  let before = -1;
  node.children.forEach((child, at) => {
    if (child.type !== 'el') return;
    const rank = order.get(keyOf(table, child));
    if (rank === undefined) return;
    if (rank <= wanted) after = at;
    else if (before === -1) before = at;
  });
  if (after >= 0) return after + 1;
  return before >= 0 ? before : node.children.length;
}

function insertPicks(table, node, entry, order, plan, state) {
  for (const reason of plan.unresolved) state.unresolved.push({ parent: localName(node.name), child: '*', reason });
  for (const pick of plan.picks) {
    const made = render(table, node, minimalElement(table, pick.ns, pick.local, pick.entry), state);
    const key = `${table.normalise(pick.ns)}|${pick.local}`;
    const at = place(table, node, entry, order, made, key);
    made.parent = node;
    node.children.splice(at, 0, made);
    state.added.push({ parent: localName(node.name), child: pick.local });
  }
}

function completeGroup(table, node, entry, order, group, state) {
  const count = (keys) => elementChildren(node).filter((kid) => keys.has(keyOf(table, kid))).length;
  if (group.kind === 'choice') {
    const need = group.min === undefined ? 1 : group.min;
    const have = count(leafKeys(table, group));
    if (have < need) {
      insertPicks(table, node, entry, order, planItem(table, { ...group, min: need - have }), state);
      return;
    }
    for (const item of group.items) if (item.items && count(leafKeys(table, item)) > 0) completeGroup(table, node, entry, order, item, state);
    return;
  }
  for (const item of group.items) {
    if (item.any) continue;
    const need = item.min === undefined ? 1 : item.min;
    const have = count(leafKeys(table, item));
    if (item.local !== undefined) {
      if (have < need) insertPicks(table, node, entry, order, planItem(table, { ...item, min: need - have }), state);
    } else if (have === 0) {
      if (need >= 1) insertPicks(table, node, entry, order, planItem(table, { ...item, min: need }), state);
    } else {
      completeGroup(table, node, entry, order, item, state);
    }
  }
}

function spineOf(top) {
  const spine = new Set();
  for (let node = top; node; ) {
    spine.add(node);
    const kids = elementChildren(node);
    node = kids.length > 0 ? kids[kids.length - 1] : null;
  }
  return spine;
}

export function fillMissing(root, source, options = {}) {
  const table = opened(source);
  const state = { added: [], unresolved: [] };
  const seen = new Set();
  const top = root.type === 'el' ? root : root.children.find((child) => child.type === 'el');
  if (!top) return state;
  const spine = options.scope === 'spine' ? spineOf(top) : null;
  const { findings } = checkTree(table, root.type === 'el' ? { type: 'doc', children: [root], parent: null } : root, Infinity);
  for (const finding of findings) {
    if (finding.kind !== 'missing' || !finding.node || !finding.entry || seen.has(finding.node)) continue;
    if (spine && !spine.has(finding.node)) continue;
    seen.add(finding.node);
    const { node, entry } = finding;
    if (entry.kind === 'open') continue;
    completeGroup(table, node, entry, orderOf(table, entry), { kind: entry.kind, min: entry.kind === 'choice' ? Math.max(entry.min, 1) : entry.min, items: entry.items }, state);
  }
  return state;
}
