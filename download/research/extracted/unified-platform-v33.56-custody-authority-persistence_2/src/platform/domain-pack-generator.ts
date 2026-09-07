import { randomUUID } from 'node:crypto';
import { EVIDENCE_CLASSES, type EvidenceClass } from '../contracts/canonical.js';
import { sha256 } from '../contracts/crypto.js';
import { validateDomainPackManifest, type DomainPackManifest, type RequirementCriticality, type VerificationMode } from '../contracts/system.js';

export interface DomainSpecification {
  readonly domainId: string;
  readonly version: string;
  readonly ontologyVersion: string;
  readonly entities: readonly string[];
  readonly workflows: readonly {
    readonly workflowId: string;
    readonly goal: string;
    readonly actions: readonly string[];
    readonly requiredScopes: readonly string[];
    readonly evidenceClasses: readonly EvidenceClass[];
  }[];
  readonly requirements: readonly {
    readonly statement: string;
    readonly criticality: RequirementCriticality;
    readonly verificationModes: readonly VerificationMode[];
    readonly evidenceClasses: readonly EvidenceClass[];
  }[];
  readonly uiNeeds: readonly string[];
  readonly risks: readonly string[];
  readonly assumptions: readonly string[];
  readonly sourceRefs: readonly string[];
}

export interface GeneratedDomainPack {
  readonly generationId: string;
  readonly status: 'DRAFT_REQUIRES_HUMAN_APPROVAL' | 'APPROVED_FOR_REGISTRATION';
  readonly manifest: DomainPackManifest;
  readonly ontology: {
    readonly entities: readonly string[];
    readonly relationships: readonly string[];
    readonly version: string;
  };
  readonly requirementTemplates: readonly {
    readonly templateId: string;
    readonly statement: string;
    readonly criticality: RequirementCriticality;
    readonly verificationModes: readonly VerificationMode[];
    readonly requiredEvidenceClasses: readonly EvidenceClass[];
  }[];
  readonly uiSchema: readonly {
    readonly surfaceId: string;
    readonly purpose: string;
    readonly authoritative: false;
  }[];
  readonly testSkeleton: readonly {
    readonly testId: string;
    readonly invariant: string;
    readonly negativeCases: readonly string[];
  }[];
  readonly riskRegister: readonly {
    readonly riskId: string;
    readonly statement: string;
    readonly mitigation: string;
  }[];
  readonly uncertainties: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly approvedBy: readonly string[];
  readonly digest: string;
}

export class SovereignDomainPackGenerator {
  generate(specification: DomainSpecification): GeneratedDomainPack {
    validateSpecification(specification);
    const requiredScopes = [...new Set(specification.workflows.flatMap((workflow) => workflow.requiredScopes))].sort();
    const emittedEvidenceClasses = [...new Set(specification.workflows.flatMap((workflow) => workflow.evidenceClasses))].sort() as EvidenceClass[];
    const manifest: DomainPackManifest = {
      packId: `domain.${specification.domainId}`,
      version: specification.version,
      kernelContractVersion: '0.1',
      ontologyVersion: specification.ontologyVersion,
      workflows: specification.workflows.map((workflow) => workflow.workflowId),
      requiredCapabilities: specification.workflows.flatMap((workflow) => workflow.actions).map((action) => `domain.${specification.domainId}.${action}`).filter(unique).sort(),
      emittedEvidenceClasses,
      requiredScopes,
      uiSurfaces: [...new Set(specification.uiNeeds)].sort(),
      risks: [...new Set(specification.risks)].sort(),
      authorityModel: 'canonical-kernel-only',
    };
    validateDomainPackManifest(manifest);
    const ontology = {
      entities: [...new Set(specification.entities)].sort(),
      relationships: deriveRelationships(specification),
      version: specification.ontologyVersion,
    };
    const requirementTemplates = specification.requirements.map((requirement, index) => ({
      templateId: `${manifest.packId}:requirement:${index + 1}`,
      statement: requirement.statement,
      criticality: requirement.criticality,
      verificationModes: [...new Set(requirement.verificationModes)],
      requiredEvidenceClasses: [...new Set(requirement.evidenceClasses)],
    }));
    const uiSchema = manifest.uiSurfaces.map((surfaceId) => ({
      surfaceId,
      purpose: `Present and collect non-authoritative ${specification.domainId} workflow information for ${surfaceId}.`,
      authoritative: false as const,
    }));
    const testSkeleton = specification.workflows.flatMap((workflow) => [
      {
        testId: `${manifest.packId}:${workflow.workflowId}:authority`,
        invariant: `Workflow ${workflow.workflowId} cannot execute without canonical tenant-bound authority.`,
        negativeCases: ['wrong tenant', 'expired authority', 'wildcard scope', 'self approval'],
      },
      {
        testId: `${manifest.packId}:${workflow.workflowId}:evidence`,
        invariant: `Workflow ${workflow.workflowId} emits only declared evidence classes and preserves limitations.`,
        negativeCases: ['missing evidence', 'wrong evidence class', 'tampered artifact', 'simulation labeled measured'],
      },
      {
        testId: `${manifest.packId}:${workflow.workflowId}:recovery`,
        invariant: `Workflow ${workflow.workflowId} has an explicit rollback or safe recovery path.`,
        negativeCases: ['crash before effect', 'crash after effect', 'duplicate delivery', 'rollback failure'],
      },
    ]);
    const riskRegister = specification.risks.map((statement, index) => ({
      riskId: `${manifest.packId}:risk:${index + 1}`,
      statement,
      mitigation: `Require explicit domain gate, evidence, independent review, and recovery for: ${statement}`,
    }));
    const uncertainties = [
      ...specification.assumptions.map((assumption) => `UNVALIDATED_ASSUMPTION: ${assumption}`),
      'Generated contracts and tests are scaffolds and do not grant authority.',
      'Domain expert review is required before registration.',
      'Legal, safety, physical, and regulatory claims require separate qualification.',
    ];
    const material = {
      generationId: randomUUID(),
      status: 'DRAFT_REQUIRES_HUMAN_APPROVAL' as const,
      manifest,
      ontology,
      requirementTemplates,
      uiSchema,
      testSkeleton,
      riskRegister,
      uncertainties,
      sourceRefs: [...new Set(specification.sourceRefs)].sort(),
      approvedBy: [] as string[],
    };
    return { ...material, digest: sha256(material) };
  }

