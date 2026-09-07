import { sha256 } from '../contracts/crypto.js';
import type { QualificationResult } from './external-evidence.js';

export interface ExternalQualificationGateInput {
  readonly sourceDigest: string;
  readonly hsmKms: QualificationResult<Readonly<Record<string, unknown>>>;
  readonly witness: QualificationResult<Readonly<Record<string, unknown>>>;
  readonly postgres: QualificationResult<Readonly<Record<string, unknown>>>;
  readonly humanPilot: QualificationResult<Readonly<Record<string, unknown>>>;
  readonly independentReview: QualificationResult<Readonly<Record<string, unknown>>>;
  readonly multiHostSlo: QualificationResult<Readonly<Record<string, unknown>>>;
}
export interface ExternalQualificationGateReport {
  readonly status: 'QUALIFIED' | 'BLOCKED';
  readonly productionPromotion: 'eligible-for-authorized-decision' | 'blocked';
  readonly passedGates: number;
  readonly totalGates: 6;
  readonly blockedGateIds: readonly string[];
  readonly sourceDigest: string;
  readonly reportDigest: string;
}

export function evaluateExternalQualificationGate(input: ExternalQualificationGateInput): ExternalQualificationGateReport {
  if (!/^[0-9a-f]{64}$/.test(input.sourceDigest)) throw new Error('external_qualification_source_digest_invalid');
  const results = [input.hsmKms, input.witness, input.postgres, input.humanPilot, input.independentReview, input.multiHostSlo];
  const gateIds = new Set(results.map((result) => result.gateId));
  if (gateIds.size !== 6) throw new Error('external_qualification_gate_identity_invalid');
  const blockedGateIds = results.filter((result) => result.status !== 'PASS').map((result) => result.gateId).sort();
  const status = blockedGateIds.length === 0 ? 'QUALIFIED' as const : 'BLOCKED' as const;
  const material = { status, productionPromotion: status === 'QUALIFIED' ? 'eligible-for-authorized-decision' as const : 'blocked' as const, passedGates: 6 - blockedGateIds.length, totalGates: 6 as const, blockedGateIds, sourceDigest: input.sourceDigest };
  return { ...material, reportDigest: sha256(material) };
}
