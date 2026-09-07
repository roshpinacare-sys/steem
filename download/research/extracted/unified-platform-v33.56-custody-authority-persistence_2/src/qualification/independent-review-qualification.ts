import { finding, qualificationResult, validateExternalEvidenceEnvelope, type ExternalEvidenceEnvelope, type QualificationResult } from './external-evidence.js';

export type IndependentReviewScope = 'PENETRATION' | 'ISOLATION' | 'SUPPLY_CHAIN' | 'LICENSING';
export interface IndependentReviewRecord {
  readonly scope: IndependentReviewScope;
  readonly reviewerId: string;
  readonly reviewerOrganization: string;
  readonly subjectOrganization: string;
  readonly conflictOfInterestDeclared: boolean;
  readonly signed: boolean;
  readonly verdict: 'PASS' | 'FAIL' | 'QUALIFIED';
  readonly criticalFindings: number;
  readonly highFindings: number;
  readonly unresolvedLicenseBlockers: number;
  readonly evidenceRefs: readonly string[];
}
export interface IndependentReviewQualificationEvidence {
  readonly envelope: ExternalEvidenceEnvelope;
  readonly reviews: readonly IndependentReviewRecord[];
}

export function evaluateIndependentReviewQualification(evidence: IndependentReviewQualificationEvidence): QualificationResult<Readonly<Record<string, unknown>>> {
  const findings = validateExternalEvidenceEnvelope(evidence.envelope, 'independent-security-isolation-license-review');
  const required: readonly IndependentReviewScope[] = ['PENETRATION', 'ISOLATION', 'SUPPLY_CHAIN', 'LICENSING'];
  const byScope = new Map<IndependentReviewScope, IndependentReviewRecord>();
  for (const review of evidence.reviews) {
    if (byScope.has(review.scope)) findings.push(finding('REVIEW_SCOPE_DUPLICATE', `Duplicate review scope: ${review.scope}.`));
    byScope.set(review.scope, review);
    if (review.reviewerId.trim() === '' || review.reviewerOrganization.trim() === '' || review.subjectOrganization.trim() === '') findings.push(finding('REVIEW_IDENTITY_REQUIRED', `${review.scope} review identity is incomplete.`));
    if (review.reviewerOrganization === review.subjectOrganization || review.conflictOfInterestDeclared) findings.push(finding('REVIEW_NOT_INDEPENDENT', `${review.scope} review is not independent.`));
    if (!review.signed) findings.push(finding('REVIEW_UNSIGNED', `${review.scope} review is unsigned.`));
    if (review.verdict !== 'PASS') findings.push(finding('REVIEW_VERDICT_NOT_PASS', `${review.scope} verdict is ${review.verdict}.`));
    if (review.criticalFindings !== 0 || review.highFindings !== 0) findings.push(finding('REVIEW_HIGH_SEVERITY_OPEN', `${review.scope} has unresolved high-severity findings.`));
    if (review.scope === 'LICENSING' && review.unresolvedLicenseBlockers !== 0) findings.push(finding('REVIEW_LICENSE_BLOCKER_OPEN', 'Licensing blockers remain unresolved.'));
    if (review.evidenceRefs.length === 0 || review.evidenceRefs.some((ref) => ref.trim() === '')) findings.push(finding('REVIEW_EVIDENCE_MISSING', `${review.scope} has no evidence references.`));
  }
  for (const scope of required) if (!byScope.has(scope)) findings.push(finding('REVIEW_SCOPE_MISSING', `Missing independent review scope: ${scope}.`));
  return qualificationResult('independent-security-isolation-license-review', { reviewCount: evidence.reviews.length, scopeCount: byScope.size }, findings, evidence);
}
