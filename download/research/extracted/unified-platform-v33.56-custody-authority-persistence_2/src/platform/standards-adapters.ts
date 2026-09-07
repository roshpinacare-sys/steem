import type { EvidenceRecord } from '../contracts/canonical.js';
import type { EngineeringCommitment } from '../contracts/system.js';

export interface OpenLineageRunEvent {
  readonly eventType: 'START' | 'COMPLETE' | 'FAIL';
  readonly eventTime: string;
  readonly producer: string;
  readonly run: { readonly runId: string; readonly facets: Readonly<Record<string, unknown>> };
  readonly job: { readonly namespace: string; readonly name: string };
  readonly inputs: readonly { readonly namespace: string; readonly name: string }[];
  readonly outputs: readonly { readonly namespace: string; readonly name: string }[];
}

export interface SlsaLikeProvenance {
  readonly _type: 'https://in-toto.io/Statement/v1';
  readonly subject: readonly { readonly name: string; readonly digest: { readonly sha256: string } }[];
  readonly predicateType: 'https://slsa.dev/provenance/v1';
  readonly predicate: {
    readonly buildDefinition: {
      readonly buildType: string;
      readonly externalParameters: Readonly<Record<string, unknown>>;
      readonly resolvedDependencies: readonly { readonly uri: string; readonly digest?: { readonly sha256: string } }[];
    };
    readonly runDetails: {
      readonly builder: { readonly id: string };
      readonly metadata: { readonly invocationId: string; readonly startedOn: string; readonly finishedOn: string };
    };
  };
}

export function toOpenLineageCompleteEvent(options: {
  readonly commitment: EngineeringCommitment;
  readonly evidence: EvidenceRecord;
  readonly artifactNames: readonly string[];
}): OpenLineageRunEvent {
  return {
    eventType: 'COMPLETE',
    eventTime: options.evidence.createdAt,
    producer: 'sovereign-foundry/canonical-proof-v18',
    run: {
      runId: options.commitment.commitmentId,
      facets: {
        evidenceClass: options.evidence.evidenceClass,
        evidenceRecordId: options.evidence.recordId,
        limitations: options.evidence.limitations,
      },
    },
    job: {
      namespace: options.commitment.tenantId,
      name: `${options.commitment.domainPackId}.engineering-commitment`,
    },
    inputs: options.commitment.requirementIds.map((id) => ({ namespace: options.commitment.tenantId, name: `requirement:${id}` })),
    outputs: options.artifactNames.map((name) => ({ namespace: options.commitment.tenantId, name })),
  };
}

export function toSlsaLikeProvenance(options: {
  readonly commitment: EngineeringCommitment;
  readonly artifactName: string;
  readonly artifactDigest: string;
  readonly builderId: string;
  readonly startedOn: string;
  readonly finishedOn: string;
  readonly dependencyDigests: Readonly<Record<string, string>>;
}): SlsaLikeProvenance {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: options.artifactName, digest: { sha256: options.artifactDigest } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://sovereign-foundry.example/build-types/engineering-commitment/v1',
        externalParameters: {
          commitmentId: options.commitment.commitmentId,
          tenantId: options.commitment.tenantId,
          domainPackId: options.commitment.domainPackId,
          requirementIds: options.commitment.requirementIds,
          promotionCeiling: options.commitment.promotionCeiling,
        },
        resolvedDependencies: Object.entries(options.dependencyDigests)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([uri, sha256]) => ({ uri, digest: { sha256 } })),
      },
      runDetails: {
        builder: { id: options.builderId },
        metadata: {
          invocationId: options.commitment.commitmentId,
          startedOn: options.startedOn,
          finishedOn: options.finishedOn,
        },
      },
    },
  };
}
