import { SIG } from './constants.js';

const FULL_SCAN_LIMIT = 64 * 1024 * 1024;

function utf16le(text) {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    out[i * 2] = text.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = text.charCodeAt(i) >> 8;
  }
  return out;
}

export function indexOfBytes(bytes, pattern, from = 0, to = bytes.length) {
  const first = pattern[0];
  const last = to - pattern.length;
  let i = bytes.indexOf(first, from);
  while (i !== -1 && i <= last) {
    let match = true;
    for (let k = 1; k < pattern.length; k++) {
      if (bytes[i + k] !== pattern[k]) {
        match = false;
        break;
      }
    }
    if (match) return i;
    i = bytes.indexOf(first, i + 1);
  }
  return -1;
}

export function startsWith(bytes, pattern, at = 0) {
  if (bytes.length < at + pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) if (bytes[at + i] !== pattern[i]) return false;
  return true;
}

function isAllZero(bytes) {
  const n = bytes.length;
  if (n <= FULL_SCAN_LIMIT) {
    for (let i = 0; i < n; i++) if (bytes[i] !== 0) return false;
    return true;
  }
  const samples = 4096;
  for (let k = 0; k < samples; k++) {
    if (bytes[Math.floor((k * (n - 1)) / (samples - 1))] !== 0) return false;
  }
  return true;
}

function latin1(bytes, from, to) {
  let out = '';
  const end = Math.min(to, bytes.length);
  for (let i = from; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function skipLeading(bytes) {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return i;
}

const ENC = utf16le('EncryptedPackage');
const WORD = utf16le('WordDocument');
const WORKBOOK = utf16le('Workbook');
const BOOK = utf16le('Book');
const POWERPOINT = utf16le('PowerPoint Document');

export function identify(bytes) {
  const n = bytes.length;
  if (n === 0 || isAllZero(bytes)) return { kind: 'EMPTY' };

  if (startsWith(bytes, SIG.CFB)) {
    if (indexOfBytes(bytes, ENC) !== -1) return { kind: 'ENCRYPTED_OOXML' };
    if (indexOfBytes(bytes, WORD) !== -1) return { kind: 'LEGACY_DOC', ext: '.doc' };
    if (indexOfBytes(bytes, WORKBOOK) !== -1 || indexOfBytes(bytes, BOOK) !== -1) return { kind: 'LEGACY_XLS', ext: '.xls' };
    if (indexOfBytes(bytes, POWERPOINT) !== -1) return { kind: 'LEGACY_PPT', ext: '.ppt' };
    return { kind: 'CFB_UNKNOWN' };
  }

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const a = bytes[2];
    const b = bytes[3];
    if ((a === 3 && b === 4) || (a === 5 && b === 6) || (a === 7 && b === 8)) return { kind: 'ZIP', prefix: 0 };
  }

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: 'PDF', type: 'PDF' };
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return { kind: 'RTF', type: 'RTF' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { kind: 'IMAGE', type: 'PNG' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'IMAGE', type: 'JPEG' };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: 'IMAGE', type: 'GIF' };

  const lead = skipLeading(bytes);
  const head = latin1(bytes, lead, lead + 512).toLowerCase();
  if (head.startsWith('<html') || head.startsWith('<!doctype html')) {
    const packageAt = indexOfBytes(bytes, SIG.LOCAL, 0, Math.min(n, 1024 * 1024));
    if (packageAt > 0) return { kind: 'ZIP', prefix: packageAt, prefixGarbage: packageAt };
    return { kind: 'HTML', type: 'HTML' };
  }
  if (head.startsWith('<?xml')) {
    const probe = latin1(bytes, lead, lead + 16384);
    if (probe.includes('<w:document') || probe.includes('pkg:package')) return { kind: 'FLAT_OPC_XML' };
  }

  const prefixAt = indexOfBytes(bytes, SIG.LOCAL, 0, Math.min(n, 1024 * 1024));
  if (prefixAt > 0) return { kind: 'ZIP', prefix: prefixAt, prefixGarbage: prefixAt };

  const localAt = indexOfBytes(bytes, SIG.LOCAL);
  const centralAt = indexOfBytes(bytes, SIG.CENTRAL);
  if (localAt !== -1 || centralAt !== -1) return { kind: 'ZIP', prefix: 0, damagedStart: true };

  return { kind: 'UNKNOWN' };
}

export const CHIPS = {
  EMPTY: 'EMPTY',
  ENCRYPTED_OOXML: 'CFB',
  LEGACY_DOC: 'DOC',
  LEGACY_XLS: 'XLS',
  LEGACY_PPT: 'PPT',
  CFB_UNKNOWN: 'CFB',
  PDF: 'PDF',
  RTF: 'RTF',
  HTML: 'HTML',
  IMAGE: 'IMAGE',
  FLAT_OPC_XML: 'XML',
  UNKNOWN: 'UNKNOWN',
  ZIP: 'ZIP'
};

export function findTextModeTransfer(bytes) {
  let pairs = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue;
    if (i > 0 && bytes[i - 1] === 0x0d) pairs++;
    else return null;
  }
  return pairs >= 4 ? { pairs } : null;
}

export function removeAddedCarriageReturns(bytes) {
  const out = new Uint8Array(bytes.length);
  let at = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) continue;
    out[at++] = bytes[i];
  }
  return out.slice(0, at);
}
