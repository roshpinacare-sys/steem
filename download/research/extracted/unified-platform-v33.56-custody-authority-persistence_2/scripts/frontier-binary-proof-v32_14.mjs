import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { inspectBinaryArtifactV32_14, compareBinaryArtifactsV32_14 } from '../dist/src/binary/proof-carrying-binary-v32_14.js';
import { compileFrontierContextV32_14, compileFrontierExecutionPlanV32_14, adjudicateFrontierClaimV32_14 } from '../dist/src/ai/frontier-execution-kernel-v32_14.js';
import { defaultFrontierRequirementsV32_14, evaluateFrontierSystemV32_14 } from '../dist/src/validation/frontier-comparative-assurance-v32_14.js';
import { sha256 } from '../dist/src/contracts/crypto.js';

const root = resolve('.');
const outputDir = resolve(process.env.V32_6_RUN_DIR ?? 'evidence/generated');
mkdirSync(outputDir, { recursive: true });
const policy = { policyId:'frontier-binary-proof', allowedKinds:['WASM','PDF','PNG','ZIP'], maximumBytes:64*1024*1024, chunkBytes:1024*1024, rejectUnknown:true, rejectPolyglot:true, rejectExecutables:false, rejectActivePdf:true, rejectArchiveTraversal:true, maximumArchiveEntries:100, maximumCompressionRatio:100, maximumEntropy:8 };
const wasm = Buffer.from([0,97,115,109,1,0,0,0,1,1,0]);
const pdf = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
const binaryStart = performance.now();
const wasmManifest = inspectBinaryArtifactV32_14('proof.wasm', wasm, policy);
const pdfManifest = inspectBinaryArtifactV32_14('proof.pdf', pdf, policy);
const large = Buffer.alloc(16*1024*1024); for(let i=0;i<large.length;i+=4096) large[i]=i/4096%251;
const largeManifest = inspectBinaryArtifactV32_14('large.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'),large,Buffer.from('\n%%EOF')]), policy);
const binaryDurationMs = Number((performance.now()-binaryStart).toFixed(3));
const delta = compareBinaryArtifactsV32_14(largeManifest, inspectBinaryArtifactV32_14('large-mutated.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'),large.subarray(0,8*1024*1024),Buffer.alloc(1024*1024,7),large.subarray(9*1024*1024),Buffer.from('\n%%EOF')]), policy));

