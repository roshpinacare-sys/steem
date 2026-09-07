import { describe, it, expect, beforeEach } from 'vitest';
import { GraduationEngine, STAGES } from '../lib/graduationEngine.js';

describe('GraduationEngine', () => {
  let engine;
  beforeEach(() => { engine = new GraduationEngine(); });

  it('starts every new user at stage 1 (USE)', () => {
    const { stageId, stageName } = engine.getStage('user::new');
    expect(stageId).toBe(1);
    expect(stageName).toBe('USE');
  });

  it('does not advance without completing requirements', () => {
    const result = engine.evaluate('user::a', { validationsCompleted: 0 });
    expect(result.advanced).toBe(false);
  });

  it('advances to VERIFY after first validation', () => {
    const result = engine.evaluate('user::b', { validationsCompleted: 1 });
    expect(result.advanced).toBe(true);
    expect(result.newStage.name).toBe('VERIFY');
    expect(result.bonusCredits).toBe(10);
  });

  it('advances to OWN after first patch authored', () => {
    engine.evaluate('user::c', { validationsCompleted: 1 });
    const result = engine.evaluate('user::c', { validationsCompleted: 1, patchesAuthored: 1 });
    expect(result.advanced).toBe(true);
    expect(result.newStage.name).toBe('OWN');
  });

  it('advances multiple stages in one evaluation if all requirements met', () => {
    const result = engine.evaluate('user::d', {
      validationsCompleted: 1, patchesAuthored: 1, referralsConverted: 1,
    });
    expect(result.advanced).toBe(true);
    expect(result.bonusCredits).toBeGreaterThan(10);
  });

  it('progressionReport shows next requirements', () => {
    const report = engine.progressionReport('user::e', { validationsCompleted: 0 });
    expect(report.currentStage.name).toBe('USE');
    expect(report.nextStage.name).toBe('VERIFY');
    expect(report.nextRequirements[0].metric).toBe('validationsCompleted');
  });

  it('allStages returns all 5 stages', () => {
    expect(GraduationEngine.allStages()).toHaveLength(5);
  });
});
