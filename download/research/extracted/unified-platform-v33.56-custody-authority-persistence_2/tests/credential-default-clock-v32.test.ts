import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import { CredentialIssuerTrustRegistry } from '../src/security/credential-issuer-trust.js';
import { ReviewerTrustRegistry } from '../src/security/reviewer-trust.js';
import { ProviderTrustRegistry } from '../src/security/provider-trust.js';

test('reviewer and provider registries exercise their production default clocks', () => {
  const now = new Date(); const root = generateSigningIdentity('default-clock-root'); const issuer = generateSigningIdentity('default-clock-issuer'); const reviewer = generateSigningIdentity('default-clock-reviewer'); const provider = generateSigningIdentity('default-clock-provider'); const registry = new KeyRegistry();
  for (const identity of [root,issuer,reviewer,provider]) registry.register(identity.keyId,identity.publicKey);
  const issuerTrust = new CredentialIssuerTrustRegistry(registry,new Set([root.keyId]));
  const grant=signEnvelope({grantId:'default-clock-grant',issuerKeyId:issuer.keyId,credentialKinds:['REVIEWER','PROVIDER'] as const,tenantIds:['tenant-1'],scopes:['campaign.review','model.invoke'],issuedAt:new Date(now.getTime()-60_000).toISOString(),expiresAt:new Date(now.getTime()+600_000).toISOString(),rootAuthorityId:root.keyId},root);issuerTrust.registerGrant(grant);const grantDigest=sha256(grant);
  const reviewerTrust=new ReviewerTrustRegistry(registry,issuerTrust);reviewerTrust.register(signEnvelope({credentialId:'default-clock-reviewer-credential',reviewerKeyId:reviewer.keyId,organizationId:'org-a',roles:['INDEPENDENT_REVIEWER'] as const,tenantIds:['tenant-1'],scopes:['campaign.review'],issuedAt:new Date(now.getTime()-30_000).toISOString(),expiresAt:new Date(now.getTime()+300_000).toISOString(),issuerId:issuer.keyId,issuerGrantDigest:grantDigest},issuer));
  const providerTrust=new ProviderTrustRegistry(registry,issuerTrust);providerTrust.register(signEnvelope({credentialId:'default-clock-provider-credential',providerId:'provider-a',providerKeyId:provider.keyId,allowedModels:['sol-5.6-qualified'],tenantIds:['tenant-1'],scopes:['model.invoke'] as const,issuedAt:new Date(now.getTime()-30_000).toISOString(),expiresAt:new Date(now.getTime()+300_000).toISOString(),issuerId:issuer.keyId,issuerGrantDigest:grantDigest},issuer));
  assert.equal(reviewerTrust.listCredentialRecords().length,1);assert.equal(providerTrust.listCredentialRecords().length,1);
});
