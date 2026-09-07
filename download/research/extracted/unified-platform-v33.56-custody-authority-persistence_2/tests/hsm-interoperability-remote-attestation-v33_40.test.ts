import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope, type SigningIdentity } from '../src/contracts/crypto.js';
import type { QualificationActorDescriptorV33_36 } from '../src/app/external-https-monitor-qualification-v33_36.js';
import type { ExternalCustodyHardwareQualificationVerdictV33_39, ThresholdOperationEvidenceV33_39 } from '../src/app/external-custody-hsm-threshold-recovery-v33_39.js';
import {
  createCrossSiteRecoveryReceiptV33_40,
  createInteroperabilityMonitorReceiptV33_40,
  createMultiProviderCustodianApprovalV33_40,
  createPublicInteroperabilityCheckpointV33_40,
  createRemoteAttestationEvidenceV33_40,
  createSignedHsmAdapterManifestV33_40,
  finalizeMultiProviderThresholdV33_40,
  verifyAdapterManifestsV33_40,
  verifyCheckpointAndReceiptsV33_40,
  verifyCrossSiteRecoveryV33_40,
  verifyHsmInteroperabilityQualificationV33_40,
  verifyMultiProviderThresholdV33_40,
  verifyRemoteAttestationsV33_40,
  type InteroperabilityTrustV33_40,
  type MultiProviderThresholdCertificateV33_40,
  type SignedHsmAdapterManifestV33_40,
} from '../src/app/hsm-interoperability-remote-attestation-v33_40.js';
import type { SignedEnvelope } from '../src/contracts/crypto.js';

const now = new Date('2026-07-23T08:00:00.000Z');
const expires = new Date('2026-08-23T08:00:00.000Z');

function registry(ids: readonly SigningIdentity[]): KeyRegistry { const r = new KeyRegistry(); for (const id of ids) r.register(id.keyId, id.publicKey); return r; }
function actor(id: SigningIdentity, n: string): QualificationActorDescriptorV33_36 {
  const r = registry([id]);
  return { keyId: id.keyId, keyFingerprint: r.fingerprint(id.keyId)!, organizationId: `org-${n}`, hostId: `host-${n}`, administratorId: `admin-${n}` };
}

