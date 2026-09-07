#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,math,sys
from pathlib import Path

def strict_object(pairs):
 out={}
 for k,v in pairs:
  if k in out: raise ValueError(f'duplicate_json_key:{k}')
  out[k]=v
 return out

def normalize(v,path='$'):
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

def verify_report(report,field):
 if not isinstance(report,dict): return False,'not_object'
 expected=report.get(field)
 if not isinstance(expected,str) or len(expected)!=64: return False,'digest_missing'
 material={k:v for k,v in report.items() if k!=field}
 return (digest(material)==expected,'ok' if digest(material)==expected else 'digest_mismatch')

def main():
 if len(sys.argv)!=2:
  print(json.dumps({'schemaVersion':'32.16','status':'failed','findings':['usage']}));return 2
 try:
  bundle=json.loads(Path(sys.argv[1]).read_text(),object_pairs_hook=strict_object)
  findings=[]
  for key in ('wasmRuntime','transport','failover'):
   ok,reason=verify_report(bundle.get(key),'reportDigest')
   if not ok: findings.append(f'{key}:{reason}')
  wasm=bundle.get('wasmRuntime',{})
  transport=bundle.get('transport',{})
  failover=bundle.get('failover',{})
  if wasm.get('state')!='DRY_RUN_PASSED' or wasm.get('productionQualified') is not False: findings.append('wasm_runtime_claim_invalid')
  if transport.get('state')!='DRY_RUN_PASSED' or transport.get('externallyObserved') is not False: findings.append('transport_claim_invalid')
  if failover.get('state')!='DRY_RUN_PASSED' or failover.get('productionQualified') is not False: findings.append('failover_claim_invalid')
  if failover.get('rpoWrites')!=0 or failover.get('childProcessesCleaned') is not True: findings.append('failover_integrity_invalid')
  status='passed' if not findings else 'failed'
  result={'schemaVersion':'32.16','status':status,'findings':findings,'bundleDigest':digest(bundle),'limitations':['does-not-execute-wasm','does-not-observe-provider-network','does-not-establish-independent-hosts']}
  result['verifierDigest']=digest(result)
  print(json.dumps(result,sort_keys=True,separators=(',',':')))
  return 0 if status=='passed' else 1
 except Exception as exc:
  print(json.dumps({'schemaVersion':'32.16','status':'failed','findings':[f'{type(exc).__name__}:{exc}']}));return 1
if __name__=='__main__': raise SystemExit(main())
