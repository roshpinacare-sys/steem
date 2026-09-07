import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import {
  componentManifestDigestV32_17,
  evaluateSovereignComponentV32_17,
  optimizeSovereignBuildingBlockPlanV32_17,
  type ComponentAdmissionTrustV32_17,
  type SovereignBuildingBlockPlanPolicyV32_17,
  type SovereignBuildingBlockV32_17,
  type SovereignComponentManifestV32_17,
  type SovereignComponentPolicyV32_17,
} from '../src/platform/sovereign-building-blocks-v32_17.js';

const blocks: readonly SovereignBuildingBlockV32_17[]=['service-invocation','state','pubsub','workflow','bindings','secrets','configuration','distributed-lock'];
const d=(value:string)=>sha256(value);
const policy: SovereignComponentPolicyV32_17={policyDigest:d('policy-17'),allowedTrustDomains:['sovereign.local'],allowedBlocks:blocks,requiredInterfaceVersions:Object.fromEntries(blocks.map((block)=>[block,'v1'])) as SovereignComponentPolicyV32_17['requiredInterfaceVersions'],maximumBlocksPerComponent:2,maximumMemoryBytes:256*1024*1024,maximumConcurrency:256,requireIndependentReview:true,requireUnixDomainSocketForPrivateComponents:true,requireDeterminismFor:['state','workflow','distributed-lock'],allowNetworkEgressFor:['bindings','service-invocation'],production:false};
const manifest=(id:string,assigned:readonly SovereignBuildingBlockV32_17[]=['state'],overrides:Partial<SovereignComponentManifestV32_17>={}):SovereignComponentManifestV32_17=>({schemaVersion:'32.17',componentId:id,version:'1.0.0',protocolProfile:'dapr-building-blocks-v1',endpoint:{transport:'unix-domain-socket',address:`/run/sovereign/${id}.sock`},blocks:assigned,interfaceVersions:Object.fromEntries(blocks.map((block)=>[block,assigned.includes(block)?'v1':undefined])) as SovereignComponentManifestV32_17['interfaceVersions'],spiffeId:`spiffe://sovereign.local/components/${id}`,publisherId:`publisher-${id}`,publisherOrganizationId:`org-${id}`,reviewerId:`reviewer-${id}`,reviewerOrganizationId:'review-org',publisherKeyFingerprint:d(`pub-${id}`),reviewerKeyFingerprint:d(`rev-${id}`),binaryDigest:d(`bin-${id}`),sourceDigest:d(`src-${id}`),toolchainDigest:d('tool'),policyDigest:policy.policyDigest,maximumMemoryBytes:64*1024*1024,maximumConcurrency:64,networkEgress:assigned.some((block)=>policy.allowNetworkEgressFor.includes(block))?'ALLOWLISTED':'NONE',deterministic:true,evidenceClass:'OBSERVED_LOCAL',runtimeQualified:false,synthetic:false,normalizedMonthlyCost:8,operationalUnits:1,...overrides});
const planPolicy=(overrides:Partial<SovereignBuildingBlockPlanPolicyV32_17>={}):SovereignBuildingBlockPlanPolicyV32_17=>({requiredBlocks:['state'],maximumComponents:2,maximumSingleComponentCoverage:1,minimumDistinctOrganizations:1,costWeight:1,operationalWeight:1,concentrationWeight:1,production:false,...overrides});

