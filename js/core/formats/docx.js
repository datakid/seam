import { getTree, touch, addFinding, definedRelIds, addRelationship, relsTreeFor, relPrefixSet, relAttr, resolveTarget, readRelationships, mainFolderOf } from '../package.js';
import { documentElement, localName, prefixOf, descendants, elementChildren, removeNode, unwrapNode, createElement, getAttrLocal } from '../xml-repair.js';
import { REL_BASE } from '../constants.js';

function ancestor(node, local) {
  let current = node.parent;
  while (current) {
    if (current.type === 'el' && localName(current.name) === local) return current;
    current = current.parent;
  }
  return null;
}

const LINKED = [
  ['styles.xml', 'styles'],
  ['numbering.xml', 'numbering'],
  ['settings.xml', 'settings'],
  ['fontTable.xml', 'fontTable']
];

export function applyDocx(ctx) {
  const tree = getTree(ctx, ctx.main);
  const root = tree ? documentElement(tree) : null;
  if (!root || localName(root.name) !== 'document') return { salvage: 'mainBroken' };
  let changed = false;

  if (elementChildren(root, 'body').length === 0) {
    const prefix = prefixOf(root.name);
    const body = createElement(prefix ? `${prefix}:body` : 'body');
    for (const child of root.children) child.parent = body;
    body.children = root.children;
    root.children = [body];
    body.parent = root;
    changed = true;
    addFinding(ctx, 'DOCX_BODY_ADDED', ctx.main);
  }

  const prefixes = relPrefixSet(root);
  const defined = definedRelIds(ctx, ctx.main);

  const drawings = new Set();
  for (const blip of descendants(root, 'blip')) {
    for (const local of ['embed', 'link']) {
      const id = relAttr(blip, prefixes, local);
      if (id && !defined.has(id)) {
        const holder = ancestor(blip, 'drawing');
        if (holder) drawings.add(holder);
      }
    }
  }
  for (const image of descendants(root, 'imagedata')) {
    const id = relAttr(image, prefixes, 'id');
    if (id && !defined.has(id)) {
      const holder = ancestor(image, 'pict');
      if (holder) drawings.add(holder);
    }
  }
  for (const node of drawings) removeNode(node);
  if (drawings.size > 0) {
    changed = true;
    addFinding(ctx, 'DOCX_IMAGE_REMOVED', ctx.main, { n: drawings.size });
  }

  const links = descendants(root, 'hyperlink').filter((node) => {
    const id = relAttr(node, prefixes, 'id');
    return id && !defined.has(id);
  });
  for (const node of links) unwrapNode(node);
  if (links.length > 0) {
    changed = true;
    addFinding(ctx, 'DOCX_LINK_REMOVED', ctx.main, { n: links.length });
  }

  const refs = [...descendants(root, 'headerReference'), ...descendants(root, 'footerReference')].filter((node) => {
    const id = relAttr(node, prefixes, 'id');
    return id && !defined.has(id);
  });
  for (const node of refs) removeNode(node);
  if (refs.length > 0) {
    changed = true;
    addFinding(ctx, 'DOCX_HEADER_REF_REMOVED', ctx.main, { n: refs.length });
  }
  if (changed) touch(ctx, ctx.main);

  const folder = mainFolderOf(ctx.main);
  const { path: relsPath, tree: relsTree } = relsTreeFor(ctx, ctx.main);
  const existing = relsTree ? readRelationships(relsTree) : [];
  let added = 0;
  for (const [file, type] of LINKED) {
    const path = folder ? `${folder}/${file}` : file;
    const canonical = ctx.index.canonical(path);
    if (!canonical) continue;
    const linked = existing.some((rel) => !rel.external && resolveTarget(ctx.main, rel.target).toLowerCase() === canonical.toLowerCase());
    if (!linked) {
      addRelationship(ctx, ctx.main, REL_BASE + type, canonical);
      added++;
    }
  }
  if (added > 0) addFinding(ctx, 'DOCX_REL_ADDED', relsPath, { n: added });

  const numberingPath = folder ? `${folder}/numbering.xml` : 'numbering.xml';
  if (!ctx.index.has(numberingPath)) {
    const used = descendants(root, 'numId').some((node) => getAttrLocal(node, 'val') !== '0');
    if (used) addFinding(ctx, 'DOCX_NUMBERING_MISSING', ctx.main);
  }
  return {};
}
