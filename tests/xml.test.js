import { test, assert, eq, wellFormed } from './harness.js';
import { repairXml, parseTree, serializeTree, scan, serializeTokens, getAttr, descendants, removeNode, unwrapNode, textOf, documentElement } from '../js/core/xml-repair.js';
import { decodeXml, cleanChars, fixDeclaration } from '../js/core/xml-clean.js';
import { docx } from './fixtures.js';
import { strictRead } from '../js/core/zip-read.js';

const CASES = [
  ['truncated inside text', '<a><b>hello wor', '<a><b>hello wor</b></a>', { truncated: true }],
  ['truncated inside a start tag', '<a><b attr="x', '<a></a>', { truncated: true }],
  ['truncated inside an end tag', '<a><b>t</b></', '<a><b>t</b></a>', { truncated: true }],
  ['truncated after an open bracket', '<a><b>t</b><', '<a><b>t</b></a>', { truncated: true }],
  ['nested truncation', '<a><b><c><d>x', '<a><b><c><d>x</d></c></b></a>', { truncated: true, unclosed: 4 }],
  ['prefixed truncation', '<w:p xmlns:w="urn:w"><w:r><w:t>hi</w:t></w:r>', '<w:p xmlns:w="urn:w"><w:r><w:t>hi</w:t></w:r></w:p>', { truncated: true }],
  ['stray closing tag', '<a>x</b>y</a>', '<a>xy</a>', { strayClosed: 1 }],
  ['closing tag for a deeper element', '<a><b><c>x</a>', '<a><b><c>x</c></b></a>', { autoClosed: 2 }],
  ['stray close then truncation', '<a>x</b>', '<a>x</a>', { strayClosed: 1, truncated: true }],
  ['duplicate attributes', '<a x="1" x="2"/>', '<a x="1"/>', { dupAttrs: 1 }],
  ['unquoted attribute values', '<a x=1 y=two>t</a>', '<a x="1" y="two">t</a>', { quotedAttrs: 2 }],
  ['single quotes containing double quotes', '<a x=\'say "hi"\'/>', '<a x="say &quot;hi&quot;"/>', {}],
  ['bracket inside an attribute value', '<a x="1<2"/>', '<a x="1&lt;2"/>', {}],
  ['stray bracket in text', '<a>1 < 2</a>', '<a>1 &lt; 2</a>', { escaped: 1 }],
  ['CDATA cut off at the end', '<a><![CDATA[abc', '<a></a>', { truncated: true }],
  ['complete CDATA is kept', '<a><![CDATA[x<y]]></a>', '<a><![CDATA[x<y]]></a>', {}],
  ['comment cut off at the end', '<a><!-- note', '<a></a>', { truncated: true }],
  ['double dash inside a comment', '<a><!-- a -- b --></a>', '<a><!-- a - - b --></a>', {}],
  ['processing instruction cut off', '<a><?pi data', '<a></a>', { truncated: true }],
  ['content after the root element', '<a/><b/>', '<a/>', { trailingContent: 1 }],
  ['content after a closed root', '<a>x</a><b>y</b>', '<a>x</a>', { trailingContent: 1 }],
  ['text before the root', 'junk<a/>', '<a/>', {}],
  ['second declaration in the middle', '<a><?xml version="1.0"?></a>', '<a></a>', {}],
  ['doctype is dropped', '<!DOCTYPE a><a/>', '<a/>', {}],
  ['attribute without a value', '<a disabled>x</a>', '<a>x</a>', { droppedAttrs: 1 }],
  ['closing sequence in text', '<a>x ]]> y</a>', '<a>x ]]&gt; y</a>', {}],
  ['nested empty elements', '<a><b/><c/></a>', '<a><b/><c/></a>', {}],
  ['greater-than inside an attribute', '<a x="1>2">t</a>', '<a x="1>2">t</a>', {}],
  ['junk inside an end tag', '<a>t</a foo>', '<a>t</a>', {}],
  ['trivia after the root is not content', '<a>t</a>  \n<!-- tail -->', '<a>t</a>', {}],
  ['declaration is kept and followed by a newline', '<?xml version="1.0"?>\r\n<a/>', '<?xml version="1.0"?>\n<a/>', {}],
  ['predefined entities are untouched', '<a>&amp; &lt; &gt; &quot; &apos;</a>', '<a>&amp; &lt; &gt; &quot; &apos;</a>', {}]
];

for (const [name, input, expected, stats] of CASES) {
  test(`xml repair: ${name}`, () => {
    const result = repairXml(input);
    eq(result.text, expected);
    assert(wellFormed(result.text), 'output is not well-formed');
    for (const key of Object.keys(stats)) {
      if (key === 'truncated') eq(result.truncated, stats[key], 'truncated');
      else if (key === 'unclosed') eq(result.unclosed, stats[key], 'unclosed');
      else eq(result.stats[key], stats[key], key);
    }
  });
}

test('xml repair: an input that ends in the root start tag has no root', () => {
  eq(repairXml('<a x="abc').hasRoot, false);
  eq(repairXml('').hasRoot, false);
  eq(repairXml('   \n ').hasRoot, false);
  eq(repairXml('just text').hasRoot, false);
});

test('xml repair: a well-formed document needs no repair statistics', () => {
  const result = repairXml('<a x="1"><b>t</b></a>');
  eq(result.truncated, false);
  for (const value of Object.values(result.stats)) eq(value, 0);
});

test('xml repair: truncation offset is recorded', () => {
  const result = repairXml('<a><b>hello</b><c attr="x');
  assert(result.truncatedAt > 0.5 && result.truncatedAt < 1, `truncatedAt ${result.truncatedAt}`);
});

