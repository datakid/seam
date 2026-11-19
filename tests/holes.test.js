import { test, assert, eq, bytesEqual, env } from './harness.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';
import { prng, words, docxEntries, pack } from './fixtures.js';
import { localEntry } from './corrupt.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';
import { repairXml, looksWellFormed } from '../js/core/xml-repair.js';
import { SENTINEL, spliceHoles, resolveHoles } from '../js/core/xml-holes.js';

const S = SENTINEL;
const WRAP = (inner) => `<a>${inner}</a>`;

function wellFormedAfterRepair(text) {
  const repaired = repairXml(text);
  return repaired.hasRoot && looksWellFormed(repaired.text);
}

test('holes: a hole inside text cuts the text node and keeps what follows the node', () => {
  const out = resolveHoles(WRAP(`<w:p><w:r><w:t>Hello wo${S}ld</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p>`));
  eq(out.text, WRAP('<w:p><w:r><w:t>Hello wo</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p>'));
  eq(out.holes, 1);
});

test('holes: a lost closing tag lets the next element start at the right level', () => {
  const out = resolveHoles(WRAP(`<w:p><w:r><w:t>a</w:t></w:r></w:p${S}><w:p><w:r><w:t>b</w:t></w:r></w:p>`));
  eq(out.text, WRAP('<w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:r><w:t>b</w:t></w:r></w:p>'));
});

test('holes: a run that starts after a cut text node closes what is open instead of nesting inside it', () => {
  const out = resolveHoles(WRAP(`<w:p><w:r><w:t>one ${S}<w:r><w:t>two</w:t></w:r><w:r><w:t>three</w:t></w:r></w:p>`));
  eq(out.text, WRAP('<w:p><w:r><w:t>one </w:t></w:r><w:r><w:t>two</w:t></w:r><w:r><w:t>three</w:t></w:r></w:p>'));
});

test('holes: an element that fits nowhere gets the parent the head showed for it', () => {
  const out = resolveHoles(WRAP(`<w:p><w:r><w:t>x</w:t></w:r></w:p>${S}<w:r><w:t>y</w:t></w:r>`));
  eq(repairXml(out.text).text, WRAP('<w:p><w:r><w:t>x</w:t></w:r></w:p><w:p><w:r><w:t>y</w:t></w:r></w:p>'));
});

test('holes: a hole inside a start tag drops that element and its subtree', () => {
  const out = resolveHoles(WRAP(`<w:p w14:paraId="2a${S}e1e"><w:r><w:t>drop</w:t></w:r></w:p><w:p><w:r><w:t>keep</w:t></w:r></w:p>`));
  eq(out.text, WRAP('<w:p><w:r><w:t>keep</w:t></w:r></w:p>'));
});

test('holes: nested elements of the same name are skipped as a unit', () => {
  const out = resolveHoles(WRAP(`<b x="${S}"><b><c/></b><d/></b><e/>`));
  eq(out.text, WRAP('<e/>'));
});

test('holes: a dropped element with a lost closing tag stops at the parent closer', () => {
  const out = resolveHoles(`<a><b><c x="${S}"><d/></b></a>`);
  eq(out.text, '<a><b></b></a>');
});

test('holes: a dropped element resumes at the next sibling of the same name', () => {
  const out = resolveHoles(WRAP(`<w:p w14:x="${S}"><w:r><w:t>lost</w:t></w:r><w:p><w:r><w:t>kept</w:t></w:r></w:p>`));
  assert(out.text.includes('kept') && !out.text.includes('lost'), out.text);
});

test('holes: a self-closing element with a hole is dropped alone', () => {
  const out = resolveHoles(WRAP(`<a1/><a2 x="${S}"/><a3/>`));
  eq(out.text, WRAP('<a1/><a3/>'));
});

test('holes: a partial entity before the hole is trimmed', () => {
  const out = resolveHoles(WRAP(`<t>x &am${S}p;y</t>`));
  eq(out.text, WRAP('<t>x </t>'));
});

test('holes: text without a sentinel is returned unchanged', () => {
  const input = WRAP('<t>plain</t>');
  const out = resolveHoles(input);
  eq(out.text, input);
  eq(out.holes, 0);
});

test('holes: a sentinel run counts once', () => {
  const out = resolveHoles(WRAP(`<t>a${S}${S}${S}b</t>`));
  eq(out.holes, 1);
});

test('holes: many holes are resolved quickly and the result can be repaired to well-formed XML', () => {
  const rand = prng(21);
  const parts = ['<w:document><w:body>'];
  for (let i = 0; i < 20000; i++) parts.push(`<w:p w14:paraId="${i}"><w:r><w:t>${words(i, 4)}</w:t></w:r></w:p>`);
  parts.push('</w:body></w:document>');
  let text = parts.join('');
  const chars = text.split('');
  for (let i = 0; i < 4000; i++) chars[Math.floor(rand() * chars.length)] = S;
  text = chars.join('');
  const started = performance.now();
  const out = resolveHoles(text);
  const elapsed = performance.now() - started;
  assert(elapsed < 1500, `took ${Math.round(elapsed)} ms`);
  assert(!out.text.includes(S), 'sentinel left behind');
  assert(wellFormedAfterRepair(out.text), 'not repairable');
});

