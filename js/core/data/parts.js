const NS = 'http://schemas.openxmlformats.org/';
const W = `${NS}wordprocessingml/2006/main`;
const S = `${NS}spreadsheetml/2006/main`;
const P = `${NS}presentationml/2006/main`;
const A = `${NS}drawingml/2006/main`;
const C = `${NS}drawingml/2006/chart`;
const DGM = `${NS}drawingml/2006/diagram`;
const XDR = `${NS}drawingml/2006/spreadsheetDrawing`;
const MS = 'http://schemas.microsoft.com/office/';

const REL = `${NS}officeDocument/2006/relationships/`;
const REL_STRICT = 'http://purl.oclc.org/ooxml/officeDocument/relationships/';
const PKG_REL = `${NS}package/2006/relationships/`;

const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
const PML = 'application/vnd.openxmlformats-officedocument.presentationml.';
const OFFICE = 'application/vnd.openxmlformats-officedocument.';
const PKG = 'application/vnd.openxmlformats-package.';

function office(name, strictName = name) {
  return { relType: REL + name, relTypeStrict: REL_STRICT + strictName };
}

function microsoft(relType) {
  return { relType, relTypeStrict: null };
}

function part(kind, family, fields) {
  return {
    kind,
    family,
    contentType: null,
    contentTypeAlt: [],
    relType: null,
    relTypeStrict: null,
    relTypeAlt: [],
    path: null,
    pathPattern: null,
    root: null,
    source: [],
    required: false,
    content: true,
    main: false,
    borrow: false,
    borrowRels: false,
    ...fields
  };
}

