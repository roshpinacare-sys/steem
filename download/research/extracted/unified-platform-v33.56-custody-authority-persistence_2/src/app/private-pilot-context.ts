import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateSigningIdentity, sha256, type SigningIdentity } from '../contracts/crypto.js';
import { EncryptedKeyStore } from '../security/encrypted-keystore.js';
import { KeyLifecycleRegistry } from '../security/key-lifecycle.js';
import { PrivateIdentityStore } from '../security/private-identity.js';

export interface PrivatePilotContext {
  readonly root: string;
  readonly keyStore: EncryptedKeyStore;
  readonly identityStore: PrivateIdentityStore;
  readonly passportSigner: SigningIdentity;
  readonly keyRegistry: KeyLifecycleRegistry;
  readonly sessionSigningSecret: string;
  readonly trustRoot: string;
}

export function openOrCreatePrivatePilotContext(root: string, passphrase: string, now = new Date()): PrivatePilotContext {
  const absolute = resolve(root);
  mkdirSync(absolute, { recursive: true });
  const keyStorePath = join(absolute, 'security', 'private-pilot-keys.enc.json');
  let keyStore: EncryptedKeyStore;
  let passportSigner: SigningIdentity;
  let keyRegistry: KeyLifecycleRegistry;
  let sessionSigningSecret: string;
  let bootstrapCreatedAt: string;

  if (!existsSync(keyStorePath)) {
    keyStore = EncryptedKeyStore.create(keyStorePath, passphrase, now);
    passportSigner = generateSigningIdentity('tenant-1-action-passport-v1');
    keyRegistry = new KeyLifecycleRegistry();
    keyRegistry.register(passportSigner, {
      keyId: passportSigner.keyId,
      familyId: 'tenant-1-action-passport-family',
      purpose: 'action-passport',
      environment: 'test',
      tenantId: 'tenant-1',
      notBefore: new Date(now.getTime() - 60_000).toISOString(),
      notAfter: new Date(now.getTime() + 365 * 24 * 60 * 60_000).toISOString(),
    });
    sessionSigningSecret = randomBytes(48).toString('base64url');
    bootstrapCreatedAt = now.toISOString();
    keyStore.addIdentity(passportSigner, now);
    keyStore.setSecret('passport.key-id', passportSigner.keyId, now);
    keyStore.setSecret('session.hmac', sessionSigningSecret, now);
    keyStore.setSecret('pilot.bootstrap-created-at', bootstrapCreatedAt, now);
    keyStore.setTrustSnapshot(keyRegistry.snapshot(now), now);
  } else {
    keyStore = EncryptedKeyStore.open(keyStorePath, passphrase);
    const keyId = keyStore.getSecret('passport.key-id');
    passportSigner = keyStore.getIdentity(keyId);
    sessionSigningSecret = keyStore.getSecret('session.hmac');
    bootstrapCreatedAt = keyStore.getSecret('pilot.bootstrap-created-at');
    keyRegistry = KeyLifecycleRegistry.fromSnapshot(keyStore.getTrustSnapshot());
  }

  const identityStore = new PrivateIdentityStore(join(absolute, 'identity', 'directory.json'));
  identityStore.bootstrap({
    tenant: { tenantId: 'tenant-1', displayName: 'Private Pilot Tenant', status: 'ACTIVE', createdAt: bootstrapCreatedAt },
    users: [
      { userId: 'operator-1', displayName: 'Pilot Operator', status: 'ACTIVE', createdAt: bootstrapCreatedAt },
      { userId: 'reviewer-1', displayName: 'Independent Reviewer', status: 'ACTIVE', createdAt: bootstrapCreatedAt },
      { userId: 'admin-1', displayName: 'Pilot Administrator', status: 'ACTIVE', createdAt: bootstrapCreatedAt },
    ],
    memberships: [
      { tenantId: 'tenant-1', userId: 'operator-1', roles: ['operator'], status: 'ACTIVE' },
      { tenantId: 'tenant-1', userId: 'reviewer-1', roles: ['reviewer'], status: 'ACTIVE' },
      { tenantId: 'tenant-1', userId: 'admin-1', roles: ['admin', 'auditor'], status: 'ACTIVE' },
    ],
  }, now);

  return {
    root: absolute,
    keyStore,
    identityStore,
    passportSigner,
    keyRegistry,
    sessionSigningSecret,
    trustRoot: keyStore.getTrustSnapshot().root,
  };
}

export function privatePilotContextFingerprint(context: PrivatePilotContext): string {
  return sha256({
    root: context.root,
    signer: context.passportSigner.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    trustRoot: context.trustRoot,
  });
}
