#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, math, sys
from pathlib import Path

def strict_object(pairs):
    out={}
    for k,v in pairs:
        if k in out: raise ValueError(f'duplicate_json_key:{k}')
        out[k]=v
    return out

def normalize(v, path='$'):
    if v is None or isinstance(v,(str,bool)): return v
    if isinstance(v,int):
        if abs(v)>9007199254740991: raise ValueError(f'unsafe_integer:{path}')
        return v
    if isinstance(v,float):
        if not math.isfinite(v): raise ValueError(f'non_finite:{path}')
        if v==0: return 0
        return v
    if isinstance(v,list): return [normalize(x,f'{path}[{i}]') for i,x in enumerate(v)]
    if isinstance(v,dict): return {k:normalize(v[k],f'{path}.{k}') for k in sorted(v)}
    raise ValueError(f'unsupported:{path}')

def digest(v):
    raw=json.dumps(normalize(v),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()

def verify_report(report, digest_field):
    if not isinstance(report,dict): return False,'report_not_object'
    expected=report.get(digest_field)
    if not isinstance(expected,str) or len(expected)!=64: return False,'report_digest_missing'
    material={k:v for k,v in report.items() if k!=digest_field}
    return (digest(material)==expected, 'ok' if digest(material)==expected else 'report_digest_mismatch')

def main():
    if len(sys.argv)!=2:
        print(json.dumps({'status':'failed','findings':['usage']})); return 2
    try:
        bundle=json.loads(Path(sys.argv[1]).read_text(),object_pairs_hook=strict_object)
        findings=[]
        for key,dfield in [('tournament','reportDigest'),('wasmComponent','proofDigest'),('multiHost','reportDigest')]:
            ok,reason=verify_report(bundle.get(key),dfield)
            if not ok: findings.append(f'{key}:{reason}')
        t=bundle.get('tournament',{})
        if t.get('worldBestClaim')!='not-proven': findings.append('world_best_claim_forbidden')
        if t.get('verdict') not in {'DRY_RUN_VALID','COMPARISON_VALID','FRONTIER_LEADER_CANDIDATE'}: findings.append('tournament_verdict_invalid')
        w=bundle.get('wasmComponent',{})
        if w.get('admission') not in {'DRY_RUN_ONLY','ADMIT'}: findings.append('wasm_admission_invalid')
        m=bundle.get('multiHost',{})
        if m.get('state')=='DRY_RUN_PASSED' and m.get('productionQualified') is not False: findings.append('dry_run_production_forbidden')
        if m.get('state') not in {'DRY_RUN_PASSED','PASSED'}: findings.append('multi_host_state_invalid')
        status='passed' if not findings else 'failed'
        result={'schemaVersion':'32.15','status':status,'findings':findings,'bundleDigest':digest(bundle),'limitations':['does-not-replay-provider-api-calls','does-not-verify-host-network-topology','validates-delivered-report-integrity-and-fail-closed-semantics']}
        result['verifierDigest']=digest(result)
        print(json.dumps(result,sort_keys=True,separators=(',',':')))
        return 0 if status=='passed' else 1
    except Exception as exc:
        print(json.dumps({'schemaVersion':'32.15','status':'failed','findings':[f'{type(exc).__name__}:{exc}']})); return 1
if __name__=='__main__': raise SystemExit(main())
