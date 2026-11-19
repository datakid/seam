export const SENTINEL = '';

const SENTINEL_BYTES = [0xee, 0x80, 0x80];
const MIN_ISLAND = 16;
const NAME = /^[A-Za-z_:][^\s/>]*/;

function utf16Like(bytes) {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return true;
  if (bytes.length >= 4 && bytes[0] === 0x3c && bytes[1] === 0x00 && bytes[2] !== 0x00 && bytes[3] === 0x00) return true;
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x3c && bytes[2] === 0x00 && bytes[3] !== 0x00) return true;
  return false;
}

function mergeHoles(holes, length) {
  const merged = [];
  for (const [start, end] of holes) {
    const a = Math.max(0, start);
    const b = Math.min(length, end);
    if (b <= a) continue;
    const last = merged.length - 1;
    if (last >= 0 && a - merged[last][1] < MIN_ISLAND) {
      if (b > merged[last][1]) merged[last][1] = b;
    } else {
      merged.push([a, b]);
    }
  }
  return merged;
}

function trimStart(bytes, from, to) {
  let at = from;
  while (at < to && (bytes[at] & 0xc0) === 0x80) at++;
  return at;
}

function trimEnd(bytes, from, to) {
  let at = to;
  const floor = Math.max(from, to - 3);
  for (let i = to - 1; i >= floor; i--) {
    const b = bytes[i];
    if ((b & 0xc0) === 0x80) continue;
    let need = 1;
    if (b >= 0xf0) need = 4;
    else if (b >= 0xe0) need = 3;
    else if (b >= 0xc0) need = 2;
    if (to - i < need) at = i;
    break;
  }
  return at;
}

export function spliceHoles(whole, holes) {
  if (!whole || !holes || holes.length === 0 || utf16Like(whole)) return null;
  const merged = mergeHoles(holes, whole.length);
  if (merged.length === 0) return null;
  const pieces = [];
  let total = 0;
  let lost = 0;
  let from = 0;
  for (let i = 0; i <= merged.length; i++) {
    const to = i < merged.length ? merged[i][0] : whole.length;
    const a = i === 0 ? from : trimStart(whole, from, to);
    const b = i < merged.length ? trimEnd(whole, a, to) : to;
    if (b > a) {
      pieces.push(whole.subarray(a, b));
      total += b - a;
    }
    if (i < merged.length) {
      pieces.push(SENTINEL_BYTES);
      total += SENTINEL_BYTES.length;
      lost += merged[i][1] - merged[i][0];
      from = merged[i][1];
    }
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.length;
  }
  return { bytes, lost };
}

function tagEnd(text, from) {
  return text.indexOf('>', from);
}

function skipElement(text, afterGt, name) {
  let depth = 1;
  let pos = afterGt;
  let finished = false;
  let hole = text.indexOf(SENTINEL, afterGt);
  const n = text.length;
  for (;;) {
    const t = text.indexOf('<', pos);
    if (t === -1) return n;
    if (hole !== -1 && hole < t) hole = text.indexOf(SENTINEL, t);
    if (text.startsWith('<!--', t)) {
      const end = text.indexOf('-->', t + 4);
      if (end === -1) return n;
      pos = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', t)) {
      const end = text.indexOf(']]>', t + 9);
      if (end === -1) return n;
      pos = end + 3;
      continue;
    }
    if (text.startsWith('<?', t)) {
      const end = text.indexOf('?>', t + 2);
      if (end === -1) return n;
      pos = end + 2;
      continue;
    }
    const end = tagEnd(text, t + 1);
    if (end === -1) return n;
    if (hole !== -1 && hole < end) return t;
    if (text[t + 1] === '/') {
      const closing = text.slice(t + 2, end).trim();
      if (depth === 1) return closing === name ? end + 1 : t;
      depth--;
      if (depth === 1) finished = true;
      pos = end + 1;
      continue;
    }
    const match = NAME.exec(text.slice(t + 1, Math.min(end, t + 200)));
    const selfClosing = text[end - 1] === '/';
    if (depth === 1 && finished && match && match[0] === name) return t;
    if (selfClosing) {
      if (depth === 1) finished = true;
    } else {
      depth++;
    }
    pos = end + 1;
  }
}

const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([^\s/>!?]+)[^>]*?(\/?)>/g;

