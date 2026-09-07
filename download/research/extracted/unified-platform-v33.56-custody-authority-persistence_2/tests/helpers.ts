import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningIdentity, KeyRegistry, signEnvelope } from '../src/contracts/crypto.js';
import type { AuthorityGrant } from '../src/contracts/canonical.js';
import { SqliteRuntimeStore } from '../src/runtime/sqlite-store.js';
import { DurableRuntimeEngine } from '../src/runtime/engine.js';

export function createHarness(now = new Date('2026-07-16T10:00:00.000Z')) {
  const directory = mkdtempSync(join(tmpdir(), 'canonical-proof-test-'));
  const dbPath = join(directory, 'runtime.db');
  const issuer = generateSigningIdentity('issuer-key');
  const reviewer = generateSigningIdentity('reviewer-key');
  const registry = new KeyRegistry();
  registry.register(issuer.keyId, issuer.publicKey);
  registry.register(reviewer.keyId, reviewer.publicKey);
  const grant: AuthorityGrant = {
    grantId: 'grant-1',
    tenantId: 'tenant-1',
    subjectId: 'subject-1',
    scopes: ['repository.read'],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    issuer: 'canonical-kernel',
  };
  const store = new SqliteRuntimeStore(dbPath);
  return {
    directory,
    dbPath,
    now,
    issuer,
    reviewer,
    registry,
    grant,
    signedGrant: signEnvelope(grant, issuer),
    store,
    engine: new DurableRuntimeEngine(store, registry),
  };
}
