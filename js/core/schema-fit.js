import { decodeEntities, localName, prefixOf } from './xml-repair.js';

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const KIND = { s: 'sequence', c: 'choice', a: 'all', o: 'open' };
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAX_REPEAT = 16;
const ATTR_TYPE = { s: 'string', n: 'number', b: 'boolean', e: 'enum', o: 'other' };

function readAliases(raw) {
  return new Map(Object.entries(raw.namespaceAliases || {}));
}

function plainItem(item) {
  if (item.items) return { kind: item.kind, min: item.min === undefined ? 1 : item.min, max: item.max === undefined ? 1 : item.max, items: item.items.map(plainItem) };
  if (item.any) return { any: true, min: item.min === undefined ? 1 : item.min, max: item.max === undefined ? 1 : item.max };
  return { ns: item.ns, local: item.local, min: item.min === undefined ? 1 : item.min, max: item.max === undefined ? 1 : item.max, entry: item.entry || null };
}

function plainEntry(entry) {
  return {
    kind: entry.kind || 'sequence',
    min: entry.min === undefined ? 1 : entry.min,
    max: entry.max === undefined ? 1 : entry.max,
    items: (entry.items || []).map(plainItem),
    attrs: (entry.attrs || []).map((a) => ({ ns: a.ns || '', local: a.local, required: !!a.required })),
  };
}

function expandItems(rows, namespaces, entries) {
  return rows.map((row) => {
    if (typeof row[0] === 'number') {
      return {
        ns: namespaces[row[0]],
        local: row[1],
        min: row.length > 3 ? row[3] : 1,
        max: row.length > 3 ? row[4] : 1,
        entry: entries[row[2]],
      };
    }
    if (row[0] === '*') return { any: true, min: row[1], max: row[2] };
    return { kind: KIND[row[0]], min: row[1], max: row[2], items: expandItems(row[3], namespaces, entries) };
  });
}

export function openTable(raw) {
  const aliases = readAliases(raw);
  const known = new Set();
  const elements = {};
  if (Array.isArray(raw.types)) {
    const namespaces = raw.namespaces;
    for (const ns of namespaces) known.add(ns);
    const entries = raw.types.map((row) => ({
      kind: KIND[row[0]],
      min: row.length > 3 ? row[3] : 1,
      max: row.length > 3 ? row[4] : 1,
      items: [],
      attrs: (row[2] || []).map((a) => {
        const attr = { ns: a[0] < 0 ? '' : namespaces[a[0]], local: a[1], required: true, type: ATTR_TYPE[a[2]] || 'other' };
        if (a.length > 3) attr.default = a[3];
        return attr;
      }),
      id: 0,
    }));
    raw.types.forEach((row, i) => {
      entries[i].id = i;
      entries[i].items = expandItems(row[1], namespaces, entries);
    });
    for (const [ns, group] of Object.entries(raw.elements)) for (const [local, id] of Object.entries(group)) elements[`${ns}|${local}`] = entries[id];
  } else {
    const convert = new Map();
    for (const [key, entry] of Object.entries(raw.elements || {})) {
      known.add(key.slice(0, key.indexOf('|')));
      const made = plainEntry(entry);
      convert.set(key, made);
      elements[key] = made;
    }
    const link = (items) => {
      for (const item of items) {
        if (item.items) link(item.items);
        else if (item.local !== undefined) {
          known.add(item.ns);
          if (!item.entry) item.entry = convert.get(`${item.ns}|${item.local}`) || null;
        }
      }
    };
    for (const entry of convert.values()) link(entry.items);
  }
  for (const strict of aliases.keys()) known.add(strict);
  const strictOf = new Map([...aliases].map(([strict, transitional]) => [transitional, strict]));
  for (const key of Object.keys(elements)) {
    const strict = strictOf.get(key.slice(0, key.indexOf('|')));
    if (strict) elements[`${strict}${key.slice(key.indexOf('|'))}`] = elements[key];
  }
  return {
    source: raw.source || null,
    aliases,
    known,
    tolerated: new Set(raw.tolerated || []),
    elements,
    normalise(ns) {
      return aliases.get(ns) || ns;
    },
    entryFor(ns, local) {
      return elements[`${aliases.get(ns) || ns}|${local}`] || null;
    },
  };
}

const CHILD_MAPS = new WeakMap();

