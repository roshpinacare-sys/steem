import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../contracts/crypto.js';
import type { AuthorityGrant } from '../contracts/canonical.js';
import type { DomainPackManifest, RequirementContract } from '../contracts/system.js';
import type { GeneratedDomainPack } from '../platform/domain-pack-generator.js';
import { SqliteRuntimeStore } from '../runtime/sqlite-store.js';
import { DurableRuntimeEngine } from '../runtime/engine.js';
import { runIntegratedEngineeringCommitment } from '../app/integrated-engineering-commitment.js';

const now = new Date('2026-07-16T12:00:00.000Z');
const directory = mkdtempSync(join(tmpdir(), 'canonical-v18-demo-'));
const repository = join(directory, 'repository');
mkdirSync(repository);
writeFileSync(join(repository, 'README.md'), '# Evidence-qualified repository\n');
writeFileSync(join(repository, 'module.ts'), 'export const answer = 42;\n');

const issuer = generateSigningIdentity('canonical-authority-key');
const reviewer = generateSigningIdentity('independent-reviewer-key');
const keys = new KeyRegistry();
keys.register(issuer.keyId, issuer.publicKey);
keys.register(reviewer.keyId, reviewer.publicKey);
const grant: AuthorityGrant = {
  grantId: 'grant-v18-demo', tenantId: 'tenant-demo', subjectId: 'agent-demo', scopes: ['repository.read'],
  issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(), issuer: 'canonical-kernel-v18',
};
const store = new SqliteRuntimeStore(join(directory, 'runtime.db'));
const engine = new DurableRuntimeEngine(store, keys);
const manifest: DomainPackManifest = {
  packId: 'software-delivery', version: '1.0.0', kernelContractVersion: '0.2.0', ontologyVersion: '1.0.0',
  workflows: ['repository-inventory'], requiredCapabilities: ['repository.inventory'], emittedEvidenceClasses: ['COMPUTED'],
  requiredScopes: ['repository.read'], uiSurfaces: ['evidence-viewer', 'approval-center'], risks: ['source-code-exposure'],
  authorityModel: 'canonical-kernel-only',
};
const packMaterial = {
  generationId: 'demo-software-delivery-1', status: 'APPROVED_FOR_REGISTRATION' as const, manifest,
  ontology: { entities: ['repository'], relationships: ['inventory:operates-on:repository'], version: manifest.ontologyVersion },
  requirementTemplates: [], uiSchema: manifest.uiSurfaces.map((surfaceId) => ({ surfaceId, purpose: 'demo', authoritative: false as const })),
  testSkeleton: [], riskRegister: manifest.risks.map((statement, index) => ({ riskId: `risk-${index}`, statement, mitigation: 'independent review' })),
  uncertainties: ['demo fixture'], sourceRefs: ['demo'], approvedBy: ['domain-reviewer-1', 'domain-reviewer-2'],
};
const pack: GeneratedDomainPack = { ...packMaterial, digest: sha256(packMaterial) };
const requirement: RequirementContract = {
  requirementId: 'req-repository-present', tenantId: 'tenant-demo', statement: 'The repository must contain at least two regular files.',
  criticality: 'HIGH', requiredEvidenceClasses: ['COMPUTED'], verificationModes: ['TEST'],
  acceptanceCriteria: { minimumFiles: 2 }, version: '1.0.0',
};

try {
  const result = await runIntegratedEngineeringCommitment({
    engine, signedGrant: signEnvelope(grant, issuer), repositoryRoot: repository, tenantId: 'tenant-demo', subjectId: 'agent-demo',
    builderId: 'builder-demo', reviewerId: 'reviewer-demo', workerId: 'worker-demo', passportSigner: reviewer,
    domainPack: pack, requirements: [requirement], observedFailures: [{
      failureId: 'historical-import-side-effect', tenantId: 'tenant-demo', category: 'IMPORT_SIDE_EFFECT', sourceSystem: 'yongzuan',
      subject: 'physical-certification-driver', evidenceRefs: ['evidence:yongzuan-v134-import'], observedAt: now.toISOString(), severity: 'HIGH',
    }], now,
  });
  console.log(JSON.stringify({
    status: 'EVIDENCE_QUALIFIED_ENGINEERING_COMMITMENT_COMPLETED',
    commitmentId: result.commitment.commitmentId,
    certification: result.certification.decision,
    promotion: result.decision.toState,
    passportValid: keys.verify(result.passport),
    digitalThreadRoot: result.digitalThreadRoot,
    openLineageEventType: result.openLineage.eventType,
    provenancePredicateType: result.provenance.predicateType,
    compiledFailureKnowledge: result.failureKnowledge.length,
    explicitNonClaims: [
      'not-production-ready', 'not-postgresql-qualified', 'not-component-model-sandboxed',
      'standards-adapters-are-bounded-mappings-not-certifications',
    ],
  }, null, 2));
} finally {
  store.close();
}
