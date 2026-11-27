import { test, assert, eq } from './harness.js';
import { docxEntries, xlsxEntries, pptxEntries, pack } from './fixtures.js';
import { buildView } from '../js/core/preview.js';
import { buildExport, sheetCsv } from '../js/core/export.js';
import { unzipSync, strFromU8, strToU8 } from '../vendor/fflate.module.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function replacePart(entries, name, content) {
  return entries.map(([n, c]) => (n === name ? [n, content] : [n, c]));
}

function workbookWith(sheetsXml, names) {
  const entries = xlsxEntries().filter(([n]) => !/^xl\/worksheets\/|^xl\/sharedStrings|^xl\/workbook\.xml|^xl\/_rels\/workbook/.test(n));
  const sheets = names.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  entries.push(['xl/workbook.xml', `${DECL}<workbook xmlns="${S}" xmlns:r="${R}"><sheets>${sheets}</sheets></workbook>`]);
  entries.push(['xl/_rels/workbook.xml.rels', `${DECL}<Relationships xmlns="${REL}">${names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`]);
  sheetsXml.forEach((xml, i) => entries.push([`xl/worksheets/sheet${i + 1}.xml`, `${DECL}<worksheet xmlns="${S}"><sheetData>${xml}</sheetData></worksheet>`]));
  return entries;
}

function textOf(result) {
  return strFromU8(result.bytes);
}

test('preview: a document shows its first paragraphs, with tabs and line breaks as spaces', () => {
  const view = buildView(pack(docxEntries()));
  eq(view.kind, 'document');
  eq(view.lines[0], 'First paragraph of the fixture document.');
  eq(view.lines[2], 'Third paragraph, with a tab and a line break.');
  eq(view.lines.length, 12);
  assert(view.more > 0, 'more paragraphs than shown');
  eq(view.exports.text, true);
  eq(view.exports.media, true);
  eq(view.exports.csv, false);
});

test('preview: deleted text and tab stops do not appear in document text', () => {
  const body = `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Kept</w:t></w:r><w:del><w:r><w:delText>Gone</w:delText></w:r></w:del><w:r><w:t xml:space="preserve"> &amp; more</w:t></w:r></w:p>`;
  const entries = replacePart(docxEntries(), 'word/document.xml', `${DECL}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`);
  const out = buildExport('text', pack(entries), 'doc');
  eq(textOf(out), 'Kept & more\n');
});

test('preview: a text box is not read twice through its fallback', () => {
  const choice = '<w:p><w:r><w:t>Boxed</w:t></w:r></w:p>';
  const body = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="wps">${choice}</mc:Choice><mc:Fallback>${choice}</mc:Fallback></mc:AlternateContent>`;
  const entries = replacePart(docxEntries(), 'word/document.xml', `${DECL}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`);
  eq(textOf(buildExport('text', pack(entries), 'doc')), 'Boxed\n');
});

test('preview: a workbook shows its sheets in workbook order, with the first rows of each', () => {
  const entries = workbookWith(
    ['<row r="1"><c r="A1" t="inlineStr"><is><t>Second file first</t></is></c></row>', '<row r="1"><c r="A1" t="inlineStr"><is><t>Other</t></is></c></row>'],
    ['Zeta', 'Alpha']
  );
  const view = buildView(pack(entries));
  eq(view.kind, 'workbook');
  eq(view.sheets.map((s) => s.name), ['Zeta', 'Alpha']);
  eq(view.sheets[0].rows, [['Second file first']]);
  eq(view.exports.csv, true);
});

test('preview: cell types, gaps, entities and escapes read as the cell shows them', () => {
  const sst = `${DECL}<sst xmlns="${S}"><si><t>Shared &lt;one&gt;</t></si><si><r><t>Rich </t></r><r><t>text</t></r><rPh><t>ignored</t></rPh></si></sst>`;
  const sheet = '<row r="1"><c r="C1" t="s"><v>0</v></c><c r="D1" t="s"><v>1</v></c></row>' +
    '<row r="3"><c r="A3" t="b"><v>1</v></c><c r="B3" t="b"><v>0</v></c><c r="C3" t="e"><v>#DIV/0!</v></c><c r="D3" t="str"><v>formula text</v></c><c r="E3"><f>1+1</f><v>2</v></c><c r="F3" t="inlineStr"><is><t>a_x000D_b</t></is></c></row>';
  const entries = workbookWith([sheet], ['Data']);
  entries.push(['xl/sharedStrings.xml', sst]);
  const rows = buildView(pack(entries)).sheets[0].rows;
  eq(rows[0], ['', '', 'Shared <one>', 'Rich text']);
  eq(rows[1], ['TRUE', 'FALSE', '#DIV/0!', 'formula text', '2', 'a b']);
  eq(strFromU8(buildExport('csv', pack(entries), 'book').bytes).split('\r\n')[2], 'TRUE,FALSE,#DIV/0!,formula text,2,"a\rb"');
});

test('preview: a presentation lists slide titles in slide order, taking the title placeholder', () => {
  const slide = (title, first) => `${DECL}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${first}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>` +
    '</p:spTree></p:cSld></p:sld>';
  const entries = pptxEntries().filter(([n]) => !/^ppt\/slides\/slide\d+\.xml$/.test(n) && n !== 'ppt/presentation.xml' && n !== 'ppt/_rels/presentation.xml.rels');
  entries.push(['ppt/slides/slide1.xml', slide('Opening', 'body one')], ['ppt/slides/slide2.xml', slide('Closing', 'body two')]);
  entries.push(['ppt/presentation.xml', `${DECL}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:sldIdLst><p:sldId id="257" r:id="rId2"/><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`]);
  entries.push(['ppt/_rels/presentation.xml.rels', `${DECL}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${R}/slide" Target="/ppt/slides/slide2.xml"/></Relationships>`]);
  const view = buildView(pack(entries));
  eq(view.kind, 'presentation');
  eq(view.slides, [{ number: 1, title: 'Closing' }, { number: 2, title: 'Opening' }]);
  eq(textOf(buildExport('text', pack(entries), 'deck')), 'Slide 1\nbody two\nClosing\n\nSlide 2\nbody one\nOpening\n');
});