export function childEntries(table, entry) {
  let map = CHILD_MAPS.get(entry);
  if (map) return map;
  map = new Map();
  const walk = (items) => {
    for (const item of items) {
      if (item.items) walk(item.items);
      else if (item.local !== undefined) {
        const key = `${table.normalise(item.ns)}|${item.local}`;
        const target = item.entry || table.entryFor(item.ns, item.local);
        if (!map.has(key)) map.set(key, target);
        else if (map.get(key) !== target) map.set(key, null);
      }
    }
  };
  walk(entry.items);
  CHILD_MAPS.set(entry, map);
  return map;
}

export function childEntry(table, entry, ns, local) {
  const key = `${table.normalise(ns)}|${local}`;
  if (entry) {
    const map = childEntries(table, entry);
    if (map.has(key)) return map.get(key);
  }
  return table.entryFor(ns, local);
}

function unique(list) {
  if (list.length < 2) return list;
  return [...new Set(list)];
}

const LOOSE = new WeakMap();

function looseModel(table, entry) {
  let model = LOOSE.get(entry);
  if (model) return model;
  const leaves = new Map();
  let wild = false;
  const walk = (items, reach, mandatory) => {
    for (const item of items) {
      const max = reach === null || item.max === null ? (reach === 0 || item.max === 0 ? 0 : null) : reach * item.max;
      const must = mandatory && item.min >= 1;
      if (item.any) {
        wild = true;
        continue;
      }
      if (item.items) {
        walk(item.items, max, must && !(item.kind === 'choice' && item.items.length > 1));
        continue;
      }
      const key = `${table.normalise(item.ns)}|${item.local}`;
      const seen = leaves.get(key);
      if (!seen) leaves.set(key, { max, required: must });
      else {
        seen.max = seen.max === null || max === null ? null : seen.max + max;
        seen.required = seen.required || must;
      }
    }
  };
  walk(entry.items, entry.max, entry.min >= 1 && !(entry.kind === 'choice' && entry.items.length > 1));
  model = { leaves, wild };
  LOOSE.set(entry, model);
  return model;
}

function looseFit(table, entry, names, origin) {
  const model = looseModel(table, entry);
  const counts = new Map();
  for (let i = 0; i < names.length; i++) {
    const leaf = model.leaves.get(names[i]);
    if (!leaf) {
      if (model.wild) continue;
      return { ok: false, kind: 'unexpected', at: origin[i], expected: [] };
    }
    const count = (counts.get(names[i]) || 0) + 1;
    counts.set(names[i], count);
    if (leaf.max !== null && count > leaf.max) return { ok: false, kind: 'repeat', at: origin[i], expected: [] };
  }
  const missing = [];
  for (const [key, leaf] of model.leaves) if (leaf.required && !counts.has(key)) missing.push(key);
  if (missing.length > 0) return { ok: false, kind: 'missing', at: -1, expected: missing.sort() };
  return { ok: true };
}

const WILDCARDS = new WeakMap();

function hasWildcard(entry) {
  let found = WILDCARDS.get(entry);
  if (found !== undefined) return found;
  const walk = (items) => items.some((item) => item.any || (item.items && walk(item.items)));
  found = walk(entry.items);
  WILDCARDS.set(entry, found);
  return found;
}

