import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { strictWellFormed } from '../js/core/xml-strict.js';
import { makeWellFormed } from '../js/core/xml-check.js';

const OK = true;
const BAD = false;
const UNSURE = null;

const TABLE = [
  ['<a/>', OK],
  ['<a></a>', OK],
  ['<a>text</a>', OK],
  ['<a >x</a >', OK],
  ['<a\n b="1"\n/>', OK],
  ['<a b = "1" c=\'2\'/>', OK],
  ['  \n<a/>\n  ', OK],
  ['<?xml version="1.0"?><a/>', OK],
  ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<a/>', OK],
  ["<?xml version='1.0' encoding='utf-8' standalone='no'?><a/>", OK],
  ['<?xml version="1.0"?><!--c--><?pi data?><a/><!--d--><?pi?>', OK],
  ['<?xml-stylesheet href="a"?><a/>', OK],
  ['<a>&amp;&lt;&gt;&quot;&apos;&#65;&#x41;&#x1F600;</a>', OK],
  ['<a b="&amp;&#10;&lt;"/>', OK],
  ['<a><![CDATA[ < & ]] > ]]></a>', OK],
  ['<a><!-- a - b --></a>', OK],
  ['<a>é中\u{1F600}</a>', OK],
  ['<a xmlns="urn:x"><b/></a>', OK],
  ['<a xmlns="urn:x"><b xmlns=""/></a>', OK],
  ['<p:a xmlns:p="urn:x"><p:b p:c="1"/></p:a>', OK],
  ['<a xmlns:p="urn:x"><b xmlns:p="urn:y"><p:c/></b><p:d/></a>', OK],
  ['<a xmlns:p="urn:x" xmlns:q="urn:x" p:k="1" q:j="2"/>', OK],
  ['<a xml:lang="en" xml:space="preserve"/>', OK],
  ['<a xmlns="a b"/>', OK],
  ['<a b="1" c="2" d="3" e="4" f="5" g="6" h="7" i="8" j="9" k="10" l="11" m="12" n="13"/>', OK],
  ['', BAD],
  ['   ', BAD],
  ['text', BAD],
  ['<a>', BAD],
  ['<a></b>', BAD],
  ['<a><b></a></b>', BAD],
  ['<a/><b/>', BAD],
  ['<a/>text', BAD],
  ['text<a/>', BAD],
  ['</a>', BAD],
  ['<a b=1/>', BAD],
  ['<a b/>', BAD],
  ['<a 1="x"/>', BAD],
  ['<a b="1" b="2"/>', BAD],
  ['<a b="1"c="2"/>', BAD],
  ['<a b="<"/>', BAD],
  ['<a b="x/>', BAD],
  ['<a>&nbsp;</a>', BAD],
  ['<a>&#0;</a>', BAD],
  ['<a>&#xD800;</a>', BAD],
  ['<a>&#x110000;</a>', BAD],
  ['<a>&#65</a>', BAD],
  ['<a>&#65', BAD],
  ['<a>&#x4', BAD],
  ['<a b="&#65', BAD],
  ['<a>&', BAD],
  ['<a>&am', BAD],
  ['<a>&#X41;</a>', BAD],
  ['<a>& </a>', BAD],
  ['<a>]]></a>', BAD],
  ['<a><!-- -- --></a>', BAD],
  ['<a><!-- x --->', BAD],
  ['<a><!-- unclosed</a>', BAD],
  ['<a><![CDATA[ unclosed</a>', BAD],
  ['<![CDATA[x]]><a/>', BAD],
  ['<a>\u0001</a>', BAD],
  ['<a>￾</a>', BAD],
  ['<a>￿</a>', BAD],
  ['\n<?xml version="1.0"?><a/>', BAD],
  ['<!--c--><?xml version="1.0"?><a/>', BAD],
  ['<a><?xml version="1.0"?></a>', BAD],
  ['<?xml version="1.0" standalone="maybe"?><a/>', BAD],
  ['<?xml encoding="UTF-8"?><a/>', BAD],
  ['<?xml version="1.0"', BAD],
  ['<a><?pi unclosed</a>', BAD],
  ['<p:a/>', BAD],
  ['<a p:b="1"/>', BAD],
  ['<a xmlns:p=""/>', BAD],
  ['<a:b:c/>', BAD],
  ['<a: b="1"/>', BAD],
  ['<:a/>', BAD],
  ['<a xmlns:p="u" xmlns:p="v"/>', BAD],
  ['<a xmlns:p="u" xmlns:q="u" p:k="1" q:k="2"/>', BAD],
  ['<a/ >', BAD],
  ['<a<b/>', BAD],
  ['<!DOCTYPE a><a/>', UNSURE],
  ['﻿<a/>', UNSURE],
  ['<a>\ud800</a>', UNSURE],
  ['<a>\udc00</a>', UNSURE],
  ['<?xml version="1.1"?><a/>', UNSURE],
  ['<?xml version="1.0" encoding="ISO-8859-1"?><a/>', UNSURE],
  ['<\u00e9\u4e2d \u00e9="1"/>', UNSURE],
  ['<a\u00a0b/>', UNSURE],
  ['<a \u{1F600}="1"/>', UNSURE],
  ['<?x\u00e9 data?><a/>', UNSURE],
  ['<xml:a/>', UNSURE],
  ['<a xmlns:xml="urn:x"/>', UNSURE],
  ['<a xmlns="http://www.w3.org/XML/1998/namespace"/>', UNSURE]
];

