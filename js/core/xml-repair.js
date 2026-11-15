const WS = new Set([' ', '\t', '\n', '\r']);

function isWs(c) {
  return WS.has(c);
}

function isNameStart(c) {
  if (c === undefined) return false;
  const code = c.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || c === '_' || c === ':' || code >= 0xc0;
}

export function domWellFormed(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return doc.getElementsByTagName('parsererror').length === 0;
}

export function decodeEntities(value) {
  if (value.indexOf('&') === -1) return value;
  return value.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (match, body) => {
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'amp') return '&';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    try {
      return String.fromCodePoint(code);
    } catch (error) {
      return match;
    }
  });
}

export function escapeText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function localName(name) {
  const at = name.indexOf(':');
  return at === -1 ? name : name.slice(at + 1);
}

export function prefixOf(name) {
  const at = name.indexOf(':');
  return at === -1 ? '' : name.slice(0, at);
}

function parseStartTag(text, i) {
  const n = text.length;
  let j = i + 1;
  while (j < n && !isWs(text[j]) && text[j] !== '/' && text[j] !== '>') j++;
  const name = text.slice(i + 1, j);
  const attrs = [];
  const seen = new Set();
  const found = { dupAttrs: 0, quotedAttrs: 0, droppedAttrs: 0 };
  for (;;) {
    while (j < n && isWs(text[j])) j++;
    if (j >= n) return { eof: true };
    const c = text[j];
    if (c === '>') return { name, attrs, self: false, end: j + 1, found };
    if (c === '/') {
      if (text[j + 1] === '>') return { name, attrs, self: true, end: j + 2, found };
      if (j + 1 >= n) return { eof: true };
      j++;
      continue;
    }
    let k = j;
    while (k < n && !isWs(text[k]) && text[k] !== '=' && text[k] !== '>' && text[k] !== '/') k++;
    if (k === j) {
      found.droppedAttrs++;
      j++;
      continue;
    }
    const attrName = text.slice(j, k);
    j = k;
    while (j < n && isWs(text[j])) j++;
    if (text[j] !== '=') {
      if (j >= n) return { eof: true };
      found.droppedAttrs++;
      continue;
    }
    j++;
    while (j < n && isWs(text[j])) j++;
    if (j >= n) return { eof: true };
    let value;
    const q = text[j];
    if (q === '"' || q === "'") {
      const close = text.indexOf(q, j + 1);
      if (close === -1) return { eof: true };
      value = text.slice(j + 1, close);
      j = close + 1;
    } else {
      let m = j;
      while (m < n && !isWs(text[m]) && text[m] !== '>' && !(text[m] === '/' && text[m + 1] === '>')) m++;
      value = text.slice(j, m);
      j = m;
      found.quotedAttrs++;
    }
    value = value.replace(/</g, '&lt;').replace(/"/g, '&quot;');
    if (seen.has(attrName)) {
      found.dupAttrs++;
      continue;
    }
    seen.add(attrName);
    attrs.push([attrName, value]);
  }
}

export function scan(text, collect = true) {
  const tokens = [];
  let emitted = 0;
  const push = (token) => {
    emitted++;
    if (collect) tokens.push(token);
  };
  const stats = { autoClosed: 0, strayClosed: 0, dupAttrs: 0, quotedAttrs: 0, droppedAttrs: 0, escaped: 0, dropped: 0, trailingContent: 0 };
  const stack = [];
  const n = text.length;
  let i = 0;
  let rootSeen = false;
  let cut = n;
  let ended = false;

  function openText(raw) {
    if (raw === '') return;
    const last = collect ? tokens[tokens.length - 1] : null;
    if (last && last.t === 'text') last.raw += raw;
    else push({ t: 'text', raw });
  }

  while (i < n) {
    if (text[i] !== '<') {
      let j = text.indexOf('<', i);
      if (j === -1) j = n;
      const raw = text.slice(i, j);
      i = j;
      if (stack.length === 0) {
        if (raw.trim() !== '') {
          if (rootSeen) {
            stats.trailingContent = 1;
            break;
          }
          stats.dropped++;
        }
        continue;
      }
      openText(raw.indexOf(']]>') === -1 ? raw : raw.split(']]>').join(']]&gt;'));
      continue;
    }

    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1) {
        stats.dropped++;
        cut = i;
        i = n;
        ended = true;
        break;
      }
      const body = text.slice(i + 4, end);
      if (stack.length > 0 || !rootSeen) push({ t: 'comment', raw: body.indexOf('--') === -1 && !body.endsWith('-') ? body : body.replace(/-(?=-)/g, '- ').replace(/-$/, '- ') });
      i = end + 3;
      continue;
    }

    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      if (end === -1) {
        stats.dropped++;
        cut = i;
        i = n;
        ended = true;
        break;
      }
      if (stack.length > 0) push({ t: 'cdata', raw: text.slice(i + 9, end) });
      else stats.dropped++;
      i = end + 3;
      continue;
    }

    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end === -1) {
        stats.dropped++;
        cut = i;
        i = n;
        ended = true;
        break;
      }
      const body = text.slice(i + 2, end);
      const isDecl = body.startsWith('xml') && (body.length === 3 || isWs(body[3]));
      if (isDecl) {
        if (emitted === 0) push({ t: 'decl', raw: `<?${body}?>` });
        else stats.dropped++;
      } else if (stack.length > 0 || !rootSeen) {
        push({ t: 'pi', raw: `<?${body}?>` });
      }
      i = end + 2;
      continue;
    }

    if (text.startsWith('<!', i)) {
      const end = text.indexOf('>', i + 2);
      stats.dropped++;
      if (end === -1) {
        cut = i;
        i = n;
        ended = true;
        break;
      }
      i = end + 1;
      continue;
    }

    if (i + 1 >= n) {
      cut = i;
      i = n;
      ended = true;
      break;
    }

    if (text[i + 1] === '/') {
      let j = i + 2;
      while (j < n && !isWs(text[j]) && text[j] !== '>') j++;
      const name = text.slice(i + 2, j);
      const end = text.indexOf('>', j);
      if (end === -1) {
        cut = i;
        i = n;
        ended = true;
        break;
      }
      i = end + 1;
      if (stack.length === 0) {
        stats.strayClosed++;
        continue;
      }
      const at = stack.lastIndexOf(name);
      if (at === -1) {
        stats.strayClosed++;
        continue;
      }
      while (stack.length - 1 > at) {
        push({ t: 'close', name: stack.pop() });
        stats.autoClosed++;
      }
      push({ t: 'close', name: stack.pop() });
      if (stack.length === 0) {
        if (!onlyTrivia(text, i)) stats.trailingContent = 1;
        i = n;
      }
      continue;
    }

    if (isNameStart(text[i + 1])) {
      const tag = parseStartTag(text, i);
      if (tag.eof) {
        cut = i;
        i = n;
        ended = true;
        break;
      }
      i = tag.end;
      if (stack.length === 0 && rootSeen) {
        stats.trailingContent = 1;
        break;
      }
      stats.dupAttrs += tag.found.dupAttrs;
      stats.quotedAttrs += tag.found.quotedAttrs;
      stats.droppedAttrs += tag.found.droppedAttrs;
      push({ t: 'open', name: tag.name, attrs: tag.attrs, self: tag.self });
      rootSeen = true;
      if (!tag.self) stack.push(tag.name);
      else if (stack.length === 0) {
        if (!onlyTrivia(text, i)) stats.trailingContent = 1;
        i = n;
      }
      continue;
    }

    if (stack.length > 0) {
      openText('&lt;');
      stats.escaped++;
    } else {
      stats.dropped++;
    }
    i++;
  }

  const unclosed = stack.length;
  while (stack.length > 0) push({ t: 'close', name: stack.pop() });

  return {
    tokens,
    stats,
    hasRoot: rootSeen,
    unclosed,
    truncated: ended || unclosed > 0,
    truncatedAt: n === 0 ? 0 : cut / n
  };
}

