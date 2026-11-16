import test from 'node:test';
import assert from 'node:assert/strict';
import { damage, KINDS, caseSeed, ERROR_PAGE } from '../tools/damage.mjs';

function sample(length, seed, avoidCrlf = false) {
  let a = seed >>> 0;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    out[i] = a >>> 24;
    if (avoidCrlf && i > 0 && out[i] === 0x0a && out[i - 1] === 0x0d) out[i] = 0x0b;
  }
  return out;
}

function equal(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function inRanges(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function dropRange(bytes, [start, end]) {
  const out = new Uint8Array(bytes.length - (end - start));
  out.set(bytes.subarray(0, start), 0);
  out.set(bytes.subarray(end), start);
  return out;
}

const INPUT = sample(200000, 7, true);
const OTHER = sample(30000, 11);

function run(kind, seed, bytes = INPUT) {
  return damage(bytes, kind, seed, kind === 'concat' ? { other: OTHER } : null);
}

test('every kind is deterministic for the same seed', () => {
  for (const kind of KINDS) {
    const a = run(kind, 123);
    const b = run(kind, 123);
    assert.ok(equal(a.bytes, b.bytes), kind);
    assert.deepEqual(a.meta, b.meta, kind);
  }
});

test('different seeds give different output for the random kinds', () => {
  for (const kind of ['zero512', 'zero4096', 'head', 'bitflip', 'insert', 'dropblock', 'padzero', 'losttail']) {
    const outputs = new Set();
    for (let seed = 1; seed <= 6; seed++) outputs.add(Buffer.from(run(kind, seed).bytes).toString('base64'));
    assert.ok(outputs.size > 1, kind);
  }
});

test('input is never modified', () => {
  const copy = INPUT.slice();
  for (const kind of KINDS) run(kind, 5);
  assert.ok(equal(copy, INPUT));
});

test('meta lengths match the output', () => {
  for (const kind of KINDS) {
    const { bytes, meta } = run(kind, 9);
    assert.equal(meta.lengthBefore, INPUT.length, kind);
    assert.equal(meta.lengthAfter, bytes.length, kind);
    assert.equal(meta.kind, kind);
  }
});

test('in-place kinds only change bytes inside meta.changed', () => {
  for (const kind of ['zero512', 'zero4096', 'losttail', 'head', 'bitflip', 'padzero']) {
    for (let seed = 1; seed <= 8; seed++) {
      const { bytes, meta } = run(kind, seed);
      assert.equal(bytes.length, INPUT.length, kind);
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== INPUT[i]) assert.ok(inRanges(i, meta.changed), `${kind} seed ${seed} index ${i}`);
      }
    }
  }
});

test('zero kinds write zeros on aligned blocks inside the file', () => {
  for (const [kind, size] of [['zero512', 512], ['zero4096', 4096]]) {
    for (let seed = 1; seed <= 20; seed++) {
      const { bytes, meta } = run(kind, seed);
      const [[start, end]] = meta.changed;
      assert.equal(start % size, 0, `${kind} aligned`);
      assert.ok((end - start) % size === 0 && end - start >= size && end - start <= 8 * size, `${kind} length`);
      assert.ok(start >= INPUT.length / 3 - size && end <= (2 * INPUT.length) / 3 + size, `${kind} middle third`);
      for (let i = start; i < end; i++) assert.equal(bytes[i], 0);
    }
  }
});

test('bitflip flips exactly the recorded number of bits', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { bytes, meta } = run('bitflip', seed);
    let bits = 0;
    for (let i = 0; i < bytes.length; i++) {
      let x = bytes[i] ^ INPUT[i];
      while (x) {
        bits += x & 1;
        x >>= 1;
      }
    }
    assert.equal(bits, meta.params.count);
    assert.ok([1, 8, 64].includes(meta.params.count));
  }
});

test('truncate keeps a prefix and records the cut', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { bytes, meta } = run('truncate', seed);
    assert.ok(equal(bytes, INPUT.subarray(0, bytes.length)));
    assert.deepEqual(meta.removed, [[bytes.length, INPUT.length]]);
    assert.ok([10, 30, 50, 70, 90, 99].includes(meta.params.pct));
  }
});

test('padzero keeps the length and zero-fills after the cut', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { bytes, meta } = run('padzero', seed);
    const [[cut, end]] = meta.changed;
    assert.equal(end, INPUT.length);
    assert.ok(cut >= INPUT.length * 0.5 - 1 && cut <= INPUT.length * 0.9 + 1);
    assert.ok(equal(bytes.subarray(0, cut), INPUT.subarray(0, cut)));
    assert.ok(bytes.subarray(cut).every((v) => v === 0));
  }
});

