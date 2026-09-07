#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
MUTANTS=[
 ('sensitive-lockfile-policy-bypass','src/agents/governed-agent.js','if (fileIsSensitive(request.targetFile))','if (false && fileIsSensitive(request.targetFile))','tests/governed-agent-branch-v28.test.js','agent validates every required request field and bounded authority control'),
 ('authority-wildcard-bypass','src/contracts/canonical.js',"if (grant.scopes.some((scope) => scope === '*' || scope.endsWith('.*')))","if (false && grant.scopes.some((scope) => scope === '*' || scope.endsWith('.*')))",'tests/canonical-branch-v28.test.js','authority validation covers every required identity, time and scope boundary'),
 ('kms-algorithm-substitution-bypass','src/security/attested-kms-adapter.js',"if (response.algorithm !== 'Ed25519')","if (false && response.algorithm !== 'Ed25519')",'tests/attested-kms-branch-v28.test.js','KMS adapter rejects algorithm and each context-attestation substitution independently'),
 ('identity-stale-role-bypass','src/security/private-identity.js','if (canonicalJson([...membership.roles].sort()) !== canonicalJson(payload.roles))','if (false && canonicalJson([...membership.roles].sort()) !== canonicalJson(payload.roles))','tests/private-identity-branch-v28.test.js','authentication detects stored-token substitution, claim mismatch and stale roles'),
 ('recertification-nonpassing-evidence-bypass','src/platform/incident-recertification.js','if (record.payload.passed !== true)','if (false && record.payload.passed !== true)','tests/incident-recertification-branch-v28.test.js','recertification rejects unknown cases, broken chain and nonpassing evidence'),
 ('domain-privileged-scope-bypass','src/platform/domain-pack-generator.js',"if (workflow.requiredScopes.some((scope) => scope === '*' || scope.endsWith('.*') || ['authority.', 'tenant.', 'secret.', 'release.', 'kernel.'].some((prefix) => scope.startsWith(prefix))))","if (false && workflow.requiredScopes.some((scope) => scope === '*' || scope.endsWith('.*') || ['authority.', 'tenant.', 'secret.', 'release.', 'kernel.'].some((prefix) => scope.startsWith(prefix))))",'tests/domain-pack-generator-branch-v28.test.js','domain workflows reject blank goals/actions/scopes/evidence and all privileged scope prefixes'),
 ('runtime-authority-denial-bypass','src/runtime/engine.js','if (!authorityAllows(signedGrant.payload, {','if (false && !authorityAllows(signedGrant.payload, {','tests/runtime-engine-branch-v28.test.js','runtime engine rejects unregistered signatures and authority mismatch'),
]
records=[]
for mid,target,old,new,test,marker in MUTANTS:
    start=time.perf_counter(); temp=Path(tempfile.mkdtemp(prefix=f'v28-mut-{mid}-'))
    try:
        shutil.copytree(ROOT/'dist',temp/'dist'); path=temp/'dist'/target; text=path.read_text(); count=text.count(old)
        if count!=1: records.append({'mutantId':mid,'status':'not-created','matchCount':count,'target':target}); continue
        path.write_text(text.replace(old,new,1)); p=subprocess.run(['node','--test',f'dist/{test}'],cwd=temp,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=40)
        observed=marker in p.stdout; status='killed-authentic' if p.returncode!=0 and observed else ('survived' if p.returncode==0 else 'invalid-kill')
        records.append({'mutantId':mid,'target':target,'test':test,'expectedFailureMarker':marker,'markerObserved':observed,'exitCode':p.returncode,'status':status,'durationMs':round((time.perf_counter()-start)*1000,3),'outputTail':p.stdout[-1800:]})
    finally: shutil.rmtree(temp,ignore_errors=True)
passed=len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'28.0','status':'passed' if passed else 'failed','classification':'targeted-branch-security-mutation-with-dedicated-failure-markers','mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status']=='invalid-kill' for r in records),'records':records,'limitations':['Targeted branch mutations only; v27 retained the broader 47-mutant portfolio.']}
(OUT/'V28_BRANCH_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2))
raise SystemExit(0 if passed else 1)