function onlyTrivia(text, from) {
  const n = text.length;
  let i = from;
  while (i < n) {
    if (isWs(text[i])) {
      i++;
    } else if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1) return false;
      i = end + 3;
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end === -1) return false;
      i = end + 2;
    } else {
      return false;
    }
  }
  return true;
}

export function looksWellFormed(text) {
  const result = scan(text, false);
  if (!result.hasRoot || result.truncated) return false;
  for (const value of Object.values(result.stats)) if (value !== 0) return false;
  return true;
}

export function serializeTokens(tokens) {
  const out = [];
  for (const token of tokens) {
    if (token.t === 'text' || token.t === 'pi') out.push(token.raw);
    else if (token.t === 'decl') out.push(token.raw, '\n');
    else if (token.t === 'comment') out.push('<!--', token.raw, '-->');
    else if (token.t === 'cdata') out.push('<![CDATA[', token.raw, ']]>');
    else if (token.t === 'close') out.push('</', token.name, '>');
    else {
      out.push('<', token.name);
      for (const [name, value] of token.attrs) out.push(' ', name, '="', value, '"');
      out.push(token.self ? '/>' : '>');
    }
  }
  return out.join('');
}

export function repairXml(text) {
  const result = scan(text);
  return {
    text: serializeTokens(result.tokens),
    stats: result.stats,
    hasRoot: result.hasRoot,
    unclosed: result.unclosed,
    truncated: result.truncated,
    truncatedAt: result.truncatedAt
  };
}