export function fitChildren(table, entry, children) {
  if (entry.kind === 'open') return { ok: true };
  const names = [];
  const origin = [];
  const wild = hasWildcard(entry);
  children.forEach((child, i) => {
    const ns = table.normalise(child.ns || '');
    if (ns === MC_NS || table.tolerated.has(`${ns}|${child.local}`)) return;
    if (!table.known.has(ns)) {
      if (!wild) return;
      names.push(`?|${child.local}`);
      origin.push(i);
      return;
    }
    names.push(`${ns}|${child.local}`);
    origin.push(i);
  });
  const n = names.length;
  let furthest = 0;
  let expected = new Set();
  let track = false;
  const note = (pos, what) => {
    if (!track) return;
    if (pos > furthest) {
      furthest = pos;
      expected = new Set();
    }
    if (pos === furthest) expected.add(what);
  };
  const leafKey = (item) => `${table.normalise(item.ns)}|${item.local}`;
  let ends = null;
  const runEnd = (p) => {
    if (ends === null) {
      ends = new Int32Array(n + 1);
      for (let i = n - 1; i >= 0; i--) ends[i] = i + 1 < n && names[i + 1] === names[i] ? ends[i + 1] : i + 1;
    }
    return ends[p];
  };

  const body = (node, starts) => {
    const out = [];
    if (node.any) {
      for (const p of starts) {
        if (p < n) out.push(p + 1);
        else note(p, '*');
      }
      return out;
    }
    if (node.local !== undefined) {
      const key = leafKey(node);
      for (const p of starts) {
        if (p < n && names[p] === key) out.push(p + 1);
        else note(p, key);
      }
      return out;
    }
    if (node.kind === 'choice') {
      for (const item of node.items) for (const p of repeat(item, starts)) out.push(p);
      return unique(out);
    }
    if (node.kind === 'all') {
      for (const p of starts) {
        const counts = node.items.map(() => 0);
        const satisfied = () => node.items.every((item, i) => counts[i] >= item.min);
        if (satisfied()) out.push(p);
        let q = p;
        while (q < n) {
          const at = node.items.findIndex((item, i) => item.local !== undefined && leafKey(item) === names[q] && (item.max === null || counts[i] < item.max));
          if (at === -1) {
            note(q, node.items.map((item) => (item.local !== undefined ? leafKey(item) : '*')).join(' | '));
            break;
          }
          counts[at]++;
          q++;
          if (satisfied()) out.push(q);
        }
        if (q >= n && !satisfied()) note(q, node.items.filter((item, i) => counts[i] < item.min).map(leafKey).join(' | '));
      }
      return unique(out);
    }
    let current = starts;
    for (const item of node.items) {
      current = repeat(item, current);
      if (current.length === 0) break;
    }
    return current;
  };

  const repeat = (node, starts) => {
    if (starts.length === 0) return starts;
    if (node.local !== undefined && node.max === null) {
      const key = leafKey(node);
      const out = [];
      const lows = new Map();
      for (const p of starts) {
        const end = p < n && names[p] === key ? runEnd(p) : p;
        const run = end - p;
        if (run < node.min) {
          note(p + run, key);
          continue;
        }
        if (run === 0) {
          out.push(p);
          continue;
        }
        const low = p + node.min;
        const known = lows.get(end);
        if (known === undefined || low < known) lows.set(end, low);
      }
      for (const [end, low] of lows) for (let q = low; q <= end; q++) out.push(q);
      return unique(out);
    }
    const limit = node.max === null ? Infinity : node.max;
    const monotone = node.max === null && node.min <= 1;
    let results = node.min === 0 ? starts.slice() : [];
    let current = starts;
    const seen = new Set(starts);
    for (let count = 1; count <= limit; count++) {
      const next = body(node, current);
      if (next.length === 0) break;
      if (count >= node.min) for (const p of next) results.push(p);
      const fresh = [];
      for (const p of next) {
        if (!seen.has(p)) {
          seen.add(p);
          fresh.push(p);
        }
      }
      if (fresh.length === 0 && count >= node.min) break;
      current = monotone ? fresh : unique(next);
    }
    return unique(results);
  };

  if (repeat(entry, [0]).includes(n)) return { ok: true };
  track = true;
  repeat(entry, [0]);
  const at = furthest < n ? origin[furthest] : children.length;
  const loose = looseFit(table, entry, names, origin);
  if (loose.ok) return { ok: false, kind: furthest >= n ? 'missing' : 'order', at, expected: [...expected].sort() };
  return { ok: false, kind: loose.kind, at: loose.kind === 'missing' ? children.length : loose.at, expected: loose.expected };
}

function pathOf(frame) {
  const parts = [];
  for (let f = frame; f; f = f.parent) {
    if (!f.parent) {
      parts.push(f.node.name);
      continue;
    }
    let index = 1;
    let found = false;
    for (const sibling of f.parent.node.children) {
      if (sibling === f.node) {
        found = true;
        break;
      }
      if (sibling.type === 'el' && sibling.name === f.node.name) index++;
    }
    parts.push(found ? `${f.node.name}[${index}]` : f.node.name);
  }
  return `/${parts.reverse().join('/')}`;
}

function scopeFor(node, parentScope) {
  let scope = parentScope;
  for (const [name, value] of node.attrs) {
    if (name === 'xmlns' || name.startsWith('xmlns:')) {
      if (scope === parentScope) scope = new Map(parentScope);
      scope.set(name === 'xmlns' ? '' : name.slice(6), value);
    }
  }
  return scope;
}

