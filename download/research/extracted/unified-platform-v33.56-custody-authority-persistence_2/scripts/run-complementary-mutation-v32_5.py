#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
TEST='tests/complementary-metrics-v32_5.test.js'
MUTANTS=[
 ('maintainability-owner-bypass','src/validation/maintainability-assurance.js',"if (item.ownerId.trim() === '')","if (false && item.ownerId.trim() === '')",'maintainability assurance exposes ownership, complexity and change failure'),
 ('observability-redaction-bypass','src/validation/observability-assurance.js',"['sensitiveDataRedacted', 'redaction_missing', 'BLOCK']","['sensitiveDataRedacted', 'redaction_missing', 'WATCH']",'observability assurance blocks critical blind spots'),
 ('data-encryption-bypass','src/validation/data-lifecycle-assurance.js','if (sensitive && !item.encryptedAtRest)','if (false && sensitive && !item.encryptedAtRest)','data lifecycle assurance blocks sensitive lifecycle gaps'),
 ('dependency-vulnerability-bypass','src/validation/dependency-resilience.js','if (item.highVulnerabilities > 0)','if (false && item.highVulnerabilities > 0)','dependency resilience blocks vulnerable or unverified dependencies'),
 ('migration-data-loss-bypass','src/validation/migration-compatibility.js','if (item.dataLossRows > 0)','if (false && item.dataLossRows > 0)','migration compatibility blocks unsafe data transitions'),
 ('privacy-minimization-bypass','src/validation/privacy-minimization.js','if (!item.collectionNecessary)','if (false && !item.collectionNecessary)','privacy minimization blocks unnecessary or unprotected personal data'),
 ('accessibility-keyboard-bypass','src/validation/accessibility-human-factors.js','if (!item.keyboardComplete)','if (false && !item.keyboardComplete)','accessibility and human factors block inaccessible flows'),
 ('cost-throughput-bypass','src/validation/cost-capacity-assurance.js','if (item.sustainableRequestsPerSecond < item.peakRequestsPerSecond)','if (false && item.sustainableRequestsPerSecond < item.peakRequestsPerSecond)','cost capacity assurance blocks throughput latency memory cost and critical headroom breaches'),
]
records=[]
for mid,target,old,new,marker in MUTANTS:
 start=time.perf_counter(); temp=Path(tempfile.mkdtemp(prefix=f'v32-5-mut-{mid}-'))
 try:
  shutil.copytree(ROOT/'dist',temp/'dist'); path=temp/'dist'/target; text=path.read_text(); count=text.count(old)
  if count!=1: records.append({'mutantId':mid,'status':'not-created','matchCount':count,'target':target}); continue
  path.write_text(text.replace(old,new,1)); p=subprocess.run(['node','--test',f'dist/{TEST}'],cwd=temp,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=60)
  observed=marker in p.stdout; status='killed-authentic' if p.returncode!=0 and observed else ('survived' if p.returncode==0 else 'invalid-kill')
  records.append({'mutantId':mid,'target':target,'test':TEST,'expectedFailureMarker':marker,'markerObserved':observed,'exitCode':p.returncode,'status':status,'durationMs':round((time.perf_counter()-start)*1000,3),'outputTail':p.stdout[-2200:]})
 except subprocess.TimeoutExpired as exc:
  output=(exc.stdout or '') if isinstance(exc.stdout,str) else '';records.append({'mutantId':mid,'target':target,'test':TEST,'expectedFailureMarker':marker,'markerObserved':marker in output,'exitCode':None,'status':'invalid-kill','reason':'timeout_is_not_a_kill','outputTail':output[-2200:]})
 finally: shutil.rmtree(temp,ignore_errors=True)
passed=len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'32.5','status':'passed' if passed else 'failed','classification':'one-authentic-targeted-mutation-per-complementary-metric','mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records,'limitations':['Risk-targeted complementary mutation is not exhaustive whole-program mutation.','Only dedicated behavioral failure markers count as authentic kills.']}
(OUT/'V32_5_COMPLEMENTARY_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2));raise SystemExit(0 if passed else 1)
