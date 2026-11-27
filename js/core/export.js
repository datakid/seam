import { zipSync, strToU8 } from '../../vendor/fflate.module.js';
import { packageNames, packageKind, packageParts, documentParagraphs, workbookSheets, presentationSlides } from './extract.js';
import { mediaNames } from './preview.js';

const TEXT_PARTS = /^(word\/(document|footnotes|endnotes|comments)\.xml|xl\/(workbook|sharedStrings)\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/[^/]+\.xml|ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml))$/;

function csvField(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function sheetCsv(rows) {
  const lines = [];
  let expected = 0;
  for (const row of rows) {
    const gap = row.index - expected;
    for (let i = 0; i < Math.min(gap, 1000); i++) lines.push('');
    lines.push(row.cells.map(csvField).join(','));
    expected = row.index + 1;
  }
  return lines.join('\r\n') + (lines.length > 0 ? '\r\n' : '');
}

function safeName(name) {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return cleaned.slice(0, 80) || 'file';
}

function uniqueName(name, used) {
  const key = (n) => n.toLowerCase();
  if (!used.has(key(name))) {
    used.add(key(name));
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (used.has(key(`${stem} (${n})${ext}`))) n++;
  const out = `${stem} (${n})${ext}`;
  used.add(key(out));
  return out;
}

function documentText(files) {
  return documentParagraphs(files).join('\n') + '\n';
}

function workbookText(files) {
  const out = [];
  for (const sheet of workbookSheets(files)) {
    const filled = sheet.rows.filter((row) => row.cells.length > 0);
    if (filled.length === 0) continue;
    out.push(sheet.name);
    for (const row of filled) out.push(row.cells.join('\t'));
    out.push('');
  }
  return out.join('\n');
}

function presentationText(files) {
  const out = [];
  for (const slide of presentationSlides(files)) {
    out.push(`Slide ${slide.number}`);
    for (const line of slide.lines) out.push(line);
    out.push('');
  }
  return out.join('\n');
}

export function buildExport(kind, bytes, stem) {
  const names = packageNames(bytes);
  const format = packageKind(names);
  if (!format) return null;
  const base = safeName(stem);
  if (kind === 'media') {
    const chosen = new Set(mediaNames(names));
    const files = packageParts(bytes, (file) => chosen.has(file.name));
    if (!files || chosen.size === 0) return null;
    const used = new Set();
    const entries = {};
    for (const name of Object.keys(files)) entries[uniqueName(safeName(name.slice(name.lastIndexOf('/') + 1)), used)] = [files[name], { level: 0 }];
    return { name: `${base} media.zip`, mime: 'application/zip', bytes: zipSync(entries) };
  }
  const files = packageParts(bytes, (file) => TEXT_PARTS.test(file.name));
  if (!files) return null;
  if (kind === 'text') {
    const text = format === 'document' ? documentText(files) : format === 'workbook' ? workbookText(files) : presentationText(files);
    if (text.trim() === '') return null;
    return { name: `${base}.txt`, mime: 'text/plain;charset=utf-8', bytes: strToU8(text) };
  }
  if (kind === 'csv' && format === 'workbook') {
    const used = new Set();
    const sheets = workbookSheets(files).filter((sheet) => sheet.rows.some((row) => row.cells.length > 0));
    if (sheets.length === 0) return null;
    const made = sheets.map((sheet) => ({ name: uniqueName(`${base} - ${safeName(sheet.name)}.csv`, used), bytes: strToU8(`﻿${sheetCsv(sheet.rows)}`) }));
    if (made.length === 1) return { name: made[0].name, mime: 'text/csv;charset=utf-8', bytes: made[0].bytes };
    const entries = {};
    for (const file of made) entries[file.name] = [file.bytes, { level: 6 }];
    return { name: `${base} sheets.zip`, mime: 'application/zip', bytes: zipSync(entries) };
  }
  return null;
}
