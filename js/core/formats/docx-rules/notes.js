import { getTree, touch, addFinding, mainFolderOf } from '../../package.js';
import { documentElement, localName, descendants, getAttrLocal, removeNode, elementChildren } from '../../xml-repair.js';

const KINDS = [
  { kind: 'footnote', file: 'footnotes.xml', holder: 'footnote', refs: ['footnoteReference'], settings: 'footnotePr' },
  { kind: 'endnote', file: 'endnotes.xml', holder: 'endnote', refs: ['endnoteReference'], settings: 'endnotePr' },
  { kind: 'comment', file: 'comments.xml', holder: 'comment', refs: ['commentReference', 'commentRangeStart', 'commentRangeEnd'], settings: null }
];

const RUN_PARTS = /^(header|footer)\d*\.xml$/i;

function idsOf(ctx, path, holder) {
  const tree = getTree(ctx, path);
  const root = tree ? documentElement(tree) : null;
  if (!root) return null;
  const ids = new Set();
  for (const node of descendants(root, holder)) ids.add(getAttrLocal(node, 'id'));
  return ids;
}

function dropRef(node) {
  const parent = node.parent;
  if (parent && localName(parent.name) === 'r') {
    const content = parent.children.filter((child) => child.type === 'el' && localName(child.name) !== 'rPr');
    removeNode(content.length === 1 ? parent : node);
    return;
  }
  removeNode(node);
}

function sweepPart(ctx, part, spec, known) {
  const tree = getTree(ctx, part);
  const root = tree ? documentElement(tree) : null;
  if (!root) return 0;
  let removed = 0;
  for (const local of spec.refs) {
    for (const node of descendants(root, local)) {
      if (known && known.has(getAttrLocal(node, 'id'))) continue;
      dropRef(node);
      removed++;
    }
  }
  if (removed > 0) {
    touch(ctx, part);
    addFinding(ctx, 'DOCX_NOTE_REFS_REMOVED', part, { n: removed, kind: spec.kind });
  }
  return removed;
}

export function removeDanglingNotes(ctx) {
  if (!ctx.changed && ctx.strictIntact && !ctx.extCorrected) return;
  const folder = mainFolderOf(ctx.main);
  const at = (file) => (folder ? `${folder}/${file}` : file);
  const holders = ctx.index.names().filter((name) => name === ctx.main || ((folder ? name.startsWith(`${folder}/`) : true) && RUN_PARTS.test(name.split('/').pop())));
  for (const spec of KINDS) {
    const path = ctx.index.canonical(at(spec.file));
    const known = path ? idsOf(ctx, path, spec.holder) : new Set();
    if (known === null) continue;
    for (const part of holders) sweepPart(ctx, part, spec, known);
    if (path || !spec.settings) continue;
    const settings = ctx.index.canonical(at('settings.xml'));
    const tree = settings ? getTree(ctx, settings) : null;
    const root = tree ? documentElement(tree) : null;
    if (!root) continue;
    const nodes = elementChildren(root, spec.settings);
    for (const node of nodes) removeNode(node);
    if (nodes.length > 0) {
      touch(ctx, settings);
      addFinding(ctx, 'DOCX_NOTE_REFS_REMOVED', settings, { n: nodes.length, kind: spec.kind });
    }
  }
}
