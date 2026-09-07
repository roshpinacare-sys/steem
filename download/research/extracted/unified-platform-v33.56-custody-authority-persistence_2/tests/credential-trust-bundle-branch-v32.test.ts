import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope, type SigningIdentity } from '../src/contracts/crypto.js';
import { CredentialIssuerTrustRegistry } from '../src/security/credential-issuer-trust.js';
import { ReviewerTrustRegistry } from '../src/security/reviewer-trust.js';
import { ProviderTrustRegistry } from '../src/security/provider-trust.js';
import {
  createCredentialTrustBundle, credentialTrustBundleDigest, FileCredentialTrustAnchor, FileCredentialTrustBundleStore,
  verifyAndImportCredentialTrustBundle, type CredentialTrustBundle, type CredentialTrustBundleSignaturePayload,
} from '../src/platform/credential-trust-bundle.js';

const now = new Date('2026-07-18T03:00:00.000Z');
function fixture() {
  const roots = [generateSigningIdentity('branch-root-a'), generateSigningIdentity('branch-root-b')] as const; const issuer = generateSigningIdentity('branch-issuer'); const reviewer = generateSigningIdentity('branch-reviewer'); const provider = generateSigningIdentity('branch-provider');
  const registry = new KeyRegistry(); for (const id of [...roots,issuer,reviewer,provider]) registry.register(id.keyId,id.publicKey);
  const issuerTrust = new CredentialIssuerTrustRegistry(registry,new Set(roots.map(r=>r.keyId)));
  const grant=signEnvelope({grantId:'branch-grant',issuerKeyId:issuer.keyId,credentialKinds:['REVIEWER','PROVIDER'] as const,tenantIds:['tenant-1'],scopes:['campaign.review','model.invoke'],issuedAt:new Date(now.getTime()-60_000).toISOString(),expiresAt:new Date(now.getTime()+600_000).toISOString(),rootAuthorityId:roots[0].keyId},roots[0]);issuerTrust.registerGrant(grant);const grantDigest=sha256(grant);
  const reviewerTrust=new ReviewerTrustRegistry(registry,issuerTrust,()=>now);reviewerTrust.register(signEnvelope({credentialId:'branch-reviewer-credential',reviewerKeyId:reviewer.keyId,organizationId:'org-a',roles:['INDEPENDENT_REVIEWER'] as const,tenantIds:['tenant-1'],scopes:['campaign.review'],issuedAt:new Date(now.getTime()-30_000).toISOString(),expiresAt:new Date(now.getTime()+300_000).toISOString(),issuerId:issuer.keyId,issuerGrantDigest:grantDigest},issuer));
  const providerTrust=new ProviderTrustRegistry(registry,issuerTrust,()=>now);providerTrust.register(signEnvelope({credentialId:'branch-provider-credential',providerId:'provider-a',providerKeyId:provider.keyId,allowedModels:['sol-5.6-qualified'],tenantIds:['tenant-1'],scopes:['model.invoke'] as const,issuedAt:new Date(now.getTime()-30_000).toISOString(),expiresAt:new Date(now.getTime()+300_000).toISOString(),issuerId:issuer.keyId,issuerGrantDigest:grantDigest},issuer));
  const pins={fingerprints:new Map(roots.map(r=>[r.keyId,registry.fingerprint(r.keyId)!])),custodianIds:new Map([[roots[0].keyId,'custodian-a'],[roots[1].keyId,'custodian-b']]),threshold:2};
  const create=(id='branch-bundle',generatedAt=now.toISOString(),predecessorBundleDigest?:string,rootSigners:readonly SigningIdentity[]=roots)=>createCredentialTrustBundle({bundleId:id,generatedAt,...(predecessorBundleDigest===undefined?{}:{predecessorBundleDigest}),rootPolicy:{trustedRootKeyIds:roots.map(r=>r.keyId),custodianIdsByRootKeyId:Object.fromEntries([[roots[0].keyId,'custodian-a'],[roots[1].keyId,'custodian-b']]),threshold:2},rootSigners,keyRegistry:registry,issuerTrust,reviewerTrust,providerTrust});
  return{roots,issuer,reviewer,provider,registry,issuerTrust,reviewerTrust,providerTrust,pins,create};
}
function resign(h:ReturnType<typeof fixture>,candidate:CredentialTrustBundle,signers:readonly SigningIdentity[]=h.roots):CredentialTrustBundle{const payloadDigest=sha256(candidate.payload);const material:CredentialTrustBundleSignaturePayload={bundleId:candidate.payload.bundleId,payloadDigest,generatedAt:candidate.payload.generatedAt,...(candidate.payload.predecessorBundleDigest===undefined?{}:{predecessorBundleDigest:candidate.payload.predecessorBundleDigest})};return{payload:candidate.payload,rootSignatures:signers.map(s=>signEnvelope(material,s)).sort((a,b)=>a.issuerKeyId.localeCompare(b.issuerKeyId))};}
function pending(bundle:CredentialTrustBundle,priorBundleDigest?:string){const material={version:1 as const,...(priorBundleDigest===undefined?{}:{priorBundleDigest}),nextBundleDigest:credentialTrustBundleDigest(bundle),bundleId:bundle.payload.bundleId,generatedAt:bundle.payload.generatedAt,bundle};return{...material,intentDigest:sha256(material)};}

