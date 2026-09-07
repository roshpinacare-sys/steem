/**
   * ECOS Intelligence Registry Tests — V104
   * 12 tests covering: register, unregister, listProviders, infer (fallback),
   * policy routing, token accounting, trace log, embed/moderate delegation
   */
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { createRequire } from 'module';
  const require = createRequire(import.meta.url);

  describe('IntelligenceRegistry — V104', () => {
    const { IntelligenceRegistry, CAPABILITIES, ROUTING_POLICIES } = require('../lib/intelligenceRegistry');

    const makeProvider = (id, { caps, cost = 0 } = {}) => ({
      id,
      capabilities: caps || [CAPABILITIES.INFER],
      costPerToken: cost,
      infer: async () => ({ output: { result: `ok-${id}` }, confidence: 0.8, latencyMs: 10, provider: id, tokens: 100 }),
      embed: async () => ({ vector: [0.1, 0.2], provider: id, dimensions: 2 }),
      moderate: async () => ({ safe: true, flags: [], provider: id }),
      tokenize: (t) => ({ tokens: Math.ceil(t.length / 4), provider: id }),
      estimate: (t) => ({ costUsd: cost * Math.ceil(t.length / 4), tokens: Math.ceil(t.length / 4), provider: id }),
    });

    it('register() + listProviders() returns entry', () => {
      const reg = new IntelligenceRegistry();
      reg.register(makeProvider('p1'), 10);
      const list = reg.listProviders();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe('p1');
      expect(list[0].priority).toBe(10);
    });

    it('unregister() removes provider', () => {
      const reg = new IntelligenceRegistry();
      reg.register(makeProvider('p2'));
      reg.unregister('p2');
      expect(reg.listProviders().length).toBe(0);
    });

    it('infer() returns result from registered provider', async () => {
      const reg = new IntelligenceRegistry();
      reg.register(makeProvider('p3'));
      const r = await reg.infer('sys', 'user');
      expect(r.output).toEqual({ result: 'ok-p3' });
      expect(r.confidence).toBe(0.8);
      expect(r._trace.provider).toBe('p3');
    });

    it('infer() cascades to next provider on failure', async () => {
      const reg  = new IntelligenceRegistry();
      const fail = { ...makeProvider('fail'), infer: async () => { throw new Error('timeout'); } };
      const ok   = makeProvider('ok');
      reg.register(fail, 20);
      reg.register(ok,    10);
      const r = await reg.infer('sys', 'user');
      expect(r._trace.provider).toBe('ok');
    });

    it('infer() throws when all providers fail', async () => {
      const reg  = new IntelligenceRegistry();
      const bad  = { ...makeProvider('bad'), infer: async () => { throw new Error('dead'); } };
      reg.register(bad);
      await expect(reg.infer('sys', 'user')).rejects.toThrow('All intelligence providers failed');
    });

    it('infer() throws with no providers registered', async () => {
      const reg = new IntelligenceRegistry();
      await expect(reg.infer('sys', 'user')).rejects.toThrow('No inference provider');
    });

    it('setPolicy() accepts valid policies', () => {
      const reg = new IntelligenceRegistry();
      expect(() => reg.setPolicy(ROUTING_POLICIES.LATENCY)).not.toThrow();
      expect(() => reg.setPolicy(ROUTING_POLICIES.COST)).not.toThrow();
      expect(() => reg.setPolicy(ROUTING_POLICIES.CONFIDENCE)).not.toThrow();
      expect(() => reg.setPolicy(ROUTING_POLICIES.PRIMARY)).not.toThrow();
    });

    it('setPolicy() rejects invalid policy', () => {
      const reg = new IntelligenceRegistry();
      expect(() => reg.setPolicy('unknown_policy')).toThrow('Unknown policy');
    });

    it('accountingReport() contains stats after infer', async () => {
      const reg = new IntelligenceRegistry();
      reg.register(makeProvider('acct'));
      await reg.infer('sys', 'user');
      const report = reg.accountingReport();
      expect(report.length).toBe(1);
      expect(report[0].id).toBe('acct');
      expect(report[0].calls).toBe(1);
      expect(report[0].totalTokens).toBe(100);
    });

    it('getTraces() returns trace after infer', async () => {
      const reg = new IntelligenceRegistry();
      reg.register(makeProvider('traced'));
      await reg.infer('sys', 'user');
      const traces = reg.getTraces();
      expect(traces.length).toBeGreaterThan(0);
      expect(traces[0].op).toBe('infer');
      expect(traces[0].ok).toBe(true);
    });

    it('embed() delegates to provider', async () => {
      const reg = new IntelligenceRegistry();
      reg.register(makeProvider('emb', { caps: [CAPABILITIES.INFER, CAPABILITIES.EMBED] }));
      const r = await reg.embed('hello');
      expect(r.dimensions).toBe(2);
    });

    it('COST policy selects cheapest provider', async () => {
      const reg = new IntelligenceRegistry();
      reg.setPolicy(ROUTING_POLICIES.COST);
      reg.register(makeProvider('cheap', { cost: 0.0001 }), 5);
      reg.register(makeProvider('expensive', { cost: 0.01 }), 10);
      const r = await reg.infer('sys', 'user');
      expect(r._trace.provider).toBe('cheap');
    });
  });
  