  approve(draft: GeneratedDomainPack, reviewers: readonly string[]): GeneratedDomainPack {
    if (draft.status !== 'DRAFT_REQUIRES_HUMAN_APPROVAL') throw new Error('domain_pack_not_awaiting_approval');
    if (draft.digest !== digestWithoutDigest(draft)) throw new Error('domain_pack_draft_tampered');
    const approvedBy = [...new Set(reviewers.filter((reviewer) => reviewer.trim() !== ''))].sort();
    if (approvedBy.length < 2) throw new Error('domain_pack_dual_review_required');
    const material = { ...stripDigest(draft), status: 'APPROVED_FOR_REGISTRATION' as const, approvedBy };
    return { ...material, digest: sha256(material) };
  }
}

function validateSpecification(specification: DomainSpecification): void {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(specification.domainId)) throw new Error('invalid_domain_id');
  if (specification.version.trim() === '' || specification.ontologyVersion.trim() === '') throw new Error('domain_version_required');
  if (specification.entities.length === 0 || specification.workflows.length === 0 || specification.requirements.length === 0 || specification.uiNeeds.length === 0 || specification.risks.length === 0 || specification.sourceRefs.length === 0) throw new Error('incomplete_domain_specification');
  if (new Set(specification.workflows.map((workflow) => workflow.workflowId)).size !== specification.workflows.length) throw new Error('duplicate_domain_workflow');
  for (const workflow of specification.workflows) {
    if (workflow.workflowId.trim() === '' || workflow.goal.trim() === '' || workflow.actions.length === 0 || workflow.requiredScopes.length === 0 || workflow.evidenceClasses.length === 0) throw new Error('invalid_domain_workflow');
    if (workflow.requiredScopes.some((scope) => scope === '*' || scope.endsWith('.*') || ['authority.', 'tenant.', 'secret.', 'release.', 'kernel.'].some((prefix) => scope.startsWith(prefix)))) throw new Error('domain_pack_unsafe_scope');
    if (workflow.evidenceClasses.some((evidenceClass) => !EVIDENCE_CLASSES.includes(evidenceClass))) throw new Error('invalid_domain_evidence_class');
  }
  for (const requirement of specification.requirements) {
    if (requirement.statement.trim() === '' || requirement.verificationModes.length === 0 || requirement.evidenceClasses.length === 0) throw new Error('invalid_domain_requirement');
  }
}

function deriveRelationships(specification: DomainSpecification): string[] {
  const relationships = new Set<string>();
  for (const workflow of specification.workflows) {
    for (const entity of specification.entities) relationships.add(`${workflow.workflowId}:operates-on:${entity}`);
  }
  return [...relationships].sort();
}
function unique(value: string, index: number, array: string[]): boolean { return array.indexOf(value) === index; }
function stripDigest(draft: GeneratedDomainPack): Omit<GeneratedDomainPack, 'digest'> { const { digest: _digest, ...rest } = draft; return rest; }
function digestWithoutDigest(draft: GeneratedDomainPack): string { return sha256(stripDigest(draft)); }
