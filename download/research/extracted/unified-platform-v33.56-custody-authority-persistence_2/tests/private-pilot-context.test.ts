import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openOrCreatePrivatePilotContext, privatePilotContextFingerprint } from '../src/app/private-pilot-context.js';

const passphrase = 'v20 context passphrase with sufficient entropy';
const now = new Date('2026-07-17T00:00:00Z');

test('private pilot context preserves signer, session secret and trust root across restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-context-'));
  const first = openOrCreatePrivatePilotContext(root, passphrase, now);
  const session = first.identityStore.issueSession({ userId: 'operator-1', tenantId: 'tenant-1', signingSecret: first.sessionSigningSecret, ttlMs: 3_600_000 }, now);
  const fingerprint = privatePilotContextFingerprint(first);
  const second = openOrCreatePrivatePilotContext(root, passphrase, new Date(now.getTime() + 1000));
  assert.equal(privatePilotContextFingerprint(second), fingerprint);
  assert.equal(second.sessionSigningSecret, first.sessionSigningSecret);
  assert.equal(second.trustRoot, first.trustRoot);
  assert.equal(second.identityStore.authenticate(session.token, second.sessionSigningSecret, new Date(now.getTime() + 2000)).userId, 'operator-1');
});

test('private pilot context rejects a wrong encryption passphrase', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-context-wrong-'));
  openOrCreatePrivatePilotContext(root, passphrase, now);
  assert.throws(() => openOrCreatePrivatePilotContext(root, 'wrong passphrase but still long enough', now), /keystore_decryption_failed/);
});
