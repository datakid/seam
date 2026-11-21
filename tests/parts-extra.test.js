import { test, assert, eq, env } from './harness.js';
import { xlsxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { PARTS } from '../js/core/data/parts.js';
import { rowOfKind, rowsOfRelType, rowOfPath, overrideTypeFor } from '../js/core/registry.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const S = 'http://purl.oclc.org/ooxml/officeDocument/relationships/';
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
const PML = 'application/vnd.openxmlformats-officedocument.presentationml.';

const ADDED = [
  ['printerSettingsExcel', 'xl/printerSettings/printerSettings2.bin', `${SML}printerSettings`],
  ['printerSettingsPowerPoint', 'ppt/printerSettings/printerSettings1.bin', `${PML}printerSettings`],
  ['chartEx', 'xl/charts/chartEx1.xml', 'application/vnd.ms-office.chartex+xml'],
  ['ctrlProp', 'xl/ctrlProps/ctrlProps1.xml', 'application/vnd.ms-excel.controlproperties+xml'],
  ['revisionHeaders', 'xl/revisions/revisionHeaders.xml', `${SML}revisionHeaders+xml`],
  ['userNames', 'xl/revisions/userNames.xml', `${SML}userNames+xml`],
  ['revisionLog', 'xl/revisions/revisionLog3.xml', `${SML}revisionLog+xml`],
  ['queryTable', 'xl/queryTables/queryTable1.xml', `${SML}queryTable+xml`],
  ['tableSingleCells', 'xl/tables/tableSingleCells1.xml', `${SML}tableSingleCells+xml`],
  ['volatileDependencies', 'xl/volatileDependencies.xml', `${SML}volatileDependencies+xml`],
  ['macrosheet', 'xl/macrosheets/sheet2.xml', 'application/vnd.ms-excel.macrosheet+xml'],
  ['revisionInfo', 'ppt/revisionInfo.xml', 'application/vnd.ms-powerpoint.revisioninfo+xml'],
  ['changesInfo', 'ppt/changesInfos/changesInfo1.xml', 'application/vnd.ms-powerpoint.changesinfo+xml']
];

async function run(name, bytes) {
  const copyOf = bytes.slice();
  return runPipeline({ name, size: copyOf.length, buffer: copyOf.buffer }, env);
}

test('parts extra: the added rows exist once, are found by kind and path, and carry their content type', () => {
  const kinds = PARTS.map((row) => row.kind);
  eq(new Set(kinds).size, kinds.length);
  for (const [kind, path, type] of ADDED) {
    assert(rowOfKind(kind), `${kind} row`);
    eq(rowOfPath(path)?.kind, kind, path);
    eq(rowOfKind(kind).contentType, type, `${kind} type`);
  }
});

test('parts extra: a path lookup gives an override type for each added row', () => {
  for (const [kind, path, type] of ADDED) {
    eq(overrideTypeFor(path), type, path);
  }
});

test('parts extra: relationship types of the added rows resolve in transitional form, and in strict where one exists', () => {
  for (const kind of ['printerSettingsExcel', 'ctrlProp', 'revisionHeaders', 'revisionLog', 'queryTable', 'tableSingleCells', 'volatileDependencies', 'xmlMaps']) {
    const row = rowOfKind(kind);
    assert(rowsOfRelType(row.relType).some((r) => r.kind === kind), `${kind} transitional`);
    assert(row.relTypeStrict && rowsOfRelType(row.relTypeStrict).some((r) => r.kind === kind), `${kind} strict`);
  }
  assert(rowsOfRelType('http://schemas.microsoft.com/office/2014/relationships/chartEx').some((r) => r.kind === 'chartEx'), 'chartEx');
  assert(rowsOfRelType(`${R}printerSettings`).length >= 2, 'printer settings are shared by two families');
  assert(rowsOfRelType(`${S}printerSettings`).length >= 2, 'strict form too');
});

test('parts extra: the older core-properties relationship URL finds the core properties row', () => {
  const alt = 'http://schemas.openxmlformats.org/officedocument/2006/relationships/metadata/core-properties';
  assert(rowsOfRelType(alt).some((r) => r.kind === 'coreProperties'), 'alias');
});

test('parts extra: a control property part with no content type is typed through its worksheet relationship', async () => {
  const entries = xlsxEntries().map(([name, content]) => (name === 'xl/worksheets/sheet1.xml' ? [name, content] : [name, content]));
  entries.push(['xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}ctrlProp" Target="../ctrlProps/ctrlProps1.xml"/></Relationships>`]);
  entries.push(['xl/ctrlProps/ctrlProps1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" objectType="CheckBox"/>']);
  const result = await run('s.xlsx', pack(entries));
  eq(result.outcome, 'repaired');
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const types = strFromU8(unzipSync(out)['[Content_Types].xml']);
  assert(types.includes('PartName="/xl/ctrlProps/ctrlProps1.xml"') && types.includes('application/vnd.ms-excel.controlproperties+xml'), 'typed');
});

test('parts extra: an OLE attachment that is a legacy workbook keeps its own type (the registry leaves OLE to the Default entry)', async () => {
  const entries = xlsxEntries().map(([name, content]) => (name === 'xl/_rels/workbook.xml.rels' ? [name, content.replace('</Relationships>', `<Relationship Id="rId9" Type="${R}oleObject" Target="embeddings/old.xls"/></Relationships>`)] : name === '[Content_Types].xml' ? [name, content.replace('</Types>', '<Default Extension="xls" ContentType="application/vnd.ms-excel"/></Types>')] : [name, content]));
  entries.push(['xl/embeddings/old.xls', 'legacy workbook bytes']);
  const result = await run('s.xlsx', pack(entries));
  eq(result.outcome, 'noProblems');
  eq(result.findings.map((f) => f.code), []);
});
