import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';
import { sha256 } from '../contracts/crypto.js';

export interface EvidenceArtifactBindingInput {
  readonly artifactId:string; readonly claimId:string; readonly path:string; readonly declaredDigest:string;
  readonly sourceDigest:string; readonly artifactDigest:string; readonly producerId:string; readonly reviewerId:string;
  readonly oracleId:string; readonly environmentId:string; readonly origin:'FILE'|'INLINE'; readonly observed:boolean;
  readonly accepted:boolean; readonly current:boolean; readonly createdAt:string;
}
export interface EvidenceArtifactBindingPolicy { readonly root:string; readonly sourceDigest:string; readonly artifactDigest:string; readonly now:string; readonly maximumAgeMs:number; }
const HEX=/^[0-9a-f]{64}$/;
function repeated(value:string){return value.length===64&&new Set(value).size===1;}
function fileDigest(path:string){return createHash('sha256').update(readFileSync(path)).digest('hex');}
export function bindEvidenceArtifacts(inputs:readonly EvidenceArtifactBindingInput[],policy:EvidenceArtifactBindingPolicy){
  if(inputs.length===0)throw new Error('evidence_artifacts_empty');
  const seen=new Set<string>();
  const now=Date.parse(policy.now);
  if(!Number.isFinite(now)||policy.maximumAgeMs<=0)throw new Error('binding_policy_invalid');
  const results=inputs.map((input)=>{
    if(!input.artifactId||seen.has(input.artifactId))throw new Error('evidence_artifact_identity_invalid'); seen.add(input.artifactId);
    const failures:string[]=[]; const normalized=normalize(input.path);
    if(isAbsolute(input.path)||normalized.startsWith('..')||normalized.includes('/../'))failures.push('evidence_path_unsafe');
    const absolute=resolve(policy.root,input.path);
    if(!absolute.startsWith(resolve(policy.root)))failures.push('evidence_path_escape');
    if(input.origin!=='FILE')failures.push('inline_evidence_forbidden');
    if(!existsSync(absolute)||!statSync(absolute).isFile())failures.push('evidence_file_missing');
    const actualDigest=existsSync(absolute)&&statSync(absolute).isFile()?fileDigest(absolute):'';
    if(!HEX.test(input.declaredDigest)||repeated(input.declaredDigest))failures.push('synthetic_digest');
    if(actualDigest!==input.declaredDigest)failures.push('evidence_digest_mismatch');
    if(input.sourceDigest!==policy.sourceDigest)failures.push('source_digest_mismatch');
    if(input.artifactDigest!==policy.artifactDigest)failures.push('artifact_digest_mismatch');
    if(!input.producerId||!input.reviewerId||input.producerId===input.reviewerId)failures.push('independent_review_missing');
    if(!input.oracleId||!input.environmentId)failures.push('oracle_or_environment_missing');
    if(!input.observed||!input.accepted||!input.current)failures.push('evidence_not_observed_accepted_current');
    const created=Date.parse(input.createdAt);
    if(!Number.isFinite(created))failures.push('evidence_time_invalid');
    else { if(created>now+1000)failures.push('evidence_from_future'); if(now-created>policy.maximumAgeMs)failures.push('evidence_stale'); }
    return {artifactId:input.artifactId,claimId:input.claimId,path:input.path,status:failures.length?'BLOCK' as const:'BOUND' as const,failures:[...new Set(failures)].sort(),actualDigest,declaredDigest:input.declaredDigest,oracleId:input.oracleId,environmentId:input.environmentId};
  });
  const metrics={artifacts:results.length,bound:results.filter((r)=>r.status==='BOUND').length,claims:new Set(results.map((r)=>r.claimId)).size,distinctOracles:new Set(results.map((r)=>r.oracleId)).size,distinctEnvironments:new Set(results.map((r)=>r.environmentId)).size};
  const material={status:results.every((r)=>r.status==='BOUND')?'PASS' as const:'BLOCK' as const,results,metrics,findings:results.flatMap((r)=>r.failures.map((f)=>`${r.artifactId}:${f}`)).sort()};
  return {...material,reportDigest:sha256(material)};
}
