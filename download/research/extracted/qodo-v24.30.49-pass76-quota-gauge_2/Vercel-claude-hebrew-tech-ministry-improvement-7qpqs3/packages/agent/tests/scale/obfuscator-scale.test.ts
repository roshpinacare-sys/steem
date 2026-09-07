/**
 * OPT-IN SCALE SUITE — excluded from the default `vitest run` (see
 * vitest.config.ts). obfuscateCode() renames via ts-morph one declaration at
 * a time, which is quadratic in file size, so this file needs many minutes of
 * pure CPU. Run explicitly with:  npm run test:scale -w packages/agent
 * Tracked follow-up: single-pass scope-aware renamer to make this cheap.
 */
/**
 * Exhaustive scale tests for obfuscator.ts — task-19 (Pass 55).
 *
 * Goal: confirm the obfuscator's token-assignment scheme is free from
 * birthday-paradox-style collisions across a realistic large symbol corpus.
 * Pass 27 fixed a specific token-collision bug; this suite proves the
 * collision space remains closed at identifier counts far beyond the small
 * hand-written regression cases that triggered Pass 27.
 *
 * Key property under test — for any set of N declarations across one or more
 * files, the resulting mapping must satisfy:
 *
 *   (a) Forward injectivity  — all VAR_N token KEYS are distinct.
 *                              No two declarations share the same token.
 *   (b) Coverage             — every VAR_N token that appears in any
 *                              obfuscated file is present as a key in the
 *                              combined mapping (no orphan tokens).
 *
 * Note: backward injectivity (unique original-name VALUES across the whole
 * mapping) only holds for single-file corpora or multi-file batches where
 * every identifier has a globally unique name.  It must NOT be asserted when
 * multiple files intentionally declare the same local identifier names — in
 * that scenario each file legitimately produces a distinct VAR_N key that
 * maps back to the same original name, so the values repeat by design.
 *
 * No network access, no Redis, no file system required.
 */
import { describe, it, expect } from 'vitest';
import {
  obfuscateCode,
  obfuscatePrefetch,
  reconstituteCode,
  hasUnmappedTokens,
  type ObfuscationMapping,
} from '../../src/services/obfuscator.js';

// ---------------------------------------------------------------------------
// Corpus generators
// ---------------------------------------------------------------------------

/** Generate `count` distinct, valid TypeScript identifier names. */
function makeIdentifiers(count: number, prefix = 'sym'): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(`${prefix}_${String(i).padStart(6, '0')}`);
  }
  return ids;
}

/**
 * Build a syntactically valid TypeScript snippet that declares `count`
 * distinct variables as a flat `const` sequence.
 *
 * Example output for count=3:
 *   const sym_000000 = 0;
 *   const sym_000001 = sym_000000 + 1;
 *   const sym_000002 = sym_000001 + 1;
 */
