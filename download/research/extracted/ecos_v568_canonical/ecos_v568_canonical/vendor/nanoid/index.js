/**
 * vendor/nanoid — Pure-JS, zero-dependency vendored implementation of nanoid.
 *
 * API-compatible with nanoid v3/v4 (CommonJS):
 *   - nanoid(size?)          → URL-safe random string (default size 21)
 *   - customAlphabet(alpha, size?) → factory that returns a generator function
 *
 * Uses node:crypto.randomFillSync for cryptographically strong randomness.
 * No external dependencies. Suitable for offline / air-gapped environments.
 *
 * @version 1.0.0 (ECOS vendor bundle)
 */
'use strict';

const { randomFillSync } = require('node:crypto');

const URL_ALPHABET =
  'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

/**
 * Generate a random string using the given alphabet.
 *
 * @param {string} alphabet - Characters to draw from.
 * @param {number} size     - Length of the output string.
 * @returns {string}
 */
function generate(alphabet, size) {
  const mask = (2 << (31 - Math.clz32((alphabet.length - 1) | 1))) - 1;
  const step = Math.ceil((1.6 * mask * size) / alphabet.length);
  let id = '';
  while (id.length < size) {
    const bytes = randomFillSync(Buffer.allocUnsafe(step));
    for (let i = 0; i < step && id.length < size; i++) {
      const byte = bytes[i] & mask;
      if (byte < alphabet.length) {
        id += alphabet[byte];
      }
    }
  }
  return id;
}

/**
 * Generate a URL-safe, cryptographically random string.
 *
 * @param {number} [size=21] - Length of the ID.
 * @returns {string}
 */
function nanoid(size = 21) {
  return generate(URL_ALPHABET, size);
}

/**
 * Create a custom ID generator using a specific alphabet.
 *
 * @param {string} alphabet  - Characters to draw from.
 * @param {number} [defaultSize=21] - Default length if none passed to generator.
 * @returns {function(size?: number): string}
 */
function customAlphabet(alphabet, defaultSize = 21) {
  return function (size = defaultSize) {
    return generate(alphabet, size);
  };
}

module.exports = { nanoid, customAlphabet, generate };
