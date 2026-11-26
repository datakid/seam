import { getTree, touch, addFinding, definedRelIds, relsTreeFor, relPrefixSet, relAttr, resolveTarget, readRelationships, removePart, setText, mainFolderOf, isRelsPath, sourceOfRels } from '../package.js';
import { registerCheck } from '../tiers.js';
import { documentElement, localName, descendants, elementChildren, removeNode, setAttr, removeAttr, getAttr, scan, serializeTokens, decodeEntities } from '../xml-repair.js';

function sheetEntries(ctx, root, prefixes) {
  const sheetsEl = elementChildren(root, 'sheets')[0];
  if (!sheetsEl) return null;
  const { tree } = relsTreeFor(ctx, ctx.main);
  const rels = tree ? readRelationships(tree) : [];
  return {
    sheetsEl,
    rels,
    nodes: elementChildren(sheetsEl, 'sheet').map((node) => {
      const id = relAttr(node, prefixes);
      const rel = rels.find((r) => r.id === id && !r.external);
      const path = rel ? resolveTarget(ctx.main, rel.target) : null;
      const canonical = path ? ctx.index.canonical(path) : null;
      const part = canonical ? ctx.parts.get(canonical) : null;
      return { node, path: canonical || path, part: part && part.isXml ? part : null };
    })
  };
}

function countInvalidSharedRefs(text, total) {
  let bad = 0;
  let at = text.indexOf('t="s"');
  while (at !== -1) {
    const open = text.lastIndexOf('<', at);
    const gt = text.indexOf('>', at);
    if (open !== -1 && gt !== -1 && text.startsWith('<c', open) && /\s/.test(text[open + 2] || '') && text[gt - 1] !== '/') {
      const close = text.indexOf('</c>', gt);
      const vStart = text.indexOf('<v>', gt);
      if (vStart !== -1 && (close === -1 || vStart < close)) {
        const vEnd = text.indexOf('</v>', vStart);
        const value = vEnd === -1 ? '' : text.slice(vStart + 3, vEnd).trim();
        if (!/^\d+$/.test(value) || Number(value) >= total) bad++;
      } else if (close !== -1 && (vStart === -1 || vStart > close)) {
        bad++;
      }
    }
    at = text.indexOf('t="s"', at + 5);
  }
  return bad;
}

function editSheet(tokens, total, defined, prefixes, removeDimension) {
  const skip = new Uint8Array(tokens.length);
  const result = { cleared: 0, drawings: 0, dimension: false };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t !== 'open') continue;
    const local = localName(t.name);
    if (local === 'c' && !t.self) {
      const typeAttr = t.attrs.find((a) => a[0] === 't');
      if (typeAttr && decodeEntities(typeAttr[1]) === 's') {
        let depth = 1;
        let vOpen = -1;
        let vClose = -1;
        let vSelf = -1;
        for (let j = i + 1; j < tokens.length && depth > 0; j++) {
          const u = tokens[j];
          if (u.t === 'open' && !u.self) {
            depth++;
            if (depth === 2 && localName(u.name) === 'v') vOpen = j;
          } else if (u.t === 'open' && u.self) {
            if (depth === 1 && localName(u.name) === 'v') vSelf = j;
          } else if (u.t === 'close') {
            depth--;
            if (depth === 1 && vOpen !== -1 && vClose === -1 && localName(u.name) === 'v') vClose = j;
          }
        }
        let invalid = false;
        if (vSelf !== -1) {
          invalid = true;
          skip[vSelf] = 1;
        } else if (vOpen !== -1 && vClose !== -1) {
          let value = '';
          for (let k = vOpen + 1; k < vClose; k++) if (tokens[k].t === 'text') value += tokens[k].raw;
          value = decodeEntities(value).trim();
          if (!/^\d+$/.test(value) || Number(value) >= total) {
            invalid = true;
            for (let k = vOpen; k <= vClose; k++) skip[k] = 1;
          }
        } else {
          invalid = true;
        }
        if (invalid) {
          t.attrs = t.attrs.filter((a) => a[0] !== 't');
          result.cleared++;
        }
      }
    } else if (local === 'dimension' && removeDimension) {
      skip[i] = 1;
      if (!t.self && tokens[i + 1] && tokens[i + 1].t === 'close') skip[i + 1] = 1;
      result.dimension = true;
    } else if (local === 'drawing' || local === 'legacyDrawing') {
      const id = relAttr(t, prefixes);
      if (id && !defined.has(id)) {
        skip[i] = 1;
        if (!t.self && tokens[i + 1] && tokens[i + 1].t === 'close') skip[i + 1] = 1;
        result.drawings++;
      }
    }
  }
  result.tokens = tokens.filter((_, idx) => !skip[idx]);
  return result;
}