test('losttail keeps the length and zeroes the last 1 to 64 KB', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { bytes, meta } = run('losttail', seed);
    const [[start, end]] = meta.changed;
    assert.equal(end, INPUT.length);
    assert.ok(end - start >= 1024 && end - start <= 64 * 1024);
    assert.ok(bytes.subarray(start).every((v) => v === 0));
  }
});

test('head overwrites 512 or 4096 bytes at the start', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { bytes, meta } = run('head', seed);
    const [[start, end]] = meta.changed;
    assert.equal(start, 0);
    assert.ok(end === 512 || end === 4096);
    assert.ok(equal(bytes.subarray(end), INPUT.subarray(end)));
  }
});

test('crlf adds a CR before every bare LF and is reversible when none existed', () => {
  const withLf = sample(60000, 21, true);
  for (let i = 1; i < withLf.length; i += 97) if (withLf[i - 1] !== 0x0d) withLf[i] = 0x0a;
  const { bytes, meta } = damage(withLf, 'crlf', 1);
  assert.equal(meta.params.originalCrlf, 0);
  assert.ok(meta.params.added > 100);
  assert.equal(bytes.length, withLf.length + meta.params.added);
  const back = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) continue;
    back.push(bytes[i]);
  }
  assert.ok(equal(Uint8Array.from(back), withLf));
});

test('crlf leaves existing CRLF pairs alone and counts them', () => {
  const bytes = Uint8Array.from([1, 0x0d, 0x0a, 2, 0x0a, 3, 0x0a, 0x0a]);
  const { bytes: out, meta } = damage(bytes, 'crlf', 1);
  assert.deepEqual(Array.from(out), [1, 0x0d, 0x0a, 2, 0x0d, 0x0a, 3, 0x0d, 0x0a, 0x0d, 0x0a]);
  assert.equal(meta.params.originalCrlf, 1);
  assert.equal(meta.params.added, 3);
});

test('insert adds 4096 random bytes at an aligned offset', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { bytes, meta } = run('insert', seed);
    const [[start, end]] = meta.changed;
    assert.equal(start % 4096, 0);
    assert.equal(end - start, 4096);
    assert.equal(bytes.length, INPUT.length + 4096);
    assert.ok(equal(dropRange(bytes, [start, end]), INPUT));
  }
});

test('dropblock removes one aligned 4096-byte block', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { bytes, meta } = run('dropblock', seed);
    const [[start, end]] = meta.removed;
    assert.equal(start % 4096, 0);
    assert.equal(end - start, 4096);
    assert.equal(bytes.length, INPUT.length - 4096);
    assert.ok(equal(bytes.subarray(0, start), INPUT.subarray(0, start)));
    assert.ok(equal(bytes.subarray(start), INPUT.subarray(end)));
  }
});

test('dropblock falls back to 512 bytes on small files', () => {
  const small = sample(6000, 3);
  const { meta } = damage(small, 'dropblock', 4);
  assert.equal(meta.removed[0][1] - meta.removed[0][0], 512);
});

test('prefix and suffix add the fixed error page', () => {
  const html = new TextEncoder().encode(ERROR_PAGE);
  const front = run('prefix', 1);
  assert.ok(equal(front.bytes.subarray(0, html.length), html));
  assert.ok(equal(front.bytes.subarray(html.length), INPUT));
  const back = run('suffix', 1);
  assert.ok(equal(back.bytes.subarray(0, INPUT.length), INPUT));
  assert.ok(equal(back.bytes.subarray(INPUT.length), html));
});

test('concat joins two files and needs the second one', () => {
  const { bytes, meta } = run('concat', 1);
  assert.ok(equal(bytes.subarray(0, INPUT.length), INPUT));
  assert.ok(equal(bytes.subarray(INPUT.length), OTHER));
  assert.deepEqual(meta.changed, [[INPUT.length, INPUT.length + OTHER.length]]);
  assert.throws(() => damage(INPUT, 'concat', 1));
});

test('tiny inputs do not throw', () => {
  const tiny = sample(100, 5);
  for (const kind of KINDS) {
    const { bytes } = damage(tiny, kind, 3, kind === 'concat' ? { other: OTHER } : null);
    assert.ok(bytes.length > 0, kind);
  }
});

test('unknown kind and empty input are rejected', () => {
  assert.throws(() => damage(INPUT, 'nope', 1));
  assert.throws(() => damage(new Uint8Array(0), 'truncate', 1));
});

test('caseSeed is stable and varies with every part', () => {
  assert.equal(caseSeed('a', 'truncate', 0), caseSeed('a', 'truncate', 0));
  const seeds = new Set([caseSeed('a', 'truncate', 0), caseSeed('b', 'truncate', 0), caseSeed('a', 'crlf', 0), caseSeed('a', 'truncate', 1)]);
  assert.equal(seeds.size, 4);
});
