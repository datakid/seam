import { getTree, addPart, addFinding, relsPathFor, readRelationships, resolveTarget } from './package.js';
import { descendants, getAttr } from './xml-repair.js';
import { MAIN_PARTS } from './constants.js';
import { numbered } from './rels-rebuild.js';

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_PRES = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_DRAW = 'http://schemas.openxmlformats.org/drawingml/2006/main';

const numberOf = (path) => Number(/(\d+)\.xml$/i.exec(path)[1]);

function relatedIds(ctx, main, suffix) {
  const name = ctx.index.canonical(relsPathFor(main));
  const tree = name ? getTree(ctx, name) : null;
  if (!tree) return new Map();
  const found = new Map();
  for (const rel of readRelationships(tree)) {
    if (!rel.id || rel.external || !rel.type.endsWith(suffix)) continue;
    const target = ctx.index.canonical(resolveTarget(main, rel.target));
    if (target && !found.has(target)) found.set(target, rel.id);
  }
  return found;
}

function xlsxMain(ctx) {
  const sheets = numbered(ctx, /^xl\/worksheets\/sheet(\d+)\.xml$/i);
  if (sheets.length === 0) return false;
  const known = relatedIds(ctx, MAIN_PARTS.xlsx, '/worksheet');
  const items = sheets.map((path, at) => `<sheet name="Sheet${numberOf(path)}" sheetId="${numberOf(path)}" r:id="${known.get(path) || `rId${at + 1}`}"/>`);
  addPart(ctx, MAIN_PARTS.xlsx, `${DECL}<workbook xmlns="${NS_SHEET}" xmlns:r="${NS_R}"><sheets>${items.join('')}</sheets></workbook>`);
  addFinding(ctx, 'XLSX_WORKBOOK_REBUILT', MAIN_PARTS.xlsx, { n: sheets.length });
  return true;
}

function extentsOf(ctx, names) {
  let right = 0;
  let bottom = 0;
  for (const name of names) {
    const part = ctx.parts.get(name);
    if (!part || typeof part.text !== 'string') continue;
    for (const match of part.text.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/g)) {
      right = Math.max(right, Number(match[1]) + Number(match[3]));
      bottom = Math.max(bottom, Number(match[2]) + Number(match[4]));
    }
  }
  return { right, bottom };
}

function slideSize(ctx, names) {
  const { right, bottom } = extentsOf(ctx, names);
  if (right > 9500000) return [12192000, 6858000];
  if (right > 0 && bottom > 0 && bottom <= 5200000) return [9144000, 5143500];
  return [9144000, 6858000];
}

function pptxMain(ctx) {
  const masters = numbered(ctx, /^ppt\/slideMasters\/slideMaster(\d+)\.xml$/i);
  if (masters.length === 0) return false;
  const layouts = numbered(ctx, /^ppt\/slideLayouts\/slideLayout(\d+)\.xml$/i);
  const slides = numbered(ctx, /^ppt\/slides\/slide(\d+)\.xml$/i);
  const knownMasters = relatedIds(ctx, MAIN_PARTS.pptx, '/slideMaster');
  const knownSlides = relatedIds(ctx, MAIN_PARTS.pptx, '/slide');
  let highest = 2147483647;
  for (const master of masters) {
    const tree = getTree(ctx, master);
    if (!tree) continue;
    for (const node of descendants(tree, 'sldLayoutId')) {
      const value = Number(getAttr(node, 'id'));
      if (Number.isInteger(value)) highest = Math.max(highest, value);
    }
  }
  const masterItems = masters.map((path, at) => `<p:sldMasterId id="${highest + at + 1}" r:id="${knownMasters.get(path) || `rId${at + 1}`}"/>`);
  const slideItems = slides.map((path, at) => `<p:sldId id="${256 + at}" r:id="${knownSlides.get(path) || `rId${masters.length + at + 1}`}"/>`);
  const [cx, cy] = slideSize(ctx, [...masters, ...layouts]);
  const list = slideItems.length > 0 ? `<p:sldIdLst>${slideItems.join('')}</p:sldIdLst>` : '';
  const text = `${DECL}<p:presentation xmlns:a="${NS_DRAW}" xmlns:r="${NS_R}" xmlns:p="${NS_PRES}"><p:sldMasterIdLst>${masterItems.join('')}</p:sldMasterIdLst>${list}<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  addPart(ctx, MAIN_PARTS.pptx, text);
  addFinding(ctx, 'PPTX_PRESENTATION_REBUILT', MAIN_PARTS.pptx, { n: slides.length, cx, cy });
  return true;
}

export function synthesizeMain(ctx) {
  if (ctx.main || !ctx.family) return false;
  const made = ctx.family === 'xlsx' ? xlsxMain(ctx) : ctx.family === 'pptx' ? pptxMain(ctx) : false;
  if (made) ctx.main = ctx.index.canonical(MAIN_PARTS[ctx.family]);
  return made;
}
