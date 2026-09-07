import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningIdentity, KeyRegistry, signEnvelope } from '../contracts/crypto.js';
import type { AuthorityGrant } from '../contracts/canonical.js';
import { SqliteRuntimeStore } from '../runtime/sqlite-store.js';
import { DurableRuntimeEngine } from '../runtime/engine.js';
import { runRepositoryShadowCommitment } from '../app/shadow-commitment.js';

const root = await mkdtemp(join(tmpdir(), 'canonical-v17-demo-'));
const repository = join(root, 'fixture-repository');
await mkdir(repository);
await writeFile(join(repository, 'README.md'), '# Safe fixture\n');
await writeFile(join(repository, 'module.ts'), 'export const answer = 42;\n');

const issuer = generateSigningIdentity('authority-key-v1');
const reviewer = generateSigningIdentity('reviewer-key-v1');
const registry = new KeyRegistry();
registry.register(issuer.keyId, issuer.publicKey);
registry.register(reviewer.keyId, reviewer.publicKey);

const now = new Date('2026-07-16T10:00:00.000Z');
const grant: AuthorityGrant = {
  grantId: 'grant-demo-1',
  tenantId: 'tenant-demo',
  subjectId: 'agent-demo',
  scopes: ['repository.read'],
  issuedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
  issuer: 'canonical-kernel',
};
const store = new SqliteRuntimeStore(join(root, 'runtime.db'));
const engine = new DurableRuntimeEngine(store, registry);
const result = await runRepositoryShadowCommitment({
  engine,
  signedGrant: signEnvelope(grant, issuer),
  repositoryRoot: repository,
  tenantId: grant.tenantId,
  subjectId: grant.subjectId,
  builderId: 'builder-demo',
  reviewerId: 'reviewer-demo',
  workerId: 'worker-demo',
  passportSigner: reviewer,
  now,
});
const passportValid = registry.verify(result.passport);
const output = {
  status: 'SHADOW_ONLY_PROOF_COMPLETED',
  missionId: result.missionId,
  fileCount: result.inventory.fileCount,
  treeDigest: result.inventory.treeDigest,
  evidenceRoot: result.evidenceRoot,
  promotion: result.decision.toState,
  passportValid,
  eventChain: store.verifyEventChain(result.missionId),
  evidenceChain: store.verifyEvidenceChain(grant.tenantId),
  explicitNonClaims: [
    'not-production-ready',
    'not-postgresql-qualified',
    'not-os-sandboxed',
    'no-financial-or-physical-side-effects',
  ],
};
store.close();
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
