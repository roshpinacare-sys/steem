/**
 * TFA Evolution Studio v28 — Self-Evolution
 *
 * Per-cycle self-evaluation scoring and trend tracking.
 */

export interface SelfEvalResult {
  cycleId: string;
  planningQuality: number;
  executionQuality: number;
  verificationCoverage: number;
  overallScore: number;
  timestamp: string;
}

const evaluations: SelfEvalResult[] = [];

export function evaluateCycle(cycleId: string, scores: Omit<SelfEvalResult, "cycleId" | "timestamp" | "overallScore">): SelfEvalResult {
  const overallScore = (scores.planningQuality + scores.executionQuality + scores.verificationCoverage) / 3;
  const result: SelfEvalResult = {
    ...scores,
    cycleId,
    overallScore,
    timestamp: new Date().toISOString(),
  };
  evaluations.push(result);
  return result;
}

export function getSelfEvalTrend(cycleCount = 10): { improving: boolean; avgScore: number } {
  const recent = evaluations.slice(-cycleCount);
  if (recent.length < 2) return { improving: false, avgScore: recent[0]?.overallScore ?? 0 };
  const avgScore = recent.reduce((s, e) => s + e.overallScore, 0) / recent.length;
  const improving = recent[recent.length - 1].overallScore > recent[0].overallScore;
  return { improving, avgScore };
}
