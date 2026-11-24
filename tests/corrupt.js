import { strToU8 } from '../vendor/fflate.module.js';
import { pack, unpack, prng, FORMATS, TEXT_PART } from './fixtures.js';

function u32(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

export function eocdAt(bytes) {
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 5 && bytes[i + 3] === 6) return i;
  }
  return -1;
}

export function localEntry(bytes, name) {
  const target = strToU8(name);
  for (let i = 0; i + 30 < bytes.length; i++) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 3 || bytes[i + 3] !== 4) continue;
    const nlen = bytes[i + 26] | (bytes[i + 27] << 8);
    const elen = bytes[i + 28] | (bytes[i + 29] << 8);
    if (nlen !== target.length) continue;
    let same = true;
    for (let k = 0; k < nlen; k++) if (bytes[i + 30 + k] !== target[k]) same = false;
    if (same) return { header: i, dataStart: i + 30 + nlen + elen, csize: u32(bytes, i + 18), usize: u32(bytes, i + 22) };
  }
  return null;
}

function edit(bytes, change) {
  return pack(change(unpack(bytes)));
}

function textOf(entries, name) {
  const found = entries.find(([n]) => n === name);
  return new TextDecoder().decode(found[1]);
}

function replaceEntry(entries, name, content) {
  return entries.map(([n, data]) => (n === name ? [n, typeof content === 'string' ? strToU8(content) : content] : [n, data]));
}

export function truncate(bytes, fraction) {
  return bytes.slice(0, Math.floor(bytes.length * fraction));
}

export function deleteDirectory(bytes) {
  const eocd = eocdAt(bytes);
  return bytes.slice(0, u32(bytes, eocd + 16));
}

export function prefixRandom(bytes, seed = 5, count = 512) {
  const rand = prng(seed);
  const prefix = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const b = Math.floor(rand() * 256);
    prefix[i] = b === 0x50 ? 0x51 : b;
  }
  const out = new Uint8Array(count + bytes.length);
  out.set(prefix, 0);
  out.set(bytes, count);
  return out;
}

export function removeEntry(bytes, name) {
  return edit(bytes, (entries) => entries.filter(([n]) => n !== name));
}

export function injectChars(bytes, fmt) {
  const part = TEXT_PART[fmt];
  const marker = { docx: '<w:t>', xlsx: '<f>', pptx: '<a:t>' }[fmt];
  const insert = fmt === 'xlsx' ? '&\x01\x0B' : 'A & B\x01\x0B';
  return edit(bytes, (entries) => {
    const text = textOf(entries, part);
    const at = text.indexOf(marker) + marker.length;
    return replaceEntry(entries, part, text.slice(0, at) + insert + text.slice(at));
  });
}

export function cutMidTag(bytes, fmt, fraction = 0.8) {
  const part = FORMATS[fmt].main;
  return edit(bytes, (entries) => {
    const text = textOf(entries, part);
    const idx = text.lastIndexOf('<', Math.floor(text.length * fraction));
    return replaceEntry(entries, part, text.slice(0, idx + 3));
  });
}

export function badSharedString(bytes) {
  return edit(bytes, (entries) => {
    const part = 'xl/worksheets/sheet1.xml';
    const text = textOf(entries, part).replace('<c r="A1" t="s"><v>0</v>', '<c r="A1" t="s"><v>999</v>');
    return replaceEntry(entries, part, text);
  });
}

export function flipBytes(bytes, fmt, count = 64) {
  const info = localEntry(bytes, TEXT_PART[fmt]);
  const out = bytes.slice();
  const start = info.dataStart + Math.floor(info.csize / 2) - Math.floor(count / 2);
  for (let i = 0; i < count; i++) out[start + i] ^= 0xff;
  return out;
}

export function zeroMain(bytes, fmt) {
  const part = FORMATS[fmt].main;
  return edit(bytes, (entries) => replaceEntry(entries, part, new Uint8Array(entries.find(([n]) => n === part)[1].length)));
}

export function hollowMain(bytes, fmt) {
  const part = FORMATS[fmt].main;
  return edit(bytes, (entries) => replaceEntry(entries, part, new TextEncoder().encode('<?xml version="1.0"?><notes/>')));
}

export function zeroFill(bytes) {
  return new Uint8Array(bytes.length);
}

export function utf16Part(bytes, fmt) {
  const part = TEXT_PART[fmt];
  return edit(bytes, (entries) => {
    const text = textOf(entries, part).replace('encoding="UTF-8"', 'encoding="UTF-16"');
    const out = new Uint8Array(2 + text.length * 2);
    out[0] = 0xff;
    out[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      out[2 + i * 2] = text.charCodeAt(i) & 0xff;
      out[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    return replaceEntry(entries, part, out);
  });
}

export function encryptedHeader() {
  const name = 'EncryptedPackage';
  const out = new Uint8Array(8 + 600 + name.length * 2 + 200);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  for (let i = 0; i < name.length; i++) out[608 + i * 2] = name.charCodeAt(i);
  return out;
}

export const CORRUPTORS = [
  { id: 'C1-50', fmts: ['docx', 'xlsx', 'pptx'], apply: (b) => truncate(b, 0.5) },
  { id: 'C1-75', fmts: ['docx', 'xlsx', 'pptx'], apply: (b) => truncate(b, 0.75) },
  { id: 'C1-90', fmts: ['docx', 'xlsx', 'pptx'], apply: (b) => truncate(b, 0.9) },
  { id: 'C1-99', fmts: ['docx', 'xlsx', 'pptx'], apply: (b) => truncate(b, 0.99) },
  { id: 'C2', fmts: ['docx', 'xlsx', 'pptx'], apply: (b) => deleteDirectory(b) },
  { id: 'C3', fmts: ['docx', 'xlsx', 'pptx'], apply: (b) => prefixRandom(b) },
  { id: 'C4', fmts: ['docx', 'xlsx', 'pptx'], apply: (b) => removeEntry(b, '[Content_Types].xml') },
  { id: 'C5', fmts: ['docx', 'xlsx', 'pptx'], apply: (b) => removeEntry(b, '_rels/.rels') },
  { id: 'C6', fmts: ['docx', 'xlsx', 'pptx'], apply: (b, f) => injectChars(b, f) },
  { id: 'C7', fmts: ['docx', 'xlsx', 'pptx'], apply: (b, f) => cutMidTag(b, f) },
  { id: 'C8', fmts: ['docx', 'pptx'], apply: (b, f) => removeEntry(b, FORMATS[f].image) },
  { id: 'C9', fmts: ['xlsx'], apply: (b) => badSharedString(b) },
  { id: 'C10', fmts: ['xlsx'], apply: (b) => removeEntry(b, 'xl/worksheets/sheet2.xml') },
  { id: 'C11', fmts: ['docx', 'xlsx', 'pptx'], apply: (b, f) => flipBytes(b, f) },
  { id: 'C12', fmts: ['docx', 'xlsx', 'pptx'], apply: (b, f) => zeroMain(b, f) },
  { id: 'C18', fmts: ['docx', 'xlsx', 'pptx'], apply: (b, f) => utf16Part(b, f) }
];

