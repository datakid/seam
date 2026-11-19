import { test, assert, eq, bytesEqual } from './harness.js';
import { deflateSync, strToU8 } from '../vendor/fflate.module.js';
import { crc32 } from '../js/core/crc32.js';
import { recoverEntries, mergeEntries } from '../js/core/zip-recover.js';
import { strictRead } from '../js/core/zip-read.js';
import { pack } from './fixtures.js';
import { localEntry } from './corrupt.js';
import { prng, words } from './fixtures.js';

function put16(out, v) {
  out.push(v & 255, (v >> 8) & 255);
}

function put32(out, v) {
  out.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
}

function put64(out, v) {
  put32(out, v % 4294967296);
  put32(out, Math.floor(v / 4294967296));
}

function localHeader({ name, method, flags = 0, crc, csize, usize, zip64 = false, extraSizes = true }) {
  const nameBytes = strToU8(name);
  const extra = [];
  if (zip64) {
    put16(extra, 1);
    put16(extra, extraSizes ? 16 : 0);
    if (extraSizes) {
      put64(extra, usize);
      put64(extra, csize);
    }
  }
  const head = [];
  put32(head, 0x04034b50);
  put16(head, zip64 ? 45 : 20);
  put16(head, flags);
  put16(head, method);
  put16(head, 0);
  put16(head, 0x21);
  put32(head, crc);
  put32(head, zip64 ? 0xffffffff : csize);
  put32(head, zip64 ? 0xffffffff : usize);
  put16(head, nameBytes.length);
  put16(head, extra.length);
  return Uint8Array.from([...head, ...nameBytes, ...extra]);
}

