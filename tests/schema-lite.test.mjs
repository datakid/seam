import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildTable, readTableFile, tableText } from '../tools/lib/schema-lite-build.mjs';
import { openTable, fitChildren, checkTree, childEntry, requiredChildren } from '../js/core/schema-fit.js';
import { parseTree } from '../js/core/xml-repair.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

const namespaces = [
  { Prefix: 'w', Uri: W },
  { Prefix: 'm', Uri: M },
  { Prefix: 'v', Uri: 'urn:schemas-microsoft-com:vml' },
];

const REQUIRED = [{ Name: 'RequiredValidator' }];

const schemas = [
  {
    Types: [
      {
        Name: 'w:CT_Doc/w:doc',
        Attributes: [
          { QName: 'w:id', Validators: REQUIRED },
          { QName: ':lang' },
        ],
        Particle: {
          Kind: 'Sequence',
          Items: [
            { Name: 'w:CT_Head/w:head' },
            { Kind: 'Group', Occurs: [{}], Items: [{ Kind: 'Choice', Items: [{ Name: 'w:CT_Para/w:p' }, { Name: 'w:CT_Tbl/w:tbl' }] }] },
            { Name: 'w:CT_Sect/w:sect', Occurs: [{ Max: 1 }] },
          ],
        },
      },
      {
        Name: 'w:CT_Head/w:head',
        Particle: { Kind: 'Sequence', Items: [{ Name: 'w:CT_Text/w:title' }, { Name: 'w:CT_Text/w:sub', Occurs: [{ Max: 1 }] }] },
      },
      { Name: 'w:CT_Text/w:title', ClassName: 'Title', BaseClass: 'TextType', IsDerived: true, IsLeafElement: true },
      { Name: 'w:CT_Text/w:sub', ClassName: 'Sub', BaseClass: 'TextType', IsDerived: true, IsLeafElement: true },
      { Name: 'w:CT_Text/', ClassName: 'TextType', IsAbstract: true, IsLeafElement: true, Attributes: [{ QName: 'w:val', Validators: REQUIRED }] },
      { Name: 'm:CT_Text/', ClassName: 'TextType', IsAbstract: true, IsLeafElement: true, Attributes: [{ QName: 'm:val' }] },
      { Name: 'm:CT_Text/m:t', ClassName: 'MathText', BaseClass: 'TextType', IsDerived: true, IsLeafElement: true },
      { Name: 'w:CT_Para/w:p', Particle: { Kind: 'Sequence', Items: [{ Name: 'w:CT_Run/w:r', Occurs: [{}] }] } },
      { Name: 'w:CT_ParaAlt/w:p', Particle: { Kind: 'Sequence', Items: [{ Name: 'w:CT_Run/w:r', Occurs: [{ Max: 1 }] }] } },
      { Name: 'w:CT_Tbl/w:tbl', Particle: { Kind: 'Sequence', Items: [{ Name: 'w:CT_ParaAlt/w:p', Occurs: [{ Min: 1 }] }] } },
      { Name: 'w:CT_Run/w:r', Attributes: [{ QName: 'w:rsid' }], IsLeafElement: true },
      { Name: 'w:CT_Sect/w:sect', Particle: { Kind: 'Sequence', Items: [{ Name: 'w:CT_Ext/w:ext', Occurs: [{}] }] } },
      { Name: 'w:CT_Ext/w:ext', Particle: { Kind: 'Sequence', Items: [{ Kind: 'Any' }] } },
      {
        Name: 'w:CT_Props/w:props',
        Particle: { Kind: 'All', Items: [{ Name: 'w:CT_Text/w:title' }, { Name: 'w:CT_Text/w:sub', Occurs: [{ Max: 1 }] }] },
      },
      {
        Name: 'w:CT_Mixed/w:mixed',
        Particle: { Kind: 'Sequence', Items: [{ Name: 'v:CT_Shape/v:shape', Occurs: [{ Min: 1 }] }, { Name: 'w:CT_Run/w:r', Occurs: [{ Max: 1 }] }] },
      },
      { Name: 'v:CT_Shape/v:shape', IsLeafElement: true },
    ],
  },
];

const source = { repo: 'fixture/sdk', commit: 'abc', licence: 'MIT' };

function build(extra = {}) {
  return buildTable({ schemas, namespaces, source, ...extra });
}

const el = (ns, local) => ({ ns, local });

