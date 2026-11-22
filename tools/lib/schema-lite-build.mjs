import { readFileSync } from 'node:fs';
import { toStrictNs } from '../../js/core/registry.js';

const MODULE_HEAD = 'export default ';

export function tableText(table, path) {
  const json = JSON.stringify(table);
  return path.endsWith('.js') ? `${MODULE_HEAD}${json};\n` : json;
}

export function readTableFile(path) {
  const text = readFileSync(path, 'utf8');
  if (!path.endsWith('.js')) return JSON.parse(text);
  return JSON.parse(text.slice(MODULE_HEAD.length).replace(/;\s*$/, ''));
}

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

function splitName(name) {
  const slash = name.indexOf('/');
  return { ct: name.slice(0, slash), element: name.slice(slash + 1) };
}

function qname(value, prefixes) {
  const colon = value.indexOf(':');
  const prefix = colon === -1 ? '' : value.slice(0, colon);
  const local = colon === -1 ? value : value.slice(colon + 1);
  return { local, ns: prefix === '' ? '' : prefixes.has(prefix) ? prefixes.get(prefix) : null };
}

function occurs(node) {
  const list = Array.isArray(node.Occurs) && node.Occurs.length > 0 ? node.Occurs : null;
  if (!list) return { min: 1, max: 1 };
  let min = Infinity;
  let max = 0;
  for (const entry of list) {
    const lo = entry.Min === undefined ? 0 : entry.Min;
    const hi = entry.Max === undefined ? null : entry.Max;
    if (lo < min) min = lo;
    if (hi === null || max === null) max = null;
    else if (hi > max) max = hi;
  }
  return { min, max };
}

function times(outer, inner) {
  const min = outer.min * inner.min;
  if (outer.max === 0 || inner.max === 0) return { min, max: 0 };
  if (outer.max === null || inner.max === null) return { min, max: null };
  return { min, max: outer.max * inner.max };
}

const KIND = { Sequence: 's', Choice: 'c', All: 'a' };

function convert(node, prefixes, problems, drop) {
  const count = occurs(node);
  if (node.Name) {
    const { ct, element } = splitName(node.Name);
    const { local, ns } = qname(element, prefixes);
    if (ns === null || ns === '') {
      problems.add(`unresolved prefix in ${node.Name}`);
      return undefined;
    }
    if (drop(ns)) return null;
    return { leaf: true, ns, local, ct, min: count.min, max: count.max };
  }
  if (node.Kind === 'Any') return { any: true, min: count.min, max: count.max };
  const items = [];
  let dropped = false;
  for (const child of node.Items || []) {
    const made = convert(child, prefixes, problems, drop);
    if (made === undefined) return undefined;
    if (made === null) {
      dropped = true;
      continue;
    }
    items.push(made);
  }
  if (items.length === 0 && (node.Items || []).length > 0) return null;
  if (dropped && node.Kind === 'Choice') count.min = 0;
  if (node.Kind === 'Group') {
    if (items.length === 1 && !items[0].leaf && !items[0].any) {
      const inner = items[0];
      return { ...inner, ...times(count, inner) };
    }
    return { kind: 's', items, ...count };
  }
  return { kind: KIND[node.Kind] || 's', items, ...count };
}

function baseOf(type, abstractTypes) {
  if (!type.IsDerived || !type.BaseClass) return null;
  const slash = type.Name.indexOf('/');
  const ct = type.Name.slice(0, slash);
  const sameCt = abstractTypes.byName.get(`${ct}/`);
  if (sameCt && sameCt.ClassName === type.BaseClass) return sameCt;
  const candidates = abstractTypes.byClass.get(type.BaseClass) || [];
  const prefix = ct.slice(0, ct.indexOf(':'));
  return candidates.find((c) => c.Name.startsWith(`${prefix}:`)) || candidates[0] || null;
}

