import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from '../../vendor/fflate.module.js';
import { parseTree } from '../../js/core/xml-repair.js';
import { openTable, checkTree } from '../../js/core/schema-fit.js';

const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_PATTERN = /\.(docx|docm|dotx|dotm|xlsx|xlsm|xltx|xltm|pptx|pptm|potx|potm|ppsx|ppsm)$/i;

function decode(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return new TextDecoder('utf-8').decode(bytes);
}

export function collectDefaults(raw, dir) {
  const table = openTable(raw);
  const seen = new Map();
  let files = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!PACKAGE_PATTERN.test(name)) continue;
    let entries;
    try {
      entries = unzipSync(new Uint8Array(readFileSync(join(dir, name))), { filter: (file) => /\.(xml|vml)$/i.test(file.name) });
    } catch {
      continue;
    }
    files++;
    for (const bytes of Object.values(entries)) {
      let tree;
      try {
        tree = parseTree(decode(bytes));
      } catch {
        continue;
      }
      checkTree(table, tree, Infinity, (entry, attr, value) => {
        if (attr.ns === RELATIONSHIPS_NS || value.length > 64 || /[\r\n]/.test(value)) return;
        let byAttr = seen.get(entry.id);
        if (!byAttr) seen.set(entry.id, (byAttr = new Map()));
        const key = `${attr.ns}|${attr.local}`;
        let counts = byAttr.get(key);
        if (!counts) byAttr.set(key, (counts = new Map()));
        counts.set(value, (counts.get(value) || 0) + 1);
      });
    }
  }
  return { seen, files };
}

export function applyDefaults(raw, collected) {
  let applied = 0;
  raw.types.forEach((row, id) => {
    const byAttr = collected.seen.get(id);
    if (!byAttr || !row[2]) return;
    for (const attr of row[2]) {
      const ns = attr[0] < 0 ? '' : raw.namespaces[attr[0]];
      const counts = byAttr.get(`${ns}|${attr[1]}`);
      if (!counts) continue;
      let best = null;
      let bestCount = 0;
      for (const [value, count] of [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
        best = value;
        bestCount = count;
        break;
      }
      if (best === null || bestCount < 1) continue;
      attr.length = 3;
      attr.push(best);
      applied++;
    }
  });
  return applied;
}
