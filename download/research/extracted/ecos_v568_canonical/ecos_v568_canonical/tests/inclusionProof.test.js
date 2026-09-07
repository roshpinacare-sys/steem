/**
 * inclusionProof.test.js — ECOS V122
 * Tests for Merkle Mountain Range (MMR) inclusion proofs
 */

'use strict';

const { MerkleMountainRange, _sha256 } = require('../lib/inclusionProof');

let mmr;

beforeEach(() => {
  mmr = new MerkleMountainRange();
});

describe('MerkleMountainRange — basic operations', () => {
  test('root() returns null for empty MMR', () => {
    expect(mmr.root()).toBeNull();
  });

  test('single leaf — leafIndex=0, root equals leafHash', () => {
    const { leafIndex, leafHash } = mmr.append('hello');
    expect(leafIndex).toBe(0);
    expect(typeof leafHash).toBe('string');
    expect(leafHash).toHaveLength(64);
    expect(mmr.root()).toBe(leafHash);
  });

  test('two leaves — root changes after second append', () => {
    mmr.append('leaf-0');
    const root1 = mmr.root();
    mmr.append('leaf-1');
    const root2 = mmr.root();
    expect(root1).not.toBe(root2);
    expect(root2).toHaveLength(64);
  });

  test('leafIndex increments correctly', () => {
    for (let i = 0; i < 5; i++) {
      const { leafIndex } = mmr.append(`item-${i}`);
      expect(leafIndex).toBe(i);
    }
    expect(mmr.stats().size).toBe(5);
  });

  test('deterministic — same data produces same hashes', () => {
    const mmr2 = new MerkleMountainRange();
    ['a', 'b', 'c', 'd'].forEach(d => { mmr.append(d); mmr2.append(d); });
    expect(mmr.root()).toBe(mmr2.root());
  });
});

describe('MerkleMountainRange — stats', () => {
  test('stats() reports correct size and peakCount', () => {
    mmr.append('x');
    mmr.append('y');
    mmr.append('z');
    const { size, peakCount, root } = mmr.stats();
    expect(size).toBe(3);
    expect(peakCount).toBeGreaterThan(0);
    expect(root).toHaveLength(64);
  });
});

describe('MerkleMountainRange — proof generation', () => {
  test('generateProof throws on invalid index', () => {
    mmr.append('only');
    expect(() => mmr.generateProof(-1)).toThrow(RangeError);
    expect(() => mmr.generateProof(1)).toThrow(RangeError);
  });

  test('generateProof returns correct structure for single leaf', () => {
    const { leafHash } = mmr.append('single');
    const proof = mmr.generateProof(0);
    expect(proof.leafIndex).toBe(0);
    expect(proof.leafHash).toBe(leafHash);
    expect(proof.root).toBe(mmr.root());
    expect(Array.isArray(proof.peaks)).toBe(true);
    expect(Array.isArray(proof.siblings)).toBe(true);
  });

  test('generateProof for multiple leaves returns correct root', () => {
    ['a', 'b', 'c', 'd'].forEach(d => mmr.append(d));
    for (let i = 0; i < 4; i++) {
      const proof = mmr.generateProof(i);
      expect(proof.root).toBe(mmr.root());
      expect(proof.leafIndex).toBe(i);
    }
  });
});

describe('MerkleMountainRange — serialisation', () => {
  test('toJSON / fromJSON round-trips correctly', () => {
    ['x', 'y', 'z', 'w'].forEach(d => mmr.append(d));
    const json = mmr.toJSON();
    const restored = MerkleMountainRange.fromJSON(json);
    expect(restored.root()).toBe(mmr.root());
    expect(restored.stats().size).toBe(4);
  });
});

describe('_sha256 helper', () => {
  test('produces 64-char hex for string input', () => {
    const h = _sha256('test');
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });

  test('two-arg form produces different hash', () => {
    const h1 = _sha256('aaa');
    const h2 = _sha256('aaa', 'bbb');
    expect(h1).not.toBe(h2);
  });
});
