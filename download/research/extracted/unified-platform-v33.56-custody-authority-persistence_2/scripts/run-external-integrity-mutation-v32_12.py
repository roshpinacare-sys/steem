#!/usr/bin/env python3
from __future__ import annotations
import json, os, signal, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parent)); import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT; OUT=ctx.run_dir()
INTEGRITY_TEST='dist/tests/external-qualification-integrity-v32_12.test.js'
TRUST_TEST='dist/tests/external-qualification-trust-v32_12.test.js'
CLI_TEST='dist/tests/external-qualification-verifier-cli-v32_12.test.js'
STRICT_TEST='dist/tests/strict-json-v32_12.test.js'
SOURCE_TEST='dist/tests/source-identity-v32_11.test.js'
INTEGRITY_TARGET='dist/src/qualification/external-qualification-integrity-v32_12.js'
TRUST_TARGET='dist/src/qualification/external-qualification-trust-v32_12.js'
CLI_TARGET='scripts/verify-external-qualification-v32_12.mjs'
STRICT_TARGET='dist/src/validation/strict-json-v32_12.js'
SOURCE_TARGET='scripts/test_ops_context_v32_6.py'
MUTANTS=[
 (INTEGRITY_TARGET,INTEGRITY_TEST,'synthetic-evidence-bypass',"if (collector.synthetic)\n        failures.push('synthetic_evidence_forbidden');","if (false && collector.synthetic)\n        failures.push('synthetic_evidence_forbidden');",'synthetic, simulated, incomplete and dry-run evidence cannot satisfy production policy even when signed'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'execution-mode-bypass',"if (modeRank[collector.executionMode] < modeRank[policy.minimumExecutionMode])","if (false && modeRank[collector.executionMode] < modeRank[policy.minimumExecutionMode])",'synthetic, simulated, incomplete and dry-run evidence cannot satisfy production policy even when signed'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'nonce-replay-bypass',"if (consumed.has(collector.challengeNonce))\n        failures.push('challenge_nonce_replayed');","if (false && consumed.has(collector.challengeNonce))\n        failures.push('challenge_nonce_replayed');",'replayed and duplicated challenge nonces are rejected'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'reviewer-signature-bypass',"if (reviewedAt === undefined || !registry.verifyAt(bundle.reviewer, reviewer.reviewedAt))","if (false && (reviewedAt === undefined || !registry.verifyAt(bundle.reviewer, reviewer.reviewedAt)))",'tampered signature and raw evidence substitution are independently rejected'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'source-binding-bypass',"if (identity.sourceDigest !== policy.expectedSourceDigest)","if (false && identity.sourceDigest !== policy.expectedSourceDigest)",'source, artifact, toolchain, policy and run identity drift fail closed'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'key-independence-bypass',"if (!unique('keyId') || !unique('keyFingerprint'))","if (false && (!unique('keyId') || !unique('keyFingerprint')))",'renaming the same signing identity does not create reviewer or witness independence'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'review-binding-bypass',"if (reviewer.collectorStatementDigest !== collectorDigest)","if (false && reviewer.collectorStatementDigest !== collectorDigest)",'review copied from another qualification and witness equivocation are rejected'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'raw-evidence-binding-bypass',"if (observation.sha256 !== raw.sha256 || observation.bytes !== raw.bytes)","if (false && (observation.sha256 !== raw.sha256 || observation.bytes !== raw.bytes))",'tampered signature and raw evidence substitution are independently rejected'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'required-gate-set-bypass',"if (JSON.stringify(expected) !== JSON.stringify(actual))","if (false && JSON.stringify(expected) !== JSON.stringify(actual))",'missing, duplicate and unexpected gate topology cannot be aggregated'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'policy-digest-bypass',"if (computeExternalQualificationPolicyDigestV32_12(policy) !== policy.policyDigest)\n        throw new Error('external_qualification_policy_digest_mismatch');","if (false && computeExternalQualificationPolicyDigestV32_12(policy) !== policy.policyDigest)\n        throw new Error('external_qualification_policy_digest_mismatch');",'policy validation rejects malformed identity, digest, age, skew and gate configuration'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'production-all-gates-bypass',"if (JSON.stringify([...ids].sort()) !== JSON.stringify(required))\n            throw new Error('external_qualification_production_requires_all_gates');","if (false && JSON.stringify([...ids].sort()) !== JSON.stringify(required))\n            throw new Error('external_qualification_production_requires_all_gates');",'production purpose independently requires the exact six-gate witness-backed organization policy'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'production-mode-bypass',"if (policy.minimumExecutionMode !== 'independent-organization')\n            throw new Error('external_qualification_production_mode_invalid');","if (false && policy.minimumExecutionMode !== 'independent-organization')\n            throw new Error('external_qualification_production_mode_invalid');",'production purpose independently requires the exact six-gate witness-backed organization policy'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'production-witness-bypass',"if (!policy.requireWitness)\n            throw new Error('external_qualification_production_witness_required');","if (false && !policy.requireWitness)\n            throw new Error('external_qualification_production_witness_required');",'production purpose independently requires the exact six-gate witness-backed organization policy'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'authorization-bypass',"if (authorization === undefined)\n        failures.push(`${role}_key_not_authorized`);","if (false && authorization === undefined)\n        failures.push(`${role}_key_not_authorized`);",'a signed actor without an out-of-band authorization is rejected'),
 (INTEGRITY_TARGET,INTEGRITY_TEST,'checkpoint-monotonicity-bypass',"if (witness.checkpointSequence !== prior.checkpointSequence + 1)\n        failures.push('witness_checkpoint_sequence_not_monotonic');","if (false && witness.checkpointSequence !== prior.checkpointSequence + 1)\n        failures.push('witness_checkpoint_sequence_not_monotonic');",'witness checkpoints must advance monotonically from verifier-owned prior state'),
 (TRUST_TARGET,TRUST_TEST,'trust-signature-bypass',"if (!rootRegistry.verifyAt(bundle, evaluatedAt))\n        throw new Error('trust_bundle_signature_invalid');","if (false && !rootRegistry.verifyAt(bundle, evaluatedAt))\n        throw new Error('trust_bundle_signature_invalid');",'an allowed trust-bundle signer still requires a valid cryptographic signature'),
 (TRUST_TARGET,TRUST_TEST,'root-key-actor-bypass',"if (anchor.allowedTrustBundleSignerKeyIds.includes(entry.keyId))\n            throw new Error('trust_bundle_root_key_cannot_be_actor');","if (false && anchor.allowedTrustBundleSignerKeyIds.includes(entry.keyId))\n            throw new Error('trust_bundle_root_key_cannot_be_actor');",'root signing key cannot also be authorized as collector, reviewer or witness'),
 (TRUST_TARGET,TRUST_TEST,'organization-independence-bypass',"if (organizations.size !== 3)\n                throw new Error(`trust_bundle_organization_independence_missing:${gateId}`);","if (false && organizations.size !== 3)\n                throw new Error(`trust_bundle_organization_independence_missing:${gateId}`);",'expired, tampered and non-independent production trust bundles fail closed'),
 (CLI_TARGET,CLI_TEST,'self-contained-document-bypass',"validateVerificationDocumentShape(document);","/* mutation: verification document shape bypass */",'self-contained attacker keys, policy, observations and evaluation time are rejected as unexpected fields'),
 (CLI_TARGET,CLI_TEST,'filesystem-observation-bypass',"return { path: raw.path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, modifiedAt: info.mtime.toISOString() };","return { path: raw.path, sha256: raw.sha256, bytes: raw.bytes, modifiedAt: info.mtime.toISOString() };",'verifier hashes current filesystem bytes and rejects post-signing evidence substitution'),
 (CLI_TARGET,CLI_TEST,'replay-state-bypass',"previouslyConsumedNonces: state.consumedNonces,\n    previousWitnessCheckpoints: state.witnessCheckpoints,","previouslyConsumedNonces: [],\n    previousWitnessCheckpoints: [],",'verifier-only CLI requires out-of-band trust, hashes real files and persists replay state'),
 (CLI_TARGET,CLI_TEST,'foreign-lock-deletion-bypass',"if (lockOwned && lockPath !== undefined) rmSync(lockPath, { force: true });","if (lockPath !== undefined) rmSync(lockPath, { force: true });",'verifier preserves a lock it does not own and blocks concurrent state mutation'),
 (STRICT_TARGET,STRICT_TEST,'duplicate-json-key-bypass',"if (keys.has(key))\n                throw new Error(`strict_json_duplicate_key:${path}.${key}`);","if (false && keys.has(key))\n                throw new Error(`strict_json_duplicate_key:${path}.${key}`);",'strict JSON parser rejects duplicate keys at every nesting level'),
 (SOURCE_TARGET,SOURCE_TEST,'qualification-source-boundary-bypass',"'docs','external-qualification','verifier-only'","'docs','verifier-only'",'source identity binds external qualification manifests and runbooks'),
]
def utc(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def sandbox():
 d=Path(tempfile.mkdtemp(prefix='v32-12-external-mut-')); shutil.copytree(ROOT/'dist',d/'dist'); (d/'scripts').mkdir()
 for path in [SOURCE_TARGET,CLI_TARGET]: shutil.copy2(ROOT/path,d/path)
 for path in ROOT.glob('CLAUDE_HANDOFF_v*.md'): shutil.copy2(path,d/path.name)
 return d
def execute(d:Path,test_path:str,pattern:str|None=None,label='baseline'):
 tap=d/f'{label}.tap.log'; cmd=['node','--test',*([f'--test-name-pattern={pattern}'] if pattern else []),test_path]
 with tap.open('w') as stream: p=subprocess.Popen(cmd,cwd=d,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''})
 try: rc=p.wait(timeout=35); timed=False
 except subprocess.TimeoutExpired:
  timed=True
  try: os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError: pass
  rc=p.wait(timeout=3)
 return SimpleNamespace(returncode=rc,stdout=tap.read_text(errors='replace'),timed_out=timed)