export const FORMATS = [
  { key: 'docx', family: 'docx', contentType: `${WML}document.main+xml`, outputMime: `${WML}document`, standard: true, macro: false, template: false },
  { key: 'docm', family: 'docx', contentType: 'application/vnd.ms-word.document.macroEnabled.main+xml', outputMime: 'application/vnd.ms-word.document.macroEnabled.12', standard: true, macro: true, template: false },
  { key: 'dotx', family: 'docx', contentType: `${WML}template.main+xml`, outputMime: `${WML}template`, standard: false, macro: false, template: true },
  { key: 'dotm', family: 'docx', contentType: 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml', outputMime: 'application/vnd.ms-word.template.macroEnabled.12', standard: false, macro: true, template: true },
  { key: 'xlsx', family: 'xlsx', contentType: `${SML}sheet.main+xml`, outputMime: `${SML}sheet`, standard: true, macro: false, template: false },
  { key: 'xlsm', family: 'xlsx', contentType: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml', outputMime: 'application/vnd.ms-excel.sheet.macroEnabled.12', standard: true, macro: true, template: false },
  { key: 'xltx', family: 'xlsx', contentType: `${SML}template.main+xml`, outputMime: `${SML}template`, standard: false, macro: false, template: true },
  { key: 'xltm', family: 'xlsx', contentType: 'application/vnd.ms-excel.template.macroEnabled.main+xml', outputMime: 'application/vnd.ms-excel.template.macroEnabled.12', standard: false, macro: true, template: true },
  { key: 'pptx', family: 'pptx', contentType: `${PML}presentation.main+xml`, outputMime: `${PML}presentation`, standard: true, macro: false, template: false },
  { key: 'pptm', family: 'pptx', contentType: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml', outputMime: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12', standard: true, macro: true, template: false },
  { key: 'potx', family: 'pptx', contentType: `${PML}template.main+xml`, outputMime: `${PML}template`, standard: false, macro: false, template: true },
  { key: 'potm', family: 'pptx', contentType: 'application/vnd.ms-powerpoint.template.macroEnabled.main+xml', outputMime: 'application/vnd.ms-powerpoint.template.macroEnabled.12', standard: false, macro: true, template: true },
  { key: 'ppsx', family: 'pptx', contentType: `${PML}slideshow.main+xml`, outputMime: `${PML}slideshow`, standard: false, macro: false, template: false },
  { key: 'ppsm', family: 'pptx', contentType: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml', outputMime: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12', standard: false, macro: true, template: false }
];

export const DEFAULT_TYPES = {
  rels: `${PKG}relationships+xml`,
  xml: 'application/xml',
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
  svg: 'image/svg+xml',
  wdp: 'image/vnd.ms-photo',
  bin: `${OFFICE}oleObject`,
  vml: `${OFFICE}vmlDrawing`,
  odttf: `${OFFICE}obfuscatedFont`,
  fntdata: 'application/x-fontdata',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/avi',
  wmv: 'video/x-ms-wmv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
  m4a: 'audio/mp4',
  mid: 'audio/mid',
  xlsx: `${SML}sheet`,
  docx: `${WML}document`,
  pptx: `${PML}presentation`
};

const mainAlt = (family) => FORMATS.filter((f) => f.family === family && f.contentType !== FORMATS.find((g) => g.family === family).contentType).map((f) => f.contentType);

export const PARTS = [
  part('contentTypes', 'shared', {
    path: '[Content_Types].xml',
    root: { ns: `${NS}package/2006/content-types`, name: 'Types' },
    source: ['package'],
    required: true,
    content: false
  }),
  part('relationships', 'shared', {
    contentType: `${PKG}relationships+xml`,
    pathPattern: /\.rels$/i,
    root: { ns: `${NS}package/2006/relationships`, name: 'Relationships' },
    content: false
  }),
  part('coreProperties', 'shared', {
    contentType: `${PKG}core-properties+xml`,
    relType: `${PKG_REL}metadata/core-properties`,
    relTypeAlt: [`${NS}officedocument/2006/relationships/metadata/core-properties`],
    path: 'docProps/core.xml',
    root: { ns: `${NS}package/2006/metadata/core-properties`, name: 'coreProperties' },
    source: ['package'],
    content: false
  }),
  part('extendedProperties', 'shared', {
    contentType: `${OFFICE}extended-properties+xml`,
    ...office('extended-properties', 'extendedProperties'),
    path: 'docProps/app.xml',
    root: { ns: `${NS}officeDocument/2006/extended-properties`, name: 'Properties' },
    source: ['package'],
    content: false
  }),
  part('customProperties', 'shared', {
    contentType: `${OFFICE}custom-properties+xml`,
    ...office('custom-properties', 'customProperties'),
    path: 'docProps/custom.xml',
    root: { ns: `${NS}officeDocument/2006/custom-properties`, name: 'Properties' },
    source: ['package'],
    content: false
  }),
  part('thumbnail', 'shared', {
    relType: `${PKG_REL}metadata/thumbnail`,
    pathPattern: /^docProps\/thumbnail\.(jpe?g|png|emf|wmf)$/i,
    source: ['package'],
    content: false
  }),
  part('digitalSignatureOrigin', 'shared', {
    contentType: `${PKG}digital-signature-origin`,
    relType: `${PKG_REL}digital-signature/origin`,
    path: '_xmlsignatures/origin.sigs',
    source: ['package'],
    content: false
  }),
  part('digitalSignature', 'shared', {
    contentType: `${PKG}digital-signature-xmlsignature+xml`,
    relType: `${PKG_REL}digital-signature/signature`,
    pathPattern: /^_xmlsignatures\/sig\d+\.xml$/i,
    root: { ns: 'http://www.w3.org/2000/09/xmldsig#', name: 'Signature' },
    source: ['digitalSignatureOrigin'],
    content: false
  }),
  part('vbaProject', 'shared', {
    contentType: 'application/vnd.ms-office.vbaProject',
    ...microsoft(`${MS}2006/relationships/vbaProject`),
    pathPattern: /^(word|xl|ppt)\/vbaProject\.bin$/i,
    source: ['wordDocument', 'xlWorkbook', 'pptPresentation'],
    content: false
  }),
  part('vbaProjectSignature', 'shared', {
    contentType: 'application/vnd.ms-office.vbaProjectSignature',
    ...microsoft(`${MS}2014/relationships/vbaProjectSignature`),
    pathPattern: /^(word|xl|ppt)\/vbaProjectSignature\.bin$/i,
    source: ['vbaProject'],
    content: false
  }),
  part('vbaData', 'docx', {
    contentType: 'application/vnd.ms-word.vbaData+xml',
    ...microsoft(`${MS}2006/relationships/wordVbaData`),
    path: 'word/vbaData.xml',
    root: { ns: 'http://schemas.microsoft.com/office/word/2006/wordml', name: 'vbaSuppData' },
    source: ['wordDocument'],
    content: false
  }),
  part('customUI', 'shared', {
    ...microsoft(`${MS}2006/relationships/ui/extensibility`),
    pathPattern: /^customUI\/customUI\.xml$/i,
    root: { ns: `${MS}2006/01/customui`, name: 'customUI' },
    source: ['package'],
    content: false
  }),
  part('customUI14', 'shared', {
    ...microsoft(`${MS}2007/relationships/ui/extensibility`),
    pathPattern: /^customUI\/customUI14\.xml$/i,
    root: { ns: `${MS}2009/07/customui`, name: 'customUI' },
    source: ['package'],
    content: false
  }),
  part('customXmlItem', 'shared', {
    ...office('customXml'),
    pathPattern: /^customXml\/item\d+\.xml$/i,
    source: ['wordDocument', 'xlWorkbook', 'pptPresentation'],
    content: false
  }),
  part('customXmlProps', 'shared', {
    contentType: `${OFFICE}customXmlProperties+xml`,
    ...office('customXmlProps'),
    pathPattern: /^customXml\/itemProps\d+\.xml$/i,
    root: { ns: `${NS}officeDocument/2006/customXml`, name: 'datastoreItem' },
    source: ['customXmlItem'],
    content: false
  }),
  part('theme', 'shared', {
    contentType: `${OFFICE}theme+xml`,
    ...office('theme'),
    pathPattern: /^(word|xl|ppt)\/theme\/theme\d+\.xml$/i,
    root: { ns: A, name: 'theme' },
    source: ['wordDocument', 'xlWorkbook', 'pptPresentation', 'pptSlideMaster', 'pptNotesMaster', 'pptHandoutMaster'],
    content: false,
    borrow: true
  }),
  part('themeBare', 'shared', {
    ...office('theme'),
    pathPattern: /^(word|xl|ppt)\/theme\/theme\.xml$/i,
    root: { ns: A, name: 'theme' },
    source: ['wordDocument', 'xlWorkbook', 'pptPresentation'],
    content: false,
    borrow: true
  }),
  part('themeOverride', 'shared', {
    contentType: `${OFFICE}themeOverride+xml`,
    ...office('themeOverride'),
    pathPattern: /^(word|xl|ppt)\/theme\/themeOverride\d+\.xml$/i,
    root: { ns: A, name: 'themeOverride' },
    source: ['chart'],
    content: false
  }),
  part('image', 'shared', {
    ...office('image'),
    pathPattern: /^(word|xl|ppt)\/media\/[^/]+\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|wdp)$/i,
    source: ['wordDocument', 'wordHeader', 'wordFooter', 'xlDrawing', 'vmlDrawing', 'pptSlide', 'pptSlideLayout', 'pptSlideMaster', 'pptNotesSlide', 'chart']
  }),
  part('audio', 'shared', {
    ...office('audio'),
    pathPattern: /^(word|xl|ppt)\/media\/[^/]+\.(mp3|wav|wma|m4a|mid)$/i,
    source: ['pptSlide']
  }),
  part('video', 'shared', {
    ...office('video'),
    pathPattern: /^(word|xl|ppt)\/media\/[^/]+\.(mp4|m4v|mov|avi|wmv|mpe?g)$/i,
    source: ['pptSlide']
  }),
  part('media', 'shared', {
    ...microsoft(`${MS}2007/relationships/media`),
    pathPattern: /^(word|xl|ppt)\/media\/[^/]+\.(mp3|wav|wma|m4a|mid|mp4|m4v|mov|avi|wmv|mpe?g)$/i,
    source: ['pptSlide']
  }),
  part('oleObject', 'shared', {
    ...office('oleObject'),
    pathPattern: /^(word|xl|ppt)\/embeddings\/oleObject\d+\.bin$/i,
    source: ['wordDocument', 'xlWorksheet', 'vmlDrawing', 'pptSlide']
  }),
  part('embeddedPackage', 'shared', {
    ...office('package'),
    pathPattern: /^(word|xl|ppt)\/embeddings\/[^/]+\.(xlsx|docx|pptx|xlsm|docm|pptm)$/i,
    source: ['wordDocument', 'xlWorksheet', 'chart', 'pptSlide']
  }),
  part('activeX', 'shared', {
    contentType: 'application/vnd.ms-office.activeX+xml',
    ...office('control'),
    pathPattern: /^(word|xl|ppt)\/activeX\/activeX\d+\.xml$/i,
    root: { ns: `${MS}2006/activeX`, name: 'ocx' },
    source: ['wordDocument', 'xlWorksheet', 'pptSlide']
  }),
  part('activeXBinary', 'shared', {
    contentType: 'application/vnd.ms-office.activeX',
    ...microsoft(`${MS}2006/relationships/activeXControlBinary`),
    pathPattern: /^(word|xl|ppt)\/activeX\/activeX\d+\.bin$/i,
    source: ['activeX']
  }),
  part('fontEmbedded', 'docx', {
    contentType: `${OFFICE}obfuscatedFont`,
    ...office('font'),
    pathPattern: /^word\/fonts\/[^/]+\.odttf$/i,
    source: ['wordFontTable']
  }),
  part('vmlDrawing', 'shared', {
    contentType: `${OFFICE}vmlDrawing`,
    ...office('vmlDrawing'),
    pathPattern: /^(word|xl|ppt)\/drawings\/[^/]*\.vml$/i,
    source: ['wordDocument', 'wordHeader', 'wordFooter', 'xlWorksheet', 'pptSlide']
  }),
  part('chart', 'shared', {
    contentType: `${OFFICE}drawingml.chart+xml`,
    ...office('chart'),
    pathPattern: /^(word|xl|ppt)\/charts\/chart\d+\.xml$/i,
    root: { ns: C, name: 'chartSpace' },
    source: ['wordDocument', 'xlDrawing', 'xlChartsheet', 'pptSlide']
  }),
  part('chartStyle', 'shared', {
    contentType: 'application/vnd.ms-office.chartstyle+xml',
    ...microsoft(`${MS}2011/relationships/chartStyle`),
    pathPattern: /^(word|xl|ppt)\/charts\/style\d+\.xml$/i,
    root: { ns: `${MS}drawing/2012/chartStyle`, name: 'chartStyle' },
    source: ['chart'],
    content: false
  }),
  part('chartColorStyle', 'shared', {
    contentType: 'application/vnd.ms-office.chartcolorstyle+xml',
    ...microsoft(`${MS}2011/relationships/chartColorStyle`),
    pathPattern: /^(word|xl|ppt)\/charts\/colors\d+\.xml$/i,
    root: { ns: `${MS}drawing/2012/chartStyle`, name: 'colorStyle' },
    source: ['chart'],
    content: false
  }),
  part('chartUserShapes', 'shared', {
    contentType: `${OFFICE}drawingml.chartshapes+xml`,
    ...office('chartUserShapes'),
    root: { ns: C, name: 'userShapes' },
    source: ['chart']
  }),
  part('diagramData', 'shared', {
    contentType: `${OFFICE}drawingml.diagramData+xml`,
    ...office('diagramData'),
    pathPattern: /^(word|xl|ppt)\/diagrams\/data\d+\.xml$/i,
    root: { ns: DGM, name: 'dataModel' },
    source: ['wordDocument', 'xlDrawing', 'pptSlide']
  }),
  part('diagramLayout', 'shared', {
    contentType: `${OFFICE}drawingml.diagramLayout+xml`,
    ...office('diagramLayout'),
    pathPattern: /^(word|xl|ppt)\/diagrams\/layout\d+\.xml$/i,
    root: { ns: DGM, name: 'layoutDef' },
    source: ['wordDocument', 'xlDrawing', 'pptSlide'],
    content: false
  }),
  part('diagramStyle', 'shared', {
    contentType: `${OFFICE}drawingml.diagramStyle+xml`,
    ...office('diagramQuickStyle'),
    pathPattern: /^(word|xl|ppt)\/diagrams\/quickStyle\d+\.xml$/i,
    root: { ns: DGM, name: 'styleDef' },
    source: ['wordDocument', 'xlDrawing', 'pptSlide'],
    content: false
  }),
  part('diagramColors', 'shared', {
    contentType: `${OFFICE}drawingml.diagramColors+xml`,
    ...office('diagramColors'),
    pathPattern: /^(word|xl|ppt)\/diagrams\/colors\d+\.xml$/i,
    root: { ns: DGM, name: 'colorsDef' },
    source: ['wordDocument', 'xlDrawing', 'pptSlide'],
    content: false
  }),
  part('diagramDrawing', 'shared', {
    contentType: 'application/vnd.ms-office.drawingml.diagramDrawing+xml',
    ...microsoft(`${MS}2007/relationships/diagramDrawing`),
    pathPattern: /^(word|xl|ppt)\/diagrams\/drawing\d+\.xml$/i,
    root: { ns: `${MS}drawing/2008/diagram`, name: 'drawing' },
    source: ['wordDocument', 'xlDrawing', 'pptSlide']
  }),

  part('wordDocument', 'docx', {
    contentType: FORMATS[0].contentType,
    contentTypeAlt: mainAlt('docx'),
    ...office('officeDocument'),
    path: 'word/document.xml',
    root: { ns: W, name: 'document' },
    source: ['package'],
    required: true,
    main: true
  }),
  part('wordStyles', 'docx', {
    contentType: `${WML}styles+xml`,
    ...office('styles'),
    path: 'word/styles.xml',
    root: { ns: W, name: 'styles' },
    source: ['wordDocument', 'wordGlossary'],
    content: false,
    borrow: true
  }),
  part('wordStylesWithEffects', 'docx', {
    contentType: 'application/vnd.ms-word.stylesWithEffects+xml',
    ...microsoft(`${MS}2007/relationships/stylesWithEffects`),
    path: 'word/stylesWithEffects.xml',
    root: { ns: W, name: 'styles' },
    source: ['wordDocument'],
    content: false,
    borrow: true
  }),
  part('wordNumbering', 'docx', {
    contentType: `${WML}numbering+xml`,
    ...office('numbering'),
    path: 'word/numbering.xml',
    root: { ns: W, name: 'numbering' },
    source: ['wordDocument', 'wordGlossary'],
    content: false,
    borrow: true
  }),
  part('wordSettings', 'docx', {
    contentType: `${WML}settings+xml`,
    ...office('settings'),
    path: 'word/settings.xml',
    root: { ns: W, name: 'settings' },
    source: ['wordDocument', 'wordGlossary'],
    content: false,
    borrow: true
  }),
  part('wordFontTable', 'docx', {
    contentType: `${WML}fontTable+xml`,
    ...office('fontTable'),
    path: 'word/fontTable.xml',
    root: { ns: W, name: 'fonts' },
    source: ['wordDocument', 'wordGlossary'],
    content: false,
    borrow: true
  }),
  part('wordWebSettings', 'docx', {
    contentType: `${WML}webSettings+xml`,
    ...office('webSettings'),
    path: 'word/webSettings.xml',
    root: { ns: W, name: 'webSettings' },
    source: ['wordDocument', 'wordGlossary'],
    content: false,
    borrow: true
  }),
  part('wordFootnotes', 'docx', {
    contentType: `${WML}footnotes+xml`,
    ...office('footnotes'),
    path: 'word/footnotes.xml',
    root: { ns: W, name: 'footnotes' },
    source: ['wordDocument']
  }),
  part('wordEndnotes', 'docx', {
    contentType: `${WML}endnotes+xml`,
    ...office('endnotes'),
    path: 'word/endnotes.xml',
    root: { ns: W, name: 'endnotes' },
    source: ['wordDocument']
  }),
  part('wordComments', 'docx', {
    contentType: `${WML}comments+xml`,
    ...office('comments'),
    path: 'word/comments.xml',
    root: { ns: W, name: 'comments' },
    source: ['wordDocument']
  }),
  part('wordCommentsExtended', 'docx', {
    contentType: `${WML}commentsExtended+xml`,
    ...microsoft(`${MS}2011/relationships/commentsExtended`),
    path: 'word/commentsExtended.xml',
    root: { ns: `${MS}word/2012/wordml`, name: 'commentsEx' },
    source: ['wordDocument']
  }),
  part('wordCommentsIds', 'docx', {
    contentType: `${WML}commentsIds+xml`,
    ...microsoft(`${MS}2016/09/relationships/commentsIds`),
    path: 'word/commentsIds.xml',
    root: { ns: `${MS}word/2016/wordml/cid`, name: 'commentsIds' },
    source: ['wordDocument']
  }),
  part('wordCommentsExtensible', 'docx', {
    contentType: `${WML}commentsExtensible+xml`,
    ...microsoft(`${MS}2018/08/relationships/commentsExtensible`),
    path: 'word/commentsExtensible.xml',
    root: { ns: `${MS}word/2018/wordml/cex`, name: 'commentsExtensible' },
    source: ['wordDocument']
  }),
  part('wordPeople', 'docx', {
    contentType: `${WML}people+xml`,
    ...microsoft(`${MS}2011/relationships/people`),
    path: 'word/people.xml',
    root: { ns: `${MS}word/2012/wordml`, name: 'people' },
    source: ['wordDocument'],
    content: false
  }),
  part('wordHeader', 'docx', {
    contentType: `${WML}header+xml`,
    ...office('header'),
    pathPattern: /^word\/header\d*\.xml$/i,
    root: { ns: W, name: 'hdr' },
    source: ['wordDocument']
  }),
  part('wordFooter', 'docx', {
    contentType: `${WML}footer+xml`,
    ...office('footer'),
    pathPattern: /^word\/footer\d*\.xml$/i,
    root: { ns: W, name: 'ftr' },
    source: ['wordDocument']
  }),
  part('wordGlossary', 'docx', {
    contentType: `${WML}document.glossary+xml`,
    ...office('glossaryDocument'),
    path: 'word/glossary/document.xml',
    root: { ns: W, name: 'glossaryDocument' },
    source: ['wordDocument']
  }),

  part('xlWorkbook', 'xlsx', {
    contentType: FORMATS[4].contentType,
    contentTypeAlt: mainAlt('xlsx'),
    ...office('officeDocument'),
    path: 'xl/workbook.xml',
    root: { ns: S, name: 'workbook' },
    source: ['package'],
    required: true,
    main: true
  }),
  part('xlWorksheet', 'xlsx', {
    contentType: `${SML}worksheet+xml`,
    ...office('worksheet'),
    pathPattern: /^xl\/worksheets\/sheet\d+\.xml$/i,
    root: { ns: S, name: 'worksheet' },
    source: ['xlWorkbook']
  }),
  part('xlChartsheet', 'xlsx', {
    contentType: `${SML}chartsheet+xml`,
    ...office('chartsheet'),
    pathPattern: /^xl\/chartsheets\/sheet\d+\.xml$/i,
    root: { ns: S, name: 'chartsheet' },
    source: ['xlWorkbook']
  }),
  part('xlSharedStrings', 'xlsx', {
    contentType: `${SML}sharedStrings+xml`,
    ...office('sharedStrings'),
    path: 'xl/sharedStrings.xml',
    root: { ns: S, name: 'sst' },
    source: ['xlWorkbook']
  }),
  part('xlStyles', 'xlsx', {
    contentType: `${SML}styles+xml`,
    ...office('styles'),
    path: 'xl/styles.xml',
    root: { ns: S, name: 'styleSheet' },
    source: ['xlWorkbook'],
    content: false,
    borrow: true
  }),
  part('xlCalcChain', 'xlsx', {
    contentType: `${SML}calcChain+xml`,
    ...office('calcChain'),
    path: 'xl/calcChain.xml',
    root: { ns: S, name: 'calcChain' },
    source: ['xlWorkbook'],
    content: false
  }),
  part('xlTable', 'xlsx', {
    contentType: `${SML}table+xml`,
    ...office('table'),
    pathPattern: /^xl\/tables\/table\d+\.xml$/i,
    root: { ns: S, name: 'table' },
    source: ['xlWorksheet']
  }),
  part('xlPivotTable', 'xlsx', {
    contentType: `${SML}pivotTable+xml`,
    ...office('pivotTable'),
    pathPattern: /^xl\/pivotTables\/pivotTable\d+\.xml$/i,
    root: { ns: S, name: 'pivotTableDefinition' },
    source: ['xlWorksheet']
  }),
  part('xlPivotCacheDefinition', 'xlsx', {
    contentType: `${SML}pivotCacheDefinition+xml`,
    ...office('pivotCacheDefinition'),
    pathPattern: /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/i,
    root: { ns: S, name: 'pivotCacheDefinition' },
    source: ['xlWorkbook', 'xlPivotTable']
  }),
  part('xlPivotCacheRecords', 'xlsx', {
    contentType: `${SML}pivotCacheRecords+xml`,
    ...office('pivotCacheRecords'),
    pathPattern: /^xl\/pivotCache\/pivotCacheRecords\d+\.xml$/i,
    root: { ns: S, name: 'pivotCacheRecords' },
    source: ['xlPivotCacheDefinition']
  }),
  part('xlExternalLink', 'xlsx', {
    contentType: `${SML}externalLink+xml`,
    ...office('externalLink'),
    pathPattern: /^xl\/externalLinks\/externalLink\d+\.xml$/i,
    root: { ns: S, name: 'externalLink' },
    source: ['xlWorkbook']
  }),
  part('xlConnections', 'xlsx', {
    contentType: `${SML}connections+xml`,
    ...office('connections'),
    path: 'xl/connections.xml',
    root: { ns: S, name: 'connections' },
    source: ['xlWorkbook'],
    content: false
  }),
  part('xlMetadata', 'xlsx', {
    contentType: `${SML}sheetMetadata+xml`,
    ...office('sheetMetadata'),
    path: 'xl/metadata.xml',
    root: { ns: S, name: 'metadata' },
    source: ['xlWorkbook'],
    content: false
  }),
  part('xlDrawing', 'xlsx', {
    contentType: `${OFFICE}drawing+xml`,
    ...office('drawing'),
    pathPattern: /^xl\/drawings\/drawing\d+\.xml$/i,
    root: { ns: XDR, name: 'wsDr' },
    source: ['xlWorksheet', 'xlChartsheet']
  }),
  part('xlComments', 'xlsx', {
    contentType: `${SML}comments+xml`,
    ...office('comments'),
    pathPattern: /^xl\/comments\d+\.xml$/i,
    root: { ns: S, name: 'comments' },
    source: ['xlWorksheet']
  }),
  part('xlThreadedComments', 'xlsx', {
    contentType: 'application/vnd.ms-excel.threadedcomments+xml',
    ...microsoft(`${MS}2017/10/relationships/threadedComment`),
    pathPattern: /^xl\/threadedComments\/threadedComment\d+\.xml$/i,
    root: { ns: `${MS}spreadsheetml/2018/threadedcomments`, name: 'ThreadedComments' },
    source: ['xlWorksheet']
  }),
  part('xlPersons', 'xlsx', {
    contentType: 'application/vnd.ms-excel.person+xml',
    ...microsoft(`${MS}2017/10/relationships/person`),
    pathPattern: /^xl\/persons\/person\d*\.xml$/i,
    root: { ns: `${MS}spreadsheetml/2018/threadedcomments`, name: 'personList' },
    source: ['xlWorkbook'],
    content: false
  }),

  part('pptPresentation', 'pptx', {
    contentType: FORMATS[8].contentType,
    contentTypeAlt: mainAlt('pptx'),
    ...office('officeDocument'),
    path: 'ppt/presentation.xml',
    root: { ns: P, name: 'presentation' },
    source: ['package'],
    required: true,
    main: true
  }),
  part('pptSlide', 'pptx', {
    contentType: `${PML}slide+xml`,
    ...office('slide'),
    pathPattern: /^ppt\/slides\/slide\d+\.xml$/i,
    root: { ns: P, name: 'sld' },
    source: ['pptPresentation']
  }),
  part('pptSlideLayout', 'pptx', {
    contentType: `${PML}slideLayout+xml`,
    ...office('slideLayout'),
    pathPattern: /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i,
    root: { ns: P, name: 'sldLayout' },
    source: ['pptSlide', 'pptSlideMaster'],
    content: false,
    borrow: true,
    borrowRels: true
  }),
  part('pptSlideMaster', 'pptx', {
    contentType: `${PML}slideMaster+xml`,
    ...office('slideMaster'),
    pathPattern: /^ppt\/slideMasters\/slideMaster\d+\.xml$/i,
    root: { ns: P, name: 'sldMaster' },
    source: ['pptPresentation', 'pptSlideLayout'],
    content: false,
    borrow: true,
    borrowRels: true
  }),
  part('pptNotesSlide', 'pptx', {
    contentType: `${PML}notesSlide+xml`,
    ...office('notesSlide'),
    pathPattern: /^ppt\/notesSlides\/notesSlide\d+\.xml$/i,
    root: { ns: P, name: 'notes' },
    source: ['pptSlide']
  }),
  part('pptNotesMaster', 'pptx', {
    contentType: `${PML}notesMaster+xml`,
    ...office('notesMaster'),
    pathPattern: /^ppt\/notesMasters\/notesMaster\d+\.xml$/i,
    root: { ns: P, name: 'notesMaster' },
    source: ['pptPresentation', 'pptNotesSlide'],
    content: false
  }),
  part('pptHandoutMaster', 'pptx', {
    contentType: `${PML}handoutMaster+xml`,
    ...office('handoutMaster'),
    pathPattern: /^ppt\/handoutMasters\/handoutMaster\d+\.xml$/i,
    root: { ns: P, name: 'handoutMaster' },
    source: ['pptPresentation'],
    content: false
  }),
  part('pptPresProps', 'pptx', {
    contentType: `${PML}presProps+xml`,
    ...office('presProps'),
    path: 'ppt/presProps.xml',
    root: { ns: P, name: 'presentationPr' },
    source: ['pptPresentation'],
    content: false,
    borrow: true
  }),
  part('pptViewProps', 'pptx', {
    contentType: `${PML}viewProps+xml`,
    ...office('viewProps'),
    path: 'ppt/viewProps.xml',
    root: { ns: P, name: 'viewPr' },
    source: ['pptPresentation'],
    content: false,
    borrow: true
  }),
  part('pptTableStyles', 'pptx', {
    contentType: `${PML}tableStyles+xml`,
    ...office('tableStyles'),
    path: 'ppt/tableStyles.xml',
    root: { ns: A, name: 'tblStyleLst' },
    source: ['pptPresentation'],
    content: false,
    borrow: true
  }),
  part('pptComments', 'pptx', {
    contentType: `${PML}comments+xml`,
    ...office('comments'),
    pathPattern: /^ppt\/comments\/comment\d+\.xml$/i,
    root: { ns: P, name: 'cmLst' },
    source: ['pptSlide']
  }),
  part('pptCommentAuthors', 'pptx', {
    contentType: `${PML}commentAuthors+xml`,
    ...office('commentAuthors'),
    path: 'ppt/commentAuthors.xml',
    root: { ns: P, name: 'cmAuthorLst' },
    source: ['pptPresentation'],
    content: false
  }),
  part('pptModernComments', 'pptx', {
    contentType: 'application/vnd.ms-powerpoint.comments+xml',
    ...microsoft(`${MS}2018/10/relationships/comments`),
    pathPattern: /^ppt\/comments\/modernComment_[^/]+\.xml$/i,
    root: { ns: `${MS}powerpoint/2018/8/main`, name: 'cmLst' },
    source: ['pptSlide']
  }),
  part('pptTags', 'pptx', {
    contentType: `${PML}tags+xml`,
    ...office('tags'),
    pathPattern: /^ppt\/tags\/tag\d+\.xml$/i,
    root: { ns: P, name: 'tagLst' },
    source: ['pptPresentation', 'pptSlide'],
    content: false
  }),
  part('printerSettingsExcel', 'xlsx', {
    contentType: `${SML}printerSettings`,
    ...office('printerSettings'),
    pathPattern: /^xl\/printerSettings\/printerSettings\d+\.bin$/i,
    content: false
  }),
  part('printerSettingsPowerPoint', 'pptx', {
    contentType: `${PML}printerSettings`,
    ...office('printerSettings'),
    pathPattern: /^ppt\/printerSettings\/printerSettings\d+\.bin$/i,
    content: false
  }),
  part('chartEx', 'shared', {
    contentType: 'application/vnd.ms-office.chartex+xml',
    ...microsoft(`${MS}2014/relationships/chartEx`),
    pathPattern: /^(word|xl|ppt)\/charts\/chartEx\d+\.xml$/i
  }),
  part('ctrlProp', 'xlsx', {
    contentType: 'application/vnd.ms-excel.controlproperties+xml',
    ...office('ctrlProp'),
    pathPattern: /^xl\/ctrlProps\/ctrlProps?\d+\.xml$/i,
    content: false
  }),
  part('revisionHeaders', 'xlsx', {
    contentType: `${SML}revisionHeaders+xml`,
    ...office('revisionHeaders'),
    path: 'xl/revisions/revisionHeaders.xml'
  }),
  part('userNames', 'xlsx', {
    contentType: `${SML}userNames+xml`,
    ...office('usernames'),
    path: 'xl/revisions/userNames.xml'
  }),
  part('revisionLog', 'xlsx', {
    contentType: `${SML}revisionLog+xml`,
    ...office('revisionLog'),
    pathPattern: /^xl\/revisions\/revisionLog\d+\.xml$/i
  }),
  part('queryTable', 'xlsx', {
    contentType: `${SML}queryTable+xml`,
    ...office('queryTable'),
    pathPattern: /^xl\/queryTables\/queryTable\d+\.xml$/i
  }),
  part('tableSingleCells', 'xlsx', {
    contentType: `${SML}tableSingleCells+xml`,
    ...office('tableSingleCells'),
    pathPattern: /^xl\/tables\/tableSingleCells\d+\.xml$/i
  }),
  part('xmlMaps', 'xlsx', {
    ...office('xmlMaps'),
    path: 'xl/xmlMaps.xml',
    content: false
  }),
  part('volatileDependencies', 'xlsx', {
    contentType: `${SML}volatileDependencies+xml`,
    ...office('volatileDependencies'),
    path: 'xl/volatileDependencies.xml',
    content: false
  }),
  part('macrosheet', 'xlsx', {
    contentType: 'application/vnd.ms-excel.macrosheet+xml',
    ...microsoft(`${MS}2006/relationships/xlMacrosheet`),
    pathPattern: /^xl\/macrosheets\/sheet\d+\.xml$/i
  }),
  part('revisionInfo', 'pptx', {
    contentType: 'application/vnd.ms-powerpoint.revisioninfo+xml',
    ...microsoft(`${MS}2015/10/relationships/revisionInfo`),
    path: 'ppt/revisionInfo.xml',
    content: false
  }),
  part('changesInfo', 'pptx', {
    contentType: 'application/vnd.ms-powerpoint.changesinfo+xml',
    ...microsoft(`${MS}2016/11/relationships/changesInfo`),
    pathPattern: /^ppt\/changesInfos\/changesInfo\d+\.xml$/i,
    content: false
  })
];