function sstPathOf(ctx, rels) {
  const rel = rels.find((r) => r.type.endsWith('/sharedStrings') && !r.external);
  const path = rel ? resolveTarget(ctx.main, rel.target) : `${mainFolderOf(ctx.main)}/sharedStrings.xml`;
  return ctx.index.canonical(path);
}

export function applyXlsx(ctx) {
  const tree = getTree(ctx, ctx.main);
  const root = tree ? documentElement(tree) : null;
  if (!root || localName(root.name) !== 'workbook') return { salvage: 'mainBroken' };
  const prefixes = relPrefixSet(root);
  const entries = sheetEntries(ctx, root, prefixes);
  if (!entries) return { salvage: 'noSheets' };
  let changed = false;

  const removed = new Set();
  const kept = [];
  entries.nodes.forEach((entry, index) => {
    if (!entry.part) {
      removed.add(index);
      addFinding(ctx, 'XLSX_SHEET_REMOVED', entry.path || ctx.main, { name: getAttr(entry.node, 'name') || '' });
      removeNode(entry.node);
      changed = true;
    } else {
      kept.push({ ...entry, index });
    }
  });
  if (kept.length === 0) return { salvage: 'noSheets' };

  if (removed.size > 0) {
    for (const node of descendants(root, 'definedName')) {
      const raw = getAttr(node, 'localSheetId');
      if (raw === null) continue;
      const old = Number(raw);
      if (removed.has(old)) {
        removeNode(node);
      } else {
        const shift = Array.from(removed).filter((r) => r < old).length;
        if (shift > 0) setAttr(node, 'localSheetId', String(old - shift));
      }
    }
    for (const view of descendants(root, 'workbookView')) {
      for (const attr of ['activeTab', 'firstSheet']) {
        const raw = getAttr(view, attr);
        if (raw !== null && Number(raw) >= kept.length) setAttr(view, attr, '0');
      }
    }
    addFinding(ctx, 'XLSX_NAMES_ADJUSTED', ctx.main, { n: removed.size });
  }

  const seen = new Set();
  for (const entry of kept) {
    const original = getAttr(entry.node, 'name');
    if (original === null) continue;
    let name = original.length > 31 ? original.slice(0, 31) : original;
    if (seen.has(name.toLowerCase())) {
      let n = 2;
      let candidate;
      do {
        const suffix = ` (${n++})`;
        candidate = name.slice(0, 31 - suffix.length) + suffix;
      } while (seen.has(candidate.toLowerCase()));
      name = candidate;
    }
    seen.add(name.toLowerCase());
    if (name !== original) {
      setAttr(entry.node, 'name', name);
      addFinding(ctx, 'XLSX_SHEET_RENAMED', ctx.main, { from: original, to: name });
      changed = true;
    }
  }
  if (changed) touch(ctx, ctx.main);

  const sstPath = sstPathOf(ctx, entries.rels);
  let total = 0;
  if (sstPath) {
    const sstTree = getTree(ctx, sstPath);
    const sstRoot = sstTree ? documentElement(sstTree) : null;
    if (sstRoot) total = elementChildren(sstRoot, 'si').length;
  }

  for (const entry of kept) {
    const part = entry.part;
    const text = part.text;
    if (typeof text !== 'string') continue;
    const bad = text.includes('t="s"') ? countInvalidSharedRefs(text, total) : 0;
    const repaired = part.repairedXml || part.state === 'partial' || part.state === 'crcMismatch';
    const removeDimension = repaired || bad > 0;
    const hasDimension = text.includes('dimension');
    const hasDrawing = /<(?:[A-Za-z0-9]+:)?(?:legacyD|d)rawing[\s/>]/.test(text);
    if (bad === 0 && !hasDrawing && !(removeDimension && hasDimension)) continue;
    const scanned = scan(text);
    const sheetRoot = scanned.tokens.find((t) => t.t === 'open');
    const sheetPrefixes = relPrefixSet(sheetRoot ? { attrs: sheetRoot.attrs } : null);
    const defined = definedRelIds(ctx, entry.path);
    const edit = editSheet(scanned.tokens, total, defined, sheetPrefixes, removeDimension);
    if (edit.cleared === 0 && edit.drawings === 0 && !edit.dimension) continue;
    setText(ctx, entry.path, serializeTokens(edit.tokens));
    if (edit.cleared > 0) addFinding(ctx, 'XLSX_CELL_CLEARED', entry.path, { n: edit.cleared });
    if (edit.drawings > 0) addFinding(ctx, 'XLSX_DRAWING_REMOVED', entry.path, { n: edit.drawings });
    if (edit.dimension) addFinding(ctx, 'XLSX_DIMENSION_REMOVED', entry.path);
  }
  return {};
}

