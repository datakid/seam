import { MAIN_PARTS } from './constants.js';
import { isRelsPath, sourceOfRels, referencedParts } from './package.js';

const BORROWABLE = [
  /^word\/(styles|stylesWithEffects|numbering|fontTable|settings|webSettings)\.xml$/i,
  /^word\/theme\/theme\d*\.xml$/i,
  /^xl\/styles\.xml$/i,
  /^xl\/theme\/theme\d*\.xml$/i,
  /^ppt\/(tableStyles|presProps|viewProps)\.xml$/i,
  /^ppt\/theme\/theme\d*\.xml$/i,
  /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i,
  /^ppt\/slideMasters\/slideMaster\d+\.xml$/i,
  /^ppt\/slideLayouts\/_rels\/slideLayout\d+\.xml\.rels$/i,
  /^ppt\/slideMasters\/_rels\/slideMaster\d+\.xml\.rels$/i
];

export function isBorrowable(name) {
  return BORROWABLE.some((pattern) => pattern.test(name));
}

export function familyOfNames(names) {
  const lower = new Set(names.map((name) => name.toLowerCase()));
  for (const [family, main] of Object.entries(MAIN_PARTS)) if (lower.has(main)) return family;
  return null;
}

export function wantedFromDonor(ctx, donorEntries, taken) {
  const referenced = referencedParts(ctx);
  const wanted = [];
  for (const entry of donorEntries) {
    const key = entry.name.toLowerCase();
    if (taken.has(key) || !isBorrowable(entry.name)) continue;
    const have = ctx.index.canonical(entry.name);
    const mine = have ? ctx.parts.get(have) : null;
    if (mine && mine.state === 'ok') continue;
    const source = isRelsPath(entry.name) ? sourceOfRels(entry.name) : null;
    const needed = isRelsPath(entry.name) ? source !== null && ctx.index.has(source) : referenced.has(key);
    if (needed) wanted.push(entry);
  }
  return wanted;
}
