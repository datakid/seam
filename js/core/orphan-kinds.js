const W = 'wordprocessingml/2006/main';
const S = 'spreadsheetml/2006/main';
const P = 'presentationml/2006/main';
const A = 'drawingml/2006/main';

const BY_ROOT = [
  ['document', W, { path: 'word/document.xml' }],
  ['styles', W, { path: 'word/styles.xml' }],
  ['numbering', W, { path: 'word/numbering.xml' }],
  ['fontTable', W, { path: 'word/fontTable.xml' }],
  ['settings', W, { path: 'word/settings.xml' }],
  ['webSettings', W, { path: 'word/webSettings.xml' }],
  ['comments', W, { path: 'word/comments.xml' }],
  ['footnotes', W, { path: 'word/footnotes.xml' }],
  ['endnotes', W, { path: 'word/endnotes.xml' }],
  ['hdr', W, { pattern: /^word\/header\d+\.xml$/i }],
  ['ftr', W, { pattern: /^word\/footer\d+\.xml$/i }],
  ['workbook', S, { path: 'xl/workbook.xml' }],
  ['styleSheet', S, { path: 'xl/styles.xml' }],
  ['sst', S, { path: 'xl/sharedStrings.xml' }],
  ['calcChain', S, { path: 'xl/calcChain.xml' }],
  ['worksheet', S, { pattern: /^xl\/worksheets\/sheet\d+\.xml$/i }],
  ['presentation', P, { path: 'ppt/presentation.xml' }],
  ['presentationPr', P, { path: 'ppt/presProps.xml' }],
  ['viewPr', P, { path: 'ppt/viewProps.xml' }],
  ['sld', P, { pattern: /^ppt\/slides\/slide\d+\.xml$/i }],
  ['sldMaster', P, { pattern: /^ppt\/slideMasters\/slideMaster\d+\.xml$/i }],
  ['sldLayout', P, { pattern: /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i }],
  ['tblStyleLst', A, { path: 'ppt/tableStyles.xml' }],
  ['theme', A, { pattern: /^(word|xl|ppt)\/theme\/theme\d+\.xml$/i }],
  ['Types', 'package/2006/content-types', { path: '[Content_Types].xml' }],
  ['coreProperties', 'package/2006/metadata/core-properties', { path: 'docProps/core.xml' }],
  ['Properties', 'officeDocument/2006/extended-properties', { path: 'docProps/app.xml' }]
];

const START_TAG = /<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:\s[^<>]*)?)>/;

function skipProlog(text) {
  let at = 0;
  for (;;) {
    while (at < text.length && /\s/.test(text[at])) at++;
    if (text.startsWith('<?', at)) {
      const end = text.indexOf('?>', at);
      if (end === -1) return text.length;
      at = end + 2;
    } else if (text.startsWith('<!--', at)) {
      const end = text.indexOf('-->', at);
      if (end === -1) return text.length;
      at = end + 3;
    } else if (text.startsWith('<!DOCTYPE', at)) {
      const end = text.indexOf('>', at);
      if (end === -1) return text.length;
      at = end + 1;
    } else {
      return at;
    }
  }
}

export function rootOf(data) {
  const head = new TextDecoder('utf-8').decode(data.subarray(0, 4096)).replace(/^﻿/, '');
  const at = skipProlog(head);
  const match = START_TAG.exec(head.slice(at));
  if (!match || match.index !== 0) return null;
  const prefix = match[1] ? match[1].slice(0, -1) : '';
  const attrs = match[3] || '';
  const declared = new RegExp(`xmlns${prefix ? `:${prefix}` : ''}\\s*=\\s*["']([^"']*)["']`).exec(attrs);
  return { local: match[2], ns: declared ? declared[1] : '', attrs };
}

function relationshipsPath(text) {
  if (/relationships\/officeDocument"/.test(text)) return '_rels/.rels';
  if (/relationships\/(worksheet|sharedStrings|calcChain)"/.test(text)) return 'xl/_rels/workbook.xml.rels';
  if (/relationships\/slideMaster"/.test(text)) return 'ppt/_rels/presentation.xml.rels';
  if (/relationships\/(styles|numbering|fontTable|settings|webSettings|footnotes|endnotes|comments)"/.test(text)) return 'word/_rels/document.xml.rels';
  return null;
}

function magicOf(data) {
  const b = data;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { kind: 'png', ext: 'png', pattern: /\/media\/[^/]+\.png$/i };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'jpeg', ext: 'jpeg', pattern: /\/media\/[^/]+\.jpe?g$/i };
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return { kind: 'gif', ext: 'gif', pattern: /\/media\/[^/]+\.gif$/i };
  if (b.length >= 44 && b[0] === 1 && b[1] === 0 && b[2] === 0 && b[3] === 0 && b[40] === 0x20 && b[41] === 0x45 && b[42] === 0x4d && b[43] === 0x46) return { kind: 'emf', ext: 'emf', pattern: /\/media\/[^/]+\.emf$/i };
  if (b.length >= 4 && b[0] === 0xd7 && b[1] === 0xcd && b[2] === 0xc6 && b[3] === 0x9a) return { kind: 'wmf', ext: 'wmf', pattern: /\/media\/[^/]+\.wmf$/i };
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1) return { kind: 'vba', ext: 'bin', pattern: /^(word|xl)\/vbaProject\.bin$/i };
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return { kind: 'mp4', ext: 'mp4', pattern: /\/media\/[^/]+\.mp4$/i };
  return null;
}

export function identifyContent(data) {
  const media = magicOf(data);
  if (media) return media;
  const root = rootOf(data);
  if (!root) return { kind: 'unknown', ext: 'bin' };
  if (root.local === 'Relationships') {
    const text = new TextDecoder('utf-8').decode(data);
    return { kind: 'rels', ext: 'rels', path: relationshipsPath(text), needsSource: true };
  }
  for (const [local, ns, target] of BY_ROOT) {
    if (root.local === local && root.ns.includes(ns)) return { kind: local, ext: 'xml', ...target };
  }
  return { kind: 'xml', ext: 'xml' };
}
