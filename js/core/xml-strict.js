const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

const START = new Uint8Array(128);
const PART = new Uint8Array(128);
for (let c = 65; c <= 90; c++) START[c] = PART[c] = 1;
for (let c = 97; c <= 122; c++) START[c] = PART[c] = 1;
START[95] = PART[95] = 1;
START[58] = PART[58] = 1;
for (let c = 48; c <= 57; c++) PART[c] = 1;
PART[45] = 1;
PART[46] = 1;

function startCode(c) {
  return (
    (c >= 0xc0 && c <= 0xd6) ||
    (c >= 0xd8 && c <= 0xf6) ||
    (c >= 0xf8 && c <= 0x2ff) ||
    (c >= 0x370 && c <= 0x37d) ||
    (c >= 0x37f && c <= 0x1fff) ||
    (c >= 0x200c && c <= 0x200d) ||
    (c >= 0x2070 && c <= 0x218f) ||
    (c >= 0x2c00 && c <= 0x2fef) ||
    (c >= 0x3001 && c <= 0xd7ff) ||
    (c >= 0xf900 && c <= 0xfdcf) ||
    (c >= 0xfdf0 && c <= 0xfffd) ||
    (c >= 0x10000 && c <= 0xeffff)
  );
}

function partCode(c) {
  return startCode(c) || c === 0xb7 || (c >= 0x300 && c <= 0x36f) || (c >= 0x203f && c <= 0x2040);
}

function isSpace(c) {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function validCode(c) {
  return c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);
}

function nameEnd(s, i, n, first) {
  let at = i;
  while (at < n) {
    let c = s.charCodeAt(at);
    let width = 1;
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = s.charCodeAt(at + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        c = (c - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        width = 2;
      }
    }
    const ok = c < 128 ? (at === i && first ? START[c] === 1 : PART[c] === 1) : at === i && first ? startCode(c) : partCode(c);
    if (!ok) break;
    at += width;
  }
  return at;
}

function scanChars(s, from, to) {
  for (let at = from; at < to; at++) {
    const c = s.charCodeAt(at);
    if (c >= 0x20 && c < 0xd800) continue;
    if (c === 0x09 || c === 0x0a || c === 0x0d) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = s.charCodeAt(at + 1);
      if (low >= 0xdc00 && low <= 0xdfff && at + 1 < to) {
        at++;
        continue;
      }
      return at;
    }
    if (c >= 0xe000 && c <= 0xfffd) continue;
    return at;
  }
  return -1;
}

function characterVerdict(s, at) {
  const c = s.charCodeAt(at);
  if (c >= 0xd800 && c <= 0xdfff) return null;
  return { ok: false, reason: 'character', at };
}

function reference(s, i, n) {
  if (s.charCodeAt(i + 1) === 35) {
    let at = i + 2;
    let value = 0;
    let digits = 0;
    if (s.charCodeAt(at) === 120) {
      at++;
      for (;;) {
        const c = s.charCodeAt(at);
        let d = -1;
        if (c >= 48 && c <= 57) d = c - 48;
        else if (c >= 97 && c <= 102) d = c - 87;
        else if (c >= 65 && c <= 70) d = c - 55;
        if (d < 0) break;
        value = value * 16 + d;
        if (value > 0x10ffff) return -1;
        digits++;
        at++;
      }
    } else {
      for (;;) {
        const c = s.charCodeAt(at);
        if (c < 48 || c > 57) break;
        value = value * 10 + (c - 48);
        if (value > 0x10ffff) return -1;
        digits++;
        at++;
      }
    }
    if (digits === 0 || s.charCodeAt(at) !== 59 || !validCode(value)) return -1;
    return at + 1;
  }
  const rest = s.substr(i + 1, 5);
  if (rest.startsWith('lt;') || rest.startsWith('gt;')) return i + 4;
  if (rest.startsWith('amp;')) return i + 5;
  if (rest.startsWith('quot;') || rest.startsWith('apos;')) return i + 6;
  return -1;
}

function decodeValue(value) {
  return value.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g, (match, hex, dec, name) => {
    if (name) return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[name];
    return String.fromCodePoint(hex ? parseInt(hex, 16) : Number(dec));
  }).replace(/[\t\n\r]/g, ' ');
}

function splitName(name) {
  const colon = name.indexOf(':');
  if (colon === -1) return { prefix: null, local: name };
  if (colon === 0 || colon === name.length - 1 || name.indexOf(':', colon + 1) !== -1) return null;
  return { prefix: name.slice(0, colon), local: name.slice(colon + 1) };
}