function trustFixture(base:SovereignComponentManifestV32_17):{manifest:SovereignComponentManifestV32_17;trust:ComponentAdmissionTrustV32_17}{
 const production={...policy,production:true};
 const publisher=generateSigningIdentity(`publisher-key-${base.componentId}`),reviewer=generateSigningIdentity(`reviewer-key-${base.componentId}`),registry=new KeyRegistry();registry.register(publisher.keyId,publisher.publicKey);registry.register(reviewer.keyId,reviewer.publicKey);
 const bound={...base,publisherKeyFingerprint:registry.fingerprint(publisher.keyId)!,reviewerKeyFingerprint:registry.fingerprint(reviewer.keyId)!};const manifestDigest=componentManifestDigestV32_17(bound);
 const pubPayload={schemaVersion:'32.17' as const,role:'PUBLISHER' as const,componentId:bound.componentId,manifestDigest,binaryDigest:bound.binaryDigest,sourceDigest:bound.sourceDigest,toolchainDigest:bound.toolchainDigest,policyDigest:production.policyDigest,actorId:bound.publisherId,organizationId:bound.publisherOrganizationId,keyFingerprint:bound.publisherKeyFingerprint,observedAt:'2026-07-20T10:00:00.000Z'};
 const pub=signEnvelope(pubPayload,publisher);const revPayload={schemaVersion:'32.17' as const,role:'REVIEWER' as const,componentId:bound.componentId,manifestDigest,publisherAttestationDigest:sha256(pubPayload),policyDigest:production.policyDigest,decision:'APPROVE' as const,actorId:bound.reviewerId,organizationId:bound.reviewerOrganizationId,keyFingerprint:bound.reviewerKeyFingerprint,reviewedAt:'2026-07-20T10:01:00.000Z'};
 return{manifest:bound,trust:{registry,publisher:pub,reviewer:signEnvelope(revPayload,reviewer),evaluatedAt:'2026-07-20T10:02:00.000Z',authorizations:[{role:'PUBLISHER',actorId:bound.publisherId,organizationId:bound.publisherOrganizationId,keyId:publisher.keyId,keyFingerprint:bound.publisherKeyFingerprint,validFrom:'2026-07-20T09:00:00.000Z',validUntil:'2026-07-20T11:00:00.000Z',authority:'EXTERNAL_PINNED'},{role:'REVIEWER',actorId:bound.reviewerId,organizationId:bound.reviewerOrganizationId,keyId:reviewer.keyId,keyFingerprint:bound.reviewerKeyFingerprint,validFrom:'2026-07-20T09:00:00.000Z',validUntil:'2026-07-20T11:00:00.000Z',authority:'EXTERNAL_PINNED'}]}};
}

test('v32.17 admission branch matrix records duplicate denied deterministic UDS and trust failures',()=>{
 const bad=manifest('bad',['state','state'],{endpoint:{transport:'unix-domain-socket',address:'relative.sock'},deterministic:false});
 const restricted={...policy,allowedBlocks:blocks.filter((b)=>b!=='state'),maximumBlocksPerComponent:1};
 const findings=evaluateSovereignComponentV32_17(bad,restricted).findings;
 assert.equal(findings.includes('component-block-duplicate'),true);
 assert.equal(findings.includes('component-block-concentration-exceeded'),true);
 assert.equal(findings.includes('component-block-denied:state'),true);
 assert.equal(findings.includes('component-determinism-required:state'),true);
 assert.equal(findings.includes('component-uds-address-invalid'),true);
 const base=manifest('prod',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false});const fixture=trustFixture(base);const production={...policy,production:true};
 assert.deepEqual(evaluateSovereignComponentV32_17(fixture.manifest,production,{...fixture.trust,evaluatedAt:'bad-time'}).findings,['component-trust-evaluation-time-invalid']);
 const missingReviewer={...fixture.trust,authorizations:[fixture.trust.authorizations[0]!]};
 const missing=evaluateSovereignComponentV32_17(fixture.manifest,production,missingReviewer).findings;
 assert.equal(missing.includes('component-reviewer-authorization-missing'),true);
 assert.equal(missing.includes('component-trust-independence-invalid'),true);
});

test('v32.17 authorization mismatch fingerprint and malformed time paths fail closed',()=>{
 const production={...policy,production:true};const fixture=trustFixture(manifest('prod',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false}));
 const publisher={...fixture.trust.authorizations[0]!,organizationId:'wrong-org',keyFingerprint:d('wrong-fingerprint'),validFrom:'bad',validUntil:'bad'};
 const findings=evaluateSovereignComponentV32_17(fixture.manifest,production,{...fixture.trust,authorizations:[publisher,fixture.trust.authorizations[1]!]}).findings;
 assert.equal(findings.includes('component-publisher-authorization-expired'),true);
 assert.equal(findings.includes('component-publisher-authorization-mismatch'),true);
 assert.equal(findings.includes('component-publisher-key-fingerprint-mismatch'),true);
 const malformedPublisher={...fixture.trust.publisher,payload:{...fixture.trust.publisher.payload,observedAt:'bad'}};
 const malformedReviewer={...fixture.trust.reviewer,payload:{...fixture.trust.reviewer.payload,reviewedAt:'bad'}};
 const times=evaluateSovereignComponentV32_17(fixture.manifest,production,{...fixture.trust,publisher:malformedPublisher,reviewer:malformedReviewer}).findings;
 assert.equal(times.includes('component-publisher-signature-invalid'),true);
 assert.equal(times.includes('component-reviewer-signature-invalid'),true);
 assert.equal(times.includes('component-attestation-time-order-invalid'),true);
});