function setup() {
  const adapterSigners = [0,1,2].map(i => generateSigningIdentity(`adapter-signer-${i}`));
  const attestationAuthorities = [0,1,2].map(i => generateSigningIdentity(`attestation-authority-${i}`));
  const custodians = [0,1,2,3,4].map(i => generateSigningIdentity(`interop-custodian-${i}`));
  const thresholdAuthority = generateSigningIdentity('interop-threshold-authority');
  const publicationAuthority = generateSigningIdentity('interop-publication-authority');
  const monitors = [0,1,2].map(i => generateSigningIdentity(`interop-monitor-${i}`));
  const recoveryVerifier = generateSigningIdentity('interop-recovery-verifier');
  const roleKeys = [0,1,2,3,4].map(i => generateSigningIdentity(`interop-role-${i}`));
  const trust: InteroperabilityTrustV33_40 = {
    adapterSignerRegistry: registry(adapterSigners), trustedAdapterSignerIds: adapterSigners.map(x=>x.keyId),
    attestationAuthorityRegistry: registry(attestationAuthorities), trustedAttestationAuthorityIds: attestationAuthorities.map(x=>x.keyId),
    custodianRegistry: registry(custodians), trustedCustodianIds: custodians.map(x=>x.keyId),
    thresholdAuthorityRegistry: registry([thresholdAuthority]), trustedThresholdAuthorityIds: [thresholdAuthority.keyId],
    publicationAuthorityRegistry: registry([publicationAuthority]), trustedPublicationAuthorityIds: [publicationAuthority.keyId],
    monitorRegistry: registry(monitors), trustedMonitorIds: monitors.map(x=>x.keyId),
    recoveryVerifierRegistry: registry([recoveryVerifier]), trustedRecoveryVerifierIds: [recoveryVerifier.keyId],
  };
  const modules = [Buffer.from('pkcs11 module bytes'), Buffer.from('aws cloudhsm adapter bytes'), Buffer.from('azure hsm adapter bytes')];
  const manifestInputs = [
    ['PKCS11_GENERIC','provider-pkcs11','PKCS11-3.1'],
    ['AWS_CLOUDHSM','provider-aws','PROVIDER_NATIVE_SIGNING_API'],
    ['AZURE_MANAGED_HSM','provider-azure','PROVIDER_NATIVE_SIGNING_API'],
  ] as const;
  const manifests = manifestInputs.map((row,i) => createSignedHsmAdapterManifestV33_40({
    signer: adapterSigners[i]!, adapterClass: row[0], providerId: row[1], moduleName: `module-${i}`, moduleVersion: '1.0.0', moduleBytes: modules[i]!,
    interfaceStandard: row[2], abi: 'linux-x64', conformanceVectorDigest: sha256({vector:i}), issuedAt: now, expiresAt: expires, executionClass: 'LOCAL_INTEROP_REHEARSAL',
  }));
  const moduleBytesByManifestDigest = new Map(manifests.map((m,i)=>[m.payload.manifestDigest, modules[i]!]));
  const documents = roleKeys.map((_,i)=>Buffer.from(`attestation-document-${i}`));
  const challenges = roleKeys.map((_,i)=>Buffer.from(`attestation-challenge-${i}`));
  const attestations = roleKeys.map((role,i)=>createRemoteAttestationEvidenceV33_40({
    authority: attestationAuthorities[i%3]!, adapterManifest: manifests[i%3]!.payload, roleKeyId: role.keyId,
    roleKeyFingerprint: registry([role]).fingerprint(role.keyId)!, deviceId: `device-${i}`, firmwareDigest: sha256({firmware:i}),
    attestationDocument: documents[i]!, challenge: challenges[i]!, observedAt: now, expiresAt: expires, executionClass: 'LOCAL_INTEROP_REHEARSAL',
  }));
  const documentsByEvidenceDigest = new Map(attestations.map((a,i)=>[a.payload.evidenceDigest, documents[i]!]));
  const challengesByEvidenceDigest = new Map(attestations.map((a,i)=>[a.payload.evidenceDigest, challenges[i]!]));
  const ceremonyDigest = sha256({ceremony:'v33.40'}); const operationDigest = sha256({operation:'checkpoint-v33.40'});
  const providers = ['provider-pkcs11','provider-aws','provider-azure','provider-gcp','provider-dedicated'];
  const custodianActors = custodians.map((c,i)=>actor(c,`custodian-${i}`));
  const approvals = custodians.slice(0,3).map((c,i)=>createMultiProviderCustodianApprovalV33_40({
    custodian:c, descriptor:custodianActors[i]!, ceremonyDigest, operationDigest, shareIndex:i+1, providerId:providers[i]!,
    adapterManifestDigest:manifests[i%3]!.payload.manifestDigest, remoteAttestationDigest:attestations[i]!.payload.evidenceDigest, approvedAt:now,
  }));
  const priorThresholdDigest = sha256({prior:'v33.39-threshold-head'});
  const thresholdEnvelope = finalizeMultiProviderThresholdV33_40({ authority:thresholdAuthority, ceremonyDigest, operationDigest, thresholdSequence:4, previousThresholdDigest:priorThresholdDigest, approvals, trust, issuedAt:now });
  const priorVerdict = {
    version:'33.39', manifestDigest:sha256({m:39}), transcriptDigest:sha256({t:39}), priorCustodyVerdictDigest:sha256({p:38}), hardwareAttestationCount:11,
    hardwareBoundRoleCount:0, threshold:3, configuredCustodianCount:5, thresholdHeadDigest:priorThresholdDigest, publicCheckpointPublicationDigest:sha256({cp:39}),
    publicCheckpointSequence:1, retrievalReceiptCount:3, revocationReceiptCount:3, recoveryDigest:sha256({r:39}), custodyTransferVerified:true,
    revocationPropagationVerified:true, siteRecoveryVerified:true, status:'LOCAL_HSM_THRESHOLD_RECOVERY_REHEARSAL_ONLY', externalTopologyObserved:false,
    externalHardwareObserved:false, externalHumanParticipants:0, verifiedAt:now.toISOString(), productionAuthority:'NONE', externalEffectsExecuted:0,
    verdictDigest:sha256({verdict:'v33.39'}),
  } as ExternalCustodyHardwareQualificationVerdictV33_39;
  const priorThresholdEvidence = [0,1,2].map((i)=>({ certificate:{ payload:{thresholdDigest:i===2?priorThresholdDigest:sha256({i})} } })) as unknown as ThresholdOperationEvidenceV33_39[];
  const checkpointBytes = Buffer.from('public interop checkpoint bytes v33.40');
  const publisher = generateSigningIdentity('interop-publisher'); const publisherActor=actor(publisher,'publisher');
  const checkpoint = createPublicInteroperabilityCheckpointV33_40({ authority:publicationAuthority, priorV33_39Verdict:priorVerdict, thresholdCertificate:thresholdEnvelope.payload,
    adapterManifestDigests:manifests.map(m=>m.payload.manifestDigest), remoteAttestationDigests:attestations.map(a=>a.payload.evidenceDigest),
    previousCheckpointDigest:sha256({checkpoint:'previous'}), checkpointSequence:2, endpoint:'https://checkpoint.local/v33.40.json', dnsName:'checkpoint.local',
    checkpointBytes, publisher:publisherActor, publishedAt:now, executionClass:'LOCAL_INTEROP_REHEARSAL', publicNetworkRetrievalObserved:false });
  const monitorActors=monitors.map((m,i)=>actor(m,`monitor-${i}`));
  const receipts=monitors.map((m,i)=>createInteroperabilityMonitorReceiptV33_40({monitor:m,descriptor:monitorActors[i]!,providerId:providers[i]!,checkpoint:checkpoint.payload,retrievedBytes:checkpointBytes,retrievedAt:now,networkClass:'LOCAL_LOOPBACK'}));
  const recoveryBytes=Buffer.from(checkpointBytes);
  const recovery=createCrossSiteRecoveryReceiptV33_40({verifier:recoveryVerifier,descriptor:actor(recoveryVerifier,'recovery'),priorRecoveryDigest:priorVerdict.recoveryDigest,
    sourceSiteId:'site-a',targetSiteId:'site-b',sourceProviderId:'provider-aws',targetProviderId:'provider-azure',checkpoint:checkpoint.payload,restoredBytes:recoveryBytes,
    thresholdCertificateDigest:thresholdEnvelope.payload.certificateDigest,recoverySequence:2,recoveredAt:now,executionClass:'LOCAL_INTEROP_REHEARSAL'});
  const final=()=>verifyHsmInteroperabilityQualificationV33_40({priorV33_39Verdict:priorVerdict,priorV33_39ThresholdEvidence:priorThresholdEvidence,manifests,moduleBytesByManifestDigest,
    attestations,documentsByEvidenceDigest,challengesByEvidenceDigest,thresholdEvidence:{approvals,certificate:thresholdEnvelope},checkpoint,checkpointBytes,monitorReceipts:receipts,
    recoveryReceipt:recovery,restoredBytes:recoveryBytes,trust,verifiedAt:now});
  return {adapterSigners,attestationAuthorities,custodians,thresholdAuthority,publicationAuthority,monitors,recoveryVerifier,roleKeys,trust,modules,manifests,moduleBytesByManifestDigest,
    documents,challenges,attestations,documentsByEvidenceDigest,challengesByEvidenceDigest,ceremonyDigest,operationDigest,custodianActors,approvals,priorThresholdDigest,thresholdEnvelope,
    priorVerdict,priorThresholdEvidence,checkpointBytes,checkpoint,monitorActors,receipts,recoveryBytes,recovery,final,providers};
}

