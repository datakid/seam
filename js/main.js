import { initTheme } from './theme.js';
import { applyCopy, buildScope, setupScope, createRenderer, summaryCounts, setupDrop } from './ui.js';
import { copy } from './copy.js';
import { createQueue, canAddCopy, canAddDonor, LIMITS } from './queue.js';
import { textReport, baseName, finding } from './core/report.js';

const $ = (id) => document.getElementById(id);

applyCopy(document);
initTheme($('theme-button'), $('theme-list'), $('theme-current'));
buildScope($('scope-body'));
setupScope($('open-scope'), $('close-scope'), $('scope'));

const notice = $('notice');
const live = $('live');
let renderer;
let drop;
let queue;

function showNotice(notices) {
  const lines = [];
  if (notices.duplicates > 0) lines.push(copy.notice.duplicates(notices.duplicates));
  if (notices.overflow) lines.push(copy.notice.limit);
  if (notices.copiesFull) lines.push(copy.notice.copiesLimit(LIMITS.copies));
  if (notices.tooLarge) lines.push(copy.notice.tooLarge);
  notice.textContent = lines.join(' ');
  notice.hidden = lines.length === 0;
}

function renderSummary() {
  const items = queue.items();
  const counts = summaryCounts(items);
  $('summary').textContent = copy.summary(counts);
  $('download-all').disabled = counts.outputs === 0;
}

function announce(text) {
  live.textContent = '';
  setTimeout(() => {
    live.textContent = text;
  }, 50);
}

function writeClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'sr-only';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (ok) resolve();
    else reject(new Error('copy failed'));
  });
}

queue = createQueue({
  onList(items, notices) {
    renderer.sync(items);
    $('results').hidden = items.length === 0;
    drop.setCompact(items.length > 0);
    showNotice(notices);
  },
  onItem(item) {
    renderer.update(item);
  },
  onSummary: renderSummary,
  onBusy(n) {
    announce(copy.live.processing(n));
  },
  onIdle() {
    const counts = summaryCounts(queue.items());
    announce(copy.live.done(counts.r, counts.p, counts.f));
  }
});

const copyInput = document.createElement('input');
copyInput.type = 'file';
copyInput.multiple = true;
copyInput.accept = $('file-input').getAttribute('accept');
copyInput.className = 'file-input';
copyInput.tabIndex = -1;
document.body.appendChild(copyInput);
let copyTarget = null;
let copyMode = 'copy';
copyInput.addEventListener('change', () => {
  const files = Array.from(copyInput.files);
  copyInput.value = '';
  if (copyTarget !== null && files.length > 0) {
    if (copyMode === 'donor') queue.addDonor(copyTarget, files[0]);
    else queue.addCopies(copyTarget, files);
  }
  copyTarget = null;
});

renderer = createRenderer($('list'), {
  canAddCopy,
  canAddDonor,
  addCopy(item) {
    copyTarget = item.id;
    copyMode = 'copy';
    copyInput.multiple = true;
    copyInput.click();
  },
  addDonor(item) {
    copyTarget = item.id;
    copyMode = 'donor';
    copyInput.multiple = false;
    copyInput.click();
  },
  download(item, which) {
    queue.downloadOutput(item, which);
  },
  exportOutput(item, kind) {
    return queue.exportOutput(item, kind);
  },
  async copyReport(item, button) {
    const text = textReport(item.name, item.size, item.result);
    try {
      await writeClipboard(text);
      const original = button.textContent;
      button.textContent = copy.copied;
      setTimeout(() => {
        button.textContent = original;
      }, 1500);
    } catch (error) {
      console.error(error);
    }
  },
  saveReport(item) {
    const text = textReport(item.name, item.size, item.result);
    queue.save(new TextEncoder().encode(text), 'text/plain;charset=utf-8', `${baseName(item.name)} (repair report).txt`);
  }
});

drop = setupDrop(
  { zone: $('drop'), input: $('file-input'), button: $('choose'), label: $('drop-label'), or: $('drop-or') },
  (files) => queue.add(files)
);

$('download-all').addEventListener('click', () => queue.downloadAll());
$('clear').addEventListener('click', () => queue.clear());

function demoEntries() {
  const detected = (kind, chip, label) => ({ kind, chip, label });
  const out = (name, mime) => ({ bytes: new ArrayBuffer(16), name, mime });
  const repairedFindings = [
    finding('ZIP_DIRECTORY_REBUILT', null, { n: 41 }),
    finding('XML_CHARS_REMOVED', 'word/document.xml', { n: 3 })
  ];
  const partialFindings = [
    finding('XLSX_SHEET_REMOVED', 'xl/worksheets/sheet3.xml', { name: 'Q3' }),
    finding('ZIP_DIRECTORY_REBUILT', null, { n: 41 }),
    finding('REL_REMOVED', 'xl/_rels/workbook.xml.rels', { n: 3 }),
    finding('XLSX_CALCCHAIN_REMOVED', 'xl/calcChain.xml')
  ];
  return [
    {
      name: 'Quarterly report.docx',
      size: 1200000,
      result: {
        outcome: 'repaired',
        detected: detected('docx', 'DOCX', 'Word document (.docx)'),
        findings: repairedFindings,
        sentence: copy.sentences.repaired(repairedFindings.length),
        output: out('Quarterly report (repaired).docx', 'application/octet-stream'),
        extraOutput: null,
        preview: null,
        verified: true
      }
    },
    {
      name: 'Budget.xlsx',
      size: 380112,
      result: {
        outcome: 'partial',
        detected: detected('xlsx', 'XLSX', 'Excel workbook (.xlsx)'),
        findings: partialFindings,
        sentence: copy.sentences.partial,
        output: out('Budget (repaired).xlsx', 'application/octet-stream'),
        extraOutput: null,
        preview: null,
        verified: true
      }
    },
    {
      name: 'Old memo.doc',
      size: 88000,
      result: {
        outcome: 'notSupported',
        detected: detected('LEGACY_DOC', 'DOC', 'Word 97-2003 document (.doc)'),
        findings: [],
        sentence: copy.detection.legacy('.doc'),
        output: null,
        extraOutput: null,
        preview: null,
        verified: false
      }
    }
  ];
}

if (new URLSearchParams(location.search).get('demo') === '1') queue.inject(demoEntries());
