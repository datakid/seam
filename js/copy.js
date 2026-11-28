import { REF_LOSS_NAMES } from './core/data/ref-policy.js';
export function plural(n, one, many) {
  return n === 1 ? one : many;
}

function refRemovedText(d) {
  const names = REF_LOSS_NAMES[d.loss];
  if (!names) return `${d.n} ${plural(d.n, 'reference', 'references')} to content that is no longer in the file ${d.n === 1 ? 'was' : 'were'} removed from this part.`;
  const noun = plural(d.n, names[0], names[1]);
  if (d.loss === 'link') return `Removed ${d.n} ${noun} to missing targets. The link text was kept.`;
  if (d.loss === 'image') return `Removed ${d.n} ${noun} whose data is missing.`;
  return `Removed ${d.n} ${noun} that pointed to content missing from the file.`;
}

function list(parts) {
  return parts.join(', ');
}

function xmlRepairText(d) {
  const parts = [];
  if (d.autoClosed) parts.push(`closed ${d.autoClosed} ${plural(d.autoClosed, 'element', 'elements')} left open`);
  if (d.strayClosed) parts.push(`dropped ${d.strayClosed} stray closing ${plural(d.strayClosed, 'tag', 'tags')}`);
  if (d.dupAttrs) parts.push(`removed ${d.dupAttrs} duplicate ${plural(d.dupAttrs, 'attribute', 'attributes')}`);
  if (d.quotedAttrs) parts.push(`quoted ${d.quotedAttrs} attribute ${plural(d.quotedAttrs, 'value', 'values')}`);
  if (d.droppedAttrs) parts.push(`dropped ${d.droppedAttrs} attribute ${plural(d.droppedAttrs, 'without a value', 'without a value')}`);
  if (d.escaped) parts.push(`escaped ${d.escaped} stray ${plural(d.escaped, 'character', 'characters')}`);
  if (d.dropped) parts.push(`dropped ${d.dropped} unreadable ${plural(d.dropped, 'token', 'tokens')}`);
  if (d.trailingContent) parts.push('dropped content after the root element');
  if (parts.length === 0) parts.push('rewrote the markup');
  return `Repaired the XML structure: ${list(parts)}.`;
}

function copyUnusedText(d) {
  if (d.why === 'unreadable') return `${d.name} could not be read as a package, so nothing was taken from it.`;
  if (d.why === 'different') return `${d.name} does not match this file. Parts that should be identical differ, so nothing was taken from it.`;
  return `Nothing in ${d.name} was more complete than this file, so nothing was taken from it.`;
}

function donorUnusedText(d) {
  if (d.why === 'unreadable') return `${d.name} could not be read as a package, so nothing was taken from it.`;
  if (d.why === 'kind') return `${d.name} is not the same kind of file, so nothing was taken from it.`;
  return `${d.name} had no style, theme or layout part that this file was missing, so nothing was taken from it.`;
}

const STRUCTURAL_OK = 'Passed structural checks.';
const CONTENT_OK = 'Passed structural and content checks.';

