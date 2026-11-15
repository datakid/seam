import { copy } from './copy.js';

const KEY = 'seam-theme';
const CHOICES = ['system', 'light', 'dark'];

export function readPreference() {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (CHOICES.includes(stored)) return stored;
  } catch (e) {
    return 'system';
  }
  return 'system';
}

function storePreference(pref) {
  try {
    window.localStorage.setItem(KEY, pref);
  } catch (e) {
    return;
  }
}

export function resolveTheme(pref, systemDark) {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return systemDark ? 'dark' : 'light';
}

export function initTheme(select) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let pref = readPreference();

  for (const choice of CHOICES) {
    const option = document.createElement('option');
    option.value = choice;
    option.textContent = copy.theme[choice];
    select.appendChild(option);
  }

  function apply() {
    document.documentElement.setAttribute('data-theme', resolveTheme(pref, media.matches));
    select.value = pref;
  }

  select.addEventListener('change', () => {
    pref = CHOICES.includes(select.value) ? select.value : 'system';
    storePreference(pref);
    apply();
  });

  media.addEventListener('change', () => {
    if (pref === 'system') apply();
  });

  apply();
}
