import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTable } from '../tools/lib/schema-lite-build.mjs';
import { openTable, checkTree } from '../js/core/schema-fit.js';
import { fillMissing } from '../js/core/schema-fill.js';
import { parseTree, serializeTree, documentElement } from '../js/core/xml-repair.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const REQUIRED = [{ Name: 'RequiredValidator' }];
const namespaces = [
  { Prefix: 'w', Uri: W },
  { Prefix: 'm', Uri: M },
];

const schemas = [
  {
    Types: [
      {
        Name: 'w:CT_Style/w:style',
        Particle: {
          Kind: 'Sequence',
          Items: [
            { Name: 'w:CT_Fill/w:fill' },
            { Name: 'w:CT_Line/w:line', Occurs: [{ Min: 3 }] },
            { Name: 'w:CT_Line/w:opt', Occurs: [{ Max: 1 }] },
          ],
        },
      },
      { Name: 'w:CT_Fill/w:fill', Particle: { Kind: 'Choice', Items: [{ Name: 'w:CT_Big/w:big' }, { Name: 'w:CT_Line/w:line' }, { Name: 'w:CT_Pic/w:pic' }] } },
      { Name: 'w:CT_Big/w:big', Particle: { Kind: 'Sequence', Items: [{ Name: 'w:CT_Line/w:line' }, { Name: 'w:CT_Line/w:line' }] } },
      { Name: 'w:CT_Line/w:line', IsLeafElement: true, Attributes: [{ QName: ':w', Type: 'UInt32Value', Validators: REQUIRED }, { QName: ':on', Type: 'BooleanValue', Validators: REQUIRED }, { QName: ':name', Type: 'StringValue', Validators: REQUIRED }] },
      { Name: 'w:CT_Pic/w:pic', IsLeafElement: true, Attributes: [{ QName: 'r:embed', Type: 'StringValue', Validators: REQUIRED }] },
      { Name: 'w:CT_Stack/w:stack', Particle: { Kind: 'Sequence', Items: [{ Name: 'w:CT_Style/w:style', Occurs: [{ Min: 1 }] }] } },
      { Name: 'w:CT_Holder/w:holder', Particle: { Kind: 'Sequence', Items: [{ Name: 'm:CT_Note/m:note' }] } },
      { Name: 'm:CT_Note/m:note', IsLeafElement: true },
      { Name: 'w:CT_Mode/w:mode', Particle: { Kind: 'Sequence', Items: [{ Name: 'w:CT_Strange/w:strange' }] } },
      { Name: 'w:CT_Strange/w:strange', IsLeafElement: true, Attributes: [{ QName: ':kind', Type: 'EnumValue<X.Y>', Validators: REQUIRED }] },
      { Name: 'w:CT_Pair/w:pair', Particle: { Kind: 'Sequence', Items: [{ Name: 'w:CT_Line/w:line' }, { Name: 'w:CT_Grouped/w:group', Occurs: [{ Max: 1 }] }] } },
      { Name: 'w:CT_Grouped/w:group', Particle: { Kind: 'Sequence', Items: [{ Name: 'm:CT_Note/m:note' }, { Name: 'w:CT_Line/w:opt' }] } },
    ],
  },
];

const { table: raw } = buildTable({ schemas, namespaces, source: { repo: 'fixture/sdk', commit: 'abc', licence: 'MIT' } });
const table = openTable(raw);

const decl = `xmlns:w="${W}"`;
const line = '<w:line w="1" on="true" name="a"/>';
const made = '<w:line name="" on="false" w="0"/>';

function fill(xml, options) {
  const tree = parseTree(xml);
  const result = fillMissing(tree, table, options);
  return { tree, result, text: serializeTree(tree) };
}

function hard(tree) {
  return checkTree(table, tree, Infinity).findings.filter((f) => f.kind !== 'order');
}

test('a required item below its minimum count is repeated, after the children already there', () => {
  const { text, result, tree } = fill(`<w:style ${decl}><w:fill>${line}</w:fill>${line}</w:style>`);
  assert.equal(text, `<w:style ${decl}><w:fill>${line}</w:fill>${line}${made}${made}</w:style>`);
  assert.deepEqual(result.added.map((a) => a.child), ['line', 'line']);
  assert.deepEqual(hard(tree), []);
});

test('an empty element is completed with the cheapest alternative of its required choice', () => {
  const { text, tree } = fill(`<w:style ${decl}/>`);
  assert.equal(text, `<w:style ${decl}><w:fill>${made}</w:fill>${made}${made}${made}</w:style>`);
  assert.deepEqual(hard(tree), []);
});

