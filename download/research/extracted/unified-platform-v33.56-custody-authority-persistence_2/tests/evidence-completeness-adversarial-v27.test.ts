import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceDigest, type ActionPassport, type AuthorityGrant, type EvidenceRecord } from '../src/contracts/canonical.js';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope, type SigningIdentity } from '../src/contracts/crypto.js';
import { DigitalThread, type ThreadNodeKind } from '../src/platform/digital-thread.js';
import { EvidenceCompletenessGate, type EvidenceCompletenessInput } from '../src/platform/evidence-completeness.js';
import { attestTestExecution, type SignedTestExecutionClaim, type TestExecutionClaim } from '../src/platform/test-execution-provenance.js';

const now = new Date('2026-07-17T10:00:00.000Z');

type Fixture = { input: EvidenceCompletenessInput; runner: SigningIdentity; passportSigner: SigningIdentity };
function fixture(): Fixture {
  const issuer = generateSigningIdentity('authority-v27');
  const passportSigner = generateSigningIdentity('passport-v27');
  const runner = generateSigningIdentity('runner-v27');
  const registry = new KeyRegistry();
  for (const identity of [issuer, passportSigner, runner]) registry.register(identity.keyId, identity.publicKey);
  const grant: AuthorityGrant = { grantId:'grant-v27', tenantId:'tenant-1', subjectId:'candidate-1', workspaceId:'workspace-1', scopes:['release.shadow'], issuedAt:now.toISOString(), expiresAt:new Date(now.getTime()+60_000).toISOString(), issuer:'kernel' };
  const expectedTestExecution = {
    tenantId:'tenant-1', subjectId:'candidate-1', command:['node','--test','dist/tests'], authorizedRunnerIds:[runner.keyId],
    inputArtifactDigest:sha256('candidate'), outputArtifactDigest:sha256('report'), environmentDigest:sha256({node:'22',os:'linux'}),
    testManifestDigest:sha256('manifest'), testFilesDigest:sha256(['tests/a.test.ts']), maximumAgeMs:300_000,
  } as const;
  const claim: TestExecutionClaim = {
    executionId:'execution-v27', tenantId:'tenant-1', subjectId:'candidate-1', command:expectedTestExecution.command, runnerId:runner.keyId,
    inputArtifactDigest:expectedTestExecution.inputArtifactDigest, outputArtifactDigest:expectedTestExecution.outputArtifactDigest,
    capturedOutputDigest:sha256('tap'), environmentDigest:expectedTestExecution.environmentDigest, testManifestDigest:expectedTestExecution.testManifestDigest,
    testFilesDigest:expectedTestExecution.testFilesDigest, startedAt:new Date(now.getTime()-1_000).toISOString(), finishedAt:new Date(now.getTime()-500).toISOString(), exitStatus:0,
  };
  const attestation = attestTestExecution(claim, runner);
  const records = chain([
    record('tests','test-report','ATTESTED',{executed:true,passed:true,failCount:0,reportDigest:expectedTestExecution.outputArtifactDigest,testManifestDigest:expectedTestExecution.testManifestDigest,attestationDigest:sha256(attestation)}),
    record('artifact','artifact-manifest','COMPUTED',{artifactDigest:sha256('artifact')}),
    record('claims','unsupported-claims','OBSERVED',{claims:[]}),
    record('rollback','rollback-verification','OBSERVED',{passed:true}),
  ]);
  const evidenceRoot = evidenceDigest(records.at(-1)!);
  const kinds: ThreadNodeKind[] = ['AUTHORITY_GRANT','COMMITMENT','REQUIREMENT','MISSION','ARTIFACT','EVIDENCE','CERTIFICATION','PASSPORT'];
  const thread = createThread(kinds,evidenceRoot);
  const passport: ActionPassport = { passportId:'passport-v27',tenantId:'tenant-1',subject:'candidate-1',authorityGrantDigest:sha256(grant),evidenceRoot,promotionState:'shadow',issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+60_000).toISOString(),reviewerIds:['reviewer-1'],limitations:['shadow'] };
  return { runner, passportSigner, input:{tenantId:'tenant-1',subjectId:'candidate-1',builderId:'builder-1',reviewerIds:['reviewer-1'],requiredScope:'release.shadow',authority:signEnvelope(grant,issuer),keyRegistry:registry,evidenceRecords:records,evidenceRoot,requiredEvidenceKinds:['test-report','artifact-manifest','unsupported-claims','rollback-verification'],requiredEvidenceClasses:['ATTESTED','COMPUTED','OBSERVED'],expectedTestReportDigest:expectedTestExecution.outputArtifactDigest,expectedTestManifestDigest:expectedTestExecution.testManifestDigest,expectedArtifactDigest:sha256('artifact'),testExecutionAttestation:attestation,expectedTestExecution,rollback:{ref:'rollback:1',verified:true},digitalThread:thread,requiredThreadKinds:kinds,passport:signEnvelope(passport,passportSigner)} };
}
function record(recordId:string,kind:string,evidenceClass:EvidenceRecord['evidenceClass'],payload:Record<string,unknown>):EvidenceRecord{return{recordId,tenantId:'tenant-1',kind,subject:'candidate-1',payload,evidenceClass,method:'v27.adversarial',environment:{runtime:'node'},createdAt:now.toISOString(),limitations:[]};}
function chain(records:readonly EvidenceRecord[]):EvidenceRecord[]{let previous:string|undefined;return records.map((item)=>{const clean=withoutPrevious(item);const current=previous===undefined?clean:{...clean,previousDigest:previous};previous=evidenceDigest(current);return current;});}
function withoutPrevious(item:EvidenceRecord):EvidenceRecord{const{previousDigest:_previous,...rest}=item;return rest;}
function createThread(kinds:readonly ThreadNodeKind[],evidenceRoot:string):DigitalThread{const thread=new DigitalThread();for(const[index,kind]of kinds.entries()){thread.addNode({nodeId:`${index}-${kind}`,tenantId:'tenant-1',kind,subject:'candidate-1',payloadDigest:kind==='EVIDENCE'?evidenceRoot:sha256({kind}),createdAt:now.toISOString()});if(index>0)thread.addEdge({edgeId:`edge-${index}`,tenantId:'tenant-1',fromNodeId:`${index-1}-${kinds[index-1]}`,toNodeId:`${index}-${kind}`,relation:'SUPPORTS',createdAt:now.toISOString()});}return thread;}
function withoutPassport(input:EvidenceCompletenessInput):Omit<EvidenceCompletenessInput,'passport'>{const{passport:_passport,...rest}=input;return rest;}
function rebind(input:EvidenceCompletenessInput, attestation:SignedTestExecutionClaim):EvidenceCompletenessInput{const records=chain(input.evidenceRecords.map((item)=>item.kind==='test-report'?{...withoutPrevious(item),payload:{...item.payload,attestationDigest:sha256(attestation)}}:withoutPrevious(item)));return{...withoutPassport(input),testExecutionAttestation:attestation,evidenceRecords:records,evidenceRoot:evidenceDigest(records.at(-1)!),consumeReplayKey:false};}
function codes(decision:ReturnType<EvidenceCompletenessGate['evaluate']>):Set<string>{return new Set(decision.failures.map((failure)=>failure.code));}

