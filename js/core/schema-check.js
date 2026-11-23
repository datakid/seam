import { parseTree } from './xml-repair.js';
import { checkTree } from './schema-fit.js';
import { openedTable } from './schema-fill.js';
import { registerCheck } from './tiers.js';

export const PART_LIMIT = 8 * 1024 * 1024;
export const TOTAL_LIMIT = 32 * 1024 * 1024;

let loading = null;

export function loadSchemaTable(env) {
  if (env && env.schemaTable !== undefined) return Promise.resolve(env.schemaTable);
  if (!loading) loading = import('./data/schema-lite.js').then((module) => module.SCHEMA_LITE, () => null);
  return loading;
}

export function packageFits(ctx, source) {
  if (!source || !source.elements) return false;
  const table = openedTable(source);
  let total = 0;
  for (const part of ctx.parts.values()) {
    if (!part.isXml || typeof part.text !== 'string') continue;
    total += part.text.length;
    if (part.text.length > PART_LIMIT || total > TOTAL_LIMIT) return false;
    let tree;
    try {
      tree = parseTree(part.text);
    } catch {
      return false;
    }
    if (checkTree(table, tree, 1).findings.length > 0) return false;
  }
  return true;
}

registerCheck('schemaLite', (ctx) => packageFits(ctx, ctx.schemaTable));
