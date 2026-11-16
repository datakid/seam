import { strictRead } from './zip-read.js';
import { decodeXml } from './xml-clean.js';
import { parseTree, documentElement, localName, elementChildren, descendants, looksWellFormed } from './xml-repair.js';
import { CT_MAIN, FAMILY_KEYS, isMainRelType } from './constants.js';
import { isXmlPath, isRelsPath, resolveTarget, sourceOfRels, PartIndex, readRelationships, readContentTypes, contentTypeOf, relsPathFor, relPrefixSet, relAttr } from './package.js';

const FAMILY = { word: 'docx', xl: 'xlsx', ppt: 'pptx' };

export async function checkWellFormed(env, text) {
  if (!looksWellFormed(text)) return false;
  return env.isWellFormed(text);
}

export function familyOfMain(path) {
  const top = path.split('/')[0];
  return FAMILY[top] || null;
}

export async function verifyPackage(bytes, env, expected = null) {
  const failed = [];
  const read = strictRead(bytes, 0);
  const names = read.entries.map((entry) => entry.name);
  if (!read.intact || read.entries.length === 0) failed.push({ check: 1, detail: 'zip' });
  else if (read.entries[0].name !== '[Content_Types].xml') failed.push({ check: 1, detail: 'order' });
  if (failed.length > 0) return { ok: false, failed };

  const index = new PartIndex(names);
  const texts = new Map();
  const trees = new Map();
  let wellFormed = true;
  for (const entry of read.entries) {
    if (!isXmlPath(entry.name)) continue;
    const { text } = decodeXml(entry.data);
    texts.set(entry.name, text);
    if (!(await checkWellFormed(env, text))) {
      wellFormed = false;
      failed.push({ check: 2, detail: entry.name });
      break;
    }
  }
  if (!wellFormed) return { ok: false, failed };

  function tree(name) {
    if (!trees.has(name)) trees.set(name, parseTree(texts.get(name)));
    return trees.get(name);
  }

  for (const name of names) {
    if (!isRelsPath(name)) continue;
    const source = sourceOfRels(name);
    for (const rel of readRelationships(tree(name))) {
      if (rel.external || rel.target === 'NULL') continue;
      if (source !== null && !index.has(resolveTarget(source, rel.target))) {
        failed.push({ check: 3, detail: `${name} ${rel.target}` });
        return { ok: false, failed };
      }
    }
  }

  const ct = readContentTypes(tree('[Content_Types].xml'));
  if (!ct.root) {
    failed.push({ check: 4, detail: 'types' });
    return { ok: false, failed };
  }
  for (const name of names) {
    if (name === '[Content_Types].xml') continue;
    if (!contentTypeOf(name, ct)) {
      failed.push({ check: 4, detail: name });
      return { ok: false, failed };
    }
  }

  let main = null;
  if (index.has('_rels/.rels')) {
    const rel = readRelationships(tree(index.canonical('_rels/.rels'))).find((r) => isMainRelType(r.type) && !r.external);
    if (rel) main = resolveTarget('', rel.target);
  }
  if (!main || !index.has(main)) {
    failed.push({ check: 5, detail: 'main' });
    return { ok: false, failed };
  }
  main = index.canonical(main);
  const family = familyOfMain(main);
  const mainType = contentTypeOf(main, ct);
  const allowed = family ? FAMILY_KEYS[family].map((key) => CT_MAIN[key]) : [];
  if (!family || !allowed.includes(mainType) || (expected && CT_MAIN[expected.key] !== mainType)) {
    failed.push({ check: 5, detail: 'type' });
    return { ok: false, failed };
  }

  const root = documentElement(tree(main));
  if (!root) {
    failed.push({ check: 5, detail: 'root' });
    return { ok: false, failed };
  }
  if (family === 'docx') {
    if (localName(root.name) !== 'document' || elementChildren(root, 'body').length === 0) failed.push({ check: 5, detail: 'body' });
  } else if (family === 'xlsx') {
    const relsPath = relsPathFor(main);
    const rels = index.has(relsPath) ? readRelationships(tree(index.canonical(relsPath))) : [];
    const prefixes = relPrefixSet(root);
    const sheets = descendants(root, 'sheet');
    const ok = sheets.some((sheet) => {
      const id = relAttr(sheet, prefixes);
      const rel = rels.find((r) => r.id === id && !r.external);
      return rel && index.has(resolveTarget(main, rel.target));
    });
    if (!ok) failed.push({ check: 5, detail: 'sheets' });
  } else if (family === 'pptx') {
    const relsPath = relsPathFor(main);
    const rels = index.has(relsPath) ? readRelationships(tree(index.canonical(relsPath))) : [];
    const prefixes = relPrefixSet(root);
    const masters = descendants(root, 'sldMasterId');
    const ok = masters.some((master) => {
      const id = relAttr(master, prefixes);
      const rel = rels.find((r) => r.id === id && !r.external);
      return rel && index.has(resolveTarget(main, rel.target));
    });
    if (!ok) failed.push({ check: 5, detail: 'masters' });
  }
  return { ok: failed.length === 0, failed, main, family };
}
