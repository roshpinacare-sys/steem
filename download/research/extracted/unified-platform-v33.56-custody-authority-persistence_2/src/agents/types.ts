export interface AgentChangeRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly requesterId: string;
  readonly agentId: string;
  readonly objective: string;
  readonly allowedFiles: readonly string[];
  readonly deniedFiles: readonly string[];
  readonly requiredTests: readonly string[];
  readonly targetFile: string;
  readonly expectedFileDigest: string;
  readonly exactBefore: string;
  readonly exactAfter: string;
  readonly context: readonly { readonly path: string; readonly content: string }[];
  readonly maxOperations: number;
  readonly noExternalMutation: boolean;
  readonly noNetwork: boolean;
}

export interface AgentPlan {
  readonly planId: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly policyDigest: string;
  readonly proposalDigest: string;
  readonly tenantId: string;
  readonly requesterId: string;
  readonly agentId: string;
  readonly objective: string;
  readonly expectedFileDigest: string;
  readonly operations: readonly {
    readonly kind: 'exact-replacement';
    readonly file: string;
    readonly beforeDigest: string;
    readonly afterDigest: string;
    readonly exactBefore: string;
    readonly exactAfter: string;
  }[];
  readonly requiredTests: readonly string[];
  readonly contextFindings: readonly {
    readonly path: string;
    readonly kind: 'PROMPT_INJECTION_SIGNAL';
    readonly summary: string;
  }[];
  readonly unsupportedClaims: readonly string[];
  readonly status: 'PROPOSED';
}

export interface ApprovedAgentPlan extends Omit<AgentPlan, 'status'> {
  readonly status: 'APPROVED';
  readonly reviewerId: string;
  readonly approvedAt: string;
  readonly approvalDigest: string;
}

export interface AgentExecutionReceipt {
  readonly planId: string;
  readonly tenantId: string;
  readonly agentId: string;
  readonly reviewerId: string;
  readonly changedFiles: readonly string[];
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly executedAt: string;
  readonly receiptDigest: string;
  readonly limitations: readonly string[];
}
