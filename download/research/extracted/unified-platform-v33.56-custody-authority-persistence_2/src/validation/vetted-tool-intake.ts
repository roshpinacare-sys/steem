import { sha256 } from '../contracts/crypto.js';

export type ToolIntegrationMode = 'METADATA_ONLY' | 'SARIF_IMPORT' | 'ATTESTATION_IMPORT' | 'POLICY_BUNDLE' | 'MODEL_EVIDENCE' | 'FUZZ_EVIDENCE';
export interface ToolCandidate {
  readonly toolId: string;
  readonly repository: string;
  readonly organization: string;
  readonly commitSha: string;
  readonly license: string;
  readonly officialOrganization: boolean;
  readonly archived: boolean;
  readonly fork: boolean;
  readonly securityPolicy: boolean;
  readonly signedRelease: boolean;
  readonly branchProtectionObserved: boolean;
  readonly scorecardScore: number;
  readonly requestedMode: ToolIntegrationMode;
  readonly requestsVendoring: boolean;
  readonly requestsAutomaticExecution: boolean;
  readonly networkRequiredAtRuntime: boolean;
}
export interface ToolIntakePolicy {
  readonly allowedOrganizations: readonly string[];
  readonly allowedLicenses: readonly string[];
  readonly minimumScorecard: number;
  readonly requireSignedRelease: boolean;
  readonly requireSecurityPolicy: boolean;
  readonly requireBranchProtection: boolean;
}
export interface ToolIntakeReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly approved: readonly { readonly toolId: string; readonly disposition: 'ADAPTER_ONLY'; readonly mode: ToolIntegrationMode }[];
  readonly rejected: readonly { readonly toolId: string; readonly reasons: readonly string[] }[];
  readonly findings: readonly string[];
  readonly reportDigest: string;
}

/** No candidate can gain execution or vendoring authority through this evaluator. */
export function evaluateVettedToolIntake(candidates: readonly ToolCandidate[], policy: ToolIntakePolicy): ToolIntakeReport {
  const seen = new Set<string>();
  const approved: { toolId: string; disposition: 'ADAPTER_ONLY'; mode: ToolIntegrationMode }[] = [];
  const rejected: { toolId: string; reasons: string[] }[] = [];
  const findings: string[] = [];
  const allowedOrganizations = new Set(policy.allowedOrganizations.map(normalize));
  const allowedLicenses = new Set(policy.allowedLicenses.map(normalize));
  for (const raw of candidates) {
    const toolId = raw.toolId.trim();
    if (!toolId || seen.has(toolId)) throw new Error(`tool_identity_invalid:${toolId}`);
    seen.add(toolId);
    const reasons: string[] = [];
    if (!raw.officialOrganization || !allowedOrganizations.has(normalize(raw.organization))) reasons.push('organization_not_approved');
    if (!raw.repository.startsWith(`https://github.com/${raw.organization}/`)) reasons.push('repository_origin_invalid');
    if (!/^[0-9a-f]{40}$/.test(raw.commitSha)) reasons.push('commit_not_immutable');
    if (!allowedLicenses.has(normalize(raw.license))) reasons.push('license_not_approved');
    if (raw.archived) reasons.push('repository_archived');
    if (raw.fork) reasons.push('repository_fork');
    if (policy.requireSecurityPolicy && !raw.securityPolicy) reasons.push('security_policy_missing');
    if (policy.requireSignedRelease && !raw.signedRelease) reasons.push('signed_release_missing');
    if (policy.requireBranchProtection && !raw.branchProtectionObserved) reasons.push('branch_protection_unobserved');
    if (!Number.isFinite(raw.scorecardScore) || raw.scorecardScore < policy.minimumScorecard) reasons.push('scorecard_below_floor');
    if (raw.requestsVendoring) reasons.push('vendoring_forbidden');
    if (raw.requestsAutomaticExecution) reasons.push('automatic_execution_forbidden');
    if (raw.networkRequiredAtRuntime) reasons.push('runtime_network_forbidden');
    if (reasons.length) rejected.push({ toolId, reasons: [...new Set(reasons)].sort() });
    else approved.push({ toolId, disposition: 'ADAPTER_ONLY', mode: raw.requestedMode });
  }
  if (candidates.length === 0) findings.push('candidate_inventory_empty');
  const material = {
    status: rejected.length === 0 && findings.length === 0 ? 'PASS' as const : 'BLOCK' as const,
    approved: approved.sort((a, b) => a.toolId.localeCompare(b.toolId)),
    rejected: rejected.sort((a, b) => a.toolId.localeCompare(b.toolId)),
    findings,
  };
  return { ...material, reportDigest: sha256(material) };
}
function normalize(value: string): string { return value.trim().toLowerCase(); }
