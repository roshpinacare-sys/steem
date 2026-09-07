import { sha256 } from '../contracts/crypto.js';
export type ReleasePhase='DRAFT'|'LOCAL_VALIDATED'|'EXTERNAL_ELIGIBLE'|'PRODUCTION';
export interface ReleaseModelState { readonly phase:ReleasePhase; readonly externalGatesPassed:number; readonly evidenceFresh:boolean; readonly authorizedDecision:boolean; readonly autoPromotion:boolean; }
export interface ReleaseModelReport { readonly status:'PASS'|'BLOCK'; readonly statesGenerated:number; readonly distinctStates:number; readonly invariantIds:readonly string[]; readonly invariantViolations:readonly {invariantId:string;state:ReleaseModelState}[]; readonly deadlockFound:boolean; readonly maximumDepth:number; readonly observed:true; readonly modelDigest:string; readonly reportDigest:string; }
const key=(s:ReleaseModelState)=>JSON.stringify(s);
export function exploreReleaseModel(options:{maximumDepth:number;allowUnsafeProductionTransition?:boolean}):ReleaseModelReport{
 if(!Number.isInteger(options.maximumDepth)||options.maximumDepth<1||options.maximumDepth>12)throw new Error('model_depth_invalid');
 const initial:ReleaseModelState={phase:'DRAFT',externalGatesPassed:0,evidenceFresh:true,authorizedDecision:false,autoPromotion:false};const queue:[ReleaseModelState,number][]=[[initial,0]],seen=new Map<string,ReleaseModelState>(),violations:ReleaseModelReport['invariantViolations'][number][]=[];let generated=0,deadlock=false;
 const invariants=['NoAutoPromotion','ProductionRequiresSixExternalGates','ProductionRequiresAuthorizedDecision','ProductionRequiresFreshEvidence'] as const;
 while(queue.length){const [state,depth]=queue.shift()!;const k=key(state);if(seen.has(k))continue;seen.set(k,state);generated++;
  if(state.autoPromotion)violations.push({invariantId:'NoAutoPromotion',state});
  if(state.phase==='PRODUCTION'&&state.externalGatesPassed<6)violations.push({invariantId:'ProductionRequiresSixExternalGates',state});
  if(state.phase==='PRODUCTION'&&!state.authorizedDecision)violations.push({invariantId:'ProductionRequiresAuthorizedDecision',state});
  if(state.phase==='PRODUCTION'&&!state.evidenceFresh)violations.push({invariantId:'ProductionRequiresFreshEvidence',state});
  if(depth>=options.maximumDepth)continue;const next:ReleaseModelState[]=[];
  if(state.phase==='DRAFT')next.push({...state,phase:'LOCAL_VALIDATED'});
  if(state.phase==='LOCAL_VALIDATED'){next.push({...state,externalGatesPassed:Math.min(6,state.externalGatesPassed+1)});if(state.externalGatesPassed===6&&state.evidenceFresh)next.push({...state,phase:'EXTERNAL_ELIGIBLE'});}
  if(state.phase==='EXTERNAL_ELIGIBLE'&&state.authorizedDecision&&state.evidenceFresh&&state.externalGatesPassed===6)next.push({...state,phase:'PRODUCTION'});
  if(options.allowUnsafeProductionTransition&&state.phase==='LOCAL_VALIDATED')next.push({...state,phase:'PRODUCTION'});
  next.push({...state,evidenceFresh:!state.evidenceFresh});if(!state.authorizedDecision)next.push({...state,authorizedDecision:true});
  if(next.length===0&&state.phase!=='PRODUCTION')deadlock=true;for(const n of next)queue.push([n,depth+1]);
 }
 const material={status:violations.length||deadlock?'BLOCK' as const:'PASS' as const,statesGenerated:generated,distinctStates:seen.size,invariantIds:[...invariants],invariantViolations:violations,deadlockFound:deadlock,maximumDepth:options.maximumDepth,observed:true as const,modelDigest:sha256({initial,options,invariants})};return{...material,reportDigest:sha256(material)};
}