test('export: csv quotes commas, quotes and line breaks, keeps row gaps and starts with a byte order mark', () => {
  const sheet = '<row r="1"><c r="A1" t="inlineStr"><is><t>a,b</t></is></c><c r="B1" t="inlineStr"><is><t>say "hi"</t></is></c><c r="C1" t="inlineStr"><is><t>two&#10;lines</t></is></c></row><row r="4"><c r="B4"><v>5</v></c></row>';
  const out = buildExport('csv', pack(workbookWith([sheet], ['Data'])), 'book');
  eq(out.name, 'book - Data.csv');
  eq(out.mime, 'text/csv;charset=utf-8');
  eq([out.bytes[0], out.bytes[1], out.bytes[2]], [0xef, 0xbb, 0xbf]);
  eq(textOf(out), '"a,b","say ""hi""","two\nlines"\r\n\r\n\r\n,5\r\n');
  eq(sheetCsv([]), '');
});

test('export: several sheets come as one zip with safe, unique file names, and empty sheets are left out', () => {
  const cell = (t) => `<row r="1"><c r="A1" t="inlineStr"><is><t>${t}</t></is></c></row>`;
  const out = buildExport('csv', pack(workbookWith([cell('one'), cell('two'), '', cell('three')], ['A/B', 'A:B', 'Empty', 'Last'])), 'my:book');
  eq(out.name, 'my book sheets.zip');
  eq(Object.keys(unzipSync(out.bytes)).sort(), ['my book - A B (2).csv', 'my book - A B.csv', 'my book - Last.csv']);
});

test('export: media comes as one zip of the images, and nothing is offered when there are none', () => {
  const out = buildExport('media', pack(docxEntries()), 'report');
  eq(out.name, 'report media.zip');
  eq(Object.keys(unzipSync(out.bytes)), ['image1.png']);
  eq(buildExport('media', pack(xlsxEntries()), 'book'), null);
  eq(buildExport('csv', pack(docxEntries()), 'report'), null);
});

test('export: bytes that are not a package give nothing', () => {
  eq(buildView(strToU8('not a zip at all')), null);
  eq(buildExport('text', strToU8('not a zip at all'), 'x'), null);
});

test('preview: past the size guard a package gets no preview but keeps its image export', () => {
  eq(buildView(new Uint8Array(67108865)), null);
  const view = buildView(pack([...docxEntries(), ['word/media/big.png', new Uint8Array(67108864)]]));
  eq(view, { kind: 'document', large: true, more: 0, exports: { text: false, csv: false, media: true } });
  const plain = buildView(pack([...xlsxEntries(), ['xl/embeddings/big.png', new Uint8Array(67108864)]]));
  eq(plain.exports, { text: false, csv: false, media: false });
});
