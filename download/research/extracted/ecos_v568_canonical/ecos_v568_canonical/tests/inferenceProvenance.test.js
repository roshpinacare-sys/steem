import { describe, it, expect } from 'vitest';
import {
  sealInference,
  verifyInferenceProof,
  attachProvenanceToPayload,
} from '../lib/inferenceProvenance.js';

const SAMPLE = {
  traceId:    'trace::abc123',
  prompt:     'Is this transaction valid? Amount: $50.00',
  output:     '{"result":"APPROVE","confidence":0.91}',
  model:      'claude-sonnet-4-20250514',
  confidence: 0.91,
};

describe('sealInference', () => {
  it('produces a proof with required fields', () => {
    const proof = sealInference(SAMPLE);
    expect(proof.traceId).toBe(SAMPLE.traceId);
    expect(proof.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(proof.bindingHash).toMatch(/^[a-f0-9]{64}$/);
    expect(proof.model).toBe(SAMPLE.model);
    expect(proof.confidence).toBe(SAMPLE.confidence);
  });

  it('is deterministic for same inputs (same ts required)', () => {
    // Note: ts is set internally at call time, so two calls produce different
    // binding hashes (by design — prevents pre-computation attacks).
    // Verify inputHash (prompt-only) is stable:
    const p1 = sealInference(SAMPLE);
    const p2 = sealInference({ ...SAMPLE });
    expect(p1.inputHash).toBe(p2.inputHash); // same prompt → same inputHash
  });

  it('different prompts produce different inputHash', () => {
    const p1 = sealInference({ ...SAMPLE, prompt: 'prompt A' });
    const p2 = sealInference({ ...SAMPLE, prompt: 'prompt B' });
    expect(p1.inputHash).not.toBe(p2.inputHash);
  });

  it('throws without traceId', () => {
    expect(() => sealInference({ ...SAMPLE, traceId: undefined })).toThrow('traceId');
  });
});

describe('verifyInferenceProof', () => {
  it('verifies a valid proof', () => {
    const proof = sealInference(SAMPLE);
    const result = verifyInferenceProof(proof, { prompt: SAMPLE.prompt, output: SAMPLE.output });
    expect(result.ok).toBe(true);
  });

  it('fails with wrong prompt', () => {
    const proof = sealInference(SAMPLE);
    const result = verifyInferenceProof(proof, { prompt: 'wrong prompt', output: SAMPLE.output });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/inputHash/);
  });

  it('fails with wrong output', () => {
    const proof = sealInference(SAMPLE);
    const result = verifyInferenceProof(proof, { prompt: SAMPLE.prompt, output: 'tampered output' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/bindingHash/);
  });

  it('fails with missing proof fields', () => {
    const result = verifyInferenceProof({}, { prompt: SAMPLE.prompt, output: SAMPLE.output });
    expect(result.ok).toBe(false);
  });
});

describe('attachProvenanceToPayload', () => {
  it('merges proof into payload without mutation', () => {
    const proof   = sealInference(SAMPLE);
    const payload = { missionId: 'mission_1', amount: 5000n.toString() };
    const result  = attachProvenanceToPayload(payload, proof);
    expect(result.missionId).toBe('mission_1');
    expect(result.inferenceProvenance).toBe(proof);
    expect(payload.inferenceProvenance).toBeUndefined(); // original untouched
  });
});
