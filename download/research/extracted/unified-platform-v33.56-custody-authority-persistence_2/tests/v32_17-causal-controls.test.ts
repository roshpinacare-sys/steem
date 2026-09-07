import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCncfSovereignConvergenceV32_17 } from '../src/app/cncf-sovereign-convergence-v32_17.js';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope, type SigningIdentity } from '../src/contracts/crypto.js';
import {
  componentManifestDigestV32_17,
  evaluateSovereignComponentV32_17,
  optimizeSovereignBuildingBlockPlanV32_17,
  type ComponentAdmissionTrustV32_17,
  type ComponentPublisherAttestationV32_17,
  type ComponentReviewerAttestationV32_17,
  type SovereignBuildingBlockPlanPolicyV32_17,
  type SovereignBuildingBlockV32_17,
  type SovereignComponentManifestV32_17,
  type SovereignComponentPolicyV32_17,
} from '../src/platform/sovereign-building-blocks-v32_17.js';
import {
  comparePortableConformanceV32_17,
  type PortableConformanceReportV32_17,
} from '../src/runtime/portable-building-block-harness-v32_17.js';

const blocks: readonly SovereignBuildingBlockV32_17[] = ['service-invocation','state','pubsub','workflow','bindings','secrets','configuration','distributed-lock'];
const d = (value: string) => sha256(value);
const policy: SovereignComponentPolicyV32_17 = {
  policyDigest:d('policy-v32.17'),allowedTrustDomains:['sovereign.local'],allowedBlocks:blocks,
  requiredInterfaceVersions:Object.fromEntries(blocks.map((block)=>[block,'v1'])) as SovereignComponentPolicyV32_17['requiredInterfaceVersions'],
  maximumBlocksPerComponent:2,maximumMemoryBytes:268435456,maximumConcurrency:256,requireIndependentReview:true,
  requireUnixDomainSocketForPrivateComponents:true,requireDeterminismFor:['state','workflow','distributed-lock'],
  allowNetworkEgressFor:['bindings','service-invocation'],production:false,
};
const manifest=(id:string, assigned:readonly SovereignBuildingBlockV32_17[], overrides:Partial<SovereignComponentManifestV32_17>={}):SovereignComponentManifestV32_17=>({
  schemaVersion:'32.17',componentId:id,version:'1.0.0',protocolProfile:'dapr-building-blocks-v1',
  endpoint:{transport:'unix-domain-socket',address:`/run/sovereign/${id}.sock`},blocks:assigned,
  interfaceVersions:Object.fromEntries(blocks.map((block)=>[block,assigned.includes(block)?'v1':undefined])) as SovereignComponentManifestV32_17['interfaceVersions'],
  spiffeId:`spiffe://sovereign.local/components/${id}`,publisherId:`publisher-${id}`,publisherOrganizationId:`org-${id}`,
  reviewerId:`reviewer-${id}`,reviewerOrganizationId:'review-org',publisherKeyFingerprint:d(`publisher-${id}`),reviewerKeyFingerprint:d(`reviewer-${id}`),
  binaryDigest:d(`binary-${id}`),sourceDigest:d(`source-${id}`),toolchainDigest:d('toolchain'),policyDigest:policy.policyDigest,
  maximumMemoryBytes:67108864,maximumConcurrency:64,networkEgress:assigned.some((b)=>policy.allowNetworkEgressFor.includes(b))?'ALLOWLISTED':'NONE',
  deterministic:true,evidenceClass:'OBSERVED_LOCAL',runtimeQualified:false,synthetic:false,normalizedMonthlyCost:8,operationalUnits:1,...overrides,
});
const planPolicy=(overrides:Partial<SovereignBuildingBlockPlanPolicyV32_17>={}):SovereignBuildingBlockPlanPolicyV32_17=>({
  requiredBlocks:blocks,maximumComponents:8,maximumSingleComponentCoverage:1,minimumDistinctOrganizations:1,costWeight:1,operationalWeight:1,concentrationWeight:1,production:false,...overrides,
});
const report=(id:string,state:'PASSED'|'FAILED',traceDigest:string):PortableConformanceReportV32_17=>({schemaVersion:'32.17',adapterId:id,state,trace:[],findings:state==='FAILED'?['x']:[],traceDigest,reportDigest:d(id+state+traceDigest)});

