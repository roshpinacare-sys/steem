/**
   * ECOS Task Escalation Tests — V104
   * 8 tests covering constructor, escalateManual, _sweep, getEscalations, isEscalated
   */
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { createRequire } from 'module';
  const require = createRequire(import.meta.url);

  afterEach(() => vi.restoreAllMocks());

  describe('TaskEscalation — V104', () => {
    const { TaskEscalation } = require('../lib/taskEscalation');
    const { SlaTracker }      = require('../lib/slaTracker');

    it('throws without slaTracker', () => {
      expect(() => new TaskEscalation(null)).toThrow('slaTracker is required');
    });

    it('escalateManual() returns an escalation record', () => {
      const sla = new SlaTracker();
      sla.register('mx', 1.00);
      const te  = new TaskEscalation(sla);
      const rec = te.escalateManual('mx', { reason: 'test' });
      expect(rec).not.toBeNull();
      expect(rec.missionId).toBe('mx');
      expect(rec.reason).toBe('manual');
      expect(rec.id).toBeDefined();
    });

    it('escalateManual() returns null on second call (idempotent)', () => {
      const sla = new SlaTracker();
      sla.register('m1', 1.00);
      const te = new TaskEscalation(sla);
      te.escalateManual('m1');
      expect(te.escalateManual('m1')).toBeNull();
    });

    it('isEscalated() returns true after manual escalation', () => {
      const sla = new SlaTracker();
      sla.register('m2', 1.00);
      const te = new TaskEscalation(sla);
      expect(te.isEscalated('m2')).toBe(false);
      te.escalateManual('m2');
      expect(te.isEscalated('m2')).toBe(true);
    });

    it('getEscalations() returns all escalations', () => {
      const sla = new SlaTracker();
      sla.register('e1', 1); sla.register('e2', 1);
      const te = new TaskEscalation(sla);
      te.escalateManual('e1'); te.escalateManual('e2');
      expect(te.getEscalations().length).toBe(2);
    });

    it('onEscalate callback is fired', () => {
      const sla = new SlaTracker();
      sla.register('cb1', 1.00);
      const fired = [];
      const te = new TaskEscalation(sla, { onEscalate: r => fired.push(r) });
      te.escalateManual('cb1');
      expect(fired.length).toBe(1);
      expect(fired[0].missionId).toBe('cb1');
    });

    it('count() reflects total escalations', () => {
      const sla = new SlaTracker();
      sla.register('c1', 1); sla.register('c2', 1);
      const te = new TaskEscalation(sla);
      te.escalateManual('c1'); te.escalateManual('c2');
      expect(te.count()).toBe(2);
    });

    it('start() + stop() do not throw', () => {
      const sla = new SlaTracker();
      const te  = new TaskEscalation(sla, { checkIntervalMs: 1000 });
      expect(() => { te.start(); te.stop(); }).not.toThrow();
    });
  });
  