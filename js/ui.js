import { copy } from './copy.js';
import { groupFindings } from './core/report.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function lookup(path) {
  return path.split('.').reduce((node, key) => (node === undefined ? undefined : node[key]), copy);
}

export function applyCopy(root) {
  for (const el of root.querySelectorAll('[data-copy]')) {
    const value = lookup(el.getAttribute('data-copy'));
    if (typeof value === 'string') el.textContent = value;
  }
}

export function buildScope(container) {
  container.textContent = '';
  const intro = document.createElement('p');
  intro.textContent = copy.scope.intro;
  container.appendChild(intro);
  for (const section of copy.scope.sections) {
    const heading = document.createElement('h3');
    heading.textContent = section.heading;
    container.appendChild(heading);
    if (section.items) {
      const ul = document.createElement('ul');
      for (const item of section.items) {
        const li = document.createElement('li');
        li.textContent = item;
        ul.appendChild(li);
      }
      container.appendChild(ul);
    } else {
      const p = document.createElement('p');
      p.textContent = section.text;
      container.appendChild(p);
    }
  }
}

export function setupScope(openButton, closeButton, dialog) {
  openButton.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

export function formatSize(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1000 * 1000 * 1000) return `${(bytes / 1000000).toFixed(bytes < 10000000 ? 1 : 1)} MB`;
  return `${(bytes / 1000000000).toFixed(1)} GB`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function downloadIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M8 2.5v8m0 0L4.8 7.3M8 10.5l3.2-3.2M3 13h10');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

const BADGE = {
  noProblems: 'b-clean',
  repaired: 'b-ok',
  partial: 'b-partial',
  salvaged: 'b-salvage',
  failed: 'b-fail',
  notSupported: 'b-neutral',
  notProcessed: 'b-neutral'
};

function splitName(name) {
  const keep = Math.min(10, Math.max(0, name.length - 1));
  if (name.length <= 12) return [name, ''];
  return [name.slice(0, name.length - keep), name.slice(name.length - keep)];
}

function extensionChip(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1, dot + 5).toUpperCase() : '—';
}

export function createRenderer(list, actions) {
  const rows = new Map();

  function buildRow(item) {
    const li = el('li', 'item enter');
    li.dataset.id = String(item.id);
    const row = el('div', 'row');
    const main = el('button', 'row-main');
    main.type = 'button';
    main.setAttribute('aria-expanded', 'false');
    main.setAttribute('aria-controls', `report-${item.id}`);
    const chip = el('span', 'chip');
    const name = el('span', 'name');
    const [start, end] = splitName(item.name);
    const nameStart = el('span', 'name-start', start);
    const nameEnd = el('span', 'name-end', end);
    name.append(nameStart, nameEnd);
    const size = el('span', 'size', formatSize(item.size));
    const badge = el('span', 'badge b-neutral');
    const chev = el('span', 'chev');
    chev.setAttribute('aria-hidden', 'true');
    main.append(chip, name, size, badge, chev);
    const dl = el('button', 'dl');
    dl.type = 'button';
    dl.hidden = true;
    dl.appendChild(downloadIcon());
    row.append(main, dl);
    const progress = el('div', 'progress');
    progress.setAttribute('aria-hidden', 'true');
    const report = el('div', 'report');
    report.id = `report-${item.id}`;
    report.hidden = true;
    li.append(row, progress, report);

    const ref = { li, main, chip, badge, dl, progress, report, built: null };
    main.addEventListener('click', () => {
      const open = main.getAttribute('aria-expanded') === 'true';
      main.setAttribute('aria-expanded', open ? 'false' : 'true');
      report.hidden = open;
    });
    dl.addEventListener('click', () => actions.download(ref.item, 'output'));
    li.addEventListener('animationend', () => li.classList.remove('enter'));
    rows.set(item.id, ref);
    return ref;
  }

  function buildReport(ref, item) {
    const result = item.result;
    const panel = ref.report;
    panel.textContent = '';
    panel.appendChild(el('p', 'report-file', item.name));
    panel.appendChild(el('p', 'report-summary', result.sentence));
    const groups = groupFindings(result.findings);
    for (const key of ['loss', 'repaired', 'noted']) {
      if (groups[key].length === 0) continue;
      panel.appendChild(el('h3', null, copy.report.groups[key]));
      const ul = el('ul');
      for (const f of groups[key]) {
        const li = el('li', key);
        const span = el('span', null, f.text);
        if (f.part) span.appendChild(el('code', null, f.part));
        li.appendChild(span);
        ul.appendChild(li);
      }
      panel.appendChild(ul);
    }
    if (result.preview) {
      panel.appendChild(el('pre', 'preview', result.preview));
    }
    if (result.output) {
      panel.appendChild(el('p', 'report-note', `${copy.verify.ok} ${copy.verify.advice}`));
    }
    if (actions.canAddCopy(item)) panel.appendChild(el('p', 'report-note', copy.report.addCopyHint));
    const buttons = el('div', 'actions');
    if (result.output) {
      const label = result.outcome === 'salvaged' ? copy.btn.downloadSalvage : copy.btn.download;
      const primary = el('button', 'btn primary', label);
      primary.type = 'button';
      primary.addEventListener('click', () => actions.download(item, 'output'));
      buttons.appendChild(primary);
    }
    if (result.extraOutput) {
      const extra = el('button', 'btn', copy.btn.downloadSalvage);
      extra.type = 'button';
      extra.addEventListener('click', () => actions.download(item, 'extraOutput'));
      buttons.appendChild(extra);
    }
    const copyButton = el('button', 'btn', copy.btn.copyReport);
    copyButton.type = 'button';
    copyButton.addEventListener('click', () => actions.copyReport(item, copyButton));
    const saveButton = el('button', 'btn', copy.btn.saveReport);
    saveButton.type = 'button';
    saveButton.addEventListener('click', () => actions.saveReport(item));
    buttons.append(copyButton, saveButton);
    if (actions.canAddCopy(item)) {
      const more = el('button', 'btn', copy.btn.addCopy);
      more.type = 'button';
      more.addEventListener('click', () => actions.addCopy(item));
      buttons.appendChild(more);
    }
    panel.appendChild(buttons);
  }

  function update(item) {
    const ref = rows.get(item.id) || buildRow(item);
    ref.item = item;
    const result = item.result;
    if (result) {
      ref.chip.textContent = result.detected.chip;
      ref.badge.className = `badge ${BADGE[result.outcome]}`;
      ref.badge.textContent = copy.outcomes[result.outcome];
      const hasOutput = Boolean(result.output);
      ref.dl.hidden = !hasOutput;
      ref.li.classList.toggle('has-output', hasOutput);
      if (hasOutput) {
        const label = result.outcome === 'salvaged' ? copy.btn.downloadSalvage : copy.btn.download;
        ref.dl.setAttribute('aria-label', label);
        ref.dl.dataset.tip = label;
      }
      ref.progress.dataset.p = '100';
      ref.progress.classList.add('done');
      if (ref.built !== result) {
        buildReport(ref, item);
        ref.built = result;
      }
    } else {
      ref.dl.hidden = true;
      ref.li.classList.remove('has-output');
      ref.progress.classList.remove('done');
      ref.built = null;
      ref.report.hidden = true;
      ref.main.setAttribute('aria-expanded', 'false');
      ref.chip.textContent = extensionChip(item.name);
      ref.badge.className = 'badge b-neutral';
      ref.badge.textContent = item.status === 'working' ? copy.status.working : copy.status.queued;
      ref.progress.dataset.p = String(Math.min(100, Math.round(item.pct / 5) * 5));
    }
  }

  function sync(items) {
    const ids = new Set(items.map((item) => item.id));
    for (const [id, ref] of rows) {
      if (!ids.has(id)) {
        ref.li.remove();
        rows.delete(id);
      }
    }
    for (const item of items) {
      const existed = rows.has(item.id);
      update(item);
      if (!existed) list.appendChild(rows.get(item.id).li);
    }
  }

  return { sync, update };
}

