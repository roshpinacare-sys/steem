#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, math, sys
from pathlib import Path

def canonical(value):
    if value is None or isinstance(value,(str,bool)): return value
    if isinstance(value,int): return value
    if isinstance(value,float):
        if not math.isfinite(value): raise ValueError('non-finite')
        if value == 0: return 0
        return value
    if isinstance(value,list): return [canonical(v) for v in value]
    if isinstance(value,dict): return {k:canonical(value[k]) for k in sorted(value)}
    raise ValueError('unsupported')
def digest(value):
    return hashlib.sha256(json.dumps(canonical(value),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def reject_duplicates(pairs):
    result={}
    for key,value in pairs:
        if key in result: raise ValueError(f'duplicate-key:{key}')
        result[key]=value
    return result

def verify(path):
    data=json.loads(Path(path).read_text(),object_pairs_hook=reject_duplicates)
    findings=[]
    if data.get('schemaVersion')!='32.17': findings.append('schema-version-invalid')
    claimed=data.get('reportDigest')
    material={k:v for k,v in data.items() if k!='reportDigest'}
    if claimed!=digest(material): findings.append('report-digest-invalid')
    if data.get('state') not in ('DRY_RUN_PASSED','PRODUCTION_QUALIFIED'): findings.append('state-not-passed')
    if data.get('buildingBlocksCovered')!=data.get('buildingBlocksRequired') or data.get('buildingBlocksRequired')!=8: findings.append('building-block-coverage-invalid')
    if data.get('interoperabilityEquivalent') is not True: findings.append('interoperability-divergence')
    if data.get('vendorSubstitutionCoverage')!=1: findings.append('substitution-coverage-invalid')
    if data.get('operationalReductionRate',-1)<0 or data.get('normalizedCostReductionRate',-1)<0: findings.append('reduction-invalid')
    if data.get('productionQualified') is True and 'dapr-runtime-not-executed-in-current-offline-environment' in data.get('limitations',[]): findings.append('production-overclaim')
    evidence=data.get('evidence',{})
    if not all(isinstance(evidence.get(k),str) and len(evidence[k])==64 for k in ('planDigest','conformanceDigest','nativeReportDigest','envelopeReportDigest')): findings.append('evidence-digest-invalid')
    return {'status':'passed' if not findings else 'failed','findings':findings,'reportDigest':claimed}
if __name__=='__main__':
    if len(sys.argv)!=2: raise SystemExit('usage: verifier report.json')
    result=verify(sys.argv[1]);print(json.dumps(result,sort_keys=True));raise SystemExit(0 if result['status']=='passed' else 1)
