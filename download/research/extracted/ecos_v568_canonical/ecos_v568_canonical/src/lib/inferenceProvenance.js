'use strict';
/**
 * ECOS Inference Provenance — V105 (Pre-work)
 * ──────────────────────────────────────────────────────────────────────────────
 * Cryptographically binds AI inference outputs to the audit chain entries
 * that consume them.
 *
 * Problem it solves:
 *   Without provenance binding, you cannot prove which AI output caused which
 *   ledger event. The audit chain records decisions but not the inference that
 *   drove them.
 *
 * How it works:
 *   1. Before calling IntelligenceRegistry.infer(), call sealInferenceInput()
 *      to hash the prompt → get an inputSeal.
 *   2. After receiving output, call sealInferenceOutput() to hash
 *      (inputSeal + output) → get an inferenceProof.
 *   3. Pass inferenceProof as provenance metadata into the audit entry that
 *      uses this inference result.
 *   4. Anyone with the original prompt + output can recompute the proof
 *      and verify it matches the audit chain entry.
 *
 * Usage:
 *   const { sealInference, verifyInferenceProof } = require('./inferenceProvenance');
 *
 *   const proof = sealInference({ traceId, prompt, output, model, confidence });
 *   auditLog.append('TASK_AUTO_FLOW', { ..., inferenceProof: proof });
 *
 *   // Later verification:
 *   const ok = verifyInferenceProof(proof, { prompt, output });
 */

const crypto = require('node:crypto');

/**
 * Seals an inference input+output pair into a tamper-evident proof object.
 *
 * @param {object} opts
 * @param {string} opts.traceId     - Unique ID for this inference (from IntelligenceRegistry trace)
 * @param {string} opts.prompt      - The full prompt sent to the model
 * @param {string} opts.output      - The raw output received from the model
 * @param {string} [opts.model]     - Model/provider identifier
 * @param {number} [opts.confidence] - Confidence score [0,1]
 * @returns {object} inferenceProof
 */
function sealInference({ traceId, prompt, output, model = 'unknown', confidence = null }) {
  if (!traceId) throw new TypeError('sealInference: traceId is required');
  if (typeof prompt !== 'string') throw new TypeError('sealInference: prompt must be a string');
  if (typeof output !== 'string') throw new TypeError('sealInference: output must be a string');

  const ts = new Date().toISOString();

  // Hash the prompt alone (allows proving what was asked without revealing output)
  const inputHash = crypto.createHash('sha256')
    .update(`prompt|${prompt}`)
    .digest('hex');

  // Hash prompt+output together (binding)
  const bindingPreimage = `${traceId}|${inputHash}|${output}|${model}|${ts}`;
  const bindingHash = crypto.createHash('sha256')
    .update(bindingPreimage)
    .digest('hex');

  return Object.freeze({
    traceId,
    inputHash,
    bindingHash,
    model,
    confidence,
    ts,
    // Metadata for human readability — not part of hash
    outputLength: output.length,
  });
}

/**
 * Verifies that a given proof matches a prompt/output pair.
 *
 * @param {object} proof    - inferenceProof from sealInference()
 * @param {object} material - { prompt: string, output: string }
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyInferenceProof(proof, { prompt, output }) {
  if (!proof || !proof.traceId || !proof.bindingHash) {
    return { ok: false, reason: 'proof missing required fields' };
  }

  const inputHash = crypto.createHash('sha256')
    .update(`prompt|${prompt}`)
    .digest('hex');

  if (inputHash !== proof.inputHash) {
    return { ok: false, reason: 'inputHash mismatch — prompt does not match proof' };
  }

  const bindingPreimage = `${proof.traceId}|${inputHash}|${output}|${proof.model}|${proof.ts}`;
  const recomputed = crypto.createHash('sha256')
    .update(bindingPreimage)
    .digest('hex');

  if (recomputed !== proof.bindingHash) {
    return { ok: false, reason: 'bindingHash mismatch — output does not match proof' };
  }

  return { ok: true };
}

/**
 * Attaches an inference proof to an existing audit payload object.
 * Convenience wrapper — does not mutate, returns new object.
 *
 * @param {object} auditPayload   - existing payload for auditLog.append()
 * @param {object} inferenceProof - from sealInference()
 * @returns {object} new payload with inferenceProvenance field added
 */
function attachProvenanceToPayload(auditPayload, inferenceProof) {
  return {
    ...auditPayload,
    inferenceProvenance: inferenceProof,
  };
}

module.exports = {
  sealInference,
  verifyInferenceProof,
  attachProvenanceToPayload,
};
