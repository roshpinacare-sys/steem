#!/usr/bin/env python3
from __future__ import annotations
import json, os, signal, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT; OUT=ctx.run_dir()
BINARY='dist/src/binary/proof-carrying-binary-v32_14.js'; FRONTIER='dist/src/ai/frontier-execution-kernel-v32_14.js'; COMPARE='dist/src/validation/frontier-comparative-assurance-v32_14.js'
BT='dist/tests/proof-carrying-binary-v32_14.test.js'; IV='dist/tests/independent-binary-verifier-v32_14.test.js'; FT='dist/tests/frontier-execution-kernel-v32_14.test.js'; CT='dist/tests/frontier-comparative-assurance-v32_14.test.js'; ARCHIVE_TEST='dist/tests/supply-chain-portability-v26.test.js'; ARCHIVE_TARGET='scripts/archive_policy_v32.py'; ARCHIVE_SELFTEST='scripts/archive-selftest-v32.py'
MUTANTS=[
(BINARY,BT,'unknown-format-fail-open',"|| (policy.rejectUnknown && detectedKind === 'UNKNOWN')","|| false",'binary parser recognizes bounded image executable and CBOR structures'),
(BINARY,BT,'polyglot-fail-open','|| (policy.rejectPolyglot && detectedKinds.length > 1)','|| false','binary intake rejects traversal active PDF polyglots malformed structures and policy violations'),
(BINARY,BT,'executable-policy-bypass','|| (policy.rejectExecutables && EXECUTABLE_KINDS.has(detectedKind))','|| false','archive limits and executable policy are causal controls'),
(BINARY,BT,'active-pdf-policy-bypass',"|| (policy.rejectActivePdf && findings.some((item) => item.code === 'pdf_active_content'))","|| false",'binary intake rejects traversal active PDF polyglots malformed structures and policy violations'),
(BINARY,BT,'archive-traversal-policy-bypass',"|| (policy.rejectArchiveTraversal && findings.some((item) => item.code.startsWith('zip_path_')))","|| false",'binary intake rejects traversal active PDF polyglots malformed structures and policy violations'),
(BINARY,BT,'archive-entry-limit-bypass','if (entries > policy.maximumArchiveEntries)','if (false)','archive limits and executable policy are causal controls'),
(BINARY,BT,'compression-ratio-bypass','if (!Number.isFinite(ratio) || ratio > policy.maximumCompressionRatio)','if (false)','archive limits and executable policy are causal controls'),
(BINARY,IV,'chunk-domain-index-removed','`upp-binary-chunk-v32.14:${index}:`','`upp-binary-chunk-v32.14:`','independent Python verifier agrees on content chunks Merkle root and kind'),
(BINARY,BT,'manifest-chunk-index-bypass',"if (manifest.chunks.some((item, index) => item.index !== index || !/^[a-f0-9]{64}$/.test(item.sha256)))","if (false)",'binary delta is deterministic and identifies changed added and removed chunks'),
(FRONTIER,FT,'binary-role-omitted',"if (task.binaryInputs)\n        roles.splice(3, 0, 'BINARY_ANALYST');","if (false)\n        roles.splice(3, 0, 'BINARY_ANALYST');",'SOL frontier plan uses max reasoning diverse roles binary analysis and proof-driven stages'),
(FRONTIER,FT,'diverse-team-disabled',"const diverse = reasoningEffort === 'max' || task.requiredProofClasses.includes('DIFFERENTIAL') || task.requiredProofClasses.includes('FORMAL');","const diverse = false;",'SOL frontier plan uses max reasoning diverse roles binary analysis and proof-driven stages'),
(FRONTIER,FT,'refuting-oracle-ignored','if (failed.length > 0) {','if (false) {','claim adjudication requires causal diversity and fails closed on any refuting oracle'),
(FRONTIER,FT,'single-oracle-proven','independentOracles >= 2','independentOracles >= 1','claim adjudication requires causal diversity and fails closed on any refuting oracle'),
(FRONTIER,FT,'external-blocker-packaged','if (state.externalBlockers > 0)','if (false)','counterexample-driven loop always resolves stronger evidence before packaging'),
(FRONTIER,FT,'required-context-class-bypass','if (classCoverage[contextClass] === 0)','if (false)','just-in-time context compiler reserves canonical classes deduplicates and binds selected content'),
(COMPARE,CT,'marketing-evidence-accepted','const classAllowed = requirement.requiredEvidenceClasses.includes(best.evidenceClass);','const classAllowed = true;','frontier comparison refuses best-in-world claims from official marketing or synthetic evidence'),
(COMPARE,CT,'score-threshold-bypass',"best.score >= requirement.minimumScore ? 'PASS' : 'FAIL'","true ? 'PASS' : 'FAIL'",'comparative assurance validates evidence and requirement identity'),
(ARCHIVE_TARGET,ARCHIVE_TEST,'runtime-evidence-package-bypass',"EXCLUDED_PREFIXES=('evidence/generated/','evidence/quarantine/','evidence/runs/')","EXCLUDED_PREFIXES=('evidence/generated/','evidence/quarantine/')",'portable archive is deterministic, excludes generated trees and normalizes modes'),
(ARCHIVE_TARGET,ARCHIVE_TEST,'source-hardlink-package-bypass',"return st.st_nlink != 1","return False",'archive builder rejects source symlinks instead of dereferencing them'),
]
def utc(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def execute(directory:Path,test_path:str,marker:str,label:str)->SimpleNamespace:
  log=directory/f'{label}.tap.log'; cmd=['node','--test',f'--test-name-pattern={marker}',test_path]
  with log.open('w') as stream: p=subprocess.Popen(cmd,cwd=directory,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''})
  try: code=p.wait(timeout=40); timed=False
  except subprocess.TimeoutExpired:
    timed=True
    try: os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError: pass
    code=p.wait(timeout=3)
  return SimpleNamespace(returncode=code,stdout=log.read_text(errors='replace'),timed_out=timed)
