export const READINESS_LEVELS = [
  'Research',
  'Development',
  'Integrated Pilot',
  'Staging Candidate',
  'Production Candidate',
  'Qualified Production Release',
] as const;
export type ReadinessLevel = (typeof READINESS_LEVELS)[number];

export const V32_PHASE = 'CNCF Gold-Mine Extraction, Sovereign Control-Plane Primitives, and External Runtime Qualification Readiness' as const;
export const V33_PHASE = 'Custody Authority Persistence, Replicated Ledger, Fenced Decryption Leases, Share Rotation, Compromise Containment, Emergency Quorum, Automatic Expiration, and Disaster Recovery' as const;

export interface ProgramStateV28 {
  readonly schemaVersion: '2.0.0';
  readonly version: string;
  readonly updatedAt: string;
  readonly program: string;
  readonly phase: typeof V32_PHASE | typeof V33_PHASE;
  readonly readiness: ReadinessLevel;
  readonly status: string;
  readonly executionBoundary: {
    readonly trustedRepository: 'allowlisted-local-authority';
    readonly untrustedRepository: 'blocked-until-independent-isolation-qualification';
    readonly externalMutation: 'not-authorized';
    readonly productionPromotion: 'blocked';
  };
  readonly completed: readonly string[];
  readonly blockedGates: readonly string[];
  readonly nextAllowedAction: string;
  readonly evidencePaths: readonly string[];
}

export interface NextActionV28 {
  readonly schemaVersion: '2.0.0';
  readonly version: string;
  readonly updatedAt: string;
  readonly actionId: string;
  readonly title: string;
  readonly allowedActions: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly requiredBlockedGates: readonly string[];
  readonly exitCriteria: readonly string[];
  readonly qualificationTargetVersion: string;
}

export interface OpenDecisionsV28 {
  readonly version: string;
  readonly updatedAt: string;
  readonly decisions: readonly { readonly id: string; readonly status?: string; readonly recommendation?: string }[];
}

export interface GovernanceBundleV28 {
  readonly programState: ProgramStateV28;
  readonly nextAction: NextActionV28;
  readonly openDecisions: OpenDecisionsV28;
}

export interface GovernanceFinding {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

export interface GovernanceValidationResult {
  readonly ok: boolean;
  readonly findings: readonly GovernanceFinding[];
  readonly version: string;
  readonly readinessIndex: number;
}