function learnChildren(text) {
  const children = new Map();
  const stack = [];
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(text)) !== null) {
    const name = m[2];
    if (name === undefined || m[0].includes(SENTINEL)) continue;
    if (m[1] === '/') {
      const k = stack.lastIndexOf(name);
      if (k !== -1) stack.length = k;
      continue;
    }
    if (stack.length > 0) {
      const parent = stack[stack.length - 1];
      let set = children.get(parent);
      if (set === undefined) {
        set = new Set();
        children.set(parent, set);
      }
      set.add(name);
    }
    if (m[3] !== '/') stack.push(name);
  }
  return children;
}

function allows(children, parent, name) {
  const set = children.get(parent);
  return set !== undefined && set.has(name);
}

function invert(children) {
  const parents = new Map();
  for (const [parent, set] of children) {
    for (const child of set) {
      let list = parents.get(child);
      if (list === undefined) {
        list = [];
        parents.set(child, list);
      }
      list.push(parent);
    }
  }
  return parents;
}

function attach(children, parents, stack, name) {
  for (let k = stack.length; k > 0; k--) {
    if (allows(children, stack[k - 1], name)) return { keep: k, wrap: null };
  }
  const options = parents.get(name);
  if (options !== undefined) {
    for (let k = stack.length; k > 0; k--) {
      for (const parent of options) {
        if (allows(children, stack[k - 1], parent)) return { keep: k, wrap: parent };
      }
    }
  }
  return null;
}

function entityStart(text, from, at, gt) {
  const amp = text.lastIndexOf('&', at - 1);
  if (amp > gt && amp >= from && /^#?[A-Za-z0-9]*$/.test(text.slice(amp + 1, at))) return amp;
  return at;
}

export function resolveHoles(text) {
  let at = text.indexOf(SENTINEL);
  if (at === -1) return { text, holes: 0 };
  const children = learnChildren(text.slice(0, at));
  const parents = invert(children);
  const out = [];
  const stack = [];
  const n = text.length;
  let from = 0;
  let holes = 0;
  let armed = false;

  function track(a, b) {
    let copied = a;
    TAG.lastIndex = a;
    let m;
    while ((m = TAG.exec(text)) !== null && m.index < b) {
      const name = m[2];
      if (name === undefined) continue;
      if (m[1] === '/') {
        const k = stack.lastIndexOf(name);
        if (k !== -1) stack.length = k;
        continue;
      }
      if (armed) {
        armed = false;
        const hit = attach(children, parents, stack, name);
        if (hit !== null && (hit.keep < stack.length || hit.wrap !== null)) {
          out.push(text.slice(copied, m.index));
          for (let i = stack.length - 1; i >= hit.keep; i--) out.push(`</${stack[i]}>`);
          stack.length = hit.keep;
          if (hit.wrap !== null) {
            out.push(`<${hit.wrap}>`);
            stack.push(hit.wrap);
          }
          copied = m.index;
        }
      }
      if (m[3] !== '/') stack.push(name);
    }
    out.push(text.slice(copied, b));
  }

  while (at !== -1) {
    holes++;
    let end = at + 1;
    while (end < n && text[end] === SENTINEL) end++;
    const lt = text.lastIndexOf('<', at);
    const gt = text.lastIndexOf('>', at);
    const inTag = lt >= from && lt > gt;
    if (!inTag) {
      track(from, entityStart(text, from, at, gt));
      armed = true;
      const next = text.indexOf('<', end);
      from = next === -1 ? n : next;
    } else {
      track(from, lt);
      armed = true;
      const close = tagEnd(text, end);
      const afterGt = close === -1 ? n : close + 1;
      if (text[lt + 1] === '/' || text[lt + 1] === '!' || text[lt + 1] === '?') {
        from = afterGt;
      } else {
        const match = NAME.exec(text.slice(lt + 1, at));
        const named = match !== null && lt + 1 + match[0].length < at;
        if (named && close !== -1) {
          if (text[close - 1] === '/') from = afterGt;
          else from = skipElement(text, afterGt, match[0]);
        } else {
          const next = close === -1 ? -1 : text.indexOf('<', afterGt);
          from = next === -1 ? n : next;
        }
      }
    }
    at = from < n ? text.indexOf(SENTINEL, from) : -1;
  }
  if (from < n) track(from, n);
  return { text: out.join(''), holes };
}
