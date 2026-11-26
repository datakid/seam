const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const DIVISION_AFTER = new Set([')', ']', '++', '--']);
const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v']);

function isWordChar(c) {
  return /[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 127;
}

function regexAllowed(prev) {
  if (prev.kind === 'start') return true;
  if (prev.kind === 'word') return REGEX_AFTER_WORD.has(prev.value);
  if (prev.kind === 'punct') return !DIVISION_AFTER.has(prev.value);
  return false;
}

function readQuoted(text, from) {
  const quote = text[from];
  let j = from + 1;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === quote) return j + 1;
    if (ch === '\n') return j;
    j++;
  }
  return text.length;
}

function readRegex(text, from) {
  let j = from + 1;
  let inClass = false;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\n') return from;
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
    } else if (ch === '[') {
      inClass = true;
    } else if (ch === '/') {
      j++;
      while (j < text.length && /[a-z]/i.test(text[j])) j++;
      return j;
    }
    j++;
  }
  return from;
}

function readTemplate(text, from) {
  let j = from;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === '`') return { index: j + 1, substitution: false };
    if (ch === '$' && text[j + 1] === '{') return { index: j + 2, substitution: true };
    j++;
  }
  return { index: text.length, substitution: false };
}

export function scanScript(text, options = {}) {
  const found = [];
  const n = text.length;
  const frames = [];
  const verbatim = Boolean(options.verbatimStrings);
  let depth = 0;
  let prev = { kind: 'start', value: '' };
  let i = 0;
  if (text.startsWith('#!')) while (i < n && text[i] !== '\n') i++;
  while (i < n) {
    const c = text[i];
    if (WHITESPACE.has(c)) {
      i++;
      continue;
    }
    if (c === '/') {
      const d = text[i + 1];
      if (d === '/') {
        let end = text.indexOf('\n', i);
        if (end === -1) end = n;
        found.push([i, end]);
        i = end;
        continue;
      }
      if (d === '*') {
        const close = text.indexOf('*/', i + 2);
        const end = close === -1 ? n : close + 2;
        found.push([i, end]);
        i = end;
        continue;
      }
      if (!verbatim && regexAllowed(prev)) {
        const end = readRegex(text, i);
        if (end > i) {
          i = end;
          prev = { kind: 'regex', value: '' };
          continue;
        }
      }
      i++;
      prev = { kind: 'punct', value: '/' };
      continue;
    }
    if (verbatim && (c === '@' || c === '$') && (text[i + 1] === '"' || (text[i + 1] === '@' && text[i + 2] === '"') || (text[i + 1] === '$' && text[i + 2] === '"'))) {
      const isVerbatim = text.slice(i, i + 3).includes('@');
      let j = text.indexOf('"', i) + 1;
      while (j < n) {
        if (isVerbatim) {
          if (text[j] === '"' && text[j + 1] === '"') {
            j += 2;
            continue;
          }
        } else if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === '"') break;
        j++;
      }
      i = j + 1;
      prev = { kind: 'string', value: '' };
      continue;
    }
    if (c === '"' || c === "'" || (verbatim && c === '`')) {
      i = readQuoted(text, i);
      prev = { kind: 'string', value: '' };
      continue;
    }
    if (c === '`') {
      const r = readTemplate(text, i + 1);
      i = r.index;
      if (r.substitution) {
        frames.push(depth);
        depth = 0;
        prev = { kind: 'punct', value: '${' };
      } else {
        prev = { kind: 'template', value: '' };
      }
      continue;
    }
    if (c === '{') {
      depth++;
      i++;
      prev = { kind: 'punct', value: '{' };
      continue;
    }
    if (c === '}') {
      if (depth === 0 && frames.length > 0) {
        const r = readTemplate(text, i + 1);
        i = r.index;
        if (r.substitution) {
          prev = { kind: 'punct', value: '${' };
        } else {
          depth = frames.pop();
          prev = { kind: 'template', value: '' };
        }
        continue;
      }
      if (depth > 0) depth--;
      i++;
      prev = { kind: 'punct', value: '}' };
      continue;
    }
    if (isWordChar(c)) {
      let j = i + 1;
      while (j < n && isWordChar(text[j])) j++;
      const word = text.slice(i, j);
      prev = { kind: /^[0-9]/.test(word) ? 'num' : 'word', value: word };
      i = j;
      continue;
    }
    if ((c === '+' || c === '-') && text[i + 1] === c) {
      i += 2;
      prev = { kind: 'punct', value: c + c };
      continue;
    }
    i++;
    prev = { kind: 'punct', value: c };
  }
  return found;
}

