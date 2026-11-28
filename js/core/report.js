import { copy } from '../copy.js';
import { CHIPS } from './identify.js';

export const SEVERITY = {
  ZIP_ENDS_EARLY: 'loss',
  ZIP_ENTRY_TRUNCATED: 'loss',
  ZIP_ENTRY_CRC: 'loss',
  ZIP_ENTRY_UNREADABLE: 'loss',
  ZIP_UNSUPPORTED_METHOD: 'loss',
  ZIP_PATH_DROPPED: 'loss',
  XML_INVALID_BYTES: 'loss',
  XML_TRUNCATED_CLOSED: 'loss',
  XML_UNRECOVERABLE: 'loss',
  XML_HOLE_DROPPED: 'loss',
  REL_DUPLICATE_DROPPED: 'loss',
  NO_MAIN_PART: 'loss',
  XLSX_SHEET_REMOVED: 'loss',
  XLSX_CELL_CLEARED: 'loss',
  XLSX_STYLE_CLEARED: 'loss',
  XLSX_STYLE_INDEX_CLEARED: 'loss',
  XLSX_PIVOT_REMOVED: 'loss',
  XLSX_DRAWING_REMOVED: 'loss',
  PPTX_SLIDE_REMOVED: 'loss',
  PPTX_MASTER_REMOVED: 'loss',
  REF_DANGLING: 'loss',
  REF_REMOVED: 'loss',
  SALVAGE_TEXT_ONLY: 'loss',
  INTERNAL_ERROR: 'loss',
  TIMEOUT: 'loss',
  ZIP_PREFIX_DATA: 'repaired',
  TRANSFER_CRLF_REVERSED: 'repaired',
  ZIP_DIRECTORY_REBUILT: 'repaired',
  ZIP_ENTRY_CHOSEN: 'noted',
  ZIP_ORPHAN_NAMED: 'repaired',
  ZIP_ORPHAN_KEPT: 'noted',
  MULTI_PART_FROM: 'noted',
  MULTI_COPY_UNUSED: 'noted',
  DONOR_PART_BORROWED: 'noted',
  DONOR_UNUSED: 'noted',
  XML_REENCODED: 'repaired',
  XML_CHARS_REMOVED: 'repaired',
  XML_REPAIRED: 'repaired',
  XML_NAMESPACE_FIXED: 'repaired',
  CT_REBUILT: 'repaired',
  CT_DEFAULT_ADDED: 'repaired',
  CT_MAIN_FIXED: 'repaired',
  CT_OVERRIDE_REMOVED: 'repaired',
  CT_OVERRIDE_ADDED: 'repaired',
  CT_OVERRIDE_FIXED: 'repaired',
  PART_NAME_CASE_FIXED: 'repaired',
  CT_ENTRIES_CLEANED: 'repaired',
  CT_PART_TYPED: 'repaired',
  SCHEMA_REORDERED: 'repaired',
  SCHEMA_NAMES_FIXED: 'repaired',
  SCHEMA_COMPLETED: 'repaired',
  SCHEMA_UNRESOLVED: 'loss',
  XLSX_WORKBOOK_REBUILT: 'loss',
  PPTX_PRESENTATION_REBUILT: 'loss',
  ROOT_RELS_REBUILT: 'repaired',
  RELS_REBUILT: 'repaired',
  RELS_ROOT_FIXED: 'repaired',
  PPTX_SLIDE_ORDER_GUESSED: 'noted',
  ROOT_RELS_FIXED: 'repaired',
  REL_REMOVED: 'repaired',
  REL_FILE_REMOVED: 'repaired',
  REL_ID_RENAMED: 'repaired',
  EXTENSION_CORRECTED: 'repaired',
  DOCX_BODY_ADDED: 'repaired',
  DOCX_REL_ADDED: 'repaired',
  XLSX_NAMES_ADJUSTED: 'repaired',
  XLSX_SST_COUNTS: 'repaired',
  PPTX_SLIDE_IDS: 'repaired',
  CT_UNKNOWN_PART: 'noted',
  DOCX_NUMBERING_MISSING: 'noted',
  DOCX_NOTE_REFS_REMOVED: 'repaired',
  XLSX_SHEET_RENAMED: 'noted',
  XLSX_CALCCHAIN_REMOVED: 'noted',
  XLSX_DIMENSION_REMOVED: 'noted',
  PPTX_LAYOUT_RELINKED: 'noted',
  VERIFY_FAILED: 'noted'
};