export const copy = {
  title: 'Seam',
  headline: 'Repair damaged Word, Excel and PowerPoint files.',
  privacy: 'Files are processed on this device and never uploaded.',
  drop: {
    idle: 'Drop .docx, .xlsx or .pptx files here',
    or: 'or',
    button: 'Choose files',
    over: 'Release to add files',
    compact: 'Add more files',
    folder: "Folders aren't supported. Drop files instead."
  },
  summary(c) {
    const parts = [`${c.n} ${plural(c.n, 'file', 'files')}`];
    if (c.r) parts.push(`${c.r} repaired`);
    if (c.p) parts.push(`${c.p} partially repaired`);
    if (c.s) parts.push(`${c.s} salvaged`);
    if (c.f) parts.push(`${c.f} could not be repaired`);
    return parts.join(' · ');
  },
  btn: {
    downloadAll: 'Download all',
    clear: 'Clear',
    download: 'Download repaired file',
    downloadSalvage: 'Download salvaged text',
    copyReport: 'Copy report',
    saveReport: 'Save report (.txt)',
    close: 'Close',
    addCopy: 'Add another copy',
    addDonor: 'Use a healthy file from the same source',
    exportText: 'Export text (.txt)',
    exportCsv: 'Export sheets (.csv)',
    exportMedia: 'Export images (.zip)'
  },
  view: {
    heading: { document: 'First paragraphs', workbook: 'First rows of each sheet', presentation: 'Slide titles' },
    more: {
      document(n) {
        return `${n} more ${plural(n, 'paragraph', 'paragraphs')} in the file.`;
      },
      workbook(n) {
        return `${n} more ${plural(n, 'sheet', 'sheets')} in the file.`;
      },
      presentation(n) {
        return `${n} more ${plural(n, 'slide', 'slides')} in the file.`;
      }
    },
    untitled: 'No title',
    large: 'Too large to show a preview.',
    exportEmpty: 'Nothing to export'
  },
  copied: 'Copied',
  status: { queued: 'Queued', working: 'Checking' },
  link: { scope: 'What Seam can repair', scopeShort: 'What it can repair' },
  footer: 'Open source · MIT licence · Nothing leaves your device',
  theme: { label: 'Theme', system: 'System', light: 'Light', dark: 'Dark' },
  verify: {
    ok: STRUCTURAL_OK,
    okContent: CONTENT_OK,
    line(result) {
      return result && result.tier >= 2 && result.outcome !== 'salvaged' ? CONTENT_OK : STRUCTURAL_OK;
    },
    advice: 'Open the file and check its contents before relying on it.'
  },
  notice: {
    duplicates(n) {
      return `Skipped ${n} duplicate ${plural(n, 'file', 'files')}.`;
    },
    limit: 'Only the first 50 files were added. Add the rest after these finish.',
    copiesLimit(n) {
      return `A file can take up to ${n} extra copies.`;
    },
    tooLarge: 'This file is larger than 200 MB. Seam processes files in memory, and very large files can exceed browser limits.'
  },
  live: {
    processing(n) {
      return `Processing ${n} ${plural(n, 'file', 'files')}.`;
    },
    done(r, p, f) {
      return `Done. ${r} repaired, ${p} partially repaired, ${f} could not be repaired.`;
    }
  },
  outcomes: {
    notSupported: 'Not supported',
    notProcessed: 'Not processed',
    noProblems: 'No problems found',
    repaired: 'Repaired',
    partial: 'Partially repaired',
    salvaged: 'Salvaged text',
    failed: 'Could not repair'
  },
  sentences: {
    noProblems: 'No structural problems found. No changes were made.',
    repaired(k) {
      return `Repaired ${k} structural ${plural(k, 'problem', 'problems')}. No content loss was detected.`;
    },
    partial: 'Repaired the file structure. Some content could not be recovered. See Lost below.',
    salvaged: 'The file structure could not be rebuilt. Text was recovered into a new file.',
    failed(reason) {
      return `This file could not be repaired. ${reason}`;
    }
  },
  reasons: {
    nothing: 'No readable content was found.',
    verify: 'The repaired file did not pass structural checks and no text could be recovered.',
    noMain: 'The main document part is missing, so there is no content to rebuild.',
    noSheets: 'No readable sheets remain.',
    noMaster: 'No readable slide master remains.',
    noLayout: 'No readable slide layout remains.',
    mainBroken: 'The main document part could not be read as XML.',
    internal: 'Seam hit an unexpected error while processing this file. The original is unchanged.',
    timeout: 'Processing took longer than 120 seconds and was stopped. The original is unchanged.'
  },
  detection: {
    ENCRYPTED_OOXML: "This file is password-protected. Seam can't open encrypted files. If you know the password, open it in Office and save an unprotected copy, then try again.",
    legacy(ext) {
      return `This is an older binary Office file (${ext}). This version of Seam only repairs .docx, .xlsx and .pptx files.`;
    },
    CFB_UNKNOWN: 'This is a Microsoft compound file but not a recognised Office document.',
    other(type) {
      return `This file is a ${type}, not an Office document. Its extension may be wrong.`;
    },
    types: {
      PDF: 'PDF document',
      RTF: 'rich text document',
      HTML: 'web page',
      PNG: 'PNG image',
      JPEG: 'JPEG image',
      GIF: 'GIF image'
    },
    FLAT_OPC_XML: "This is a single-file XML Office document. This format isn't supported in this version.",
    EMPTY: "The file contains no data. Every byte is empty, which usually means the contents were never written. It can't be recovered from this file.",
    UNKNOWN: 'Not recognised as an Office document. No ZIP structure was found.'
  },
  formats: {
    docx: 'Word document',
    docm: 'Word macro-enabled document',
    xlsx: 'Excel workbook',
    xlsm: 'Excel macro-enabled workbook',
    pptx: 'PowerPoint presentation',
    pptm: 'PowerPoint macro-enabled presentation',
    dotx: 'Word template',
    dotm: 'Word macro-enabled template',
    xltx: 'Excel template',
    xltm: 'Excel macro-enabled template',
    potx: 'PowerPoint template',
    potm: 'PowerPoint macro-enabled template',
    ppsx: 'PowerPoint show',
    ppsm: 'PowerPoint macro-enabled show',
    ENCRYPTED_OOXML: 'Password-protected Office file',
    LEGACY_DOC: 'Word 97-2003 document',
    LEGACY_XLS: 'Excel 97-2003 workbook',
    LEGACY_PPT: 'PowerPoint 97-2003 presentation',
    CFB_UNKNOWN: 'Microsoft compound file',
    PDF: 'PDF document',
    RTF: 'RTF document',
    HTML: 'HTML document',
    IMAGE: 'Image',
    FLAT_OPC_XML: 'Single-file XML Office document',
    EMPTY: 'Empty file',
    UNKNOWN: 'Unknown file',
    ZIP: 'ZIP archive'
  },
  report: {
    title: 'Seam repair report',
    file: 'File',
    detected: 'Detected',
    outcome: 'Outcome',
    checked: 'Checked',
    localTime: 'local time',
    output: 'Output',
    bytes: 'bytes',
    groups: { loss: 'Lost', repaired: 'Repaired', noted: 'Noted' },
    previewTitle: 'Recovered text',
    addDonorHint: 'Styles, themes and layouts can come from a healthy file made by the same source, such as another document from the same template. Text, cells, slides and pictures are never taken from it.',
    addCopyHint: 'Have another copy of this file, such as a backup or an earlier download? A part that is damaged here may be intact there.'
  },
  findings: {
    ZIP_PREFIX_DATA: (d) => `Removed ${d.bytes} bytes of extra data in front of the file.`,
    TRANSFER_CRLF_REVERSED: (d) => `Removed ${d.n} carriage ${plural(d.n, 'return', 'returns')} that a text-mode transfer added before line feeds${d.restored > 0 ? ` and put back the original ones in ${d.restored} ${plural(d.restored, 'part', 'parts')}` : ''}.`,
    ZIP_ENTRY_CHOSEN: (d) => `The package held ${d.n} different copies of this part. The most complete one was kept.`,
    ZIP_ORPHAN_NAMED: () => 'Found data whose file name was lost. Its content shows which part it is, so it was put back.',
    ZIP_ORPHAN_KEPT: () => 'Found data whose file name was lost and could not tell where it belongs. It was kept in this file, not linked to anything.',
    MULTI_PART_FROM: (d) => `Taken from ${d.from}, where it was more complete.`,
    MULTI_COPY_UNUSED: copyUnusedText,
    DONOR_PART_BORROWED: (d) => `Taken from ${d.from}, because this file's own copy was missing or damaged. Formatting that came from it may differ from the original.`,
    DONOR_UNUSED: donorUnusedText,
    ZIP_DIRECTORY_REBUILT: (d) => `Rebuilt the ZIP directory from ${d.n} recovered ${plural(d.n, 'entry', 'entries')}.`,
    ZIP_ENDS_EARLY: () => 'The file ends inside its ZIP directory, so it was cut short. Data after the cut, if any, is not in the file.',
    ZIP_ENTRY_TRUNCATED: (d) => (d.pct === null || d.pct === undefined ? `This part was cut short. ${d.bytes} bytes were recovered.` : `This part was cut short. ${d.pct}% of it was recovered.`),
    ZIP_ENTRY_CRC: () => 'The checksum of this part does not match. It was kept and may contain damaged data.',
    ZIP_ENTRY_UNREADABLE: () => 'This part could not be read and was removed.',
    ZIP_UNSUPPORTED_METHOD: (d) => `This part uses compression method ${d.method}, which Seam can't read. It was removed.`,
    ZIP_PATH_DROPPED: () => 'A part with an unsafe path was dropped.',
    XML_REENCODED: () => 'Converted this part from UTF-16 to UTF-8.',
    XML_INVALID_BYTES: (d) => `Replaced ${d.n} invalid byte ${plural(d.n, 'sequence', 'sequences')} with the replacement character.`,
    XML_CHARS_REMOVED: (d) => `Removed or escaped ${d.n} invalid ${plural(d.n, 'character', 'characters')}.`,
    XML_REPAIRED: xmlRepairText,
    XML_TRUNCATED_CLOSED: () => 'Content after this point was lost. The open elements were closed.',
    XML_NAMESPACE_FIXED: (d) => `Repaired ${d.n} damaged namespace ${plural(d.n, 'declaration', 'declarations')}.`,
    XML_DECLARATION_FIXED: () => 'Corrected the text encoding named in the XML declaration to UTF-8.',
    XML_UNRECOVERABLE: () => 'This part could not be read as XML and was removed.',
    XML_HOLE_DROPPED: (d) => `About ${d.bytes} bytes of this part could not be read. The content around them was removed.`,
    CT_REBUILT: () => 'Rebuilt the content types list.',
    CT_DEFAULT_ADDED: (d) => `Added the content type for .${d.ext} files.`,
    CT_MAIN_FIXED: (d) => `Set the content type of the main part to ${d.type}.`,
    CT_OVERRIDE_REMOVED: (d) => `Removed ${d.n} content type ${plural(d.n, 'entry', 'entries')} for missing parts.`,
    CT_OVERRIDE_ADDED: (d) => `Added ${d.n} content type ${plural(d.n, 'entry', 'entries')} for existing parts.`,
    CT_OVERRIDE_FIXED: (d) => `Corrected ${d.n} content type ${plural(d.n, 'entry', 'entries')} to match the parts they describe.`,
    PART_NAME_CASE_FIXED: (d) => `Corrected the spelling of ${d.n} part ${plural(d.n, 'name', 'names')} to match the references to ${d.n === 1 ? 'it' : 'them'}.`,
    SCHEMA_REORDERED: (d) => `Put ${d.n} ${plural(d.n, 'element', 'elements')} back in the order the format requires.`,
    SCHEMA_NAMES_FIXED: (d) => `Corrected ${d.n} damaged element ${plural(d.n, 'name', 'names')} to the name the format allows at that place.`,
    SCHEMA_COMPLETED: (d) => `Added ${d.n} required ${plural(d.n, 'element', 'elements')} that ${plural(d.parts, 'a damaged part was', 'damaged parts were')} missing.`,
    SCHEMA_UNRESOLVED: (d) => `${d.n} required ${plural(d.n, 'element', 'elements')} in damaged parts could not be rebuilt.`,
    CT_ENTRIES_CLEANED: (d) => `Cleaned ${d.n} damaged content type ${plural(d.n, 'entry', 'entries')}.`,
    CT_PART_TYPED: (d) => `Gave this part the generic content type ${d.type}, so the package stays valid. Its data was not changed.`,
    CT_UNKNOWN_PART: () => 'This part has no known content type. It was left as it is.',
    ROOT_RELS_REBUILT: () => 'Rebuilt the package relationships.',
    RELS_ROOT_FIXED: () => 'Corrected the damaged first tag of a relationships list, so its relationships can be read again.',
    XLSX_WORKBOOK_REBUILT: (d) => `The workbook part was lost. A new one lists the ${d.n} ${plural(d.n, 'sheet', 'sheets')} that remain, named Sheet1, Sheet2 and so on. The original sheet names and any defined names are gone.`,
    PPTX_PRESENTATION_REBUILT: (d) => `The presentation part was lost. A new one lists the slide masters and ${d.n} ${plural(d.n, 'slide', 'slides')} that remain, in file order. The slide size was estimated as ${d.cx} by ${d.cy}, and sections and notes settings are gone.`,
    RELS_REBUILT: (d) => `Rebuilt ${d.n} ${plural(d.n, 'relationship', 'relationships')} of a part whose relationships were lost, from the names of the parts that remain.`,
    PPTX_SLIDE_ORDER_GUESSED: (d) => `The order of ${d.n} slides follows their file names, because the list that gave their order was lost.`,
    ROOT_RELS_FIXED: () => 'Pointed the main document relationship at the real main part.',
    REL_REMOVED: (d) => `Removed ${d.n} ${plural(d.n, 'relationship', 'relationships')} pointing to missing parts.`,
    REL_FILE_REMOVED: () => 'Removed a relationships file whose source part is missing.',
    REL_ID_RENAMED: (d) => `Renamed ${d.n} duplicate relationship ${plural(d.n, 'ID', 'IDs')}.`,
    REL_DUPLICATE_DROPPED: (d) => `Dropped ${d.n} duplicate relationship ${plural(d.n, 'ID', 'IDs')} that the document refers to.`,
    EXTENSION_CORRECTED: (d) => (d.from ? `The file was named .${d.from} but is a .${d.to} file. The output uses .${d.to}.` : `The file had no extension. The output uses .${d.to}.`),
    REF_REMOVED: (d) => refRemovedText(d),
    REF_DANGLING: (d) => `${d.n} ${plural(d.n, 'reference', 'references')} in this part point to content that is no longer in the file. They were left in place.`,
    NO_MAIN_PART: () => 'The main document part is missing, so there is no content to rebuild.',
    DOCX_BODY_ADDED: () => 'Added the missing document body element around the existing content.',
    DOCX_REL_ADDED: (d) => `Added ${d.n} missing ${plural(d.n, 'relationship', 'relationships')} to existing parts.`,
    DOCX_NUMBERING_MISSING: () => 'The numbering part is missing. List formatting may look different.',
    DOCX_NOTE_REFS_REMOVED: (d) => `Removed ${d.n} ${d.kind} ${plural(d.n, 'reference', 'references')} that pointed to ${d.kind}s no longer in the file.`,
    XLSX_SHEET_REMOVED: (d) => `Sheet "${d.name}" was removed because its data part was unreadable.`,
    XLSX_NAMES_ADJUSTED: (d) => `Adjusted defined names and sheet indexes after removing ${d.n} ${plural(d.n, 'sheet', 'sheets')}.`,
    XLSX_SHEET_RENAMED: (d) => `Renamed sheet "${d.from}" to "${d.to}" to keep sheet names unique and within 31 characters.`,
    XLSX_CALCCHAIN_REMOVED: () => 'Removed the calculation chain. Excel rebuilds it on open.',
    XLSX_SST_COUNTS: (d) => `Set the shared string count to ${d.n}.`,
    XLSX_CELL_CLEARED: (d) => `Cleared ${d.n} ${plural(d.n, 'cell', 'cells')} that pointed to missing shared strings.`,
    XLSX_DIMENSION_REMOVED: () => 'Removed the stored sheet dimension. Excel recalculates it.',
    XLSX_STYLE_CLEARED: (d) => `${d.n} ${plural(d.n, 'cell, row or column format', 'cell, row or column formats')} pointed at a style that no longer exists. The format was reset.`,
    XLSX_STYLE_INDEX_CLEARED: (d) => `Cleared ${d.n} ${plural(d.n, 'reference', 'references')} to a style, font, fill, border or format that no longer exists.`,
    XLSX_PIVOT_REMOVED: (d) => `Removed ${d.n} ${plural(d.n, 'pivot table', 'pivot tables')} whose source data is missing.`,
    XLSX_DRAWING_REMOVED: (d) => `Removed ${d.n} ${plural(d.n, 'drawing', 'drawings')} whose data is missing.`,
    PPTX_SLIDE_REMOVED: (d) => `Slide ${d.number} was removed because its part was unreadable.`,
    PPTX_SLIDE_IDS: (d) => `Renumbered ${d.n} slide ${plural(d.n, 'ID', 'IDs')}.`,
    PPTX_LAYOUT_RELINKED: (d) => `Slide ${d.number} pointed to a missing layout. It now uses the first layout of the first master.`,
    PPTX_MASTER_REMOVED: (d) => `Removed ${d.n} slide ${plural(d.n, 'master', 'masters')} whose part is missing.`,
    VERIFY_FAILED: (d) => `The repaired file failed structural check ${d.check}. It was discarded.`,
    SALVAGE_TEXT_ONLY: () => 'Only text could be recovered. Formatting, images, formulas and layout were not kept.',
    INTERNAL_ERROR: () => 'Seam hit an unexpected error while processing this file. The original is unchanged.',
    TIMEOUT: () => 'Processing took longer than 120 seconds and was stopped. The original is unchanged.'
  },
  scope: {
    title: 'What Seam can repair',
    intro: 'Seam repairs the structure of modern Office files (.docx, .xlsx, .pptx and their macro-enabled versions). These files are ZIP archives of XML parts. Most damage happens to that structure.',
    sections: [
      {
        heading: 'Usually repairable',
        items: [
          'Files cut short by an interrupted download, copy or save. Content before the cut is kept.',
          'A damaged or missing ZIP directory.',
          'Extra data in front of the file.',
          'XML with invalid characters, unclosed elements or broken escaping.',
          'Missing or wrong content types and internal links.',
          'Excel calculation chain errors and shared string mismatches.',
          'Wrong file extension.'
        ]
      },
      {
        heading: 'Sometimes repairable',
        items: [
          'Files with damaged data in the middle. Seam keeps undamaged parts and tells you which parts were affected.',
          'Files where only text can be recovered. Seam puts the text into a new file and says so.'
        ]
      },
      {
        heading: 'Not repairable',
        items: [
          'Password-protected files.',
          'Older .doc, .xls and .ppt files (not supported in this version).',
          'Files overwritten with zeros or other data.',
          'Files encrypted by ransomware.',
          "Content that is not in the file anymore. Seam can't restore lost data, only what is still there."
        ]
      },
      {
        heading: 'How to read the result',
        text: '"Passed structural checks" means the repaired file is internally consistent. "Passed structural and content checks" means every part of it also follows the rules for its elements. Neither guarantees that every element looks the way it did. Open the file and check it.'
      },
      {
        heading: 'Privacy',
        text: 'Everything happens in this browser tab. The page has no network access to send files anywhere. Seam is open source, so you can check this.'
      }
    ]
  }
};

export const FINDING_CODES = Object.keys(copy.findings);
