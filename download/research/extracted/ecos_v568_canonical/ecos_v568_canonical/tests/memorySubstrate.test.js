/**
   * ECOS Memory Substrate Tests — V104
   * 13 tests: ingest, retrieve, replay, batch, compaction, stats, cosine, heuristicEmbed
   */
  import { describe, it, expect } from 'vitest';
  import { createRequire } from 'module';
  const require = createRequire(import.meta.url);

  describe('MemorySubstrate — V104', () => {
    const { MemorySubstrate, cosine, heuristicEmbed, temporalScore } = require('../lib/memorySubstrate');

    it('cosine() returns 1 for identical vectors', () => {
      const v = [1, 0, 0];
      expect(cosine(v, v)).toBeCloseTo(1, 5);
    });

    it('cosine() returns 0 for orthogonal vectors', () => {
      expect(cosine([1,0,0],[0,1,0])).toBeCloseTo(0, 5);
    });

    it('cosine() returns 0 for null inputs', () => {
      expect(cosine(null, [1,2,3])).toBe(0);
    });

    it('heuristicEmbed() returns vector of correct length', () => {
      const v = heuristicEmbed('hello world', 64);
      expect(v.length).toBe(64);
    });

    it('heuristicEmbed() is deterministic', () => {
      const v1 = heuristicEmbed('test');
      const v2 = heuristicEmbed('test');
      expect(v1).toEqual(v2);
    });

    it('heuristicEmbed() different texts produce different vectors', () => {
      const v1 = heuristicEmbed('hello');
      const v2 = heuristicEmbed('world');
      expect(v1).not.toEqual(v2);
    });

    it('temporalScore() = 1 for just-created entries', () => {
      const score = temporalScore(new Date().toISOString());
      expect(score).toBeCloseTo(1, 1);
    });

    it('temporalScore() < 1 for old entries', () => {
      const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      expect(temporalScore(old)).toBeLessThan(1);
    });

    it('ingest() stores and retrieve() finds by semantic query', async () => {
      const m = new MemorySubstrate();
      await m.ingest({ scope: 'agent', ownerId: 'a1', content: 'ECOS economic ledger primitives', importance: 0.9 });
      const results = await m.retrieve({ query: 'ledger economics', scope: 'agent', ownerId: 'a1', topK: 5 });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('score');
      expect(results[0]).not.toHaveProperty('vector'); // vector stripped from result
    });

    it('retrieve() respects scope filter', async () => {
      const m = new MemorySubstrate();
      await m.ingest({ scope: 'agent',     ownerId: 'x', content: 'agent memory' });
      await m.ingest({ scope: 'workspace', ownerId: 'x', content: 'workspace memory' });
      const results = await m.retrieve({ query: 'memory', scope: 'agent', topK: 10 });
      expect(results.every(r => r.scope === 'agent')).toBe(true);
    });

    it('replay() returns chronological entries for ownerId', async () => {
      const m = new MemorySubstrate();
      await m.ingest({ scope: 'user', ownerId: 'u1', content: 'first event' });
      await m.ingest({ scope: 'user', ownerId: 'u1', content: 'second event' });
      const ep = m.replay({ ownerId: 'u1', limit: 10 });
      expect(ep.length).toBe(2);
      expect(new Date(ep[0].createdAt) <= new Date(ep[1].createdAt)).toBe(true);
    });

    it('ingestBatch() stores multiple entries', async () => {
      const m = new MemorySubstrate();
      const items = [
        { scope: 'global', ownerId: 'sys', content: 'item 1' },
        { scope: 'global', ownerId: 'sys', content: 'item 2' },
        { scope: 'global', ownerId: 'sys', content: 'item 3' },
      ];
      const results = await m.ingestBatch(items);
      expect(results.length).toBe(3);
      expect(m.stats().global).toBe(3);
    });

    it('stats() reflects stored counts per scope', async () => {
      const m = new MemorySubstrate();
      await m.ingest({ scope: 'agent', ownerId: 'a', content: 'x' });
      await m.ingest({ scope: 'user',  ownerId: 'u', content: 'y' });
      const s = m.stats();
      expect(s.agent).toBe(1);
      expect(s.user).toBe(1);
    });
  });
  