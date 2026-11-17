import { test, assert, eq } from './harness.js';
import { docx, xlsx, pptx } from './fixtures.js';
import { deleteDirectory, truncate, zeroMain } from './corrupt.js';
import { unzipSync } from '../vendor/fflate.module.js';

const encode = (text) => new TextEncoder().encode(text);

async function waitFor(check, ms = 20000, label = 'condition') {
  const started = performance.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (performance.now() - started > ms) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function openApp(search = '') {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:900px;height:700px;position:absolute;left:-9999px;top:0';
  frame.src = `../index.html${search}`;
  document.body.appendChild(frame);
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  const w = frame.contentWindow;
  const doc = w.document;
  await waitFor(() => doc.getElementById('drop-label') && doc.getElementById('drop-label').textContent !== '', 5000, 'app start');
  const violations = [];
  doc.addEventListener('securitypolicyviolation', (event) => violations.push(event.violatedDirective));
  const captured = [];
  w.URL.createObjectURL = (blob) => {
    captured.push(blob);
    return 'blob:captured';
  };
  w.URL.revokeObjectURL = () => {};
  return {
    w,
    doc,
    violations,
    captured,
    close() {
      w.localStorage.removeItem('seam-theme');
      frame.remove();
    }
  };
}

function add(app, files) {
  const transfer = new app.w.DataTransfer();
  for (const file of files) transfer.items.add(new app.w.File([file.bytes], file.name, { lastModified: file.modified || 1700000000000 }));
  const input = app.doc.getElementById('file-input');
  input.files = transfer.files;
  input.dispatchEvent(new app.w.Event('change'));
}

function rows(app) {
  return Array.from(app.doc.querySelectorAll('#list .item'));
}

function badges(app) {
  return rows(app).map((row) => row.querySelector('.badge').textContent);
}

async function settled(app, count) {
  await waitFor(() => rows(app).length === count && badges(app).every((b) => b !== 'Queued' && b !== 'Checking'), 30000, 'rows to settle');
}

const PDF = encode(`%PDF-1.7\n${'x'.repeat(200)}`);

function mixed() {
  return [
    { name: 'Letter.docx', bytes: deleteDirectory(docx()) },
    { name: 'Budget.xlsx', bytes: truncate(xlsx(), 0.5) },
    { name: 'Ledger.xlsx', bytes: zeroMain(xlsx(), 'xlsx') },
    { name: 'Scan.docx', bytes: PDF },
    { name: 'Clean.pptx', bytes: pptx() },
    { name: 'Broken.docx', bytes: zeroMain(docx(), 'docx') }
  ];
}

test('ui: a mixed batch gets the right outcome, chip and summary per row', async () => {
  const app = await openApp();
  try {
    add(app, mixed());
    await settled(app, 6);
    eq(badges(app), ['Repaired', 'Partially repaired', 'Salvaged text', 'Not supported', 'No problems found', 'Could not repair']);
    eq(rows(app).map((row) => row.querySelector('.chip').textContent), ['DOCX', 'XLSX', 'XLSX', 'PDF', 'PPTX', 'DOCX']);
    eq(app.doc.getElementById('summary').textContent, '6 files · 1 repaired · 1 partially repaired · 1 salvaged · 2 could not be repaired');
    eq(app.violations, []);
  } finally {
    app.close();
  }
});

test('ui: the download button sits outside the expand button and appears only with an output', async () => {
  const app = await openApp();
  try {
    add(app, mixed());
    await settled(app, 6);
    const list = rows(app);
    for (const row of list) assert(!row.querySelector('.row-main .dl'), 'download inside expand button');
    eq(list.map((row) => !row.querySelector('.dl').hidden), [true, true, true, false, false, false]);
    for (const row of list) {
      const main = row.querySelector('.row-main');
      eq(main.tagName, 'BUTTON');
      assert(main.getAttribute('aria-controls') === row.querySelector('.report').id, 'aria-controls');
    }
  } finally {
    app.close();
  }
});

test('ui: expanding a row shows the report with grouped findings and actions', async () => {
  const app = await openApp();
  try {
    add(app, mixed());
    await settled(app, 6);
    const row = rows(app)[1];
    const main = row.querySelector('.row-main');
    eq(main.getAttribute('aria-expanded'), 'false');
    assert(row.querySelector('.report').hidden, 'collapsed');
    main.click();
    eq(main.getAttribute('aria-expanded'), 'true');
    const report = row.querySelector('.report');
    assert(!report.hidden, 'expanded');
    const headings = Array.from(report.querySelectorAll('h3')).map((h) => h.textContent);
    assert(headings.includes('Lost') && headings.includes('Repaired'), headings.join(','));
    assert(report.textContent.includes('Passed structural checks.'), 'verify line');
    const buttons = Array.from(report.querySelectorAll('.btn')).map((b) => b.textContent);
    eq(buttons, ['Download repaired file', 'Copy report', 'Save report (.txt)']);
  } finally {
    app.close();
  }
});

test('ui: the salvaged row offers the salvaged text download and shows a preview', async () => {
  const app = await openApp();
  try {
    add(app, [mixed()[2]]);
    await settled(app, 1);
    const report = rows(app)[0].querySelector('.report');
    assert(report.querySelector('.preview').textContent.includes('Item'), 'preview');
    assert(Array.from(report.querySelectorAll('.btn')).some((b) => b.textContent === 'Download salvaged text'), 'salvage button');
  } finally {
    app.close();
  }
});

test('ui: downloading a row gives the repaired bytes under the specified name', async () => {
  const app = await openApp();
  try {
    add(app, [{ name: 'Budget 2026.xlsx', bytes: deleteDirectory(xlsx()) }]);
    await settled(app, 1);
    const clicked = [];
    app.doc.addEventListener('click', (event) => {
      if (event.target.tagName === 'A') {
        clicked.push(event.target.download);
        event.preventDefault();
      }
    });
    rows(app)[0].querySelector('.dl').click();
    eq(clicked, ['Budget 2026 (repaired).xlsx']);
    const parts = unzipSync(new Uint8Array(await app.captured[0].arrayBuffer()));
    assert(parts['xl/workbook.xml'], 'a real xlsx came back');
  } finally {
    app.close();
  }
});

test('ui: Download all zips only the outputs and numbers name collisions', async () => {
  const app = await openApp();
  try {
    add(app, [
      { name: 'Same.docx', bytes: deleteDirectory(docx()), modified: 1 },
      { name: 'Same.docx', bytes: deleteDirectory(docx()), modified: 2 },
      { name: 'Scan.docx', bytes: PDF }
    ]);
    await settled(app, 3);
    const button = app.doc.getElementById('download-all');
    assert(!button.disabled, 'enabled');
    app.doc.addEventListener('click', (event) => {
      if (event.target.tagName === 'A') event.preventDefault();
    });
    button.click();
    await waitFor(() => app.captured.length > 0, 10000, 'zip');
    const names = Object.keys(unzipSync(new Uint8Array(await app.captured[0].arrayBuffer()))).sort();
    eq(names, ['Same (repaired) (2).docx', 'Same (repaired).docx']);
  } finally {
    app.close();
  }
});

test('ui: Download all stays disabled while no output exists', async () => {
  const app = await openApp();
  try {
    add(app, [{ name: 'Scan.docx', bytes: PDF }]);
    await settled(app, 1);
    assert(app.doc.getElementById('download-all').disabled, 'disabled');
  } finally {
    app.close();
  }
});

test('ui: duplicate files are skipped with one line under the drop zone', async () => {
  const app = await openApp();
  try {
    const file = { name: 'Same.docx', bytes: PDF, modified: 5 };
    add(app, [file]);
    await settled(app, 1);
    add(app, [file]);
    await waitFor(() => !app.doc.getElementById('notice').hidden, 3000, 'notice');
    eq(app.doc.getElementById('notice').textContent, 'Skipped 1 duplicate file.');
    eq(rows(app).length, 1);
  } finally {
    app.close();
  }
});

test('ui: only the first 50 files are added and the limit line appears', async () => {
  const app = await openApp();
  try {
    const files = [];
    for (let i = 0; i < 55; i++) files.push({ name: `file-${i}.docx`, bytes: encode(`plain text number ${i}`) });
    add(app, files);
    await waitFor(() => !app.doc.getElementById('notice').hidden, 5000, 'notice');
    eq(app.doc.getElementById('notice').textContent, 'Only the first 50 files were added. Add the rest after these finish.');
    await settled(app, 50);
    eq(app.doc.getElementById('summary').textContent.startsWith('50 files'), true);
  } finally {
    app.close();
  }
});

test('ui: a file over 200 MB is Not processed with the size sentence and never read', async () => {
  const app = await openApp();
  try {
    const chunk = new Blob([new Uint8Array(64 * 1024 * 1024)]);
    const huge = new Blob([chunk, chunk, chunk, chunk]);
    const transfer = new app.w.DataTransfer();
    transfer.items.add(new app.w.File([huge], 'Huge.docx'));
    const input = app.doc.getElementById('file-input');
    input.files = transfer.files;
    input.dispatchEvent(new app.w.Event('change'));
    await settled(app, 1);
    eq(badges(app), ['Not processed']);
    assert(rows(app)[0].querySelector('.report').textContent.includes('larger than 200 MB'), 'sentence');
  } finally {
    app.close();
  }
});

test('ui: Clear empties the list, hides the results and restores the large drop zone', async () => {
  const app = await openApp();
  try {
    add(app, [{ name: 'a.docx', bytes: PDF }]);
    await settled(app, 1);
    assert(app.doc.getElementById('drop').classList.contains('compact'), 'compact with files');
    eq(app.doc.getElementById('drop-label').textContent, 'Add more files');
    app.doc.getElementById('clear').click();
    await waitFor(() => rows(app).length === 0, 3000, 'empty list');
    assert(app.doc.getElementById('results').hidden, 'results hidden');
    assert(!app.doc.getElementById('drop').classList.contains('compact'), 'large again');
    eq(app.doc.getElementById('drop-label').textContent, 'Drop .docx, .xlsx or .pptx files here');
    add(app, [{ name: 'b.docx', bytes: PDF }]);
    await settled(app, 1);
  } finally {
    app.close();
  }
});

test('ui: Save report downloads the text report and Copy report writes it to the clipboard', async () => {
  const app = await openApp();
  try {
    add(app, [mixed()[0]]);
    await settled(app, 1);
    const report = rows(app)[0].querySelector('.report');
    let copied = null;
    Object.defineProperty(app.w.navigator, 'clipboard', { value: { writeText: async (text) => { copied = text; } }, configurable: true });
    app.doc.addEventListener('click', (event) => {
      if (event.target.tagName === 'A') event.preventDefault();
    });
    const buttons = Array.from(report.querySelectorAll('.btn'));
    const copyButton = buttons.find((b) => b.textContent === 'Copy report');
    copyButton.click();
    await waitFor(() => copied !== null, 3000, 'clipboard');
    assert(copied.startsWith('Seam repair report\nFile: Letter.docx ('), copied);
    await waitFor(() => copyButton.textContent === 'Copied', 3000, 'copied label');
    buttons.find((b) => b.textContent === 'Save report (.txt)').click();
    const text = await app.captured[app.captured.length - 1].text();
    assert(text.includes('Outcome: Repaired') && text.includes('Rebuilt the ZIP directory'), text);
  } finally {
    app.close();
  }
});

test('ui: the scope sheet opens as a modal dialog and closes again', async () => {
  const app = await openApp();
  try {
    const dialog = app.doc.getElementById('scope');
    assert(!dialog.open, 'closed at start');
    app.doc.getElementById('open-scope').click();
    assert(dialog.open, 'open');
    assert(dialog.textContent.includes('Usually repairable') && dialog.textContent.includes('Privacy'), 'content');
    app.doc.getElementById('close-scope').click();
    assert(!dialog.open, 'closed');
  } finally {
    app.close();
  }
});

test('ui: the theme control is a custom menu that sets and stores light, dark and system', async () => {
  const app = await openApp();
  try {
    const button = app.doc.getElementById('theme-button');
    const list = app.doc.getElementById('theme-list');
    const items = Array.from(list.querySelectorAll('[role="menuitemradio"]'));
    eq(items.map((i) => i.textContent), ['System', 'Light', 'Dark']);
    eq(app.doc.getElementById('theme-current').textContent, 'System');
    assert(list.hidden, 'closed at start');
    const pick = (label) => {
      button.click();
      assert(!list.hidden, 'opens');
      eq(button.getAttribute('aria-expanded'), 'true');
      items.find((i) => i.textContent === label).click();
      assert(list.hidden, 'closes after a choice');
    };
    pick('Dark');
    eq(app.doc.documentElement.getAttribute('data-theme'), 'dark');
    eq(app.w.localStorage.getItem('seam-theme'), 'dark');
    eq(items.map((i) => i.getAttribute('aria-checked')), ['false', 'false', 'true']);
    pick('Light');
    eq(app.doc.documentElement.getAttribute('data-theme'), 'light');
    pick('System');
    const expected = app.w.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    eq(app.doc.documentElement.getAttribute('data-theme'), expected);
  } finally {
    app.close();
  }
});

test('ui: the theme menu works from the keyboard and Escape returns focus to the button', async () => {
  const app = await openApp();
  try {
    const button = app.doc.getElementById('theme-button');
    const list = app.doc.getElementById('theme-list');
    const key = (target, name) => target.dispatchEvent(new app.w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    button.focus();
    key(button, 'ArrowDown');
    assert(!list.hidden, 'opened by ArrowDown');
    eq(app.doc.activeElement.textContent, 'System');
    key(app.doc.activeElement, 'ArrowDown');
    eq(app.doc.activeElement.textContent, 'Light');
    key(app.doc.activeElement, 'End');
    eq(app.doc.activeElement.textContent, 'Dark');
    key(app.doc.activeElement, 'ArrowDown');
    eq(app.doc.activeElement.textContent, 'System');
    key(app.doc.activeElement, 'Escape');
    assert(list.hidden, 'closed by Escape');
    eq(app.doc.activeElement, button);
    button.click();
    app.doc.body.dispatchEvent(new app.w.Event('pointerdown', { bubbles: true }));
    assert(list.hidden, 'closed by an outside press');
  } finally {
    app.close();
  }
});

test('ui: no browser-native controls are shown (no select, no title tooltips, file input hidden)', async () => {
  const app = await openApp();
  try {
    add(app, mixed().slice(0, 2));
    await settled(app, 2);
    eq(app.doc.querySelectorAll('select, option, datalist, progress, meter').length, 0);
    eq(app.doc.querySelectorAll('[title]').length, 0);
    const input = app.doc.getElementById('file-input');
    eq(input.getAttribute('tabindex'), '-1');
    assert(app.w.getComputedStyle(input).opacity === '0', 'file input invisible');
    const dl = rows(app)[0].querySelector('.dl');
    assert(dl.dataset.tip && dl.getAttribute('aria-label'), 'custom tooltip text and accessible name');
    assert(rows(app)[0].querySelector('.report-file').textContent === 'Letter.docx', 'full file name in the report');
  } finally {
    app.close();
  }
});

test('ui: a stored theme choice is applied before the app starts', async () => {
  localStorage.setItem('seam-theme', 'dark');
  const app = await openApp();
  try {
    eq(app.doc.documentElement.getAttribute('data-theme'), 'dark');
    eq(app.doc.getElementById('theme-current').textContent, 'Dark');
  } finally {
    localStorage.removeItem('seam-theme');
    app.close();
  }
});

test('ui: demo mode injects three results only with the query parameter', async () => {
  const plain = await openApp();
  try {
    eq(rows(plain).length, 0);
  } finally {
    plain.close();
  }
  const demo = await openApp('?demo=1');
  try {
    eq(rows(demo).length, 3);
    eq(badges(demo), ['Repaired', 'Partially repaired', 'Not supported']);
  } finally {
    demo.close();
  }
});

test('ui: the live region announces the start and the end of a batch', async () => {
  const app = await openApp();
  try {
    const live = app.doc.getElementById('live');
    const announced = [];
    const observer = new app.w.MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) announced.push(node.textContent);
    });
    observer.observe(live, { childList: true, characterData: true, subtree: true });
    add(app, mixed().slice(0, 2));
    await settled(app, 2);
    await waitFor(() => live.textContent.startsWith('Done.'), 3000, 'end announcement');
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    assert(announced.includes('Processing 2 files.'), `start announcement missing: ${JSON.stringify(announced)}`);
    eq(live.textContent, 'Done. 1 repaired, 1 partially repaired, 0 could not be repaired.');
  } finally {
    app.close();
  }
});

test('ui: no user-facing copy comes from outside copy.js (no hard-coded sentences in the markup)', async () => {
  const html = await (await fetch('../index.html')).text();
  const visible = html.replace(/<head>[\s\S]*<\/head>/, '').replace(/<[^>]+>/g, '|').split('|').map((s) => s.trim()).filter(Boolean);
  eq(visible, []);
});

test('ui: motion is switched off for reduced motion through the duration tokens', async () => {
  const css = await (await fetch('../css/tokens.css')).text();
  assert(css.includes('prefers-reduced-motion: reduce'), 'reduced motion rule');
});

test('ui: a file name with markup is shown as text, not as HTML', async () => {
  const app = await openApp();
  try {
    add(app, [{ name: '<img src=x onerror=alert(1)>.docx', bytes: PDF }]);
    await settled(app, 1);
    eq(app.doc.querySelectorAll('#list img').length, 0);
    assert(rows(app)[0].querySelector('.name').textContent.includes('<img src=x'), 'name shown as text');
  } finally {
    app.close();
  }
});