test('the builder writes the compact table shape with shared models and grouped elements', () => {
  const { table, stats } = build();
  assert.equal(table.format, 2);
  assert.deepEqual(table.source, source);
  assert.ok(Array.isArray(table.namespaces) && table.namespaces.includes(W));
  assert.ok(Array.isArray(table.types) && table.types.length > 0);
  assert.equal(typeof table.elements[W].doc, 'number');
  assert.equal(table.namespaceAliases[WS], W);
  assert.equal(stats.conflicts.length, 0);
  assert.deepEqual(stats.ambiguous, [`${W}|p`]);
  assert.equal(table.elements[W].p, undefined);
  const header = table.types[table.elements[W].doc];
  assert.equal(header[0], 's');
  assert.deepEqual(header[2], [[table.namespaces.indexOf(W), 'id']]);
});

test('elements that share a content type share one model', () => {
  const { table } = build();
  assert.equal(table.elements[W].title, table.elements[W].sub);
});

test('attributes come from the abstract base of the same type, not from a base with the same class name elsewhere', () => {
  const opened = openTable(build().table);
  const title = opened.entryFor(W, 'title');
  assert.deepEqual(title.attrs.map((a) => [a.ns, a.local, a.required]), [[W, 'val', true]]);
  assert.equal(opened.entryFor(M, 't'), null);
});

test('namespaces can be dropped and parents lose the dropped children without becoming stricter', () => {
  const { table } = build({ dropNamespace: (ns) => ns.startsWith('urn:schemas-microsoft-com:') });
  const opened = openTable(table);
  const mixed = opened.entryFor(W, 'mixed');
  assert.deepEqual(mixed.items.map((i) => i.local), ['r']);
  assert.ok(!table.namespaces.some((ns) => ns.startsWith('urn:')));
  assert.deepEqual(fitChildren(opened, mixed, [el(W, 'r')]), { ok: true });
});

test('patches tolerate elements and open whole types', () => {
  const patches = { tolerate: [{ element: `${W}|extra` }], open: [{ element: `${W}|head` }] };
  const { table, stats } = build({ patches });
  const opened = openTable(table);
  assert.deepEqual(table.tolerated, [`${W}|extra`]);
  assert.deepEqual(stats.patches.opened, [`${W}|head`]);
  assert.equal(opened.entryFor(W, 'head').kind, 'open');
  assert.deepEqual(fitChildren(opened, opened.entryFor(W, 'head'), [el(W, 'anything')]), { ok: true });
  const doc = opened.entryFor(W, 'doc');
  assert.deepEqual(fitChildren(opened, doc, [el(W, 'head'), el(W, 'extra'), el(W, 'p')]), { ok: true });
});

test('a patch that names an unknown element is reported', () => {
  const { stats } = build({ patches: { open: [{ element: `${W}|nothing` }], openTypes: [{ type: 'w:CT_Nope' }] } });
  assert.deepEqual(stats.patches.unknown.sort(), [`${W}|nothing`, 'w:CT_Nope'].sort());
});

test('matching: sequence, optional items, repeated choice, wildcard content and strict aliases', () => {
  const opened = openTable(build().table);
  const doc = opened.entryFor(W, 'doc');
  assert.deepEqual(fitChildren(opened, doc, [el(W, 'head')]), { ok: true });
  assert.deepEqual(fitChildren(opened, doc, [el(W, 'head'), el(W, 'p'), el(W, 'tbl'), el(W, 'p'), el(W, 'sect')]), { ok: true });
  assert.deepEqual(fitChildren(opened, doc, [el(WS, 'head'), el(WS, 'p'), el(WS, 'sect')]), { ok: true });
  const sect = opened.entryFor(W, 'sect');
  assert.deepEqual(fitChildren(opened, sect, [el('urn:other', 'a'), el('urn:other', 'b')]), { ok: true });
  assert.deepEqual(fitChildren(opened, sect, []), { ok: true });
});

test('matching: a missing required child is reported as missing', () => {
  const opened = openTable(build().table);
  const doc = opened.entryFor(W, 'doc');
  const result = fitChildren(opened, doc, [el(W, 'p')]);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'missing');
  assert.deepEqual(result.expected, [`${W}|head`]);
  assert.equal(fitChildren(opened, doc, []).kind, 'missing');
});

test('matching: children in the wrong order are reported as order, not as missing', () => {
  const opened = openTable(build().table);
  const doc = opened.entryFor(W, 'doc');
  const result = fitChildren(opened, doc, [el(W, 'p'), el(W, 'head')]);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'order');
  assert.equal(result.at, 0);
  assert.deepEqual(result.expected, [`${W}|head`]);
  const head = opened.entryFor(W, 'head');
  assert.equal(fitChildren(opened, head, [el(W, 'sub'), el(W, 'title')]).kind, 'order');
});

