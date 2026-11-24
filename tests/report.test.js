import { test, assert, eq } from './harness.js';
import { finding, textReport, groupFindings, sentenceFor, countLoss, baseName, formatLocalDateTime } from '../js/core/report.js';
import { copy } from '../js/copy.js';

const sample = {
  outcome: 'partial',
  detected: { kind: 'xlsx', chip: 'XLSX', label: 'Excel workbook (.xlsx)' },
  findings: [
    finding('XLSX_CALCCHAIN_REMOVED', 'xl/calcChain.xml'),
    finding('ZIP_DIRECTORY_REBUILT', null, { n: 41 }),
    finding('XLSX_SHEET_REMOVED', 'xl/worksheets/sheet3.xml', { name: 'Q3' }),
    finding('REL_REMOVED', 'xl/_rels/workbook.xml.rels', { n: 3, targets: ['a', 'b', 'c'] })
  ],
  sentence: copy.sentences.partial,
  output: { bytes: new Uint8Array(1), name: 'Budget (repaired).xlsx', mime: 'x' },
  extraOutput: null,
  preview: null
};

test('report text: the output line says content checks when the output reached tier 2, and not for salvaged text', () => {
  const now = new Date(2026, 10, 14, 14, 3);
  const line = (extra) => textReport('Budget.xlsx', 380112, { ...sample, ...extra }, now).split('\n').find((l) => l.startsWith('Output:'));
  eq(line({ tier: 2 }), 'Output: Budget (repaired).xlsx — Passed structural and content checks.');
  eq(line({ tier: 1 }), 'Output: Budget (repaired).xlsx — Passed structural checks.');
  eq(line({}), 'Output: Budget (repaired).xlsx — Passed structural checks.');
  eq(line({ tier: 2, outcome: 'salvaged' }), 'Output: Budget (repaired).xlsx — Passed structural checks.');
});

test('report text: matches the specified layout line by line', () => {
  const now = new Date(2026, 10, 14, 14, 3);
  const expected = [
    'Seam repair report',
    'File: Budget.xlsx (380,112 bytes)',
    'Detected: Excel workbook (.xlsx)',
    'Outcome: Partially repaired',
    'Checked: 2026-11-14 14:03 (local time)',
    '',
    'Lost',
    '- Sheet "Q3" was removed because its data part was unreadable. [xl/worksheets/sheet3.xml]',
    '',
    'Repaired',
    '- Rebuilt the ZIP directory from 41 recovered entries.',
    '- Removed 3 relationships pointing to missing parts. [xl/_rels/workbook.xml.rels]',
    '',
    'Noted',
    '- Removed the calculation chain. Excel rebuilds it on open. [xl/calcChain.xml]',
    '',
    'Output: Budget (repaired).xlsx — Passed structural checks.',
    'Open the file and check its contents before relying on it.',
    ''
  ].join('\n');
  eq(textReport('Budget.xlsx', 380112, sample, now), expected);
});

test('report text: LF endings only, no trailing blank lines, UTF-8 safe', () => {
  const text = textReport('x.xlsx', 5, sample, new Date(2026, 0, 2, 3, 4));
  assert(!text.includes('\r'), 'no CR');
  assert(text.endsWith('checks.\n') || text.endsWith('relying on it.\n'), 'single trailing newline');
  assert(!text.endsWith('\n\n'), 'no blank end');
});

test('report text: a result without findings states the sentence instead', () => {
  const result = { outcome: 'notSupported', detected: { label: 'PDF document' }, findings: [], sentence: copy.detection.other('PDF document'), output: null };
  const text = textReport('a.docx', 10, result, new Date(2026, 0, 1, 0, 0));
  assert(text.includes('This file is a PDF document, not an Office document.'), text);
  assert(!text.includes('Output:'), 'no output line');
});

test('report text: a recovered-text preview is included', () => {
  const text = textReport('a.docx', 10, { ...sample, outcome: 'salvaged', preview: 'First words' }, new Date(2026, 0, 1, 0, 0));
  assert(text.includes('Recovered text\nFirst words'), text);
});

test('findings: grouped by severity in the order Lost, Repaired, Noted', () => {
  const groups = groupFindings(sample.findings);
  eq(groups.loss.length, 1);
  eq(groups.repaired.length, 2);
  eq(groups.noted.length, 1);
  eq(countLoss(sample.findings), 1);
});

test('finding object: has code, severity, part, data and rendered text', () => {
  const f = finding('ZIP_ENTRY_TRUNCATED', 'word/document.xml', { pct: 82, bytes: 10 });
  eq(f.code, 'ZIP_ENTRY_TRUNCATED');
  eq(f.severity, 'loss');
  eq(f.part, 'word/document.xml');
  eq(f.data, { pct: 82, bytes: 10 });
  eq(f.text, 'This part was cut short. 82% of it was recovered.');
});

test('finding text: truncation falls back to bytes when the size is unknown', () => {
  eq(finding('ZIP_ENTRY_TRUNCATED', 'p', { pct: null, bytes: 120 }).text, 'This part was cut short. 120 bytes were recovered.');
});

test('summary sentences: one per outcome with the plural handled', () => {
  eq(sentenceFor('noProblems', []), 'No structural problems found. No changes were made.');
  eq(sentenceFor('repaired', [1]), 'Repaired 1 structural problem. No content loss was detected.');
  eq(sentenceFor('repaired', [1, 2, 3]), 'Repaired 3 structural problems. No content loss was detected.');
  eq(sentenceFor('partial', []), 'Repaired the file structure. Some content could not be recovered. See Lost below.');
  eq(sentenceFor('salvaged', []), 'The file structure could not be rebuilt. Text was recovered into a new file.');
  eq(sentenceFor('failed', [], 'No readable content was found.'), 'This file could not be repaired. No readable content was found.');
});

test('names and dates: base name strips only the last extension; local time is zero padded', () => {
  eq(baseName('Budget 2026.final.xlsx'), 'Budget 2026.final');
  eq(baseName('noext'), 'noext');
  eq(baseName('.hidden'), '.hidden');
  eq(formatLocalDateTime(new Date(2026, 0, 2, 3, 4)), '2026-01-02 03:04');
});

test('findings: the xml repair text lists only the non-zero counts', () => {
  const f = finding('XML_REPAIRED', 'a.xml', { autoClosed: 2, strayClosed: 0, dupAttrs: 1 });
  eq(f.text, 'Repaired the XML structure: closed 2 elements left open, removed 1 duplicate attribute.');
});
