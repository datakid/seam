import { test, assert, eq, bytesEqual, env } from './harness.js';
import { docx, xlsx, pptx, docm, unpack, FORMATS } from './fixtures.js';
import { CORRUPTORS, deleteDirectory } from './corrupt.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';
import { unzipSync } from '../vendor/fflate.module.js';

const BUILD = { docx, xlsx, pptx };

async function run(name, bytes) {
  const copyOf = bytes.slice();
  return runPipeline({ name, size: copyOf.length, buffer: copyOf.buffer }, env);
}

function codes(result) {
  return result.findings.map((f) => f.code);
}

async function checkOutput(result, key) {
  assert(result.output, 'expected an output file');
  const bytes = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const verdict = await verifyPackage(bytes, env, key ? { key, ext: key } : null);
  assert(verdict.ok, `output failed verification: ${JSON.stringify(verdict.failed)}`);
  return unzipSync(bytes);
}

function mediaIdentical(original, outputParts) {
  for (const [name, data] of unpack(original)) {
    if (/\.(png|bin)$/i.test(name) && outputParts[name]) assert(bytesEqual(outputParts[name], data), `${name} changed`);
  }
}

function noInternalError(result) {
  assert(!codes(result).includes('INTERNAL_ERROR'), 'internal error escaped');
}

for (const fmt of ['docx', 'xlsx', 'pptx']) {
  const ext = FORMATS[fmt].ext;
  const original = BUILD[fmt]();

  test(`C16 ${fmt}: untouched file gives No problems found and no output`, async () => {
    const result = await run(`File.${ext}`, original);
    noInternalError(result);
    eq(result.outcome, 'noProblems');
    assert(result.output === null, 'no output');
  });

  for (const c of CORRUPTORS) {
    if (!c.fmts.includes(fmt)) continue;
    test(`${c.id} ${fmt}`, async () => {
      const broken = c.apply(original, fmt);
      const result = await run(`File.${ext}`, broken);
      noInternalError(result);
      const found = codes(result);
      const dump = () => `${result.outcome} ${JSON.stringify(found)}`;
      if (c.id.startsWith('C1-')) {
        assert(['partial', 'salvaged'].includes(result.outcome), `outcome ${dump()}`);
        await checkOutput(result, result.outcome === 'salvaged' ? undefined : fmt);
        return;
      }
      if (c.id === 'C2') {
        eq(result.outcome, 'repaired', dump());
        assert(found.includes('ZIP_DIRECTORY_REBUILT'), dump());
        const parts = await checkOutput(result, fmt);
        for (const [name, data] of unpack(original)) assert(parts[name] && bytesEqual(parts[name], data), `${name} not byte-identical`);
        return;
      }
      if (c.id === 'C3') {
        eq(result.outcome, 'repaired', dump());
        assert(found.includes('ZIP_PREFIX_DATA'), dump());
        mediaIdentical(original, await checkOutput(result, fmt));
        return;
      }
      if (c.id === 'C4') {
        eq(result.outcome, 'repaired', dump());
        assert(found.includes('CT_REBUILT'), dump());
        mediaIdentical(original, await checkOutput(result, fmt));
        return;
      }
      if (c.id === 'C5') {
        eq(result.outcome, 'repaired', dump());
        assert(found.includes('ROOT_RELS_REBUILT'), dump());
        mediaIdentical(original, await checkOutput(result, fmt));
        return;
      }
      if (c.id === 'C6') {
        eq(result.outcome, 'repaired', dump());
        assert(found.includes('XML_CHARS_REMOVED'), dump());
        mediaIdentical(original, await checkOutput(result, fmt));
        return;
      }
      if (c.id === 'C7') {
        eq(result.outcome, 'partial', dump());
        assert(found.includes('XML_TRUNCATED_CLOSED'), dump());
        await checkOutput(result, fmt);
        return;
      }
      if (c.id === 'C8') {
        eq(result.outcome, 'partial', dump());
        assert(found.includes('REL_REMOVED'), dump());
        assert(found.includes(fmt === 'docx' ? 'DOCX_IMAGE_REMOVED' : 'PPTX_IMAGE_REMOVED'), dump());
        await checkOutput(result, fmt);
        return;
      }
      if (c.id === 'C9') {
        eq(result.outcome, 'partial', dump());
        assert(found.includes('XLSX_CELL_CLEARED'), dump());
        await checkOutput(result, fmt);
        return;
      }
      if (c.id === 'C10') {
        eq(result.outcome, 'partial', dump());
        const removed = result.findings.find((f) => f.code === 'XLSX_SHEET_REMOVED');
        assert(removed && removed.data.name === 'Notes', dump());
        assert(found.includes('XLSX_NAMES_ADJUSTED'), dump());
        await checkOutput(result, fmt);
        return;
      }
      if (c.id === 'C11') {
        assert(['partial', 'salvaged'].includes(result.outcome), `outcome ${dump()}`);
        await checkOutput(result, result.outcome === 'salvaged' ? undefined : fmt);
        return;
      }
      if (c.id === 'C12') {
        assert(['salvaged', 'failed'].includes(result.outcome), `outcome ${dump()}`);
        if (result.outcome === 'salvaged') await checkOutput(result);
        return;
      }
      if (c.id === 'C18') {
        eq(result.outcome, 'repaired', dump());
        assert(found.includes('XML_REENCODED'), dump());
        await checkOutput(result, fmt);
      }
    });
  }
}

