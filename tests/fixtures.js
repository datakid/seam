import { zipSync, unzipSync, strToU8, zlibSync } from '../vendor/fflate.module.js';
import { crc32 } from '../js/core/crc32.js';

export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['alpha', 'ledger', 'harbor', 'quarter', 'signal', 'margin', 'vector', 'summit', 'copper', 'lantern', 'meadow', 'thread', 'anchor', 'cipher', 'ember', 'fabric'];

export function words(seed, count) {
  const rand = prng(seed);
  const out = [];
  for (let i = 0; i < count; i++) out.push(WORDS[Math.floor(rand() * WORDS.length)]);
  return out.join(' ');
}

export function randomBytes(seed, length) {
  const rand = prng(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

function chunk(type, data) {
  const typeBytes = strToU8(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function tinyPng() {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = zlibSync(Uint8Array.from([0, 255, 94, 77]));
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
const PML = 'application/vnd.openxmlformats-officedocument.presentationml.';
const OFFICE = 'application/vnd.openxmlformats-officedocument.';

function rels(list) {
  const items = list.map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`).join('');
  return `${DECL}<Relationships xmlns="${NS_REL}">${items}</Relationships>`;
}

function types(defaults, overrides) {
  const d = defaults.map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`).join('');
  const o = overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('');
  return `${DECL}<Types xmlns="${NS_CT}">${d}${o}</Types>`;
}

const CORE = `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture</dc:title></cp:coreProperties>`;
const CORE_CT = 'application/vnd.openxmlformats-package.core-properties+xml';
const REL_CORE = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';

export function pack(entries) {
  const files = {};
  for (const [name, content] of entries) {
    const bytes = typeof content === 'string' ? strToU8(content) : content;
    const stored = /\.(png|jpe?g|gif)$/i.test(name);
    files[name] = [bytes, { level: stored ? 0 : 6, mtime: new Date(2026, 0, 2, 3, 4, 6) }];
  }
  return zipSync(files);
}

export function unpack(bytes) {
  const raw = unzipSync(bytes);
  return Object.keys(raw).map((name) => [name, raw[name]]);
}

export function docxEntries(macro = false) {
  const paragraphs = [];
  for (let i = 0; i < 14; i++) paragraphs.push(`<w:p><w:r><w:t>${words(100 + i, 12)}</w:t></w:r></w:p>`);
  const picture = `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Picture 1"/><a:graphic xmlns:a="${NS_A}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const body = [
    '<w:p><w:r><w:t>First paragraph of the fixture document.</w:t></w:r></w:p>',
    '<w:p><w:hyperlink r:id="rId3"><w:r><w:t>A link to the project page</w:t></w:r></w:hyperlink></w:p>',
    picture,
    '<w:p><w:r><w:t>Third paragraph, with a tab</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>and a line</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>break.</w:t></w:r></w:p>',
    ...paragraphs
  ].join('');
  const documentXml = `${DECL}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${body}</w:body></w:document>`;
  const docRels = [
    ['rId1', R + 'styles', 'styles.xml'],
    ['rId2', R + 'image', 'media/image1.png'],
    ['rId3', R + 'hyperlink', 'https://example.org/', 'External']
  ];
  if (macro) docRels.push(['rId4', 'http://schemas.microsoft.com/office/2006/relationships/vbaProject', 'vbaProject.bin']);
  const overrides = [
    ['/word/document.xml', macro ? 'application/vnd.ms-word.document.macroEnabled.main+xml' : WML + 'document.main+xml'],
    ['/word/styles.xml', WML + 'styles+xml'],
    ['/docProps/core.xml', CORE_CT]
  ];
  if (macro) overrides.push(['/word/vbaProject.bin', 'application/vnd.ms-office.vbaProject']);
  const entries = [
    ['[Content_Types].xml', types([['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['xml', 'application/xml'], ['png', 'image/png']], overrides)],
    ['_rels/.rels', rels([['rId1', R + 'officeDocument', 'word/document.xml'], ['rId2', REL_CORE, 'docProps/core.xml']])],
    ['word/document.xml', documentXml],
    ['word/_rels/document.xml.rels', rels(docRels)],
    ['word/styles.xml', `${DECL}<w:styles xmlns:w="${NS_W}"><w:docDefaults/></w:styles>`],
    ['docProps/core.xml', CORE],
    ['word/media/image1.png', tinyPng()]
  ];
  if (macro) entries.push(['word/vbaProject.bin', randomBytes(7, 1800)]);
  return entries;
}

export function docx() {
  return pack(docxEntries(false));
}

export function docm() {
  return pack(docxEntries(true));
}

export const SST = ['Item', 'Price', 'Total', 'Notes', 'Remark'];

export function xlsxEntries() {
  const rand = prng(21);
  let filler = '';
  for (let r = 4; r <= 44; r++) filler += `<row r="${r}"><c r="A${r}"><v>${Math.floor(rand() * 1000)}</v></c><c r="B${r}"><v>${Math.floor(rand() * 1000)}</v></c></row>`;
  const sheet1 = `${DECL}<worksheet xmlns="${NS_S}"><dimension ref="A1:C44"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2"><v>10</v></c><c r="B2"><v>20</v></c><c r="C2"><f>A2+B2</f><v>30</v></c></row><row r="3"><c r="A3"><v>7</v></c><c r="B3"><v>8</v></c></row>${filler}</sheetData></worksheet>`;
  const sheet2 = `${DECL}<worksheet xmlns="${NS_S}"><dimension ref="A1:A2"/><sheetData><row r="1"><c r="A1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c></row></sheetData></worksheet>`;
  const sst = `${DECL}<sst xmlns="${NS_S}" count="5" uniqueCount="5">${SST.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;
  const workbook = `${DECL}<workbook xmlns="${NS_S}" xmlns:r="${NS_R}"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="1">Notes!$A$1:$A$2</definedName></definedNames></workbook>`;
  const styles = `${DECL}<styleSheet xmlns="${NS_S}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;
  return [
    ['[Content_Types].xml', types([['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['xml', 'application/xml']], [
      ['/xl/workbook.xml', SML + 'sheet.main+xml'],
      ['/xl/worksheets/sheet1.xml', SML + 'worksheet+xml'],
      ['/xl/worksheets/sheet2.xml', SML + 'worksheet+xml'],
      ['/xl/sharedStrings.xml', SML + 'sharedStrings+xml'],
      ['/xl/styles.xml', SML + 'styles+xml'],
      ['/xl/calcChain.xml', SML + 'calcChain+xml'],
      ['/docProps/core.xml', CORE_CT]
    ])],
    ['_rels/.rels', rels([['rId1', R + 'officeDocument', 'xl/workbook.xml'], ['rId2', REL_CORE, 'docProps/core.xml']])],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', rels([['rId1', R + 'worksheet', 'worksheets/sheet1.xml'], ['rId2', R + 'worksheet', 'worksheets/sheet2.xml'], ['rId3', R + 'sharedStrings', 'sharedStrings.xml'], ['rId4', R + 'styles', 'styles.xml'], ['rId5', R + 'calcChain', 'calcChain.xml']])],
    ['xl/worksheets/sheet1.xml', sheet1],
    ['xl/worksheets/sheet2.xml', sheet2],
    ['xl/sharedStrings.xml', sst],
    ['xl/styles.xml', styles],
    ['xl/calcChain.xml', `${DECL}<calcChain xmlns="${NS_S}"><c r="C2" i="1"/></calcChain>`],
    ['docProps/core.xml', CORE]
  ];
}

export function xlsx() {
  return pack(xlsxEntries());
}

function shapeTree(text) {
  return `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${text}</p:spTree></p:cSld>`;
}

function slideShape(id, text) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

export function pptxEntries() {
  const nsDecl = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;
  const presentation = `${DECL}<p:presentation ${nsDecl}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const master = `${DECL}<p:sldMaster ${nsDecl}>${shapeTree('')}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst></p:sldMaster>`;
  const layout = (name) => `${DECL}<p:sldLayout ${nsDecl}>${shapeTree('').replace('<p:cSld>', `<p:cSld name="${name}">`)}</p:sldLayout>`;
  const slide = (n, extra) => `${DECL}<p:sld ${nsDecl}>${shapeTree(slideShape(2, `Slide ${n}: ${words(40 + n, 6)}`) + (extra || ''))}</p:sld>`;
  const picture = '<p:pic><p:nvPicPr><p:cNvPr id="3" name="Picture 3"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr/></p:pic>';
  const layoutRel = rels([['rId1', R + 'slideMaster', '../slideMasters/slideMaster1.xml']]);
  const slideRel = (extra) => rels([['rId1', R + 'slideLayout', '../slideLayouts/slideLayout1.xml'], ...(extra || [])]);
  return [
    ['[Content_Types].xml', types([['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['xml', 'application/xml'], ['png', 'image/png']], [
      ['/ppt/presentation.xml', PML + 'presentation.main+xml'],
      ['/ppt/slideMasters/slideMaster1.xml', PML + 'slideMaster+xml'],
      ['/ppt/slideLayouts/slideLayout1.xml', PML + 'slideLayout+xml'],
      ['/ppt/slideLayouts/slideLayout2.xml', PML + 'slideLayout+xml'],
      ['/ppt/slides/slide1.xml', PML + 'slide+xml'],
      ['/ppt/slides/slide2.xml', PML + 'slide+xml'],
      ['/ppt/slides/slide3.xml', PML + 'slide+xml'],
      ['/ppt/theme/theme1.xml', OFFICE + 'theme+xml'],
      ['/docProps/core.xml', CORE_CT]
    ])],
    ['_rels/.rels', rels([['rId1', R + 'officeDocument', 'ppt/presentation.xml'], ['rId2', REL_CORE, 'docProps/core.xml']])],
    ['ppt/presentation.xml', presentation],
    ['ppt/_rels/presentation.xml.rels', rels([['rId1', R + 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', R + 'slide', 'slides/slide1.xml'], ['rId3', R + 'slide', 'slides/slide2.xml'], ['rId4', R + 'slide', 'slides/slide3.xml'], ['rId5', R + 'theme', 'theme/theme1.xml']])],
    ['ppt/slideMasters/slideMaster1.xml', master],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', R + 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', R + 'slideLayout', '../slideLayouts/slideLayout2.xml'], ['rId3', R + 'theme', '../theme/theme1.xml']])],
    ['ppt/slideLayouts/slideLayout1.xml', layout('Title')],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', layoutRel],
    ['ppt/slideLayouts/slideLayout2.xml', layout('Content')],
    ['ppt/slideLayouts/_rels/slideLayout2.xml.rels', layoutRel],
    ['ppt/slides/slide1.xml', slide(1)],
    ['ppt/slides/_rels/slide1.xml.rels', slideRel()],
    ['ppt/slides/slide2.xml', slide(2, picture)],
    ['ppt/slides/_rels/slide2.xml.rels', slideRel([['rId2', R + 'image', '../media/image1.png']])],
    ['ppt/slides/slide3.xml', slide(3)],
    ['ppt/slides/_rels/slide3.xml.rels', slideRel()],
    ['ppt/theme/theme1.xml', `${DECL}<a:theme xmlns:a="${NS_A}" name="Fixture"><a:themeElements/></a:theme>`],
    ['docProps/core.xml', CORE],
    ['ppt/media/image1.png', tinyPng()]
  ];
}

export function pptx() {
  return pack(pptxEntries());
}

export const FORMATS = {
  docx: { build: docx, main: 'word/document.xml', ext: 'docx', image: 'word/media/image1.png' },
  xlsx: { build: xlsx, main: 'xl/workbook.xml', ext: 'xlsx', sheet: 'xl/worksheets/sheet1.xml' },
  pptx: { build: pptx, main: 'ppt/presentation.xml', ext: 'pptx', image: 'ppt/media/image1.png', slide: 'ppt/slides/slide1.xml' }
};

export const LAST_PART = { docx: 'word/media/image1.png', xlsx: 'docProps/core.xml', pptx: 'ppt/media/image1.png' };
export const TEXT_PART = { docx: 'word/document.xml', xlsx: 'xl/worksheets/sheet1.xml', pptx: 'ppt/slides/slide1.xml' };