type TrustFixture = {
  readonly manifest: SovereignComponentManifestV32_17;
  readonly trust: ComponentAdmissionTrustV32_17;
  readonly publisherIdentity: SigningIdentity;
  readonly reviewerIdentity: SigningIdentity;
};
function signedTrust(base:SovereignComponentManifestV32_17,production:SovereignComponentPolicyV32_17):TrustFixture{
  const publisherIdentity=generateSigningIdentity(`publisher-key-${base.componentId}`);
  const reviewerIdentity=generateSigningIdentity(`reviewer-key-${base.componentId}`);
  const registry=new KeyRegistry();registry.register(publisherIdentity.keyId,publisherIdentity.publicKey);registry.register(reviewerIdentity.keyId,reviewerIdentity.publicKey);
  const bound={...base,publisherKeyFingerprint:registry.fingerprint(publisherIdentity.keyId)!,reviewerKeyFingerprint:registry.fingerprint(reviewerIdentity.keyId)!};
  const manifestDigest=componentManifestDigestV32_17(bound);
  const publisherPayload:ComponentPublisherAttestationV32_17={schemaVersion:'32.17',role:'PUBLISHER',componentId:bound.componentId,manifestDigest,binaryDigest:bound.binaryDigest,sourceDigest:bound.sourceDigest,toolchainDigest:bound.toolchainDigest,policyDigest:production.policyDigest,actorId:bound.publisherId,organizationId:bound.publisherOrganizationId,keyFingerprint:bound.publisherKeyFingerprint,observedAt:'2026-07-20T10:00:00.000Z'};
  const publisherEnvelope=signEnvelope(publisherPayload,publisherIdentity);
  const reviewerPayload:ComponentReviewerAttestationV32_17={schemaVersion:'32.17',role:'REVIEWER',componentId:bound.componentId,manifestDigest,publisherAttestationDigest:sha256(publisherPayload),policyDigest:production.policyDigest,decision:'APPROVE',actorId:bound.reviewerId,organizationId:bound.reviewerOrganizationId,keyFingerprint:bound.reviewerKeyFingerprint,reviewedAt:'2026-07-20T10:01:00.000Z'};
  const trust:ComponentAdmissionTrustV32_17={registry,publisher:publisherEnvelope,reviewer:signEnvelope(reviewerPayload,reviewerIdentity),evaluatedAt:'2026-07-20T10:02:00.000Z',authorizations:[{role:'PUBLISHER',actorId:bound.publisherId,organizationId:bound.publisherOrganizationId,keyId:publisherIdentity.keyId,keyFingerprint:bound.publisherKeyFingerprint,validFrom:'2026-07-20T09:00:00.000Z',validUntil:'2026-07-20T11:00:00.000Z',authority:'EXTERNAL_PINNED'},{role:'REVIEWER',actorId:bound.reviewerId,organizationId:bound.reviewerOrganizationId,keyId:reviewerIdentity.keyId,keyFingerprint:bound.reviewerKeyFingerprint,validFrom:'2026-07-20T09:00:00.000Z',validUntil:'2026-07-20T11:00:00.000Z',authority:'EXTERNAL_PINNED'}]};
  return{manifest:bound,trust,publisherIdentity,reviewerIdentity};
}
function mutateSignature(value:string):string{return `${value[0]==='A'?'B':'A'}${value.slice(1)}`;}