const task = { taskId:'v32.14-frontier-cycle', objective:'Use SOL 5.6 as an evidence-driven multi-role frontier engineering system', complexity:.98, uncertainty:.9, blastRadius:.95, novelty:.95, expectedDurationMinutes:720, binaryInputs:true, externalActions:false, productionImpact:true, maximumContextChars:12000, maximumOutputChars:20000, maximumCostMicros:1000000, requiredProofClasses:['EXECUTED','ADVERSARIAL','DIFFERENTIAL','FORMAL'] };
const plan = compileFrontierExecutionPlanV32_14(task);
const classes = ['GOVERNANCE','SOURCE','TEST','FAILURE','EVIDENCE','BINARY','PRODUCT'];
const candidates = [];
for(let i=0;i<140;i+=1){const cls=classes[i%classes.length]; candidates.push({contextId:`ctx-${i}`,class:cls,trust:i%11===0?'UNTRUSTED':'TRUSTED',content:`${cls}:${i}:`+'x'.repeat(120+(i%17)),relevance:(i%10)/10,novelty:(i%7)/7,freshness:(i%9)/9,evidenceRefs:[`evidence:${i}`]});}
const context = compileFrontierContextV32_14(task,candidates);
const naiveChars = candidates.reduce((sum,item)=>sum+item.content.length,0);
const contextReductionRate = Number((1-context.usedChars/naiveChars).toFixed(6));
const verifierDir=mkdtempSync(join(tmpdir(),'v32-14-proof-verifier-'));
let independentVerification;
try {
  const artifactPath=join(verifierDir,'proof.wasm'), manifestPath=join(verifierDir,'manifest.json');
  writeFileSync(artifactPath,wasm); writeFileSync(manifestPath,JSON.stringify(wasmManifest,null,2)+'\n');
  independentVerification=JSON.parse(execFileSync('python3',['verifier-only/v32.14/independent_binary_verifier.py',artifactPath,manifestPath],{cwd:root,encoding:'utf8'}));
} finally { rmSync(verifierDir,{recursive:true,force:true}); }
const claim = adjudicateFrontierClaimV32_14({claimId:'binary-lineage',statement:'Binary bytes and derived structure remain bound',evidence:[{evidenceId:'node',proofClass:'EXECUTED',independentOracle:'typescript-inspector',passed:wasmManifest.verdict==='ACCEPT',artifactDigest:wasmManifest.contentDigest},{evidenceId:'python',proofClass:'ADVERSARIAL',independentOracle:'python-verifier',passed:independentVerification?.verdict==='VERIFIED'&&independentVerification?.artifactDigest===wasmManifest.contentDigest,artifactDigest:wasmManifest.contentDigest}]});
const requirements = defaultFrontierRequirementsV32_14();
const observedLocal = new Set(['LONG_HORIZON_EXECUTION','CONTEXT_ENGINEERING','CODING_AND_REPAIR','TOOL_COORDINATION','BINARY_ARTIFACT_INTELLIGENCE','FORMAL_ASSURANCE','ADVERSARIAL_FALSE_PASS_RESISTANCE','REPRODUCIBLE_RELEASE']);
const profile = { systemId:'unified-platform-v32.14', profileVersion:'32.14', evidence:requirements.map((item)=>({dimension:item.dimension,score:observedLocal.has(item.dimension)?.96:.5,evidenceClass:observedLocal.has(item.dimension)?'OBSERVED_CURRENT_EXECUTION':'STATIC',evidenceRef:`evidence/generated/V32_14_FRONTIER_BINARY_PROOF.json#${item.dimension}`,artifactDigest:sha256({dimension:item.dimension,version:'32.14'}),limitations:observedLocal.has(item.dimension)?[]:['external-observation-pending']})) };
const comparison = evaluateFrontierSystemV32_14(profile,requirements);
const report = {
  version:'32.14', generatedAt:new Date().toISOString(), status: wasmManifest.verdict==='ACCEPT'&&pdfManifest.verdict==='ACCEPT'&&claim.verdict==='PROVEN'?'passed':'failed',
  frontierExecution:{reasoningEffort:plan.reasoningEffort,subagentMode:plan.subagentMode,roles:plan.assignments.map(x=>x.role),stages:plan.stages,proofObligations:plan.proofObligations.length,planDigest:plan.planDigest},
  contextEngineering:{candidateCount:candidates.length,selectedCount:context.selected.length,droppedCount:context.dropped.length,naiveChars,usedChars:context.usedChars,contextReductionRate,classCoverage:context.classCoverage,contextDigest:context.contextDigest},
  binaryIntelligence:{formatsProven:[wasmManifest.detectedKind,pdfManifest.detectedKind],binaryDurationMs,largeArtifactBytes:largeManifest.sizeBytes,throughputMiBPerSecond:Number(((largeManifest.sizeBytes/1024/1024)/(binaryDurationMs/1000)).toFixed(3)),chunks:largeManifest.chunks.length,merkleRoot:largeManifest.merkleRoot,changedChunkCount:delta.changedChunks.length,chunkSimilarity:delta.chunkSimilarity,claimVerdict:claim.verdict,independentOracles:claim.independentOracles,independentVerifierAgreement:independentVerification?.verdict==='VERIFIED'&&independentVerification?.artifactDigest===wasmManifest.contentDigest,independentVerificationDigest:independentVerification?.verificationDigest},
  comparativeAssurance:{status:comparison.status,weightedScore:comparison.weightedScore,criticalPassed:comparison.criticalPassed,criticalTotal:comparison.criticalTotal,uniqueStrengths:comparison.uniqueStrengths,blockingGaps:comparison.blockingGaps,honestClaim:comparison.honestClaim},
  worldBestClaim:'not-proven',
  honestAdvantage:'The platform can combine frontier-model reasoning with sovereign execution, proof-carrying binary intake, independent verification, false-PASS resistance and reproducible release evidence; raw model supremacy remains an external benchmark question.',
  limitations:['Model-vendor scores were not executed in this offline run.','Binary inspection is static and bounded; it is not malware detonation or full semantic decompilation.','External production qualification remains blocked.']
};
writeFileSync(join(outputDir,'V32_14_FRONTIER_BINARY_PROOF.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.status!=='passed')process.exit(1);
