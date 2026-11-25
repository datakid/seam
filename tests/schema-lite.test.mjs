import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildTable, readTableFile, tableText } from '../tools/lib/schema-lite-build.mjs';
import { collectDefaults, applyDefaults } from '../tools/lib/schema-lite-defaults.mjs';
import { zipSync, strToU8 } from '../vendor/fflate.module.js';
import { openTable, fitChildren, checkTree, childEntry, requiredChildren, minimalElement } from '../js/core/schema-fit.js';
import { parseTree, documentElement } from '../js/core/xml-repair.js';
import { completeSpine, findViolations } from '../js/core/schema-close.js';

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
          { QName: 'w:id', Type: 'UInt32Value', Validators: REQUIRED },
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
      { Name: 'w:CT_Text/', ClassName: 'TextType', IsAbstract: true, IsLeafElement: true, Attributes: [{ QName: 'w:val', Type: 'StringValue', Validators: REQUIRED }] },
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
  assert.deepEqual(header[2], [[table.namespaces.indexOf(W), 'id', 'n']]);
});

test('elements that share a content type share one model', () => {
  const { table } = build();
  assert.equal(table.elements[W].title, table.elements[W].sub);
});

test('attributes come from the abstract base of the same type, not from a base with the same class name elsewhere', () => {
  const opened = openTable(build().table);
  const title = opened.entryFor(W, 'title');
  assert.deepEqual(title.attrs.map((a) => [a.ns, a.local, a.required, a.type]), [[W, 'val', true, 'string']]);
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

test('matching: a very long run of repeated children fits in linear time and still reports a misplaced one', () => {
  const opened = openTable(build().table);
  const doc = opened.entryFor(W, 'doc');
  const body = [el(W, 'head')];
  for (let i = 0; i < 40000; i++) body.push(el(W, i % 5000 === 4999 ? 'tbl' : 'p'));
  const began = Date.now();
  assert.deepEqual(fitChildren(opened, doc, [...body, el(W, 'sect')]), { ok: true });
  const late = fitChildren(opened, doc, [...body, el(W, 'sect'), el(W, 'p')]);
  assert.equal(late.ok, false);
  assert.equal(late.kind, 'order');
  assert.equal(late.at, body.length);
  const early = fitChildren(opened, doc, [el(W, 'head'), el(W, 'sect'), ...body.slice(1)]);
  assert.equal(early.ok, false);
  assert.equal(early.at, 1);
  assert.ok(Date.now() - began < 3000, `took ${Date.now() - began} ms`);
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

test('matching: an empty element whose content is a required choice is missing, not out of order', () => {
  const choiceSchemas = [{ Types: [{ Name: 'w:CT_Pick/w:pick', Particle: { Kind: 'Choice', Items: [{ Name: 'w:CT_Run/w:r' }, { Name: 'w:CT_Run/w:q' }] } }, { Name: 'w:CT_Run/w:r', IsLeafElement: true }, { Name: 'w:CT_Run/w:q', IsLeafElement: true }] }];
  const opened = openTable(buildTable({ schemas: choiceSchemas, namespaces, source }).table);
  const pick = opened.entryFor(W, 'pick');
  const empty = fitChildren(opened, pick, []);
  assert.equal(empty.kind, 'missing');
  assert.deepEqual(empty.expected, [`${W}|q`, `${W}|r`]);
  assert.deepEqual(fitChildren(opened, pick, [el(W, 'q')]), { ok: true });
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
    const moduleText = readFileSync(asModule, 'utf8');
    assert.ok(moduleText.includes('export const SCHEMA_LITE_RAW = {'));
    assert.ok(moduleText.includes('export const SCHEMA_LITE = openTable(SCHEMA_LITE_RAW);'));
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

const boxSchemas = [
  {
    Types: [
      { Name: 'w:CT_Box/w:box', Particle: { Kind: 'Sequence', Items: [{ Name: 'w:CT_Req/w:req' }, { Name: 'w:CT_Req/w:more', Occurs: [{ Max: 1 }] }] } },
      { Name: 'w:CT_Req/w:req', IsLeafElement: true, Attributes: [{ QName: ':count', Type: 'UInt32Value', Validators: REQUIRED }, { QName: ':flag', Type: 'BooleanValue', Validators: REQUIRED }] },
      { Name: 'w:CT_Req/w:more', IsLeafElement: true, Attributes: [{ QName: ':count', Type: 'UInt32Value', Validators: REQUIRED }, { QName: ':flag', Type: 'BooleanValue', Validators: REQUIRED }] },
    ],
  },
];

test('strict namespaces are also keys of the opened elements, and unprefixed children are foreign', () => {
  const opened = openTable(build().table);
  assert.equal(opened.elements[`${WS}|doc`], opened.elements[`${W}|doc`]);
  const doc = opened.entryFor(W, 'doc');
  assert.deepEqual(fitChildren(opened, doc, [el(W, 'head'), el('', 'stray')]), { ok: true });
  assert.equal(opened.known.has(''), false);
});

test('required attributes carry a type the consumer can build a default from', () => {
  const { table } = buildTable({ schemas: boxSchemas, namespaces, source });
  const opened = openTable(table);
  const req = opened.entryFor(W, 'box').items[0].entry;
  assert.deepEqual(req.attrs.map((a) => [a.local, a.type, a.ns]), [['count', 'number', ''], ['flag', 'boolean', '']]);
});

test('the opened table is read by the consumer side: required children and attributes are completed and violations found', () => {
  const { table } = buildTable({ schemas: boxSchemas, namespaces, source });
  const opened = openTable(table);
  const root = documentElement(parseTree(`<w:box xmlns:w="${W}"/>`));
  const state = completeSpine(root, opened);
  assert.deepEqual(state.added, [{ parent: 'box', child: 'req' }]);
  const made = root.children.find((c) => c.type === 'el');
  assert.equal(made.name, 'w:req');
  assert.deepEqual(made.attrs, [['count', '0'], ['flag', 'false']]);
  const bare = documentElement(parseTree(`<w:box xmlns:w="${W}"/>`));
  assert.deepEqual(findViolations(bare, opened), [{ element: 'box', problem: 'missing', child: 'req' }]);
  const strict = documentElement(parseTree(`<w:box xmlns:w="${WS}"/>`));
  assert.deepEqual(findViolations(strict, opened), [{ element: 'box', problem: 'missing', child: 'req' }]);
});

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relNamespaces = [...namespaces, { Prefix: 'r', Uri: REL }];

const minimalSchemas = [
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
      {
        Name: 'w:CT_Fill/w:fill',
        Particle: { Kind: 'Choice', Items: [{ Name: 'w:CT_Big/w:big' }, { Name: 'w:CT_Line/w:line' }, { Name: 'w:CT_Pic/w:pic' }] },
      },
      { Name: 'w:CT_Big/w:big', Particle: { Kind: 'Sequence', Items: [{ Name: 'w:CT_Line/w:line' }, { Name: 'w:CT_Line/w:line' }] } },
      { Name: 'w:CT_Line/w:line', IsLeafElement: true, Attributes: [{ QName: ':w', Type: 'UInt32Value', Validators: REQUIRED }, { QName: ':on', Type: 'BooleanValue', Validators: REQUIRED }, { QName: ':name', Type: 'StringValue', Validators: REQUIRED }] },
      { Name: 'w:CT_Pic/w:pic', IsLeafElement: true, Attributes: [{ QName: 'r:embed', Type: 'StringValue', Validators: REQUIRED }] },
      { Name: 'w:CT_Strange/w:strange', Particle: { Kind: 'Sequence', Items: [{ Kind: 'Any' }] }, Attributes: [{ QName: ':mode', Type: 'EnumValue<X.Y>', Validators: REQUIRED }] },
    ],
  },
];

function minimal(local, extra = {}) {
  const { table } = buildTable({ schemas: minimalSchemas, namespaces: relNamespaces, source, ...extra });
  const opened = openTable(table);
  return { opened, spec: minimalElement(opened, W, local, opened.entryFor(W, local)) };
}

test('a minimal element repeats required items, picks the cheapest choice and fills attributes by type', () => {
  const { spec } = minimal('style');
  assert.deepEqual(spec.children.map((c) => c.local), ['fill', 'line', 'line', 'line']);
  assert.deepEqual(spec.children[0].children.map((c) => c.local), ['line']);
  assert.deepEqual(spec.children[1].attrs.map((a) => [a.local, a.value]), [['name', ''], ['on', 'false'], ['w', '0']]);
  assert.deepEqual(spec.unresolved, []);
  assert.equal(spec.size, 5);
});

test('a minimal element reports what it cannot invent', () => {
  assert.deepEqual(minimal('strange').spec.unresolved.sort(), ['*', '@mode']);
  const { opened } = minimal('style');
  const pic = opened.entryFor(W, 'fill').items.find((i) => i.local === 'pic').entry;
  assert.deepEqual(minimalElement(opened, W, 'pic', pic).unresolved, ['@embed']);
});

test('a minimal element passes the table it was made from', () => {
  const { opened, spec } = minimal('style');
  const render = (node) => `<w:${node.local}${node.attrs.map((a) => ` ${a.local}="${a.value}"`).join('')}>${node.children.map(render).join('')}</w:${node.local}>`;
  const xml = render(spec).replace('<w:style', `<w:style xmlns:w="${W}"`);
  const result = checkTree(opened, parseTree(xml));
  assert.deepEqual(result.findings, []);
  assert.equal(result.checked, 6);
});

test('defaults come from the most common value in the healthy packages and are used by the minimal element', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schema-defaults-'));
  try {
    const part = (count, flag) => `<w:box xmlns:w="${W}"><w:req count="${count}" flag="${flag}"/></w:box>`;
    const pack = (name, ...parts) => writeFileSync(join(dir, name), zipSync(Object.fromEntries(parts.map((xml, i) => [`word/part${i}.xml`, strToU8(xml)]))));
    pack('a.docx', part(7, 'true'), part(7, 'true'));
    pack('b.docx', part(5, 'true'));
    pack('c.txt', part(99, 'false'));
    const { table } = buildTable({ schemas: boxSchemas, namespaces, source });
    const collected = collectDefaults(table, dir);
    assert.equal(collected.files, 2);
    assert.equal(applyDefaults(table, collected), 2);
    const opened = openTable(table);
    const spec = minimalElement(opened, W, 'box', opened.entryFor(W, 'box'));
    assert.deepEqual(spec.children[0].attrs.map((a) => [a.local, a.value]), [['count', '7'], ['flag', 'true']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