export function strictWellFormed(text) {
  const s = text;
  const n = s.length;
  let i = 0;
  const bad = (reason, at) => ({ ok: false, reason, at });
  const unsure = null;

  if (n === 0) return bad('empty', 0);
  if (s.charCodeAt(0) === 0xfeff) return unsure;
  if (typeof s.isWellFormed === 'function' ? !s.isWellFormed() : /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s)) return unsure;

  if (s.startsWith('<?xml') && isSpace(s.charCodeAt(5))) {
    const end = s.indexOf('?>', 5);
    if (end === -1) return bad('declaration', 0);
    const declaration = /^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)')(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)'))?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)'))?[ \t\r\n]*\?>/.exec(s.slice(0, end + 2));
    if (!declaration) return bad('declaration', 0);
    const version = declaration[1] !== undefined ? declaration[1] : declaration[2];
    const encoding = declaration[3] !== undefined ? declaration[3] : declaration[4];
    const standalone = declaration[5] !== undefined ? declaration[5] : declaration[6];
    if (version !== '1.0') return unsure;
    if (encoding !== undefined && !/^utf-8$/i.test(encoding)) return unsure;
    if (standalone !== undefined && standalone !== 'yes' && standalone !== 'no') return bad('standalone', 0);
    i = end + 2;
  }

  const stack = [];
  const bindings = new Map();
  let rootSeen = false;

  while (i < n) {
    const c = s.charCodeAt(i);
    if (c !== 60) {
      if (stack.length === 0) {
        if (!isSpace(c)) return bad('text outside the root', i);
        i++;
        continue;
      }
      let at = i;
      for (;;) {
        const d = s.charCodeAt(at);
        if (d === 60 || at >= n) break;
        if (d === 38) {
          const after = reference(s, at, n);
          if (after === -1) return bad('reference', at);
          at = after;
          continue;
        }
        if (d === 93 && s.charCodeAt(at + 1) === 93 && s.charCodeAt(at + 2) === 62) return bad('cdata end in text', at);
        if (d >= 0x20 && d < 0xd800 && d !== 38) {
          at++;
          continue;
        }
        const wrong = scanChars(s, at, at + 1 + (d >= 0xd800 && d <= 0xdbff ? 1 : 0));
        if (wrong !== -1) return characterVerdict(s, wrong);
        at += d >= 0xd800 && d <= 0xdbff ? 2 : 1;
      }
      i = at;
      continue;
    }

    const next = s.charCodeAt(i + 1);

    if (next === 33) {
      if (s.startsWith('<!--', i)) {
        const dashes = s.indexOf('--', i + 4);
        if (dashes === -1 || s.charCodeAt(dashes + 2) !== 62) return bad('comment', i);
        const wrong = scanChars(s, i + 4, dashes);
        if (wrong !== -1) return characterVerdict(s, wrong);
        i = dashes + 3;
        continue;
      }
      if (s.startsWith('<![CDATA[', i)) {
        if (stack.length === 0) return bad('cdata outside the root', i);
        const end = s.indexOf(']]>', i + 9);
        if (end === -1) return bad('cdata', i);
        const wrong = scanChars(s, i + 9, end);
        if (wrong !== -1) return characterVerdict(s, wrong);
        i = end + 3;
        continue;
      }
      if (s.startsWith('<!DOCTYPE', i)) return unsure;
      return bad('markup', i);
    }

    if (next === 63) {
      const targetEnd = nameEnd(s, i + 2, n, true);
      if (targetEnd === i + 2) return bad('instruction', i);
      const target = s.slice(i + 2, targetEnd);
      if (target.length === 3 && target.toLowerCase() === 'xml') return bad('declaration position', i);
      if (target.indexOf(':') !== -1) return unsure;
      const end = s.indexOf('?>', targetEnd);
      if (end === -1) return bad('instruction', i);
      if (end !== targetEnd && !isSpace(s.charCodeAt(targetEnd))) return bad('instruction', i);
      const wrong = scanChars(s, targetEnd, end);
      if (wrong !== -1) return characterVerdict(s, wrong);
      i = end + 2;
      continue;
    }

    if (next === 47) {
      if (stack.length === 0) return bad('end tag without a start', i);
      const top = stack[stack.length - 1];
      if (!s.startsWith(top.name, i + 2)) return bad('end tag mismatch', i);
      let at = i + 2 + top.name.length;
      while (isSpace(s.charCodeAt(at))) at++;
      if (s.charCodeAt(at) !== 62) return bad('end tag', i);
      stack.pop();
      if (top.declared !== null) for (const prefix of top.declared) bindings.get(prefix).pop();
      i = at + 1;
      continue;
    }

    if (stack.length === 0 && rootSeen) return bad('content after the root', i);
    const nameStop = nameEnd(s, i + 1, n, true);
    if (nameStop === i + 1) return bad('start tag', i);
    const name = s.slice(i + 1, nameStop);
    let at = nameStop;
    let attributes = null;
    let declarations = null;
    let empty = false;
    for (;;) {
      const before = at;
      while (isSpace(s.charCodeAt(at))) at++;
      const d = s.charCodeAt(at);
      if (d === 62) {
        at++;
        break;
      }
      if (d === 47) {
        if (s.charCodeAt(at + 1) !== 62) return bad('start tag', at);
        empty = true;
        at += 2;
        break;
      }
      if (at === before) return bad('attribute spacing', at);
      const attrEnd = nameEnd(s, at, n, true);
      if (attrEnd === at) return bad('attribute name', at);
      const attrName = s.slice(at, attrEnd);
      at = attrEnd;
      while (isSpace(s.charCodeAt(at))) at++;
      if (s.charCodeAt(at) !== 61) return bad('attribute equals', at);
      at++;
      while (isSpace(s.charCodeAt(at))) at++;
      const quote = s.charCodeAt(at);
      if (quote !== 34 && quote !== 39) return bad('attribute quote', at);
      at++;
      const valueStart = at;
      for (;;) {
        if (at >= n) return bad('attribute value', valueStart);
        const e = s.charCodeAt(at);
        if (e === quote) break;
        if (e === 60) return bad('less-than in attribute', at);
        if (e === 38) {
          const after = reference(s, at, n);
          if (after === -1) return bad('reference', at);
          at = after;
          continue;
        }
        if (e >= 0x20 && e < 0xd800) {
          at++;
          continue;
        }
        const width = e >= 0xd800 && e <= 0xdbff ? 2 : 1;
        const wrong = scanChars(s, at, at + width);
        if (wrong !== -1) return characterVerdict(s, wrong);
        if (at + width > n) return characterVerdict(s, at);
        at += width;
      }
      const value = s.slice(valueStart, at);
      at++;
      if (attrName === 'xmlns' || attrName.startsWith('xmlns:')) {
        if (declarations === null) declarations = [];
        declarations.push({ name: attrName, value });
      }
      if (attributes === null) attributes = [];
      attributes.push(attrName);
    }

    if (attributes !== null && attributes.length > 1) {
      if (attributes.length <= 12) {
        for (let a = 1; a < attributes.length; a++) for (let b = 0; b < a; b++) if (attributes[a] === attributes[b]) return bad('duplicate attribute', i);
      } else if (new Set(attributes).size !== attributes.length) return bad('duplicate attribute', i);
    }

    let declared = null;
    if (declarations !== null) {
      for (const declaration of declarations) {
        const value = declaration.value.indexOf('&') === -1 && !/[\t\n\r]/.test(declaration.value) ? declaration.value : decodeValue(declaration.value);
        let prefix = '';
        if (declaration.name !== 'xmlns') {
          prefix = declaration.name.slice(6);
          if (prefix === 'xml' || prefix === 'xmlns') return unsure;
          if (prefix.indexOf(':') !== -1 || prefix === '') return bad('declaration prefix', i);
          if (value === '') return bad('empty prefix binding', i);
        }
        if (value === XML_NS || value === XMLNS_NS) return unsure;
        let stackOfUris = bindings.get(prefix);
        if (stackOfUris === undefined) {
          stackOfUris = [];
          bindings.set(prefix, stackOfUris);
        }
        stackOfUris.push(value);
        if (declared === null) declared = [];
        declared.push(prefix);
      }
    }

    const split = splitName(name);
    if (split === null) return bad('qualified name', i);
    if (split.prefix === 'xml') return unsure;
    if (split.prefix !== null) {
      const uris = bindings.get(split.prefix);
      if (uris === undefined || uris.length === 0) return bad('unbound prefix', i);
    }
    if (attributes !== null) {
      let qualified = null;
      for (const attribute of attributes) {
        if (attribute === 'xmlns' || attribute.startsWith('xmlns:')) continue;
        const colon = attribute.indexOf(':');
        if (colon === -1) continue;
        const parts = splitName(attribute);
        if (parts === null) return bad('qualified name', i);
        if (parts.prefix === 'xml') continue;
        const uris = bindings.get(parts.prefix);
        if (uris === undefined || uris.length === 0) return bad('unbound prefix', i);
        if (qualified === null) qualified = new Set();
        const key = `${uris[uris.length - 1]}\u0000${parts.local}`;
        if (qualified.has(key)) return bad('duplicate attribute', i);
        qualified.add(key);
      }
    }

    if (empty) {
      if (declared !== null) for (const prefix of declared) bindings.get(prefix).pop();
      if (stack.length === 0) rootSeen = true;
    } else {
      stack.push({ name, declared });
      rootSeen = true;
    }
    i = at;
  }

  if (stack.length > 0) return bad('unclosed element', n);
  if (!rootSeen) return bad('no root', n);
  return { ok: true };
}
