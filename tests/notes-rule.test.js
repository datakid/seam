import { test, assert, eq, env } from './harness.js';
import { docxEntries, pack } from './fixtures.js';
import { runPipeline } from '../js/core/pipeline.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

const note = (kind, id) => `<w:${kind} w:id="${id}"><w:p><w:r><w:t>Note ${id}</w:t></w:r></w:p></w:${kind}>`;
const notesPart = (kind, ids) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind}s xmlns:w="${NS_W}">${ids.map((id) => note(kind, id)).join('')}</w:${kind}s>`;
const REF = (kind, id) => `<w:r><w:rPr><w:rStyle w:val="Ref"/></w:rPr><w:${kind}Reference w:id="${id}"/></w:r>`;

function withNotes({ footnotes, settings }) {
  const entries = docxEntries(false).map(([name, content]) => {
    if (name === 'word/document.xml') {
      return [name, content.replace('<w:body>', `<w:body><w:p><w:r><w:t>Cited</w:t></w:r>${REF('footnote', 1)}${REF('footnote', 2)}<w:commentRangeStart w:id="5"/><w:r><w:t>text</w:t></w:r><w:commentRangeEnd w:id="5"/>${REF('comment', 5)}</w:p>`)];
    }
    if (name === 'word/_rels/document.xml.rels') {
      return [name, content.replace('</Relationships>', `<Relationship Id="rId8" Type="${REL}footnotes" Target="footnotes.xml"/><Relationship Id="rId9" Type="${REL}settings" Target="settings.xml"/></Relationships>`)];
    }
    if (name === '[Content_Types].xml') {
      return [name, content.replace('</Types>', `<Override PartName="/word/footnotes.xml" ContentType="${WML}footnotes+xml"/><Override PartName="/word/settings.xml" ContentType="${WML}settings+xml"/></Types>`)];
    }
    return [name, content];
  });
  entries.push(['word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${NS_W}">${settings}</w:settings>`]);
  entries.push(['word/footnotes.xml', footnotes]);
  return entries;
}

const SEPARATORS = '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>';

async function run(entries) {
  const bytes = pack(entries).slice();
  const result = await runPipeline({ name: 'n.docx', size: bytes.length, buffer: bytes.buffer }, env);
  const files = result.output ? unzipSync(result.output.bytes instanceof Uint8Array ? result.output.bytes : new Uint8Array(result.output.bytes)) : {};
  return { result, files, text: (name) => (files[name] ? strFromU8(files[name]) : null) };
}

const BREAK_STYLES = ([name, content]) => (name === 'word/styles.xml' ? [name, '<w:styles xmlns:w="x"><broken'] : [name, content]);

test('notes rule: references to notes and comments that are no longer in the file are removed, with the footnote separator settings', async () => {
  const entries = withNotes({ footnotes: notesPart('footnote', [-1, 0, 1, 2]), settings: SEPARATORS }).filter(([name]) => name !== 'word/footnotes.xml').map(BREAK_STYLES);
  const { result, text } = await run(entries);
  assert(result.output, JSON.stringify(result.findings.map((f) => f.code)));
  const document = text('word/document.xml');
  assert(!document.includes('footnoteReference'), 'footnote references removed');
  assert(!document.includes('commentRangeStart') && !document.includes('commentRangeEnd') && !document.includes('commentReference'), 'comment marks removed');
  assert(document.includes('Cited') && document.includes('text'), 'the text around them stays');
  assert(!text('word/settings.xml').includes('footnotePr'), 'separator settings removed');
  const found = result.findings.filter((f) => f.code === 'DOCX_NOTE_REFS_REMOVED');
  assert(found.some((f) => f.part === 'word/document.xml' && f.data.kind === 'footnote' && f.data.n === 2), JSON.stringify(found));
  assert(found.some((f) => f.part === 'word/document.xml' && f.data.kind === 'comment' && f.data.n === 3), JSON.stringify(found));
  assert(found.some((f) => f.part === 'word/settings.xml' && f.data.kind === 'footnote'), JSON.stringify(found));
});

test('notes rule: only the references whose note is missing from a part that survived are removed', async () => {
  const entries = withNotes({ footnotes: notesPart('footnote', [-1, 0, 1]), settings: SEPARATORS }).map(BREAK_STYLES);
  const { result, text } = await run(entries);
  assert(result.output, JSON.stringify(result.findings.map((f) => f.code)));
  const document = text('word/document.xml');
  assert(document.includes('footnoteReference w:id="1"'), 'reference to the surviving note stays');
  assert(!document.includes('footnoteReference w:id="2"'), 'reference to the missing note removed');
  assert(text('word/settings.xml').includes('footnotePr'), 'separators stay while the part exists');
});

test('notes rule: an intact package is never touched', async () => {
  const { result } = await run(withNotes({ footnotes: notesPart('footnote', [-1, 0, 1]), settings: SEPARATORS }));
  eq(result.outcome, 'noProblems', JSON.stringify(result.findings.map((f) => f.code)));
});