test('evidence gate enumerates tenant, duplicate, invalid, chain, root, required-kind and required-class failures',()=>{
  const {input}=fixture();
  const first=withoutPrevious(input.evidenceRecords[0]!);
  const invalid={...withoutPrevious(input.evidenceRecords[1]!),tenantId:'tenant-2',method:'',previousDigest:sha256('wrong')};
  const records=[first,{...invalid,recordId:first.recordId},...input.evidenceRecords.slice(2).map(withoutPrevious)] as EvidenceRecord[];
  const decision=new EvidenceCompletenessGate().evaluate({...withoutPassport(input),evidenceRecords:records,evidenceRoot:sha256('wrong-root'),requiredEvidenceKinds:[...input.requiredEvidenceKinds,'missing-kind'],requiredEvidenceClasses:[...input.requiredEvidenceClasses!,'MEASURED'],consumeReplayKey:false},now);
  const found=codes(decision);
  for(const code of ['TENANT_MISMATCH','DUPLICATE_EVIDENCE','EVIDENCE_INVALID','EVIDENCE_CHAIN_INVALID','EVIDENCE_ROOT_MISMATCH','REQUIRED_EVIDENCE_MISSING'])assert.ok(found.has(code),code);
});

test('missing and malformed test evidence, artifact, claims, reviewers, rollback and thread all fail closed',()=>{
  const {input}=fixture();
  const records=input.evidenceRecords.filter((item)=>item.kind!=='test-report'&&item.kind!=='artifact-manifest'&&item.kind!=='unsupported-claims').map(withoutPrevious);
  const chained=chain(records);
  const thread=createThread(['AUTHORITY_GRANT'],evidenceDigest(chained.at(-1)!));
  const decision=new EvidenceCompletenessGate().evaluate({...withoutPassport(input),evidenceRecords:chained,evidenceRoot:evidenceDigest(chained.at(-1)!),reviewerIds:[],rollback:{ref:' ',verified:false},digitalThread:thread,consumeReplayKey:false},now);
  const found=codes(decision);
  for(const code of ['TEST_EVIDENCE_INVALID','ARTIFACT_DIGEST_MISMATCH','UNSUPPORTED_CLAIMS_MISSING','REVIEWER_MISSING','ROLLBACK_MISSING','DIGITAL_THREAD_INCOMPLETE'])assert.ok(found.has(code),code);
});

