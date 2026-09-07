import { sha256 } from '../contracts/crypto.js';
export interface ClaimNode { readonly claimId: string; readonly dependsOnClaimIds: readonly string[]; readonly evidenceIds: readonly string[]; readonly limitationIds: readonly string[]; }
export interface EvidenceNode { readonly evidenceId: string; readonly current: boolean; readonly authentic: boolean; readonly complete: boolean; }
export interface ClaimEvidenceClosureReport { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly claims: number; readonly evidence: number; readonly closedClaims: number; readonly cycles: number }; readonly results: readonly { readonly claimId: string; readonly closed: boolean; readonly reasons: readonly string[]; readonly inheritedLimitations: readonly string[] }[]; readonly reportDigest: string; }
export function evaluateClaimEvidenceClosure(claims: readonly ClaimNode[], evidence: readonly EvidenceNode[]): ClaimEvidenceClosureReport {
  const claimMap = new Map<string, ClaimNode>(); const evidenceMap = new Map<string, EvidenceNode>();
  for (const claim of claims) { if (claim.claimId.trim() === '' || claimMap.has(claim.claimId)) throw new Error('claim_identity_invalid'); claimMap.set(claim.claimId, claim); }
  for (const item of evidence) { if (item.evidenceId.trim() === '' || evidenceMap.has(item.evidenceId)) throw new Error('claim_evidence_identity_invalid'); evidenceMap.set(item.evidenceId, item); }
  const cycleClaims = new Set<string>(); const visiting = new Set<string>(); const visited = new Set<string>();
  const walk = (claimId: string): void => { if (visiting.has(claimId)) { cycleClaims.add(claimId); return; } if (visited.has(claimId)) return; const claim = claimMap.get(claimId); if (claim === undefined) return; visiting.add(claimId); for (const dep of claim.dependsOnClaimIds) walk(dep); visiting.delete(claimId); visited.add(claimId); };
  for (const claim of claims) walk(claim.claimId);
  const results = claims.map((claim) => {
    const reasons: string[] = [];
    if (cycleClaims.has(claim.claimId)) reasons.push('claim_cycle');
    for (const dep of claim.dependsOnClaimIds) if (!claimMap.has(dep)) reasons.push(`dependent_claim_missing:${dep}`);
    for (const id of claim.evidenceIds) { const item = evidenceMap.get(id); if (item === undefined) reasons.push(`evidence_missing:${id}`); else { if (!item.current) reasons.push(`evidence_stale:${id}`); if (!item.authentic) reasons.push(`evidence_inauthentic:${id}`); if (!item.complete) reasons.push(`evidence_incomplete:${id}`); } }
    if (claim.evidenceIds.length === 0 && claim.dependsOnClaimIds.length === 0) reasons.push('claim_unsubstantiated');
    const inheritedLimitations = [...new Set([...claim.limitationIds, ...claim.dependsOnClaimIds.flatMap((id) => claimMap.get(id)?.limitationIds ?? [])])].sort();
    return { claimId: claim.claimId, closed: reasons.length === 0, reasons, inheritedLimitations };
  });
  const metrics = { claims: claims.length, evidence: evidence.length, closedClaims: results.filter((item) => item.closed).length, cycles: cycleClaims.size };
  const material = { status: results.every((item) => item.closed) ? 'PASS' as const : 'BLOCK' as const, metrics, results };
  return { ...material, reportDigest: sha256(material) };
}
