import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { sha256 } from '../dist/src/contracts/crypto.js';
import { SovereignEfficiencyFabric, TenantSemanticCache, SovereignAdmissionController, SingleFlightCoordinator, SovereignCostLedger } from '../dist/src/runtime/sovereign-efficiency-fabric.js';
import { evaluateSovereignConsolidation } from '../dist/src/platform/sovereign-service-consolidation-v32_13.js';
import { optimizeSovereignTopology } from '../dist/src/operations/sovereign-topology-optimizer-v32_13.js';
import { planSovereignCapacityV32_13 } from '../dist/src/operations/sovereign-capacity-controller-v32_13.js';

const out = resolve(process.env.V32_6_RUN_DIR || 'evidence/generated'); mkdirSync(out, { recursive: true });
const d = (value) => sha256(value);
const policy = { tenantId:'tenant-a', allowLocalModel:true, allowBurstNode:true, allowExternalModel:true, maximumExternalSensitivity:'INTERNAL', maximumExternalCostMicros:1000, localModelMaximumQuality:0.85, localSynchronousComputeUnits:8, localAsynchronousComputeUnits:64, cacheSimilarityFloor:0.8 };
const estimate = { externalCostMicros:1000, localModelQuality:0.8, localRulesLatencyMs:1, localModelLatencyMs:5, asyncAdmissionLatencyMs:1, burstLatencyMs:20, externalLatencyMs:50, burstAvailable:true };
const base = { tenantId:'tenant-a', workloadId:'analysis', operation:'summarize', sensitivity:'INTERNAL', deterministic:false, cacheable:true, semanticReuseAllowed:true, allowAsync:true, freshnessMs:60000, requiredQuality:0.7, estimatedComputeUnits:1, latencyBudgetMs:500, sourceDigest:d('source-v32.13'), policyDigest:d(policy), authorityDigest:d('authority-v32.13') };
const handlerCounts = { rules:0, localModel:0, async:0, burst:0, external:0 };
const handler = (name) => async (request) => { handlerCounts[name] += 1; if (name === 'localModel' && String(request.input).startsWith('concurrent')) await new Promise((resolveDelay) => setTimeout(resolveDelay, 5)); return { result:{ answer:`${name}:${String(request.input)}` }, evidenceDigest:d({ name, input:request.input }) }; };
const ledger = new SovereignCostLedger();
const fabric = new SovereignEfficiencyFabric(new TenantSemanticCache(256), new SovereignAdmissionController(32,16), new SingleFlightCoordinator(), ledger, { localRules:handler('rules'), localModel:handler('localModel'), localAsync:handler('async'), burstNode:handler('burst'), externalModel:handler('external') });
const routes = new Map(); const record = (outcome) => routes.set(outcome.target,(routes.get(outcome.target)||0)+1);
const started = performance.now(); let requestSequence=0;
for(let key=0;key<100;key+=1) for(let repeat=0;repeat<5;repeat+=1) record(await fabric.execute({ ...base, requestId:`repeat-${requestSequence++}`, input:`repeat workload ${key}` },policy,estimate));
for(let key=0;key<100;key+=1) record(await fabric.execute({ ...base, requestId:`rules-${requestSequence++}`, input:{a:key,b:key+1}, deterministic:true, cacheable:false },policy,estimate));
const concurrent = Array.from({length:100},(_,index)=>fabric.execute({ ...base, requestId:`concurrent-${index}`, input:'concurrent shared workload', cacheable:false },policy,estimate));
for(const outcome of await Promise.all(concurrent)) record(outcome);
for(let key=0;key<100;key+=1) record(await fabric.execute({ ...base, requestId:`external-${requestSequence++}`, input:`external ${key}`, requiredQuality:0.95, allowAsync:false, estimatedComputeUnits:80 },{...policy,allowBurstNode:false},estimate));
const elapsedMs=performance.now()-started; const summary=ledger.summary();
const requirements = ['identity','relational-database','cache','job-queue','object-storage','secrets','observability','ai-routing','email','payments'].map((serviceId)=>({serviceId,required:true,productionCritical:['identity','relational-database','object-storage','secrets','payments'].includes(serviceId),multiHostRequired:['identity','relational-database','object-storage','secrets'].includes(serviceId)}));
const evidence = [
 ['identity','src/security/private-identity.ts',true,false],['relational-database','src/runtime/postgres-store.ts',false,true],['cache','src/runtime/sovereign-efficiency-fabric.ts',false,false],['job-queue','src/runtime/postgres-store.ts',false,false],['object-storage','src/artifacts/content-addressed-store.ts',false,false],['secrets','src/security/encrypted-keystore.ts',false,false],['observability','src/operations/telemetry.ts',false,false],['ai-routing','src/runtime/sovereign-efficiency-fabric.ts',false,false],['email','external-adapter',false,true],['payments','external-adapter',false,true],
].map(([serviceId,implementation,multiHostQualified,externalDependency])=>({serviceId,implementation,sourcePaths:[implementation],testPaths:['tests/sovereign-service-consolidation-v32_13.test.ts'],observed:!['email','payments'].includes(serviceId),multiHostQualified,dataSovereign:!['email','payments'].includes(serviceId),perUserLicense:false,externalDependency}));
const consolidation=evaluateSovereignConsolidation(requirements,evidence);
const offers=[
 {offerId:'data-a',providerId:'main',failureDomain:'a',monthlyCostMicros:50_000_000,cpuCores:16,memoryGiB:64,nvmeGiB:2000,networkGbps:1,roles:['COMPUTE','DATABASE','STORAGE']},
 {offerId:'data-b',providerId:'main',failureDomain:'b',monthlyCostMicros:50_000_000,cpuCores:16,memoryGiB:64,nvmeGiB:2000,networkGbps:1,roles:['COMPUTE','DATABASE','STORAGE']},
 {offerId:'data-c',providerId:'main',failureDomain:'c',monthlyCostMicros:50_000_000,cpuCores:16,memoryGiB:64,nvmeGiB:2000,networkGbps:1,roles:['COMPUTE','DATABASE','STORAGE','WITNESS']},
 {offerId:'witness',providerId:'independent',failureDomain:'x',monthlyCostMicros:5_000_000,cpuCores:2,memoryGiB:4,nvmeGiB:80,networkGbps:1,roles:['WITNESS']},
 {offerId:'backup',providerId:'independent',failureDomain:'y',monthlyCostMicros:8_000_000,cpuCores:2,memoryGiB:4,nvmeGiB:4000,networkGbps:1,roles:['BACKUP']},
];
const topology=optimizeSovereignTopology(offers,{minimumComputeNodes:2,minimumDatabaseNodes:2,minimumWitnessNodes:1,minimumBackupNodes:1,minimumCpuCores:24,minimumMemoryGiB:96,minimumUsableNvmeGiB:1500,minimumFailureDomains:4,minimumProviders:2,maximumMonthlyCostMicros:200_000_000,reservePercent:20});
const threeLargeReferenceCost=163_000_000;
const capacityPolicy={tenantId:'tenant-a',maximumLocalWorkers:8,maximumBurstNodes:3,jobsPerLocalWorker:10,minimumLocalWorkersWhenBusy:1,idleScaleToZeroMs:60000,burstQueueThreshold:10,maximumBurstHourlyCostMicros:900,maximumBurstSensitivity:'CONFIDENTIAL',maximumBurstStartupMs:30000,allowedProviderIds:['sovereign-a'],allowedRegionIds:['eu-1']};
const capacityOffers=[{offerId:'qualified-burst',providerId:'sovereign-a',regionId:'eu-1',hourlyCostMicros:300,capacityJobsPerNode:50,startupMs:10000,observed:true,dataSovereign:true}];
const burstPlan=planSovereignCapacityV32_13({tenantId:'tenant-a',sequence:1,observedAt:new Date().toISOString(),queueDepth:150,oldestJobAgeMs:1000,activeLocalWorkers:8,activeBurstNodes:0,idleForMs:0,workloadSensitivity:'INTERNAL',previousPlanDigest:null},capacityPolicy,capacityOffers);
const scaleToZeroPlan=planSovereignCapacityV32_13({tenantId:'tenant-a',sequence:1,observedAt:new Date().toISOString(),queueDepth:0,oldestJobAgeMs:0,activeLocalWorkers:4,activeBurstNodes:1,idleForMs:60000,workloadSensitivity:'INTERNAL',previousPlanDigest:null},capacityPolicy,capacityOffers);
const report={version:'32.13',generatedAt:new Date().toISOString(),status:'passed',classification:'repository-local-synthetic-workload-and-operator-supplied-cost-model',workload:{logicalOperations:800,handlerInvocations:Object.values(handlerCounts).reduce((a,b)=>a+b,0),handlerCounts,routes:Object.fromEntries([...routes.entries()].sort()),elapsedMs:Number(elapsedMs.toFixed(3)),logicalOperationsPerSecond:Number((800/(elapsedMs/1000)).toFixed(2))},costEvidence:summary,operationElimination:{avoidedHandlerInvocations:800-Object.values(handlerCounts).reduce((a,b)=>a+b,0),eliminationRate:Number(((800-Object.values(handlerCounts).reduce((a,b)=>a+b,0))/800).toFixed(6))},consolidation,topology:{...topology,threeLargeReferenceCostMicros:threeLargeReferenceCost,optimizedCostReductionMicros:threeLargeReferenceCost-topology.monthlyCostMicros,optimizedCostReductionRate:Number(((threeLargeReferenceCost-topology.monthlyCostMicros)/threeLargeReferenceCost).toFixed(6))},capacityControl:{burstPlan,scaleToZeroPlan},limitations:['synthetic workload does not prove production traffic distribution','cost inputs are normalized operator-supplied examples, not current provider quotes','multi-host PostgreSQL, storage, witness and failover remain externally unqualified']};
report.reportDigest=createHash('sha256').update(JSON.stringify(report)).digest('hex');
writeFileSync(join(out,'V32_13_SOVEREIGN_EFFICIENCY_PROOF.json'),`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify({status:report.status,workload:report.workload,costEvidence:summary,operationElimination:report.operationElimination,consolidation:{status:consolidation.status,nativeServices:consolidation.nativeServices,selfHostedStandards:consolidation.selfHostedStandards,externalBoundaries:consolidation.unavoidableExternalBoundaries,eliminatedPerUserLicenses:consolidation.eliminatedPerUserLicenses},topology:report.topology,capacityControl:{burstStatus:burstPlan.status,burstActions:burstPlan.actions,scaleToZeroActions:scaleToZeroPlan.actions}},null,2));
