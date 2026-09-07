#!/usr/bin/env python3
from __future__ import annotations
import json,os,signal,shutil,subprocess,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parent));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();TESTS=['dist/tests/strategic-adversarial-v32_8.test.js','dist/tests/workflow-security-v32_8.test.js']
MUTANTS=[
('mutable-commit-bypass','dist/src/validation/vetted-tool-intake.js',"if (!/^[0-9a-f]{40}$/.test(raw.commitSha))","if (false && !/^[0-9a-f]{40}$/.test(raw.commitSha))",'tool intake rejects mutable untrusted or executable supply-chain imports'),
('automatic-execution-bypass','dist/src/validation/vetted-tool-intake.js','if (raw.requestsAutomaticExecution)','if (false && raw.requestsAutomaticExecution)','tool intake rejects mutable untrusted or executable supply-chain imports'),
('sarif-error-bypass','dist/src/validation/security-evidence-import.js',"if (active.some((row) => row.level === 'error'))","if (false && active.some((row) => row.level === 'error'))",'SARIF gate blocks security errors untrusted tools and malformed fingerprints'),
('attestation-signature-bypass','dist/src/validation/security-evidence-import.js','if (!input.signatureVerified)','if (false && !input.signatureVerified)','attestation rejects synthetic or unverified provenance'),
('policy-determinism-bypass','dist/src/validation/policy-formal-fuzz-assurance.js','if (input.decisionDigest !== input.repeatedDecisionDigest)','if (false && input.decisionDigest !== input.repeatedDecisionDigest)','policy evidence rejects nondeterminism denies undefined and stale input'),
('formal-deadlock-bypass','dist/src/validation/policy-formal-fuzz-assurance.js','if (input.deadlockFound)','if (false && input.deadlockFound)','formal model gate rejects deadlocks violations and model-only claims without refinement'),
('fuzz-failure-bypass','dist/src/validation/policy-formal-fuzz-assurance.js','if (input.crashes > 0 || input.sanitizerFindings > 0)','if (false && (input.crashes > 0 || input.sanitizerFindings > 0))','fuzz gate rejects shallow timeout-heavy nonreproducible campaigns'),
('self-review-bypass','dist/src/validation/adversarial-claim-roast.js','if (rows.some((row) => row.producerId === row.reviewerId))','if (false && rows.some((row) => row.producerId === row.reviewerId))','claim roast refutes self-review digest drift and concentrated metadata proof'),
('external-claim-bypass','dist/src/validation/adversarial-claim-roast.js',"if (claim.requireExternal && !rows.some((row) => row.externallyCollected))","if (false && claim.requireExternal && !rows.some((row) => row.externallyCollected))",'external and human claims cannot be closed by repository-local evidence'),
('production-promotion-bypass','dist/src/validation/strategic-upgrade-assurance.js',"productionPromotion: 'BLOCKED'","productionPromotion: 'ALLOWED'",'strategic assurance aggregates all vetted gates but never promotes production'),
('unexecuted-as-pass-bypass','dist/src/validation/strategic-upgrade-assurance.js',"gate.status === 'NOT_EXECUTED'","false && gate.status === 'NOT_EXECUTED'",'strategic assurance distinguishes unexecuted external tools from failure'),
('workflow-pin-bypass','dist/src/validation/workflow-security-assurance.js','else if (policy.requireImmutableActions)','else if (false && policy.requireImmutableActions)','workflow assurance rejects mutable actions and persisted checkout credentials'),
('workflow-credential-bypass','dist/src/validation/workflow-security-assurance.js','if (policy.requireCheckoutCredentialIsolation && !/persist-credentials:\\s*false/.test(block))','if (false && policy.requireCheckoutCredentialIsolation && !/persist-credentials:\\s*false/.test(block))','workflow assurance rejects mutable actions and persisted checkout credentials'),
('workflow-write-permission-bypass','dist/src/validation/workflow-security-assurance.js','if (policy.forbidWritePermissions && /^\\s*(contents|actions|checks|deployments|id-token|issues|packages|pull-requests|security-events|statuses):\\s*write\\s*$/.test(line))','if (false && policy.forbidWritePermissions && /^\\s*(contents|actions|checks|deployments|id-token|issues|packages|pull-requests|security-events|statuses):\\s*write\\s*$/.test(line))','workflow assurance rejects pull_request_target secrets and write permissions'),
]
def sandbox():
 d=Path(tempfile.mkdtemp(prefix='v32-8-mut-'));shutil.copytree(ROOT/'dist',d/'dist');return d
def execute(d,pattern=None,label='baseline'):
 e=d/'evidence';e.mkdir(parents=True,exist_ok=True);tap=e/f'{label}.tap.log';cmd=['node','--test',*([f'--test-name-pattern={pattern}']if pattern else[]),*TESTS]
 with tap.open('w')as stream:p=subprocess.Popen(cmd,cwd=d,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''})
 try:rc=p.wait(timeout=25);timed=False
 except subprocess.TimeoutExpired:
  timed=True
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  try:rc=p.wait(timeout=2)
  except subprocess.TimeoutExpired:
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   rc=p.wait(timeout=2)
 return SimpleNamespace(returncode=rc,stdout=tap.read_text(errors='replace'),timed_out=timed)
d=sandbox();records=[]
try:
 base=execute(d);baseline={'status':'passed'if base.returncode==0 and not base.timed_out else'failed','exitCode':base.returncode,'timedOut':base.timed_out,'outputTail':base.stdout[-2500:]};print(json.dumps({'baseline':baseline['status']}),flush=True)
 if baseline['status']=='passed':
  for mid,target,old,new,marker in MUTANTS:
   path=d/target;original=path.read_text();matches=original.count(old)
   if matches!=1:rec={'mutantId':mid,'target':target,'status':'not-created','matchCount':matches}
   else:
    path.write_text(original.replace(old,new,1));p=execute(d,marker,mid);observed=marker in p.stdout;status='invalid-kill'if p.timed_out else('killed-authentic'if p.returncode!=0 and observed else('survived'if p.returncode==0 else'invalid-kill'));rec={'mutantId':mid,'target':target,'status':status,'markerObserved':observed,'exitCode':p.returncode,'timedOut':p.timed_out,'outputTail':p.stdout[-1000:]};path.write_text(original)
   records.append(rec);print(json.dumps({'mutantId':mid,'status':rec['status']}),flush=True)
finally:shutil.rmtree(d,ignore_errors=True)
passed=baseline['status']=='passed'and len(records)==len(MUTANTS)and all(r['status']=='killed-authentic'for r in records)
report={'version':'32.8','runId':OUT.name,'status':'passed'if passed else'failed',**ctx.execution_identity(),'baseline':baseline,'mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic'for r in records),'survivors':sum(r['status']=='survived'for r in records),'invalidKills':sum(r['status']in('invalid-kill','not-created')for r in records),'records':records}
ctx.atomic_write_json(OUT/'V32_8_STRATEGIC_MUTATION_RESULTS.json',report);print(json.dumps({k:report[k]for k in('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2));raise SystemExit(0 if passed else 1)