test('bundle creation rejects malformed identity, policy, signer set and unavailable roots',()=>{const h=fixture();const rogue=generateSigningIdentity('branch-rogue');h.registry.register(rogue.keyId,rogue.publicKey);
  assert.throws(()=>h.create('',now.toISOString()),/identity_invalid/);assert.throws(()=>h.create('x','bad'),/identity_invalid/);assert.throws(()=>h.create('x',now.toISOString(),'bad'),/predecessor_invalid/);
  const base={bundleId:'x',generatedAt:now.toISOString(),rootPolicy:{trustedRootKeyIds:h.roots.map(r=>r.keyId),custodianIdsByRootKeyId:Object.fromEntries([[h.roots[0].keyId,'custodian-a'],[h.roots[1].keyId,'custodian-b']]),threshold:2},keyRegistry:h.registry,issuerTrust:h.issuerTrust,reviewerTrust:h.reviewerTrust,providerTrust:h.providerTrust};
  assert.throws(()=>createCredentialTrustBundle({...base,rootPolicy:{trustedRootKeyIds:[h.roots[0].keyId,h.roots[0].keyId],custodianIdsByRootKeyId:{[h.roots[0].keyId]:'custodian-a'},threshold:2},rootSigners:h.roots}),/root_policy_invalid/);
  assert.throws(()=>createCredentialTrustBundle({...base,rootPolicy:{...base.rootPolicy,threshold:0},rootSigners:h.roots}),/threshold_invalid/);
  assert.throws(()=>createCredentialTrustBundle({...base,rootSigners:[h.roots[0],h.roots[0]]}),/signer_duplicate/);
  assert.throws(()=>createCredentialTrustBundle({...base,rootSigners:[h.roots[0],rogue]}),/signer_not_authorized/);
  assert.throws(()=>createCredentialTrustBundle({...base,rootSigners:[h.roots[0]]}),/threshold_not_met/);
  assert.throws(()=>createCredentialTrustBundle({...base,rootPolicy:{...base.rootPolicy,custodianIdsByRootKeyId:Object.fromEntries(h.roots.map(r=>[r.keyId,'same-custodian']))},rootSigners:h.roots}),/custodian_threshold_not_met/);
  h.registry.revoke(h.roots[1].keyId);assert.throws(()=>createCredentialTrustBundle({...base,rootSigners:h.roots}),/root_revoked/);
});

test('bundle verification rejects duplicate keys, revoked roots, unpinned and duplicate root signatures',()=>{const h=fixture();const b=h.create();
  assert.throws(()=>verifyAndImportCredentialTrustBundle(resign(h,{...b,payload:{...b.payload,publicKeys:[...b.payload.publicKeys,b.payload.publicKeys[0]!]}}),h.pins),/public_key_duplicate/);
  const rootRevoked=b.payload.publicKeys.map(r=>r.keyId===h.roots[0].keyId?{...r,revoked:true}:r);assert.throws(()=>verifyAndImportCredentialTrustBundle(resign(h,{...b,payload:{...b.payload,publicKeys:rootRevoked}}),h.pins),/root_revoked/);
  const rogue=generateSigningIdentity('bundle-signature-rogue');h.registry.register(rogue.keyId,rogue.publicKey);const roguePayload={...b.payload,publicKeys:[...b.payload.publicKeys,h.registry.exportPublicKey(rogue.keyId)]};const withRogue=resign(h,{...b,payload:roguePayload},[...h.roots,rogue]);assert.throws(()=>verifyAndImportCredentialTrustBundle(withRogue,h.pins),/signature_root_not_pinned/);
  assert.throws(()=>verifyAndImportCredentialTrustBundle({...b,rootSignatures:[b.rootSignatures[0]!,b.rootSignatures[0]!,b.rootSignatures[1]!]},h.pins),/signature_duplicate/);
});