const s=setup();

test('three signed adapter manifests verify across three providers',()=>assert.equal(verifyAdapterManifestsV33_40({manifests:s.manifests,moduleBytesByManifestDigest:s.moduleBytesByManifestDigest,trust:s.trust,verifiedAt:now}).providerCount,3));
test('five remote attestations verify across three providers',()=>assert.equal(verifyRemoteAttestationsV33_40({attestations:s.attestations,manifests:s.manifests,documentsByEvidenceDigest:s.documentsByEvidenceDigest,challengesByEvidenceDigest:s.challengesByEvidenceDigest,trust:s.trust,verifiedAt:now}).providerCount,3));
test('multi-provider threshold verifies three of five',()=>assert.equal(verifyMultiProviderThresholdV33_40({evidence:{approvals:s.approvals,certificate:s.thresholdEnvelope},trust:s.trust,verifiedAt:now}).distinctProviderCount,3));
test('checkpoint and three monitor receipts verify',()=>assert.equal(verifyCheckpointAndReceiptsV33_40({checkpoint:s.checkpoint,checkpointBytes:s.checkpointBytes,receipts:s.receipts,trust:s.trust,verifiedAt:now}).externalTopologyObserved,false));
test('cross-site recovery verifies exact restored bytes',()=>assert.equal(verifyCrossSiteRecoveryV33_40({receipt:s.recovery,checkpoint:s.checkpoint.payload,restoredBytes:s.recoveryBytes,trust:s.trust,verifiedAt:now}).forkDetected,false));
test('full qualification remains local-only and blocked',()=>{const v=s.final();assert.equal(v.status,'LOCAL_MULTI_PROVIDER_INTEROP_REHEARSAL_ONLY');assert.equal(v.productionAuthority,'NONE');assert.equal(v.externalEffectsExecuted,0);});

