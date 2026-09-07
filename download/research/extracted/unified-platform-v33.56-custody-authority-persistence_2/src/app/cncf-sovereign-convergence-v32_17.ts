import { sha256 } from '../contracts/crypto.js';
import { evaluateSovereignComponentV32_17, optimizeSovereignBuildingBlockPlanV32_17, type SovereignBuildingBlockPlanPolicyV32_17, type SovereignComponentManifestV32_17, type SovereignComponentPolicyV32_17 } from '../platform/sovereign-building-blocks-v32_17.js';
import { comparePortableConformanceV32_17, EnvelopePortableAdapterV32_17, NativePortableAdapterV32_17, runPortableBuildingBlockConformanceV32_17 } from '../runtime/portable-building-block-harness-v32_17.js';

export interface CncfSovereignConvergenceReportV32_17 {
  readonly schemaVersion:'32.17';
  readonly state:'FAILED'|'DRY_RUN_PASSED'|'PRODUCTION_QUALIFIED';
  readonly productionQualified:boolean;
  readonly componentAdmissions:number;
  readonly selectedComponents:number;
  readonly buildingBlocksCovered:number;
  readonly buildingBlocksRequired:number;
  readonly interoperabilityEquivalent:boolean;
  readonly operationalReductionRate:number;
  readonly normalizedCostReductionRate:number;
  readonly vendorSubstitutionCoverage:number;
  readonly findings:readonly string[];
  readonly limitations:readonly string[];
  readonly evidence:{readonly planDigest:string;readonly conformanceDigest:string;readonly nativeReportDigest:string;readonly envelopeReportDigest:string};
  readonly reportDigest:string;
}

export async function runCncfSovereignConvergenceV32_17(input:{readonly manifests:readonly SovereignComponentManifestV32_17[];readonly componentPolicy:SovereignComponentPolicyV32_17;readonly planPolicy:SovereignBuildingBlockPlanPolicyV32_17;readonly baselineOperationalUnits:number;readonly baselineNormalizedMonthlyCost:number}):Promise<CncfSovereignConvergenceReportV32_17>{
  if(!Number.isSafeInteger(input.baselineOperationalUnits)||input.baselineOperationalUnits<=0||!Number.isFinite(input.baselineNormalizedMonthlyCost)||input.baselineNormalizedMonthlyCost<=0)throw new Error('cncf_convergence_baseline_invalid');
  const admissions=input.manifests.map((manifest)=>evaluateSovereignComponentV32_17(manifest,input.componentPolicy));
  const plan=optimizeSovereignBuildingBlockPlanV32_17(input.manifests,admissions,input.planPolicy);
  const native=await runPortableBuildingBlockConformanceV32_17(new NativePortableAdapterV32_17());
  const envelope=await runPortableBuildingBlockConformanceV32_17(new EnvelopePortableAdapterV32_17());
  const comparison=comparePortableConformanceV32_17([native,envelope]);
  const findings=[...admissions.flatMap((item)=>item.findings.map((finding)=>`${item.componentId}:${finding}`)),...plan.findings,...comparison.findings].sort();
  const operationalReductionRate=ratio(input.baselineOperationalUnits-plan.operationalUnits,input.baselineOperationalUnits);
  const normalizedCostReductionRate=ratio(input.baselineNormalizedMonthlyCost-plan.normalizedMonthlyCost,input.baselineNormalizedMonthlyCost);
  const required=new Set(input.planPolicy.requiredBlocks);const alternatives=new Map([...required].map((block)=>[block,input.manifests.filter((item)=>item.blocks.includes(block)&&admissions.find((report)=>report.componentId===item.componentId)?.admission!=='REJECT').length]));
  const vendorSubstitutionCoverage=Number(([...alternatives.values()].filter((count)=>count>=2).length/required.size).toFixed(6));
  if(vendorSubstitutionCoverage<1)findings.push('cncf-substitution-coverage-incomplete');
  if(!comparison.equivalent)findings.push('cncf-portable-contract-divergence');
  if(plan.state==='REJECTED')findings.push('cncf-building-block-plan-rejected');
  const productionQualified=findings.length===0&&plan.productionQualified;
  const state:CncfSovereignConvergenceReportV32_17['state']=findings.length>0?'FAILED':productionQualified?'PRODUCTION_QUALIFIED':'DRY_RUN_PASSED';
  const material={schemaVersion:'32.17' as const,state,productionQualified,componentAdmissions:admissions.filter((item)=>item.admission!=='REJECT').length,selectedComponents:plan.selectedComponentIds.length,buildingBlocksCovered:plan.coveredBlocks.length,buildingBlocksRequired:input.planPolicy.requiredBlocks.length,interoperabilityEquivalent:comparison.equivalent,operationalReductionRate,normalizedCostReductionRate,vendorSubstitutionCoverage,findings:[...new Set(findings)].sort(),limitations:['dapr-runtime-not-executed-in-current-offline-environment','spiffe-opa-otel-profiles-validated-as-contracts-not-external-daemons','cloudnativepg-ha-pitr-remains-external-qualification','local-conformance-adapters-are-not-independent-organizations'],evidence:{planDigest:plan.planDigest,conformanceDigest:comparison.reportDigest,nativeReportDigest:native.reportDigest,envelopeReportDigest:envelope.reportDigest}};
  return{...material,reportDigest:sha256(material)};
}
function ratio(numerator:number,denominator:number):number{return Number((Math.max(0,numerator)/denominator).toFixed(6));}