test('bundle shape validation rejects version, root order, lists, limitations and acceptance-time corruption',()=>{const h=fixture();const b=h.create();
  assert.throws(()=>verifyAndImportCredentialTrustBundle(null as never,h.pins),/bundle_invalid/);
  assert.throws(()=>verifyAndImportCredentialTrustBundle({...b,payload:{...b.payload,version:2 as never}},h.pins),/bundle_invalid/);
  assert.throws(()=>verifyAndImportCredentialTrustBundle({...b,payload:{...b.payload,rootPolicy:{...b.payload.rootPolicy,trustedRootKeyIds:[...b.payload.rootPolicy.trustedRootKeyIds].reverse()}}},h.pins),/root_policy_not_canonical/);
  assert.throws(()=>verifyAndImportCredentialTrustBundle({...b,payload:{...b.payload,limitations:[]}},h.pins),/limitations_required/);
  assert.throws(()=>verifyAndImportCredentialTrustBundle({...b,payload:{...b.payload,limitations:['']}},h.pins),/limitations_required/);
  assert.throws(()=>verifyAndImportCredentialTrustBundle({...b,payload:{...b.payload,publicKeys:null as never}},h.pins),/bundle_invalid/);
  assert.throws(()=>verifyAndImportCredentialTrustBundle({...b,payload:{...b.payload,reviewerCredentials:b.payload.reviewerCredentials.map(r=>({...r,acceptedAt:'bad'}))}},h.pins),/acceptance_time_invalid/);
});

test('anchor and store validate identities, missing state, monotonic time and readBundle success',()=>{const h=fixture();assert.throws(()=>new FileCredentialTrustAnchor(''),/path_required/);assert.throws(()=>new FileCredentialTrustBundleStore('',h.pins),/path_required/);
  const dir=mkdtempSync(join(tmpdir(),'bundle-branch-store-'));const anchor=new FileCredentialTrustAnchor(join(dir,'anchor.json'));assert.equal(anchor.current(),undefined);assert.throws(()=>anchor.advance({bundleDigest:'bad',bundleId:'x',generatedAt:now.toISOString()}),/input_invalid/);assert.throws(()=>anchor.advance({bundleDigest:'0'.repeat(64),bundleId:'',generatedAt:now.toISOString()}),/input_invalid/);assert.throws(()=>anchor.advance({bundleDigest:'0'.repeat(64),bundleId:'x',generatedAt:'bad'}),/input_invalid/);assert.throws(()=>anchor.advance({bundleDigest:'0'.repeat(64),bundleId:'x',generatedAt:now.toISOString(),predecessorBundleDigest:'1'.repeat(64)}),/predecessor_missing/);
  const path=join(dir,'trust.json');const store=new FileCredentialTrustBundleStore(path,h.pins,anchor);assert.throws(()=>store.load(),/not_found/);assert.throws(()=>store.readBundle(),/not_found/);const first=h.create();const digest=store.save(first);assert.equal(store.readBundle().payload.bundleId,first.payload.bundleId);assert.equal(anchor.advance({bundleDigest:digest,bundleId:first.payload.bundleId,generatedAt:first.payload.generatedAt}).bundleDigest,digest);assert.throws(()=>anchor.advance({bundleDigest:'2'.repeat(64),bundleId:'new',generatedAt:first.payload.generatedAt,predecessorBundleDigest:digest}),/time_not_monotonic/);
});

test('anchor file detects malformed schema, chain and head corruption',()=>{const h=fixture();const dir=mkdtempSync(join(tmpdir(),'anchor-shape-'));const path=join(dir,'anchor.json');const anchor=new FileCredentialTrustAnchor(path);const b=h.create();anchor.advance({bundleDigest:credentialTrustBundleDigest(b),bundleId:b.payload.bundleId,generatedAt:b.payload.generatedAt});
  writeFileSync(path,'{bad');assert.throws(()=>new FileCredentialTrustAnchor(path),/anchor_corrupt/);
  writeFileSync(path,JSON.stringify({schemaVersion:'2.0',records:[],anchor:null}));assert.throws(()=>new FileCredentialTrustAnchor(path),/anchor_invalid/);
  const validPath=join(dir,'valid.json');const valid=new FileCredentialTrustAnchor(validPath);valid.advance({bundleDigest:credentialTrustBundleDigest(b),bundleId:b.payload.bundleId,generatedAt:b.payload.generatedAt});const state=JSON.parse(readFileSync(validPath,'utf8'));
  state.records[0].sequence=2;writeFileSync(validPath,JSON.stringify(state));assert.throws(()=>new FileCredentialTrustAnchor(validPath),/chain_invalid/);
  const headPath=join(dir,'head.json');const head=new FileCredentialTrustAnchor(headPath);head.advance({bundleDigest:credentialTrustBundleDigest(b),bundleId:b.payload.bundleId,generatedAt:b.payload.generatedAt});const headState=JSON.parse(readFileSync(headPath,'utf8'));headState.anchor='0'.repeat(64);writeFileSync(headPath,JSON.stringify(headState));assert.throws(()=>new FileCredentialTrustAnchor(headPath),/head_invalid/);
});