directory=Path(tempfile.mkdtemp(prefix='v32-14-frontier-mut-'));shutil.copytree(ROOT/'dist',directory/'dist');shutil.copytree(ROOT/'verifier-only',directory/'verifier-only');(directory/'scripts').mkdir();shutil.copy2(ROOT/ARCHIVE_TARGET,directory/ARCHIVE_TARGET);shutil.copy2(ROOT/ARCHIVE_SELFTEST,directory/ARCHIVE_SELFTEST);records=[]
try:
  baseline_runs=[]
  for test,marker in [(BT,'proof-carrying binary inspection'),(IV,'independent Python verifier agrees'),(FT,'SOL frontier plan'),(CT,'frontier comparison refuses'),(ARCHIVE_TEST,'portable archive is deterministic')]: baseline_runs.append(execute(directory,test,marker,f'baseline-{len(baseline_runs)}'))
  baseline_ok=all(r.returncode==0 and not r.timed_out for r in baseline_runs)
  if baseline_ok:
    for target,test_path,mid,old,new,marker in MUTANTS:
      path=directory/target; current=path.read_text(); count=current.count(old)
      if count!=1: record={'mutantId':mid,'status':'not-created','matchCount':count}
      else:
        path.write_text(current.replace(old,new,1)); run=execute(directory,test_path,marker,mid); observed=marker in run.stdout
        status='killed-authentic' if run.returncode!=0 and not run.timed_out and observed else 'survived' if run.returncode==0 else 'invalid-kill'
        record={'mutantId':mid,'target':target,'status':status,'markerObserved':observed,'exitCode':run.returncode,'timedOut':run.timed_out,'outputTail':run.stdout[-1600:]}; path.write_text(current)
      records.append(record); print(json.dumps({'mutantId':mid,'status':record['status']}),flush=True)
finally: shutil.rmtree(directory,ignore_errors=True)
passed=baseline_ok and len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'32.14','runId':OUT.name,'generatedAt':utc(),'status':'passed' if passed else 'failed',**ctx.execution_identity(),'baseline':'passed' if baseline_ok else 'failed','mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records}
ctx.atomic_write_json(OUT/'V32_14_FRONTIER_BINARY_MUTATION_RESULTS.json',report);print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2));raise SystemExit(0 if passed else 1)