function attributesOf(type, abstractTypes, prefixes, problems) {
  const list = [];
  const seen = new Set();
  let cursor = type;
  for (let depth = 0; cursor && depth < 8; depth++) {
    for (const attribute of cursor.Attributes || []) {
      const required = (attribute.Validators || []).some((v) => v.Name === 'RequiredValidator');
      const { local, ns } = qname(attribute.QName, prefixes);
      if (ns === null) {
        problems.add(`unresolved attribute prefix ${attribute.QName}`);
        continue;
      }
      const id = `${ns}|${local}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (required) list.push({ ns, local });
    }
    cursor = baseOf(cursor, abstractTypes);
  }
  list.sort((a, b) => a.ns.localeCompare(b.ns) || a.local.localeCompare(b.local));
  return list;
}

export function buildTable({ schemas, namespaces, source, dropNamespace = () => false, patches = {} }) {
  const prefixes = new Map();
  for (const entry of namespaces) if (entry.Prefix) prefixes.set(entry.Prefix, entry.Uri);
  const problems = new Set();
  const all = schemas.flatMap((schema) => schema.Types || []).filter((type) => type.Name);
  const abstractTypes = { byName: new Map(), byClass: new Map() };
  for (const type of all) {
    if (!type.IsAbstract) continue;
    abstractTypes.byName.set(type.Name, type);
    if (!type.ClassName) continue;
    if (!abstractTypes.byClass.has(type.ClassName)) abstractTypes.byClass.set(type.ClassName, []);
    abstractTypes.byClass.get(type.ClassName).push(type);
  }

  const contents = new Map();
  const conflicts = new Set();
  const elementTypes = new Map();
  const openTypes = new Set();
  for (const type of all) {
    if (type.Name.endsWith('/')) continue;
    const { ct, element } = splitName(type.Name);
    const { local, ns } = qname(element, prefixes);
    if (ns === null || ns === '') {
      problems.add(`unresolved element ${type.Name}`);
      continue;
    }
    let kind = 's';
    let items = [];
    let min = 1;
    let max = 1;
    if (type.Particle) {
      const root = convert(type.Particle, prefixes, problems, dropNamespace);
      if (root === undefined) continue;
      if (root === null || root.leaf || root.any) {
        kind = 'o';
        openTypes.add(ct);
      } else {
        kind = root.kind;
        items = root.items;
        min = root.min;
        max = root.max;
      }
    } else if (type.Children && type.Children.length > 0 && !type.IsLeafElement) {
      kind = 'o';
      openTypes.add(ct);
    }
    const content = { kind, items, min, max, required: attributesOf(type, abstractTypes, prefixes, problems) };
    const json = JSON.stringify(content);
    if (contents.has(ct)) {
      if (contents.get(ct).json !== json) conflicts.add(ct);
    } else contents.set(ct, { content, json });
    const key = `${ns}|${local}`;
    if (!elementTypes.has(key)) elementTypes.set(key, new Set());
    elementTypes.get(key).add(ct);
  }

  const patchLog = { tolerated: [], opened: [], unknown: [] };
  for (const entry of patches.tolerate || []) patchLog.tolerated.push(entry.element);
  for (const entry of patches.open || []) {
    const types = elementTypes.get(entry.element);
    if (!types) {
      patchLog.unknown.push(entry.element);
      continue;
    }
    for (const ct of types) {
      const found = contents.get(ct);
      found.content = { ...found.content, kind: 'o', items: [], min: 1, max: 1 };
    }
    patchLog.opened.push(entry.element);
  }

  for (const entry of patches.openTypes || []) {
    const found = contents.get(entry.type);
    if (!found) {
      patchLog.unknown.push(entry.type);
      continue;
    }
    found.content = { ...found.content, kind: 'o', items: [], min: 1, max: 1 };
    patchLog.opened.push(entry.type);
  }

  const refs = new Set();
  const collect = (items) => {
    for (const item of items) {
      if (item.leaf) refs.add(item.ct);
      else if (item.items) collect(item.items);
    }
  };
  for (const { content } of contents.values()) collect(content.items);
  for (const ct of refs) if (!contents.has(ct)) contents.set(ct, { content: { kind: 's', items: [], min: 1, max: 1, required: [] }, json: '' });

  const keys = [...contents.keys()].sort();
  const index = new Map(keys.map((key, i) => [key, i]));
  let ids = keys.map((_, i) => i);
  const signature = (content, current) => {
    const mapItems = (items) =>
      items.map((item) => {
        if (item.leaf) return [item.ns, item.local, item.min, item.max, current[index.get(item.ct)]];
        if (item.any) return ['*', item.min, item.max];
        return [item.kind, item.min, item.max, mapItems(item.items)];
      });
    return JSON.stringify([content.kind, mapItems(content.items), content.min, content.max, content.required.map((r) => [r.ns, r.local])]);
  };
  for (let round = 0; round < 40; round++) {
    const seen = new Map();
    const next = keys.map((key, i) => {
      const sig = signature(contents.get(key).content, ids);
      if (seen.has(sig)) return seen.get(sig);
      seen.set(sig, i);
      return i;
    });
    const same = next.every((value, i) => value === ids[i]);
    ids = next;
    if (same) break;
  }

  const kept = new Map();
  const used = new Set();
  const nsUsed = new Set();
  const visit = (id) => {
    if (used.has(id)) return;
    used.add(id);
    const walk = (items) => {
      for (const item of items) {
        if (item.leaf) {
          nsUsed.add(item.ns);
          visit(ids[index.get(item.ct)]);
        } else if (item.items) walk(item.items);
      }
    };
    walk(contents.get(keys[id]).content.items);
    for (const r of contents.get(keys[id]).content.required) nsUsed.add(r.ns);
  };

  const elements = {};
  const ambiguous = [];
  for (const key of [...elementTypes.keys()].sort()) {
    const ns = key.slice(0, key.indexOf('|'));
    if (dropNamespace(ns)) continue;
    const reps = new Set([...elementTypes.get(key)].map((ct) => ids[index.get(ct)]));
    if (reps.size > 1) {
      ambiguous.push(key);
      continue;
    }
    kept.set(key, [...reps][0]);
  }
  for (const [key, id] of kept) {
    nsUsed.add(key.slice(0, key.indexOf('|')));
    visit(id);
  }
  const usedIds = [...used].sort((a, b) => a - b);
  const finalId = new Map(usedIds.map((id, i) => [id, i]));
  const nsList = [...nsUsed].sort();
  const nsIndex = new Map(nsList.map((ns, i) => [ns, i]));

  const encodeItems = (items) =>
    items.map((item) => {
      if (item.leaf) {
        const target = ids[index.get(item.ct)];
        const row = [nsIndex.get(item.ns), item.local, finalId.get(target)];
        if (item.min !== 1 || item.max !== 1) row.push(item.min, item.max);
        return row;
      }
      if (item.any) return ['*', item.min, item.max];
      return [item.kind, item.min, item.max, encodeItems(item.items)];
    });

  const types = usedIds.map((id) => {
    const { content } = contents.get(keys[id]);
    const row = [content.kind, encodeItems(content.items)];
    const plain = content.min === 1 && content.max === 1;
    if (content.required.length > 0 || !plain) row.push(content.required.map((r) => (r.ns === '' ? r.local : [nsIndex.get(r.ns), r.local])));
    if (!plain) row.push(content.min, content.max);
    return row;
  });
  const trivial = (id) => {
    const { content } = contents.get(keys[id]);
    return content.kind === 's' && content.items.length === 0 && content.required.length === 0;
  };
  for (const [key, id] of kept) {
    if (trivial(id)) continue;
    const bar = key.indexOf('|');
    const ns = key.slice(0, bar);
    if (!elements[ns]) elements[ns] = {};
    elements[ns][key.slice(bar + 1)] = finalId.get(id);
  }
  const namespaceAliases = {};
  for (const ns of nsList) {
    const strict = toStrictNs(ns);
    if (strict !== ns) namespaceAliases[strict] = ns;
  }
  const tolerated = [...new Set(patchLog.tolerated)].sort();
  const stats = { patches: patchLog, types: types.length, elements: Object.values(elements).reduce((sum, group) => sum + Object.keys(group).length, 0), ambiguous, conflicts: [...conflicts].sort(), open: [...openTypes].sort(), problems: [...problems].sort(), mcSeen: nsList.includes(MC_NS) };
  const table = { source, format: 2, namespaces: nsList, namespaceAliases };
  if (tolerated.length > 0) table.tolerated = tolerated;
  table.types = types;
  table.elements = elements;
  return { table, stats };
}
