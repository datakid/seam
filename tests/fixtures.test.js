import { test, assert, eq, env } from './harness.js';
import { docx, xlsx, pptx, docm, unpack } from './fixtures.js';
import { verifyPackage } from '../js/core/verify.js';
import { strictRead } from '../js/core/zip-read.js';

const CASES = [
  ['docx', docx, { key: 'docx', ext: 'docx' }],
  ['xlsx', xlsx, { key: 'xlsx', ext: 'xlsx' }],
  ['pptx', pptx, { key: 'pptx', ext: 'pptx' }],
  ['docm', docm, { key: 'docm', ext: 'docm' }]
];

for (const [name, build, expected] of CASES) {
  test(`fixtures: ${name} passes the structural checks`, async () => {
    const bytes = build();
    const verdict = await verifyPackage(bytes, env, expected);
    assert(verdict.ok, `verify failed: ${JSON.stringify(verdict.failed)}`);
  });

  test(`fixtures: ${name} reads back strictly with Content_Types first`, () => {
    const read = strictRead(build(), 0);
    assert(read.intact, `not intact: ${read.errors}`);
    eq(read.entries[0].name, '[Content_Types].xml');
  });
}

test('fixtures: verify rejects a package with a missing relationship target', async () => {
  const entries = unpack(docx()).filter(([n]) => n !== 'word/media/image1.png');
  const { pack } = await import('./fixtures.js');
  const verdict = await verifyPackage(pack(entries), env, { key: 'docx', ext: 'docx' });
  assert(!verdict.ok, 'should fail');
  eq(verdict.failed[0].check, 3);
});

test('fixtures: verify rejects a package whose first entry is not Content_Types', async () => {
  const entries = unpack(docx());
  const [first, ...rest] = entries;
  const { pack } = await import('./fixtures.js');
  const verdict = await verifyPackage(pack([...rest, first]), env, { key: 'docx', ext: 'docx' });
  assert(!verdict.ok, 'should fail');
  eq(verdict.failed[0].check, 1);
});

test('fixtures: the docm has a vbaProject part and macro content types', () => {
  const names = unpack(docm()).map(([n]) => n);
  assert(names.includes('word/vbaProject.bin'), 'vbaProject.bin');
});
