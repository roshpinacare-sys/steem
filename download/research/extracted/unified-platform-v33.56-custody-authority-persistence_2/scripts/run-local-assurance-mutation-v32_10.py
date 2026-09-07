#!/usr/bin/env python3
from __future__ import annotations
import json,os,signal,shutil,subprocess,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parent));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();TEST='dist/tests/local-execution-assurance-v32_10.test.js'
MUTANTS=[
 ('scanner-error-bypass','dist/src/validation/native-static-security-scanner.js',"const status = findings.some((row) => row.level === 'error' && !row.suppressed) ? 'BLOCK' : 'PASS';","const status = 'PASS';",'native scanner detects eval function constructors shell execution and disabled TLS verification'),
 ('scanner-unpinned-upgrade','dist/src/validation/native-static-security-scanner.js',"{ id: 'native/no-unpinned-action', level: 'warning'","{ id: 'native/no-unpinned-action', level: 'error'",'native scanner reports unpinned workflow action as warning without blocking'),
 ('provenance-verify-bypass','dist/src/supply-chain/local-signed-provenance.js','return registry.verify(input.envelope) && canonicalJson(input.envelope.payload) === canonicalJson(input.statement) && input.privateKeyPersisted === false;','return true;','local provenance verification rejects statement tampering'),
 ('policy-deny-bypass','dist/src/validation/native-policy-engine.js','const status = deterministic && !first.deniedRules.length && !first.undefinedRules.length ? \'PASS\' : \'BLOCK\';','const status = deterministic ? \'PASS\' : \'BLOCK\';','native policy separates denied rules from undefined rules'),
 ('model-gate-bypass','dist/src/validation/bounded-release-model.js',"if (state.phase === 'PRODUCTION' && state.externalGatesPassed < 6)","if (false && state.phase === 'PRODUCTION' && state.externalGatesPassed < 6)",'bounded release model finds unsafe production transition counterexamples'),
 ('model-auth-bypass','dist/src/validation/bounded-release-model.js',"if (state.phase === 'PRODUCTION' && !state.authorizedDecision)","if (false && state.phase === 'PRODUCTION' && !state.authorizedDecision)",'bounded release model finds unsafe production transition counterexamples'),
 ('unsafe-transition-disabled','dist/src/validation/bounded-release-model.js',"if (options.allowUnsafeProductionTransition && state.phase === 'LOCAL_VALIDATED')","if (false && options.allowUnsafeProductionTransition && state.phase === 'LOCAL_VALIDATED')",'bounded release model finds unsafe production transition counterexamples'),
 ('fuzz-crash-bypass','dist/src/validation/local-fuzz-campaign.js','const status = first.crashes === 0 && deterministicReplay && first.paths.length >= 2 ? \'PASS\' : \'BLOCK\';','const status = deterministicReplay && first.paths.length >= 2 ? \'PASS\' : \'BLOCK\';','local fuzz campaign records target crashes as a blocked result'),
 ('fuzz-replay-bypass','dist/src/validation/local-fuzz-campaign.js','const status = first.crashes === 0 && deterministicReplay && first.paths.length >= 2 ? \'PASS\' : \'BLOCK\';','const status = first.crashes === 0 && first.paths.length >= 2 ? \'PASS\' : \'BLOCK\';','local fuzz campaign blocks stateful nondeterministic replay'),
 ('witness-digest-bypass','dist/src/qualification/local-monotonic-witness.js',"if (sha256(material) !== row.entryDigest)","if (false && sha256(material) !== row.entryDigest)",'local witness detects payload tampering and broken previous digest'),
 ('witness-chain-bypass','dist/src/qualification/local-monotonic-witness.js',"if (row.previousDigest !== prior)","if (false && row.previousDigest !== prior)",'local witness detects payload tampering and broken previous digest'),
 ('witness-rollback-bypass','dist/src/qualification/local-monotonic-witness.js','if (lastSequence < minimumSequence)','if (false && lastSequence < minimumSequence)','local witness detects rollback and nonmonotonic time'),
]
def sandbox():
 d=Path(tempfile.mkdtemp(prefix='v32-10-mut-'));shutil.copytree(ROOT/'dist',d/'dist');return d
def execute(d:Path,pattern:str|None=None,label='baseline'):
 tap=d/f'{label}.tap.log';cmd=['node','--test',*([f'--test-name-pattern={pattern}']if pattern else[]),TEST]
 with tap.open('w') as stream:p=subprocess.Popen(cmd,cwd=d,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''})
 try:rc=p.wait(timeout=20);timed=False
 except subprocess.TimeoutExpired:
  timed=True
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  rc=p.wait(timeout=3)
 return SimpleNamespace(returncode=rc,stdout=tap.read_text(errors='replace'),timed_out=timed)
d=sandbox();records=[]
try:
 base=execute(d);baseline={'status':'passed' if base.returncode==0 and not base.timed_out else 'failed','exitCode':base.returncode,'timedOut':base.timed_out,'outputTail':base.stdout[-2000:]};print(json.dumps({'baseline':baseline['status']}),flush=True)
 if baseline['status']=='passed':
  for mid,target,old,new,marker in MUTANTS:
   path=d/target;original=path.read_text();matches=original.count(old)
   if matches!=1:rec={'mutantId':mid,'target':target,'status':'not-created','matchCount':matches}
   else:
    path.write_text(original.replace(old,new,1));p=execute(d,marker,mid);observed=marker in p.stdout
    status='invalid-kill' if p.timed_out else ('killed-authentic' if p.returncode!=0 and observed else ('survived' if p.returncode==0 else 'invalid-kill'))
    rec={'mutantId':mid,'target':target,'status':status,'markerObserved':observed,'exitCode':p.returncode,'timedOut':p.timed_out,'outputTail':p.stdout[-1000:]};path.write_text(original)
   records.append(rec);print(json.dumps({'mutantId':mid,'status':rec['status']}),flush=True)
finally:shutil.rmtree(d,ignore_errors=True)
passed=baseline['status']=='passed' and len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'32.10','runId':OUT.name,'status':'passed' if passed else 'failed',**ctx.execution_identity(),'baseline':baseline,'mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records}
ctx.atomic_write_json(OUT/'V32_10_LOCAL_ASSURANCE_MUTATION_RESULTS.json',report);print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2));raise SystemExit(0 if passed else 1)