export function scanCss(text) {
  const found = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i = readQuoted(text, i);
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      found.push([i, end]);
      i = end;
      continue;
    }
    i++;
  }
  return found;
}

export function scanMarkup(text, options = {}) {
  const found = [];
  const nested = options.nested !== false;
  const pattern = /<!--[\s\S]*?(?:-->|$)|<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gid;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (m[0].startsWith('<!--')) {
      found.push([m.index, m.index + m[0].length]);
      continue;
    }
    if (!nested) continue;
    const [bodyStart] = m.indices[3];
    const attrs = m[2];
    const body = m[3];
    let inner = [];
    if (m[1].toLowerCase() === 'style') {
      inner = scanCss(body);
    } else if (!/\bsrc\s*=/.test(attrs)) {
      const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      if (!type || /^(module|text\/javascript|application\/javascript)$/i.test(type)) inner = scanScript(body);
    }
    for (const [a, b] of inner) found.push([bodyStart + a, bodyStart + b]);
  }
  return found.sort((a, b) => a[0] - b[0]);
}

export function scanHash(text, options = {}) {
  const found = [];
  const block = Boolean(options.block);
  let offset = 0;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    let quote = null;
    let hit = -1;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (quote) {
        if (ch === '\\' && quote === '"') k++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const before = k === 0 ? ' ' : line[k - 1];
        if (!/[A-Za-z0-9]/.test(before)) quote = ch;
        continue;
      }
      if (ch === '#' && (k === 0 || /\s/.test(line[k - 1]))) {
        if (!(index === 0 && k === 0 && line.startsWith('#!'))) hit = k;
        break;
      }
    }
    if (hit !== -1) found.push([offset + hit, offset + line.length]);
    offset += line.length + 1;
  }
  if (!block) return found;
  const blocks = [];
  const pattern = /<#[\s\S]*?#>/g;
  let m;
  while ((m = pattern.exec(text)) !== null) blocks.push([m.index, m.index + m[0].length]);
  const outside = found.filter(([a]) => !blocks.some(([s, e]) => a >= s && a < e));
  return outside.concat(blocks).sort((a, b) => a[0] - b[0]);
}

const SCANNERS = {
  '.js': (t) => scanScript(t),
  '.mjs': (t) => scanScript(t),
  '.cjs': (t) => scanScript(t),
  '.cs': (t) => scanScript(t, { verbatimStrings: true }),
  '.css': (t) => scanCss(t),
  '.html': (t) => scanMarkup(t),
  '.svg': (t) => scanMarkup(t),
  '.csproj': (t) => scanMarkup(t, { nested: false }),
  '.py': (t) => scanHash(t),
  '.sh': (t) => scanHash(t),
  '.yml': (t) => scanHash(t),
  '.yaml': (t) => scanHash(t),
  '.ps1': (t) => scanHash(t, { block: true })
};

export const COMMENT_EXTENSIONS = Object.keys(SCANNERS);

export function findComments(extension, text) {
  const scan = SCANNERS[extension];
  if (!scan) return [];
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return scan(text).map(([a, b]) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= a) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, start: a, end: b, text: text.slice(a, Math.min(b, a + 60)).replace(/\s+/g, ' ') };
  });
}
