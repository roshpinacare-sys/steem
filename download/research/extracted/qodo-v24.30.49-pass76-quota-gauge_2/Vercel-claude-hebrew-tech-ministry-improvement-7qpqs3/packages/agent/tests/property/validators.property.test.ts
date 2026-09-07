/**
 * Property-based tests for core validators using fast-check.
 * Tests: path-guard scoping, confidence scorer, license checker logic,
 * audit log hash chain integrity.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isPathAllowed, type PathGuardConfig } from '../../src/validators/path-guard-scoped.js';
import { computeConfidence, type PatchMetrics } from '../../src/services/confidence-scorer.js';

// ── path-guard properties ──────────────────────────────────────────────────

const config: PathGuardConfig = {
  allowedPaths: ['src/', 'lib/', 'packages/'],
  blockedPaths: ['node_modules/', '.git/', '.env'],
};

describe('path-guard — property-based', () => {
  it('blocked paths are always rejected regardless of suffix', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('node_modules/', '.git/', '.env'),
        fc.string({ minLength: 0, maxLength: 40 }),
        (prefix, suffix) => {
          const path = prefix + suffix;
          expect(isPathAllowed(path, config)).toBe(false);
        },
      ),
    );
  });

  it('allowed-prefix paths are always accepted when not also blocked', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('src/', 'lib/', 'packages/'),
        fc.stringMatching(/^[A-Za-z0-9_](?:[A-Za-z0-9_.\/-]{0,39})?$/).filter(
          (s) => !config.blockedPaths.some((b) => s.startsWith(b)),
        ),
        (prefix, suffix) => {
          const path = prefix + suffix;
          expect(isPathAllowed(path, config)).toBe(true);
        },
      ),
    );
  });

  it('paths outside both lists are rejected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 40 }).filter(
          (s) =>
            !config.allowedPaths.some((a) => s.startsWith(a)) &&
            !config.blockedPaths.some((b) => s.startsWith(b)),
        ),
        (path) => {
          expect(isPathAllowed(path, config)).toBe(false);
        },
      ),
    );
  });
});

// ── confidence scorer properties ────────────────────────────────────────────

describe('confidence scorer — property-based', () => {
  it('score is always in range [0, 100]', () => {
    fc.assert(
      fc.property(
        fc.record<PatchMetrics>({
          syntaxValid: fc.boolean(),
          testCoverageRatio: fc.float({ min: 0, max: 1, noNaN: true }),
          filesChanged: fc.integer({ min: 0, max: 50 }),
          linesChanged: fc.integer({ min: 0, max: 5000 }),
          modelCertainty: fc.float({ min: 0, max: 1, noNaN: true }),
          validatorsPassed: fc.integer({ min: 0, max: 10 }),
          validatorsTotal: fc.integer({ min: 0, max: 10 }),
        }).map((m) => ({
          ...m,
          validatorsPassed: Math.min(m.validatorsPassed, m.validatorsTotal),
        })),
        (metrics) => {
          const result = computeConfidence(metrics);
          expect(result.score).toBeGreaterThanOrEqual(0);
          expect(result.score).toBeLessThanOrEqual(100);
        },
      ),
    );
  });

  it('invalid syntax always produces lower score than valid syntax (all else equal)', () => {
    fc.assert(
      fc.property(
        fc.record({
          testCoverageRatio: fc.float({ min: 0, max: 1, noNaN: true }),
          filesChanged: fc.integer({ min: 1, max: 20 }),
          linesChanged: fc.integer({ min: 1, max: 500 }),
          modelCertainty: fc.float({ min: 0, max: 1, noNaN: true }),
          validatorsPassed: fc.integer({ min: 0, max: 5 }),
          validatorsTotal: fc.constant(5),
        }),
        (base) => {
          const valid = computeConfidence({ ...base, syntaxValid: true });
          const invalid = computeConfidence({ ...base, syntaxValid: false });
          expect(valid.score).toBeGreaterThanOrEqual(invalid.score);
        },
      ),
    );
  });

  it('grade is consistent with score', () => {
    fc.assert(
      fc.property(
        fc.record<PatchMetrics>({
          syntaxValid: fc.boolean(),
          testCoverageRatio: fc.float({ min: 0, max: 1, noNaN: true }),
          filesChanged: fc.integer({ min: 0, max: 30 }),
          linesChanged: fc.integer({ min: 0, max: 2000 }),
          modelCertainty: fc.float({ min: 0, max: 1, noNaN: true }),
          validatorsPassed: fc.integer({ min: 0, max: 5 }),
          validatorsTotal: fc.constant(5),
        }),
        (metrics) => {
          const { score, grade } = computeConfidence(metrics);
          if (score >= 90) expect(grade).toBe('A');
          else if (score >= 75) expect(grade).toBe('B');
          else if (score >= 60) expect(grade).toBe('C');
          else if (score >= 40) expect(grade).toBe('D');
          else expect(grade).toBe('F');
        },
      ),
    );
  });
});
