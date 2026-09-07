#!/usr/bin/env python3
import hashlib,json,math,sys

def normalize(v):
 if v is None or isinstance(v,(str,bool)): return v
 if isinstance(v,int): return v
 if isinstance(v,float):
  if not math.isfinite(v): raise ValueError('non-finite')
  return 0 if v==0 else v
 if isinstance(v,list): return [normalize(x) for x in v]
 if isinstance(v,dict): return {k:normalize(v[k]) for k in sorted(v)}
 raise ValueError('unsupported')
def digest(v): return hashlib.sha256(json.dumps(normalize(v),ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def main(path):
 data=json.load(open(path,encoding='utf-8'),object_pairs_hook=lambda pairs: _unique(pairs))
 findings=[];claimed=data.get('reportDigest');material={k:v for k,v in data.items() if k!='reportDigest'}
 if claimed!=digest(material): findings.append('report-digest-invalid')
 if data.get('schemaVersion')!='32.18': findings.append('schema-version-invalid')
 expected=['resiliency-compiler','durable-history-replay','federated-workload-identity','cost-aware-tail-sampling','postgres-continuity-evaluator']
 if data.get('extractedCapabilities')!=expected: findings.append('capability-set-invalid')
 if data.get('productionQualified') is not False: findings.append('production-overclaim')
 limitations=set(data.get('limitations',[]))
 required={'dapr-daemon-not-executed','spire-federation-not-executed','otel-collector-not-executed','cloudnativepg-cluster-not-executed','all-local-results-are-dry-run'}
 if not required.issubset(limitations): findings.append('external-limitations-missing')
 for key in ['telemetryReductionRate','operationalReductionRate']:
  value=data.get(key)
  if not isinstance(value,(int,float)) or value<0 or value>1: findings.append(f'{key}-invalid')
 status='passed' if not findings else 'failed';print(json.dumps({'status':status,'findings':sorted(findings)}));return 0 if status=='passed' else 1
def _unique(pairs):
 out={}
 for k,v in pairs:
  if k in out: raise ValueError('duplicate-key:'+k)
  out[k]=v
 return out
if __name__=='__main__':
 try: raise SystemExit(main(sys.argv[1]))
 except Exception as exc: print(json.dumps({'status':'failed','findings':[f'verifier-error:{exc}']}));raise SystemExit(1)
