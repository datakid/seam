import { getTree, addPart, addFinding, relsPathFor, relativeTarget, newRelationshipsText, nextSeamId, relPrefixSet, relAttr, readRelationships, resolveTarget } from './package.js';
import { documentElement, elementChildren } from './xml-repair.js';
import { REL_BASE } from './constants.js';

export const numbered = (ctx, pattern) => ctx.index.names()
  .map((name) => ({ name, match: pattern.exec(name) }))
  .filter((item) => item.match)
  .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
  .map((item) => item.name);

const first = (ctx, path) => ctx.index.canonical(path);

function lacksRels(ctx, source) {
  return ctx.index.has(source) && !ctx.index.has(relsPathFor(source));
}

function idsIn(ctx, source, list, item) {
  const tree = getTree(ctx, source);
  const root = tree ? documentElement(tree) : null;
  if (!root) return [];
  const prefixes = relPrefixSet(root);
  const holder = elementChildren(root, list)[0];
  return holder ? elementChildren(holder, item).map((node) => relAttr(node, prefixes)).filter(Boolean) : [];
}

function writeRels(ctx, source, entries) {
  if (entries.length === 0) return 0;
  const list = entries.map(([id, type, target]) => [id, REL_BASE + type, relativeTarget(source, target)]);
  addPart(ctx, relsPathFor(source), newRelationshipsText(list));
  addFinding(ctx, 'RELS_REBUILT', relsPathFor(source), { n: list.length });
  return list.length;
}

function mapInOrder(ids, targets, type, entries) {
  const count = Math.min(ids.length, targets.length);
  for (let at = 0; at < count; at++) entries.push([ids[at], type, targets[at]]);
  return count;
}

function layoutOwners(ctx, masters, layouts) {
  const owner = new Map();
  for (const master of masters) {
    const relsName = ctx.index.canonical(relsPathFor(master));
    const tree = relsName ? getTree(ctx, relsName) : null;
    if (!tree) continue;
    for (const rel of readRelationships(tree)) {
      if (!rel.type.endsWith('/slideLayout') || rel.external) continue;
      const target = ctx.index.canonical(resolveTarget(master, rel.target));
      if (target) owner.set(target, master);
    }
  }
  const free = layouts.filter((layout) => !owner.has(layout));
  const assigned = new Map();
  for (const master of masters) {
    if (!lacksRels(ctx, master)) continue;
    const ids = idsIn(ctx, master, 'sldLayoutIdLst', 'sldLayoutId');
    const mine = free.splice(0, ids.length);
    assigned.set(master, { ids, layouts: mine });
    for (const layout of mine) owner.set(layout, master);
  }
  return { owner, assigned };
}

function rebuildPptx(ctx) {
  const masters = numbered(ctx, /^ppt\/slideMasters\/slideMaster(\d+)\.xml$/i);
  const layouts = numbered(ctx, /^ppt\/slideLayouts\/slideLayout(\d+)\.xml$/i);
  const slides = numbered(ctx, /^ppt\/slides\/slide(\d+)\.xml$/i);
  const notesMasters = numbered(ctx, /^ppt\/notesMasters\/notesMaster(\d+)\.xml$/i);
  const handoutMasters = numbered(ctx, /^ppt\/handoutMasters\/handoutMaster(\d+)\.xml$/i);
  const themes = numbered(ctx, /^ppt\/theme\/theme(\d+)\.xml$/i);
  const { owner, assigned } = layoutOwners(ctx, masters, layouts);
  let rebuilt = 0;

  masters.forEach((master, at) => {
    if (!assigned.has(master)) return;
    const entries = [];
    mapInOrder(assigned.get(master).ids, assigned.get(master).layouts, 'slideLayout', entries);
    const used = new Set(entries.map((entry) => entry[0]));
    const theme = themes[at] || themes[0];
    if (theme) entries.push([nextSeamId(used), 'theme', theme]);
    rebuilt += writeRels(ctx, master, entries);
  });

  for (const layout of layouts) {
    if (!lacksRels(ctx, layout)) continue;
    const master = owner.get(layout) || masters[0];
    if (master) rebuilt += writeRels(ctx, layout, [['rId1', 'slideMaster', master]]);
  }

  if (lacksRels(ctx, ctx.main)) {
    const entries = [];
    mapInOrder(idsIn(ctx, ctx.main, 'sldMasterIdLst', 'sldMasterId'), masters, 'slideMaster', entries);
    const slideCount = mapInOrder(idsIn(ctx, ctx.main, 'sldIdLst', 'sldId'), slides, 'slide', entries);
    mapInOrder(idsIn(ctx, ctx.main, 'notesMasterIdLst', 'notesMasterId'), notesMasters, 'notesMaster', entries);
    mapInOrder(idsIn(ctx, ctx.main, 'handoutMasterIdLst', 'handoutMasterId'), handoutMasters, 'handoutMaster', entries);
    const used = new Set(entries.map((entry) => entry[0]));
    const implicit = [['theme', themes[0]], ['presProps', first(ctx, 'ppt/presProps.xml')], ['viewProps', first(ctx, 'ppt/viewProps.xml')], ['tableStyles', first(ctx, 'ppt/tableStyles.xml')]];
    for (const [type, target] of implicit) if (target) entries.push([nextSeamId(used), type, target]);
    rebuilt += writeRels(ctx, ctx.main, entries);
    if (slideCount > 1) addFinding(ctx, 'PPTX_SLIDE_ORDER_GUESSED', ctx.main, { n: slideCount });
  }
  return rebuilt;
}

