import { test, assert, eq, env } from './harness.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';
import { docxEntries, xlsxEntries, pptxEntries, pack, randomBytes } from './fixtures.js';
import { deleteDirectory } from './corrupt.js';
import { PARTS, FORMATS, DEFAULT_TYPES, rowOfKind, rowsOfRelType, rowOfContentType, rowsOfRoot, rowOfPath, overrideTypeFor, toTransitionalNs, toStrictNs, mainRow } from '../js/core/registry.js';
import { CT_MAIN, CT_DEFAULTS, FAMILY_KEYS, STANDARD_KEYS, MAIN_PARTS, OUTPUT_MIME, CT_VBA, REL_VBA, REL_OFFICE_DOC, REL_OFFICE_DOC_STRICT } from '../js/core/constants.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const REL_STRICT = 'http://purl.oclc.org/ooxml/officeDocument/relationships/';

test('parts: every row has a unique kind and the full set of fields', () => {
  const seen = new Set();
  for (const row of PARTS) {
    assert(!seen.has(row.kind), `duplicate kind ${row.kind}`);
    seen.add(row.kind);
    for (const field of ['kind', 'family', 'contentType', 'contentTypeAlt', 'relType', 'relTypeStrict', 'path', 'pathPattern', 'root', 'source', 'required', 'content']) {
      assert(field in row, `${row.kind} lacks ${field}`);
    }
    assert(['docx', 'xlsx', 'pptx', 'shared'].includes(row.family), `${row.kind} family ${row.family}`);
    assert(Array.isArray(row.source) && Array.isArray(row.contentTypeAlt), `${row.kind} list fields`);
    assert(!(row.path && row.pathPattern), `${row.kind} has both a path and a pattern`);
  }
  assert(PARTS.length >= 70, `only ${PARTS.length} rows`);
});

test('parts: the rows the plan requires are all present', () => {
  const need = [
    'wordDocument', 'wordStyles', 'wordNumbering', 'wordSettings', 'wordFontTable', 'wordWebSettings', 'wordFootnotes', 'wordEndnotes', 'wordComments', 'wordCommentsExtended', 'wordCommentsIds', 'wordCommentsExtensible', 'wordHeader', 'wordFooter', 'wordGlossary',
    'xlWorkbook', 'xlWorksheet', 'xlChartsheet', 'xlSharedStrings', 'xlStyles', 'xlCalcChain', 'xlTable', 'xlPivotTable', 'xlPivotCacheDefinition', 'xlPivotCacheRecords', 'xlExternalLink', 'xlDrawing', 'vmlDrawing', 'xlThreadedComments',
    'pptPresentation', 'pptSlide', 'pptSlideLayout', 'pptSlideMaster', 'pptNotesSlide', 'pptNotesMaster', 'pptHandoutMaster', 'pptPresProps', 'pptViewProps', 'pptTableStyles', 'pptModernComments',
    'theme', 'chart', 'chartStyle', 'chartColorStyle', 'diagramData', 'diagramLayout', 'diagramStyle', 'diagramColors', 'diagramDrawing', 'image', 'audio', 'video', 'oleObject', 'embeddedPackage', 'activeX',
    'customXmlItem', 'customXmlProps', 'coreProperties', 'extendedProperties', 'customProperties', 'thumbnail', 'vbaProject', 'vbaData', 'digitalSignatureOrigin', 'digitalSignature', 'customUI'
  ];
  for (const kind of need) assert(rowOfKind(kind), `missing row ${kind}`);
});

test('parts: every relationship type resolves in its transitional and its strict form', () => {
  for (const row of PARTS) {
    if (!row.relType) continue;
    assert(rowsOfRelType(row.relType).includes(row), `${row.kind} transitional type does not resolve`);
    if (row.relType.startsWith(REL) && row.kind !== 'vbaProject') {
      assert(row.relTypeStrict && row.relTypeStrict.startsWith(REL_STRICT), `${row.kind} has no strict type`);
      assert(rowsOfRelType(row.relTypeStrict).includes(row), `${row.kind} strict type does not resolve`);
    } else {
      assert(row.relTypeStrict === null, `${row.kind} strict type should be null`);
    }
  }
});

