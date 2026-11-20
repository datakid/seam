import { FORMATS, DEFAULT_TYPES } from './data/parts.js';
import { mainRow, rowOfKind } from './registry.js';

export const SIG = {
  LOCAL: [0x50, 0x4b, 0x03, 0x04],
  CENTRAL: [0x50, 0x4b, 0x01, 0x02],
  EOCD: [0x50, 0x4b, 0x05, 0x06],
  DESCRIPTOR: [0x50, 0x4b, 0x07, 0x08],
  ZIP64_EOCD: [0x50, 0x4b, 0x06, 0x06],
  ZIP64_LOCATOR: [0x50, 0x4b, 0x06, 0x07],
  CFB: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
};

export const CT_MAIN = Object.fromEntries(FORMATS.map((format) => [format.key, format.contentType]));

export const FAMILY_KEYS = {};
for (const format of FORMATS) (FAMILY_KEYS[format.family] ||= []).push(format.key);

export const STANDARD_KEYS = FORMATS.filter((format) => format.standard).map((format) => format.key);

export const CT_DEFAULTS = DEFAULT_TYPES;

const mainOf = (family) => mainRow(family);
const kindRow = (kind) => rowOfKind(kind);

export const REL_OFFICE_DOC = mainOf('docx').relType;
export const REL_OFFICE_DOC_STRICT = mainOf('docx').relTypeStrict;
export const REL_CORE = kindRow('coreProperties').relType;
export const REL_EXT = kindRow('extendedProperties').relType;
export const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const REL_NS_STRICT = 'http://purl.oclc.org/ooxml/officeDocument/relationships';

export function isMainRelType(type) {
  return type === REL_OFFICE_DOC || type === REL_OFFICE_DOC_STRICT;
}
export const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

export const CT_VBA = kindRow('vbaProject').contentType;
export const REL_VBA = kindRow('vbaProject').relType;

export const MAIN_PARTS = Object.fromEntries(['docx', 'xlsx', 'pptx'].map((family) => [family, mainOf(family).path]));

export const OUTPUT_MIME = Object.fromEntries(FORMATS.map((format) => [format.key, format.outputMime]));

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
