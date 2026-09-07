/**
 * Confidence Scorer — produces a 0–100 score for every AI-generated patch.
 * Factors: syntax validity, test coverage delta, blast radius, model certainty.
 */
import { log as logger } from './logger.js';

export interface PatchMetrics {
  // 0-1: did the patch pass syntax check?
  syntaxValid: boolean;
  // 0-1: ratio of test-covered lines in changed files (0 if unknown)
  testCoverageRatio: number;
  // number of files changed
  filesChanged: number;
  // lines added + removed
  linesChanged: number;
  // 0-1: model's own logprob-derived certainty (pass 0 if unavailable)
  modelCertainty: number;
  // number of validators that passed (0-N)
  validatorsPassed: number;
  // total validators run
  validatorsTotal: number;
}

export interface ConfidenceResult {
  score: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: Record<string, number>;
}

const WEIGHTS = {
  syntax: 30,
  coverage: 20,
  blastRadius: 15,
  modelCertainty: 20,
  validators: 15,
};

function gradeFromScore(score: number): ConfidenceResult['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function computeConfidence(patch: PatchMetrics): ConfidenceResult {
  // syntax: full points if valid
  const syntaxScore = patch.syntaxValid ? 1.0 : 0.0;

  // coverage: linear 0-1
  const coverageScore = Math.min(1, patch.testCoverageRatio);

  // blast radius: penalize large changes
  // 0 or 1 file → 1.0, > 20 files → 0.
  // Clamp to [0, 1]: when filesChanged = 0, (0 - 1) / 20 = -0.05 gives
  // 1.05 without the upper clamp, which inflates score above 100.
  const blastScore = Math.max(0, Math.min(1, 1 - (patch.filesChanged - 1) / 20));

  // model certainty: pass-through
  const certaintyScore = Math.min(1, Math.max(0, patch.modelCertainty));

  // validators: ratio passed
  const validatorScore = patch.validatorsTotal > 0
    ? patch.validatorsPassed / patch.validatorsTotal
    : 1.0;

  const breakdown = {
    syntax: syntaxScore * WEIGHTS.syntax,
    coverage: coverageScore * WEIGHTS.coverage,
    blastRadius: blastScore * WEIGHTS.blastRadius,
    modelCertainty: certaintyScore * WEIGHTS.modelCertainty,
    validators: validatorScore * WEIGHTS.validators,
  };

  const score = Math.round(
    Object.values(breakdown).reduce((a, b) => a + b, 0),
  );

  const result: ConfidenceResult = { score, grade: gradeFromScore(score), breakdown };
  logger.info('Confidence score computed', { ...result });
  return result;
}