d=sandbox(); records=[]
try:
 baselines=[(INTEGRITY_TEST,'integrity'),(TRUST_TEST,'trust'),(CLI_TEST,'cli'),(STRICT_TEST,'strict'),(SOURCE_TEST,'source')]
 bases=[execute(d,path,label=f'{label}-baseline') for path,label in baselines]
 baseline_ok=all(p.returncode==0 and not p.timed_out for p in bases)
 baseline={'status':'passed' if baseline_ok else 'failed','results':[{'exitCode':p.returncode,'timedOut':p.timed_out,'outputTail':p.stdout[-1600:]} for p in bases]}
 print(json.dumps({'baseline':baseline['status']}),flush=True)
 if baseline_ok:
  for target,test_path,mid,old,new,marker in MUTANTS:
   path=d/target; current=path.read_text(); matches=current.count(old)
   if matches!=1: rec={'mutantId':mid,'target':target,'status':'not-created','matchCount':matches}
   else:
    path.write_text(current.replace(old,new,1)); p=execute(d,test_path,marker,mid); observed=marker in p.stdout
    status='invalid-kill' if p.timed_out else ('killed-authentic' if p.returncode!=0 and observed else ('survived' if p.returncode==0 else 'invalid-kill'))
    rec={'mutantId':mid,'target':target,'status':status,'markerObserved':observed,'exitCode':p.returncode,'timedOut':p.timed_out,'outputTail':p.stdout[-1600:]}; path.write_text(current)
   records.append(rec); print(json.dumps({'mutantId':mid,'status':rec['status']}),flush=True)
finally: shutil.rmtree(d,ignore_errors=True)
passed=baseline['status']=='passed' and len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'32.12','runId':OUT.name,'generatedAt':utc(),'status':'passed' if passed else 'failed',**ctx.execution_identity(),'baseline':baseline,'mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records}
ctx.atomic_write_json(OUT/'V32_12_EXTERNAL_INTEGRITY_MUTATION_RESULTS.json',report); print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2)); raise SystemExit(0 if passed else 1)