test('adapter module substitution is rejected',()=>{const map=new Map(s.moduleBytesByManifestDigest);map.set(s.manifests[0]!.payload.manifestDigest,Buffer.from('tampered'));assert.throws(()=>verifyAdapterManifestsV33_40({manifests:s.manifests,moduleBytesByManifestDigest:map,trust:s.trust,verifiedAt:now}));});
test('adapter signature tampering is rejected',()=>{const bad={...s.manifests[0]!,signature:s.manifests[1]!.signature};assert.throws(()=>verifyAdapterManifestsV33_40({manifests:[bad,s.manifests[1]!,s.manifests[2]!],moduleBytesByManifestDigest:s.moduleBytesByManifestDigest,trust:s.trust,verifiedAt:now}));});
test('fewer than three adapters is rejected',()=>assert.throws(()=>verifyAdapterManifestsV33_40({manifests:s.manifests.slice(0,2),moduleBytesByManifestDigest:s.moduleBytesByManifestDigest,trust:s.trust,verifiedAt:now})));
test('adapter provider diversity is required',()=>{const rows=s.manifests.map((m,i)=>{const material={...m.payload,providerId:'one-provider'};delete (material as any).manifestDigest;return signEnvelope({...material,manifestDigest:sha256(material)},s.adapterSigners[i]!)});const map=new Map(rows.map((r,i)=>[r.payload.manifestDigest,s.modules[i]!]));assert.throws(()=>verifyAdapterManifestsV33_40({manifests:rows,moduleBytesByManifestDigest:map,trust:s.trust,verifiedAt:now}));});
test('external software adapter is forbidden',()=>assert.throws(()=>createSignedHsmAdapterManifestV33_40({signer:s.adapterSigners[0]!,adapterClass:'SOFTWARE_REHEARSAL',providerId:'p',moduleName:'m',moduleVersion:'1',moduleBytes:Buffer.from('m'),interfaceStandard:'PROVIDER_NATIVE_SIGNING_API',abi:'linux-x64',conformanceVectorDigest:sha256({x:1}),issuedAt:now,expiresAt:expires,executionClass:'LIVE_EXTERNAL_MULTI_PROVIDER'})));
test('pkcs11 adapter requires pkcs11 interface',()=>assert.throws(()=>createSignedHsmAdapterManifestV33_40({signer:s.adapterSigners[0]!,adapterClass:'PKCS11_GENERIC',providerId:'p',moduleName:'m',moduleVersion:'1',moduleBytes:Buffer.from('m'),interfaceStandard:'PROVIDER_NATIVE_SIGNING_API',abi:'linux-x64',conformanceVectorDigest:sha256({x:1}),issuedAt:now,expiresAt:expires,executionClass:'LOCAL_INTEROP_REHEARSAL'})));

