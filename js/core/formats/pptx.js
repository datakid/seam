import { getTree, touch, addFinding, relsTreeFor, relPrefixSet, relAttr, resolveTarget, readRelationships, addRelationship } from '../package.js';
import { documentElement, localName, descendants, elementChildren, removeNode, setAttr, getAttr } from '../xml-repair.js';
import { REL_BASE } from '../constants.js';

export function applyPptx(ctx) {
  const tree = getTree(ctx, ctx.main);
  const root = tree ? documentElement(tree) : null;
  if (!root || localName(root.name) !== 'presentation') return { salvage: 'mainBroken' };
  const prefixes = relPrefixSet(root);
  const { tree: relsTree } = relsTreeFor(ctx, ctx.main);
  const rels = relsTree ? readRelationships(relsTree) : [];
  let changed = false;

  const resolve = (node) => {
    const id = relAttr(node, prefixes);
    const rel = rels.find((r) => r.id === id && !r.external);
    return rel ? ctx.index.canonical(resolveTarget(ctx.main, rel.target)) : null;
  };

  const masterList = elementChildren(root, 'sldMasterIdLst')[0];
  const masters = masterList ? elementChildren(masterList, 'sldMasterId') : [];
  const validMasters = [];
  let removedMasters = 0;
  for (const node of masters) {
    const path = resolve(node);
    if (path) validMasters.push(path);
    else {
      removeNode(node);
      removedMasters++;
      changed = true;
    }
  }
  if (validMasters.length === 0) return { salvage: 'noMaster' };
  if (removedMasters > 0) addFinding(ctx, 'PPTX_MASTER_REMOVED', ctx.main, { n: removedMasters });

  let firstLayout = null;
  const { tree: masterRels } = relsTreeFor(ctx, validMasters[0]);
  if (masterRels) {
    for (const rel of readRelationships(masterRels)) {
      if (rel.type.endsWith('/slideLayout') && !rel.external) {
        const path = ctx.index.canonical(resolveTarget(validMasters[0], rel.target));
        if (path) {
          firstLayout = path;
          break;
        }
      }
    }
  }

  const slideList = elementChildren(root, 'sldIdLst')[0];
  const slideNodes = slideList ? elementChildren(slideList, 'sldId') : [];
  const slides = [];
  slideNodes.forEach((node, index) => {
    const path = resolve(node);
    if (path) slides.push({ node, path, number: index + 1 });
    else {
      removeNode(node);
      changed = true;
      addFinding(ctx, 'PPTX_SLIDE_REMOVED', ctx.main, { number: index + 1 });
    }
  });

  const used = new Set();
  const offenders = [];
  for (const slide of slides) {
    const raw = getAttr(slide.node, 'id');
    const value = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < 256 || value > 2147483647 || used.has(value)) offenders.push(slide);
    else used.add(value);
  }
  if (offenders.length > 0) {
    let next = 256;
    for (const slide of offenders) {
      while (used.has(next)) next++;
      setAttr(slide.node, 'id', String(next));
      used.add(next);
    }
    changed = true;
    addFinding(ctx, 'PPTX_SLIDE_IDS', ctx.main, { n: offenders.length });
  }
  if (changed) touch(ctx, ctx.main);

  for (const slide of slides) {
    const { path: slideRels, tree: slideRelsTree } = relsTreeFor(ctx, slide.path);
    const list = slideRelsTree ? readRelationships(slideRelsTree) : [];
    const layouts = list.filter((r) => r.type.endsWith('/slideLayout') && !r.external && ctx.index.has(resolveTarget(slide.path, r.target)));
    if (layouts.length === 0) {
      if (!firstLayout) return { salvage: 'noLayout' };
      addRelationship(ctx, slide.path, REL_BASE + 'slideLayout', firstLayout);
      addFinding(ctx, 'PPTX_LAYOUT_RELINKED', slide.path, { number: slide.number });
    }
  }
  ctx.slideCount = slides.length;
  ctx.inventory.slides = { expected: slideNodes.length, recovered: slides.length };
  return {};
}