test('matching: a child the model does not know and a repeated single child are reported', () => {
  const opened = openTable(build().table);
  const head = opened.entryFor(W, 'head');
  const unexpected = fitChildren(opened, head, [el(W, 'title'), el(W, 'p')]);
  assert.equal(unexpected.kind, 'unexpected');
  assert.equal(unexpected.at, 1);
  const repeated = fitChildren(opened, head, [el(W, 'title'), el(W, 'sub'), el(W, 'sub')]);
  assert.equal(repeated.kind, 'repeat');
  assert.equal(repeated.at, 2);
});

test('matching: foreign namespaces are ignored unless the model has a wildcard', () => {
  const opened = openTable(build().table);
  const head = opened.entryFor(W, 'head');
  assert.deepEqual(fitChildren(opened, head, [el('urn:unknown', 'x'), el(W, 'title'), el('urn:unknown', 'y')]), { ok: true });
  assert.deepEqual(fitChildren(opened, head, [el(MC, 'AlternateContent'), el(W, 'title')]), { ok: true });
});

test('matching: all-groups accept any order and respect counts', () => {
  const opened = openTable(build().table);
  const props = opened.entryFor(W, 'props');
  assert.deepEqual(fitChildren(opened, props, [el(W, 'sub'), el(W, 'title')]), { ok: true });
  assert.equal(fitChildren(opened, props, [el(W, 'sub')]).ok, false);
  assert.equal(fitChildren(opened, props, [el(W, 'title'), el(W, 'title')]).ok, false);
});

test('matching: long runs of one repeated child stay fast and correct', () => {
  const opened = openTable(build().table);
  const doc = opened.entryFor(W, 'doc');
  const children = [el(W, 'head')];
  for (let i = 0; i < 200000; i++) children.push(el(W, 'p'));
  children.push(el(W, 'sect'));
  const started = Date.now();
  assert.deepEqual(fitChildren(opened, doc, children), { ok: true });
  assert.ok(Date.now() - started < 3000);
});

test('the same element name resolves through its parent when it has several definitions', () => {
  const opened = openTable(build().table);
  const tbl = opened.entryFor(W, 'tbl');
  const inTbl = childEntry(opened, tbl, W, 'p');
  const inDoc = childEntry(opened, opened.entryFor(W, 'doc'), W, 'p');
  assert.ok(inTbl && inDoc && inTbl !== inDoc);
  assert.equal(fitChildren(opened, inDoc, [el(W, 'r'), el(W, 'r')]).ok, true);
  assert.equal(fitChildren(opened, inTbl, [el(W, 'r'), el(W, 'r')]).kind, 'repeat');
});

test('required children are listed for an entry', () => {
  const opened = openTable(build().table);
  assert.deepEqual(requiredChildren(opened, opened.entryFor(W, 'doc')), [`${W}|head`]);
  assert.deepEqual(requiredChildren(opened, opened.entryFor(W, 'sect')), []);
});

function check(xml) {
  return checkTree(openTable(build().table), parseTree(xml));
}

const head = '<w:head><w:title w:val="a"/></w:head>';
const ns = `xmlns:w="${W}"`;

test('a tree that fits the table has no findings', () => {
  const result = check(`<w:doc ${ns} w:id="1">${head}<w:p><w:r/></w:p></w:doc>`);
  assert.deepEqual(result.findings, []);
  assert.ok(result.checked >= 4);
  assert.ok(result.constrained >= 2);
});

test('missing required attributes and children are found with a path', () => {
  const result = check(`<w:doc ${ns}><w:head><w:title/></w:head></w:doc>`);
  const kinds = result.findings.map((f) => `${f.kind}:${f.name}`).sort();
  assert.deepEqual(kinds, ['attr:w:doc', 'attr:w:title']);
  const missing = check(`<w:doc ${ns} w:id="1"><w:p/></w:doc>`).findings;
  assert.equal(missing[0].kind, 'missing');
  assert.equal(missing[0].path, '/w:doc');
  assert.deepEqual(missing[0].expected, [`${W}|head`]);
});

test('prefixes are resolved by namespace, and strict namespaces are accepted', () => {
  const result = check(`<q:doc xmlns:q="${WS}" q:id="1"><q:head><q:title q:val="x"/></q:head></q:doc>`);
  assert.deepEqual(result.findings, []);
});

