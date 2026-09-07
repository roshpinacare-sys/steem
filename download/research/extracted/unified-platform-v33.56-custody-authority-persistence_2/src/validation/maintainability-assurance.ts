import { sha256 } from '../contracts/crypto.js';

export interface MaintainabilityObservation {
  readonly path: string;
  readonly ownerId: string;
  readonly documentationCoveragePercent: number;
  readonly testToSourceRatio: number;
  readonly cognitiveComplexityMaximum: number;
  readonly publicApiCount: number;
  readonly deprecatedApiCount: number;
  readonly changeFailureRatePercent: number;
}
export interface MaintainabilityBudget {
  readonly minimumDocumentationCoveragePercent: number;
  readonly minimumTestToSourceRatio: number;
  readonly maximumCognitiveComplexity: number;
  readonly maximumDeprecatedApiPercent: number;
  readonly maximumChangeFailureRatePercent: number;
}
export interface MaintainabilityAssuranceReport {
  readonly status: 'PASS' | 'WATCH' | 'BLOCK';
  readonly score: number;
  readonly metrics: { readonly modules: number; readonly ownedModules: number; readonly documentationCoveragePercent: number; readonly averageTestToSourceRatio: number; readonly maximumCognitiveComplexity: number; readonly deprecatedApiPercent: number; readonly averageChangeFailureRatePercent: number };
  readonly findings: readonly { readonly path: string; readonly severity: 'WATCH' | 'BLOCK'; readonly code: string; readonly observed: number | string; readonly expected: number | string }[];
  readonly reportDigest: string;
}
export function evaluateMaintainabilityAssurance(modules: readonly MaintainabilityObservation[], budget: MaintainabilityBudget): MaintainabilityAssuranceReport {
  validateBudget(budget); const ids=new Set<string>(); const findings: { path:string; severity:'WATCH'|'BLOCK'; code:string; observed:number|string; expected:number|string }[]=[];
  for(const item of modules){
    if(item.path.trim()===''||ids.has(item.path))throw new Error('maintainability_module_identity_invalid'); ids.add(item.path);
    const values=[item.documentationCoveragePercent,item.testToSourceRatio,item.cognitiveComplexityMaximum,item.publicApiCount,item.deprecatedApiCount,item.changeFailureRatePercent];
    if(!values.every(Number.isFinite)||item.documentationCoveragePercent<0||item.documentationCoveragePercent>100||item.testToSourceRatio<0||item.cognitiveComplexityMaximum<0||item.publicApiCount<0||item.deprecatedApiCount<0||item.deprecatedApiCount>item.publicApiCount||item.changeFailureRatePercent<0||item.changeFailureRatePercent>100)throw new Error('maintainability_observation_invalid');
    if(item.ownerId.trim()==='')findings.push(f(item,'BLOCK','owner_missing','', 'non-empty owner'));
    if(item.documentationCoveragePercent<budget.minimumDocumentationCoveragePercent)findings.push(f(item,'WATCH','documentation_below_budget',item.documentationCoveragePercent,budget.minimumDocumentationCoveragePercent));
    if(item.testToSourceRatio<budget.minimumTestToSourceRatio)findings.push(f(item,'BLOCK','test_ratio_below_budget',item.testToSourceRatio,budget.minimumTestToSourceRatio));
    if(item.cognitiveComplexityMaximum>budget.maximumCognitiveComplexity)findings.push(f(item,'BLOCK','cognitive_complexity_exceeded',item.cognitiveComplexityMaximum,budget.maximumCognitiveComplexity));
    const deprecatedPercent=item.publicApiCount===0?0:(item.deprecatedApiCount/item.publicApiCount)*100;
    if(deprecatedPercent>budget.maximumDeprecatedApiPercent)findings.push(f(item,'WATCH','deprecated_api_budget_exceeded',round(deprecatedPercent),budget.maximumDeprecatedApiPercent));
    if(item.changeFailureRatePercent>budget.maximumChangeFailureRatePercent)findings.push(f(item,'BLOCK','change_failure_rate_exceeded',item.changeFailureRatePercent,budget.maximumChangeFailureRatePercent));
  }
  const count=modules.length; const sum=(select:(item:MaintainabilityObservation)=>number)=>count===0?0:modules.reduce((total,item)=>total+select(item),0)/count;
  const totalApis=modules.reduce((total,item)=>total+item.publicApiCount,0); const deprecated=modules.reduce((total,item)=>total+item.deprecatedApiCount,0);
  const metrics={modules:count,ownedModules:modules.filter((item)=>item.ownerId.trim()!=='').length,documentationCoveragePercent:round(sum((item)=>item.documentationCoveragePercent)),averageTestToSourceRatio:round(sum((item)=>item.testToSourceRatio)),maximumCognitiveComplexity:modules.reduce((maximum,item)=>Math.max(maximum,item.cognitiveComplexityMaximum),0),deprecatedApiPercent:round(totalApis===0?0:(deprecated/totalApis)*100),averageChangeFailureRatePercent:round(sum((item)=>item.changeFailureRatePercent))};
  const block=findings.filter((item)=>item.severity==='BLOCK').length; const watch=findings.length-block;
  const score=round(Math.max(0,100-block*12-watch*4-Math.max(0,budget.minimumDocumentationCoveragePercent-metrics.documentationCoveragePercent)*0.15));
  const material={status:block>0?'BLOCK' as const:watch>0?'WATCH' as const:'PASS' as const,score,metrics,findings:findings.sort((a,b)=>a.path.localeCompare(b.path)||a.code.localeCompare(b.code))}; return{...material,reportDigest:sha256(material)};
}
function validateBudget(b:MaintainabilityBudget):void{const values=[b.minimumDocumentationCoveragePercent,b.minimumTestToSourceRatio,b.maximumCognitiveComplexity,b.maximumDeprecatedApiPercent,b.maximumChangeFailureRatePercent];if(!values.every(Number.isFinite)||b.minimumDocumentationCoveragePercent<0||b.minimumDocumentationCoveragePercent>100||b.minimumTestToSourceRatio<0||b.maximumCognitiveComplexity<=0||b.maximumDeprecatedApiPercent<0||b.maximumDeprecatedApiPercent>100||b.maximumChangeFailureRatePercent<0||b.maximumChangeFailureRatePercent>100)throw new Error('maintainability_budget_invalid');}
function f(item:MaintainabilityObservation,severity:'WATCH'|'BLOCK',code:string,observed:number|string,expected:number|string){return{path:item.path,severity,code,observed,expected};}
function round(value:number):number{return Number(value.toFixed(2));}
