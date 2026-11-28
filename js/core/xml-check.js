import { strictWellFormed } from './xml-strict.js';

export function makeWellFormed(fallback, stats = null) {
  return async (text) => {
    const verdict = strictWellFormed(text);
    if (verdict !== null) {
      if (stats !== null) stats.strict++;
      return verdict.ok;
    }
    if (stats !== null) stats.fallback++;
    return fallback(text);
  };
}