export function finding(code, part = null, data = {}) {
  const template = copy.findings[code];
  if (!template) throw new Error(`No copy template for finding ${code}`);
  return { code, severity: SEVERITY[code], part, data, text: template(data) };
}

export function countLoss(findings) {
  return findings.filter((f) => f.severity === 'loss').length;
}

export function sentenceFor(outcome, findings, reason) {
  if (outcome === 'noProblems') return copy.sentences.noProblems;
  if (outcome === 'repaired') return copy.sentences.repaired(findings.length);
  if (outcome === 'partial') return copy.sentences.partial;
  if (outcome === 'salvaged') return copy.sentences.salvaged;
  if (outcome === 'failed') return copy.sentences.failed(reason || copy.reasons.nothing);
  return reason || '';
}

export function detectionSentence(identity) {
  const kind = identity.kind;
  if (kind === 'ENCRYPTED_OOXML') return copy.detection.ENCRYPTED_OOXML;
  if (kind === 'LEGACY_DOC' || kind === 'LEGACY_XLS' || kind === 'LEGACY_PPT') return copy.detection.legacy(identity.ext);
  if (kind === 'CFB_UNKNOWN') return copy.detection.CFB_UNKNOWN;
  if (kind === 'PDF' || kind === 'RTF' || kind === 'HTML' || kind === 'IMAGE') return copy.detection.other(copy.detection.types[identity.type]);
  if (kind === 'FLAT_OPC_XML') return copy.detection.FLAT_OPC_XML;
  if (kind === 'EMPTY') return copy.detection.EMPTY;
  return copy.detection.UNKNOWN;
}

export function detectedLabel(identity, format) {
  if (format) return `${copy.formats[format.key]} (.${format.ext})`;
  const label = copy.formats[identity.kind] || copy.formats.UNKNOWN;
  return identity.ext ? `${label} (${identity.ext})` : label;
}

export function notSupportedResult(identity) {
  return {
    outcome: 'notSupported',
    detected: { kind: identity.kind, chip: CHIPS[identity.kind] || 'UNKNOWN', label: detectedLabel(identity, null) },
    findings: [],
    sentence: detectionSentence(identity),
    output: null,
    extraOutput: null,
    preview: null,
    verified: false
  };
}

export function notProcessedResult(sentence) {
  return {
    outcome: 'notProcessed',
    detected: { kind: 'UNKNOWN', chip: '—', label: copy.formats.UNKNOWN },
    findings: [],
    sentence,
    output: null,
    extraOutput: null,
    preview: null,
    verified: false
  };
}

export function failedResult(code, reason, detected) {
  return {
    outcome: 'failed',
    detected: detected || { kind: 'ZIP', chip: 'ZIP', label: copy.formats.ZIP },
    findings: [finding(code)],
    sentence: copy.sentences.failed(reason),
    output: null,
    extraOutput: null,
    preview: null,
    verified: false
  };
}

export function baseName(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function formatLocalDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function groupFindings(findings) {
  const groups = { loss: [], repaired: [], noted: [] };
  for (const f of findings) groups[f.severity].push(f);
  return groups;
}

export function textReport(name, size, result, now = new Date()) {
  const lines = [];
  lines.push(copy.report.title);
  lines.push(`${copy.report.file}: ${name} (${size.toLocaleString('en-US')} ${copy.report.bytes})`);
  lines.push(`${copy.report.detected}: ${result.detected.label}`);
  lines.push(`${copy.report.outcome}: ${copy.outcomes[result.outcome]}`);
  lines.push(`${copy.report.checked}: ${formatLocalDateTime(now)} (${copy.report.localTime})`);
  lines.push('');
  const groups = groupFindings(result.findings);
  let any = false;
  for (const key of ['loss', 'repaired', 'noted']) {
    if (groups[key].length === 0) continue;
    any = true;
    lines.push(copy.report.groups[key]);
    for (const f of groups[key]) lines.push(`- ${f.text}${f.part ? ` [${f.part}]` : ''}`);
    lines.push('');
  }
  if (!any) {
    lines.push(result.sentence);
    lines.push('');
  }
  if (result.output) {
    lines.push(`${copy.report.output}: ${result.output.name} — ${copy.verify.line(result)}`);
    lines.push(copy.verify.advice);
  }
  if (result.preview) {
    lines.push('');
    lines.push(copy.report.previewTitle);
    lines.push(result.preview);
  }
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}
