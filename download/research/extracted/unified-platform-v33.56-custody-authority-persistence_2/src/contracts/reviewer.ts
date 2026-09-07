export const REVIEWER_ROLES = ['INDEPENDENT_REVIEWER', 'SECURITY_REVIEWER', 'TEST_REVIEWER', 'OPERATIONS_REVIEWER'] as const;
export type ReviewerRole = (typeof REVIEWER_ROLES)[number];

export interface AuthorizedReviewer {
  readonly reviewerKeyId: string;
  readonly organizationId: string;
  readonly role: ReviewerRole;
  readonly credentialDigest: string;
}

export interface ReviewerAuthorizer {
  authorize(input: {
    readonly reviewerKeyId: string;
    readonly tenantId: string;
    readonly scope: string;
    readonly role: ReviewerRole;
    readonly at: string;
  }): AuthorizedReviewer;
}
