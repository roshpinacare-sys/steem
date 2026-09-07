import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SignedEnvelope,
} from '../src/contracts/crypto.js';
import {
  EXPECTED_COMPLEMENTARY_IDS_V33_29,
  EXPECTED_CORE_AXIS_IDS_V33_29,
  EXPECTED_GATE_IDS_V33_29,
  EXPECTED_HYPOTHESIS_IDS_V33_29,
  EXPECTED_PARAMETER_IDS_V33_29,
  createMasterProgramScorecardV33_29,
  createProgramParameterLedgerV33_29,
  createStrategicRebalanceVerdictV33_29,
  verifyMasterProgramScorecardV33_29,
  verifyStrategicRebalanceVerdictV33_29,
  type MasterMetricV33_29,
  type MasterProgramScorecardV33_29,
  type ProgramParameterV33_29,
} from '../src/app/master-program-scorecard-v33_29.js';

const NOW = new Date('2026-07-22T08:00:00.000Z');

function registryFor(identity: ReturnType<typeof generateSigningIdentity>): KeyRegistry {
  const registry = new KeyRegistry(); registry.register(identity.keyId, identity.publicKey); return registry;
}
function params(): ProgramParameterV33_29[] {
  return EXPECTED_PARAMETER_IDS_V33_29.map((id, index) => ({
    id,
    category: index < 4 ? 'AUTHORITY' : index < 7 ? 'EVIDENCE' : index < 10 ? 'EXTERNAL' : 'QUALITY',
    target: `target:${id}`,
    status: index < 8 ? 'PRESERVED' : index < 11 ? 'STRENGTHENED' : 'EXTERNAL_EVIDENCE_PENDING',
    evidenceRefs: [`evidence/${id}.json`],
  }));
}
function metric(id: string, layer: MasterMetricV33_29['layer'], index: number): MasterMetricV33_29 {
  const historical = layer === 'CORE_AXIS' || layer === 'COMPLEMENTARY_METRIC'
    ? { version: '32.5', projectScore: 60 + (index % 40), confidenceAdjustedProjectScore: 55 + (index % 35) }
    : undefined;
  return {
    id, layer, title: `metric:${id}`,
    localMaturity: layer === 'PROOF_GATE' && (id === 'G7' || id === 'G8') ? 'WEAK' : index % 5 === 0 ? 'PARTIAL' : 'STRONG',
    externalMaturity: layer === 'PROOF_GATE'
      ? id === 'G0' || id === 'G1' ? 'PASSED' : id === 'G7' || id === 'G8' ? 'NOT_STARTED' : 'PENDING'
      : layer === 'PROGRAM_PARAMETER' && ['UX_REDUCTION_AND_COMPREHENSION_TARGETS','ENGINEERING_PRODUCT_PROOF_TARGETS','CATEGORY_AND_BUYER_PROOF_TARGETS'].includes(id)
        ? 'PENDING' : 'BLOCKED',
    ...(historical === undefined ? {} : { historicalNumericBaseline: historical }),
    currentNumericScoreAvailable: false,
    evidenceRefs: [`evidence/${id}.json`], blockers: [], nextProof: `next:${id}`,
  };
}
function metrics(): MasterMetricV33_29[] {
  let i = 0;
  return [
    ...EXPECTED_CORE_AXIS_IDS_V33_29.map((id) => metric(id, 'CORE_AXIS', i++)),
    ...EXPECTED_COMPLEMENTARY_IDS_V33_29.map((id) => metric(id, 'COMPLEMENTARY_METRIC', i++)),
    ...EXPECTED_GATE_IDS_V33_29.map((id) => metric(id, 'PROOF_GATE', i++)),
    ...EXPECTED_HYPOTHESIS_IDS_V33_29.map((id) => metric(id, 'VALUE_HYPOTHESIS', i++)),
    ...EXPECTED_PARAMETER_IDS_V33_29.map((id) => metric(id, 'PROGRAM_PARAMETER', i++)),
  ];
}
function releaseFacts() {
  return {
    tests: { files: 213, total: 1793, passed: 1793, failed: 0 as const },
    directV33: { files: 28, total: 626, passed: 626, failed: 0 as const },
    architecture: { sourceModules: 217, testFiles: 213, capabilityPaths: 151, closedCapabilityPaths: 151, sourceCycles: 0 as const, untestedSources: 0 as const, truthFindings: 0 as const },
    releaseExitCode: 0 as const, retryUsed: false as const, forceExitUsed: false as const, cleanExtractionValidated: true as const,
  };
}
function externalProgress() {
  return { buyerInterviews: 0, urgentFundedConfirmations: 0, designPartners: 0, paidPilots: 0, humanPilotParticipants: 0, qualifiedRepositories: 0, qualifiedMissions: 0, liveExternalWitnesses: 0, liveExternalScannerReceipts: 0, livePostgresBackends: 0, annualRecurringRevenueUsd: 0 };
}
function fixture() {
  const parameterSigner = generateSigningIdentity('parameter-ledger');
  const scoreSigner = generateSigningIdentity('master-scorecard');
  const verdictSigner = generateSigningIdentity('rebalance-verdict');
  const parameterLedger = createProgramParameterLedgerV33_29({ issuer: parameterSigner, previousLedgerDigest: sha256({ previous: true }), parameters: params(), generatedAt: NOW });
  const scorecard = createMasterProgramScorecardV33_29({ issuer: scoreSigner, metrics: metrics(), releaseFacts: releaseFacts(), externalProgress: externalProgress(), generatedAt: NOW });
  const verdict = createStrategicRebalanceVerdictV33_29({ issuer: verdictSigner, scorecard, scorecardRegistry: registryFor(scoreSigner), trustedScorecardSignerIds: [scoreSigner.keyId], parameterLedger, parameterRegistry: registryFor(parameterSigner), trustedParameterSignerIds: [parameterSigner.keyId], evaluatedAt: NOW });
  return { parameterSigner, scoreSigner, verdictSigner, parameterLedger, scorecard, verdict };
}