function rebuildXlsx(ctx) {
  if (!lacksRels(ctx, ctx.main)) return 0;
  const sheets = numbered(ctx, /^xl\/worksheets\/sheet(\d+)\.xml$/i);
  const tree = getTree(ctx, ctx.main);
  const root = tree ? documentElement(tree) : null;
  const holder = root ? elementChildren(root, 'sheets')[0] : null;
  const prefixes = root ? relPrefixSet(root) : new Set(['r']);
  const nodes = holder ? elementChildren(holder, 'sheet') : [];
  const entries = [];
  if (nodes.length === sheets.length) {
    mapInOrder(nodes.map((node) => relAttr(node, prefixes)).filter(Boolean), sheets, 'worksheet', entries);
  } else {
    for (const node of nodes) {
      const id = relAttr(node, prefixes);
      const wanted = node.attrs.find(([key]) => key === 'sheetId');
      const target = wanted ? sheets.find((name) => Number(/(\d+)\.xml$/i.exec(name)[1]) === Number(wanted[1])) : null;
      if (id && target) entries.push([id, 'worksheet', target]);
    }
  }
  const used = new Set(entries.map((entry) => entry[0]));
  for (const [type, target] of [['styles', first(ctx, 'xl/styles.xml')], ['sharedStrings', first(ctx, 'xl/sharedStrings.xml')], ['theme', first(ctx, 'xl/theme/theme1.xml')]]) {
    if (target) entries.push([nextSeamId(used), type, target]);
  }
  return writeRels(ctx, ctx.main, entries);
}

function rebuildDocx(ctx) {
  if (!lacksRels(ctx, ctx.main)) return 0;
  const entries = [];
  const used = new Set();
  const tree = getTree(ctx, ctx.main);
  const root = tree ? documentElement(tree) : null;
  const refs = (local) => {
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.type !== 'el') continue;
        if (child.name.split(':').pop() === local) found.push(child);
        walk(child);
      }
    };
    if (root) walk(root);
    return found;
  };
  const prefixes = root ? relPrefixSet(root) : new Set(['r']);
  for (const [local, pattern, type] of [['headerReference', /^word\/header(\d+)\.xml$/i, 'header'], ['footerReference', /^word\/footer(\d+)\.xml$/i, 'footer']]) {
    const targets = numbered(ctx, pattern);
    const ids = [];
    for (const node of refs(local)) {
      const id = relAttr(node, prefixes);
      if (id && !ids.includes(id)) ids.push(id);
    }
    mapInOrder(ids, targets, type, entries);
  }
  for (const entry of entries) used.add(entry[0]);
  const implicit = [
    ['styles', 'word/styles.xml'], ['settings', 'word/settings.xml'], ['fontTable', 'word/fontTable.xml'], ['webSettings', 'word/webSettings.xml'],
    ['numbering', 'word/numbering.xml'], ['theme', 'word/theme/theme1.xml'], ['footnotes', 'word/footnotes.xml'], ['endnotes', 'word/endnotes.xml'], ['comments', 'word/comments.xml']
  ];
  for (const [type, path] of implicit) {
    const target = first(ctx, path);
    if (target) entries.push([nextSeamId(used), type, target]);
  }
  return writeRels(ctx, ctx.main, entries);
}

export function rebuildRels(ctx) {
  if (!ctx.main || !ctx.family) return 0;
  if (ctx.family === 'pptx') return rebuildPptx(ctx);
  if (ctx.family === 'xlsx') return rebuildXlsx(ctx);
  if (ctx.family === 'docx') return rebuildDocx(ctx);
  return 0;
}