// Names are mutation-oracle contracts. Each test must fail for only its intended weakening.
test('causal v32.17 policy digest binding',()=>{const result=evaluateSovereignComponentV32_17(manifest('a',['state'],{policyDigest:d('other')}),policy);assert.deepEqual(result.findings,['component-policy-digest-mismatch']);});
test('causal v32.17 SPIFFE trust-domain binding',()=>{const result=evaluateSovereignComponentV32_17(manifest('a',['state'],{spiffeId:'spiffe://evil.invalid/components/a'}),policy);assert.deepEqual(result.findings,['component-spiffe-trust-domain-denied']);});
test('causal v32.17 private UDS transport requirement',()=>{const result=evaluateSovereignComponentV32_17(manifest('a',['state'],{endpoint:{transport:'loopback-grpc',address:'127.0.0.1:50001'}}),policy);assert.deepEqual(result.findings,['component-private-transport-not-uds']);});
test('causal v32.17 reviewer independence',()=>{const result=evaluateSovereignComponentV32_17(manifest('a',['state'],{reviewerId:'publisher-a'}),policy);assert.deepEqual(result.findings,['component-independent-review-required']);});
test('causal v32.17 external runtime evidence',()=>{const result=evaluateSovereignComponentV32_17(manifest('a',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:false,synthetic:false}),policy);assert.deepEqual(result.findings,['component-external-evidence-invalid']);});
test('causal v32.17 production trust gate',()=>{const result=evaluateSovereignComponentV32_17(manifest('a',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false}),{...policy,production:true});assert.equal(result.productionQualified,false);assert.equal(result.admission,'REJECT');assert.equal(result.findings.includes('component-production-trust-missing'),true);});
test('causal v32.17 publisher authorization',()=>{const production={...policy,production:true};const fixture=signedTrust(manifest('a',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false}),production);const authorizations=[{...fixture.trust.authorizations[0]!,authority:'LOCAL' as 'EXTERNAL_PINNED'},fixture.trust.authorizations[1]!];const result=evaluateSovereignComponentV32_17(fixture.manifest,production,{...fixture.trust,authorizations});assert.deepEqual(result.findings,['component-publisher-authorization-missing']);});
test('causal v32.17 authorization validity',()=>{const production={...policy,production:true};const fixture=signedTrust(manifest('a',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false}),production);const result=evaluateSovereignComponentV32_17(fixture.manifest,production,{...fixture.trust,evaluatedAt:'2026-07-20T12:00:00.000Z'});assert.equal(result.findings.includes('component-publisher-authorization-expired'),true);assert.equal(result.findings.includes('component-reviewer-authorization-expired'),true);});
test('causal v32.17 publisher signature',()=>{const production={...policy,production:true};const fixture=signedTrust(manifest('a',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false}),production);const publisher={...fixture.trust.publisher,signature:mutateSignature(fixture.trust.publisher.signature)};const result=evaluateSovereignComponentV32_17(fixture.manifest,production,{...fixture.trust,publisher});assert.deepEqual(result.findings,['component-publisher-signature-invalid']);});
test('causal v32.17 reviewer signature',()=>{const production={...policy,production:true};const fixture=signedTrust(manifest('a',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false}),production);const reviewer={...fixture.trust.reviewer,signature:mutateSignature(fixture.trust.reviewer.signature)};const result=evaluateSovereignComponentV32_17(fixture.manifest,production,{...fixture.trust,reviewer});assert.deepEqual(result.findings,['component-reviewer-signature-invalid']);});
test('causal v32.17 publisher attestation lineage',()=>{const production={...policy,production:true};const fixture=signedTrust(manifest('a',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false}),production);const publisherPayload={...fixture.trust.publisher.payload,sourceDigest:d('wrong-source')};const publisher=signEnvelope(publisherPayload,fixture.publisherIdentity);const reviewerPayload={...fixture.trust.reviewer.payload,publisherAttestationDigest:sha256(publisherPayload)};const reviewer=signEnvelope(reviewerPayload,fixture.reviewerIdentity);const result=evaluateSovereignComponentV32_17(fixture.manifest,production,{...fixture.trust,publisher,reviewer});assert.deepEqual(result.findings,['component-publisher-attestation-lineage-invalid']);});
test('causal v32.17 reviewer attestation lineage',()=>{const production={...policy,production:true};const fixture=signedTrust(manifest('a',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false}),production);const reviewerPayload={...fixture.trust.reviewer.payload,policyDigest:d('wrong-policy')};const reviewer=signEnvelope(reviewerPayload,fixture.reviewerIdentity);const result=evaluateSovereignComponentV32_17(fixture.manifest,production,{...fixture.trust,reviewer});assert.deepEqual(result.findings,['component-reviewer-attestation-lineage-invalid']);});
test('causal v32.17 attestation time order',()=>{const production={...policy,production:true};const fixture=signedTrust(manifest('a',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false}),production);const publisherPayload={...fixture.trust.publisher.payload,observedAt:'2026-07-20T10:01:30.000Z'};const publisher=signEnvelope(publisherPayload,fixture.publisherIdentity);const reviewerPayload={...fixture.trust.reviewer.payload,publisherAttestationDigest:sha256(publisherPayload),reviewedAt:'2026-07-20T10:01:00.000Z'};const reviewer=signEnvelope(reviewerPayload,fixture.reviewerIdentity);const result=evaluateSovereignComponentV32_17(fixture.manifest,production,{...fixture.trust,publisher,reviewer});assert.deepEqual(result.findings,['component-attestation-time-order-invalid']);});
test('causal v32.17 trust actor independence',()=>{const production={...policy,production:true};const fixture=signedTrust(manifest('a',['state'],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false}),production);const authorizations=[...fixture.trust.authorizations,{...fixture.trust.authorizations[0]!,actorId:'extra-publisher'}];const result=evaluateSovereignComponentV32_17(fixture.manifest,production,{...fixture.trust,authorizations});assert.deepEqual(result.findings,['component-trust-independence-invalid']);});
test('causal v32.17 required-block coverage',()=>{const m=manifest('a',['state']);const a=evaluateSovereignComponentV32_17(m,policy);const result=optimizeSovereignBuildingBlockPlanV32_17([m],[a],planPolicy());assert.equal(result.state,'REJECTED');});
test('causal v32.17 organization diversity',()=>{const manifests=blocks.map((block,i)=>manifest(`a${i}`,[block],{publisherOrganizationId:'one-org'}));const admissions=manifests.map((m)=>evaluateSovereignComponentV32_17(m,policy));const result=optimizeSovereignBuildingBlockPlanV32_17(manifests,admissions,planPolicy({minimumDistinctOrganizations:2}));assert.equal(result.state,'REJECTED');});
test('causal v32.17 concentration ceiling',()=>{const relaxed={...policy,maximumBlocksPerComponent:8};const m=manifest('mono',blocks,{networkEgress:'NONE'});const a=evaluateSovereignComponentV32_17(m,relaxed);const result=optimizeSovereignBuildingBlockPlanV32_17([m],[a],planPolicy({maximumSingleComponentCoverage:.5}));assert.equal(result.state,'REJECTED');});
test('causal v32.17 rejected components excluded',()=>{const relaxed={...policy,maximumBlocksPerComponent:8};const m=manifest('bad',blocks,{spiffeId:'spiffe://evil.invalid/components/bad',normalizedMonthlyCost:1});const a=evaluateSovereignComponentV32_17(m,relaxed);const result=optimizeSovereignBuildingBlockPlanV32_17([m],[a],planPolicy({maximumComponents:1}));assert.equal(result.state,'REJECTED');});
test('causal v32.17 failed conformance report',()=>{const result=comparePortableConformanceV32_17([report('a','PASSED',d('trace')),report('b','FAILED',d('trace'))]);assert.equal(result.equivalent,false);assert.deepEqual(result.findings,['portable-comparison-report-failed']);});
test('causal v32.17 conformance trace equivalence',()=>{const result=comparePortableConformanceV32_17([report('a','PASSED',d('trace-a')),report('b','PASSED',d('trace-b'))]);assert.equal(result.equivalent,false);assert.deepEqual(result.findings,['portable-comparison-trace-divergence']);});
test('causal v32.17 substitution coverage',async()=>{const manifests=blocks.map((block,i)=>manifest(`only-${i}`,[block]));const result=await runCncfSovereignConvergenceV32_17({manifests,componentPolicy:policy,planPolicy:planPolicy(),baselineOperationalUnits:16,baselineNormalizedMonthlyCost:160});assert.equal(result.state,'FAILED');assert.equal(result.findings.includes('cncf-substitution-coverage-incomplete'),true);});
test('causal v32.17 convergence production binding',async()=>{const productionPolicy={...policy,production:true};const manifests=blocks.map((block,i)=>manifest(`prod-${i}`,[block],{evidenceClass:'OBSERVED_EXTERNAL',runtimeQualified:true,synthetic:false}));const result=await runCncfSovereignConvergenceV32_17({manifests,componentPolicy:productionPolicy,planPolicy:planPolicy({production:true}),baselineOperationalUnits:16,baselineNormalizedMonthlyCost:160});assert.equal(result.state,'FAILED');assert.equal(result.productionQualified,false);});

