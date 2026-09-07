import { sha256 } from '../contracts/crypto.js';
export interface TrustGrant { readonly grantId: string; readonly custodianId: string; readonly tenantIds: readonly string[]; readonly scopes: readonly string[]; readonly expiresAt: string; readonly revocable: boolean; }
export interface TrustBlastRadiusReport { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly grants: number; readonly custodians: number; readonly affectedTenants: number; readonly affectedScopes: number; readonly wildcardGrantCount: number }; readonly findings: readonly string[]; readonly reportDigest: string; }
export function analyzeTrustBlastRadius(grants: readonly TrustGrant[], compromisedCustodianIds: readonly string[], evaluatedAt: string): TrustBlastRadiusReport {
  const at = Date.parse(evaluatedAt); if (!Number.isFinite(at)) throw new Error('trust_evaluation_time_invalid');
  const ids = new Set<string>();
  for (const grant of grants) { if (grant.grantId.trim() === '' || grant.custodianId.trim() === '' || ids.has(grant.grantId) || !Number.isFinite(Date.parse(grant.expiresAt))) throw new Error('trust_grant_invalid'); ids.add(grant.grantId); }
  const compromised = new Set(compromisedCustodianIds);
  const active = grants.filter((grant) => compromised.has(grant.custodianId) && Date.parse(grant.expiresAt) > at);
  const tenants = new Set(active.flatMap((grant) => grant.tenantIds));
  const scopes = new Set(active.flatMap((grant) => grant.scopes));
  const wildcardGrantCount = active.filter((grant) => grant.tenantIds.includes('*') || grant.scopes.includes('*')).length;
  const findings = [
    ...(wildcardGrantCount > 0 ? ['wildcard_grant_expands_blast_radius'] : []),
    ...active.filter((grant) => !grant.revocable).map((grant) => `non_revocable_grant:${grant.grantId}`),
    ...(new Set(active.map((grant) => grant.custodianId)).size < active.length && active.length > 1 ? ['single_custodian_controls_multiple_active_grants'] : []),
  ];
  const metrics = { grants: active.length, custodians: new Set(active.map((grant) => grant.custodianId)).size, affectedTenants: tenants.size, affectedScopes: scopes.size, wildcardGrantCount };
  const material = { status: findings.length === 0 ? 'PASS' as const : 'BLOCK' as const, metrics, findings };
  return { ...material, reportDigest: sha256(material) };
}
