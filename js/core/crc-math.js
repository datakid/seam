import { CRC_TABLE } from './crc32.js';

const POLY = 0xedb88320;

export function multmodp(a, b) {
  let m = 0x80000000;
  let p = 0;
  for (;;) {
    if (a & m) {
      p ^= b;
      if ((a & (m - 1)) === 0) break;
    }
    m >>>= 1;
    b = b & 1 ? (b >>> 1) ^ POLY : b >>> 1;
  }
  return p >>> 0;
}

const X2N = (() => {
  const table = new Uint32Array(32);
  let p = 0x40000000;
  table[0] = p;
  for (let n = 1; n < 32; n++) {
    p = multmodp(p, p);
    table[n] = p;
  }
  return table;
})();

function powerOfEight(length) {
  let p = 0x80000000;
  let k = 3;
  for (let n = length >>> 0; n > 0; n >>>= 1, k++) if (n & 1) p = multmodp(X2N[k & 31], p);
  return p >>> 0;
}

export function crcShift(crc, length) {
  return multmodp(powerOfEight(length), crc);
}

export function crcShiftOne(crc) {
  return ((crc >>> 8) ^ CRC_TABLE[crc & 0xff]) >>> 0;
}

export function crcCombine(first, second, secondLength) {
  return (crcShift(first, secondLength) ^ second) >>> 0;
}
