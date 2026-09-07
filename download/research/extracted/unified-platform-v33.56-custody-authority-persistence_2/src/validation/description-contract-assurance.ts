import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';
import { sha256 } from '../contracts/crypto.js';
export interface DescriptionContractInput { readonly claimId:string; readonly scope:'LOCAL'|'EXTERNAL'|'HUMAN'; readonly sourcePath:string; readonly exactMarker:string; readonly evidencePath:string; readonly expectedStatus:string; readonly evidenceOrigin:'LOCAL'|'EXTERNAL'|'HUMAN'; }
function safe(path:string){const n=normalize(path);return !isAbsolute(path)&&!n.startsWith('..')&&!n.includes('/../');}
export function verifyDescriptionContracts(root:string,inputs:readonly DescriptionContractInput[]){
 if(!inputs.length)throw new Error('description_contracts_empty');const ids=new Set<string>();
 const results=inputs.map(i=>{if(!i.claimId||ids.has(i.claimId))throw new Error('description_claim_identity_invalid');ids.add(i.claimId);const failures:string[]=[];
  if(!safe(i.sourcePath)||!safe(i.evidencePath))failures.push('description_path_unsafe');const sp=resolve(root,i.sourcePath),ep=resolve(root,i.evidencePath);
  const source=existsSync(sp)?readFileSync(sp,'utf8'):'';if(!source)failures.push('description_source_missing');
  const markerCount=i.exactMarker?source.split(i.exactMarker).length-1:0;if(markerCount!==1)failures.push(markerCount===0?'description_marker_missing':'description_marker_not_unique');
  let evidence:any;try{evidence=JSON.parse(readFileSync(ep,'utf8'));}catch{failures.push('description_evidence_missing_or_invalid');}
  if(evidence?.status!==i.expectedStatus)failures.push('description_evidence_predicate_mismatch');
  if(i.scope!=='LOCAL'&&i.evidenceOrigin==='LOCAL')failures.push('local_evidence_cannot_support_external_description');
  return{claimId:i.claimId,scope:i.scope,sourcePath:i.sourcePath,evidencePath:i.evidencePath,status:failures.length?'BLOCK' as const:'VERIFIED' as const,failures};});
 const metrics={claims:results.length,verified:results.filter(r=>r.status==='VERIFIED').length,refuted:0,sources:new Set(results.map(r=>r.sourcePath)).size,evidenceReports:new Set(results.map(r=>r.evidencePath)).size};const material={status:results.every(r=>r.status==='VERIFIED')?'PASS' as const:'BLOCK' as const,results,metrics,findings:results.flatMap(r=>r.failures.map(f=>`${r.claimId}:${f}`)).sort()};return{...material,reportDigest:sha256(material)};
}