test('creates a 14 parameter ledger with exact status counts', () => { const f=fixture(); assert.equal(f.parameterLedger.payload.parameterCount,14); assert.deepEqual([f.parameterLedger.payload.preservedParameterCount,f.parameterLedger.payload.strengthenedParameterCount,f.parameterLedger.payload.externalEvidencePendingParameterCount],[8,3,3]); });
test('creates a 54 metric master inventory', () => { const f=fixture(); assert.equal(f.scorecard.payload.metricCount,54); assert.deepEqual(f.scorecard.payload.layerCounts,{coreAxes:14,complementaryMetrics:8,proofGates:9,valueHypotheses:9,programParameters:14}); });
test('historical numeric baselines are explicitly stale', () => { assert.equal(fixture().scorecard.payload.historicalScorecardStatus,'HISTORICAL_BASELINE_ONLY_RESCORING_REQUIRED'); });
test('current numeric score cannot be asserted', () => { const bad=metrics(); (bad[0] as unknown as {currentNumericScoreAvailable:boolean}).currentNumericScoreAvailable=true; assert.throws(()=>createMasterProgramScorecardV33_29({issuer:generateSigningIdentity('x'),metrics:bad,releaseFacts:releaseFacts(),externalProgress:externalProgress(),generatedAt:NOW}),/current_numeric_score_must_be_unavailable/); });
test('missing one core axis is rejected', () => { assert.throws(()=>createMasterProgramScorecardV33_29({issuer:generateSigningIdentity('x'),metrics:metrics().filter(m=>m.id!=='requirement-fidelity'),releaseFacts:releaseFacts(),externalProgress:externalProgress(),generatedAt:NOW}),/master_metric_count_invalid/); });
test('duplicate metric is rejected', () => { const bad=metrics(); bad[1]={...bad[0]!}; assert.throws(()=>createMasterProgramScorecardV33_29({issuer:generateSigningIdentity('x'),metrics:bad,releaseFacts:releaseFacts(),externalProgress:externalProgress(),generatedAt:NOW}),/master_metric_duplicate/); });
test('wrong gate inventory is rejected', () => { const bad=metrics(); const idx=bad.findIndex(m=>m.id==='G8'); bad[idx]={...bad[idx]!,id:'G9'}; assert.throws(()=>createMasterProgramScorecardV33_29({issuer:generateSigningIdentity('x'),metrics:bad,releaseFacts:releaseFacts(),externalProgress:externalProgress(),generatedAt:NOW}),/proof_gate_ids_invalid/); });
test('wrong parameter status counts are rejected', () => { const bad=params(); bad[0]={...bad[0]!,status:'STRENGTHENED'}; assert.throws(()=>createProgramParameterLedgerV33_29({issuer:generateSigningIdentity('x'),previousLedgerDigest:sha256({a:1}),parameters:bad,generatedAt:NOW}),/parameter_status_counts_invalid/); });
test('parameter omission is rejected', () => { assert.throws(()=>createProgramParameterLedgerV33_29({issuer:generateSigningIdentity('x'),previousLedgerDigest:sha256({a:1}),parameters:params().slice(1),generatedAt:NOW}),/parameter_ids_invalid/); });
test('invalid previous ledger digest is rejected', () => { assert.throws(()=>createProgramParameterLedgerV33_29({issuer:generateSigningIdentity('x'),previousLedgerDigest:'bad',parameters:params(),generatedAt:NOW}),/previous_parameter_ledger_digest_invalid/); });
test('release test failure is rejected', () => { const facts=releaseFacts(); const bad={...facts,tests:{...facts.tests,failed:1 as never,passed:1792}}; assert.throws(()=>createMasterProgramScorecardV33_29({issuer:generateSigningIdentity('x'),metrics:metrics(),releaseFacts:bad,externalProgress:externalProgress(),generatedAt:NOW}),/release_test_facts_invalid/); });
test('capability path gap is rejected', () => { const facts=releaseFacts(); const bad={...facts,architecture:{...facts.architecture,closedCapabilityPaths:150}}; assert.throws(()=>createMasterProgramScorecardV33_29({issuer:generateSigningIdentity('x'),metrics:metrics(),releaseFacts:bad,externalProgress:externalProgress(),generatedAt:NOW}),/release_architecture_facts_invalid/); });
test('retry use is rejected', () => { const facts=releaseFacts(); const bad={...facts,retryUsed:true as never}; assert.throws(()=>createMasterProgramScorecardV33_29({issuer:generateSigningIdentity('x'),metrics:metrics(),releaseFacts:bad,externalProgress:externalProgress(),generatedAt:NOW}),/release_reproducibility_facts_invalid/); });
test('external progress cannot exceed target', () => { assert.throws(()=>createMasterProgramScorecardV33_29({issuer:generateSigningIdentity('x'),metrics:metrics(),releaseFacts:releaseFacts(),externalProgress:{...externalProgress(),buyerInterviews:16},generatedAt:NOW}),/external_progress_exceeds_target/); });
test('scorecard signature and digest verify', () => { const f=fixture(); assert.equal(verifyMasterProgramScorecardV33_29({scorecard:f.scorecard,registry:registryFor(f.scoreSigner),trustedSignerIds:[f.scoreSigner.keyId]}).metricCount,54); });
test('scorecard payload tampering is rejected', () => { const f=fixture(); const bad={...f.scorecard,payload:{...f.scorecard.payload,metricCount:53 as never}}; assert.throws(()=>verifyMasterProgramScorecardV33_29({scorecard:bad,registry:registryFor(f.scoreSigner),trustedSignerIds:[f.scoreSigner.keyId]}),/scorecard_signature_invalid/); });
test('re-signed scorecard with false digest is rejected', () => { const f=fixture(); const bad=signEnvelope({...f.scorecard.payload,scorecardDigest:sha256({false:true})},f.scoreSigner); assert.throws(()=>verifyMasterProgramScorecardV33_29({scorecard:bad,registry:registryFor(f.scoreSigner),trustedSignerIds:[f.scoreSigner.keyId]}),/scorecard_digest_invalid/); });
test('untrusted scorecard signer is rejected', () => { const f=fixture(); assert.throws(()=>verifyMasterProgramScorecardV33_29({scorecard:f.scorecard,registry:registryFor(f.scoreSigner),trustedSignerIds:['other']}),/scorecard_signature_invalid/); });
test('strategic verdict identifies external product and market critical gap', () => { const v=fixture().verdict.payload; assert.equal(v.status,'LOCAL_ASSURANCE_STRONG_EXTERNAL_PRODUCT_MARKET_CRITICAL_GAP'); assert.equal(v.externalProductEvidence,'CRITICAL_GAP'); assert.equal(v.marketEvidence,'CRITICAL_GAP'); });
test('priority order starts with UX then real repositories then buyers', () => { assert.deepEqual(fixture().verdict.payload.requiredPriorityOrder.slice(0,3),['G3_CONTROLLED_HUMAN_UX_PILOT','G4_REAL_REPOSITORY_30_MISSION_CAMPAIGN','G2_BUYER_INTERVIEWS_DESIGN_PARTNERS_PAID_PILOTS']); });
test('local security feature expansion is disabled by default', () => { assert.equal(fixture().verdict.payload.localSecurityFeatureExpansionAllowed,false); });
test('production remains blocked', () => { const v=fixture().verdict.payload; assert.equal(v.productionReadiness,'BLOCKED'); assert.equal(v.productionAuthority,'NONE'); assert.equal(v.externalEffectsExecuted,0); });
test('verdict signature and bindings verify', () => { const f=fixture(); const v=verifyStrategicRebalanceVerdictV33_29({verdict:f.verdict,registry:registryFor(f.verdictSigner),trustedSignerIds:[f.verdictSigner.keyId],expectedScorecardDigest:f.scorecard.payload.scorecardDigest,expectedParameterLedgerDigest:f.parameterLedger.payload.ledgerDigest}); assert.equal(v.localReleaseIntegrity,'PASS'); });
test('verdict scorecard binding mismatch is rejected', () => { const f=fixture(); assert.throws(()=>verifyStrategicRebalanceVerdictV33_29({verdict:f.verdict,registry:registryFor(f.verdictSigner),trustedSignerIds:[f.verdictSigner.keyId],expectedScorecardDigest:sha256({wrong:true}),expectedParameterLedgerDigest:f.parameterLedger.payload.ledgerDigest}),/rebalance_verdict_binding_invalid/); });
test('re-signed verdict allowing feature expansion is rejected', () => { const f=fixture(); const p={...f.verdict.payload,localSecurityFeatureExpansionAllowed:true as never}; const {verdictDigest:_d,...material}=p; const bad=signEnvelope({...p,verdictDigest:sha256(material)},f.verdictSigner); assert.throws(()=>verifyStrategicRebalanceVerdictV33_29({verdict:bad,registry:registryFor(f.verdictSigner),trustedSignerIds:[f.verdictSigner.keyId],expectedScorecardDigest:f.scorecard.payload.scorecardDigest,expectedParameterLedgerDigest:f.parameterLedger.payload.ledgerDigest}),/rebalance_verdict_boundary_invalid/); });
test('rebalance verdict refuses fabricated external progress', () => { const f=fixture(); const scorecard=createMasterProgramScorecardV33_29({issuer:f.scoreSigner,metrics:metrics(),releaseFacts:releaseFacts(),externalProgress:{...externalProgress(),buyerInterviews:1},generatedAt:NOW}); assert.throws(()=>createStrategicRebalanceVerdictV33_29({issuer:f.verdictSigner,scorecard,scorecardRegistry:registryFor(f.scoreSigner),trustedScorecardSignerIds:[f.scoreSigner.keyId],parameterLedger:f.parameterLedger,parameterRegistry:registryFor(f.parameterSigner),trustedParameterSignerIds:[f.parameterSigner.keyId],evaluatedAt:NOW}),/rebalance_external_progress_fixture_not_zero/); });
test('rebalance verdict refuses failed local release integrity', () => { const f=fixture(); const payload={...f.scorecard.payload,releaseFacts:{...f.scorecard.payload.releaseFacts,architecture:{...f.scorecard.payload.releaseFacts.architecture,closedCapabilityPaths:150}}}; const {scorecardDigest:_d,...material}=payload; const scorecard=signEnvelope({...payload,scorecardDigest:sha256(material)},f.scoreSigner) as SignedEnvelope<MasterProgramScorecardV33_29>; assert.throws(()=>createStrategicRebalanceVerdictV33_29({issuer:f.verdictSigner,scorecard,scorecardRegistry:registryFor(f.scoreSigner),trustedScorecardSignerIds:[f.scoreSigner.keyId],parameterLedger:f.parameterLedger,parameterRegistry:registryFor(f.parameterSigner),trustedParameterSignerIds:[f.parameterSigner.keyId],evaluatedAt:NOW}),/rebalance_local_integrity_not_passed/); });
test('future invalid date is rejected only when invalid Date object', () => { assert.throws(()=>createMasterProgramScorecardV33_29({issuer:generateSigningIdentity('x'),metrics:metrics(),releaseFacts:releaseFacts(),externalProgress:externalProgress(),generatedAt:new Date('bad')}),/scorecard_time_invalid/); });
test('metric without evidence is rejected', () => { const bad=metrics(); bad[0]={...bad[0]!,evidenceRefs:[]}; assert.throws(()=>createMasterProgramScorecardV33_29({issuer:generateSigningIdentity('x'),metrics:bad,releaseFacts:releaseFacts(),externalProgress:externalProgress(),generatedAt:NOW}),/master_metric_content_invalid/); });
test('historical baseline from a non-v32.5 version is rejected', () => { const bad=metrics(); bad[0]={...bad[0]!,historicalNumericBaseline:{version:'33.28',projectScore:99}}; assert.throws(()=>createMasterProgramScorecardV33_29({issuer:generateSigningIdentity('x'),metrics:bad,releaseFacts:releaseFacts(),externalProgress:externalProgress(),generatedAt:NOW}),/historical_baseline_invalid/); });
test('current scorecard does not convert local assurance into external pass', () => { const s=fixture().scorecard.payload; assert.equal(s.proofGateStatus.passed,2); assert.equal(s.valueHypothesisStatus.proven,0); assert.equal(s.externalProgress.paidPilots,0); });
test('external evidence and production effects remain zero', () => { const f=fixture(); assert.equal(f.scorecard.payload.externalEffectsExecuted,0); assert.equal(f.parameterLedger.payload.externalEffectsExecuted,0); assert.equal(f.verdict.payload.externalEffectsExecuted,0); });
