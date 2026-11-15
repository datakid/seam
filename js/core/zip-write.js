import { zipSync } from '../../vendor/fflate.module.js';
import { STORED_EXTENSIONS } from './constants.js';

function usableDate(date) {
  if (!date || Number.isNaN(date.getTime())) return new Date();
  const year = date.getFullYear();
  return year < 1980 || year > 2099 ? new Date() : date;
}

export function orderNames(names) {
  const rest = names.filter((name) => name !== '[Content_Types].xml' && name !== '_rels/.rels');
  const head = [];
  if (names.includes('[Content_Types].xml')) head.push('[Content_Types].xml');
  if (names.includes('_rels/.rels')) head.push('_rels/.rels');
  return [...head, ...rest];
}

export function writeZip(parts) {
  const byName = new Map(parts.map((part) => [part.name, part]));
  const files = {};
  for (const name of orderNames(parts.map((part) => part.name))) {
    const part = byName.get(name);
    const dot = name.lastIndexOf('.');
    const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
    files[name] = [part.data, { level: STORED_EXTENSIONS.includes(ext) ? 0 : 6, mtime: usableDate(part.mtime) }];
  }
  return zipSync(files);
}
