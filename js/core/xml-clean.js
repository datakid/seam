export function decodeXml(bytes) {
  let reencoded = false;
  let text;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    reencoded = true;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
    reencoded = true;
  } else if (bytes.length >= 4 && bytes[0] === 0x3c && bytes[1] === 0x00 && bytes[2] !== 0x00 && bytes[3] === 0x00) {
    text = new TextDecoder('utf-16le').decode(bytes);
    reencoded = true;
  } else if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x3c && bytes[2] === 0x00 && bytes[3] !== 0x00) {
    text = new TextDecoder('utf-16be').decode(bytes);
    reencoded = true;
  } else {
    const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start));
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let invalid = 0;
  if (!reencoded) {
    let at = text.indexOf('\uFFFD');
    while (at !== -1) {
      invalid++;
      at = text.indexOf('\uFFFD', at + 1);
    }
  }
  if (reencoded) text = fixDeclaration(text);
  return { text, reencoded, invalid };
}

export function fixDeclaration(text) {
  if (!text.startsWith('<?xml')) return text;
  const end = text.indexOf('?>');
  if (end === -1) return text;
  let decl = text.slice(0, end);
  const at = decl.indexOf('encoding');
  if (at === -1) return text;
  let q = at + 8;
  while (q < decl.length && decl[q] !== '"' && decl[q] !== "'") q++;
  if (q >= decl.length) return text;
  const quote = decl[q];
  const close = decl.indexOf(quote, q + 1);
  if (close === -1) return text;
  decl = decl.slice(0, q + 1) + 'UTF-8' + decl.slice(close);
  return decl + text.slice(end);
}

function validCodePoint(code) {
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const NUMERIC_REF = /&#(?:x([0-9a-fA-F]+)|(\d+));/g;
const BARE_AMP = /&(?!(?:amp|lt|gt|quot|apos);|#\d+;|#x[0-9a-fA-F]+;)/g;

export function cleanChars(text) {
  let removed = 0;
  let escaped = 0;
  let out = text.replace(NUMERIC_REF, (match, hex, dec) => {
    const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10);
    if (Number.isFinite(code) && validCodePoint(code)) return match;
    removed++;
    return '';
  });
  out = out.replace(CONTROL, () => {
    removed++;
    return '';
  });
  out = out.replace(LONE_SURROGATE, () => {
    removed++;
    return '';
  });
  out = out.replace(BARE_AMP, () => {
    escaped++;
    return '&amp;';
  });
  return { text: out, removed, escaped, changed: removed + escaped > 0 };
}

export function encodeUtf8(text) {
  return new TextEncoder().encode(text);
}
