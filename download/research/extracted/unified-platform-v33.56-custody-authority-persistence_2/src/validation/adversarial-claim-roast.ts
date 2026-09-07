import { sha256 } from '../contracts/crypto.js';
export type ClaimKind = 'LOCAL_RUNTIME' | 'SECURITY' | 'SUPPLY_CHAIN' | 'FORMAL' | 'HUMAN_VALUE' | 'EXTERNAL_QUALIFICATION';
export interface RoastEvidence { readonly evidenceId: string; readonly claimId: string; readonly producerId: string; readonly reviewerId: string; readonly oracleId: string; readonly environmentId: string; readonly evidenceDigest: string; readonly sourceDigest: string; readonly artifactDigest: string; readonly observed: boolean; readonly executable: boolean; readonly negativePath: boolean; readonly counterexampleSearch: boolean; readonly externallyCollected: boolean; readonly current: boolean; }
export interface RoastClaim { readonly claimId: string; readonly kind: ClaimKind; readonly sourceDigest: string; readonly artifactDigest: string; readonly minimumEvidence: number; readonly requireExternal: boolean; readonly requireExecutable: boolean; readonly requireNegativePath: boolean; readonly requireCounterexampleSearch: boolean; }
export function roastClaims(claims: readonly RoastClaim[], evidence: readonly RoastEvidence[]): { status: 'PASS' | 'BLOCK'; results: readonly { claimId: string; status: 'SURVIVED' | 'REFUTED'; attacks: readonly string[] }[]; metrics: { claims: number; survived: number; refuted: number; evidence: number }; reportDigest: string } {
  const claimIds = new Set<string>();
  for (const claim of claims) { if (!claim.claimId.trim() || claimIds.has(claim.claimId)) throw new Error(`roast_claim_identity_invalid:${claim.claimId}`); claimIds.add(claim.claimId); }
  const evidenceIds = new Set<string>();
  for (const row of evidence) { if (!row.evidenceId.trim() || evidenceIds.has(row.evidenceId)) throw new Error(`roast_evidence_identity_invalid:${row.evidenceId}`); evidenceIds.add(row.evidenceId); if (!claimIds.has(row.claimId)) throw new Error(`roast_claim_unknown:${row.claimId}`); }
  const results = claims.map((claim) => {
    const rows = evidence.filter((row) => row.claimId === claim.claimId && row.current && row.observed && /^[0-9a-f]{64}$/.test(row.evidenceDigest));
    const attacks: string[] = [];
    if (rows.length < claim.minimumEvidence) attacks.push('evidence_quantity_insufficient');
    if (rows.some((row) => row.sourceDigest !== claim.sourceDigest || row.artifactDigest !== claim.artifactDigest)) attacks.push('digest_binding_broken');
    if (rows.some((row) => row.producerId === row.reviewerId)) attacks.push('self_review');
    if (new Set(rows.map((row) => row.oracleId)).size < Math.min(2, claim.minimumEvidence)) attacks.push('oracle_concentration');
    if (new Set(rows.map((row) => row.environmentId)).size < Math.min(2, claim.minimumEvidence)) attacks.push('environment_concentration');
    if (claim.requireExternal && !rows.some((row) => row.externallyCollected)) attacks.push('external_evidence_missing');
    if (claim.requireExecutable && !rows.some((row) => row.executable)) attacks.push('executable_proof_missing');
    if (claim.requireNegativePath && !rows.some((row) => row.negativePath)) attacks.push('negative_path_missing');
    if (claim.requireCounterexampleSearch && !rows.some((row) => row.counterexampleSearch)) attacks.push('counterexample_search_missing');
    if ((claim.kind === 'HUMAN_VALUE' || claim.kind === 'EXTERNAL_QUALIFICATION') && rows.every((row) => !row.externallyCollected)) attacks.push('local_evidence_cannot_support_external_claim');
    return { claimId: claim.claimId, status: attacks.length ? 'REFUTED' as const : 'SURVIVED' as const, attacks: [...new Set(attacks)].sort() };
  });
  const material = { status: results.every((row) => row.status === 'SURVIVED') ? 'PASS' as const : 'BLOCK' as const, results: results.sort((a, b) => a.claimId.localeCompare(b.claimId)), metrics: { claims: claims.length, survived: results.filter((row) => row.status === 'SURVIVED').length, refuted: results.filter((row) => row.status === 'REFUTED').length, evidence: evidence.length } };
  return { ...material, reportDigest: sha256(material) };
}