test('parts: every source names a row or the package', () => {
  for (const row of PARTS) for (const source of row.source) assert(source === 'package' || rowOfKind(source), `${row.kind} source ${source}`);
});

test('parts: every content type the v1 code used is in the table', () => {
  const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
  const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
  const PML = 'application/vnd.openxmlformats-officedocument.presentationml.';
  const OFFICE = 'application/vnd.openxmlformats-officedocument.';
  const used = [
    ...Object.values(CT_MAIN),
    WML + 'styles+xml', WML + 'numbering+xml', WML + 'settings+xml', WML + 'fontTable+xml', WML + 'webSettings+xml', WML + 'header+xml', WML + 'footer+xml', WML + 'footnotes+xml', WML + 'endnotes+xml', WML + 'comments+xml',
    OFFICE + 'theme+xml', SML + 'worksheet+xml', SML + 'sharedStrings+xml', SML + 'styles+xml', SML + 'calcChain+xml', OFFICE + 'drawing+xml', OFFICE + 'drawingml.chart+xml',
    PML + 'slide+xml', PML + 'slideLayout+xml', PML + 'slideMaster+xml', PML + 'notesSlide+xml', PML + 'notesMaster+xml', PML + 'presProps+xml', PML + 'viewProps+xml', PML + 'tableStyles+xml',
    'application/vnd.openxmlformats-package.core-properties+xml', OFFICE + 'extended-properties+xml', CT_VBA
  ];
  for (const type of used) assert(rowOfContentType(type), `not in the table: ${type}`);
  for (const type of Object.values(CT_DEFAULTS)) assert(typeof type === 'string' && type.includes('/'), `bad default ${type}`);
});

