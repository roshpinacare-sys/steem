import { sha256 } from '../contracts/crypto.js';

export interface EvidenceArtifactObservation {
  readonly evidenceId: string;
  readonly path: string;
  readonly producedAt: string;
  readonly sourceDigest: string;
  readonly recordedArtifactDigest: string;
  readonly actualArtifactDigest?: string | undefined;
  readonly maxAgeMs: number;
  readonly requiredForPromotion: boolean;
}

export interface EvidenceFreshnessReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly currentSourceDigest: string;
  readonly evaluatedAt: string;
  readonly totals: {
    readonly artifacts: number;
    readonly current: number;
    readonly stale: number;
    readonly missing: number;
    readonly sourceMismatch: number;
    readonly digestMismatch: number;
    readonly invalid: number;
  };
  readonly findings: readonly { readonly evidenceId: string; readonly code: string; readonly blocking: boolean; readonly detail: string }[];
  readonly reportDigest: string;
}

export function evaluateEvidenceFreshness(input: { readonly currentSourceDigest: string; readonly evaluatedAt: string; readonly artifacts: readonly EvidenceArtifactObservation[] }): EvidenceFreshnessReport {
  if (!/^[0-9a-f]{64}$/.test(input.currentSourceDigest)) throw new Error('evidence_current_source_digest_invalid');
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(evaluatedAtMs)) throw new Error('evidence_evaluated_at_invalid');
  const findings: { evidenceId: string; code: string; blocking: boolean; detail: string }[] = [];
  const ids = new Set<string>();
  for (const artifact of input.artifacts) {
    if (artifact.evidenceId.trim() === '' || artifact.path.trim() === '' || ids.has(artifact.evidenceId)) throw new Error('evidence_artifact_identity_invalid');
    ids.add(artifact.evidenceId);
    if (!Number.isInteger(artifact.maxAgeMs) || artifact.maxAgeMs <= 0) throw new Error('evidence_max_age_invalid');
    const producedAtMs = Date.parse(artifact.producedAt);
    if (!Number.isFinite(producedAtMs) || producedAtMs > evaluatedAtMs + 60_000) {
      findings.push(finding(artifact, 'EVIDENCE_TIME_INVALID', true, artifact.producedAt));
      continue;
    }
    if (!/^[0-9a-f]{64}$/.test(artifact.recordedArtifactDigest) || !/^[0-9a-f]{64}$/.test(artifact.sourceDigest)) findings.push(finding(artifact, 'EVIDENCE_DIGEST_FORMAT_INVALID', true, artifact.path));
    if (artifact.actualArtifactDigest === undefined) findings.push(finding(artifact, 'EVIDENCE_ARTIFACT_MISSING', artifact.requiredForPromotion, artifact.path));
    else if (artifact.actualArtifactDigest !== artifact.recordedArtifactDigest) findings.push(finding(artifact, 'EVIDENCE_ARTIFACT_DIGEST_MISMATCH', artifact.requiredForPromotion, artifact.path));
    if (artifact.sourceDigest !== input.currentSourceDigest) findings.push(finding(artifact, 'EVIDENCE_SOURCE_DIGEST_MISMATCH', artifact.requiredForPromotion, artifact.sourceDigest));
    if (evaluatedAtMs - producedAtMs > artifact.maxAgeMs) findings.push(finding(artifact, 'EVIDENCE_STALE', artifact.requiredForPromotion, String(evaluatedAtMs - producedAtMs)));
  }
  const codeCount = (code: string): number => findings.filter((item) => item.code === code).length;
  const affected = new Set(findings.map((item) => item.evidenceId));
  const totals = {
    artifacts: input.artifacts.length,
    current: input.artifacts.length - affected.size,
    stale: codeCount('EVIDENCE_STALE'),
    missing: codeCount('EVIDENCE_ARTIFACT_MISSING'),
    sourceMismatch: codeCount('EVIDENCE_SOURCE_DIGEST_MISMATCH'),
    digestMismatch: codeCount('EVIDENCE_ARTIFACT_DIGEST_MISMATCH'),
    invalid: codeCount('EVIDENCE_TIME_INVALID') + codeCount('EVIDENCE_DIGEST_FORMAT_INVALID'),
  };
  const material = { status: findings.some((item) => item.blocking) ? 'BLOCK' as const : 'PASS' as const, currentSourceDigest: input.currentSourceDigest, evaluatedAt: input.evaluatedAt, totals, findings: findings.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId) || a.code.localeCompare(b.code)) };
  return { ...material, reportDigest: sha256(material) };
}
function finding(artifact: EvidenceArtifactObservation, code: string, blocking: boolean, detail: string): { evidenceId: string; code: string; blocking: boolean; detail: string } { return { evidenceId: artifact.evidenceId, code, blocking, detail }; }
