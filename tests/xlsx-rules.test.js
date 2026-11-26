import { test, assert, eq, env } from './harness.js';
import { xlsxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { TIER_CONTENT } from '../js/core/tiers.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';

const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

async function run(name, bytes) {
  const copyOf = bytes.slice();
  return runPipeline({ name, size: copyOf.length, buffer: copyOf.buffer }, env);
}

function files(result) {
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const zipped = unzipSync(out);
  return Object.fromEntries(Object.keys(zipped).map((name) => [name, strFromU8(zipped[name])]));
}

function edit(entries, name, change) {
  return entries.map(([entry, content]) => (entry === name ? [entry, change(content)] : [entry, content]));
}

function withBrokenFormats() {
  let entries = xlsxEntries();
  entries = edit(entries, 'xl/styles.xml', (t) => t.replace('<cellXfs count="1"><xf numFmtId="0" fontId="0"', '<cellXfs count="1"><xf numFmtId="0" fontId="9"').replace('</styleSheet>', '<dxfs count="1"><dxf/></dxfs></styleSheet>'));
  entries = edit(entries, 'xl/worksheets/sheet2.xml', (t) => t
    .replace('<c r="A2" t="s"><v>4</v></c>', '<c r="A2" t="s"><v>99</v></c>')
    .replace('</sheetData>', `</sheetData><conditionalFormatting sqref="A1"><cfRule type="cellIs" dxfId="7" priority="1" operator="equal"><formula>1</formula></cfRule></conditionalFormatting><tableParts count="1"><tablePart xmlns:r="${R}" r:id="rId1"/></tableParts>`));
  entries = edit(entries, '[Content_Types].xml', (t) => t.replace('</Types>', `<Override PartName="/xl/tables/table1.xml" ContentType="${SML}table+xml"/></Types>`));
  entries.push(['xl/worksheets/_rels/sheet2.xml.rels', `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/table" Target="../tables/table1.xml"/></Relationships>`]);
  entries.push(['xl/tables/table1.xml', `${DECL}<table xmlns="${S}" id="1" name="T" displayName="T" ref="A1:A2" headerRowDxfId="4"><tableColumns count="1"><tableColumn id="1" name="A" dataDxfId="5"/></tableColumns></table>`]);
  return entries;
}

function withOrphanPivot() {
  let entries = xlsxEntries();
  entries = edit(entries, 'xl/worksheets/sheet2.xml', (t) => t.replace('<c r="A2" t="s"><v>4</v></c>', '<c r="A2" t="s"><v>99</v></c>'));
  entries = edit(entries, '[Content_Types].xml', (t) => t.replace('</Types>', `<Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="${SML}pivotTable+xml"/></Types>`));
  entries.push(['xl/worksheets/_rels/sheet2.xml.rels', `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>`]);
  entries.push(['xl/pivotTables/pivotTable1.xml', `${DECL}<pivotTableDefinition xmlns="${S}" name="P" cacheId="1"/>`]);
  entries.push(['xl/pivotTables/_rels/pivotTable1.xml.rels', `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>`]);
  return entries;
}

test('xlsx rules: style, font, format and table references past the end of their lists are cleared', async () => {
  const result = await run('book.xlsx', pack(withBrokenFormats()));
  assert(result.output, 'output produced');
  const out = files(result);
  const found = result.findings.filter((f) => f.code === 'XLSX_STYLE_INDEX_CLEARED');
  eq(found.length, 3, 'styles, sheet and table are reported');
  assert(!out['xl/worksheets/sheet2.xml'].includes('dxfId="7"'), 'conditional format reference removed');
  assert(!out['xl/tables/table1.xml'].includes('DxfId'), 'table format references removed');
  assert(!out['xl/styles.xml'].includes('fontId="9"'), 'font reference removed');
  assert(out['xl/styles.xml'].includes('borderId="0"') && out['xl/styles.xml'].includes('xfId="0"'), 'in-range attributes kept');
});

test('xlsx rules: references inside their lists are kept', async () => {
  let entries = withBrokenFormats();
  entries = edit(entries, 'xl/worksheets/sheet2.xml', (t) => t.replace('dxfId="7"', 'dxfId="0"'));
  entries = edit(entries, 'xl/tables/table1.xml', (t) => t.replace('headerRowDxfId="4"', 'headerRowDxfId="0"').replace('dataDxfId="5"', 'dataDxfId="0"'));
  const result = await run('book.xlsx', pack(entries));
  const out = files(result);
  assert(out['xl/worksheets/sheet2.xml'].includes('dxfId="0"'), 'valid conditional format reference kept');
  assert(out['xl/tables/table1.xml'].includes('headerRowDxfId="0"') && out['xl/tables/table1.xml'].includes('dataDxfId="0"'), 'valid table references kept');
});

test('xlsx rules: the cleaned output is stable', async () => {
  const first = await run('book.xlsx', pack(withBrokenFormats()));
  const out = first.output.bytes instanceof Uint8Array ? first.output.bytes : new Uint8Array(first.output.bytes);
  const second = await run('book.xlsx', out);
  eq(second.outcome, 'noProblems');
});

test('xlsx rules: a pivot table whose cache is gone is removed with its relationships', async () => {
  const result = await run('book.xlsx', pack(withOrphanPivot()));
  assert(result.output, 'output produced');
  const out = files(result);
  assert(!Object.keys(out).some((name) => name.toLowerCase().includes('pivottable')), 'no pivot table part left');
  assert(!out['xl/worksheets/_rels/sheet2.xml.rels'] || !out['xl/worksheets/_rels/sheet2.xml.rels'].includes('pivotTable'), 'no relationship to it left');
  assert(!out['[Content_Types].xml'].includes('pivotTable'), 'no override for it left');
  const removed = result.findings.find((f) => f.code === 'XLSX_PIVOT_REMOVED');
  assert(removed && removed.data.n === 1, 'one pivot table reported');
});

test('xlsx rules: a pivot table with its cache present is kept', async () => {
  let entries = withOrphanPivot();
  entries.push(['xl/pivotCache/pivotCacheDefinition1.xml', `${DECL}<pivotCacheDefinition xmlns="${S}"/>`]);
  entries = edit(entries, '[Content_Types].xml', (t) => t.replace('</Types>', `<Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="${SML}pivotCacheDefinition+xml"/></Types>`));
  const result = await run('book.xlsx', pack(entries));
  const out = files(result);
  assert(Object.keys(out).includes('xl/pivotTables/pivotTable1.xml'), 'pivot table kept');
  assert(!result.findings.some((f) => f.code === 'XLSX_PIVOT_REMOVED'), 'not reported');
});

test('xlsx rules: the family check is dirty for a workbook that still has an orphan pivot table or an index past its list, and clean once they are gone', async () => {
  const { checkRunner } = await import('../js/core/tiers.js');
  const check = checkRunner('familyRules');
  const sheet = (text) => ({ text, isXml: true });
  const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const { parseTree } = await import('../js/core/xml-repair.js');
  const build = (cellStyle) => {
    const parts = new Map([
      ['xl/workbook.xml', { name: 'xl/workbook.xml', text: '<workbook/>', isXml: true }],
      ['xl/_rels/workbook.xml.rels', { name: 'xl/_rels/workbook.xml.rels', text: rels, isXml: true }],
      ['xl/styles.xml', { name: 'xl/styles.xml', text: '<styleSheet xmlns="' + S + '"><cellXfs count="1"><xf/></cellXfs></styleSheet>', isXml: true }],
      ['xl/worksheets/sheet1.xml', { name: 'xl/worksheets/sheet1.xml', ...sheet('<worksheet xmlns="' + S + '"><sheetData><row r="1"><c r="A1" s="' + cellStyle + '"/></row></sheetData></worksheet>') }]
    ]);
    const names = Array.from(parts.keys());
    const trees = new Map();
    for (const [name, part] of parts) trees.set(name, parseTree(part.text));
    return {
      family: 'xlsx',
      main: 'xl/workbook.xml',
      parts,
      trees,
      dirty: new Set(),
      changed: false,
      findings: [],
      index: { names: () => names.slice(), has: (n) => names.some((x) => x.toLowerCase() === n.toLowerCase()), canonical: (n) => names.find((x) => x.toLowerCase() === n.toLowerCase()) || null }
    };
  };
  assert(check(build(0)), 'a style inside the list is clean');
  assert(!check(build(4)), 'a style past the end of the list is dirty');
});
