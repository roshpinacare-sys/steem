/**
 * semanticSearch.test.js — V96
 * Unit tests for engine/lib/semanticSearch.js
 *
 * Tests the pure JS helpers that work without any DB or network:
 *   1. simpleTokenize — stop-word removal, lowercasing, punctuation strip
 *   2. _rankByTfIdf — cosine-TF similarity ranking, limit, minScore
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { simpleTokenize, _rankByTfIdf } = require('../lib/semanticSearch');

describe('semanticSearch: simpleTokenize', () => {
  it('lowercases, strips punctuation, and removes stop-words', () => {
    const tokens = simpleTokenize('The quick brown fox!');
    // "The" and "a" are stop-words; result should be lower-cased, no punctuation
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('The');
    expect(tokens).toContain('quick');
    expect(tokens).toContain('brown');
    expect(tokens).toContain('fox');
  });

  it('returns empty array for empty / whitespace-only input', () => {
    expect(simpleTokenize('')).toEqual([]);
    expect(simpleTokenize('   ')).toEqual([]);
    expect(simpleTokenize(null)).toEqual([]);
  });
});

describe('semanticSearch: _rankByTfIdf', () => {
  const rows = [
    { id: 'p1', patch_body: 'contract review legal NDA agreement clause', reuse_count: 10 },
    { id: 'p2', patch_body: 'invoice payment billing finance accounting',  reuse_count: 3  },
    { id: 'p3', patch_body: 'data privacy GDPR compliance regulations',    reuse_count: 7  },
  ];

  it('returns most relevant patch first for contract query', () => {
    const results = _rankByTfIdf('contract legal review', rows, 3, 0);
    expect(results.length).toBeGreaterThan(0);
    // p1 should rank highest — shares contract, legal, review tokens
    expect(results[0].patchId).toBe('p1');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('respects limit parameter', () => {
    const results = _rankByTfIdf('contract legal review', rows, 1, 0);
    expect(results).toHaveLength(1);
  });

  it('respects minScore parameter — filters low-similarity results', () => {
    // A very high minScore means only very similar items pass
    const results = _rankByTfIdf('completely unrelated xyz', rows, 5, 0.9);
    expect(results).toHaveLength(0);
  });

  it('returns results with required fields: patchId, score, preview, reuseCount', () => {
    const results = _rankByTfIdf('contract legal', rows, 5, 0);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty('patchId');
      expect(r).toHaveProperty('score');
      expect(r).toHaveProperty('preview');
      expect(r).toHaveProperty('reuseCount');
      expect(typeof r.score).toBe('number');
    }
  });

  it('returns empty array when no rows provided', () => {
    expect(_rankByTfIdf('contract', [], 5, 0)).toEqual([]);
  });
});