function makeSnippet(count: number, prefix = 'sym'): string {
  const ids = makeIdentifiers(count, prefix);
  const lines: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (i === 0) {
      lines.push(`const ${ids[i]} = 0;`);
    } else {
      // Reference previous identifier so ts-morph sees a real usage.
      lines.push(`const ${ids[i]} = ${ids[i - 1]} + 1;`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Assert forward injectivity + well-formedness of a mapping.
 *
 * Checks:
 *   - All keys match /^VAR_\d+$/.
 *   - All token keys (VAR_N) are distinct — no forward collision.
 *   - Token count equals expectedCount.
 *
 * Does NOT assert that values (original names) are globally unique, because
 * that property only holds for single-file or globally-unique-name corpora.
 */
function assertForwardInjectivity(
  mapping: ObfuscationMapping,
  expectedCount: number,
  label: string,
): void {
  const tokens = Object.keys(mapping);

  // Every key must look like VAR_N.
  for (const token of tokens) {
    expect(token, `${label}: malformed token key`).toMatch(/^VAR_\d+$/);
  }

  // No duplicate token keys (forward injectivity).
  expect(
    new Set(tokens).size,
    `${label}: duplicate token keys (forward collision)`,
  ).toBe(tokens.length);

  // Token count must match expected declaration count.
  expect(
    tokens.length,
    `${label}: token count mismatch`,
  ).toBe(expectedCount);
}

/**
 * Assert backward injectivity: original-name VALUES are globally unique in
 * the mapping.  Valid only for single-file corpora or multi-file batches
 * where all identifiers across all files have globally unique names.
 */
function assertBackwardInjectivity(
  mapping: ObfuscationMapping,
  label: string,
): void {
  const originals = Object.values(mapping);
  expect(
    new Set(originals).size,
    `${label}: duplicate original-name values (backward collision)`,
  ).toBe(originals.length);
}

/**
 * Full bijectivity = forward injectivity + backward injectivity.
 * Only use when identifier names are globally unique across the entire corpus.
 */
function assertBijection(
  mapping: ObfuscationMapping,
  expectedCount: number,
  label: string,
): void {
  assertForwardInjectivity(mapping, expectedCount, label);
  assertBackwardInjectivity(mapping, label);
}

/**
 * Collect the set of distinct VAR_N tokens that appear in a string.
 * Used to verify per-file token ranges are disjoint across files.
 */
function collectTokenSet(content: string): Set<string> {
  const set = new Set<string>();
  const re = /\bVAR_\d+\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    set.add(m[0]);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Suite 1 — Single-file scale (1 000 identifiers)
// ---------------------------------------------------------------------------

describe('obfuscator scale — single file 1 000 identifiers', () => {
  const IDENTIFIER_COUNT = 1_000;
  const snippet = makeSnippet(IDENTIFIER_COUNT);
  let content: string;
  let mapping: ObfuscationMapping;

  it('obfuscates without error', () => {
    const result = obfuscateCode(snippet, 'src/scale-1k.ts');
    content = result.content;
    mapping = result.mapping;
    expect(content).toBeTruthy();
  });

  it('produces exactly 1 000 tokens', () => {
    expect(Object.keys(mapping).length).toBe(IDENTIFIER_COUNT);
  });

  it('mapping is fully bijective (forward + backward, globally unique names)', () => {
    assertBijection(mapping, IDENTIFIER_COUNT, '1k-single-file');
  });

  it('no unmapped tokens remain in the obfuscated file', () => {
    expect(hasUnmappedTokens(content, mapping)).toBe(false);
  });

  it('round-trips correctly: first and last identifiers survive reconstitution', () => {
    const ids = makeIdentifiers(IDENTIFIER_COUNT);
    const restored = reconstituteCode(content, mapping);
    expect(restored).toContain(ids[0]);
    expect(restored).toContain(ids[IDENTIFIER_COUNT - 1]);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Single-file birthday-paradox stress (5 000 identifiers)
// ---------------------------------------------------------------------------
describe('obfuscator scale — single file 5 000 identifiers (birthday-paradox)', () => {
  const IDENTIFIER_COUNT = 5_000;
  const snippet = makeSnippet(IDENTIFIER_COUNT, 'bp');
  let content: string;
  let mapping: ObfuscationMapping;

  it('obfuscates 5 000 identifiers without error', () => {
    const result = obfuscateCode(snippet, 'src/birthday-paradox.ts', 0);
    content = result.content;
    mapping = result.mapping;
    expect(content).toBeTruthy();
  });

  it('produces exactly 5 000 tokens', () => {
    expect(Object.keys(mapping).length).toBe(IDENTIFIER_COUNT);
  });

  it('all 5 000 token keys are globally unique — no birthday collision', () => {
    // Forward injectivity + backward injectivity: all identifiers are unique
    // within a single file, so both directions must hold.
    assertBijection(mapping, IDENTIFIER_COUNT, '5k-birthday-paradox');
  });

  it('no unmapped tokens at 5 000 scale', () => {
    expect(hasUnmappedTokens(content, mapping)).toBe(false);
  });

  it('token numbers are strictly distinct (no duplicates even if non-contiguous)', () => {
    const nums = Object.keys(mapping).map((k) => Number(k.replace('VAR_', '')));
    expect(new Set(nums).size).toBe(nums.length);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Multi-file scale: 10 files × 300 identifiers (3 000 total)
//
// Every file uses the SAME local identifier names — maximum forward-collision
// pressure on the tokenOffset accumulation logic.
//
// Each file's declaration of `shared_000000` legitimately maps to a DIFFERENT
// VAR_N token. Backward injectivity (unique original names across the combined
// mapping) does NOT hold here by design: 10 files each declaring `shared_000000`
// will produce 10 distinct VAR_N → "shared_000000" entries. We assert only:
//   1. All VAR_N keys are distinct (forward injectivity).
//   2. No file has unmapped tokens.
//   3. Token key ranges are disjoint across files (each VAR_K appears in
//      exactly one file's obfuscated content, confirming no cross-file reuse).
// ---------------------------------------------------------------------------
describe('obfuscator scale — multi-file 10 × 300 identifiers (3 000 total)', () => {
  const FILES = 10;
  const PER_FILE = 300;
  const TOTAL = FILES * PER_FILE;

  const prefetch: Record<string, string> = {};
  for (let f = 0; f < FILES; f++) {
    prefetch[`src/file${f}.ts`] = makeSnippet(PER_FILE, 'shared');
  }

  let obfuscated: Record<string, string>;
  let mapping: ObfuscationMapping;

  it('obfuscatePrefetch completes without error', () => {
    const result = obfuscatePrefetch(prefetch);
    obfuscated = result.prefetch;
    mapping = result.mapping;
    expect(obfuscated).toBeTruthy();
  });

  it('produces exactly 3 000 token keys in the combined mapping', () => {
    expect(Object.keys(mapping).length).toBe(TOTAL);
  });

  it('all 3 000 VAR_N keys are distinct (forward injectivity — no cross-file token collision)', () => {
    assertForwardInjectivity(mapping, TOTAL, '10-files-x-300');
  });

  it('every file has no unmapped tokens', () => {
    for (const [path, content] of Object.entries(obfuscated)) {
      expect(
        hasUnmappedTokens(content, mapping),
        `unmapped tokens found in ${path}`,
      ).toBe(false);
    }
  });

  it('token key ranges are disjoint across files: each VAR_K appears in exactly one file', () => {
    // Collect the SET of distinct VAR_K tokens per file.
    // Because our synthetic snippets have no cross-file imports, ts-morph only
    // renames identifiers within each file's own scope. A token assigned to
    // file A cannot appear in file B's obfuscated text.
    const perFileSets = Object.values(obfuscated).map(collectTokenSet);

    // Check pairwise intersection is empty for every pair (i, j).
    for (let i = 0; i < perFileSets.length; i++) {
      for (let j = i + 1; j < perFileSets.length; j++) {
        const intersection = [...perFileSets[i]].filter((t) => perFileSets[j].has(t));
        expect(
          intersection.length,
          `files ${i} and ${j} share tokens: ${intersection.slice(0, 3).join(', ')}`,
        ).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — Token-namespace collision at scale:
//            file pre-seeded with VAR_1 … VAR_500 as actual identifier names
// ---------------------------------------------------------------------------
describe('obfuscator scale — pre-existing VAR_N identifiers (500 pre-seeded)', () => {
  const PRE_SEEDED = 500;
  const ADDITIONAL = 200;

  function makeVarNSnippet(count: number): string {
    const lines: string[] = [];
    for (let i = 1; i <= count; i++) {
      lines.push(i === 1 ? `const VAR_${i} = 0;` : `const VAR_${i} = VAR_${i - 1} + 1;`);
    }
    for (let i = 0; i < ADDITIONAL; i++) {
      lines.push(`const extra_${String(i).padStart(4, '0')} = ${i};`);
    }
    return lines.join('\n');
  }

  const snippet = makeVarNSnippet(PRE_SEEDED);
  let content: string;
  let mapping: ObfuscationMapping;

  it('obfuscates without error', () => {
    const result = obfuscateCode(snippet, 'src/pre-seeded.ts');
    content = result.content;
    mapping = result.mapping;
    expect(content).toBeTruthy();
  });

  it('all VAR_N token keys are distinct — no new token collides with pre-existing VAR_N names', () => {
    const tokens = Object.keys(mapping);
    const tokenNums = tokens.map((t) => Number(t.replace('VAR_', '')));
    expect(new Set(tokenNums).size).toBe(tokenNums.length);
  });

  it('new tokens start above the highest pre-existing VAR_N (existingTokenOffset respected)', () => {
    const tokenNums = Object.keys(mapping).map((t) => Number(t.replace('VAR_', '')));
    const max = Math.max(...tokenNums);
    expect(max).toBeGreaterThan(PRE_SEEDED);
  });

  it('no unmapped tokens after obfuscation', () => {
    expect(hasUnmappedTokens(content, mapping)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — Multi-file with growing identifier counts per file
//            (globally unique names across files — full bijection valid)
// ---------------------------------------------------------------------------
describe('obfuscator scale — multi-file with growing per-file corpus sizes', () => {
  // 5 files: 100, 200, 400, 800, 1 600 identifiers — total 3 100.
  // Each file uses a unique per-file prefix so all names are globally unique.
  const sizes = [100, 200, 400, 800, 1_600];
  const total = sizes.reduce((a, b) => a + b, 0);

  const prefetch: Record<string, string> = {};
  sizes.forEach((n, i) => {
    prefetch[`src/tier${i}.ts`] = makeSnippet(n, `tier${i}_id`);
  });

  let obfuscated: Record<string, string>;
  let mapping: ObfuscationMapping;

  it('obfuscatePrefetch handles variable-size files without error', () => {
    const result = obfuscatePrefetch(prefetch);
    obfuscated = result.prefetch;
    mapping = result.mapping;
    expect(obfuscated).toBeTruthy();
  });

  it(`produces exactly ${total} tokens across all files`, () => {
    expect(Object.keys(mapping).length).toBe(total);
  });

  it('full bijection holds (globally unique names across all files)', () => {
    // Each file uses a distinct prefix (tier0_id, tier1_id, …), so
    // original names are globally unique — backward injectivity is valid.
    assertBijection(mapping, total, 'heterogeneous-sizes');
  });

  it('every file in the batch has no unmapped tokens', () => {
    for (const [path, content] of Object.entries(obfuscated)) {
      expect(
        hasUnmappedTokens(content, mapping),
        `unmapped tokens in ${path}`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 6 — Cross-file identifier sharing at scale (same names across 20 files)
//
// Same structure as Suite 3: shared local names → forward injectivity only.
// ---------------------------------------------------------------------------
describe('obfuscator scale — 20 files sharing 150 identical local names', () => {
  const FILES = 20;
  const PER_FILE = 150;
  const TOTAL = FILES * PER_FILE;

  const prefetch: Record<string, string> = {};
  for (let f = 0; f < FILES; f++) {
    prefetch[`src/shared${f}.ts`] = makeSnippet(PER_FILE, 'common');
  }

  let obfuscated: Record<string, string>;
  let mapping: ObfuscationMapping;

  it('handles 20-file batch with 3 000 colliding local names', () => {
    const result = obfuscatePrefetch(prefetch);
    obfuscated = result.prefetch;
    mapping = result.mapping;
    expect(obfuscated).toBeTruthy();
  });

  it(`combined mapping has exactly ${TOTAL} distinct token keys`, () => {
    assertForwardInjectivity(mapping, TOTAL, '20-files-x-150-shared');
  });

  it('token key ranges are disjoint across all 20 files', () => {
    const perFileSets = Object.values(obfuscated).map(collectTokenSet);
    for (let i = 0; i < perFileSets.length; i++) {
      for (let j = i + 1; j < perFileSets.length; j++) {
        const intersection = [...perFileSets[i]].filter((t) => perFileSets[j].has(t));
        expect(
          intersection.length,
          `files ${i} and ${j} share tokens: ${intersection.slice(0, 3).join(', ')}`,
        ).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 7 — tokenOffset parameter isolation
// ---------------------------------------------------------------------------
describe('obfuscator scale — tokenOffset isolation at high values', () => {
  it('tokenOffset=10 000 correctly starts numbering above 10 000', () => {
    const snippet = makeSnippet(5, 'offset');
    const { mapping } = obfuscateCode(snippet, 'src/offset.ts', 10_000);
    const nums = Object.keys(mapping).map((t) => Number(t.replace('VAR_', '')));
    nums.sort((a, b) => a - b);
    expect(nums[0]).toBeGreaterThan(10_000);
  });

  it('two sequential obfuscateCode calls with chained offsets produce disjoint token sets', () => {
    const s1 = makeSnippet(50, 'chainA');
    const r1 = obfuscateCode(s1, 'src/chain-a.ts', 0);
    const offset1 = Object.keys(r1.mapping).length;

    const s2 = makeSnippet(50, 'chainB');
    const r2 = obfuscateCode(s2, 'src/chain-b.ts', offset1);

    const set1 = new Set(Object.keys(r1.mapping));
    const set2 = new Set(Object.keys(r2.mapping));
    const intersection = [...set1].filter((t) => set2.has(t));
    expect(intersection.length).toBe(0);
  });

  it('very high tokenOffset does not produce infinite or NaN labels', () => {
    const snippet = makeSnippet(3, 'big');
    const HIGH_OFFSET = 999_900;
    const { mapping } = obfuscateCode(snippet, 'src/big-offset.ts', HIGH_OFFSET);
    const nums = Object.keys(mapping).map((t) => Number(t.replace('VAR_', '')));
    expect(nums.every((n) => Number.isFinite(n) && n > HIGH_OFFSET)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 8 — reconstituteCode prefix-collision safety at scale
// ---------------------------------------------------------------------------
describe('obfuscator scale — reconstituteCode prefix-collision safety at scale', () => {
  it('reconstitutes a 1 000-token batch without prefix corruption', () => {
    // Canonical prefix-collision regression: with tokens VAR_1, VAR_10, VAR_100,
    // VAR_1000, naive left-to-right substitution corrupts VAR_100 and VAR_1000.
    // Longest-first sort in reconstituteCode must prevent this at scale.
    const snippet = makeSnippet(1_000, 'pfx');
    const { content, mapping } = obfuscateCode(snippet, 'src/prefix.ts');
    const restored = reconstituteCode(content, mapping);

    // No raw VAR_N tokens should remain after reconstitution.
    expect(/\bVAR_\d+\b/.test(restored)).toBe(false);

    // First, 10th, 100th, and 1000th identifiers (prefix-collision boundary cases).
    const ids = makeIdentifiers(1_000, 'pfx');
    for (const id of [ids[0], ids[9], ids[99], ids[999]]) {
      expect(restored).toContain(id);
    }
  });

  it('reconstitutes multi-file 3 000-token batch without any VAR_N survivors', () => {
    const prefetch: Record<string, string> = {};
    for (let f = 0; f < 10; f++) {
      prefetch[`src/recon${f}.ts`] = makeSnippet(300, `rc${f}`);
    }
    const { prefetch: obfuscated, mapping } = obfuscatePrefetch(prefetch);

    for (const [path, content] of Object.entries(obfuscated)) {
      const restored = reconstituteCode(content, mapping);
      expect(
        /\bVAR_\d+\b/.test(restored),
        `raw VAR_N token surviving reconstitution in ${path}`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 9 — Edge cases at scale boundary
// ---------------------------------------------------------------------------
describe('obfuscator scale — edge cases near realistic corpus boundaries', () => {
  it('zero-identifier file contributes no tokens and does not perturb offset', () => {
    const prefetch = {
      'src/empty.ts': '// no declarations here',
      'src/real.ts': makeSnippet(10, 'edge'),
    };
    const { prefetch: obfuscated, mapping } = obfuscatePrefetch(prefetch);
    expect(Object.keys(mapping).length).toBe(10);
    expect(hasUnmappedTokens(obfuscated['src/empty.ts'], mapping)).toBe(false);
    expect(hasUnmappedTokens(obfuscated['src/real.ts'], mapping)).toBe(false);
  });

  it('single-identifier file maps fully bijectively', () => {
    const { content, mapping } = obfuscateCode('const lonely = 42;', 'src/one.ts');
    assertBijection(mapping, 1, 'single-identifier');
    expect(hasUnmappedTokens(content, mapping)).toBe(false);
  });

  it('file with 2 000 identifiers all sharing the same prefix has no forward collision', () => {
    const snippet = makeSnippet(2_000, 'pfxClash');
    const { content, mapping } = obfuscateCode(snippet, 'src/pfx-clash.ts');
    assertForwardInjectivity(mapping, 2_000, '2k-common-prefix');
    assertBackwardInjectivity(mapping, '2k-common-prefix'); // names are unique in single file
    expect(hasUnmappedTokens(content, mapping)).toBe(false);
  });
});
