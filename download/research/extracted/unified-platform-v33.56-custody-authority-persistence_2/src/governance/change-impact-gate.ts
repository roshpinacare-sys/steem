import { createHash } from 'node:crypto';

export type ChangeCriticality = 'low' | 'medium' | 'high' | 'critical';
export interface ChangeImpactItem {
  readonly artifactId: string;
  readonly criticality: ChangeCriticality;
  readonly requirementRefs: readonly string[];
  readonly ownerIds: readonly string[];
  readonly testRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly rollbackRef?: string;
  readonly reviewerIds: readonly string[];
}
export interface ChangeImpactReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly metrics: { readonly changes: number; readonly ready: number; readonly blocked: number; readonly criticalChanges: number };
  readonly results: readonly { readonly artifactId: string; readonly status: 'READY' | 'BLOCKED'; readonly reasons: readonly string[] }[];
  readonly reportDigest: string;
}
export function evaluateChangeImpact(items: readonly ChangeImpactItem[]): ChangeImpactReport {
  const ids = new Set<string>();
  const results = items.map((item) => {
    if (item.artifactId.trim() === '' || ids.has(item.artifactId)) throw new Error('change_impact_identity_invalid');
    ids.add(item.artifactId);
    const reasons: string[] = [];
    if (item.requirementRefs.length === 0) reasons.push('requirement_missing');
    if (item.ownerIds.length === 0) reasons.push('owner_missing');
    if (item.testRefs.length === 0) reasons.push('test_missing');
    if (item.evidenceRefs.length === 0) reasons.push('evidence_missing');
    if ((item.criticality === 'high' || item.criticality === 'critical') && (item.rollbackRef === undefined || item.rollbackRef.trim() === '')) reasons.push('rollback_missing');
    const distinctReviewers = new Set(item.reviewerIds.filter((value) => value.trim() !== ''));
    if (item.criticality === 'critical' && distinctReviewers.size < 2) reasons.push('independent_reviewers_insufficient');
    if (item.ownerIds.some((owner) => distinctReviewers.has(owner))) reasons.push('owner_reviewer_conflict');
    return { artifactId: item.artifactId, status: reasons.length === 0 ? 'READY' as const : 'BLOCKED' as const, reasons };
  });
  const metrics = { changes: items.length, ready: results.filter((item) => item.status === 'READY').length, blocked: results.filter((item) => item.status === 'BLOCKED').length, criticalChanges: items.filter((item) => item.criticality === 'critical').length };
  const material = { status: metrics.blocked === 0 ? 'PASS' as const : 'BLOCK' as const, metrics, results };
  return { ...material, reportDigest: createHash('sha256').update(JSON.stringify(material)).digest('hex') };
}