test('attestation document substitution is rejected',()=>{const docs=new Map(s.documentsByEvidenceDigest);docs.set(s.attestations[0]!.payload.evidenceDigest,Buffer.from('bad'));assert.throws(()=>verifyRemoteAttestationsV33_40({attestations:s.attestations,manifests:s.manifests,documentsByEvidenceDigest:docs,challengesByEvidenceDigest:s.challengesByEvidenceDigest,trust:s.trust,verifiedAt:now}));});
test('attestation challenge substitution is rejected',()=>{const challenges=new Map(s.challengesByEvidenceDigest);challenges.set(s.attestations[0]!.payload.evidenceDigest,Buffer.from('bad'));assert.throws(()=>verifyRemoteAttestationsV33_40({attestations:s.attestations,manifests:s.manifests,documentsByEvidenceDigest:s.documentsByEvidenceDigest,challengesByEvidenceDigest:challenges,trust:s.trust,verifiedAt:now}));});
test('duplicate attested role key is rejected',()=>assert.throws(()=>verifyRemoteAttestationsV33_40({attestations:[...s.attestations.slice(0,4),s.attestations[0]!],manifests:s.manifests,documentsByEvidenceDigest:s.documentsByEvidenceDigest,challengesByEvidenceDigest:s.challengesByEvidenceDigest,trust:s.trust,verifiedAt:now})));
test('duplicate attested device is rejected even when resigned',()=>{const base=s.attestations[4]!.payload;const material={...base,deviceId:s.attestations[0]!.payload.deviceId};delete (material as any).evidenceDigest;const e=signEnvelope({...material,evidenceDigest:sha256(material)},s.attestationAuthorities[1]!);const docs=new Map(s.documentsByEvidenceDigest).set(e.payload.evidenceDigest,s.documents[4]!);const challenges=new Map(s.challengesByEvidenceDigest).set(e.payload.evidenceDigest,s.challenges[4]!);assert.throws(()=>verifyRemoteAttestationsV33_40({attestations:[...s.attestations.slice(0,4),e],manifests:s.manifests,documentsByEvidenceDigest:docs,challengesByEvidenceDigest:challenges,trust:s.trust,verifiedAt:now}));});
test('expired remote attestation is rejected',()=>assert.throws(()=>verifyRemoteAttestationsV33_40({attestations:s.attestations,manifests:s.manifests,documentsByEvidenceDigest:s.documentsByEvidenceDigest,challengesByEvidenceDigest:s.challengesByEvidenceDigest,trust:s.trust,verifiedAt:new Date('2027-01-01T00:00:00Z')})));

test('threshold below quorum is rejected',()=>assert.throws(()=>finalizeMultiProviderThresholdV33_40({authority:s.thresholdAuthority,ceremonyDigest:s.ceremonyDigest,operationDigest:s.operationDigest,thresholdSequence:4,previousThresholdDigest:s.priorThresholdDigest,approvals:s.approvals.slice(0,2),trust:s.trust,issuedAt:now})));
test('threshold requires three providers',()=>{const a=s.approvals.map((e,i)=>{const m={...e.payload,providerId:i<2?'provider-a':'provider-b'};delete (m as any).approvalDigest;return signEnvelope({...m,approvalDigest:sha256(m)},s.custodians[i]!)});assert.throws(()=>finalizeMultiProviderThresholdV33_40({authority:s.thresholdAuthority,ceremonyDigest:s.ceremonyDigest,operationDigest:s.operationDigest,thresholdSequence:4,previousThresholdDigest:s.priorThresholdDigest,approvals:a,trust:s.trust,issuedAt:now}));});
test('duplicate threshold share is rejected',()=>{const base=s.approvals[2]!.payload;const m={...base,shareIndex:1};delete (m as any).approvalDigest;const e=signEnvelope({...m,approvalDigest:sha256(m)},s.custodians[2]!);assert.throws(()=>finalizeMultiProviderThresholdV33_40({authority:s.thresholdAuthority,ceremonyDigest:s.ceremonyDigest,operationDigest:s.operationDigest,thresholdSequence:4,previousThresholdDigest:s.priorThresholdDigest,approvals:[s.approvals[0]!,s.approvals[1]!,e],trust:s.trust,issuedAt:now}));});
test('threshold certificate tampering is rejected',()=>{const bad={...s.thresholdEnvelope,payload:{...s.thresholdEnvelope.payload,thresholdSequence:5}};assert.throws(()=>verifyMultiProviderThresholdV33_40({evidence:{approvals:s.approvals,certificate:bad},trust:s.trust,verifiedAt:now}));});
test('threshold approval set substitution is rejected',()=>assert.throws(()=>verifyMultiProviderThresholdV33_40({evidence:{approvals:s.approvals.slice(0,2),certificate:s.thresholdEnvelope},trust:s.trust,verifiedAt:now})));

