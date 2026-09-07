/**
 * Snapshot tests for AI-generated patch outputs.
 * Run `vitest -u` to update snapshots after intentional model changes.
 */
import { describe, it, expect } from 'vitest';
import { computeConfidence } from '../../src/services/confidence-scorer.js';

describe('confidence scorer — blastScore boundary (Bug 15-D regression)', () => {
  it('score never exceeds 100 when filesChanged is 0', () => {
    // blastScore formula was `Math.max(0, 1 - (filesChanged - 1) / 20)`.
    // For filesChanged = 0: 1 - (-1/20) = 1.05 → score could reach 101.
    const result = computeConfidence({
      syntaxValid: true,
      testCoverageRatio: 1.0,
      filesChanged: 0,   // trigger the boundary case
      linesChanged: 0,
      modelCertainty: 1.0,
      validatorsPassed: 5,
      validatorsTotal: 5,
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('score stays within [0, 100] across all edge-case filesChanged values', () => {
    for (const filesChanged of [0, 1, 20, 21, 100]) {
      const result = computeConfidence({
        syntaxValid: true,
        testCoverageRatio: 1.0,
        filesChanged,
        linesChanged: 10,
        modelCertainty: 1.0,
        validatorsPassed: 5,
        validatorsTotal: 5,
      });
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.score).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('confidence scorer — snapshot', () => {
  it('perfect patch snapshot', () => {
    const result = computeConfidence({
      syntaxValid: true,
      testCoverageRatio: 1.0,
      filesChanged: 1,
      linesChanged: 20,
      modelCertainty: 0.95,
      validatorsPassed: 5,
      validatorsTotal: 5,
    });
    expect(result).toMatchSnapshot();
  });

  it('failing patch snapshot', () => {
    const result = computeConfidence({
      syntaxValid: false,
      testCoverageRatio: 0,
      filesChanged: 25,
      linesChanged: 1200,
      modelCertainty: 0.1,
      validatorsPassed: 1,
      validatorsTotal: 5,
    });
    expect(result).toMatchSnapshot();
  });

  it('average patch snapshot', () => {
    const result = computeConfidence({
      syntaxValid: true,
      testCoverageRatio: 0.65,
      filesChanged: 5,
      linesChanged: 150,
      modelCertainty: 0.7,
      validatorsPassed: 3,
      validatorsTotal: 5,
    });
    expect(result).toMatchSnapshot();
  });
});
