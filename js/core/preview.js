import { packageNames, packageKind, packageParts, documentParagraphs, workbookSheets, presentationSlides } from './extract.js';

const LIMITS = { paragraphs: 12, paragraphChars: 200, sheets: 6, rows: 8, columns: 8, cellChars: 40, slides: 40, titleChars: 120, sheetSample: 262144, maxBytes: 67108864 };

const XML_PARTS = /^(word\/(document|footnotes|endnotes|comments)\.xml|xl\/(workbook|sharedStrings)\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/[^/]+\.xml|ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml))$/;

function clip(text, max) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const MEDIA = /^(word|xl|ppt)\/media\/[^/]+$/i;

export function mediaNames(names) {
  return names.filter((name) => MEDIA.test(name));
}

export function buildView(bytes) {
  if (bytes.length > LIMITS.maxBytes) return null;
  const names = packageNames(bytes);
  const kind = packageKind(names);
  if (!kind) return null;
  const files = packageParts(bytes, (file) => XML_PARTS.test(file.name));
  if (!files) return null;
  const exports = { text: false, csv: false, media: mediaNames(names).length > 0 };
  if (kind === 'document') {
    const paragraphs = documentParagraphs(files).filter((p) => p.trim() !== '');
    exports.text = paragraphs.length > 0;
    return {
      kind,
      lines: paragraphs.slice(0, LIMITS.paragraphs).map((p) => clip(p, LIMITS.paragraphChars)),
      more: Math.max(0, paragraphs.length - LIMITS.paragraphs),
      exports
    };
  }
  if (kind === 'workbook') {
    const sheets = workbookSheets(files, { sample: LIMITS.sheetSample, rowLimit: LIMITS.rows * 4 });
    const shown = [];
    for (const sheet of sheets) {
      const filled = sheet.rows.filter((row) => row.cells.length > 0);
      if (filled.length > 0) exports.csv = true;
      if (shown.length < LIMITS.sheets) {
        shown.push({
          name: clip(sheet.name, LIMITS.titleChars),
          rows: filled.slice(0, LIMITS.rows).map((row) => row.cells.slice(0, LIMITS.columns).map((cell) => clip(cell, LIMITS.cellChars)))
        });
      }
    }
    exports.text = exports.csv;
    return { kind, sheets: shown, more: Math.max(0, sheets.length - LIMITS.sheets), exports };
  }
  const slides = presentationSlides(files);
  exports.text = slides.some((slide) => slide.lines.length > 0);
  return {
    kind,
    slides: slides.slice(0, LIMITS.slides).map((slide) => ({ number: slide.number, title: clip(slide.title, LIMITS.titleChars) })),
    more: Math.max(0, slides.length - LIMITS.slides),
    exports
  };
}