test('parts: the derived constants keep their v1 values', () => {
  eq(FAMILY_KEYS, { docx: ['docx', 'docm', 'dotx', 'dotm'], xlsx: ['xlsx', 'xlsm', 'xltx', 'xltm'], pptx: ['pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm'] });
  eq(STANDARD_KEYS, ['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm']);
  eq(MAIN_PARTS, { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' });
  eq(CT_MAIN.docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml');
  eq(CT_MAIN.ppsm, 'application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml');
  eq(OUTPUT_MIME.xltm, 'application/vnd.ms-excel.template.macroEnabled.12');
  eq(OUTPUT_MIME.pptx, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  eq(CT_VBA, 'application/vnd.ms-office.vbaProject');
  eq(REL_VBA, 'http://schemas.microsoft.com/office/2006/relationships/vbaProject');
  eq(REL_OFFICE_DOC, `${REL}officeDocument`);
  eq(REL_OFFICE_DOC_STRICT, `${REL_STRICT}officeDocument`);
  eq(FORMATS.length, 14);
});

test('parts: the main row of each family lists the other variants as alternatives', () => {
  for (const family of ['docx', 'xlsx', 'pptx']) {
    const row = mainRow(family);
    const others = FORMATS.filter((format) => format.family === family).map((format) => format.contentType).filter((type) => type !== row.contentType);
    eq([...row.contentTypeAlt].sort(), others.sort());
    for (const type of [row.contentType, ...row.contentTypeAlt]) assert(rowOfContentType(type) === row, `${type} does not resolve to ${row.kind}`);
  }
});

test('parts: paths and patterns find the right row, and a part with a type gets an override', () => {
  const cases = [
    ['word/document.xml', 'wordDocument'], ['word/styles.xml', 'wordStyles'], ['word/fontTable.xml', 'wordFontTable'], ['word/header2.xml', 'wordHeader'], ['word/footer1.xml', 'wordFooter'],
    ['xl/workbook.xml', 'xlWorkbook'], ['xl/worksheets/sheet12.xml', 'xlWorksheet'], ['xl/tables/table1.xml', 'xlTable'], ['xl/pivotCache/pivotCacheRecords1.xml', 'xlPivotCacheRecords'],
    ['ppt/slides/slide3.xml', 'pptSlide'], ['ppt/slideLayouts/slideLayout11.xml', 'pptSlideLayout'], ['ppt/notesMasters/notesMaster1.xml', 'pptNotesMaster'],
    ['word/theme/theme1.xml', 'theme'], ['ppt/charts/chart4.xml', 'chart'], ['ppt/charts/style1.xml', 'chartStyle'], ['xl/diagrams/data1.xml', 'diagramData'],
    ['word/media/image1.png', 'image'], ['ppt/media/media1.avi', 'video'], ['ppt/media/audio1.mp3', 'audio'], ['xl/embeddings/oleObject1.bin', 'oleObject'], ['xl/drawings/vmlDrawing1.vml', 'vmlDrawing'],
    ['docProps/core.xml', 'coreProperties'], ['docProps/app.xml', 'extendedProperties'], ['word/vbaProject.bin', 'vbaProject'], ['customXml/itemProps1.xml', 'customXmlProps'], ['[Content_Types].xml', 'contentTypes']
  ];
  for (const [path, kind] of cases) {
    const row = rowOfPath(path);
    assert(row && row.kind === kind, `${path} -> ${row && row.kind}, wanted ${kind}`);
  }
  eq(rowOfPath('word/unknown/thing.xml'), null);
  eq(overrideTypeFor('word/document.xml'), null);
  eq(overrideTypeFor('_rels/.rels'), null);
  eq(overrideTypeFor('word/media/image1.png'), null);
  eq(overrideTypeFor('xl/worksheets/sheet1.xml'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');
  eq(overrideTypeFor('word/vbaProject.bin'), CT_VBA);
  eq(overrideTypeFor('xl/theme/theme.xml'), null);
  eq(rowOfPath('xl/theme/theme.xml').kind, 'themeBare');
  assert(rowOfPath('xl/theme/theme.xml').borrow, 'bare theme stays borrowable');
});

test('parts: a root element is found by name and namespace in both namespace families, and the font table root is fonts', () => {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const wStrict = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
  eq(toTransitionalNs(wStrict), w);
  eq(toStrictNs(w), wStrict);
  eq(toTransitionalNs(toStrictNs('http://schemas.openxmlformats.org/drawingml/2006/chart')), 'http://schemas.openxmlformats.org/drawingml/2006/chart');
  eq(toStrictNs('urn:other'), 'urn:other');
  eq(rowsOfRoot('fonts', w)[0].kind, 'wordFontTable');
  eq(rowsOfRoot('fonts', wStrict)[0].kind, 'wordFontTable');
  eq(rowsOfRoot('styles', w).map((row) => row.kind), ['wordStyles', 'wordStylesWithEffects']);
  eq(rowsOfRoot('fontTable', w), []);
  eq(rowsOfRoot('document', 'urn:other'), []);
});

test('parts: the parts the fixtures write are all known to the table', () => {
  for (const entries of [docxEntries(), docxEntries(true), xlsxEntries(), pptxEntries()]) {
    for (const [name] of entries) {
      if (/\.(rels)$/i.test(name)) continue;
      const row = rowOfPath(name);
      assert(row, `no row for ${name}`);
    }
  }
});

test('parts: a part type with no default, such as .avi, gets one and the repair is kept', async () => {
  const entries = pptxEntries().concat([['ppt/media/video1.avi', randomBytes(11, 3000)]]);
  const original = pack(entries);
  const result = await runPipeline({ name: 'show.pptx', size: original.length, buffer: deleteDirectory(original).slice().buffer }, env);
  assert(result.output, `no output: ${JSON.stringify(result.findings.map((f) => f.code))}`);
  const bytes = new Uint8Array(result.output.bytes);
  const verdict = await verifyPackage(bytes, env, { key: 'pptx', ext: 'pptx' });
  assert(verdict.ok, `verification failed: ${JSON.stringify(verdict.failed)}`);
  const types = strFromU8(unzipSync(bytes)['[Content_Types].xml']);
  assert(types.includes('Extension="avi"') || types.includes('PartName="/ppt/media/video1.avi"'), 'no type for the avi part');
  assert(DEFAULT_TYPES.avi, 'registry has no avi default');
});