export function summaryCounts(items) {
  const counts = { n: items.length, r: 0, p: 0, s: 0, f: 0, done: 0, outputs: 0 };
  for (const item of items) {
    const result = item.result;
    if (!result) continue;
    counts.done++;
    if (result.output) counts.outputs++;
    if (result.outcome === 'repaired') counts.r++;
    else if (result.outcome === 'partial') counts.p++;
    else if (result.outcome === 'salvaged') counts.s++;
    else if (result.outcome === 'failed' || result.outcome === 'notSupported' || result.outcome === 'notProcessed') counts.f++;
  }
  return counts;
}

export function setupDrop(parts, onFiles) {
  const { zone, input, button, label, or } = parts;
  let depth = 0;
  let state = 'idle';
  let compact = false;
  let timer = null;

  function refresh() {
    zone.classList.toggle('over', state === 'over');
    zone.classList.toggle('invalid', state === 'invalid');
    zone.classList.toggle('compact', compact);
    if (state === 'invalid') label.textContent = copy.drop.folder;
    else if (state === 'over') label.textContent = copy.drop.over;
    else label.textContent = compact ? copy.drop.compact : copy.drop.idle;
    or.hidden = compact;
  }

  function hasFiles(event) {
    const types = event.dataTransfer && event.dataTransfer.types;
    return Boolean(types) && Array.from(types).includes('Files');
  }

  function collect(dataTransfer) {
    const files = [];
    let folders = 0;
    const items = dataTransfer.items ? Array.from(dataTransfer.items).filter((item) => item.kind === 'file') : [];
    if (items.length > 0) {
      for (const item of items) {
        const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
        if (entry && entry.isDirectory) {
          folders++;
          continue;
        }
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    } else {
      files.push(...Array.from(dataTransfer.files));
    }
    return { files, folders };
  }

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth++;
    clearTimeout(timer);
    state = 'over';
    refresh();
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) {
      state = 'idle';
      refresh();
    }
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    const { files, folders } = collect(event.dataTransfer);
    if (files.length === 0 && folders > 0) {
      state = 'invalid';
      refresh();
      timer = setTimeout(() => {
        state = 'idle';
        refresh();
      }, 3000);
      return;
    }
    state = 'idle';
    refresh();
    if (files.length > 0) onFiles(files);
  });

  button.addEventListener('click', () => input.click());
  zone.addEventListener('click', (event) => {
    if (event.target === zone || event.target.classList.contains('drop-body') || event.target.classList.contains('drop-label')) input.click();
  });
  input.addEventListener('change', () => {
    const files = Array.from(input.files);
    input.value = '';
    if (files.length > 0) onFiles(files);
  });

  refresh();

  return {
    setCompact(value) {
      compact = value;
      refresh();
    }
  };
}
