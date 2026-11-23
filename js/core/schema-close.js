import { decodeEntities, documentElement, elementChildren, localName, prefixOf, createElement } from './xml-repair.js';
import { getTree, touch, addFinding } from './package.js';
import { fillMissing } from './schema-fill.js';

const NUMERIC = new Set(['integer', 'int', 'long', 'uint', 'ulong', 'short', 'ushort', 'byte', 'number', 'decimal', 'double', 'float']);

function resolvePrefix(node, prefix) {
  const wanted = prefix ? `xmlns:${prefix}` : 'xmlns';
  for (let current = node; current && current.type === 'el'; current = current.parent) {
    for (const [key, value] of current.attrs) if (key === wanted) return decodeEntities(value);
  }
  return '';
}

function namespaceOf(node) {
  return resolvePrefix(node, prefixOf(node.name) || '');
}

function keyOf(node) {
  return `${namespaceOf(node)}|${localName(node.name)}`;
}

function prefixFor(node, ns) {
  for (let current = node; current && current.type === 'el'; current = current.parent) {
    for (const [key, value] of current.attrs) {
      if (decodeEntities(value) !== ns) continue;
      if (key === 'xmlns' && resolvePrefix(node, '') === ns) return '';
      if (key.startsWith('xmlns:') && resolvePrefix(node, key.slice(6)) === ns) return key.slice(6);
    }
  }
  return null;
}

function defaultFor(attr) {
  if (attr.default !== undefined && attr.default !== null) return String(attr.default);
  const type = String(attr.type || '').toLowerCase();
  if (NUMERIC.has(type)) return '0';
  if (type === 'boolean') return 'false';
  if (type === 'string') return '';
  if (type === 'enum' && Array.isArray(attr.values) && attr.values.length > 0) return String(attr.values[0]);
  return null;
}

function flatten(items, optional = false) {
  const out = [];
  for (const item of items || []) {
    const min = optional ? 0 : item.min === undefined ? 1 : item.min;
    if (item.items) {
      if (item.kind === 'choice') out.push({ choice: item.items.map((member) => `${member.ns}|${member.local}`), min, items: item.items });
      else out.push(...flatten(item.items, min === 0));
    } else {
      out.push({ key: `${item.ns}|${item.local}`, ns: item.ns, local: item.local, min });
    }
  }
  return out;
}

function matches(entry, child) {
  const key = keyOf(child);
  return entry.choice ? entry.choice.includes(key) : entry.key === key;
}

function spineOf(root) {
  const spine = [];
  for (let node = root; node; ) {
    spine.push(node);
    const kids = elementChildren(node);
    node = kids.length > 0 ? kids[kids.length - 1] : null;
  }
  return spine;
}

function build(parent, ns, local, table, state) {
  const prefix = prefixFor(parent, ns);
  if (prefix === null) {
    state.unresolved.push({ parent: localName(parent.name), child: local, reason: 'namespace' });
    return null;
  }
  const entry = table.elements[`${ns}|${local}`] || null;
  const attrs = [];
  for (const attr of (entry && entry.attrs) || []) {
    if (!attr.required) continue;
    const value = attr.ns ? null : defaultFor(attr);
    if (value === null) {
      state.unresolved.push({ parent: local, child: `@${attr.local}`, reason: 'attribute' });
      continue;
    }
    attrs.push([attr.local, value]);
  }
  const node = createElement(prefix ? `${prefix}:${local}` : local, attrs);
  node.parent = parent;
  if (entry) fill(node, entry, table, state);
  node.parent = null;
  return node;
}

function fill(node, entry, table, state) {
  const entries = flatten(entry.items);
  const ordered = entry.kind !== 'all';
  let last = -1;
  for (let index = 0; index < entries.length; index++) {
    const wanted = entries[index];
    const present = [];
    node.children.forEach((child, at) => {
      if (child.type === 'el' && matches(wanted, child)) present.push(at);
    });
    if (present.length > 0) {
      last = Math.max(last, ...present);
      continue;
    }
    if (wanted.min < 1) continue;
    if (wanted.choice || entry.kind === 'choice') {
      state.unresolved.push({ parent: localName(node.name), child: (wanted.choice || entries.map((e) => e.local)).map((k) => String(k).split('|').pop()).join('|'), reason: 'choice' });
      continue;
    }
    const made = build(node, wanted.ns, wanted.local, table, state);
    if (!made) continue;
    let at = node.children.length;
    if (ordered) {
      if (last >= 0) at = last + 1;
      else {
        const later = entries.slice(index + 1);
        const found = node.children.findIndex((child) => child.type === 'el' && later.some((other) => matches(other, child)));
        at = found === -1 ? node.children.length : found;
      }
    }
    made.parent = node;
    node.children.splice(at, 0, made);
    last = at;
    state.added.push({ parent: localName(node.name), child: wanted.local });
  }
}

export function completeSpine(root, table) {
  const state = { added: [], unresolved: [] };
  const spine = spineOf(root);
  for (let at = spine.length - 1; at >= 0; at--) {
    const entry = table.elements[keyOf(spine[at])];
    if (entry) fill(spine[at], entry, table, state);
  }
  return state;
}

export function findViolations(root, table, limit = 200) {
  const found = [];
  const stack = [root];
  while (stack.length > 0 && found.length < limit) {
    const node = stack.pop();
    const entry = table.elements[keyOf(node)];
    const kids = elementChildren(node);
    if (entry) {
      const entries = flatten(entry.items);
      for (const wanted of entries) {
        if (wanted.min >= 1 && !kids.some((kid) => matches(wanted, kid))) {
          found.push({ element: localName(node.name), problem: 'missing', child: wanted.choice ? wanted.choice.map((k) => k.split('|').pop()).join('|') : wanted.local });
        }
      }
      if (entry.kind === 'sequence') {
        let highest = -1;
        for (const kid of kids) {
          const at = entries.findIndex((wanted) => matches(wanted, kid));
          if (at === -1) continue;
          if (at < highest) {
            found.push({ element: localName(node.name), problem: 'order', child: localName(kid.name) });
            break;
          }
          highest = at;
        }
      }
    }
    for (const kid of kids) stack.push(kid);
  }
  return found;
}

let tablePromise = null;

function defaultLoader() {
  if (!tablePromise) tablePromise = import('./data/schema-lite.js').then((module) => module.SCHEMA_LITE, () => null);
  return tablePromise;
}

export async function completeSchema(ctx, loader = defaultLoader) {
  const parts = [...new Set(ctx.findings.filter((f) => f.code === 'XML_TRUNCATED_CLOSED' && f.part).map((f) => f.part))];
  if (parts.length === 0) return { checked: false };
  const table = await loader();
  if (!table || !table.elements) return { checked: false };
  let added = 0;
  let unresolved = 0;
  let touched = 0;
  for (const name of parts) {
    const tree = getTree(ctx, name);
    const root = tree ? documentElement(tree) : null;
    if (!root) continue;
    const result = fillMissing(root, table, { scope: 'spine' });
    if (result.added.length > 0) {
      touch(ctx, name);
      touched++;
    }
    added += result.added.length;
    unresolved += result.unresolved.length;
  }
  if (added > 0) addFinding(ctx, 'SCHEMA_COMPLETED', null, { n: added, parts: touched });
  if (unresolved > 0) addFinding(ctx, 'SCHEMA_UNRESOLVED', null, { n: unresolved });
  return { checked: true, added, unresolved };
}
