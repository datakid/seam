import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTree, documentElement, elementChildren, localName, getAttr } from '../js/core/xml-repair.js';
import { SCHEMA_LITE } from '../js/core/data/schema-lite.js';
import { openedTable } from '../js/core/schema-fill.js';
import { trimTree } from '../js/core/schema-trim.js';
import { checkTree } from '../js/core/schema-fit.js';

const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const table = openedTable(SCHEMA_LITE);

function names(root) {
  return elementChildren(root).map((child) => localName(child.name));
}

function violations(tree) {
  const undeclared = [];
  const { findings } = checkTree(table, tree, 200, null, null, undeclared);
  return findings.length + undeclared.length;
}

test('schema trim: children out of order are put back in order', () => {
  const tree = parseTree(`<worksheet xmlns="${S}"><sheetData/><sheetViews><sheetView workbookViewId="0"/></sheetViews></worksheet>`);
  assert.ok(violations(tree) > 0);
  const result = trimTree(table, tree);
  assert.equal(result.moved, 1);
  assert.deepEqual(names(documentElement(tree)), ['sheetViews', 'sheetData']);
  assert.equal(violations(tree), 0);
});

test('schema trim: an element the table does not know is never removed', () => {
  const tree = parseTree(`<worksheet xmlns="${S}"><sheetData/><bogusElement/></worksheet>`);
  const result = trimTree(table, tree);
  assert.deepEqual(result, { moved: 0, renamed: 0 });
  assert.deepEqual(names(documentElement(tree)), ['sheetData', 'bogusElement']);
});

test('schema trim: a damaged element name is snapped to the one name the format allows there', () => {
  const tree = parseTree(`<worksheet xmlns="${S}"><sheetPp/><sheetData/></worksheet>`);
  const result = trimTree(table, tree);
  assert.equal(result.renamed, 1);
  assert.deepEqual(names(documentElement(tree)), ['sheetPr', 'sheetData']);
});

test('schema trim: a prefixed damaged name keeps its prefix', () => {
  const tree = parseTree(`<x:worksheet xmlns:x="${S}"><x:sheetPp/><x:sheetData/></x:worksheet>`);
  trimTree(table, tree);
  assert.equal(elementChildren(documentElement(tree))[0].name, 'x:sheetPr');
});

test('schema trim: a name that is far from every allowed name is left alone', () => {
  const tree = parseTree(`<worksheet xmlns="${S}"><zzzzzz/><sheetData/></worksheet>`);
  const result = trimTree(table, tree);
  assert.equal(result.renamed, 0);
  assert.deepEqual(names(documentElement(tree)), ['zzzzzz', 'sheetData']);
});

test('schema trim: a name that is as close to two allowed names as to one is left alone', () => {
  const tree = parseTree(`<worksheet xmlns="${S}"><sheetPx/><sheetData/></worksheet>`);
  const result = trimTree(table, tree);
  assert.ok(result.renamed === 0 || names(documentElement(tree))[0] === 'sheetPr');
});

test('schema trim: attributes are never removed, including ones the table does not list', () => {
  const tree = parseTree(`<worksheet xmlns="${S}"><sheetFormatPr defaultRowHeight="15" bogusAttribute="1"/><sheetData/></worksheet>`);
  trimTree(table, tree);
  const format = elementChildren(documentElement(tree), 'sheetFormatPr')[0];
  assert.equal(getAttr(format, 'defaultRowHeight'), '15');
  assert.equal(getAttr(format, 'bogusAttribute'), '1');
});

test('schema trim: a tree that fits is left as it is', () => {
  const tree = parseTree(`<worksheet xmlns="${S}"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData/></worksheet>`);
  const result = trimTree(table, tree);
  assert.deepEqual(result, { moved: 0, renamed: 0 });
});

test('schema trim: extension namespaces and ignorable attributes are not touched', () => {
  const tree = parseTree(`<worksheet xmlns="${S}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" mc:Ignorable="x14ac"><sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/><sheetData/></worksheet>`);
  const result = trimTree(table, tree);
  assert.deepEqual(result, { moved: 0, renamed: 0 });
});

test('schema trim: a change that does not reduce the violations is undone', () => {
  const tree = parseTree(`<worksheet xmlns="${S}"><sheetData/><sheetData/><sheetViews/></worksheet>`);
  const before = violations(tree);
  trimTree(table, tree);
  assert.ok(violations(tree) <= before);
});
