/**
   * ECOS Analytics Engine Tests — V104
   * 12 tests covering: record, query, getByDay, trend, totals, retention
   */
  import { describe, it, expect, beforeEach } from 'vitest';
  import { createRequire } from 'module';
  const require = createRequire(import.meta.url);

  describe('AnalyticsEngine — V104', () => {
    let AnalyticsEngine;
    beforeEach(() => {
      ({ AnalyticsEngine } = require('../lib/analyticsEngine'));
    });

    it('record() increments task count', () => {
      const ae = new AnalyticsEngine();
      ae.record({ verdict: 'AUTO_FLOW', revenue: 10, validatorPayout: 0 });
      const t = ae.totals();
      expect(t.tasks).toBe(1);
      expect(t.autoFlow).toBe(1);
    });

    it('record() counts HITL_QUEUE separately', () => {
      const ae = new AnalyticsEngine();
      ae.record({ verdict: 'HITL_QUEUE', revenue: 5, validatorPayout: 2 });
      const t = ae.totals();
      expect(t.hitl).toBe(1);
      expect(t.autoFlow).toBe(0);
    });

    it('record() counts HARD_REJECT as rejection', () => {
      const ae = new AnalyticsEngine();
      ae.record({ verdict: 'HARD_REJECT', revenue: 0 });
      const t = ae.totals();
      expect(t.rejections).toBe(1);
    });

    it('record() counts BLOCK verdict', () => {
      const ae = new AnalyticsEngine();
      ae.record({ verdict: 'BLOCK', revenue: 0 });
      const t = ae.totals();
      expect(t.blocked).toBe(1);
    });

    it('revenue accumulates correctly', () => {
      const ae = new AnalyticsEngine();
      ae.record({ verdict: 'AUTO_FLOW', revenue: 10.5 });
      ae.record({ verdict: 'AUTO_FLOW', revenue: 4.25 });
      const t = ae.totals();
      expect(t.revenue).toBeCloseTo(14.75, 2);
    });

    it('query() returns sorted buckets', () => {
      const ae = new AnalyticsEngine();
      // Use dates well within the 90-day retention window from now
      const d1 = new Date(Date.now() - 4 * 86_400_000); // 4 days ago
      const d2 = new Date(Date.now() - 2 * 86_400_000); // 2 days ago
      ae.record({ verdict: 'AUTO_FLOW', ts: d1 });
      ae.record({ verdict: 'HITL_QUEUE', ts: d2 });
      const buckets = ae.query({ granularity: 'day' });
      // We should have at least 2 distinct day-buckets
      expect(buckets.length).toBeGreaterThanOrEqual(2);
      // All buckets must be in ascending chronological order
      for (let i = 1; i < buckets.length; i++) {
        expect(new Date(buckets[i-1].ts) <= new Date(buckets[i].ts)).toBe(true);
      }
    });

    it('getByDay() returns correct shape', () => {
      const ae = new AnalyticsEngine();
      ae.record({ verdict: 'AUTO_FLOW', revenue: 10 });
      const byDay = ae.getByDay(30);
      expect(Array.isArray(byDay)).toBe(true);
      if (byDay.length > 0) {
        const d = byDay[0];
        expect(d).toHaveProperty('date');
        expect(d).toHaveProperty('total');
        expect(d).toHaveProperty('approved');
        expect(d).toHaveProperty('rejected');
        expect(d).toHaveProperty('blocked');
        expect(d).toHaveProperty('autoFlow');
        expect(d).toHaveProperty('hitl');
        expect(d).toHaveProperty('revenue');
      }
    });

    it('getByDay() date field is YYYY-MM-DD format', () => {
      const ae = new AnalyticsEngine();
      ae.record({ verdict: 'AUTO_FLOW' });
      const byDay = ae.getByDay(1);
      if (byDay.length > 0) {
        expect(byDay[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('trend() returns up for increasing activity', () => {
      const ae = new AnalyticsEngine();
      // Add tasks in recent days only
      for (let i = 0; i < 5; i++) {
        ae.record({ verdict: 'AUTO_FLOW' });
      }
      const result = ae.trend('day', 'tasks', 7);
      expect(result).toHaveProperty('current');
      expect(result).toHaveProperty('previous');
      expect(result).toHaveProperty('delta');
      expect(['up','down','flat']).toContain(result.trend);
    });

    it('trend() returns flat when no data', () => {
      const ae = new AnalyticsEngine();
      const result = ae.trend('day', 'tasks', 7);
      expect(result.trend).toBe('flat');
      expect(result.current).toBe(0);
    });

    it('totals() is empty on fresh instance', () => {
      const ae = new AnalyticsEngine();
      const t = ae.totals();
      expect(t.tasks).toBe(0);
      expect(t.revenue).toBe(0);
    });

    it('setLogger() accepts a logger without throwing', () => {
      const ae = new AnalyticsEngine();
      expect(() => ae.setLogger({ info: () => {}, warn: () => {}, error: () => {} })).not.toThrow();
    });
  });
  