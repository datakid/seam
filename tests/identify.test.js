import { test, assert, eq, env } from './harness.js';
import { identify } from '../js/core/identify.js';
import { runPipeline } from '../js/core/pipeline.js';
import { docx, randomBytes } from './fixtures.js';

const utf16 = (s) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) out[i * 2] = s.charCodeAt(i);
  return out;
};

function cfb(...names) {
  const header = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const parts = [header, new Uint8Array(600), ...names.map(utf16), new Uint8Array(200)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const ascii = (s) => new TextEncoder().encode(s);

test('identify: empty and zero-filled files are EMPTY', () => {
  eq(identify(new Uint8Array(0)).kind, 'EMPTY');
  eq(identify(new Uint8Array(5000)).kind, 'EMPTY');
});

test('identify: CFB variants', () => {
  eq(identify(cfb('EncryptedPackage')).kind, 'ENCRYPTED_OOXML');
  eq(identify(cfb('WordDocument')).kind, 'LEGACY_DOC');
  eq(identify(cfb('Workbook')).kind, 'LEGACY_XLS');
  eq(identify(cfb('Book')).kind, 'LEGACY_XLS');
  eq(identify(cfb('PowerPoint Document')).kind, 'LEGACY_PPT');
  eq(identify(cfb('Something')).kind, 'CFB_UNKNOWN');
});

test('identify: other types by signature', () => {
  eq(identify(ascii('%PDF-1.7 body')).kind, 'PDF');
  eq(identify(ascii('{\\rtf1 hello')).kind, 'RTF');
  eq(identify(ascii('  <!DOCTYPE html><html></html>')).kind, 'HTML');
  eq(identify(ascii('<HTML><body></body></HTML>')).kind, 'HTML');
  eq(identify(ascii('<?xml version="1.0"?><pkg:package xmlns:pkg="x"></pkg:package>')).kind, 'FLAT_OPC_XML');
  eq(identify(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])).kind, 'IMAGE');
  eq(identify(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1])).kind, 'IMAGE');
  eq(identify(ascii('GIF89a....')).kind, 'IMAGE');
  eq(identify(ascii('plain words with no structure')).kind, 'UNKNOWN');
});

test('identify: ZIP signatures, prefix data and damaged start', () => {
  const zip = docx();
  eq(identify(zip), { kind: 'ZIP', prefix: 0 });
  const prefixed = new Uint8Array(512 + zip.length);
  prefixed.set(randomBytes(3, 512).map((b) => (b === 0x50 ? 0x51 : b)), 0);
  prefixed.set(zip, 512);
  const found = identify(prefixed);
  eq(found.kind, 'ZIP');
  eq(found.prefixGarbage, 512);
  const damaged = zip.slice();
  damaged.fill(0, 0, 8);
  eq(identify(damaged).kind, 'ZIP');
  eq(identify(Uint8Array.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).kind, 'ZIP');
});

test('C13: whole file zero-filled is Not supported with EMPTY', async () => {
  const result = await runPipeline({ name: 'Zeroes.docx', size: 4000, buffer: new Uint8Array(4000).buffer }, env);
  eq(result.outcome, 'notSupported');
  eq(result.detected.kind, 'EMPTY');
  assert(result.output === null, 'no output');
  assert(result.sentence.startsWith('The file contains no data.'), 'sentence');
});

test('C14: CFB header with EncryptedPackage is Not supported with ENCRYPTED_OOXML', async () => {
  const bytes = cfb('EncryptedPackage');
  const result = await runPipeline({ name: 'Locked.xlsx', size: bytes.length, buffer: bytes.buffer }, env);
  eq(result.outcome, 'notSupported');
  eq(result.detected.kind, 'ENCRYPTED_OOXML');
  assert(result.sentence.includes('password-protected'), 'sentence');
});

test('legacy binary files name the real extension', async () => {
  const bytes = cfb('WordDocument');
  const result = await runPipeline({ name: 'Old.docx', size: bytes.length, buffer: bytes.buffer }, env);
  eq(result.outcome, 'notSupported');
  assert(result.sentence.includes('(.doc)'), 'legacy sentence');
});
