import test from 'node:test';
import assert from 'node:assert/strict';
import { repairNamespaces } from '../js/core/ns-repair.js';

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

test('namespace repair: valid declarations are returned untouched', () => {
  const text = `<?xml version="1.0"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="urn:x-y"><w:p/></w:document>`;
  const result = repairNamespaces(text);
  assert.equal(result.count, 0);
  assert.equal(result.text, text);
});

test('namespace repair: an empty default declaration is valid and kept', () => {
  const text = '<a xmlns=""><b/></a>';
  assert.equal(repairNamespaces(text).count, 0);
});

test('namespace repair: a default namespace with a space on a package root is restored from the root name', () => {
  const result = repairNamespaces('<Relationships xmlns="hdh eenytp"><Relationship Id="rId1"/></Relationships>');
  assert.equal(result.count, 1);
  assert.equal(result.text, `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1"/></Relationships>`);
});

test('namespace repair: the content types root is restored the same way', () => {
  const result = repairNamespaces('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content types"/>');
  assert.equal(result.text, `<Types xmlns="${CT_NS}"/>`);
});

test('namespace repair: a flipped letter plus a stray quote snaps to the known namespace', () => {
  const result = repairNamespaces('<w:document xmlns:o="iurn:schemas-microsoft-com:office:office&quot;" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>');
  assert.equal(result.count, 1);
  assert.ok(result.text.includes('xmlns:o="urn:schemas-microsoft-com:office:office"'));
  assert.ok(result.text.includes('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'));
});

test('namespace repair: an unknown value loses its illegal characters and keeps the rest', () => {
  const result = repairNamespaces('<root><x xmlns:q="qq zz"/></root>');
  assert.equal(result.count, 1);
  assert.equal(result.text, '<root><x xmlns:q="qqzz"/></root>');
});

test('namespace repair: an empty prefixed declaration is removed', () => {
  const result = repairNamespaces('<root xmlns:w=" "/>');
  assert.equal(result.count, 1);
  assert.equal(result.text, '<root/>');
});

test('namespace repair: text outside tags is left alone', () => {
  const text = '<p>set xmlns:q="a b" here</p>';
  assert.equal(repairNamespaces(text).text, text);
});

test('namespace repair: the result is stable', () => {
  const first = repairNamespaces('<Relationships xmlns="hdh eenytp"/>');
  const second = repairNamespaces(first.text);
  assert.equal(second.count, 0);
  assert.equal(second.text, first.text);
});

test('namespace repair: a distant value is not snapped to a known namespace', () => {
  const result = repairNamespaces('<root><x xmlns:q="http://example.com/some thing/else"/></root>');
  assert.ok(result.text.includes('http://example.com/something/else'));
});