test('children in namespaces listed by mc:Ignorable are skipped', () => {
  const xml = `<w:doc ${ns} xmlns:mc="${MC}" xmlns:z="urn:known" mc:Ignorable="z" w:id="1">${head}<z:note/></w:doc>`;
  assert.deepEqual(check(xml).findings, []);
});

test('alternate content is read through its first choice, or its fallback when that does not fit', () => {
  const choice = `<w:doc ${ns} xmlns:mc="${MC}" w:id="1"><mc:AlternateContent><mc:Choice Requires="w"><w:head><w:title w:val="a"/></w:head></mc:Choice><mc:Fallback><w:p/></mc:Fallback></mc:AlternateContent></w:doc>`;
  assert.deepEqual(check(choice).findings, []);
  const fallback = `<w:doc ${ns} xmlns:mc="${MC}" w:id="1"><mc:AlternateContent><mc:Choice Requires="w"><w:p/></mc:Choice><mc:Fallback><w:head><w:title w:val="a"/></w:head></mc:Fallback></mc:AlternateContent></w:doc>`;
  assert.deepEqual(check(fallback).findings, []);
});

test('descendants are checked with the definition their parent gives them', () => {
  const bad = `<w:doc ${ns} w:id="1">${head}<w:tbl><w:p><w:r/><w:r/></w:p></w:tbl></w:doc>`;
  const findings = check(bad).findings;
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'repeat');
  assert.equal(findings[0].path, '/w:doc/w:tbl[1]/w:p[1]');
  const fine = `<w:doc ${ns} w:id="1">${head}<w:p><w:r/><w:r/></w:p></w:doc>`;
  assert.deepEqual(check(fine).findings, []);
});

test('a hand-written table in the plain contract shape works through the same reader', () => {
  const plain = {
    source: { repo: 'x', commit: 'y', licence: 'MIT' },
    namespaceAliases: { [WS]: W },
    elements: {
      [`${W}|box`]: {
        kind: 'sequence',
        items: [
          { ns: W, local: 'a' },
          { kind: 'choice', min: 0, max: null, items: [{ ns: W, local: 'b' }, { ns: W, local: 'c', max: 2 }] },
        ],
        attrs: [{ local: 'id', required: true }, { local: 'x', required: false }],
      },
      [`${W}|a`]: { kind: 'sequence', items: [{ ns: W, local: 'b' }], attrs: [] },
    },
  };
  const opened = openTable(plain);
  const box = opened.entryFor(WS, 'box');
  assert.deepEqual(fitChildren(opened, box, [el(W, 'a'), el(W, 'b'), el(W, 'c'), el(W, 'b')]), { ok: true });
  assert.equal(fitChildren(opened, box, [el(W, 'b')]).ok, false);
  const result = checkTree(opened, parseTree(`<w:box ${ns}><w:a><w:b/></w:a><w:c/></w:box>`));
  assert.deepEqual(result.findings.map((f) => f.kind), ['attr']);
});

test('a table written as a module can be read back, and equals the json form', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schema-lite-'));
  try {
    const { table } = build();
    const asModule = join(dir, 'table.js');
    const asJson = join(dir, 'table.json');
    writeFileSync(asModule, tableText(table, asModule));
    writeFileSync(asJson, tableText(table, asJson));
    assert.ok(readFileSync(asModule, 'utf8').startsWith('export default {'));
    assert.deepEqual(readTableFile(asModule), table);
    assert.deepEqual(readTableFile(asJson), table);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the generator writes a table from an SDK checkout and stays within the size budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schema-lite-'));
  try {
    mkdirSync(join(dir, 'data', 'schemas'), { recursive: true });
    writeFileSync(join(dir, 'data', 'schemas', 'one.json'), JSON.stringify(schemas[0]));
    writeFileSync(join(dir, 'data', 'namespaces.json'), JSON.stringify(namespaces));
    const out = join(dir, 'table.js');
    execFileSync(process.execPath, ['tools/gen-schema-lite.mjs', '--sdk', dir, '--out', out, '--commit', 'abc123', '--patches', join(dir, 'none.json')], { cwd: new URL('..', import.meta.url).pathname });
    const text = readFileSync(out, 'utf8');
    const table = readTableFile(out);
    assert.equal(table.source.commit, 'abc123');
    assert.equal(table.source.licence, 'MIT');
    assert.ok(text.length < 300 * 1024);
    assert.ok(Object.keys(table.elements).length > 0);
    assert.ok(!table.namespaces.some((namespace) => namespace.startsWith('urn:schemas-microsoft-com:')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
