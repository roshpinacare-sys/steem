import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { KeyRegistry } from '../contracts/crypto.js';
import { FileCampaignStore, GovernedCampaignTracker, type CampaignItemResult } from '../product/engineering-campaign.js';
import { ReviewerTrustRegistry, type SignedReviewerCredential } from '../security/reviewer-trust.js';
import { CredentialIssuerTrustRegistry, type SignedCredentialIssuerGrant } from '../security/credential-issuer-trust.js';

interface Input {
  readonly root: string;
  readonly campaignId: string;
  readonly result: CampaignItemResult;
  readonly publicKeys: readonly { readonly keyId: string; readonly pem: string }[];
  readonly reviewerCredentials: readonly SignedReviewerCredential[];
  readonly credentialIssuerRootKeyIds: readonly string[];
  readonly credentialIssuerGrants: readonly SignedCredentialIssuerGrant[];
  readonly acceptedAt: string;
}
const inputPath = process.argv[2];
if (inputPath === undefined) throw new Error('campaign_worker_input_required');
const input = JSON.parse(readFileSync(inputPath, 'utf8')) as Input;
const registry = new KeyRegistry();
for (const row of input.publicKeys) registry.register(row.keyId, createPublicKey(row.pem));
const issuerTrust = new CredentialIssuerTrustRegistry(registry, new Set(input.credentialIssuerRootKeyIds));
for (const grant of input.credentialIssuerGrants) issuerTrust.registerGrant(grant);
const acceptedAt = new Date(input.acceptedAt); if (!Number.isFinite(acceptedAt.getTime())) throw new Error('campaign_worker_acceptance_time_invalid');
const reviewerTrust = new ReviewerTrustRegistry(registry, issuerTrust, () => acceptedAt);
for (const credential of input.reviewerCredentials) reviewerTrust.register(credential);
const snapshot = new GovernedCampaignTracker(registry, reviewerTrust, new FileCampaignStore(input.root)).record(input.campaignId, input.result);
process.stdout.write(`${JSON.stringify({ status: 'passed', resultCount: snapshot.results.length, digest: snapshot.digest })}\n`);
