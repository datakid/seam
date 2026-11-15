import { test, assert, eq } from './harness.js';
import { resolveTheme } from '../js/theme.js';

const root = document.documentElement;
const canvas = document.createElement('canvas');
canvas.width = 1;
canvas.height = 1;
const g = canvas.getContext('2d', { willReadFrequently: true });

function token(name) {
  return getComputedStyle(root).getPropertyValue(name).trim();
}

function rgb(value) {
  g.clearRect(0, 0, 1, 1);
  g.fillStyle = '#000';
  g.fillStyle = value;
  g.fillRect(0, 0, 1, 1);
  const [r, b, c] = g.getImageData(0, 0, 1, 1).data;
  return [r, b, c];
}

function luminance([r, gr, b]) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(gr) + 0.0722 * lin(b);
}

function contrast(fg, bg) {
  const a = luminance(rgb(token(fg)));
  const b = luminance(rgb(token(bg)));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function mixed(a, b, amount) {
  const [r1, g1, b1] = rgb(token(a));
  const [r2, g2, b2] = rgb(token(b));
  return [r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount].map((v) => Math.round(v));
}

const TEXT_PAIRS = [
  ['--ink', '--paper'], ['--ink', '--surface'], ['--ink', '--paper-2'], ['--ink', '--tint-violet'],
  ['--ink-2', '--paper'], ['--ink-2', '--surface'], ['--ink-2', '--paper-2'], ['--ink-2', '--tint-violet'], ['--ink-2', '--neutral-tint'],
  ['--ink-3', '--paper'], ['--ink-3', '--surface'],
  ['--paper', '--ink'],
  ['--ok', '--ok-tint'], ['--partial', '--partial-tint'], ['--salvage', '--salvage-tint'], ['--fail', '--fail-tint'], ['--neutral', '--neutral-tint']
];

for (const theme of ['light', 'dark']) {
  test(`contrast ${theme}: text pairs reach 4.5:1`, () => {
    root.setAttribute('data-theme', theme);
    const failures = [];
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrast(fg, bg);
      if (ratio < 4.5) failures.push(`${fg} on ${bg} = ${ratio.toFixed(2)}`);
    }
    root.removeAttribute('data-theme');
    assert(failures.length === 0, failures.join('; '));
  });

  test(`contrast ${theme}: report labels (ink-3 mixed toward ink) reach 4.5:1 on paper-2`, () => {
    root.setAttribute('data-theme', theme);
    const ratio = (Math.max(luminance(mixed('--ink-3', '--ink', 0.18)), luminance(rgb(token('--paper-2')))) + 0.05) / (Math.min(luminance(mixed('--ink-3', '--ink', 0.18)), luminance(rgb(token('--paper-2')))) + 0.05);
    root.removeAttribute('data-theme');
    assert(ratio >= 4.5, `ratio ${ratio.toFixed(2)}`);
  });

  test(`contrast ${theme}: focus ring reaches 3:1 on the page surfaces`, () => {
    root.setAttribute('data-theme', theme);
    const failures = [];
    for (const bg of ['--paper', '--surface', '--paper-2']) {
      const ratio = contrast('--focus', bg);
      if (ratio < 3) failures.push(`focus on ${bg} = ${ratio.toFixed(2)}`);
    }
    root.removeAttribute('data-theme');
    assert(failures.length === 0, failures.join('; '));
  });

  test(`theme ${theme}: the page background differs between themes and uses tokens`, () => {
    root.setAttribute('data-theme', theme);
    const paper = rgb(token('--paper'));
    root.removeAttribute('data-theme');
    const lum = luminance(paper);
    if (theme === 'dark') assert(lum < 0.1, `dark paper luminance ${lum}`);
    else assert(lum > 0.8, `light paper luminance ${lum}`);
  });
}

test('theme: preference resolution follows the system only for System', () => {
  eq(resolveTheme('system', true), 'dark');
  eq(resolveTheme('system', false), 'light');
  eq(resolveTheme('dark', false), 'dark');
  eq(resolveTheme('light', true), 'light');
});

test('theme: dark tokens cover every colour token that the light theme defines for text and surfaces', async () => {
  const dark = await (await fetch('../css/themes.css')).text();
  const light = await (await fetch('../css/tokens.css')).text();
  const names = ['--paper', '--paper-2', '--surface', '--line', '--line-strong', '--ink', '--ink-2', '--ink-3', '--ok', '--ok-tint', '--partial', '--partial-tint', '--salvage', '--salvage-tint', '--fail', '--fail-tint', '--neutral', '--neutral-tint', '--focus', '--tint-violet', '--tint-mint'];
  for (const name of names) {
    assert(light.includes(`${name}:`), `light ${name}`);
    assert(dark.includes(`${name}:`), `dark ${name}`);
  }
});