function resolveName(name, scope, isAttribute) {
  const prefix = prefixOf(name);
  if (prefix === 'xmlns' || name === 'xmlns') return XMLNS_NS;
  if (!prefix) return isAttribute ? '' : scope.get('') || '';
  return scope.has(prefix) ? scope.get(prefix) : null;
}

function ignorableFor(node, scope, inherited) {
  let set = inherited;
  for (const [name, value] of node.attrs) {
    if (localName(name) !== 'Ignorable' || resolveName(name, scope, true) !== MC_NS) continue;
    if (set === inherited) set = new Set(inherited);
    for (const prefix of value.trim().split(/\s+/)) if (scope.has(prefix)) set.add(scope.get(prefix));
  }
  return set;
}

function gatherKids(node, scope, ignorable, branch) {
  const kids = [];
  let alternate = false;
  const visit = (parent, parentScope, parentIgnorable) => {
    for (const child of parent.children) {
      if (child.type !== 'el') continue;
      const childScope = scopeFor(child, parentScope);
      const ns = resolveName(child.name, childScope, false);
      const local = localName(child.name);
      if (ns === MC_NS && local === 'AlternateContent') {
        alternate = true;
        const options = child.children.filter((c) => c.type === 'el');
        const wanted = branch === 'choice' ? 'Choice' : 'Fallback';
        const other = branch === 'choice' ? 'Fallback' : 'Choice';
        const picked = options.find((c) => localName(c.name) === wanted) || options.find((c) => localName(c.name) === other);
        if (picked) {
          const pickedScope = scopeFor(picked, childScope);
          visit(picked, pickedScope, ignorableFor(picked, pickedScope, ignorableFor(child, childScope, parentIgnorable)));
        }
        continue;
      }
      if (ns !== null && parentIgnorable.has(ns)) continue;
      kids.push({ node: child, ns, local, scope: childScope, ignorable: ignorableFor(child, childScope, parentIgnorable) });
    }
  };
  visit(node, scope, ignorable);
  return { kids, alternate };
}

export function requiredChildren(table, entry) {
  const names = [];
  for (const [key, leaf] of looseModel(table, entry).leaves) if (leaf.required) names.push(key);
  return names.sort();
}

function bind(finding, node, entry) {
  Object.defineProperty(finding, 'node', { value: node });
  Object.defineProperty(finding, 'entry', { value: entry });
  return finding;
}

export function checkTree(table, root, limit = 200, visit = null, only = null) {
  const findings = [];
  let checked = 0;
  let constrained = 0;
  const top = root.children.find((child) => child.type === 'el');
  if (!top) return { findings, checked, constrained };
  const baseScope = new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]);
  const topScope = scopeFor(top, baseScope);
  const stack = [{ node: top, parent: null, scope: topScope, ignorable: ignorableFor(top, topScope, new Set()), entry: undefined }];
  while (stack.length > 0 && findings.length < limit) {
    const frame = stack.pop();
    const { node, scope } = frame;
    const ns = resolveName(node.name, scope, false);
    const local = localName(node.name);
    let entry = frame.entry;
    if (entry === undefined) entry = ns === null ? null : table.entryFor(ns, local);
    const gathered = gatherKids(node, scope, frame.ignorable, 'choice');
    const kids = gathered.kids;
    if (entry && ns !== null) {
      checked++;
      if (entry.attrs.length > 0 || requiredChildren(table, entry).length > 0) constrained++;
      for (const attr of entry.attrs) {
        if (!attr.required) continue;
        const present = node.attrs.find(([name]) => {
          if (localName(name) !== attr.local) return false;
          const owner = resolveName(name, scope, true);
          return owner !== null && table.normalise(owner) === table.normalise(attr.ns);
        });
        if (!present) findings.push(bind({ kind: 'attr', path: pathOf(frame), name: node.name, expected: [attr.local], at: -1, found: null }, node, entry));
        else if (visit) visit(entry, attr, decodeEntities(present[1]));
      }
      let fit = fitChildren(table, entry, kids.map((k) => ({ ns: k.ns, local: k.local })));
      if (!fit.ok && gathered.alternate) {
        const fallback = gatherKids(node, scope, frame.ignorable, 'fallback').kids;
        if (fitChildren(table, entry, fallback.map((k) => ({ ns: k.ns, local: k.local }))).ok) fit = { ok: true };
      }
      if (!fit.ok) {
        const found = fit.at >= 0 && fit.at < kids.length ? kids[fit.at].node.name : null;
        findings.push(bind({ kind: fit.kind, path: pathOf(frame), name: node.name, ns, local, at: fit.at, found, expected: fit.expected, near: kids.slice(Math.max(0, fit.at - 3), fit.at + 3).map((k) => k.node.name) }, node, entry));
      }
    }
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      if (k.ns === null || (only && !only.has(k.node))) continue;
      stack.push({ node: k.node, parent: frame, scope: k.scope, ignorable: k.ignorable, entry: entry ? childEntry(table, entry, k.ns, k.local) : undefined });
    }
  }
  return { findings, checked, constrained };
}

