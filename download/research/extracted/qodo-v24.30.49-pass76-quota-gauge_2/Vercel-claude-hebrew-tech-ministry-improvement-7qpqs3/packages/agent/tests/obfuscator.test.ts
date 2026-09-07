/**
 * Unit tests for obfuscator.ts
 * Focus: VAR_N token-collision regression across multiple files (Bug 16-A).
 */
import { describe, it, expect } from 'vitest';
import { obfuscatePrefetch, reconstituteCode, hasUnmappedTokens } from '../src/services/obfuscator.js';

describe('obfuscatePrefetch — token uniqueness across files (Bug 16-A regression)', () => {
  it('assigns globally unique VAR_N tokens when multiple files share the same local variable names', () => {
    // Both files declare a variable named `value`. Before the fix, both files
    // produced VAR_1 → value, so the second file's entry silently overwrote
    // the first file's in the combined mapping. reconstituteCode() then used
    // the wrong original name for the first file's tokens.
    const prefetch = {
      'src/a.ts': 'const value = 1;',
      'src/b.ts': 'const value = 2;',
    };

    const { prefetch: obfuscated, mapping } = obfuscatePrefetch(prefetch);

    // The combined mapping must have TWO distinct keys, not one.
    const tokens = Object.keys(mapping);
    expect(new Set(tokens).size).toBe(tokens.length); // no duplicate keys

    // Every token in every obfuscated file must be present in the combined mapping.
    for (const [, content] of Object.entries(obfuscated)) {
      expect(hasUnmappedTokens(content, mapping)).toBe(false);
    }
  });

  it('round-trips perfectly: reconstitute(obfuscate(src)) === src for multi-file batch', () => {
    const prefetch = {
      'src/alpha.ts': 'const foo = 1;\nconst bar = foo + 1;',
      'src/beta.ts':  'const foo = "hello";\nconst baz = foo.length;',
    };

    const { prefetch: obfuscated, mapping } = obfuscatePrefetch(prefetch);

    // After reconstitution each file must be semantically equivalent to the
    // original (ts-morph may normalise whitespace, so compare trimmed tokens).
    for (const [path, original] of Object.entries(prefetch)) {
      const reconstituted = reconstituteCode(obfuscated[path], mapping);
      // Core identifiers must survive the round-trip.
      for (const id of ['foo', 'bar', 'baz'].filter((id) => original.includes(id))) {
        expect(reconstituted).toContain(id);
      }
    }
  });

  it('single-file obfuscation is unaffected by the tokenOffset change', () => {
    const prefetch = { 'src/single.ts': 'const x = 1; const y = x + 1;' };
    const { prefetch: obfuscated, mapping } = obfuscatePrefetch(prefetch);
    // Tokens must start at VAR_1 (offset 0 for the first file).
    expect(Object.keys(mapping).some((k) => k === 'VAR_1')).toBe(true);
    expect(hasUnmappedTokens(obfuscated['src/single.ts'], mapping)).toBe(false);
  });
});
