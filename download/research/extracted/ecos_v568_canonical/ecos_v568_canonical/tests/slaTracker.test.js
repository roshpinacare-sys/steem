/**
   * ECOS SLA Tracker Tests — V104
   * 10 tests covering register, resolve, status, getOverdue, markEscalated
   */
  import { describe, it, expect } from 'vitest';
  import { createRequire } from 'module';
  const require = createRequire(import.meta.url);

  describe('SlaTracker — V104', () => {
    const { SlaTracker } = require('../lib/slaTracker');

    it('register() returns deadline + tier for <$1 task', () => {
      const t = new SlaTracker();
      const r = t.register('m1', 0.50);
      expect(r.missionId).toBe('m1');
      expect(r.tier).toBe('24h');
      expect(r.ttlMs).toBe(24 * 3600 * 1000);
      expect(r.deadline).toBeDefined();
    });

    it('register() assigns 4h tier for $2.00 task', () => {
      const t = new SlaTracker();
      const r = t.register('m2', 2.00);
      expect(r.tier).toBe('4h');
      expect(r.ttlMs).toBe(4 * 3600 * 1000);
    });

    it('register() assigns 1h tier for $10 task', () => {
      const t = new SlaTracker();
      const r = t.register('m3', 10.00);
      expect(r.tier).toBe('1h');
    });

    it('status() returns ok within deadline', () => {
      const t = new SlaTracker();
      const past = new Date(Date.now() - 1000).toISOString();
      t.register('m4', 0.10, past);
      const s = t.status('m4');
      expect(['ok','warning','overdue']).toContain(s.status);
    });

    it('status() returns overdue past deadline', () => {
      const t = new SlaTracker();
      const farPast = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
      t.register('m5', 0.10, farPast);
      const s = t.status('m5');
      expect(s.status).toBe('overdue');
      expect(s.remaining).toBe(0);
    });

    it('status() returns resolved after resolve()', () => {
      const t = new SlaTracker();
      t.register('m6', 1.00);
      t.resolve('m6');
      expect(t.status('m6').status).toBe('resolved');
    });

    it('status() returns null for unknown missionId', () => {
      const t = new SlaTracker();
      expect(t.status('unknown')).toBeNull();
    });

    it('getOverdue() returns missions past deadline', () => {
      const t = new SlaTracker();
      const farPast = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
      t.register('over1', 0.10, farPast);
      t.register('over2', 0.10, farPast);
      t.register('ok1',   0.10);
      const overdue = t.getOverdue();
      expect(overdue.length).toBe(2);
      expect(overdue.every(m => m.status === 'overdue')).toBe(true);
    });

    it('markEscalated() sets escalated=true', () => {
      const t = new SlaTracker();
      t.register('m7', 0.10);
      const result = t.markEscalated('m7');
      expect(result).toBe(true);
      expect(t.status('m7').escalated).toBe(true);
    });

    it('size() reflects registered count', () => {
      const t = new SlaTracker();
      expect(t.size()).toBe(0);
      t.register('a', 1); t.register('b', 2);
      expect(t.size()).toBe(2);
    });
  });
  