export function attributeDefault(attr) {
  if (attr.default !== undefined && attr.default !== null) return String(attr.default);
  if (attr.ns === RELATIONSHIPS_NS) return null;
  if (attr.type === 'number') return '0';
  if (attr.type === 'boolean') return 'false';
  if (attr.type === 'string') return '';
  return null;
}

const MINIMAL = new WeakMap();

function minimalContent(table, entry, stack) {
  const known = MINIMAL.get(entry);
  if (known) return known;
  const content = { attrs: [], children: [], unresolved: [], size: 0 };
  if (stack.has(entry)) {
    content.unresolved.push('cycle');
    return content;
  }
  stack.add(entry);
  for (const attr of entry.attrs) {
    if (!attr.required) continue;
    const value = attributeDefault(attr);
    if (value === null) content.unresolved.push(`@${attr.local}`);
    else content.attrs.push({ ns: attr.ns, local: attr.local, value });
  }
  if (entry.kind !== 'open') {
    const wanted = [];
    planNode(table, entry, wanted, content.unresolved, stack);
    for (const pick of wanted) {
      const child = minimalElement(table, pick.ns, pick.local, pick.entry, stack);
      content.children.push(child);
      content.size += 1 + child.size;
      for (const reason of child.unresolved) content.unresolved.push(`${pick.local}/${reason}`);
    }
  }
  stack.delete(entry);
  MINIMAL.set(entry, content);
  return content;
}

function planNode(table, node, out, unresolved, stack) {
  if (node.min > MAX_REPEAT) unresolved.push('repeat');
  const times = Math.min(node.min, MAX_REPEAT);
  for (let i = 0; i < times; i++) planOnce(table, node, out, unresolved, stack);
}

function weighAlternative(table, item, stack) {
  const out = [];
  const unresolved = [];
  planNode(table, { ...item, min: Math.max(item.min, 1) }, out, unresolved, stack);
  let weight = unresolved.length * 1000;
  for (const pick of out) {
    const child = minimalElement(table, pick.ns, pick.local, pick.entry, stack);
    weight += 1 + child.size + child.unresolved.length * 1000;
  }
  return weight;
}

function planOnce(table, node, out, unresolved, stack) {
  if (node.any) {
    unresolved.push('*');
    return;
  }
  if (node.local !== undefined) {
    out.push({ ns: node.ns, local: node.local, entry: node.entry || table.entryFor(node.ns, node.local) });
    return;
  }
  if (node.kind === 'choice') {
    if (node.items.length === 0) return;
    let best = null;
    let bestWeight = Infinity;
    for (const item of node.items) {
      const weight = weighAlternative(table, item, stack);
      if (weight < bestWeight) {
        best = item;
        bestWeight = weight;
      }
    }
    planNode(table, { ...best, min: Math.max(best.min, 1) }, out, unresolved, stack);
    return;
  }
  for (const item of node.items) planNode(table, item, out, unresolved, stack);
}

export function planItem(table, item) {
  const picks = [];
  const unresolved = [];
  planNode(table, item, picks, unresolved, new Set());
  return { picks, unresolved };
}

export function minimalElement(table, ns, local, entry, stack = new Set()) {
  if (!entry) return { ns, local, attrs: [], children: [], unresolved: [], size: 0 };
  const content = minimalContent(table, entry, stack);
  return { ns, local, attrs: content.attrs, children: content.children, unresolved: content.unresolved, size: content.size };
}