test('C15: a docx named .xlsx is reported with the corrected extension', async () => {
  const result = await run('Report.xlsx', docx());
  noInternalError(result);
  assert(['repaired', 'noProblems'].includes(result.outcome), result.outcome);
  assert(codes(result).includes('EXTENSION_CORRECTED'), JSON.stringify(codes(result)));
  assert(result.output && result.output.name.endsWith('.docx'), 'output named .docx');
  await checkOutput(result, 'docx');
});

test('C17: a docm with the directory removed keeps vbaProject.bin and is written as .docm', async () => {
  const original = docm();
  const result = await run('Macros.docm', deleteDirectory(original));
  noInternalError(result);
  eq(result.outcome, 'repaired', JSON.stringify(codes(result)));
  assert(result.output.name.endsWith('.docm'), result.output.name);
  const parts = await checkOutput(result, 'docm');
  const vba = unpack(original).find(([n]) => n === 'word/vbaProject.bin')[1];
  assert(bytesEqual(parts['word/vbaProject.bin'], vba), 'vbaProject.bin differs');
});

test('a docm named .docx is corrected to .docm without changing the parts', async () => {
  const result = await run('Macros.docx', docm());
  eq(result.detected.kind, 'docm');
  assert(codes(result).includes('EXTENSION_CORRECTED'), 'extension finding');
  assert(result.output.name.endsWith('.docm'), result.output.name);
});

test('outputs are named from the original base name', async () => {
  const result = await run('Budget 2026.xlsx', deleteDirectory(xlsx()));
  eq(result.output.name, 'Budget 2026 (repaired).xlsx');
});

test('progress is reported in order and ends at 100 or below', async () => {
  const seen = [];
  const local = { isWellFormed: env.isWellFormed, progress: (stage, pct) => seen.push([stage, pct]) };
  const bytes = deleteDirectory(docx()).slice();
  await runPipeline({ name: 'a.docx', size: bytes.length, buffer: bytes.buffer }, local);
  assert(seen.length > 5, 'progress events');
  for (let i = 1; i < seen.length; i++) assert(seen[i][1] >= seen[i - 1][1] - 1, `progress went backwards at ${i}`);
  assert(seen[seen.length - 1][1] <= 100, 'within 100');
});

test('a crc mismatch in a kept part is never reported as Repaired', async () => {
  const { localEntry } = await import('./corrupt.js');
  const original = docx();
  const info = localEntry(original, 'word/media/image1.png');
  const broken = original.slice();
  broken[info.dataStart + 40] ^= 0xff;
  const result = await run('Photo.docx', broken);
  eq(result.outcome, 'partial', JSON.stringify(codes(result)));
  assert(codes(result).includes('ZIP_ENTRY_CRC'), 'crc finding');
});
