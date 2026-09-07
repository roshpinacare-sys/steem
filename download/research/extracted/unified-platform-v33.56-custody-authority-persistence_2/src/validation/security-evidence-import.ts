import { sha256 } from '../contracts/crypto.js';

export interface SarifFinding { readonly ruleId: string; readonly level: 'note' | 'warning' | 'error'; readonly fingerprint: string; readonly suppressed: boolean; }
export interface SarifEvidence {
  readonly sarifVersion: '2.1.0'; readonly toolName: string; readonly toolVersion: string; readonly sourceDigest: string; readonly artifactDigest: string;
  readonly trustedTool: boolean; readonly observed: boolean; readonly complete: boolean; readonly findings: readonly SarifFinding[];
}
export interface SecurityEvidenceReport { readonly status: 'PASS' | 'BLOCK'; readonly failures: readonly string[]; readonly metrics: { readonly findings: number; readonly errors: number; readonly warnings: number; readonly suppressed: number }; readonly reportDigest: string; }
export function evaluateSarifSecurityEvidence(input: SarifEvidence, expected: { sourceDigest: string; artifactDigest: string; allowedTools: readonly string[] }): SecurityEvidenceReport {
  const failures: string[] = [];
  if (input.sarifVersion !== '2.1.0') failures.push('sarif_version_invalid');
  if (!expected.allowedTools.includes(input.toolName)) failures.push('tool_not_allowed');
  if (!input.trustedTool) failures.push('tool_trust_unverified');
  if (!input.observed || !input.complete) failures.push('evidence_not_observed_complete');
  if (input.sourceDigest !== expected.sourceDigest) failures.push('source_digest_mismatch');
  if (input.artifactDigest !== expected.artifactDigest) failures.push('artifact_digest_mismatch');
  const active = input.findings.filter((row) => !row.suppressed);
  if (active.some((row) => row.level === 'error')) failures.push('security_error_findings');
  if (input.findings.some((row) => !row.ruleId.trim() || !/^[0-9a-f]{32,128}$/.test(row.fingerprint))) failures.push('finding_identity_invalid');
  const material = { status: failures.length ? 'BLOCK' as const : 'PASS' as const, failures: [...new Set(failures)].sort(), metrics: { findings: input.findings.length, errors: active.filter((row) => row.level === 'error').length, warnings: active.filter((row) => row.level === 'warning').length, suppressed: input.findings.filter((row) => row.suppressed).length } };
  return { ...material, reportDigest: sha256(material) };
}

export interface AttestationEvidence {
  readonly statementType: 'https://in-toto.io/Statement/v1'; readonly predicateType: string; readonly subjectDigest: string; readonly sourceDigest: string;
  readonly builderId: string; readonly materials: readonly { uri: string; digest: string }[]; readonly signatureVerified: boolean; readonly transparencyVerified: boolean;
  readonly signerIdentity: string; readonly observed: boolean;
}
export function evaluateAttestationEvidence(input: AttestationEvidence, expected: { artifactDigest: string; sourceDigest: string; allowedPredicateTypes: readonly string[]; trustedBuilders: readonly string[]; trustedSigners: readonly string[] }): { status: 'PASS' | 'BLOCK'; failures: readonly string[]; reportDigest: string } {
  const failures: string[] = [];
  if (input.statementType !== 'https://in-toto.io/Statement/v1') failures.push('statement_type_invalid');
  if (!expected.allowedPredicateTypes.includes(input.predicateType)) failures.push('predicate_type_unapproved');
  if (input.subjectDigest !== expected.artifactDigest) failures.push('subject_digest_mismatch');
  if (input.sourceDigest !== expected.sourceDigest) failures.push('source_digest_mismatch');
  if (!expected.trustedBuilders.includes(input.builderId)) failures.push('builder_untrusted');
  if (!expected.trustedSigners.includes(input.signerIdentity)) failures.push('signer_untrusted');
  if (!input.signatureVerified) failures.push('signature_unverified');
  if (!input.transparencyVerified) failures.push('transparency_unverified');
  if (!input.observed) failures.push('attestation_not_observed');
  if (input.materials.length === 0 || input.materials.some((row) => !row.uri.trim() || !/^[0-9a-f]{64}$/.test(row.digest))) failures.push('materials_invalid');
  const material = { status: failures.length ? 'BLOCK' as const : 'PASS' as const, failures: [...new Set(failures)].sort() };
  return { ...material, reportDigest: sha256(material) };
}