test('causal v32.17 rejected convergence plan',async()=>{const manifests=blocks.flatMap((block,i)=>[manifest(`a-${i}`,[block],{publisherOrganizationId:'org-a'}),manifest(`b-${i}`,[block],{publisherOrganizationId:'org-b'})]);const result=await runCncfSovereignConvergenceV32_17({manifests,componentPolicy:policy,planPolicy:planPolicy({minimumDistinctOrganizations:3}),baselineOperationalUnits:20,baselineNormalizedMonthlyCost:200});assert.equal(result.state,'FAILED');assert.deepEqual(result.findings,['building-block-plan-no-valid-topology','cncf-building-block-plan-rejected']);});

function runVerifier(value:Record<string,unknown>){const dir=mkdtempSync(join(tmpdir(),'v3217-verifier-'));try{const path=join(dir,'report.json');writeFileSync(path,JSON.stringify(value));return spawnSync('python3',['verifier-only/v32.17/independent_cncf_convergence_verifier.py',path],{encoding:'utf8'});}finally{rmSync(dir,{recursive:true,force:true});}}
function verifierReport(){const material={schemaVersion:'32.17',state:'DRY_RUN_PASSED',productionQualified:false,componentAdmissions:4,selectedComponents:4,buildingBlocksCovered:8,buildingBlocksRequired:8,interoperabilityEquivalent:true,operationalReductionRate:.5,normalizedCostReductionRate:.6,vendorSubstitutionCoverage:1,findings:[],limitations:['dapr-runtime-not-executed-in-current-offline-environment'],evidence:{planDigest:d('p'),conformanceDigest:d('c'),nativeReportDigest:d('n'),envelopeReportDigest:d('e')}};return{...material,reportDigest:sha256(material)};}
test('causal v32.17 independent verifier digest',()=>{const value={...verifierReport(),selectedComponents:99};const result=runVerifier(value);assert.notEqual(result.status,0);assert.match(result.stdout,/report-digest-invalid/);});
test('causal v32.17 independent verifier substitution',()=>{const material={...verifierReport(),vendorSubstitutionCoverage:.5};delete (material as {reportDigest?:string}).reportDigest;const value={...material,reportDigest:sha256(material)};const result=runVerifier(value);assert.notEqual(result.status,0);assert.match(result.stdout,/substitution-coverage-invalid/);});
test('causal v32.17 independent verifier production overclaim',()=>{const material={...verifierReport(),state:'PRODUCTION_QUALIFIED',productionQualified:true};delete (material as {reportDigest?:string}).reportDigest;const value={...material,reportDigest:sha256(material)};const result=runVerifier(value);assert.notEqual(result.status,0);assert.match(result.stdout,/production-overclaim/);});
