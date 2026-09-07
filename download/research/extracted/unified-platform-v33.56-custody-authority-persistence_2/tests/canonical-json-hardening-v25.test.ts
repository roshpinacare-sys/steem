import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import test from 'node:test';
import { canonicalJson, generateSigningIdentity, KeyRegistry, sha256, sha256Bytes } from '../src/contracts/crypto.js';

test('canonical JSON is stable across key insertion order and structured clone', () => {
  const left = { z: [3, { b: true, a: null }], a: 'value', n: -0 };
  const right = { n: 0, a: 'value', z: [3, { a: null, b: true }] };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(canonicalJson(left), canonicalJson(structuredClone(left)));
  assert.equal(sha256(left), sha256(right));
});

test('canonical JSON rejects values silently erased or rewritten by JSON.stringify', () => {
  for (const value of [{ a: undefined }, [undefined], { n: Number.NaN }, { n: Infinity }, { n: -Infinity }, { n: 1n }, { f() {} }, { s: Symbol('x') }]) {
    assert.throws(() => canonicalJson(value), /canonical_json_/);
  }
});

test('canonical JSON rejects hidden, accessor and symbol-keyed material', () => {
  const hidden: Record<string, unknown> = { visible: 1 };
  Object.defineProperty(hidden, 'hidden', { enumerable: false, value: 2 });
  assert.throws(() => canonicalJson(hidden), /non_enumerable/);
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 });
  assert.throws(() => canonicalJson(accessor), /accessor/);
  assert.throws(() => canonicalJson({ [Symbol('secret')]: 1 }), /symbol_key/);
});

test('canonical JSON rejects cycles, class instances, sparse arrays and array side properties', () => {
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), /cycle/);
  assert.throws(() => canonicalJson(new Date()), /non_plain_object/);
  const sparse = new Array(2); sparse[1] = 1;
  assert.throws(() => canonicalJson(sparse), /sparse_array/);
  const array = [1] as number[] & { extra?: number }; array.extra = 2;
  assert.throws(() => canonicalJson(array), /array_extra_property/);
});

test('strict canonicalization prevents former undefined and non-finite collisions', () => {
  assert.throws(() => sha256({ claim: undefined }), /canonical_json_undefined/);
  assert.throws(() => sha256({ claim: Number.NaN }), /canonical_json_non_finite/);
  assert.notEqual(sha256({}), sha256({ claim: null }));
});

test('binary hashing has an explicit domain and structured hashing refuses bytes', () => {
  const bytes = Buffer.from([0, 1, 2, 255]);
  assert.throws(() => sha256(bytes), /sha256_binary_requires_sha256Bytes/);
  assert.match(sha256Bytes(bytes), /^[a-f0-9]{64}$/);
  assert.notEqual(sha256Bytes(Buffer.from('abc')), sha256('abc'));
});

test('key registry accepts the same public key reconstructed as another KeyObject', () => {
  const identity = generateSigningIdentity('issuer-1');
  const reconstructed = createPublicKey({ key: identity.publicKey.export({ format: 'der', type: 'spki' }), format: 'der', type: 'spki' });
  const registry = new KeyRegistry();
  registry.register(identity.keyId, identity.publicKey);
  registry.register(identity.keyId, reconstructed);
  assert.equal(registry.fingerprint(identity.keyId)?.length, 64);
});

test('key registry rejects a different key under an existing key identifier', () => {
  const registry = new KeyRegistry();
  registry.register('issuer-1', generateSigningIdentity('first').publicKey);
  assert.throws(() => registry.register('issuer-1', generateSigningIdentity('second').publicKey), /key_id_conflict/);
});
