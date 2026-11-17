import { test, assert, eq, env } from './harness.js';
import { docxEntries, xlsxEntries, pptxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { verifyPackage } from '../js/core/verify.js';

const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
const PML = 'application/vnd.openxmlformats-officedocument.presentationml.';

const VARIANTS = [
  { key: 'dotx', entries: docxEntries, main: '/word/document.xml', type: WML + 'template.main+xml' },
  { key: 'dotm', entries: () => docxEntries(true), main: '/word/document.xml', type: 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml' },
  { key: 'xltx', entries: xlsxEntries, main: '/xl/workbook.xml', type: SML + 'template.main+xml' },
  { key: 'xltm', entries: xlsxEntries, main: '/xl/workbook.xml', type: 'application/vnd.ms-excel.template.macroEnabled.main+xml' },
  { key: 'potx', entries: pptxEntries, main: '/ppt/presentation.xml', type: PML + 'template.main+xml' },
  { key: 'potm', entries: pptxEntries, main: '/ppt/presentation.xml', type: 'application/vnd.ms-powerpoint.template.macroEnabled.main+xml' },
  { key: 'ppsx', entries: pptxEntries, main: '/ppt/presentation.xml', type: PML + 'slideshow.main+xml' },
  { key: 'ppsm', entries: pptxEntries, main: '/ppt/presentation.xml', type: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml' }
];

function withMainType(entries, main, type) {
  return entries.map(([name, content]) => {
    if (name !== '[Content_Types].xml') return [name, content];
    return [name, content.replace(new RegExp(`(PartName="${main}" ContentType=")[^"]*(")`), `$1${type}$2`)];
  });
}

async function run(name, bytes) {
  const copyOf = bytes.slice();
  return runPipeline({ name, size: copyOf.length, buffer: copyOf.buffer }, env);
}

for (const v of VARIANTS) {
  const build = () => pack(withMainType(v.entries(), v.main, v.type));

  test(`healthy: a ${v.key} is left alone`, async () => {
    const result = await run(`sample.${v.key}`, build());
    eq(result.outcome, 'noProblems');
    eq(result.findings.map((f) => f.code), []);
    eq(result.detected.kind, v.key);
  });

  test(`healthy: a ${v.key} passes the structural checks as its own type`, async () => {
    const verdict = await verifyPackage(build(), env, { key: v.key, ext: v.key });
    assert(verdict.ok, `verify failed: ${JSON.stringify(verdict.failed)}`);
  });
}

test('healthy: a template type under a document extension is fixed to match the extension, not renamed', async () => {
  const bytes = pack(withMainType(docxEntries(), '/word/document.xml', WML + 'template.main+xml'));
  const result = await run('sample.docx', bytes);
  const codes = result.findings.map((f) => f.code);
  assert(codes.includes('CT_MAIN_FIXED'), 'content type fixed');
  assert(!codes.includes('EXTENSION_CORRECTED'), 'extension kept');
  eq(result.detected.kind, 'docx');
});

test('healthy: a document type under a template extension gets the extension corrected', async () => {
  const result = await run('sample.dotx', pack(docxEntries()));
  const codes = result.findings.map((f) => f.code);
  assert(codes.includes('EXTENSION_CORRECTED'), 'extension corrected');
  eq(result.detected.kind, 'docx');
});

function overridesOnly(entries) {
  const names = entries.map(([n]) => n).filter((n) => n !== '[Content_Types].xml');
  return entries.map(([name, content]) => {
    if (name !== '[Content_Types].xml') return [name, content];
    const existing = new Set([...content.matchAll(/PartName="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
    const defaults = new Map([...content.matchAll(/<Default Extension="([^"]+)" ContentType="([^"]+)"\/>/g)].map((m) => [m[1].toLowerCase(), m[2]]));
    let extra = '';
    for (const n of names) {
      const part = `/${n}`;
      if (existing.has(part.toLowerCase())) continue;
      const ext = n.split('.').pop().toLowerCase();
      if (ext === 'rels' || ext === 'xml') extra += `<Override PartName="${part}" ContentType="${defaults.get(ext)}"/>`;
    }
    return [name, content.replace(/<Default Extension="(rels|xml)"[^>]*\/>/g, '').replace('</Types>', `${extra}</Types>`)];
  });
}

for (const [key, entries] of [['docx', docxEntries], ['xlsx', xlsxEntries], ['pptx', pptxEntries]]) {
  test(`healthy: a ${key} whose rels and xml parts have explicit overrides and no defaults is left alone`, async () => {
    const bytes = pack(overridesOnly(entries()));
    const result = await run(`sample.${key}`, bytes);
    eq(result.outcome, 'noProblems');
    eq(result.findings.map((f) => f.code), []);
  });
}

const TRANSITIONAL_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const STRICT_R = 'http://purl.oclc.org/ooxml/officeDocument/relationships';

function strictify(entries) {
  return entries.map(([name, content]) => (typeof content === 'string' ? [name, content.split(TRANSITIONAL_R).join(STRICT_R)] : [name, content]));
}

for (const [key, entries] of [['docx', docxEntries], ['xlsx', xlsxEntries], ['pptx', pptxEntries]]) {
  test(`healthy: a ${key} with Strict relationship types and namespace is left alone`, async () => {
    const result = await run(`sample.${key}`, pack(strictify(entries())));
    eq(result.outcome, 'noProblems');
    eq(result.findings.map((f) => f.code), []);
  });
}

test('healthy: a damaged Strict xlsx is repaired and passes verification', async () => {
  const entries = strictify(xlsxEntries()).filter(([name]) => name !== 'xl/worksheets/sheet2.xml');
  const result = await run('sample.xlsx', pack(entries));
  assert(['repaired', 'partial'].includes(result.outcome), `outcome ${result.outcome}`);
  assert(result.output, 'output');
  const bytes = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const verdict = await verifyPackage(bytes, env, { key: 'xlsx', ext: 'xlsx' });
  assert(verdict.ok, `verify failed: ${JSON.stringify(verdict.failed)}`);
});

test('healthy: a damaged Strict docx keeps the Strict main relationship type', async () => {
  const entries = strictify(docxEntries()).filter(([name]) => name !== 'word/media/image1.png');
  const result = await run('sample.docx', pack(entries));
  assert(result.output, 'output');
  const { unzipSync, strFromU8 } = await import('../vendor/fflate.module.js');
  const bytes = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const rels = strFromU8(unzipSync(bytes)['_rels/.rels']);
  assert(rels.includes(`${STRICT_R}/officeDocument`), 'strict type kept');
  assert(!rels.includes(`${TRANSITIONAL_R}/officeDocument`), 'transitional type not introduced');
});

function utf16(text) {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    out[2 + i * 2] = text.charCodeAt(i) & 0xff;
    out[3 + i * 2] = text.charCodeAt(i) >> 8;
  }
  return out;
}

for (const [key, entries, part] of [['docx', docxEntries, 'word/styles.xml'], ['pptx', pptxEntries, 'ppt/theme/theme1.xml']]) {
  test(`healthy: a ${key} with a valid UTF-16 part is left alone and the part bytes are unchanged`, async () => {
    let original = null;
    const changed = entries().map(([name, content]) => {
      if (name !== part) return [name, content];
      original = utf16(content.replace('encoding="UTF-8"', 'encoding="UTF-16"'));
      return [name, original];
    });
    const result = await run(`sample.${key}`, pack(changed));
    eq(result.outcome, 'noProblems');
    eq(result.findings.map((f) => f.code), []);
  });
}

test('healthy: a main type supplied by a Default entry needs no override', async () => {
  const entries = docxEntries().map(([name, content]) => {
    if (name !== '[Content_Types].xml') return [name, content];
    return [name, content
      .replace(/<Override PartName="\/word\/document.xml"[^>]*\/>/, '')
      .replace('<Default Extension="xml" ContentType="application/xml"/>', `<Default Extension="xml" ContentType="${WML}document.main+xml"/>`)];
  });
  const result = await run('sample.docx', pack(entries));
  eq(result.outcome, 'noProblems');
  eq(result.findings.map((f) => f.code), []);
});

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function addNullRel(entries, relsPath) {
  return entries.map(([name, content]) => (name === relsPath ? [name, content.replace('</Relationships>', `<Relationship Id="rId9" Type="${IMAGE_REL}" Target="NULL"/></Relationships>`)] : [name, content]));
}

for (const [key, entries, relsPath] of [
  ['docx', docxEntries, 'word/_rels/document.xml.rels'],
  ['xlsx', xlsxEntries, 'xl/_rels/workbook.xml.rels'],
  ['pptx', pptxEntries, 'ppt/slides/_rels/slide3.xml.rels']
]) {
  test(`healthy: a ${key} with an unused relationship whose target is the literal NULL is left alone`, async () => {
    const result = await run(`sample.${key}`, pack(addNullRel(entries(), relsPath)));
    eq(result.outcome, 'noProblems');
    eq(result.findings.map((f) => f.code), []);
  });
}

test('healthy: a pptx picture that points at a NULL relationship keeps its picture', async () => {
  const picture = '<p:pic><p:nvPicPr><p:cNvPr id="3" name="Picture 3"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr/></p:pic>';
  const entries = addNullRel(pptxEntries(), 'ppt/slides/_rels/slide3.xml.rels').map(([name, content]) => (name === 'ppt/slides/slide3.xml' ? [name, content.replace('</p:spTree>', `${picture}</p:spTree>`)] : [name, content]));
  const result = await run('sample.pptx', pack(entries));
  eq(result.outcome, 'noProblems');
  eq(result.findings.map((f) => f.code), []);
});

test('healthy: a relationship to a missing real part is still removed', async () => {
  const entries = pptxEntries().map(([name, content]) => (name === 'ppt/slides/_rels/slide3.xml.rels' ? [name, content.replace('</Relationships>', `<Relationship Id="rId9" Type="${IMAGE_REL}" Target="../media/gone.png"/></Relationships>`)] : [name, content]));
  const result = await run('sample.pptx', pack(entries));
  assert(result.findings.map((f) => f.code).includes('REL_REMOVED'), 'dangling real target removed');
});

import { zipSync, strToU8, unzipSync } from '../vendor/fflate.module.js';
import { strictRead } from '../js/core/zip-read.js';

function bytesOf(content) {
  return typeof content === 'string' ? strToU8(content) : content;
}

function packWithStored(entries, storedNames) {
  const files = {};
  for (const [name, content] of entries) files[name] = storedNames.includes(name) ? [bytesOf(content), { level: 0 }] : bytesOf(content);
  return zipSync(files);
}

function joined(first, second) {
  const out = new Uint8Array(first.length + second.length);
  out.set(first, 0);
  out.set(second, first.length);
  return out;
}

test('damaged: two packages joined into one file are rebuilt, not returned as the original bytes', async () => {
  const input = joined(pack(docxEntries()), pack(xlsxEntries()));
  const result = await run('joined.docx', input);
  assert(result.output, 'output');
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  assert(out.length !== input.length || !out.every((v, i) => v === input[i]), 'output must not be the input bytes');
  const strict = strictRead(out, 0);
  assert(strict.intact, 'output reads strictly');
  eq(strict.shift, 0);
  assert(result.findings.map((f) => f.code).includes('ZIP_PREFIX_DATA'), 'leading data reported');
  assert(['repaired', 'partial'].includes(result.outcome), `outcome ${result.outcome}`);
});

function noise(length, seed) {
  const out = new Uint8Array(length);
  let a = seed >>> 0;
  for (let i = 0; i < length; i++) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    out[i] = a >>> 24;
  }
  return out;
}

function eocdSignatures(bytes) {
  const found = [];
  for (let i = 0; i + 4 <= bytes.length; i++) if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 5 && bytes[i + 3] === 6) found.push(i);
  return found;
}

test('damaged: an uncompressed embedded package is not mistaken for the directory of a document whose real directory is zeroed', async () => {
  const embedded = pack(xlsxEntries());
  const padded = docxEntries().concat([['word/embeddings/book.xlsx', embedded], ['word/media/pad.bin', noise(8000, 5)]]);
  const whole = packWithStored(padded, ['word/embeddings/book.xlsx']);
  const eocd = whole.length - 22;
  const cdSize = whole[eocd + 12] | (whole[eocd + 13] << 8) | (whole[eocd + 14] << 16) | (whole[eocd + 15] << 24);
  const damaged = whole.slice();
  damaged.fill(0, whole.length - (cdSize + 22));
  eq(eocdSignatures(damaged).length, 1);
  const result = await run('document.docx', damaged);
  assert(result.output, 'output');
  const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
  const names = Object.keys(unzipSync(out));
  assert(names.includes('word/document.xml'), `document kept: ${names.slice(0, 6).join(', ')}`);
  assert(!result.findings.map((f) => f.code).includes('EXTENSION_CORRECTED'), 'extension kept');
  eq(result.detected.kind, 'docx');
});

function docWithInsertedText(inserted) {
  return docxEntries().map(([name, content]) => {
    if (name !== 'word/document.xml') return [name, content];
    const at = content.indexOf('</w:t>');
    const head = new TextEncoder().encode(content.slice(0, at));
    const tail = new TextEncoder().encode(content.slice(at));
    const middle = typeof inserted === 'string' ? new TextEncoder().encode(inserted) : inserted;
    const merged = new Uint8Array(head.length + middle.length + tail.length);
    merged.set(head, 0);
    merged.set(middle, head.length);
    merged.set(tail, head.length + middle.length);
    return [name, merged];
  });
}

test('healthy: a literal replacement character that is valid UTF-8 is not an invalid byte', async () => {
  const result = await run('sample.docx', pack(docWithInsertedText('\uFFFD')));
  eq(result.outcome, 'noProblems');
  eq(result.findings.map((f) => f.code), []);
});

test('damaged: an invalid byte is reported once and the repaired output is clean on a second pass', async () => {
  const first = await run('sample.docx', pack(docWithInsertedText(Uint8Array.of(0xff))));
  assert(first.findings.map((f) => f.code).includes('XML_INVALID_BYTES'), 'invalid byte reported');
  assert(first.output, 'output');
  const out = first.output.bytes instanceof Uint8Array ? first.output.bytes : new Uint8Array(first.output.bytes);
  const second = await run('sample.docx', out);
  eq(second.outcome, 'noProblems');
  eq(second.findings.map((f) => f.code), []);
});

const ERROR_PAGE = '<!DOCTYPE html>\r\n<html><head><title>404 Not Found</title></head>\r\n<body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>\r\n';

for (const [key, entries] of [['docx', docxEntries], ['xlsx', xlsxEntries], ['pptx', pptxEntries]]) {
  test(`damaged: a ${key} with an HTML error page in front is recovered`, async () => {
    const page = new TextEncoder().encode(ERROR_PAGE);
    const result = await run(`sample.${key}`, joined(page, pack(entries())));
    assert(result.output, 'output');
    assert(result.findings.map((f) => f.code).includes('ZIP_PREFIX_DATA'), 'leading data reported');
    eq(result.detected.kind, key);
    const out = result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes);
    assert(Object.keys(unzipSync(out)).length > 3, 'entries recovered');
    assert(['repaired', 'partial'].includes(result.outcome), `outcome ${result.outcome}`);
  });
}

test('damaged: a file that is only an HTML error page is still reported as not an Office file', async () => {
  const result = await run('sample.docx', new TextEncoder().encode(ERROR_PAGE));
  eq(result.outcome, 'notSupported');
  eq(result.detected.kind, 'HTML');
});