test('v32.17 manifest policy and plan validators reject every malformed boundary',()=>{
 const base=manifest('x');
 assert.throws(()=>evaluateSovereignComponentV32_17({...base,schemaVersion:'0' as '32.17'},policy),/component_manifest_schema_invalid/);
 assert.throws(()=>evaluateSovereignComponentV32_17({...base,componentId:' '},policy),/component_manifest_identity_invalid/);
 assert.throws(()=>evaluateSovereignComponentV32_17({...base,binaryDigest:'x'},policy),/component_manifest_digest_invalid/);
 assert.throws(()=>evaluateSovereignComponentV32_17({...base,maximumMemoryBytes:0},policy),/component_manifest_limits_invalid/);
 assert.throws(()=>evaluateSovereignComponentV32_17({...base,normalizedMonthlyCost:-1},policy),/component_manifest_cost_invalid/);
 assert.throws(()=>evaluateSovereignComponentV32_17({...base,blocks:['invalid' as SovereignBuildingBlockV32_17]},policy),/component_manifest_block_invalid/);
 assert.throws(()=>evaluateSovereignComponentV32_17({...base,interfaceVersions:{...base.interfaceVersions,state:'latest'}},policy),/component_manifest_interface_version_invalid/);
 assert.throws(()=>evaluateSovereignComponentV32_17(base,{...policy,maximumMemoryBytes:0}),/component_policy_limits_invalid/);
 assert.throws(()=>evaluateSovereignComponentV32_17(base,{...policy,allowedTrustDomains:['.bad']}),/component_policy_trust_domain_invalid/);
 assert.throws(()=>evaluateSovereignComponentV32_17(base,{...policy,allowedBlocks:['bad' as SovereignBuildingBlockV32_17]}),/component_policy_block_invalid/);
 const admission=evaluateSovereignComponentV32_17(base,policy);
 assert.throws(()=>optimizeSovereignBuildingBlockPlanV32_17([base],[],planPolicy()),/building_block_plan_input_length_mismatch/);
 assert.throws(()=>optimizeSovereignBuildingBlockPlanV32_17([base,base],[admission,admission],planPolicy()),/building_block_plan_admission_duplicate/);
 const many=Array.from({length:21},(_,i)=>manifest(`m${i}`));const reports=many.map((m)=>evaluateSovereignComponentV32_17(m,policy));
 assert.throws(()=>optimizeSovereignBuildingBlockPlanV32_17(many,reports,planPolicy({maximumComponents:21})),/building_block_plan_candidate_limit_exceeded/);
 assert.throws(()=>optimizeSovereignBuildingBlockPlanV32_17([base],[admission],planPolicy({maximumComponents:0})),/building_block_plan_limit_invalid/);
 assert.throws(()=>optimizeSovereignBuildingBlockPlanV32_17([base],[admission],planPolicy({costWeight:-1})),/building_block_plan_weight_invalid/);
 assert.throws(()=>optimizeSovereignBuildingBlockPlanV32_17([base],[admission],planPolicy({maximumSingleComponentCoverage:2})),/building_block_plan_concentration_invalid/);
});

test('v32.17 optimizer deterministic tie break and production plan branches are explicit',()=>{
 const a=manifest('a'),b=manifest('b');const admissions=[evaluateSovereignComponentV32_17(a,policy),evaluateSovereignComponentV32_17(b,policy)];
 const tie=optimizeSovereignBuildingBlockPlanV32_17([b,a],admissions.reverse(),planPolicy());assert.deepEqual(tie.selectedComponentIds,['a']);
 const rejected=optimizeSovereignBuildingBlockPlanV32_17([],[],planPolicy());assert.equal(rejected.score,Number.MAX_SAFE_INTEGER);assert.deepEqual(rejected.coveredBlocks,[]);assert.deepEqual(rejected.uncoveredBlocks,['state']);
});
