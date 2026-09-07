import type { AuthorityGrant, EvidenceRecord } from './canonical.js';

export interface TitaiPrincipal {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly disabled?: boolean;
}

export interface TfaCapabilityToken {
  readonly capabilityId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly actions: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly passportId?: string;
}

export function titaiPrincipalToGrant(
  principal: TitaiPrincipal,
  options: { scopes: readonly string[]; issuer?: string; now?: Date },
): AuthorityGrant {
  const now = options.now ?? new Date();
  return {
    grantId: `titai:${principal.id}:${now.getTime()}`,
    tenantId: principal.tenantId,
    subjectId: principal.id,
    ...(principal.workspaceId === undefined ? {} : { workspaceId: principal.workspaceId }),
    scopes: [...options.scopes],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    issuer: options.issuer ?? 'titai-kernel',
    ...(principal.disabled === true ? { revokedAt: now.toISOString() } : {}),
    evidenceRef: 'titai:authorization-decision',
  };
}

export function tfaCapabilityToGrant(token: TfaCapabilityToken, issuer = 'tfa-authority'): AuthorityGrant {
  return {
    grantId: token.capabilityId,
    tenantId: token.tenantId,
    subjectId: token.subjectId,
    scopes: [...token.actions],
    issuedAt: token.issuedAt,
    expiresAt: token.expiresAt,
    issuer,
    ...(token.revokedAt === undefined ? {} : { revokedAt: token.revokedAt }),
    ...(token.passportId === undefined ? {} : { evidenceRef: token.passportId }),
  };
}

export function titaiRunSummaryToEvidence(
  summary: { state: string; coverage: number; reconstructable: boolean; gaps?: readonly string[] },
  runId: string,
  tenantId: string,
  now = new Date(),
): EvidenceRecord {
  return {
    recordId: `titai-run:${runId}`,
    tenantId,
    kind: 'run-evidence-summary',
    subject: runId,
    payload: {
      state: summary.state,
      coverage: summary.coverage,
      reconstructable: summary.reconstructable,
      gaps: [...(summary.gaps ?? [])],
    },
    evidenceClass: 'COMPUTED',
    method: 'titai.summarizeRunEvidence',
    environment: { source: 'TITAI-v18' },
    createdAt: now.toISOString(),
    limitations: ['summary-does-not-prove-external-effects'],
  };
}

export function tfaPassportVerificationToEvidence(
  passport: { passportId: string; subject?: string; hash: string; algorithm: string },
  verification: { ok: boolean; checks: readonly string[] },
  tenantId: string,
  now = new Date(),
): EvidenceRecord {
  return {
    recordId: `tfa-passport:${passport.passportId}`,
    tenantId,
    kind: 'action-passport-verification',
    subject: passport.subject ?? passport.passportId,
    payload: {
      passportHash: passport.hash,
      algorithm: passport.algorithm,
      verificationOk: verification.ok,
      checks: [...verification.checks],
    },
    evidenceClass: 'ATTESTED',
    method: 'tfa.verifyActionPassport',
    environment: { source: 'TFA-v596', offline: true },
    createdAt: now.toISOString(),
    limitations: ['attestation-does-not-prove-underlying-claim-truth'],
  };
}