test('xml repair: every cut of a real document part repairs to well-formed XML', async () => {
  const entry = strictRead(docx(), 0).entries.find((e) => e.name === 'word/document.xml');
  const text = new TextDecoder().decode(entry.data);
  let checked = 0;
  for (let cut = 1; cut < text.length; cut += 7) {
    const result = repairXml(text.slice(0, cut));
    if (!result.hasRoot) continue;
    assert(wellFormed(result.text), `cut ${cut} gave ill-formed output`);
    checked++;
  }
  assert(checked > 100, 'enough cuts were checked');
});

test('xml repair: cut at every position of a prefixed paragraph keeps the text before the cut', () => {
  const source = '<w:p xmlns:w="urn:w"><w:r><w:t>alpha beta gamma</w:t></w:r></w:p>';
  for (let cut = source.indexOf('alpha') + 1; cut < source.length; cut++) {
    const result = repairXml(source.slice(0, cut));
    assert(wellFormed(result.text), `cut ${cut}`);
  }
});

test('xml clean: control characters and invalid numeric references are removed', () => {
  const result = cleanChars('a\x01b\x0Bc&#1;d&#x1F;e&#0;f&#xD800;g&#65;h&#x41;i');
  eq(result.text, 'abcdefg&#65;h&#x41;i');
  eq(result.removed, 6);
});

test('xml clean: bare ampersands and unknown entities are escaped', () => {
  const result = cleanChars('<a>AT&T &amp; &nbsp; &#x41; &copy;</a>');
  eq(result.text, '<a>AT&amp;T &amp; &amp;nbsp; &#x41; &amp;copy;</a>');
  eq(result.escaped, 3);
  assert(wellFormed(result.text), 'well-formed');
});

test('xml clean: lone surrogates are removed but pairs survive', () => {
  const result = cleanChars('a\uD800b\uDC00c\uD83D\uDE00d');
  eq(result.text, 'abc\uD83D\uDE00d');
  eq(result.removed, 2);
});

test('xml clean: FFFE and FFFF are removed', () => {
  eq(cleanChars('x\uFFFEy\uFFFFz').text, 'xyz');
});

test('xml clean: clean text reports no change', () => {
  eq(cleanChars('<a>fine &amp; fine</a>').changed, false);
});

test('C18: a UTF-16 part decodes to UTF-8 text with a fixed declaration', () => {
  const text = '<?xml version="1.0" encoding="UTF-16"?><a>h\u00e9llo</a>';
  const le = new Uint8Array(2 + text.length * 2);
  le[0] = 0xff;
  le[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    le[2 + i * 2] = text.charCodeAt(i) & 0xff;
    le[3 + i * 2] = text.charCodeAt(i) >> 8;
  }
  const decoded = decodeXml(le);
  eq(decoded.reencoded, true);
  assert(decoded.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), decoded.text);
  assert(decoded.text.includes('h\u00e9llo'), 'content kept');
  assert(wellFormed(decoded.text), 'well-formed');
});

test('xml decode: UTF-16 BE and BOM-less UTF-16 are recognised', () => {
  const text = '<a>x</a>';
  const be = new Uint8Array(2 + text.length * 2);
  be[0] = 0xfe;
  be[1] = 0xff;
  for (let i = 0; i < text.length; i++) be[3 + i * 2] = text.charCodeAt(i);
  eq(decodeXml(be).text, text);
  const bomless = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) bomless[i * 2] = text.charCodeAt(i);
  eq(decodeXml(bomless).text, text);
});

test('xml decode: UTF-8 BOM is stripped and invalid bytes are counted', () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e]);
  const decoded = decodeXml(withBom);
  eq(decoded.text, '<a/>');
  eq(decoded.reencoded, false);
  const bad = new Uint8Array([0x3c, 0x61, 0x3e, 0xff, 0xfe, 0x80, 0x3c, 0x2f, 0x61, 0x3e]);
  assert(decodeXml(bad).invalid >= 1, 'invalid bytes counted');
});

test('xml decode: declaration fix handles both quote styles and leaves others alone', () => {
  eq(fixDeclaration('<?xml version="1.0" encoding=\'utf-16\'?><a/>'), '<?xml version="1.0" encoding=\'UTF-8\'?><a/>');
  eq(fixDeclaration('<?xml version="1.0"?><a/>'), '<?xml version="1.0"?><a/>');
  eq(fixDeclaration('<a/>'), '<a/>');
});

test('xml tree: parse and serialize keep structure, attributes and text', () => {
  const source = '<r xmlns:x="urn:x"><x:i id="1" k="a&amp;b">one<x:j/></x:i><!-- c --><i>two</i></r>';
  const tree = parseTree(source);
  const out = serializeTree(tree);
  assert(wellFormed(out), 'well-formed');
  eq(out, source);
});

test('xml tree: attribute reads decode entities and editing helpers work', () => {
  const tree = parseTree('<r><i k="a&amp;b"><c>x</c></i><i><c>y</c></i></r>');
  const items = descendants(tree, 'i');
  eq(getAttr(items[0], 'k'), 'a&b');
  unwrapNode(items[0]);
  removeNode(descendants(tree, 'i')[0]);
  eq(serializeTree(tree), '<r><c>x</c></r>');
  eq(textOf(documentElement(tree)), 'x');
});

test('xml tokens: scan and serialize round trip a document with a declaration', () => {
  const result = scan('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<a b="c">t</a>');
  eq(serializeTokens(result.tokens), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a b="c">t</a>');
});