export function normalizeXlsx(ctx) {
  const { path: relsPath, tree: relsTree } = relsTreeFor(ctx, ctx.main);
  const rels = relsTree ? readRelationships(relsTree) : [];
  const calcRel = rels.find((r) => r.type.endsWith('/calcChain') && !r.external);
  const calcPath = ctx.index.canonical(calcRel ? resolveTarget(ctx.main, calcRel.target) : `${mainFolderOf(ctx.main)}/calcChain.xml`);
  if (calcPath) {
    if (relsTree) {
      let touched = false;
      for (const rel of rels) {
        if (!rel.external && resolveTarget(ctx.main, rel.target).toLowerCase() === calcPath.toLowerCase()) {
          removeNode(rel.node);
          touched = true;
        }
      }
      if (touched) touch(ctx, relsPath);
    }
    removePart(ctx, calcPath);
    ctx.silentParts.add(calcPath.toLowerCase());
    addFinding(ctx, 'XLSX_CALCCHAIN_REMOVED', calcPath);
  }
  removePivotTables(ctx);
  clearStyleReferences(ctx, rels);
  const sstPath = sstPathOf(ctx, rels);
  if (sstPath) {
    const sstTree = getTree(ctx, sstPath);
    const sstRoot = sstTree ? documentElement(sstTree) : null;
    if (sstRoot) {
      const total = elementChildren(sstRoot, 'si').length;
      if (getAttr(sstRoot, 'uniqueCount') !== String(total) || getAttr(sstRoot, 'count') !== null) {
        setAttr(sstRoot, 'uniqueCount', String(total));
        removeAttr(sstRoot, 'count');
        touch(ctx, sstPath);
        addFinding(ctx, 'XLSX_SST_COUNTS', sstPath, { n: total });
      }
    }
  }
}

const SHEET_STYLE_RULES = [
  ['c', 's'],
  ['row', 's'],
  ['col', 'style']
];

const SHEET_FORMAT_RULES = [['cfRule', 'dxfId']];

const TABLE_FORMAT_RULES = [
  ['tableColumn', 'dataDxfId'],
  ['tableColumn', 'headerRowDxfId'],
  ['tableColumn', 'totalsRowDxfId'],
  ['table', 'dataDxfId'],
  ['table', 'headerRowDxfId'],
  ['table', 'totalsRowDxfId'],
  ['table', 'headerRowBorderDxfId'],
  ['table', 'tableBorderDxfId'],
  ['table', 'totalsRowBorderDxfId']
];

const XF_RULES = [
  ['fontId', 'fonts'],
  ['fillId', 'fills'],
  ['borderId', 'borders']
];

function styleLimits(ctx, rels) {
  const stylesRel = rels.find((r) => r.type.endsWith('/styles') && !r.external);
  const path = stylesRel ? ctx.index.canonical(resolveTarget(ctx.main, stylesRel.target)) : null;
  const tree = path ? getTree(ctx, path) : null;
  const root = tree ? documentElement(tree) : null;
  const size = (list, child) => {
    const node = root ? elementChildren(root, list)[0] : null;
    return node ? elementChildren(node, child).length : null;
  };
  return {
    path,
    root,
    cellXfs: size('cellXfs', 'xf') || 0,
    dxfs: size('dxfs', 'dxf') || 0,
    fonts: size('fonts', 'font'),
    fills: size('fills', 'fill'),
    borders: size('borders', 'border'),
    cellStyleXfs: size('cellStyleXfs', 'xf')
  };
}

function clearAttributes(text, rules, limit) {
  let cleared = 0;
  let edited = text;
  for (const [tag, attr] of rules) {
    const startTag = new RegExp(`<(?:[A-Za-z0-9]+:)?${tag}(?=[\\s/>])[^>]*>`, 'g');
    const attribute = new RegExp(`(\\s)${attr}="(\\d+)"`);
    edited = edited.replace(startTag, (match) => {
      const found = attribute.exec(match);
      if (!found || Number(found[2]) < limit) return match;
      cleared++;
      return match.replace(attribute, '');
    });
  }
  return { edited, cleared };
}

