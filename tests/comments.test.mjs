import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findComments, COMMENT_EXTENSIONS } from './support/find-comments.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['index.html', 'sw.js', 'js', 'css', 'brand', 'tests', 'tools', '.github'];
const SKIP = new Set(['node_modules', 'vendor', 'bin', 'obj', '.git']);

function walk(path, out) {
  const entries = readdirSync(path, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(path, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (COMMENT_EXTENSIONS.includes(extname(entry.name))) out.push(full);
  }
}

function sourceFiles() {
  const out = [];
  for (const name of ROOTS) {
    const full = join(root, name);
    let entries = null;
    try {
      entries = readdirSync(full);
    } catch {
      entries = null;
    }
    if (entries === null) {
      if (COMMENT_EXTENSIONS.includes(extname(name))) out.push(full);
    } else {
      walk(full, out);
    }
  }
  return out.sort();
}

const lines = (ext, text) => findComments(ext, text).map((c) => c.line);

test('comments: no source file carries a code comment', () => {
  const files = sourceFiles();
  assert.ok(files.length > 100, `scanned ${files.length} files`);
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const hit of findComments(extname(file), text)) offenders.push(`${file.slice(root.length + 1)}:${hit.line} ${hit.text}`);
  }
  assert.deepEqual(offenders, [], `code comments found:\n${offenders.join('\n')}`);
});

test('comments: the scan covers the app, the styles, the brand files, the tests, the tools and the workflows', () => {
  const files = sourceFiles().map((f) => f.slice(root.length + 1));
  for (const expected of ['index.html', 'js/core/pipeline.js', 'css/tokens.css', 'brand/icon.svg', 'tests/comments.test.mjs', 'tools/score.mjs', '.github/workflows/unit.yml']) {
    assert.ok(files.includes(expected), `${expected} is scanned`);
  }
  assert.ok(!files.some((f) => f.startsWith('vendor/')), 'vendored third-party code is not scanned');
});

test('comments: script scanner finds line and block comments', () => {
  assert.deepEqual(lines('.js', 'const a = 1;\n// one\nconst b = 2; /* two */\n'), [2, 3]);
  assert.deepEqual(lines('.js', '/*\n multi\n line\n*/\nx();'), [1]);
  assert.deepEqual(lines('.js', 'x(); // trailing'), [1]);
});

test('comments: script scanner ignores comment markers inside strings, regexes and templates', () => {
  const cases = [
    'const a = "// not";',
    "const b = '/* not */';",
    'const c = `// not ${ "// inner" } // still not`;',
    'const d = /\\/\\/ not/g;',
    'const e = /[/]*x/.test(s);',
    'const f = a / b / c;',
    'const g = (a + b) / 2 / 3;',
    'const h = i++ / 2;',
    'const j = `a ${ `b ${ "//" }` } c`;',
    'const k = x[0] / y[1];',
    'if (ok) { run(); }\nconst l = /http:\\/\\/x/;',
    'return /\\/\\*/.test(s);'
  ];
  for (const source of cases) assert.deepEqual(findComments('.js', source), [], source);
});

test('comments: script scanner still finds a comment that follows tricky code', () => {
  assert.deepEqual(lines('.js', 'const r = /[/]/; // after regex'), [1]);
  assert.deepEqual(lines('.js', 'const t = `${ a } //`; // after template'), [1]);
  assert.deepEqual(lines('.js', 'const q = a / b; // after division'), [1]);
  assert.deepEqual(lines('.mjs', '#!/usr/bin/env node\nrun(); // x'), [2]);
});

test('comments: css scanner', () => {
  assert.deepEqual(lines('.css', 'a { color: red; }\n/* note */\nb { content: "/* not */"; }'), [2]);
  assert.deepEqual(lines('.css', 'a { background: url("data:image/svg+xml;utf8,<svg/>"); }'), []);
});

test('comments: markup scanner covers html comments and inline scripts and styles', () => {
  assert.deepEqual(lines('.html', '<p>x</p>\n<!-- note -->\n'), [2]);
  assert.deepEqual(lines('.svg', '<svg>\n  <!-- tile -->\n  <rect/>\n</svg>'), [2]);
  assert.deepEqual(lines('.html', '<script>\nrun();\n// inline\n</script>'), [3]);
  assert.deepEqual(lines('.html', '<style>\na { color: red; }\n/* inline */\n</style>'), [3]);
  assert.deepEqual(lines('.html', '<script src="a.js"></script><script type="application/json">{"a":"// x"}</script>'), []);
  assert.deepEqual(lines('.csproj', '<Project>\n  <!-- x -->\n</Project>'), [2]);
});

test('comments: hash scanner covers whole-line and trailing comments and skips quotes', () => {
  assert.deepEqual(lines('.sh', '#!/bin/sh\necho hi\n# note\necho x # tail\n'), [3, 4]);
  assert.deepEqual(lines('.yml', 'name: "a # b"\nrun: echo ${#list}\ncolor: \'#fff\'\n# why\n'), [4]);
  assert.deepEqual(lines('.py', 'x = "#nope"\ny = 1  # tail\n'), [2]);
  assert.deepEqual(lines('.ps1', 'Write-Host "#x"\n<# block\n more #>\n# line\n'), [2, 4]);
});

test('comments: csharp scanner handles verbatim and interpolated strings', () => {
  assert.deepEqual(findComments('.cs', 'var a = @"// not ""// still""";\nvar b = $"// {x} not";\nvar c = "/* not */";'), []);
  assert.deepEqual(lines('.cs', 'var a = 1; // note\n/* block */\n'), [1, 2]);
});