test('pending recovery covers no-anchor, corrupt, invalid, already-anchored, abandoned-before-write and conflicting states',()=>{const h=fixture();const dir=mkdtempSync(join(tmpdir(),'pending-branches-'));const first=h.create();const second=h.create('second',new Date(now.getTime()+10_000).toISOString(),credentialTrustBundleDigest(first));
  const noAnchorPath=join(dir,'no-anchor.json');writeFileSync(`${noAnchorPath}.pending`,JSON.stringify(pending(first)));assert.throws(()=>new FileCredentialTrustBundleStore(noAnchorPath,h.pins).load(),/pending_without_anchor/);
  const corruptPath=join(dir,'corrupt.json');const corruptAnchor=new FileCredentialTrustAnchor(join(dir,'corrupt-anchor.json'));writeFileSync(`${corruptPath}.pending`,'{bad');assert.throws(()=>new FileCredentialTrustBundleStore(corruptPath,h.pins,corruptAnchor).load(),/pending_corrupt/);
  const invalidPath=join(dir,'invalid.json');const invalidAnchor=new FileCredentialTrustAnchor(join(dir,'invalid-anchor.json'));writeFileSync(`${invalidPath}.pending`,JSON.stringify({version:2}));assert.throws(()=>new FileCredentialTrustBundleStore(invalidPath,h.pins,invalidAnchor).load(),/pending_invalid/);
  const anchoredPath=join(dir,'anchored.json');const anchoredAnchor=new FileCredentialTrustAnchor(join(dir,'anchored-anchor.json'));const anchoredStore=new FileCredentialTrustBundleStore(anchoredPath,h.pins,anchoredAnchor);anchoredStore.save(first);const firstDigest=credentialTrustBundleDigest(first);anchoredStore.save(second);writeFileSync(`${anchoredPath}.pending`,JSON.stringify(pending(second,firstDigest)));assert.equal(anchoredStore.load().bundleDigest,credentialTrustBundleDigest(second));assert.equal(existsSync(`${anchoredPath}.pending`),false);
  const abandonedPath=join(dir,'abandoned.json');const abandonedAnchor=new FileCredentialTrustAnchor(join(dir,'abandoned-anchor.json'));const abandonedStore=new FileCredentialTrustBundleStore(abandonedPath,h.pins,abandonedAnchor);abandonedStore.save(first);writeFileSync(`${abandonedPath}.pending`,JSON.stringify(pending(second,firstDigest)));assert.equal(abandonedStore.load().bundleDigest,firstDigest);assert.equal(existsSync(`${abandonedPath}.pending`),false);
  const initialPath=join(dir,'initial.json');const initialAnchor=new FileCredentialTrustAnchor(join(dir,'initial-anchor.json'));writeFileSync(`${initialPath}.pending`,JSON.stringify(pending(first)));assert.throws(()=>new FileCredentialTrustBundleStore(initialPath,h.pins,initialAnchor).load(),/not_found/);assert.equal(existsSync(`${initialPath}.pending`),false);
  const conflictPath=join(dir,'conflict.json');const conflictAnchor=new FileCredentialTrustAnchor(join(dir,'conflict-anchor.json'));conflictAnchor.advance({bundleDigest:'f'.repeat(64),bundleId:'other',generatedAt:new Date(now.getTime()-10_000).toISOString()});writeFileSync(conflictPath,JSON.stringify(second));writeFileSync(`${conflictPath}.pending`,JSON.stringify(pending(second,firstDigest)));assert.throws(()=>new FileCredentialTrustBundleStore(conflictPath,h.pins,conflictAnchor).load(),/pending_anchor_conflict|pending_state_conflict/);
});
