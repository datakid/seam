import { MAIN_PARTS } from './constants.js';
import { isRelsPath, sourceOfRels, referencedParts } from './package.js';
import { isBorrowable as registryBorrowable, hasBorrowableRels } from './registry.js';

export function isBorrowable(name) {
  if (isRelsPath(name)) {
    const source = sourceOfRels(name);
    return source !== null && hasBorrowableRels(source);
  }
  return registryBorrowable(name);
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
