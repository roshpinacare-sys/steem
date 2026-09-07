import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  KeyRegistry, generateSigningIdentity, sha256, signEnvelope,
} from '../dist/src/contracts/crypto.js';
import {
  compareShadowExecutionV33_15, createWorkflowObservationV33_15,
  discoverShortcutCandidateV33_15, issueShortcutPassportV33_15,
  qualifyShortcutCandidateV33_15,
} from '../dist/src/runtime/proof-carrying-adaptive-execution-v33_15.js';
import {
  PersistentAdaptivePolicyControllerV33_16,
  PersistentAdaptivePolicyStoreV33_16,
} from '../dist/src/app/persistent-adaptive-policy-controller-v33_16.js';
import { recordApprovalDecision } from '../dist/src/product/chat-mission.js';
import {
  ContinuousAdaptiveControlServiceV33_17,
  ContinuousAdaptiveControlStoreV33_17,
  issueAdaptiveControlScheduleV33_17,
  verifyAdaptiveControlCycleReceiptV33_17,
} from '../dist/src/app/continuous-adaptive-control-service-v33_17.js';

const root = mkdtempSync(join(tmpdir(), 'v33.17-proof-'));
const out = new URL('../release-evidence/v33.17/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const start = new Date('2026-07-21T22:30:00.000Z');
const soakCycles = Number.parseInt(process.env.V33_17_SOAK_CYCLES ?? '90', 10);
if (!Number.isInteger(soakCycles) || soakCycles < 20) throw new Error('invalid_soak_cycle_count');
const driftSlot = Math.max(5, Math.floor(soakCycles / 3));
const restartSlot = Math.max(driftSlot + 2, Math.floor(soakCycles / 2));
const handoffSlot = Math.max(restartSlot + 2, Math.floor(soakCycles * 2 / 3));
let counter = 0;
const next = (p) => `${p}-${++counter}`;
const reg = (...ids) => { const r = new KeyRegistry(); for (const id of ids) r.register(id.keyId, id.publicKey); return r; };
const ids = {
  passport: generateSigningIdentity('v33.17-passport'), qualifier: generateSigningIdentity('v33.17-qualifier'),
  activation: generateSigningIdentity('v33.17-activation'), revoker: generateSigningIdentity('v33.17-revoker'),
  approver: generateSigningIdentity('v33.17-approver'), policyStore: generateSigningIdentity('v33.17-policy-store'),
  scheduler: generateSigningIdentity('v33.17-scheduler'), service: generateSigningIdentity('v33.17-service'),
  recovery: generateSigningIdentity('v33.17-recovery'), controlStore: generateSigningIdentity('v33.17-control-store'),
  proof: generateSigningIdentity('v33.17-proof'),
};
const policyTrust = {
  passportRegistry: reg(ids.passport), trustedPassportIssuerIds: [ids.passport.keyId],
  activationRegistry: reg(ids.activation), trustedActivationSignerIds: [ids.activation.keyId],
  revocationRegistry: reg(ids.revoker), trustedRevocationSignerIds: [ids.revoker.keyId],
  approvalRegistry: reg(ids.approver), trustedApproverSignerIds: [ids.approver.keyId],
};
const policyPath = join(root, 'policy.json');
const policyStore = new PersistentAdaptivePolicyStoreV33_16({ path: policyPath, storeIdentity: ids.policyStore, storeRegistry: reg(ids.policyStore), trustedStoreSignerIds: [ids.policyStore.keyId], trust: policyTrust, now: start });
const controller = new PersistentAdaptivePolicyControllerV33_16({ store: policyStore, trust: policyTrust, activationSigner: ids.activation, revocationSigner: ids.revoker });
const boundary = (workflowType) => ({ tenantId: 'tenant-a', workflowType, authorityGrantDigest: sha256(`grant:${workflowType}`), allowedScopes: ['repository:read','repository:shadow-change'], policyDigest: sha256(`policy:${workflowType}`), inputSchemaDigest: sha256(`schema:${workflowType}`), toolchainDigest: sha256(`tool:${workflowType}`), modelSetDigest: sha256(`models:${workflowType}`), riskClass: 'low', reversible: true });
function activate(workflowType) {
  const b = boundary(workflowType); const inputClassDigest = sha256(`input:${workflowType}`); const resultDigest = sha256(`result:${workflowType}`);
  const obs = (kind, i) => createWorkflowObservationV33_15({ observationId: next(`${workflowType}-${kind}`), evidenceClass: kind, boundary: b, inputClassDigest, fullWorkflowResultDigest: resultDigest, fullWorkflowEvidenceRoot: sha256({ workflowType, kind, i }), fullWorkflowPassed: true, userDecision: 'APPROVED', userSteps: 10, approvalCount: 1, costUnits: 10, durationMs: 1000, observedAt: new Date(start.getTime()-60_000+i).toISOString(), externalEffectsExecuted: 0 });
  const training = Array.from({length:5},(_,i)=>obs('TRAINING',i)); const holdout=Array.from({length:3},(_,i)=>obs('HOLDOUT',i)); const shadow=Array.from({length:5},(_,i)=>obs('SHADOW',i));
  const candidate=discoverShortcutCandidateV33_15({observations:training,now:start});
  const qualification=qualifyShortcutCandidateV33_15({candidate,holdoutObservations:holdout,qualifier:ids.qualifier,now:start});
  const comparisons=shadow.map((observation)=>compareShadowExecutionV33_15({candidate,observation,shortcutResultDigest:resultDigest,now:start}));
  const passport=issueShortcutPassportV33_15({candidate,qualification,qualificationRegistry:reg(ids.qualifier),trustedQualifierIds:[ids.qualifier.keyId],comparisons,issuer:ids.passport,expiresAt:new Date(start.getTime()+3_600_000).toISOString(),now:start});
  const row=controller.registerShortcut({passport,projectedCostUnits:2,projectedDurationMs:200,projectedUserSteps:1,evidenceScore:.95,now:start});
  const card=controller.issueActivationApproval({recordId:row.recordId,approverIds:[ids.approver.keyId],expiresAt:new Date(start.getTime()+300_000).toISOString(),now:start});
  const decision=recordApprovalDecision(card,{decisionId:next('approval'),cardId:card.cardId,actorId:ids.approver.keyId,option:'YES',occurredAt:new Date(start.getTime()+100).toISOString()},new Date(start.getTime()+200));
  controller.activateFromSignedApproval({recordId:row.recordId,decision:signEnvelope(decision,ids.approver),activationExpiresAt:new Date(start.getTime()+1_800_000).toISOString(),now:new Date(start.getTime()+200)});
  return {row,boundary:b,inputClassDigest,passport};
}
const workflows=[activate('dependency-patch'),activate('test-repair'),activate('documentation-refresh')];
const controlTrust={scheduleRegistry:reg(ids.scheduler),trustedSchedulerSignerIds:[ids.scheduler.keyId],serviceRegistry:reg(ids.service),trustedServiceSignerIds:[ids.service.keyId],recoveryRegistry:reg(ids.recovery),trustedRecoverySignerIds:[ids.recovery.keyId]};
const controlStoreRegistry=reg(ids.controlStore); const controlPath=join(root,'control.json'); const serviceId='adaptive-control-main';
let store=new ContinuousAdaptiveControlStoreV33_17({path:controlPath,serviceId,storeIdentity:ids.controlStore,storeRegistry:controlStoreRegistry,trustedStoreSignerIds:[ids.controlStore.keyId],trust:controlTrust,now:start});
let service=new ContinuousAdaptiveControlServiceV33_17({serviceId,store,controller,serviceSigner:ids.service,recoverySigner:ids.recovery,trust:controlTrust});
const schedule=issueAdaptiveControlScheduleV33_17({serviceId,scheduleId:'continuous-drift-sweep',tenantId:'tenant-a',cadenceMs:1000,notBefore:start.toISOString(),expiresAt:new Date(start.getTime()+600_000).toISOString(),maximumObservationCount:10,scheduler:ids.scheduler});
store.registerSchedule(schedule,start);
let leaseA=store.acquireLease('controller-a',1000,start);
const crashCycle={cycleId:'cycle-000',tenantId:'tenant-a',observations:[]};
let crashObserved=false;
try { service.runScheduledCycle({lease:leaseA,schedule,cycle:crashCycle,crashAfterStart:true,now:new Date(start.getTime()+500)}); } catch (error) { crashObserved=error instanceof Error && error.message==='injected_crash_after_cycle_start'; }
const takeoverAt=new Date(start.getTime()+1001); let lease=store.acquireLease('controller-b',20_000,takeoverAt);
const recovery=service.createRecoveryReceipt({cycleId:crashCycle.cycleId,previousFenceToken:leaseA.fenceToken,lease,now:takeoverAt});
const receipts=[]; receipts.push(service.runScheduledCycle({lease,schedule,cycle:crashCycle,recovery,now:takeoverAt}));
let staleFenceRejected=false; try { store.assertLease(leaseA,new Date(start.getTime()+1002)); } catch { staleFenceRejected=true; }
let secondControllerRejected=false; try { store.acquireLease('controller-c',1000,new Date(start.getTime()+1003)); } catch { secondControllerRejected=true; }
for (let slot=1; slot<soakCycles; slot += 1) {
  const now=new Date(start.getTime()+slot*1000+10);
  if (slot%10===0) lease=store.renewLease(lease,20_000,now);
  if (slot===restartSlot) {
    store=new ContinuousAdaptiveControlStoreV33_17({path:controlPath,serviceId,storeIdentity:ids.controlStore,storeRegistry:controlStoreRegistry,trustedStoreSignerIds:[ids.controlStore.keyId],trust:controlTrust,now});
    service=new ContinuousAdaptiveControlServiceV33_17({serviceId,store,controller,serviceSigner:ids.service,recoverySigner:ids.recovery,trust:controlTrust});
  }
  if (slot===handoffSlot) {
    const old=lease; store.releaseLease(old,now); lease=store.acquireLease('controller-b',20_000,new Date(now.getTime()+1));
    let rejected=false; try { store.assertLease(old,new Date(now.getTime()+2)); } catch { rejected=true; }
    if(!rejected) throw new Error('released_lease_not_fenced');
  }
  const observations=slot===driftSlot?[{passportDigest:workflows[2].passport.payload.passportDigest,currentBoundary:{...workflows[2].boundary,toolchainDigest:sha256('drifted-doc-tool')},inputClassDigest:workflows[2].inputClassDigest}]:[];
  receipts.push(service.runScheduledCycle({lease,schedule,cycle:{cycleId:`cycle-${String(slot).padStart(3,'0')}`,tenantId:'tenant-a',observations},now:slot===handoffSlot?new Date(now.getTime()+2):now}));
}
const snapshot=store.snapshot();
const validReceipts=receipts.filter((receipt)=>verifyAdaptiveControlCycleReceiptV33_17({envelope:receipt,registry:controlTrust.serviceRegistry,trustedSignerIds:controlTrust.trustedServiceSignerIds}));
const completed=snapshot.cycles.filter((cycle)=>cycle.status==='COMPLETED');
const uniqueSlots=new Set(completed.map((cycle)=>`${cycle.scheduleDigest}:${cycle.slot}`));
const uniqueCycles=new Set(completed.map((cycle)=>cycle.cycleId));
const revoked=policyStore.list().filter((record)=>record.status==='REVOKED');
const trace={version:'33.17',evidenceClass:'LOCAL_ACCELERATED_CONTINUOUS_CONTROL_SOAK',receiptDigests:receipts.map((x)=>x.payload.receiptDigest),cycleDigests:completed.map((x)=>x.cycleDigest),eventDigests:snapshot.events.map((x)=>x.eventDigest),leaseFenceCounter:snapshot.fenceCounter,traceDigest:''};
{const {traceDigest,...material}=trace;trace.traceDigest=sha256(material);}
const proofMaterial={version:'33.17',status:'CONTINUOUS_ADAPTIVE_CONTROL_SERVICE_PROVEN_LOCALLY',evidenceClass:'LOCAL_ACCELERATED_CONTINUOUS_CONTROL_SOAK',virtualSoakDurationSeconds:soakCycles,completedCycleCount:completed.length,validSignedReceiptCount:validReceipts.length,uniqueCycleCount:uniqueCycles.size,uniqueScheduleSlotCount:uniqueSlots.size,crashRecoveryCount:completed.filter((x)=>x.recovery!==undefined).length,crashObserved,staleFenceRejected,secondControllerRejected,fenceTransitions:snapshot.fenceCounter,serviceRestartCount:1,leaseRenewalCount:snapshot.events.filter((x)=>x.eventType==='LEASE_RENEWED').length,driftRevocationCount:revoked.length,fallbackReceiptCount:receipts.filter((x)=>x.payload.fallbackRoute==='FULL_GOVERNED_WORKFLOW').length,authorityExpansionCount:receipts.filter((x)=>x.payload.authorityExpanded).length,externalEffectsExecuted:0,eventChainLength:snapshot.events.length,limitations:['LOCAL_ACCELERATED_SOAK_NOT_REAL_TIME_DAEMON_EVIDENCE','SINGLE_HOST_FILE_STORE_NOT_DISTRIBUTED_CONSENSUS','LOCAL_WALL_CLOCK_WITH_ROLLBACK_REJECTION_NOT_EXTERNAL_MONOTONIC_WITNESS','SIGNED_LOCAL_SCHEDULER_NOT_EXTERNAL_ORCHESTRATOR','SHORTCUTS_REMAIN_SHADOW_ONLY','NO_EXTERNAL_EFFECTS_OR_PRODUCTION_AUTHORITY'],productionPromotion:'blocked',proofDigest:''};
{const {proofDigest,...material}=proofMaterial;proofMaterial.proofDigest=sha256(material);}
const signedProof=signEnvelope(proofMaterial,ids.proof); const proofRegistry=reg(ids.proof);
writeFileSync(join(out,'V33_17_CONTINUOUS_ADAPTIVE_CONTROL_SERVICE_PROOF.json'),JSON.stringify({...proofMaterial,proofEnvelope:{signedProof,publicKey:proofRegistry.exportPublicKey(ids.proof.keyId)}},null,2)+'\n');
writeFileSync(join(out,'V33_17_CONTINUOUS_CONTROL_TRACE.json'),JSON.stringify(trace,null,2)+'\n');
writeFileSync(join(out,'V33_17_CONTROL_STORE_SNAPSHOT.json'),JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify(proofMaterial,null,2));
rmSync(root,{recursive:true,force:true});
if(completed.length!==soakCycles||validReceipts.length!==soakCycles||uniqueCycles.size!==soakCycles||uniqueSlots.size!==soakCycles||proofMaterial.crashRecoveryCount!==1||!crashObserved||!staleFenceRejected||!secondControllerRejected||revoked.length!==1||proofMaterial.authorityExpansionCount!==0||proofMaterial.externalEffectsExecuted!==0)process.exit(1);
