export const SIG = {
  LOCAL: [0x50, 0x4b, 0x03, 0x04],
  CENTRAL: [0x50, 0x4b, 0x01, 0x02],
  EOCD: [0x50, 0x4b, 0x05, 0x06],
  DESCRIPTOR: [0x50, 0x4b, 0x07, 0x08],
  ZIP64_EOCD: [0x50, 0x4b, 0x06, 0x06],
  ZIP64_LOCATOR: [0x50, 0x4b, 0x06, 0x07],
  CFB: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
};

export const CT_MAIN = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  docm: 'application/vnd.ms-word.document.macroEnabled.main+xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  dotm: 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.main+xml',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml',
  potm: 'application/vnd.ms-powerpoint.template.macroEnabled.main+xml',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
  ppsm: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml'
};

export const FAMILY_KEYS = {
  docx: ['docx', 'docm', 'dotx', 'dotm'],
  xlsx: ['xlsx', 'xlsm', 'xltx', 'xltm'],
  pptx: ['pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm']
};

export const STANDARD_KEYS = ['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm'];

export const CT_DEFAULTS = {
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
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
  bin: 'application/vnd.openxmlformats-officedocument.oleObject',
  vml: 'application/vnd.openxmlformats-officedocument.vmlDrawing',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav'
};

export const REL_OFFICE_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
export const REL_CORE = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
export const REL_EXT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties';
export const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const REL_NS_STRICT = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
export const REL_OFFICE_DOC_STRICT = 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument';

export function isMainRelType(type) {
  return type === REL_OFFICE_DOC || type === REL_OFFICE_DOC_STRICT;
}
export const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

export const CT_VBA = 'application/vnd.ms-office.vbaProject';
export const REL_VBA = 'http://schemas.microsoft.com/office/2006/relationships/vbaProject';

const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
const PML = 'application/vnd.openxmlformats-officedocument.presentationml.';
const OFFICE = 'application/vnd.openxmlformats-officedocument.';

export const OVERRIDE_TABLE = [
  [/^\/word\/styles\.xml$/i, WML + 'styles+xml'],
  [/^\/word\/numbering\.xml$/i, WML + 'numbering+xml'],
  [/^\/word\/settings\.xml$/i, WML + 'settings+xml'],
  [/^\/word\/fontTable\.xml$/i, WML + 'fontTable+xml'],
  [/^\/word\/webSettings\.xml$/i, WML + 'webSettings+xml'],
  [/^\/word\/header\d*\.xml$/i, WML + 'header+xml'],
  [/^\/word\/footer\d*\.xml$/i, WML + 'footer+xml'],
  [/^\/word\/footnotes\.xml$/i, WML + 'footnotes+xml'],
  [/^\/word\/endnotes\.xml$/i, WML + 'endnotes+xml'],
  [/^\/word\/comments\.xml$/i, WML + 'comments+xml'],
  [/^\/(word|xl|ppt)\/theme\/theme\d+\.xml$/i, OFFICE + 'theme+xml'],
  [/^\/xl\/worksheets\/sheet\d+\.xml$/i, SML + 'worksheet+xml'],
  [/^\/xl\/sharedStrings\.xml$/i, SML + 'sharedStrings+xml'],
  [/^\/xl\/styles\.xml$/i, SML + 'styles+xml'],
  [/^\/xl\/calcChain\.xml$/i, SML + 'calcChain+xml'],
  [/^\/xl\/drawings\/drawing\d+\.xml$/i, OFFICE + 'drawing+xml'],
  [/^\/(word|xl|ppt)\/charts\/chart\d+\.xml$/i, OFFICE + 'drawingml.chart+xml'],
  [/^\/ppt\/slides\/slide\d+\.xml$/i, PML + 'slide+xml'],
  [/^\/ppt\/slideLayouts\/slideLayout\d+\.xml$/i, PML + 'slideLayout+xml'],
  [/^\/ppt\/slideMasters\/slideMaster\d+\.xml$/i, PML + 'slideMaster+xml'],
  [/^\/ppt\/notesSlides\/notesSlide\d+\.xml$/i, PML + 'notesSlide+xml'],
  [/^\/ppt\/notesMasters\/notesMaster\d+\.xml$/i, PML + 'notesMaster+xml'],
  [/^\/ppt\/presProps\.xml$/i, PML + 'presProps+xml'],
  [/^\/ppt\/viewProps\.xml$/i, PML + 'viewProps+xml'],
  [/^\/ppt\/tableStyles\.xml$/i, PML + 'tableStyles+xml'],
  [/^\/docProps\/core\.xml$/i, 'application/vnd.openxmlformats-package.core-properties+xml'],
  [/^\/docProps\/app\.xml$/i, OFFICE + 'extended-properties+xml'],
  [/^\/(word|xl|ppt)\/vbaProject\.bin$/i, CT_VBA]
];

export const MAIN_PARTS = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml'
};

export const OUTPUT_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  dotm: 'application/vnd.ms-word.template.macroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.12',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  potm: 'application/vnd.ms-powerpoint.template.macroEnabled.12',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  ppsm: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12'
};

export const STORED_EXTENSIONS = ['png', 'jpeg', 'jpg', 'gif', 'mp4', 'mp3'];

export const STAGE_WEIGHTS = { identify: 5, zip: 30, xml: 30, package: 20, verify: 10, write: 5 };
export const STAGE_ORDER = ['identify', 'zip', 'xml', 'package', 'verify', 'write'];

export function stageStart(stage) {
  let total = 0;
  for (const name of STAGE_ORDER) {
    if (name === stage) return total;
    total += STAGE_WEIGHTS[name];
  }
  return total;
}
