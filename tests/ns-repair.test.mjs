import test from 'node:test';
import assert from 'node:assert/strict';
import { repairNamespaces, snapNamespaces } from '../js/core/ns-repair.js';
import { parseTree, documentElement, getAttr } from '../js/core/xml-repair.js';

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

const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';

function rootOf(text) {
  return documentElement(parseTree(text));
}

test('root namespace: a flipped letter in the relationships namespace is restored', () => {
  const root = rootOf('<Relationships xmlns="http://schemas.laenxmlformats.lrg/package/2006/relationships"/>');
  assert.equal(snapNamespaces(root), 1);
  assert.equal(getAttr(root, 'xmlns'), PKG_REL_NS);
});

test('root namespace: a prefixed presentation root is restored', () => {
  const root = rootOf('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/xain"/>');
  assert.equal(snapNamespaces(root), 1);
  assert.equal(getAttr(root, 'xmlns:p'), PRESENTATION_NS);
});

test('root namespace: a damaged year is restored', () => {
  const root = rootOf('<theme xmlns="http://schemas.openxmlformats.org/drawingml/2106/main"/>');
  assert.equal(snapNamespaces(root), 1);
  assert.equal(getAttr(root, 'xmlns'), 'http://schemas.openxmlformats.org/drawingml/2006/main');
});

test('root namespace: a damaged second declaration snaps to the one known namespace within two letters', () => {
  const root = rootOf(`<p:sld xmlns:p="${PRESENTATION_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationshiqs"/>`);
  assert.equal(snapNamespaces(root), 1);
  assert.equal(getAttr(root, 'xmlns:r'), 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
});

test('root namespace: a Strict OOXML namespace is left alone', () => {
  const root = rootOf('<sldLayout xmlns="http://purl.oclc.org/ooxml/presentationml/main"/>');
  assert.equal(snapNamespaces(root), 0);
  assert.equal(getAttr(root, 'xmlns'), 'http://purl.oclc.org/ooxml/presentationml/main');
});

test('root namespace: known and unknown extension namespaces are left alone', () => {
  const root = rootOf(`<p:sld xmlns:p="${PRESENTATION_NS}" xmlns:ext="http://example.com/some/extension" xmlns:w16="http://schemas.microsoft.com/office/word/2018/wordml"/>`);
  assert.equal(snapNamespaces(root), 0);
});

test('root namespace: a heavily damaged namespace on a root with a known name is restored', () => {
  const root = rootOf('<Relationships xmlns="http://schemas.openxmlformats.org/package/200Tnaspncaspncaspncass"/>');
  assert.equal(snapNamespaces(root), 1);
  assert.equal(getAttr(root, 'xmlns'), PKG_REL_NS);
});

test('root namespace: a root with an unknown name keeps its namespace', () => {
  const root = rootOf('<unknownRoot xmlns="http://example.com/anything/at/all"/>');
  assert.equal(snapNamespaces(root), 0);
});

test('declaration repair: a damaged encoding name becomes UTF-8', async () => {
  const { repairDeclaration } = await import('../js/core/ns-repair.js');
  const result = repairDeclaration('<?xml version="1.0" encoding="WTF-8" standalone="yes"?>\n<a/>');
  assert.equal(result.count, 1);
  assert.equal(result.text, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a/>');
});

test('declaration repair: usual encoding names and missing declarations are left alone', async () => {
  const { repairDeclaration } = await import('../js/core/ns-repair.js');
  for (const name of ['UTF-8', 'utf-8', 'UTF-16', 'ISO-8859-1', 'windows-1252', 'US-ASCII']) {
    const text = `<?xml version="1.0" encoding="${name}"?><a/>`;
    assert.deepEqual(repairDeclaration(text), { text, count: 0 });
  }
  assert.deepEqual(repairDeclaration('<a/>'), { text: '<a/>', count: 0 });
  assert.deepEqual(repairDeclaration('<?xml version="1.0"?><a/>'), { text: '<?xml version="1.0"?><a/>', count: 0 });
});

test('declaration repair: single quotes and spaces around the equals sign are handled', async () => {
  const { repairDeclaration } = await import('../js/core/ns-repair.js');
  const result = repairDeclaration("<?xml version='1.0' encoding = 'UTE-8'?><a/>");
  assert.equal(result.count, 1);
  assert.equal(result.text, "<?xml version='1.0' encoding = 'UTF-8'?><a/>");
});