test('test execution provenance maps every dedicated failure and defaults remaining provenance failures safely',()=>{
  const {input,runner}=fixture();
  const base=input.testExecutionAttestation.payload;
  const cases:[Partial<TestExecutionClaim>,string][]=[
    [{runnerId:'unauthorized-runner'},'TEST_RUNNER_UNAUTHORIZED'],
    [{command:['node','--test','other']},'TEST_COMMAND_MISMATCH'],
    [{inputArtifactDigest:sha256('other-input')},'TEST_INPUT_ARTIFACT_MISMATCH'],
    [{outputArtifactDigest:sha256('other-output')},'TEST_OUTPUT_ARTIFACT_MISMATCH'],
    [{environmentDigest:sha256('other-env')},'TEST_ENVIRONMENT_MISMATCH'],
    [{testFilesDigest:sha256(['other.test.ts'])},'TEST_FILES_MISMATCH'],
    [{finishedAt:new Date(now.getTime()-400_000).toISOString(),startedAt:new Date(now.getTime()-401_000).toISOString()},'TEST_EXECUTION_STALE'],
    [{finishedAt:new Date(now.getTime()+10_000).toISOString()},'TEST_EXECUTION_TIME_INVALID'],
    [{tenantId:'tenant-2'},'TEST_EXECUTION_ATTESTATION_INVALID'],
    [{capturedOutputDigest:'not-a-digest' as string},'TEST_EXECUTION_ATTESTATION_INVALID'],
    [{exitStatus:1},'TEST_EXECUTION_ATTESTATION_INVALID'],
  ];
  for(const[patch,expectedCode]of cases){
    const claim={...base,...patch};
    let attestation:SignedTestExecutionClaim;
    try{attestation=attestTestExecution(claim,runner);}catch{attestation=signEnvelope(claim,runner);}
    const decision=new EvidenceCompletenessGate().evaluate(rebind(input,attestation),now);
    assert.ok(codes(decision).has(expectedCode),`${expectedCode}:${JSON.stringify(patch)}`);
  }
});

test('test evidence payload validation and attestation binding reject weak evidence independently',()=>{
  const {input}=fixture();
  const changed=chain(input.evidenceRecords.map((item)=>item.kind==='test-report'?{...withoutPrevious(item),evidenceClass:'COMPUTED' as const,payload:{executed:false,passed:false,failCount:2,reportDigest:sha256('wrong'),testManifestDigest:sha256('wrong'),attestationDigest:sha256('wrong')}}:withoutPrevious(item)));
  const decision=new EvidenceCompletenessGate().evaluate({...withoutPassport(input),evidenceRecords:changed,evidenceRoot:evidenceDigest(changed.at(-1)!),consumeReplayKey:false},now);
  const found=codes(decision); assert.ok(found.has('TEST_EVIDENCE_INVALID'));assert.ok(found.has('TEST_MANIFEST_MISMATCH'));assert.ok(found.has('TEST_EXECUTION_ATTESTATION_INVALID'));
});

test('passport invalidity, passport conflict, duplicate reviewers, self approval and replay are distinct blockers',()=>{
  const {input,passportSigner}=fixture();
  const expired=signEnvelope({...input.passport!.payload,tenantId:'tenant-2',subject:'other',evidenceRoot:sha256('other'),reviewerIds:['other'],expiresAt:new Date(now.getTime()-1).toISOString()},passportSigner);
  const decision=new EvidenceCompletenessGate().evaluate({...input,reviewerIds:['builder-1','builder-1'],passport:expired,consumeReplayKey:false},now);
  const found=codes(decision);for(const code of ['REVIEWER_MISSING','SELF_APPROVAL','PASSPORT_INVALID','PASSPORT_CONFLICT'])assert.ok(found.has(code),code);
  const gate=new EvidenceCompletenessGate();assert.equal(gate.evaluate(input,now).status,'PASS');assert.ok(codes(gate.evaluate(input,now)).has('EVIDENCE_REPLAY'));
});
