import { sha256 } from '../contracts/crypto.js';

export type SovereignServiceId =
  | 'identity'
  | 'relational-database'
  | 'cache'
  | 'job-queue'
  | 'object-storage'
  | 'secrets'
  | 'observability'
  | 'ai-routing'
  | 'ci-cd'
  | 'email'
  | 'sms'
  | 'payments'
  | 'global-edge';

export interface ServicePrimitiveEvidence {
  readonly serviceId: SovereignServiceId;
  readonly implementation: string;
  readonly sourcePaths: readonly string[];
  readonly testPaths: readonly string[];
  readonly observed: boolean;
  readonly multiHostQualified: boolean;
  readonly dataSovereign: boolean;
  readonly perUserLicense: boolean;
  readonly externalDependency: boolean;
}

export interface ConsolidationRequirement {
  readonly serviceId: SovereignServiceId;
  readonly required: boolean;
  readonly productionCritical: boolean;
  readonly multiHostRequired: boolean;
}

export interface ConsolidationDecision {
  readonly serviceId: SovereignServiceId;
  readonly disposition: 'NATIVE' | 'SELF_HOSTED_STANDARD' | 'EXTERNAL_BOUNDARY' | 'BLOCKED';
  readonly implementation: string;
  readonly reason: string;
  readonly productionQualified: boolean;
}

export interface SovereignConsolidationReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly decisions: readonly ConsolidationDecision[];
  readonly nativeServices: number;
  readonly selfHostedStandards: number;
  readonly unavoidableExternalBoundaries: number;
  readonly blockedServices: number;
  readonly eliminatedPerUserLicenses: number;
  readonly externallyQualifiedServices: number;
  readonly reportDigest: string;
}

const externalBoundaries = new Set<SovereignServiceId>(['email', 'sms', 'payments', 'global-edge']);

export function evaluateSovereignConsolidation(
  requirements: readonly ConsolidationRequirement[],
  evidence: readonly ServicePrimitiveEvidence[],
): SovereignConsolidationReport {
  const requirementIds = new Set<SovereignServiceId>();
  const evidenceById = new Map<SovereignServiceId, ServicePrimitiveEvidence>();
  for (const item of evidence) {
    if (evidenceById.has(item.serviceId)) throw new Error('consolidation_duplicate_evidence');
    if (item.implementation.trim() === '' || item.sourcePaths.length === 0 || item.testPaths.length === 0) throw new Error('consolidation_evidence_invalid');
    evidenceById.set(item.serviceId, item);
  }
  const decisions: ConsolidationDecision[] = [];
  for (const requirement of requirements) {
    if (requirementIds.has(requirement.serviceId)) throw new Error('consolidation_duplicate_requirement');
    requirementIds.add(requirement.serviceId);
    if (!requirement.required) continue;
    const primitive = evidenceById.get(requirement.serviceId);
    if (externalBoundaries.has(requirement.serviceId)) {
      decisions.push({
        serviceId: requirement.serviceId,
        disposition: 'EXTERNAL_BOUNDARY',
        implementation: primitive?.implementation ?? 'provider-adapter-required',
        reason: 'regulated-or-global-delivery-boundary-cannot-be-honestly-eliminated',
        productionQualified: primitive?.observed === true,
      });
      continue;
    }
    if (primitive === undefined || !primitive.observed || !primitive.dataSovereign) {
      decisions.push({ serviceId: requirement.serviceId, disposition: 'BLOCKED', implementation: primitive?.implementation ?? 'missing', reason: 'observed-sovereign-primitive-required', productionQualified: false });
      continue;
    }
    const multiHostQualified = !requirement.multiHostRequired || primitive.multiHostQualified;
    decisions.push({
      serviceId: requirement.serviceId,
      disposition: primitive.externalDependency ? 'SELF_HOSTED_STANDARD' : 'NATIVE',
      implementation: primitive.implementation,
      reason: multiHostQualified ? 'sovereign-primitive-satisfies-requirement' : 'local-implementation-ready-external-multi-host-qualification-pending',
      productionQualified: multiHostQualified && (!requirement.productionCritical || primitive.multiHostQualified),
    });
  }
  const material = {
    decisions,
    nativeServices: decisions.filter((item) => item.disposition === 'NATIVE').length,
    selfHostedStandards: decisions.filter((item) => item.disposition === 'SELF_HOSTED_STANDARD').length,
    unavoidableExternalBoundaries: decisions.filter((item) => item.disposition === 'EXTERNAL_BOUNDARY').length,
    blockedServices: decisions.filter((item) => item.disposition === 'BLOCKED').length,
    eliminatedPerUserLicenses: decisions.filter((item) => {
      const primitive = evidenceById.get(item.serviceId);
      return (item.disposition === 'NATIVE' || item.disposition === 'SELF_HOSTED_STANDARD') && primitive?.perUserLicense === false;
    }).length,
    externallyQualifiedServices: decisions.filter((item) => item.productionQualified).length,
  };
  const status = material.blockedServices === 0 ? 'PASS' as const : 'BLOCK' as const;
  return { status, ...material, reportDigest: sha256({ status, ...material }) };
}