export function buildTree(tokens) {
  const root = { type: 'root', name: '#root', attrs: [], children: [], parent: null };
  let current = root;
  for (const token of tokens) {
    if (token.t === 'open') {
      const node = { type: 'el', name: token.name, attrs: token.attrs.map((pair) => [pair[0], pair[1]]), children: [], parent: current };
      current.children.push(node);
      if (!token.self) current = node;
    } else if (token.t === 'close') {
      if (current.parent) current = current.parent;
    } else {
      current.children.push({ type: token.t, raw: token.raw, parent: current });
    }
  }
  return root;
}

export function parseTree(text) {
  return buildTree(scan(text).tokens);
}

export function documentElement(root) {
  return root.children.find((child) => child.type === 'el') || null;
}

export function serializeNode(node, out) {
  if (node.type === 'el') {
    out.push('<', node.name);
    for (const [name, value] of node.attrs) out.push(' ', name, '="', value, '"');
    if (node.children.length === 0) {
      out.push('/>');
      return;
    }
    out.push('>');
    for (const child of node.children) serializeNode(child, out);
    out.push('</', node.name, '>');
  } else if (node.type === 'text' || node.type === 'pi') out.push(node.raw);
  else if (node.type === 'decl') out.push(node.raw, '\n');
  else if (node.type === 'comment') out.push('<!--', node.raw, '-->');
  else if (node.type === 'cdata') out.push('<![CDATA[', node.raw, ']]>');
}

export function serializeTree(root) {
  const out = [];
  for (const child of root.children) serializeNode(child, out);
  return out.join('');
}

export function getAttr(node, name) {
  for (const pair of node.attrs) if (pair[0] === name) return decodeEntities(pair[1]);
  return null;
}

export function getAttrLocal(node, local) {
  for (const pair of node.attrs) if (localName(pair[0]) === local) return decodeEntities(pair[1]);
  return null;
}

export function setAttr(node, name, value) {
  const escaped = escapeAttr(value);
  for (const pair of node.attrs) {
    if (pair[0] === name) {
      pair[1] = escaped;
      return;
    }
  }
  node.attrs.push([name, escaped]);
}

export function removeAttr(node, name) {
  node.attrs = node.attrs.filter((pair) => pair[0] !== name);
}

export function elementChildren(node, local) {
  return node.children.filter((child) => child.type === 'el' && (local === undefined || localName(child.name) === local));
}

export function descendants(node, local, out = []) {
  for (const child of node.children) {
    if (child.type !== 'el') continue;
    if (local === undefined || localName(child.name) === local) out.push(child);
    descendants(child, local, out);
  }
  return out;
}

export function removeNode(node) {
  if (!node.parent) return;
  const index = node.parent.children.indexOf(node);
  if (index !== -1) node.parent.children.splice(index, 1);
  node.parent = null;
}

export function unwrapNode(node) {
  const parent = node.parent;
  if (!parent) return;
  const index = parent.children.indexOf(node);
  for (const child of node.children) child.parent = parent;
  parent.children.splice(index, 1, ...node.children);
  node.parent = null;
  node.children = [];
}

export function textOf(node) {
  let out = '';
  for (const child of node.children) {
    if (child.type === 'text') out += decodeEntities(child.raw);
    else if (child.type === 'cdata') out += child.raw;
    else if (child.type === 'el') out += textOf(child);
  }
  return out;
}

export function createElement(name, attrs = [], children = []) {
  const node = { type: 'el', name, attrs: attrs.map(([k, v]) => [k, escapeAttr(v)]), children: [], parent: null };
  for (const child of children) {
    child.parent = node;
    node.children.push(child);
  }
  return node;
}
