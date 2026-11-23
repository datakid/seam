import { decodeEntities, getAttr, elementChildren, documentElement, localName, prefixOf, parseTree, serializeTree, createElement, removeNode, setAttr, removeAttr, escapeAttr } from './xml-repair.js';
import { encodeUtf8 } from './xml-clean.js';
import { finding } from './report.js';
import { REL_NS, REL_NS_STRICT, isMainRelType, CT_MAIN, CT_DEFAULTS, CT_NS, PKG_REL_NS, REL_OFFICE_DOC, REL_CORE, REL_EXT } from './constants.js';
import { overrideTypeFor, rowsOfRelType } from './registry.js';

export function dirName(path) {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
}

export function decodePartName(name) {
  return name.split('/').map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }).join('/');
}

export function encodePartName(name) {
  return name.split('/').map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

function overridePartName(node) {
  return decodePartName(normalizePartPath(getAttr(node, 'PartName') || ''));
}

export function normalizePartPath(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

export function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

export function resolveTarget(source, target) {
  const cleaned = safeDecode(decodeEntities(target)).split('\\').join('/');
  if (cleaned.startsWith('/')) return normalizePartPath(cleaned);
  const base = source === '' ? '' : dirName(source);
  return normalizePartPath(base === '' ? cleaned : `${base}/${cleaned}`);
}

export function relsPathFor(source) {
  if (source === '') return '_rels/.rels';
  const dir = dirName(source);
  const file = source.slice(dir.length + (dir === '' ? 0 : 1));
  return dir === '' ? `_rels/${file}.rels` : `${dir}/_rels/${file}.rels`;
}

export function sourceOfRels(relsPath) {
  if (relsPath === '_rels/.rels') return '';
  const at = relsPath.lastIndexOf('/_rels/');
  if (at !== -1 && relsPath.endsWith('.rels')) {
    return `${relsPath.slice(0, at)}/${relsPath.slice(at + 7, -5)}`;
  }
  if (relsPath.startsWith('_rels/') && relsPath.endsWith('.rels')) return relsPath.slice(6, -5);
  return null;
}

export function isRelsPath(path) {
  return path.toLowerCase().endsWith('.rels');
}

export function isXmlPath(path) {
  const lower = path.toLowerCase();
  return lower.endsWith('.xml') || lower.endsWith('.rels') || lower.endsWith('.vml');
}

export function extensionOf(path) {
  const file = path.slice(path.lastIndexOf('/') + 1);
  const dot = file.lastIndexOf('.');
  return dot === -1 ? '' : file.slice(dot + 1).toLowerCase();
}

export class PartIndex {
  constructor(names) {
    this.map = new Map();
    for (const name of names) this.map.set(name.toLowerCase(), name);
  }

  has(path) {
    return this.map.has(path.toLowerCase());
  }

  canonical(path) {
    return this.map.get(path.toLowerCase()) || null;
  }

  add(path) {
    this.map.set(path.toLowerCase(), path);
  }

  remove(path) {
    this.map.delete(path.toLowerCase());
  }

  names() {
    return Array.from(this.map.values());
  }
}

export function readRelationships(tree) {
  const root = documentElement(tree);
  if (!root || localName(root.name) !== 'Relationships') return [];
  return elementChildren(root, 'Relationship').map((node) => ({
    node,
    id: getAttr(node, 'Id'),
    type: getAttr(node, 'Type') || '',
    target: getAttr(node, 'Target') || '',
    external: (getAttr(node, 'TargetMode') || '').toLowerCase() === 'external'
  }));
}

export function readContentTypes(tree) {
  const defaults = new Map();
  const overrides = new Map();
  const root = documentElement(tree);
  if (!root || localName(root.name) !== 'Types') return { defaults, overrides, root: null };
  for (const node of elementChildren(root, 'Default')) {
    const ext = getAttr(node, 'Extension');
    const type = getAttr(node, 'ContentType');
    if (ext && type) defaults.set(ext.toLowerCase(), type);
  }
  for (const node of elementChildren(root, 'Override')) {
    const name = getAttr(node, 'PartName');
    const type = getAttr(node, 'ContentType');
    if (name && type) overrides.set(decodePartName(normalizePartPath(name)).toLowerCase(), type);
  }
  return { defaults, overrides, root };
}

export function contentTypeOf(path, ct) {
  const override = ct.overrides.get(path.toLowerCase());
  if (override) return override;
  return ct.defaults.get(extensionOf(path)) || null;
}

export function relPrefixSet(rootEl) {
  const set = new Set();
  if (rootEl) {
    for (const [name, value] of rootEl.attrs) {
      if (name.startsWith('xmlns:') && [REL_NS, REL_NS_STRICT].includes(decodeEntities(value))) set.add(name.slice(6));
    }
  }
  if (set.size === 0) set.add('r');
  return set;
}

export function relAttr(node, prefixes, local = 'id') {
  for (const [name, value] of node.attrs) {
    const prefix = prefixOf(name);
    if (prefix && prefixes.has(prefix) && localName(name) === local) return decodeEntities(value);
  }
  return null;
}


const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function addFinding(ctx, code, part, data) {
  ctx.findings.push(finding(code, part || null, data || {}));
}

export function getTree(ctx, name) {
  const part = ctx.parts.get(name);
  if (!part || part.text === null || part.text === undefined) return null;
  if (!ctx.trees.has(name)) ctx.trees.set(name, parseTree(part.text));
  return ctx.trees.get(name);
}

export function touch(ctx, name) {
  ctx.dirty.add(name);
  ctx.changed = true;
}

export function flushTrees(ctx) {
  for (const name of ctx.dirty) {
    const part = ctx.parts.get(name);
    const tree = ctx.trees.get(name);
    if (part && tree) {
      part.text = serializeTree(tree);
      part.changed = true;
    }
  }
  ctx.dirty.clear();
}

export function setText(ctx, name, text) {
  const part = ctx.parts.get(name);
  part.text = text;
  part.changed = true;
  ctx.trees.delete(name);
  ctx.dirty.delete(name);
  ctx.changed = true;
}

export function addPart(ctx, name, text, mtime = null) {
  ctx.parts.set(name, { name, bytes: encodeUtf8(text), text, isXml: true, changed: true, state: 'ok', mtime, raw: null, repairedXml: false });
  ctx.index.add(name);
  ctx.changed = true;
}

export function removePart(ctx, name) {
  ctx.parts.delete(name);
  ctx.index.remove(name);
  ctx.trees.delete(name);
  ctx.dirty.delete(name);
  ctx.changed = true;
}

export function referencedParts(ctx) {
  const out = new Map();
  for (const name of ctx.index.names()) {
    if (!isRelsPath(name)) continue;
    const source = sourceOfRels(name);
    if (source === null) continue;
    const tree = getTree(ctx, name);
    if (!tree) continue;
    for (const rel of readRelationships(tree)) {
      if (rel.external || !rel.target) continue;
      const target = resolveTarget(source, rel.target);
      out.set(target.toLowerCase(), target);
    }
  }
  return out;
}

export function relativeTarget(source, target) {
  const from = source === '' ? [] : dirName(source).split('/').filter(Boolean);
  const to = target.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  const up = from.length - common;
  return [...Array(up).fill('..'), ...to.slice(common)].join('/');
}

export function nextSeamId(used) {
  let n = 1;
  while (used.has(`rIdSeam${n}`)) n++;
  const id = `rIdSeam${n}`;
  used.add(id);
  return id;
}

export function newRelationshipsText(list) {
  const items = list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('');
  return `${DECL}<Relationships xmlns="${PKG_REL_NS}">${items}</Relationships>`;
}

export function relsTreeFor(ctx, source) {
  const path = relsPathFor(source);
  const canonical = ctx.index.canonical(path);
  return canonical ? { path: canonical, tree: getTree(ctx, canonical) } : { path, tree: null };
}

export function definedRelIds(ctx, source) {
  const { tree } = relsTreeFor(ctx, source);
  const ids = new Set();
  if (tree) for (const rel of readRelationships(tree)) if (rel.id) ids.add(rel.id);
  return ids;
}

export function addRelationship(ctx, source, type, targetPart) {
  const { path, tree } = relsTreeFor(ctx, source);
  const target = relativeTarget(source, targetPart);
  if (!tree) {
    addPart(ctx, path, newRelationshipsText([['rIdSeam1', type, target]]));
    return 'rIdSeam1';
  }
  const root = documentElement(tree);
  const used = new Set(readRelationships(tree).map((rel) => rel.id));
  const id = nextSeamId(used);
  const node = createElement('Relationship', [['Id', id], ['Type', type], ['Target', target]]);
  node.parent = root;
  root.children.push(node);
  touch(ctx, path);
  return id;
}

export function repairRootRels(ctx) {
  const mainPath = ctx.main;
  const canonical = ctx.index.canonical('_rels/.rels');
  const tree = canonical ? getTree(ctx, canonical) : null;
  if (!tree || !documentElement(tree) || localName(documentElement(tree).name) !== 'Relationships') {
    const list = [['rId1', REL_OFFICE_DOC, mainPath]];
    let n = 2;
    if (ctx.index.has('docProps/core.xml')) list.push([`rId${n++}`, REL_CORE, 'docProps/core.xml']);
    if (ctx.index.has('docProps/app.xml')) list.push([`rId${n++}`, REL_EXT, 'docProps/app.xml']);
    if (canonical) removePart(ctx, canonical);
    addPart(ctx, '_rels/.rels', newRelationshipsText(list));
    addFinding(ctx, 'ROOT_RELS_REBUILT', '_rels/.rels');
    return;
  }
  const rels = readRelationships(tree);
  const official = rels.filter((rel) => isMainRelType(rel.type) && !rel.external);
  const good = official.find((rel) => resolveTarget('', rel.target).toLowerCase() === mainPath.toLowerCase());
  if (good) return;
  const root = documentElement(tree);
  if (official.length > 0) {
    setAttr(official[0].node, 'Target', mainPath);
    for (const extra of official.slice(1)) removeNode(extra.node);
  } else {
    const used = new Set(rels.map((rel) => rel.id));
    const node = createElement('Relationship', [['Id', nextSeamId(used)], ['Type', REL_OFFICE_DOC], ['Target', mainPath]]);
    node.parent = root;
    root.children.push(node);
  }
  touch(ctx, canonical);
  addFinding(ctx, 'ROOT_RELS_FIXED', canonical);
}

function referencedIn(ctx, source, id) {
  if (source === '') return false;
  const canonical = ctx.index.canonical(source);
  const part = canonical ? ctx.parts.get(canonical) : null;
  if (!part || typeof part.text !== 'string') return false;
  return part.text.includes(`"${id}"`);
}

export function repairRels(ctx) {
  for (const name of ctx.index.names()) {
    if (!isRelsPath(name)) continue;
    const source = sourceOfRels(name);
    if (source === null) continue;
    if (source !== '' && !ctx.index.has(source)) {
      removePart(ctx, name);
      addFinding(ctx, 'REL_FILE_REMOVED', name);
      continue;
    }
    const tree = getTree(ctx, name);
    if (!tree) continue;
    const rels = readRelationships(tree);
    const removed = [];
    for (const rel of rels) {
      if (!rel.id || !rel.target) {
        removed.push(rel.target || '(none)');
        removeNode(rel.node);
        continue;
      }
      if (rel.external || rel.target === 'NULL') continue;
      if (!ctx.index.has(resolveTarget(source, rel.target))) {
        removed.push(rel.target);
        removeNode(rel.node);
        if (rel.id) {
          if (!ctx.removedRels.has(source)) ctx.removedRels.set(source, new Set());
          ctx.removedRels.get(source).add(rel.id);
        }
      }
    }
    if (removed.length > 0) {
      touch(ctx, name);
      addFinding(ctx, 'REL_REMOVED', name, { n: removed.length, targets: removed });
    }
    const alive = readRelationships(tree);
    const seen = new Set();
    const used = new Set(alive.map((rel) => rel.id));
    let renamed = 0;
    let dropped = 0;
    for (const rel of alive) {
      if (!seen.has(rel.id)) {
        seen.add(rel.id);
        continue;
      }
      if (!referencedIn(ctx, source, rel.id)) {
        setAttr(rel.node, 'Id', nextSeamId(used));
        renamed++;
      } else {
        removeNode(rel.node);
        dropped++;
      }
    }
    if (renamed > 0 || dropped > 0) touch(ctx, name);
    if (renamed > 0) addFinding(ctx, 'REL_ID_RENAMED', name, { n: renamed });
    if (dropped > 0) addFinding(ctx, 'REL_DUPLICATE_DROPPED', name, { n: dropped });
  }
}

function tableType(name) {
  return overrideTypeFor(name);
}

function buildTypes(ctx) {
  const exts = new Set(['rels', 'xml']);
  for (const part of ctx.parts.values()) {
    if (!isXmlPath(part.name) || part.name.toLowerCase().endsWith('.vml')) {
      const ext = extensionOf(part.name);
      if (ext && CT_DEFAULTS[ext] && tableType(part.name) === null) exts.add(ext);
    }
  }
  const defaults = Array.from(exts).map((ext) => `<Default Extension="${ext}" ContentType="${CT_DEFAULTS[ext]}"/>`).join('');
  const overrides = [`<Override PartName="/${encodePartName(ctx.main)}" ContentType="${CT_MAIN[ctx.format.key]}"/>`];
  for (const name of ctx.index.names()) {
    if (name === ctx.main || name === '[Content_Types].xml') continue;
    const type = tableType(name);
    if (type) overrides.push(`<Override PartName="/${encodePartName(name)}" ContentType="${type}"/>`);
  }
  return `${DECL}<Types xmlns="${CT_NS}">${defaults}${overrides.join('')}</Types>`;
}

const MEDIA_TOKEN = "[A-Za-z0-9!#$&^_.+-]+";
const CONTENT_TYPE_PATTERN = new RegExp(`^${MEDIA_TOKEN}/${MEDIA_TOKEN}(\\s*;\\s*${MEDIA_TOKEN}=("[^"]*"|[^\\s;"]+))*$`);
const EXTENSION_PATTERN = /^[A-Za-z0-9_~%+@!$&'()*,;:=-]+$/;

export function isValidContentType(value) {
  return typeof value === 'string' && CONTENT_TYPE_PATTERN.test(value);
}

export function isValidExtension(value) {
  return typeof value === 'string' && EXTENSION_PATTERN.test(value);
}

export function isValidPartName(value) {
  return typeof value === 'string' && /^\/[^\s"<>\\]+$/.test(value) && !value.includes('//') && !value.endsWith('/');
}

function cleanContentTypeEntries(root) {
  let cleaned = 0;
  const seen = { Default: new Set(), Override: new Set() };
  for (const node of elementChildren(root)) {
    const kind = localName(node.name);
    const allowed = kind === 'Default' ? ['Extension', 'ContentType'] : kind === 'Override' ? ['PartName', 'ContentType'] : null;
    if (!allowed) {
      removeNode(node);
      cleaned++;
      continue;
    }
    const key = getAttr(node, allowed[0]);
    const type = getAttr(node, 'ContentType');
    const keyOk = kind === 'Default' ? isValidExtension(key) : isValidPartName(key);
    const identity = keyOk ? key.toLowerCase() : null;
    if (!keyOk || !isValidContentType(type) || seen[kind].has(identity)) {
      removeNode(node);
      cleaned++;
      continue;
    }
    seen[kind].add(identity);
    let stripped = false;
    for (const pair of [...node.attrs]) {
      if (!allowed.includes(pair[0]) && !pair[0].startsWith('xmlns')) {
        removeAttr(node, pair[0]);
        stripped = true;
      }
    }
    if (stripped) cleaned++;
  }
  return cleaned;
}

function relationshipTypedParts(ctx) {
  const found = new Map();
  const family = ctx.format.family;
  for (const relsName of ctx.index.names()) {
    if (!isRelsPath(relsName)) continue;
    const source = sourceOfRels(relsName);
    if (source === null || (source !== '' && !ctx.index.has(source))) continue;
    const tree = getTree(ctx, relsName);
    if (!tree) continue;
    for (const rel of readRelationships(tree)) {
      if (!rel.id || !rel.target || rel.external || rel.target === 'NULL') continue;
      const target = resolveTarget(source, rel.target);
      if (!ctx.index.has(target) || target === ctx.main) continue;
      const rows = rowsOfRelType(rel.type);
      const row = rows.find((candidate) => candidate.family === family) || rows.find((candidate) => candidate.family === 'shared');
      if (!row || row.main || !row.contentType || row.contentType === CT_DEFAULTS.xml || row.kind === 'relationships') continue;
      const key = target.toLowerCase();
      if (!found.has(key)) found.set(key, { part: ctx.index.canonical(target) || target, row });
    }
  }
  return found;
}

export function repairContentTypes(ctx, silentParts) {
  const name = '[Content_Types].xml';
  const canonical = ctx.index.canonical(name);
  let tree = canonical ? getTree(ctx, canonical) : null;
  let ct = tree ? readContentTypes(tree) : null;
  if (!ct || !ct.root) {
    if (canonical) removePart(ctx, canonical);
    addPart(ctx, name, buildTypes(ctx));
    addFinding(ctx, 'CT_REBUILT', name);
    return;
  }
  const root = ct.root;
  let changed = false;
  const cleanedEntries = cleanContentTypeEntries(root);
  if (cleanedEntries > 0) {
    changed = true;
    ct = readContentTypes(tree);
    addFinding(ctx, 'CT_ENTRIES_CLEANED', name, { n: cleanedEntries });
  }
  const append = (node) => {
    node.parent = root;
    root.children.push(node);
    changed = true;
  };

  const mainKey = ctx.main.toLowerCase();
  const wantMain = CT_MAIN[ctx.format.key];
  const mainOverrideNode = elementChildren(root, 'Override').find((node) => overridePartName(node).toLowerCase() === mainKey);
  let addedOverrides = 0;
  if (!mainOverrideNode) {
    if (contentTypeOf(ctx.main, ct) !== wantMain) {
      append(createElement('Override', [['PartName', `/${encodePartName(ctx.main)}`], ['ContentType', wantMain]]));
      addedOverrides++;
    }
  } else if (getAttr(mainOverrideNode, 'ContentType') !== wantMain) {
    setAttr(mainOverrideNode, 'ContentType', wantMain);
    changed = true;
    addFinding(ctx, 'CT_MAIN_FIXED', name, { type: wantMain });
  }

  const removedNames = [];
  for (const node of elementChildren(root, 'Override')) {
    const partName = overridePartName(node);
    if (!partName || !ctx.index.has(partName)) {
      removeNode(node);
      changed = true;
      if (!silentParts.has(partName.toLowerCase())) removedNames.push(partName);
    }
  }
  if (removedNames.length > 0) addFinding(ctx, 'CT_OVERRIDE_REMOVED', name, { n: removedNames.length });

  ct = readContentTypes(tree);
  for (const partName of ctx.index.names()) {
    if (partName === '[Content_Types].xml' || partName === ctx.main) continue;
    const wanted = tableType(partName);
    if (!wanted) continue;
    const effective = contentTypeOf(partName, ct);
    if (effective === null || effective === CT_DEFAULTS.xml) {
      append(createElement('Override', [['PartName', `/${encodePartName(partName)}`], ['ContentType', wanted]]));
      ct.overrides.set(partName.toLowerCase(), wanted);
      addedOverrides++;
    }
  }
  let fixedOverrides = 0;
  for (const { part, row } of relationshipTypedParts(ctx).values()) {
    const effective = contentTypeOf(part, ct);
    if (effective && effective.toLowerCase() === row.contentType.toLowerCase()) continue;
    if (effective && row.contentTypeAlt.some((alt) => alt.toLowerCase() === effective.toLowerCase())) continue;
    const key = part.toLowerCase();
    const node = elementChildren(root, 'Override').find((candidate) => overridePartName(candidate).toLowerCase() === key);
    if (node) {
      setAttr(node, 'ContentType', row.contentType);
      changed = true;
    } else {
      append(createElement('Override', [['PartName', `/${encodePartName(part)}`], ['ContentType', row.contentType]]));
    }
    ct.overrides.set(key, row.contentType);
    if (effective === null || effective === CT_DEFAULTS.xml) addedOverrides++;
    else fixedOverrides++;
  }
  if (addedOverrides > 0) addFinding(ctx, 'CT_OVERRIDE_ADDED', name, { n: addedOverrides });
  if (fixedOverrides > 0) addFinding(ctx, 'CT_OVERRIDE_FIXED', name, { n: fixedOverrides });

  const firstOverride = elementChildren(root, 'Override')[0];
  const insertDefault = (ext, type) => {
    const node = createElement('Default', [['Extension', ext], ['ContentType', type]]);
    node.parent = root;
    const at = firstOverride ? root.children.indexOf(firstOverride) : root.children.length;
    root.children.splice(at, 0, node);
    ct.defaults.set(ext, type);
    changed = true;
    addFinding(ctx, 'CT_DEFAULT_ADDED', name, { ext });
  };
  const unknown = [];
  for (const partName of ctx.index.names()) {
    if (partName === '[Content_Types].xml') continue;
    if (contentTypeOf(partName, ct)) continue;
    const ext = extensionOf(partName);
    if (ext && CT_DEFAULTS[ext]) insertDefault(ext, CT_DEFAULTS[ext]);
    else unknown.push(partName);
  }
  for (const partName of unknown) addFinding(ctx, 'CT_UNKNOWN_PART', partName);

  if (changed) touch(ctx, canonical);
}

const GENERIC_TYPE = 'application/octet-stream';

export function typeUntypedParts(ctx) {
  const name = '[Content_Types].xml';
  const canonical = ctx.index.canonical(name);
  const tree = canonical ? getTree(ctx, canonical) : null;
  const ct = tree ? readContentTypes(tree) : null;
  if (!ct || !ct.root) return false;
  let typed = 0;
  for (const partName of ctx.index.names()) {
    if (partName === name || contentTypeOf(partName, ct)) continue;
    const node = createElement('Override', [['PartName', escapeAttr(`/${partName}`)], ['ContentType', GENERIC_TYPE]]);
    node.parent = ct.root;
    ct.root.children.push(node);
    ct.overrides.set(partName.toLowerCase(), GENERIC_TYPE);
    const noted = ctx.findings.findIndex((f) => f.code === 'CT_UNKNOWN_PART' && f.part === partName);
    if (noted !== -1) ctx.findings.splice(noted, 1);
    addFinding(ctx, 'CT_PART_TYPED', partName, { type: GENERIC_TYPE });
    typed++;
  }
  if (typed > 0) touch(ctx, canonical);
  return typed > 0;
}

export function mainFolderOf(main) {
  return dirName(main);
}