for (const [text, expected] of TABLE) {
  test(`xml-strict: ${JSON.stringify(text.length > 60 ? `${text.slice(0, 57)}...` : text)} is ${expected === OK ? 'well formed' : expected === BAD ? 'not well formed' : 'left to the browser'}`, () => {
    const verdict = strictWellFormed(text);
    if (expected === UNSURE) assert.equal(verdict, null);
    else {
      assert.notEqual(verdict, null, 'a verdict was expected');
      assert.equal(verdict.ok, expected, verdict.reason);
    }
  });
}

test('xml-strict: a bad verdict says where and why', () => {
  const verdict = strictWellFormed('<a><b></a>');
  assert.equal(verdict.ok, false);
  assert.equal(typeof verdict.reason, 'string');
  assert.equal(typeof verdict.at, 'number');
});

test('xml-strict: deep nesting and long runs do not overflow or slow down', () => {
  const depth = 100000;
  const text = `${'<a>'.repeat(depth)}x${'</a>'.repeat(depth)}`;
  assert.equal(strictWellFormed(text).ok, true);
  const wide = `<r>${'<c a="1" b="2">t</c>'.repeat(300000)}</r>`;
  assert.equal(strictWellFormed(wide).ok, true);
  const names = `<r xmlns:p="u">${'<p:c p:a="1"/>'.repeat(100000)}</r>`;
  assert.equal(strictWellFormed(names).ok, true);
});

test('xml-strict: every prefix of a document ends in a verdict, and only the whole document is well formed', () => {
  const document = '<?xml version="1.0" encoding="UTF-8"?>\n<p:a xmlns:p="urn:x" xmlns="urn:y" k="v &amp; &#65; &#x42;"><!--c--><p:b p:c=\'1\'>t &lt; <![CDATA[x]]></p:b><?pi d?><d/></p:a>';
  for (let length = 0; length < document.length; length++) {
    const verdict = strictWellFormed(document.slice(0, length));
    assert.ok(verdict !== null && verdict.ok === false, `prefix ${length}`);
  }
  assert.equal(strictWellFormed(document).ok, true);
  for (let length = 0; length <= document.length; length++) {
    for (const tail of ['&', '&#', '&#x', '&#6', '<', '</', '<!', '<!-', '<!--', '<![CDATA[', '<?', '"', "'"]) strictWellFormed(document.slice(0, length) + tail);
  }
});

test('xml-check: a definite verdict never reaches the fallback, an undecided one always does', async () => {
  const stats = { strict: 0, fallback: 0 };
  const asked = [];
  const judge = makeWellFormed(async (text) => {
    asked.push(text);
    return true;
  }, stats);
  assert.equal(await judge('<a/>'), true);
  assert.equal(await judge('<a>'), false);
  assert.equal(await judge('<!DOCTYPE a><a/>'), true);
  assert.deepEqual(asked, ['<!DOCTYPE a><a/>']);
  assert.deepEqual(stats, { strict: 2, fallback: 1 });
});

function mulberry32(start) {
  let a = start >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('xml-strict: agrees with the saxes reference parser on 20000 seeded mutations of OOXML-shaped parts', () => {
  const { SaxesParser } = createRequire(import.meta.url)('saxes');
  const reference = (text) => {
    const parser = new SaxesParser({ xmlns: true });
    let failed = false;
    parser.on('error', () => {
      failed = true;
    });
    try {
      parser.write(text).close();
    } catch {
      failed = true;
    }
    return !failed;
  };
  const seeds = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:t xml:space="preserve">Hello &amp; goodbye</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c><c r="B1"><v>2.5</v></c></row></sheetData></worksheet>',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://x/y" Target="a.xml"/><Relationship Id="rId2" Type="http://x/z" Target="b.xml" TargetMode="External"/></Relationships>',
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>é中</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
  ];
  const nasty = ['<', '>', '&', '"', "'", '/', '=', ':', ';', '#', ' ', '\n', '-', '--', '?', '!', ']', ']]>', '&amp;', '&nbsp;', '&#0;', '&#x1F600;', '&#65', '\u0000', '\u0001', '\u000b', '￾', ' ', '<!--', '-->', '<![CDATA[', 'xmlns', 'xmlns:', 'xml:', 'a:', '::', '<a>', '</a>', '<a/>', 'é', '\u{1F600}', '́', '1'];
  const next = mulberry32(7);
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(next() * list.length)];
  let compared = 0;
  const wrong = [];
  for (let i = 0; i < 20000; i++) {
    let s = pick(seeds);
    for (let r = int(1, 3); r > 0; r--) {
      const at = int(0, s.length);
      const op = int(0, 4);
      if (op === 0) s = s.slice(0, at) + s.slice(at + int(1, 6));
      else if (op === 1) s = s.slice(0, at) + pick(nasty) + s.slice(at);
      else if (op === 2) s = s.slice(0, at) + pick(nasty) + s.slice(at + 1);
      else if (op === 3) s = s.slice(0, at);
      else s = s.slice(0, at) + s.slice(at, at + int(1, 30)) + s.slice(at);
    }
    const verdict = strictWellFormed(s);
    if (verdict === null) continue;
    compared++;
    if (verdict.reason === 'instruction' || verdict.reason === 'declaration') continue;
    if (verdict.ok !== reference(s)) wrong.push({ s: s.slice(0, 160), reason: verdict.reason });
  }
  assert.ok(compared > 15000, `compared ${compared}`);
  assert.deepEqual(wrong.slice(0, 5), []);
});
