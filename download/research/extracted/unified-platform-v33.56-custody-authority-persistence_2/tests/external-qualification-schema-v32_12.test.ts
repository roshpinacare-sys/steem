import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseStrictJsonV32_12 } from '../src/validation/strict-json-v32_12.js';

const read = (name: string) => parseStrictJsonV32_12(readFileSync(`schemas/${name}`, 'utf8')) as Record<string, unknown>;

test('verification document cannot self-supply trust keys, policy, evaluation time or filesystem observations', () => {
  const schema = read('external-qualification-verification-v32_12.schema.json');
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  const properties = schema.properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(properties).sort(), ['bundles','documentId','schemaVersion']);
  for (const forbidden of ['publicKeys','policy','evaluatedAt','observations','previouslyConsumedNonces']) assert.equal(forbidden in properties, false);
  const text = JSON.stringify(schema);
  for (const field of ['sourceDigest','artifactDigest','toolchainDigest','environmentFingerprint','policyDigest','challengeNonce','collectorStatementDigest','reviewerStatementDigest','credentialValidFrom','credentialValidUntil','previousCheckpointDigest']) assert.match(text, new RegExp(field));
});

test('separate schemas define out-of-band root trust, root-signed actor authorization and durable replay state', () => {
  const anchor = read('external-qualification-trust-anchor-v32_12.schema.json');
  const trust = read('external-qualification-trust-bundle-v32_12.schema.json');
  const state = read('external-qualification-replay-state-v32_12.schema.json');
  for (const schema of [anchor, trust, state]) assert.equal(schema.additionalProperties, false);
  const trustText = JSON.stringify(trust);
  for (const field of ['trustBundleId','purpose','authorizedKeys','allowedGateIds','organizationId','publicKey','policyDigest']) assert.match(trustText, new RegExp(field));
  const stateText = JSON.stringify(state);
  for (const field of ['generation','previousStateDigest','consumedNonces','witnessCheckpoints','checkpointSequence','stateDigest']) assert.match(stateText, new RegExp(field));
});
