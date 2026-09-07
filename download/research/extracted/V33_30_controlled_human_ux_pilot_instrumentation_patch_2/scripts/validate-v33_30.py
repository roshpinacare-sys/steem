#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
E=ROOT/'release-evidence/v33.30'
errors=[]

def load(rel): return json.loads((ROOT/rel).read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def phase(name): print(json.dumps({'phase':name}),flush=True)

required=[
 'src/app/controlled-human-ux-pilot-v33_30.ts',
 'tests/controlled-human-ux-pilot-v33_30.test.ts',
 'src/repository/qualified-hostile-code-isolation-v33_12.ts',
 'tests/qualified-hostile-code-isolation-v33_12.test.ts',
 'scripts/controlled-human-ux-pilot-proof-v33_30.mjs',
 'scripts/verify-controlled-human-ux-pilot-v33_30.mjs',
 'scripts/run-full-regression-v33_30.py',
 'scripts/run-direct-v33-regression-v33_30.py',
 'scripts/validate-v33_30.py',
 'docs/V33_30_CONTROLLED_HUMAN_UX_PILOT_INSTRUMENTATION.md',
 'CLAUDE_HANDOFF_v33_30.md',
 'V33_30_עדכון_ביצוע_והוכחות.md',
 'pilot-kits/v33.30/human-ux-pilot/CONSENT_TEMPLATE.md',
 'pilot-kits/v33.30/human-ux-pilot/EVENT_SCHEMA.json',
 'pilot-kits/v33.30/human-ux-pilot/EXTERNAL_EXECUTION_CHECKLIST.md',
 'pilot-kits/v33.30/human-ux-pilot/RUNBOOK.md',
 'release-evidence/v33.30/V33_30_UX_PILOT_PROTOCOL.json',
 'release-evidence/v33.30/V33_30_SYNTHETIC_CONSENTS.json',
 'release-evidence/v33.30/V33_30_SYNTHETIC_BASELINE_EVIDENCE.json',
 'release-evidence/v33.30/V33_30_SYNTHETIC_GOVERNED_EVIDENCE.json',
 'release-evidence/v33.30/V33_30_SYNTHETIC_UX_VERDICT.json',
 'release-evidence/v33.30/V33_30_METRIC_CONTINUITY_RECEIPT.json',
 'release-evidence/v33.30/V33_30_CONTROLLED_HUMAN_UX_PILOT_PROOF.json',
 'release-evidence/v33.30/V33_30_PROOF_PUBLIC_KEYS.json',
 'release-evidence/v33.30/V33_30_FULL_TEST_RESULTS.json',
 'release-evidence/v33.30/V33_30_FULL_TEST_META.json',
 'release-evidence/v33.30/V33_30_FULL_TEST_STDOUT.tap',
 'release-evidence/v33.30/V33_30_FULL_TEST_STDERR.log',
 'release-evidence/v33.30/V33_30_FULL_TEST_EXIT.txt',
 'release-evidence/v33.30/V33_30_DIRECT_V33_RESULTS.json',
 'release-evidence/v33.30/V33_30_REPOSITORY_TRUTH_MAP.json',
 'release-evidence/v33.30/V33_30_ARCHITECTURE_INTEGRITY.json',
 'release-evidence/v33.30/V33_30_EXECUTION_LEDGER.md',
 'release-evidence/v33.30/V33_30_RELEASE_MANIFEST.json',
]
for rel in required:
 if not (ROOT/rel).is_file(): errors.append('missing:'+rel)
if errors:
 result={'version':'33.30','status':'failed','errors':errors,'productionPromotion':'blocked'}
 E.mkdir(parents=True,exist_ok=True); (E/'V33_30_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2)); sys.exit(1)

phase('proof-signatures')
v=subprocess.run(['node','scripts/verify-controlled-human-ux-pilot-v33_30.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180)
if v.returncode: errors.append('proof_verification_failed:'+v.stderr[-500:])

proof=load('release-evidence/v33.30/V33_30_CONTROLLED_HUMAN_UX_PILOT_PROOF.json')['payload']
protocol=load('release-evidence/v33.30/V33_30_UX_PILOT_PROTOCOL.json')['payload']
verdict=load('release-evidence/v33.30/V33_30_SYNTHETIC_UX_VERDICT.json')['payload']
continuity=load('release-evidence/v33.30/V33_30_METRIC_CONTINUITY_RECEIPT.json')['payload']
prior_score=load('release-evidence/v33.29/V33_29_MASTER_PROGRAM_SCORECARD.json')['payload']
prior_params=load('release-evidence/v33.29/V33_29_PARAMETER_LEDGER.json')['payload']
full=load('release-evidence/v33.30/V33_30_FULL_TEST_RESULTS.json')
meta=load('release-evidence/v33.30/V33_30_FULL_TEST_META.json')
direct=load('release-evidence/v33.30/V33_30_DIRECT_V33_RESULTS.json')
truth=load('release-evidence/v33.30/V33_30_REPOSITORY_TRUTH_MAP.json')
arch=load('release-evidence/v33.30/V33_30_ARCHITECTURE_INTEGRITY.json')
manifest=load('release-evidence/v33.30/V33_30_RELEASE_MANIFEST.json')

expected_metrics={'medianStepReductionPercent':73.3,'medianGovernedApprovals':1,'medianComprehensionSeconds':6,'taskSuccessRatePercent':100,'accessibilityPassRatePercent':100,'evidenceClosurePercent':100}
expected_priority=['G3_CONTROLLED_HUMAN_UX_PILOT','G4_REAL_REPOSITORY_30_MISSION_CAMPAIGN','G2_BUYER_INTERVIEWS_DESIGN_PARTNERS_PAID_PILOTS','G5_ONLY_EXTERNAL_TRUST_CONTROLS_THAT_DIRECTLY_UNBLOCK_THE_PILOT']
if proof.get('status')!='CONTROLLED_HUMAN_UX_PILOT_INSTRUMENTATION_PROVEN_LOCALLY' or proof.get('focusedTestsExpected')!=43: errors.append('proof_status_invalid')
if proof.get('syntheticMetrics')!=expected_metrics or proof.get('syntheticVerdict')!='HUMAN_UX_PILOT_REQUIRED': errors.append('synthetic_metrics_invalid')
if proof.get('humanPilotPassed') or proof.get('externalHumanParticipants')!=0 or proof.get('syntheticParticipants')!=5: errors.append('synthetic_boundary_invalid')
if protocol.get('minimumParticipants')!=5 or protocol.get('minimumDistinctScenarios')!=3 or protocol.get('targetStepReductionPercent')!=70 or protocol.get('maximumMedianApprovals')!=1 or protocol.get('maximumMedianComprehensionSeconds')!=10: errors.append('protocol_threshold_invalid')
if protocol.get('requiredTaskSuccessRatePercent')!=100 or protocol.get('requiredAccessibilityPassRatePercent')!=100 or protocol.get('requiredEvidenceClosurePercent')!=100: errors.append('protocol_quality_threshold_invalid')
if protocol.get('rawPiiCollectionAllowed') or protocol.get('audioVideoRecordingAllowed') or protocol.get('productionCeiling')!='shadow' or protocol.get('externalEffectsExecuted')!=0: errors.append('protocol_privacy_or_effect_boundary_invalid')
if verdict.get('evidenceClass')!='SIMULATED_CONTRACT_TEST' or verdict.get('participantCount')!=5 or verdict.get('distinctScenarioCount')!=3 or verdict.get('humanPilotPassed') or verdict.get('status')!='HUMAN_UX_PILOT_REQUIRED': errors.append('verdict_boundary_invalid')
if verdict.get('medianStepReductionPercent')!=73.3 or verdict.get('medianGovernedApprovals')!=1 or verdict.get('medianComprehensionSeconds')!=6 or verdict.get('unauthorizedEffectCount')!=0: errors.append('verdict_metric_invalid')
if continuity.get('previousScorecardDigest')!=prior_score.get('scorecardDigest') or continuity.get('previousParameterLedgerDigest')!=prior_params.get('ledgerDigest'): errors.append('metric_continuity_binding_invalid')
if continuity.get('metricInventoryCount')!=54 or continuity.get('parameterCount')!=14 or continuity.get('priorityOrder')!=expected_priority: errors.append('metric_continuity_inventory_invalid')
if set(continuity.get('externalProgress',{}).values())!={0} or proof.get('externalProgress')!=continuity.get('externalProgress'): errors.append('fabricated_external_progress')
deltas={x.get('metricId'):x for x in continuity.get('metricDeltas',[])}
if deltas.get('accessibility-human-factors',{}).get('currentLocalMaturity')!='PARTIAL' or deltas.get('VH-02',{}).get('currentLocalMaturity')!='WEAK': errors.append('metric_delta_invalid')

# G3 must remain in progress and point to the human study instrumentation.
gates={g['id']:g for g in load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')['gates']}
g3=gates.get('G3',{})
if g3.get('status')!='in-progress' or 'human-study-not-executed' not in g3.get('prototypeStatus','') or not any('controlled-human-ux-pilot-v33_30' in r for r in g3.get('prototypeEvidenceRefs',[])): errors.append('g3_mapping_invalid')

# Historical isolation correction: sealed procfs and real namespace identity checks, never the old /proc/net/dev absence assumption.
isolation=(ROOT/'src/repository/qualified-hostile-code-isolation-v33_12.ts').read_text()
isolation_test=(ROOT/'tests/qualified-hostile-code-isolation-v33_12.test.ts').read_text()
if 'SEALED_EMPTY_PROCFS_REFERENCE' not in isolation or "mount -t tmpfs -o size=65536,nosuid,nodev,noexec,ro tmpfs \"$ROOTFS/proc\"" not in isolation: errors.append('sealed_proc_reference_missing')
if "test ! -e /proc/net/dev" in isolation or "mount -t proc" in isolation: errors.append('obsolete_proc_probe_present')
for token in ['/proc/self/ns/user','/proc/self/ns/mnt','/proc/self/ns/net','/proc/self/ns/pid','/proc/self/ns/ipc','/proc/self/ns/uts']:
 if token not in isolation: errors.append('namespace_identity_probe_missing:'+token)
if 'SEALED_EMPTY_PROCFS_REFERENCE' not in isolation_test: errors.append('isolation_regression_assertion_missing')

ft=full.get('totals',{}); dt=direct.get('totals',{})
if full.get('version')!='33.30' or full.get('status')!='passed' or ft!={'testFiles':215,'tests':1868,'passed':1868,'failed':0} or full.get('runnerExitCode')!=0 or full.get('retry') or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
if direct.get('version')!='33.30' or direct.get('status')!='passed' or dt!={'testFiles':30,'tests':701,'passed':701,'failed':0} or direct.get('retry') or direct.get('forceExit'): errors.append('direct_v33_invalid')
if meta.get('version')!='33.30' or meta.get('testFileCount')!=215 or meta.get('timedOut') or meta.get('retry') or meta.get('forceExitDisabled') is not True or meta.get('sensitiveFilesSequential') is not True: errors.append('regression_meta_invalid')

inv=truth.get('inventory',{}); m=arch.get('metrics',{})
if inv.get('sourceModules')!=219 or inv.get('testFiles')!=215 or truth.get('findings')!=[]: errors.append('truth_map_invalid')
if arch.get('status')!='PASS' or m.get('sourceCycleCount')!=0 or m.get('untestedSourceCount')!=0 or m.get('capabilityPathCount')!=156 or m.get('closedCapabilityPathCount')!=156: errors.append('architecture_invalid')
for name in ['CONTRACT_REGISTRY_V33.json','CANONICAL_CAPABILITY_MAP_V33.json','PROOF_GATE_REGISTRY_V33.json','SOURCE_SYSTEM_REGISTRY_V33.json','VALUE_HYPOTHESIS_REGISTRY_V33.json','AUTHORITY_CONFLICT_MAP_V33.json']:
 if load('v33/governance-state/'+name).get('version')!='33.30': errors.append('governance_version_invalid:'+name)

phase('regeneration')
tr=subprocess.run(['node','scripts/repository-truth-map-v32_18.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180)
ar=subprocess.run(['node','scripts/architecture-validation-v32.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180)
if tr.returncode or ar.returncode: errors.append('regeneration_failed')
else:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json'); ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest') or ra.get('metrics')!=arch.get('metrics'): errors.append('architecture_regeneration_mismatch')

if manifest.get('version')!='33.30' or manifest.get('evidenceClass')!='LOCAL_CONTROLLED_HUMAN_UX_PILOT_INSTRUMENTATION' or manifest.get('externalEffects')!=0 or manifest.get('productionPromotion')!='blocked': errors.append('manifest_boundary_invalid')
if manifest.get('metricContinuity')!={'metricInventoryCount':54,'parameterCount':14,'externalHumanParticipants':0}: errors.append('manifest_metric_continuity_invalid')
for item in manifest.get('files',[]):
 p=ROOT/str(item.get('path',''))
 if not p.is_file() or p.stat().st_size!=item.get('sizeBytes') or sha(p)!=item.get('sha256'): errors.append('manifest_file_invalid:'+str(item.get('path')))

runbook=(ROOT/'pilot-kits/v33.30/human-ux-pilot/RUNBOOK.md').read_text()
for phrase in ['Five or more consented participants','70%','no greater than one','ten seconds','100%','Synthetic or staff-created participants']:
 if phrase.lower() not in runbook.lower(): errors.append('pilot_runbook_threshold_missing:'+phrase)
if proof.get('productionAuthority')!='NONE' or proof.get('externalEffectsExecuted')!=0 or proof.get('productionPromotion')!='blocked' or continuity.get('productionAuthority')!='NONE' or continuity.get('externalEffectsExecuted')!=0: errors.append('production_boundary_invalid')

result={
 'version':'33.30','status':'passed' if not errors else 'failed','evidenceClass':'LOCAL_CONTROLLED_HUMAN_UX_PILOT_INSTRUMENTATION',
 'humanUxPilot':{'syntheticParticipants':5,'externalHumanParticipants':0,'syntheticMetrics':proof.get('syntheticMetrics'),'syntheticVerdict':proof.get('syntheticVerdict'),'humanPilotPassed':False},
 'metricContinuity':{'metricInventoryCount':54,'parameterCount':14,'externalProgress':continuity.get('externalProgress')},
 'isolationCorrection':{'namespaceIdentityProbe':True,'sealedEmptyProcfs':True,'procfsMountRequired':False},
 'regression':ft,'directV33':dt,
 'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'scripts':inv.get('scripts'),'findings':len(truth.get('findings',[]))},
 'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},
 'errors':errors,'productionPromotion':'blocked'}
E.mkdir(parents=True,exist_ok=True); (E/'V33_30_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2)); sys.exit(0 if not errors else 1)