test('checkpoint byte substitution is rejected',()=>assert.throws(()=>verifyCheckpointAndReceiptsV33_40({checkpoint:s.checkpoint,checkpointBytes:Buffer.from('bad'),receipts:s.receipts,trust:s.trust,verifiedAt:now})));
test('checkpoint requires three monitor receipts',()=>assert.throws(()=>verifyCheckpointAndReceiptsV33_40({checkpoint:s.checkpoint,checkpointBytes:s.checkpointBytes,receipts:s.receipts.slice(0,2),trust:s.trust,verifiedAt:now})));
test('monitor provider diversity is required',()=>{const rows=s.receipts.map((e,i)=>{const m={...e.payload,providerId:'same'};delete (m as any).receiptDigest;return signEnvelope({...m,receiptDigest:sha256(m)},s.monitors[i]!)});assert.throws(()=>verifyCheckpointAndReceiptsV33_40({checkpoint:s.checkpoint,checkpointBytes:s.checkpointBytes,receipts:rows,trust:s.trust,verifiedAt:now}));});
test('monitor receipt checkpoint mismatch is rejected',()=>{const m={...s.receipts[0]!.payload,checkpointSequence:99};delete (m as any).receiptDigest;const e=signEnvelope({...m,receiptDigest:sha256(m)},s.monitors[0]!);assert.throws(()=>verifyCheckpointAndReceiptsV33_40({checkpoint:s.checkpoint,checkpointBytes:s.checkpointBytes,receipts:[e,s.receipts[1]!,s.receipts[2]!],trust:s.trust,verifiedAt:now}));});
test('live checkpoint requires public DNS and network retrieval',()=>assert.throws(()=>createPublicInteroperabilityCheckpointV33_40({authority:s.publicationAuthority,priorV33_39Verdict:s.priorVerdict,thresholdCertificate:s.thresholdEnvelope.payload,adapterManifestDigests:s.manifests.map(m=>m.payload.manifestDigest),remoteAttestationDigests:s.attestations.map(a=>a.payload.evidenceDigest),previousCheckpointDigest:sha256({p:1}),checkpointSequence:2,endpoint:'https://checkpoint.local/x',dnsName:'checkpoint.local',checkpointBytes:s.checkpointBytes,publisher:s.checkpoint.payload.publisher,publishedAt:now,executionClass:'LIVE_EXTERNAL_MULTI_PROVIDER',publicNetworkRetrievalObserved:false})));

test('recovery site must differ from source',()=>assert.throws(()=>createCrossSiteRecoveryReceiptV33_40({verifier:s.recoveryVerifier,descriptor:s.recovery.payload.recoveryVerifier,priorRecoveryDigest:s.priorVerdict.recoveryDigest,sourceSiteId:'site-a',targetSiteId:'site-a',sourceProviderId:'p1',targetProviderId:'p2',checkpoint:s.checkpoint.payload,restoredBytes:s.recoveryBytes,thresholdCertificateDigest:s.thresholdEnvelope.payload.certificateDigest,recoverySequence:2,recoveredAt:now,executionClass:'LOCAL_INTEROP_REHEARSAL'})));
test('recovery provider must differ from source',()=>assert.throws(()=>createCrossSiteRecoveryReceiptV33_40({verifier:s.recoveryVerifier,descriptor:s.recovery.payload.recoveryVerifier,priorRecoveryDigest:s.priorVerdict.recoveryDigest,sourceSiteId:'site-a',targetSiteId:'site-b',sourceProviderId:'p1',targetProviderId:'p1',checkpoint:s.checkpoint.payload,restoredBytes:s.recoveryBytes,thresholdCertificateDigest:s.thresholdEnvelope.payload.certificateDigest,recoverySequence:2,recoveredAt:now,executionClass:'LOCAL_INTEROP_REHEARSAL'})));
test('recovery restored byte substitution is rejected',()=>assert.throws(()=>verifyCrossSiteRecoveryV33_40({receipt:s.recovery,checkpoint:s.checkpoint.payload,restoredBytes:Buffer.from('bad'),trust:s.trust,verifiedAt:now})));
test('recovery fork mutation is rejected',()=>{const bad={...s.recovery,payload:{...s.recovery.payload,forkDetected:true as false}};assert.throws(()=>verifyCrossSiteRecoveryV33_40({receipt:bad,checkpoint:s.checkpoint.payload,restoredBytes:s.recoveryBytes,trust:s.trust,verifiedAt:now}));});

