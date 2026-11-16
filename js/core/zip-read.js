import { inflateSync } from '../../vendor/fflate.module.js';
import { crc32 } from './crc32.js';
import { SIG } from './constants.js';
import { startsWith } from './identify.js';

export function decodeName(bytes, utf8) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (utf8) return new TextDecoder('utf-8').decode(bytes);
    let out = '';
    for (const b of bytes) out += String.fromCharCode(b);
    return out;
  }
}

export function validNameBytes(bytes) {
  for (const b of bytes) if (b < 0x20 || b === 0x7f) return false;
  return true;
}

export function normalizeName(raw) {
  let name = raw.split('\\').join('/');
  while (name.startsWith('/')) name = name.slice(1);
  const parts = [];
  for (const part of name.split('/')) {
    if (part === '.' || part === '') {
      if (part === '' && parts.length > 0 && parts[parts.length - 1] !== '') parts.push('');
      continue;
    }
    if (part === '..') return null;
    parts.push(part);
  }
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  const joined = parts.join('/');
  return raw.endsWith('/') || raw.endsWith('\\') ? `${joined}/` : joined;
}

export function dosToDate(time, date) {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = Math.min(12, Math.max(1, (date >> 5) & 0x0f));
  const day = Math.min(31, Math.max(1, date & 0x1f));
  const hour = Math.min(23, (time >> 11) & 0x1f);
  const minute = Math.min(59, (time >> 5) & 0x3f);
  const second = Math.min(59, (time & 0x1f) * 2);
  const value = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(value.getTime()) ? null : value;
}

function u16(bytes, at) {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function u64(bytes, at) {
  return u32(bytes, at) + u32(bytes, at + 4) * 4294967296;
}

export function findEocdPosition(bytes) {
  const n = bytes.length;
  const lowest = Math.max(0, n - 65557);
  for (let i = n - 22; i >= lowest; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  return -1;
}

function zip64Extra(bytes, start, length, needs) {
  let at = start;
  const end = start + length;
  while (at + 4 <= end) {
    const id = u16(bytes, at);
    const size = u16(bytes, at + 2);
    if (id === 0x0001) {
      let p = at + 4;
      const out = {};
      if (needs.usize) {
        out.usize = u64(bytes, p);
        p += 8;
      }
      if (needs.csize) {
        out.csize = u64(bytes, p);
        p += 8;
      }
      if (needs.lho) {
        out.lho = u64(bytes, p);
      }
      return out;
    }
    at += 4 + size;
  }
  return {};
}

export function inflateEntry(slice, method) {
  if (method === 0) return slice;
  return inflateSync(slice);
}

export function strictRead(bytes, prefix = 0) {
  const n = bytes.length;
  const result = { intact: false, entries: [], dropped: [], eocdFound: false, errors: [] };
  const eocd = findEocdPosition(bytes);
  if (eocd === -1) {
    result.errors.push('NO_EOCD');
    return result;
  }
  result.eocdFound = true;
  let total = u16(bytes, eocd + 10);
  let cdSize = u32(bytes, eocd + 12);
  let cdOffset = u32(bytes, eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && startsWith(bytes, SIG.ZIP64_LOCATOR, locator)) {
      const z = u64(bytes, locator + 8) + prefix;
      if (startsWith(bytes, SIG.ZIP64_EOCD, z)) {
        total = u64(bytes, z + 32);
        cdSize = u64(bytes, z + 40);
        cdOffset = u64(bytes, z + 48);
      }
    }
  }
  let shift = prefix;
  const terminal = eocd + 22 + u16(bytes, eocd + 20) >= n;
  if (!startsWith(bytes, SIG.CENTRAL, cdOffset + shift)) {
    const alt = eocd - cdSize;
    if (terminal && alt >= 0 && startsWith(bytes, SIG.CENTRAL, alt)) shift = alt - cdOffset;
    else if (total > 0) {
      result.errors.push('BAD_CD');
      return result;
    }
  }
  let pos = cdOffset + shift;
  let parsed = 0;
  for (let k = 0; k < total; k++) {
    if (pos + 46 > n || !startsWith(bytes, SIG.CENTRAL, pos)) {
      result.errors.push('BAD_CD_ENTRY');
      break;
    }
    const flags = u16(bytes, pos + 8);
    const method = u16(bytes, pos + 10);
    const time = u16(bytes, pos + 12);
    const date = u16(bytes, pos + 14);
    const crc = u32(bytes, pos + 16);
    let csize = u32(bytes, pos + 20);
    let usize = u32(bytes, pos + 24);
    const nlen = u16(bytes, pos + 28);
    const elen = u16(bytes, pos + 30);
    const clen = u16(bytes, pos + 32);
    let lho = u32(bytes, pos + 42);
    const nameBytes = bytes.subarray(pos + 46, pos + 46 + nlen);
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) {
      const extra = zip64Extra(bytes, pos + 46 + nlen, elen, { usize: usize === 0xffffffff, csize: csize === 0xffffffff, lho: lho === 0xffffffff });
      if (extra.usize !== undefined) usize = extra.usize;
      if (extra.csize !== undefined) csize = extra.csize;
      if (extra.lho !== undefined) lho = extra.lho;
    }
    pos += 46 + nlen + elen + clen;
    parsed++;
    const rawName = decodeName(nameBytes, (flags & 0x800) !== 0);
    const name = normalizeName(rawName);
    if (name === null) result.dropped.push(rawName);
    if (name === null || name === '' || name.endsWith('/')) continue;
    const entry = { name, method, mtime: dosToDate(time, date), crc, expectedSize: usize, state: 'unreadable', data: new Uint8Array(0) };
    result.entries.push(entry);
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) {
      entry.state = 'unsupported';
      continue;
    }
    const at = lho + shift;
    if (at + 30 > n || !startsWith(bytes, SIG.LOCAL, at)) {
      result.errors.push('BAD_LOCAL');
      continue;
    }
    const lnlen = u16(bytes, at + 26);
    const lelen = u16(bytes, at + 28);
    const localName = bytes.subarray(at + 30, at + 30 + lnlen);
    if (lnlen !== nlen || !localName.every((b, idx) => b === nameBytes[idx])) {
      result.errors.push('NAME_MISMATCH');
      continue;
    }
    const dataStart = at + 30 + lnlen + lelen;
    if (dataStart + csize > n) {
      result.errors.push('SHORT_DATA');
      continue;
    }
    const slice = bytes.subarray(dataStart, dataStart + csize);
    let data;
    try {
      data = inflateEntry(slice, method);
    } catch (error) {
      result.errors.push('INFLATE');
      continue;
    }
    entry.data = data;
    if (crc32(data) === crc && data.length === usize) entry.state = 'ok';
    else {
      entry.state = 'crcMismatch';
      result.errors.push('CRC');
    }
  }
  result.total = total;
  result.parsed = parsed;
  result.shift = shift;
  result.intact = result.errors.length === 0 && parsed === total && result.entries.every((entry) => entry.state === 'ok');
  return result;
}