function join(...parts) {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function sample(seed, size) {
  const rand = prng(seed);
  let text = '';
  while (text.length < size) text += `<w:p><w:r><w:t>${words(Math.floor(rand() * 1e6), 6)}</w:t></w:r></w:p>`;
  return strToU8(text.slice(0, size));
}

test('zip64: a local header with sizes in the extra field is read to its CRC', () => {
  const data = sample(1, 20000);
  const packed = deflateSync(data);
  const header = localHeader({ name: 'a.xml', method: 8, crc: crc32(data), csize: packed.length, usize: data.length, zip64: true });
  const { entries } = recoverEntries(join(header, packed));
  eq(entries.length, 1);
  eq(entries[0].state, 'ok');
  assert(bytesEqual(entries[0].data, data), 'data');
});

test('zip64: a stored entry with zip64 sizes is read', () => {
  const data = sample(2, 5000);
  const header = localHeader({ name: 'a.bin', method: 0, crc: crc32(data), csize: data.length, usize: data.length, zip64: true });
  const { entries } = recoverEntries(join(header, data));
  eq(entries[0].state, 'ok');
  assert(bytesEqual(entries[0].data, data), 'data');
});

test('zip64: a zip64 header followed by another entry reads both', () => {
  const a = sample(3, 12000);
  const b = sample(4, 9000);
  const pa = deflateSync(a);
  const pb = deflateSync(b);
  const bytes = join(
    localHeader({ name: 'a.xml', method: 8, crc: crc32(a), csize: pa.length, usize: a.length, zip64: true }),
    pa,
    localHeader({ name: 'b.xml', method: 8, crc: crc32(b), csize: pb.length, usize: b.length }),
    pb
  );
  const { entries } = recoverEntries(bytes);
  eq(entries.map((e) => e.state).join(','), 'ok,ok');
});

test('zip64: a zip64 header with a damaged stream keeps the exact prefix', () => {
  const data = sample(5, 60000);
  const packed = deflateSync(data);
  const header = localHeader({ name: 'a.xml', method: 8, crc: crc32(data), csize: packed.length, usize: data.length, zip64: true });
  const cut = packed.subarray(0, Math.floor(packed.length * 0.5));
  const { entries } = recoverEntries(join(header, cut));
  eq(entries[0].state, 'partial');
  assert(bytesEqual(entries[0].data, data.subarray(0, entries[0].data.length)), 'prefix');
  assert(entries[0].data.length > 20000, `kept ${entries[0].data.length}`);
});

test('zip64: a descriptor-style zip64 entry takes its size from the 8-byte descriptor', () => {
  const data = sample(6, 30000);
  const packed = deflateSync(data);
  const header = localHeader({ name: 'a.xml', method: 8, flags: 8, crc: 0, csize: 0, usize: 0, zip64: true, extraSizes: false });
  const descriptor = [];
  put32(descriptor, 0x08074b50);
  put32(descriptor, crc32(data));
  put64(descriptor, packed.length);
  put64(descriptor, data.length);
  const { entries } = recoverEntries(join(header, packed, Uint8Array.from(descriptor)));
  eq(entries[0].state, 'ok');
  assert(bytesEqual(entries[0].data, data), 'data');
});

test('zip bounds: a streamed entry with damaged data is bounded by the central directory', () => {
  const data = sample(7, 80000);
  const packed = deflateSync(data);
  const nameBytes = strToU8('a.xml');
  const crc = crc32(data);
  const local = localHeader({ name: 'a.xml', method: 8, flags: 8, crc: 0, csize: 0, usize: 0 });
  const descriptor = [];
  put32(descriptor, 0x08074b50);
  put32(descriptor, crc);
  put32(descriptor, packed.length);
  put32(descriptor, data.length);
  const damagedPacked = packed.slice();
  damagedPacked.fill(0, 5000, 5600);
  const tail = Uint8Array.from(descriptor);
  const body = join(local, damagedPacked, tail);
  const central = [];
  put32(central, 0x02014b50);
  put16(central, 20);
  put16(central, 20);
  put16(central, 8);
  put16(central, 8);
  put16(central, 0);
  put16(central, 0x21);
  put32(central, crc);
  put32(central, packed.length);
  put32(central, data.length);
  put16(central, nameBytes.length);
  put16(central, 0);
  put16(central, 0);
  put16(central, 0);
  put16(central, 0);
  put32(central, 0);
  put32(central, 0);
  const cd = Uint8Array.from([...central, ...nameBytes]);
  const eocd = [];
  put32(eocd, 0x06054b50);
  put16(eocd, 0);
  put16(eocd, 0);
  put16(eocd, 1);
  put16(eocd, 1);
  put32(eocd, cd.length);
  put32(eocd, body.length);
  put16(eocd, 0);
  const bytes = join(body, cd, Uint8Array.from(eocd));
  const strict = strictRead(bytes, 0);
  assert(strict.entries[0].dataStart > 0, 'central entry carries its span');
  const { entries } = recoverEntries(bytes, strict.entries);
  eq(entries[0].state === 'ok' || entries[0].state === 'partial' || entries[0].state === 'crcMismatch', true);
  assert(entries[0].data.length >= 5000, `kept ${entries[0].data.length}`);
  assert(bytesEqual(entries[0].data.subarray(0, 4000), data.subarray(0, 4000)), 'head exact');
});

test('zip selection: two local copies of one name keep the one that matches its checksum', () => {
  const good = sample(8, 15000);
  const stale = sample(9, 15000);
  const bytes = pack([['a.xml', stale]]);
  const second = pack([['a.xml', good]]);
  const { entries } = recoverEntries(join(bytes.subarray(0, localEntry(bytes, 'a.xml').dataStart + localEntry(bytes, 'a.xml').csize), second));
  const merged = mergeEntries([], entries);
  eq(merged.length, 1);
  assert(merged[0].rejected >= 1, 'choice recorded');
});

test('zip selection: the central copy wins a tie and no choice is reported for identical copies', () => {
  const data = sample(10, 9000);
  const zip = pack([['a.xml', data]]);
  const strict = strictRead(zip, 0);
  const recovered = recoverEntries(zip).entries;
  const merged = mergeEntries(strict.entries, recovered);
  eq(merged.length, 1);
  assert(!merged[0].rejected, 'no rejected copy');
  assert(merged[0] === strict.entries[0], 'primary kept');
});

test('zip selection: well-formed XML beats a longer broken copy of the same size class', () => {
  const ok = { name: 'a.xml', state: 'crcMismatch', data: strToU8('<a><b/></a>') };
  const broken = { name: 'a.xml', state: 'crcMismatch', data: strToU8('<a><b></a> and some more text') };
  const merged = mergeEntries([broken], [ok]);
  assert(merged[0] === ok, 'well-formed copy kept');
  eq(merged[0].rejected, 1);
});
