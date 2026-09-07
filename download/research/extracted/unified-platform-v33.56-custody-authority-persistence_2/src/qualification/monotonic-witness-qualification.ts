import { sha256 } from '../contracts/crypto.js';
import { finding, qualificationResult, validateExternalEvidenceEnvelope, validInstant, type ExternalEvidenceEnvelope, type QualificationResult } from './external-evidence.js';

export interface WitnessReceipt {
  readonly sequence: number;
  readonly checkpointDigest: string;
  readonly previousReceiptDigest: string | null;
  readonly observedAt: string;
  readonly witnessId: string;
  readonly signatureVerified: boolean;
  readonly receiptDigest: string;
}
export interface MonotonicWitnessEvidence {
  readonly envelope: ExternalEvidenceEnvelope;
  readonly receipts: readonly WitnessReceipt[];
  readonly rollbackAttemptRejected: boolean;
  readonly equivocationProbeRejected: boolean;
}

export function witnessReceiptDigest(receipt: Omit<WitnessReceipt, 'receiptDigest'>): string { return sha256(receipt); }

export function evaluateMonotonicWitnessQualification(evidence: MonotonicWitnessEvidence): QualificationResult<Readonly<Record<string, unknown>>> {
  const findings = validateExternalEvidenceEnvelope(evidence.envelope, 'external-monotonic-witness');
  if (evidence.receipts.length < 3) findings.push(finding('WITNESS_RECEIPTS_INSUFFICIENT', 'At least three sequential receipts are required.'));
  let previous: string | null = null;
  let previousTime = Number.NEGATIVE_INFINITY;
  const witnesses = new Set<string>();
  for (let index = 0; index < evidence.receipts.length; index += 1) {
    const receipt = evidence.receipts[index]!;
    if (receipt.sequence !== index + 1 || receipt.previousReceiptDigest !== previous) findings.push(finding('WITNESS_CHAIN_INVALID', `Receipt ${index + 1} is not monotonic.`));
    if (!/^[0-9a-f]{64}$/.test(receipt.checkpointDigest)) findings.push(finding('WITNESS_CHECKPOINT_INVALID', `Receipt ${index + 1} checkpoint is invalid.`));
    if (!validInstant(receipt.observedAt) || Date.parse(receipt.observedAt) <= previousTime) findings.push(finding('WITNESS_TIME_NOT_MONOTONIC', `Receipt ${index + 1} time is not monotonic.`));
    if (!receipt.signatureVerified) findings.push(finding('WITNESS_SIGNATURE_UNVERIFIED', `Receipt ${index + 1} signature is unverified.`));
    const { receiptDigest, ...material } = receipt;
    if (receiptDigest !== witnessReceiptDigest(material)) findings.push(finding('WITNESS_RECEIPT_TAMPERED', `Receipt ${index + 1} digest mismatch.`));
    if (receipt.witnessId.trim() === '') findings.push(finding('WITNESS_ID_REQUIRED', `Receipt ${index + 1} has no witness identity.`));
    witnesses.add(receipt.witnessId);
    previous = receipt.receiptDigest;
    previousTime = Date.parse(receipt.observedAt);
  }
  if (witnesses.size !== 1) findings.push(finding('WITNESS_IDENTITY_DRIFT', 'One qualification chain must bind to one external witness identity.'));
  if (!evidence.rollbackAttemptRejected) findings.push(finding('WITNESS_ROLLBACK_NOT_REJECTED', 'Rollback attempt was not rejected.'));
  if (!evidence.equivocationProbeRejected) findings.push(finding('WITNESS_EQUIVOCATION_NOT_REJECTED', 'Equivocation probe was not rejected.'));
  return qualificationResult('external-monotonic-witness', { receiptCount: evidence.receipts.length, witnessCount: witnesses.size }, findings, evidence);
}
