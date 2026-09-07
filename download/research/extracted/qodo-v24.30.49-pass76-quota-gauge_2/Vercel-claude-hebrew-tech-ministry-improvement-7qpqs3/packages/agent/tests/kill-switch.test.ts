import { describe, it, expect } from 'vitest';
import { isHalted, assertNotHalted, PipelineHaltedError } from '../src/services/kill-switch.js';

describe('kill-switch', () => {
  it('is not halted when QODO_HALT is unset', () => {
    expect(isHalted({})).toBe(false);
    expect(() => assertNotHalted({})).not.toThrow();
  });

  it('is halted when QODO_HALT=true', () => {
    expect(isHalted({ QODO_HALT: 'true' })).toBe(true);
    expect(() => assertNotHalted({ QODO_HALT: 'true' })).toThrow(PipelineHaltedError);
  });

  it('is halted when QODO_HALT=1', () => {
    expect(isHalted({ QODO_HALT: '1' })).toBe(true);
  });

  it('includes the custom reason in the thrown error', () => {
    try {
      assertNotHalted({ QODO_HALT: 'true', QODO_HALT_REASON: 'incident-4821' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('incident-4821');
    }
  });

  it('ignores unrelated env values', () => {
    expect(isHalted({ QODO_HALT: 'false' } as any)).toBe(false);
  });
});
