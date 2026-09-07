/**
 * STRESS TEST: Confidence scorer throughput — 1000 parallel evaluations.
 * Simulates 1000 patches arriving simultaneously for scoring.
 * Verifies: pure-function safety, correct output ranges, no NaN/undefined.
 */
import { describe, it, expect } from 'vitest';
import { computeConfidence, type PatchMetrics } from '../../src/services/confidence-scorer.js';

const CONCURRENCY = 1000;

function randomMetrics(): PatchMetrics {
  const total = Math.floor(Math.random() * 10);
  return {
    syntaxValid: Math.random() > 0.3,
    testCoverageRatio: Math.random(),
    filesChanged: Math.floor(Math.random() * 30),
    linesChanged: Math.floor(Math.random() * 500),
    modelCertainty: Math.random(),
    validatorsPassed: Math.floor(Math.random() * (total + 1)),
    validatorsTotal: total,
  };
}

describe('confidence-scorer — 1000-concurrent throughput stress', () => {
  it('scores 1000 patches in parallel without NaN or out-of-range', async () => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        Promise.resolve(computeConfidence(randomMetrics())),
      ),
    );

    expect(results).toHaveLength(CONCURRENCY);
    for (const r of results) {
      expect(r.score).not.toBeNaN();
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(['A', 'B', 'C', 'D', 'F']).toContain(r.grade);
      expect(typeof r.breakdown).toBe('object');
    }
  });

  it('handles 1000 worst-case patches (0 on everything)', async () => {
    const worst: PatchMetrics = {
      syntaxValid: false, testCoverageRatio: 0, filesChanged: 50,
      linesChanged: 9999, modelCertainty: 0, validatorsPassed: 0, validatorsTotal: 10,
    };
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => Promise.resolve(computeConfidence(worst))),
    );
    for (const r of results) {
      expect(r.score).toBe(0);
      expect(r.grade).toBe('F');
    }
  });

  it('handles 1000 perfect patches (1.0 on everything)', async () => {
    const perfect: PatchMetrics = {
      syntaxValid: true, testCoverageRatio: 1, filesChanged: 1,
      linesChanged: 5, modelCertainty: 1, validatorsPassed: 10, validatorsTotal: 10,
    };
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => Promise.resolve(computeConfidence(perfect))),
    );
    for (const r of results) {
      expect(r.score).toBe(100);
      expect(r.grade).toBe('A');
    }
  });

  it('sum of breakdown always equals reported score', async () => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        Promise.resolve(computeConfidence(randomMetrics())),
      ),
    );
    for (const r of results) {
      const sum = Math.round(Object.values(r.breakdown).reduce((a, b) => a + b, 0));
      expect(sum).toBe(r.score);
    }
  });

  it('deterministic: same input always produces same output', () => {
    const fixed: PatchMetrics = {
      syntaxValid: true, testCoverageRatio: 0.7, filesChanged: 3,
      linesChanged: 100, modelCertainty: 0.8, validatorsPassed: 4, validatorsTotal: 5,
    };
    const first = computeConfidence(fixed);
    for (let i = 0; i < 500; i++) {
      const r = computeConfidence(fixed);
      expect(r.score).toBe(first.score);
      expect(r.grade).toBe(first.grade);
    }
  });
});