function scanFormatLists(ctx, limits, apply) {
  if (!limits.root) return 0;
  let found = 0;
  for (const listName of ['cellXfs', 'cellStyleXfs']) {
    const list = elementChildren(limits.root, listName)[0];
    if (!list) continue;
    for (const xf of elementChildren(list, 'xf')) {
      const rules = listName === 'cellXfs' ? [...XF_RULES, ['xfId', 'cellStyleXfs']] : XF_RULES;
      for (const [attr, key] of rules) {
        const limit = limits[key];
        const raw = getAttr(xf, attr);
        if (limit === null || raw === null || !/^\d+$/.test(raw) || Number(raw) < limit) continue;
        found++;
        if (apply) removeAttr(xf, attr);
      }
    }
  }
  if (apply && found > 0) {
    touch(ctx, limits.path);
    addFinding(ctx, 'XLSX_STYLE_INDEX_CLEARED', limits.path, { n: found });
  }
  return found;
}

function scanStyleIndexes(ctx, rels, apply) {
  const limits = styleLimits(ctx, rels);
  let total = scanFormatLists(ctx, limits, apply);
  for (const name of ctx.parts.keys()) {
    const sheet = /(^|\/)worksheets\/[^/]+\.xml$/i.test(name);
    const table = /(^|\/)tables\/[^/]+\.xml$/i.test(name);
    if (!sheet && !table) continue;
    const part = ctx.parts.get(name);
    if (typeof part.text !== 'string') continue;
    let text = part.text;
    let styles = 0;
    let formats = 0;
    if (sheet) {
      const cells = clearAttributes(text, SHEET_STYLE_RULES, limits.cellXfs);
      const conditional = clearAttributes(cells.edited, SHEET_FORMAT_RULES, limits.dxfs);
      styles = cells.cleared;
      formats = conditional.cleared;
      text = conditional.edited;
    } else {
      const columns = clearAttributes(text, TABLE_FORMAT_RULES, limits.dxfs);
      formats = columns.cleared;
      text = columns.edited;
    }
    total += styles + formats;
    if (!apply || styles + formats === 0) continue;
    setText(ctx, name, text);
    if (styles > 0) addFinding(ctx, 'XLSX_STYLE_CLEARED', name, { n: styles });
    if (formats > 0) addFinding(ctx, 'XLSX_STYLE_INDEX_CLEARED', name, { n: formats });
  }
  return total;
}

function clearStyleReferences(ctx, rels) {
  scanStyleIndexes(ctx, rels, true);
}

function orphanPivotTables(ctx) {
  const found = [];
  for (const name of ctx.index.names()) {
    if (!/(^|\/)pivotTables\/[^/]+\.xml$/i.test(name)) continue;
    const { tree } = relsTreeFor(ctx, name);
    const rels = tree ? readRelationships(tree) : [];
    const cache = rels.find((r) => r.type.endsWith('/pivotCacheDefinition') && !r.external && ctx.index.has(resolveTarget(name, r.target)));
    if (!cache) found.push(name);
  }
  return found;
}

function removePivotTables(ctx) {
  const orphans = orphanPivotTables(ctx);
  if (orphans.length === 0) return;
  const gone = new Set(orphans.map((name) => name.toLowerCase()));
  for (const relsPath of ctx.index.names()) {
    if (!isRelsPath(relsPath)) continue;
    const source = sourceOfRels(relsPath);
    const tree = source === null ? null : getTree(ctx, relsPath);
    if (!tree) continue;
    let touched = false;
    for (const rel of readRelationships(tree)) {
      if (!rel.external && rel.target && gone.has(resolveTarget(source, rel.target).toLowerCase())) {
        removeNode(rel.node);
        touched = true;
      }
    }
    if (touched) touch(ctx, relsPath);
  }
  for (const name of orphans) {
    const { path: relsPath } = relsTreeFor(ctx, name);
    const ownRels = relsPath ? ctx.index.canonical(relsPath) : null;
    if (ownRels) removePart(ctx, ownRels);
    removePart(ctx, name);
    ctx.silentParts.add(name.toLowerCase());
  }
  addFinding(ctx, 'XLSX_PIVOT_REMOVED', orphans[0], { n: orphans.length });
}

export function xlsxRulesClean(ctx) {
  if (ctx.family !== 'xlsx') return true;
  if (orphanPivotTables(ctx).length > 0) return false;
  const { tree } = relsTreeFor(ctx, ctx.main);
  const rels = tree ? readRelationships(tree) : [];
  return scanStyleIndexes(ctx, rels, false) === 0;
}

registerCheck('familyRules', xlsxRulesClean);
