import { test, assert } from './harness.js';
import { copy, FINDING_CODES } from '../js/copy.js';
import { SEVERITY, finding } from '../js/core/report.js';

const BANNED = ['guaranteed', 'fully recovered', 'perfect', 'magic', 'instantly', 'effortless', 'ai', 'smart', 'oops', 'uh-oh', 'yay', 'awesome', "don't worry", 'hang tight', 'sit back'];

const probe = new Proxy({}, { get: (_, key) => (key === Symbol.toPrimitive ? () => 'x' : typeof key === 'symbol' ? undefined : 'x') });

function collect(node, out) {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'function') out.push(String(node(probe, probe)));
  else if (Array.isArray(node)) for (const item of node) collect(item, out);
  else if (node && typeof node === 'object') for (const key of Object.keys(node)) collect(node[key], out);
}

function strings() {
  const out = [];
  collect(copy, out);
  return out;
}

test('copy lint: no exclamation marks', () => {
  for (const s of strings()) assert(!s.includes('!'), `exclamation mark in: ${s}`);
});

test('copy lint: no emoji', () => {
  for (const s of strings()) assert(!/\p{Extended_Pictographic}/u.test(s), `emoji in: ${s}`);
});

test('copy lint: no banned words or phrases', () => {
  for (const s of strings()) {
    assert(!s.includes('100%'), `banned 100% in: ${s}`);
    for (const word of BANNED) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert(!new RegExp(`(^|[^A-Za-z])${escaped}($|[^A-Za-z])`, 'i').test(s), `banned "${word}" in: ${s}`);
    }
  }
});

test('copy lint: sentence case buttons', () => {
  for (const value of [copy.btn.downloadAll, copy.btn.clear, copy.btn.download, copy.btn.downloadSalvage, copy.btn.copyReport, copy.btn.saveReport, copy.btn.addCopy, copy.btn.addDonor, copy.drop.button]) {
    const words = value.split(' ').slice(1);
    for (const w of words) assert(!/^[A-Z][a-z]/.test(w), `title case in: ${value}`);
  }
});

const CODES = [
  'TRANSFER_CRLF_REVERSED', 'ZIP_PREFIX_DATA', 'ZIP_DIRECTORY_REBUILT', 'ZIP_ENTRY_TRUNCATED', 'ZIP_ENTRY_CRC', 'ZIP_ENTRY_UNREADABLE',
  'XML_HOLE_DROPPED', 'ZIP_ENTRY_CHOSEN', 'PART_NAME_CASE_FIXED', 'XML_NAMESPACE_FIXED', 'SCHEMA_REORDERED', 'SCHEMA_NAMES_FIXED',
  'ZIP_ORPHAN_NAMED', 'ZIP_ORPHAN_KEPT',
  'MULTI_PART_FROM', 'MULTI_COPY_UNUSED',
  'DONOR_PART_BORROWED', 'DONOR_UNUSED',
  'XML_REENCODED', 'XML_INVALID_BYTES', 'XML_CHARS_REMOVED', 'XML_REPAIRED', 'XML_TRUNCATED_CLOSED', 'XML_UNRECOVERABLE',
  'CT_REBUILT', 'CT_OVERRIDE_REMOVED', 'CT_OVERRIDE_ADDED', 'CT_OVERRIDE_FIXED', 'CT_ENTRIES_CLEANED', 'SCHEMA_COMPLETED', 'SCHEMA_UNRESOLVED', 'XLSX_WORKBOOK_REBUILT', 'PPTX_PRESENTATION_REBUILT', 'CT_UNKNOWN_PART', 'CT_PART_TYPED', 'ROOT_RELS_REBUILT', 'RELS_REBUILT', 'RELS_ROOT_FIXED', 'REL_REMOVED', 'REL_FILE_REMOVED',
  'EXTENSION_CORRECTED', 'REF_DANGLING', 'REF_REMOVED', 'XLSX_STYLE_CLEARED', 'XLSX_STYLE_INDEX_CLEARED', 'XLSX_PIVOT_REMOVED', 'NO_MAIN_PART',
  'DOCX_BODY_ADDED', 'DOCX_REL_ADDED', 'DOCX_NUMBERING_MISSING', 'DOCX_NOTE_REFS_REMOVED',
  'XLSX_SHEET_REMOVED', 'XLSX_NAMES_ADJUSTED', 'XLSX_SHEET_RENAMED', 'XLSX_CALCCHAIN_REMOVED', 'XLSX_SST_COUNTS', 'XLSX_CELL_CLEARED', 'XLSX_DIMENSION_REMOVED', 'XLSX_DRAWING_REMOVED',
  'PPTX_SLIDE_REMOVED', 'PPTX_SLIDE_ORDER_GUESSED', 'PPTX_SLIDE_IDS', 'PPTX_LAYOUT_RELINKED',
  'VERIFY_FAILED', 'SALVAGE_TEXT_ONLY', 'INTERNAL_ERROR', 'TIMEOUT'
];

test('finding coverage: every spec code has a template and a severity', () => {
  for (const code of CODES) {
    assert(typeof copy.findings[code] === 'function', `missing template ${code}`);
    assert(['loss', 'repaired', 'noted'].includes(SEVERITY[code]), `missing severity ${code}`);
  }
});

test('finding coverage: every template has a severity and renders', () => {
  for (const code of FINDING_CODES) {
    assert(SEVERITY[code], `no severity for ${code}`);
    const f = finding(code, 'part.xml', { n: 2, pct: 40, bytes: 9, name: 'Q3', from: 'a', to: 'b', ext: 'xml', type: 't', check: 3, number: 2, method: 9 });
    assert(f.text.length > 0, `empty text for ${code}`);
  }
});

test('copy: summary omits zero groups and uses singular', () => {
  assert(copy.summary({ n: 1, r: 1, p: 0, s: 0, f: 0 }) === '1 file · 1 repaired', 'singular summary');
  assert(copy.summary({ n: 3, r: 2, p: 0, s: 0, f: 1 }) === '3 files · 2 repaired · 1 could not be repaired', 'plural summary');
});

test('copy: the unused-copy finding names the file and says why', () => {
  for (const why of ['unreadable', 'different', 'unused']) {
    const text = finding('MULTI_COPY_UNUSED', null, { name: 'Backup.docx', why }).text;
    assert(text.includes('Backup.docx') && text.includes('nothing was taken'), text);
  }
  const texts = new Set(['unreadable', 'different', 'unused'].map((why) => finding('MULTI_COPY_UNUSED', null, { name: 'x', why }).text));
  assert(texts.size === 3, 'three distinct texts');
  assert(finding('MULTI_PART_FROM', 'word/document.xml', { from: 'Backup.docx', n: 2 }).text.includes('Backup.docx'), 'names the copy');
});

test('copy: the donor findings name the file and say why nothing was taken', () => {
  for (const why of ['unreadable', 'kind', 'nothing']) {
    const text = finding('DONOR_UNUSED', null, { name: 'Healthy.docx', why }).text;
    assert(text.includes('Healthy.docx') && text.includes('nothing was taken'), text);
  }
  const texts = new Set(['unreadable', 'kind', 'nothing'].map((why) => finding('DONOR_UNUSED', null, { name: 'x', why }).text));
  assert(texts.size === 3, 'three distinct texts');
  assert(finding('DONOR_PART_BORROWED', 'word/styles.xml', { from: 'Healthy.docx' }).text.includes('Healthy.docx'), 'names the donor');
});
