import { test, assert, eq, env } from './harness.js';
import { xlsxEntries, pptxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';

async function run(name, bytes) {
  const copyOf = bytes.slice();
  return runPipeline({ name, size: copyOf.length, buffer: copyOf.buffer }, env);
}

function without(entries, ...names) {
  return entries.filter(([name]) => !names.includes(name));
}

function row(result, id) {
  return (result.inventory || []).find((r) => r.id === id) || null;
}

function damageData(bytes, name) {
  const needle = Array.from(new TextEncoder().encode(name));
  const out = bytes.slice();
  for (let i = 0; i + 30 + needle.length <= out.length; i++) {
    if (out[i] !== 0x50 || out[i + 1] !== 0x4b || out[i + 2] !== 3 || out[i + 3] !== 4) continue;
    let same = true;
    for (let j = 0; j < needle.length && same; j++) same = out[i + 30 + j] === needle[j];
    if (!same) continue;
    const start = i + 30 + needle.length + (out[i + 28] | (out[i + 29] << 8));
    for (let k = 0; k < 6; k++) out[start + k] ^= 0xff;
    return out;
  }
  throw new Error('entry not found');
}

function consistent(result) {
  for (const r of result.inventory || []) {
    assert(Number.isInteger(r.expected) && Number.isInteger(r.recovered), `${r.id} counts are integers`);
    assert(r.recovered >= 0 && r.recovered <= r.expected, `${r.id} recovered ${r.recovered} of ${r.expected}`);
  }
}

test('inventory: a workbook that lists two sheets and holds one reports one of two', async () => {
  const result = await run('book.xlsx', pack(without(xlsxEntries(), 'xl/worksheets/sheet2.xml')));
  const sheets = row(result, 'sheets');
  assert(sheets, 'sheets row present');
  eq(sheets.expected, 2);
  eq(sheets.recovered, 1);
  consistent(result);
});

test('inventory: a presentation that lists three slides and holds two reports two of three', async () => {
  const result = await run('deck.pptx', pack(without(pptxEntries(), 'ppt/slides/slide2.xml', 'ppt/slides/_rels/slide2.xml.rels')));
  const slides = row(result, 'slides');
  assert(slides, 'slides row present');
  eq(slides.expected, 3);
  eq(slides.recovered, 2);
  consistent(result);
});

test('inventory: a zip whose directory lists a part with damaged data reports it as not recovered', async () => {
  const names = xlsxEntries().map(([name]) => name);
  const damaged = damageData(pack(xlsxEntries()), 'xl/worksheets/sheet2.xml');
  const result = await run('book.xlsx', damaged);
  const parts = row(result, 'parts');
  assert(parts, 'parts row present');
  eq(parts.expected, names.length);
  assert(parts.recovered < parts.expected, `recovered ${parts.recovered} of ${parts.expected}`);
  consistent(result);
});

test('inventory: a zip that holds everything its directory lists reports all of it', async () => {
  const names = xlsxEntries().map(([name]) => name);
  const result = await run('book.xlsx', pack(without(xlsxEntries(), 'xl/worksheets/sheet2.xml')));
  const parts = row(result, 'parts');
  assert(parts, 'parts row present');
  eq(parts.expected, names.length - 1);
  eq(parts.recovered, parts.expected);
});

test('inventory: a zip without its directory gives no count of parts', async () => {
  const bytes = pack(without(xlsxEntries(), 'xl/worksheets/sheet2.xml'));
  const cut = bytes.slice(0, bytes.length - 120);
  const result = await run('book.xlsx', cut);
  assert(result.output, 'output produced');
  eq(row(result, 'parts'), null);
  consistent(result);
});

test('inventory: a workbook that had to be rebuilt gives no count of sheets', async () => {
  const result = await run('book.xlsx', pack(without(xlsxEntries(), 'xl/workbook.xml')));
  assert(result.findings.some((f) => f.code === 'XLSX_WORKBOOK_REBUILT'), 'workbook rebuilt');
  eq(row(result, 'sheets'), null);
  consistent(result);
});

test('inventory: a file with no problems carries no inventory', async () => {
  const result = await run('book.xlsx', pack(xlsxEntries()));
  eq(result.outcome, 'noProblems');
  assert(!result.inventory || result.inventory.length === 0, 'no inventory');
});