test('final verdict rejects prior v33.39 mutation',()=>{const prior={...s.priorVerdict,productionAuthority:'FULL' as 'NONE'};assert.throws(()=>verifyHsmInteroperabilityQualificationV33_40({priorV33_39Verdict:prior,priorV33_39ThresholdEvidence:s.priorThresholdEvidence,manifests:s.manifests,moduleBytesByManifestDigest:s.moduleBytesByManifestDigest,attestations:s.attestations,documentsByEvidenceDigest:s.documentsByEvidenceDigest,challengesByEvidenceDigest:s.challengesByEvidenceDigest,thresholdEvidence:{approvals:s.approvals,certificate:s.thresholdEnvelope},checkpoint:s.checkpoint,checkpointBytes:s.checkpointBytes,monitorReceipts:s.receipts,recoveryReceipt:s.recovery,restoredBytes:s.recoveryBytes,trust:s.trust,verifiedAt:now}));});
test('final verdict rejects prior threshold head mismatch',()=>assert.throws(()=>verifyHsmInteroperabilityQualificationV33_40({priorV33_39Verdict:s.priorVerdict,priorV33_39ThresholdEvidence:s.priorThresholdEvidence.slice(0,2),manifests:s.manifests,moduleBytesByManifestDigest:s.moduleBytesByManifestDigest,attestations:s.attestations,documentsByEvidenceDigest:s.documentsByEvidenceDigest,challengesByEvidenceDigest:s.challengesByEvidenceDigest,thresholdEvidence:{approvals:s.approvals,certificate:s.thresholdEnvelope},checkpoint:s.checkpoint,checkpointBytes:s.checkpointBytes,monitorReceipts:s.receipts,recoveryReceipt:s.recovery,restoredBytes:s.recoveryBytes,trust:s.trust,verifiedAt:now})));
test('final verdict rejects checkpoint prior binding mutation',()=>{const p={...s.checkpoint,payload:{...s.checkpoint.payload,priorV33_39VerdictDigest:sha256({wrong:1})}};assert.throws(()=>verifyHsmInteroperabilityQualificationV33_40({priorV33_39Verdict:s.priorVerdict,priorV33_39ThresholdEvidence:s.priorThresholdEvidence,manifests:s.manifests,moduleBytesByManifestDigest:s.moduleBytesByManifestDigest,attestations:s.attestations,documentsByEvidenceDigest:s.documentsByEvidenceDigest,challengesByEvidenceDigest:s.challengesByEvidenceDigest,thresholdEvidence:{approvals:s.approvals,certificate:s.thresholdEnvelope},checkpoint:p,checkpointBytes:s.checkpointBytes,monitorReceipts:s.receipts,recoveryReceipt:s.recovery,restoredBytes:s.recoveryBytes,trust:s.trust,verifiedAt:now}));});
test('all v33.40 artifacts preserve zero-effect boundary',()=>{const v=s.final();assert.equal(v.productionAuthority,'NONE');assert.equal(v.externalEffectsExecuted,0);for(const e of [...s.manifests,...s.attestations,...s.approvals,s.thresholdEnvelope,s.checkpoint,...s.receipts,s.recovery]){assert.equal(e.payload.productionAuthority,'NONE');assert.equal(e.payload.externalEffectsExecuted,0);}});