test('holes: random holes in random markup never throw and never leave a sentinel', () => {
  const rand = prng(33);
  const pieces = ['<a>', '</a>', '<b x="1">', '</b>', '<c/>', 'text ', '&amp;', '<!-- c -->', '<?pi x?>', '<![CDATA[z]]>', '<d y="2" z=\'3\'>', '</d>'];
  for (let round = 0; round < 300; round++) {
    let text = '';
    const count = 5 + Math.floor(rand() * 60);
    for (let i = 0; i < count; i++) text += pieces[Math.floor(rand() * pieces.length)];
    const at = Math.floor(rand() * (text.length + 1));
    const run = 1 + Math.floor(rand() * 4);
    const damaged = text.slice(0, at) + S.repeat(run) + text.slice(at + run);
    const out = resolveHoles(damaged);
    assert(!out.text.includes(S), `sentinel left in ${JSON.stringify(damaged)}`);
  }
});

test('holes: splicing replaces each hole once, merges close holes and keeps whole characters', () => {
  const whole = new Uint8Array(200);
  for (let i = 0; i < whole.length; i++) whole[i] = 65 + (i % 26);
  const out = spliceHoles(whole, [[10, 20], [30, 40], [150, 160]]);
  eq(out.lost, 40);
  const text = new TextDecoder().decode(out.bytes);
  eq(text.split(S).length - 1, 2);
  assert(text.startsWith('ABCDEFGHIJ' + S), 'head');
});

test('holes: splicing trims half a multi-byte character beside a hole', () => {
  const unit = new TextEncoder().encode('é');
  const whole = new Uint8Array(80);
  whole.fill(0x61);
  whole.set(unit, 19);
  whole.set(unit, 40);
  const out = spliceHoles(whole, [[20, 40]]);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(out.bytes);
  assert(text.includes(S), 'sentinel present');
  assert(!text.includes('�'), 'replacement character');
});

test('holes: UTF-16 data is not spliced', () => {
  const whole = new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x61, 0x00, 0x3e, 0x00, 0, 0, 0, 0]);
  eq(spliceHoles(whole, [[8, 12]]), null);
});

function bigDocx(paragraphCount) {
  const paragraphs = [];
  for (let i = 0; i < paragraphCount; i++) {
    const text = `${words(500 + i, 8)} ${1000 + i}`;
    paragraphs.push(`<w:p w14:paraId="${(0x10000000 + i * 7919).toString(16)}"><w:r><w:t>${text}</w:t></w:r></w:p>`);
  }
  const entries = docxEntries(false).map(([name, content]) => {
    if (name !== 'word/document.xml') return [name, content];
    return [name, content.replace('<w:document', '<w:document xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"').replace('<w:body>', `<w:body>${paragraphs.join('')}`)];
  });
  const bytes = pack(entries);
  const texts = textRuns(strFromU8(unzipSync(bytes)['word/document.xml']));
  return { bytes, texts };
}

async function run(name, bytes) {
  const copyOf = bytes.slice();
  return runPipeline({ name, size: copyOf.length, buffer: copyOf.buffer }, env);
}

function textRuns(xml) {
  const out = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

test('holes: a zeroed run inside document.xml keeps text after the damage and stays valid', async () => {
  const { bytes, texts } = bigDocx(5000);
  const entry = localEntry(bytes, 'word/document.xml');
  const damaged = bytes.slice();
  const at = entry.dataStart + Math.floor(entry.csize * 0.3);
  damaged.fill(0, at, at + 512);
  const result = await run('File.docx', damaged);
  const found = result.findings.map((f) => f.code);
  assert(result.output, `no output: ${result.outcome} ${JSON.stringify(found)}`);
  assert(found.includes('XML_HOLE_DROPPED'), JSON.stringify(found));
  const verdict = await verifyPackage(new Uint8Array(result.output.bytes), env, { key: 'docx', ext: 'docx' });
  assert(verdict.ok, `verification failed: ${JSON.stringify(verdict.failed)}`);
  const parts = unzipSync(new Uint8Array(result.output.bytes));
  const runsOut = textRuns(strFromU8(parts['word/document.xml']));
  const original = new Set(texts);
  for (const t of runsOut) {
    if (!original.has(t)) assert(texts.some((o) => o.startsWith(t)), `text not from the original: ${t}`);
  }
  assert(runsOut.length > texts.length * 0.5, `kept ${runsOut.length} of ${texts.length} text runs`);
  const late = new Set(texts.slice(Math.floor(texts.length * 0.9)));
  assert(runsOut.some((t) => late.has(t)), 'nothing recovered from the last tenth');
});
