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

export function initTheme(button, list, current) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let pref = readPreference();
  const items = [];

  for (const choice of CHOICES) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'theme-item';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('tabindex', '-1');
    item.dataset.choice = choice;
    item.textContent = copy.theme[choice];
    list.appendChild(item);
    items.push(item);
  }

  function apply() {
    document.documentElement.setAttribute('data-theme', resolveTheme(pref, media.matches));
    current.textContent = copy.theme[pref];
    for (const item of items) item.setAttribute('aria-checked', item.dataset.choice === pref ? 'true' : 'false');
  }

  function isOpen() {
    return !list.hidden;
  }

  function open(focusIndex) {
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const start = focusIndex === undefined ? CHOICES.indexOf(pref) : focusIndex;
    items[(start + items.length) % items.length].focus();
  }

  function close(returnFocus) {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus();
  }

  function choose(choice) {
    pref = choice;
    storePreference(pref);
    apply();
    close(true);
  }

  button.addEventListener('click', () => {
    if (isOpen()) close(false);
    else open();
  });

  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      open();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      open(items.length - 1);
    }
  });

  list.addEventListener('keydown', (event) => {
    const at = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(at + 1) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(at - 1 + items.length) % items.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  });

  list.addEventListener('click', (event) => {
    const item = event.target.closest('.theme-item');
    if (item) choose(item.dataset.choice);
  });

  document.addEventListener('pointerdown', (event) => {
    if (isOpen() && !list.contains(event.target) && !button.contains(event.target)) close(false);
  });

  media.addEventListener('change', () => {
    if (pref === 'system') apply();
  });

  apply();
}