test('a missing first child goes before the children that follow it', () => {
  const { text, tree } = fill(`<w:style ${decl}>${line}${line}${line}<w:opt w="1" on="true" name="b"/></w:style>`);
  assert.ok(text.startsWith(`<w:style ${decl}><w:fill>${made}</w:fill>${line}`));
  assert.ok(text.endsWith('<w:opt w="1" on="true" name="b"/></w:style>'));
  assert.deepEqual(hard(tree), []);
});

test('an element that is itself a required choice gets one alternative', () => {
  const { text } = fill(`<w:fill ${decl}/>`);
  assert.equal(text, `<w:fill ${decl}>${made}</w:fill>`);
});

test('a group that was started is completed, and one that was not is left out when optional', () => {
  const started = fill(`<w:pair ${decl}>${line}<w:group xmlns:m="${M}"/></w:pair>`);
  assert.ok(started.text.includes(`<w:group xmlns:m="${M}"><m:note/>`));
  assert.ok(started.text.includes('<w:opt name="" on="false" w="0"/></w:group>'));
  const absent = fill(`<w:pair ${decl}>${line}</w:pair>`);
  assert.equal(absent.result.added.length, 0);
});

test('a child in a namespace that is not declared is added with its own declaration', () => {
  const { text, tree } = fill(`<w:holder ${decl}/>`);
  assert.equal(text, `<w:holder ${decl}><note xmlns="${M}"/></w:holder>`);
  assert.deepEqual(hard(tree), []);
});

test('a prefix that is declared for the namespace is used', () => {
  const { text } = fill(`<w:holder ${decl} xmlns:x="${M}"/>`);
  assert.equal(text, `<w:holder ${decl} xmlns:x="${M}"><x:note/></w:holder>`);
});

test('what cannot be invented is reported and the element is still added', () => {
  const { text, result } = fill(`<w:mode ${decl}/>`);
  assert.equal(text, `<w:mode ${decl}><w:strange/></w:mode>`);
  assert.deepEqual(result.unresolved.map((u) => u.reason), ['@kind']);
});

test('a tree that fits is left alone, and a second pass changes nothing', () => {
  const xml = `<w:style ${decl}><w:fill>${line}</w:fill>${line}${line}${line}</w:style>`;
  assert.equal(fill(xml).result.added.length, 0);
  const tree = parseTree(`<w:style ${decl}/>`);
  fillMissing(tree, table);
  const once = serializeTree(tree);
  assert.equal(fillMissing(tree, table).added.length, 0);
  assert.equal(serializeTree(tree), once);
});

test('the spine scope fills only the nodes on the path to the last element, the tree scope fills every node', () => {
  const xml = `<w:stack ${decl}><w:style/><w:style/></w:stack>`;
  const spine = fill(xml, { scope: 'spine' });
  assert.ok(spine.text.startsWith(`<w:stack ${decl}><w:style/><w:style><w:fill>`));
  const all = fill(xml);
  assert.equal(all.text.split('<w:fill>').length - 1, 2);
  assert.deepEqual(hard(all.tree), []);
});

test('findings keep their node and entry out of enumeration so reports stay serialisable', () => {
  const tree = parseTree(`<w:style ${decl}/>`);
  const { findings } = checkTree(table, tree, Infinity);
  assert.ok(findings.length > 0);
  assert.ok(findings[0].node && findings[0].entry);
  assert.doesNotThrow(() => JSON.stringify(findings));
  assert.ok(!('node' in JSON.parse(JSON.stringify(findings[0]))));
});

test('an open entry and a part with no table entry are not touched', () => {
  const tree = parseTree(`<q:other xmlns:q="urn:none"><q:a/></q:other>`);
  assert.equal(fillMissing(tree, table).added.length, 0);
  assert.equal(serializeTree(tree), '<q:other xmlns:q="urn:none"><q:a/></q:other>');
});

test('the document element can be given in place of the document root, as the pipeline does', () => {
  const tree = parseTree(`<?xml version="1.0"?>\n<w:style ${decl}/>`);
  const top = documentElement(tree);
  const result = fillMissing(top, table, { scope: 'spine' });
  assert.equal(result.added.length, 4);
  assert.equal(serializeTree(tree), `<?xml version="1.0"?>\n<w:style ${decl}><w:fill>${made}</w:fill>${made}${made}${made}</w:style>`);
});
