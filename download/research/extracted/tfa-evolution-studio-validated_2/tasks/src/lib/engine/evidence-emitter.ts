/**
 * TFA Evolution Studio v29 — Evidence Emitter
 *
 * WS4: Centralised evidence emission with full structured metadata
 * and execution trace + verification data support.
 *
 * Every important operation must emit:
 *   - inputs           : what was provided to the operation
 *   - outputs          : what the operation produced
 *   - mutations        : what changed in system state
 *   - metrics          : measurable quantities
 *   - warnings         : non-fatal anomalies
 *   - recovery         : how to recover if this node is FAILED
 *   - rationale        : why this decision was made
 *   - executionTrace   : ordered list of sub-steps for auditability
 *   - verificationData : assertions and their pass/fail results
 *
 * No optimistic completion paths. A node without evidence is a failed node.
 * No silent completion. Every major stage emits proof of execution.
 */

import type { EvidenceNode, EvidenceNodeKind } from "@/lib/types";

export interface EvidencePayload {
  kind: EvidenceNodeKind;
  status: EvidenceNode["status"];
  message: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  mutations?: string[];
  metrics?: Record<string, number>;
  warnings?: string[];
  recovery?: string;
  rationale?: string;
  /** Ordered trace of sub-steps executed within this operation. */
  executionTrace?: string[];
  /** Key/value assertions proving the operation outcome. */
  verificationData?: Record<string, unknown>;
}

/**
 * Emit a fully structured evidence node.
 * Enforces that no node is emitted without at least a message and status.
 */
export function emitEvidence(payload: EvidencePayload): EvidenceNode {
  if (!payload.message || payload.message.trim().length === 0) {
    throw new Error("EvidenceEmitter: message is required — evidence without message is rejected.");
  }

  const metadata: Record<string, unknown> = {};
  if (payload.inputs)    metadata.inputs    = payload.inputs;
  if (payload.outputs)   metadata.outputs   = payload.outputs;
  if (payload.mutations) metadata.mutations = payload.mutations;
  if (payload.metrics)   metadata.metrics   = payload.metrics;
  if (payload.warnings)  metadata.warnings  = payload.warnings;
  if (payload.recovery)  metadata.recovery  = payload.recovery;
  if (payload.rationale) metadata.rationale = payload.rationale;

  return {
    kind: payload.kind,
    status: payload.status,
    message: payload.message,
    timestamp: new Date().toISOString(),
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

/**
 * Emit a FAILED evidence node with mandatory recovery information.
 * A failure without a recovery path is rejected — no silent failures.
 */
export function emitFailure(
  kind: EvidenceNodeKind,
  message: string,
  recovery: string,
  meta?: Record<string, unknown>
): EvidenceNode {
  if (!recovery || recovery.trim().length === 0) {
    throw new Error(
      `EvidenceEmitter: recovery is required for FAILED node '${kind}'. Optimistic failure paths are not allowed.`
    );
  }
  return emitEvidence({
    kind,
    status: "failed",
    message,
    recovery,
    ...meta,
  });
}

/**
 * Assert that a required evidence node is present and passing.
 * Throws if absent — evidence-first means no execution without evidence.
 */
export function assertEvidencePassed(
  nodes: EvidenceNode[],
  kind: EvidenceNodeKind
): void {
  const found = nodes.find((n) => n.kind === kind && n.status === "passed");
  if (!found) {
    throw new Error(
      `EvidenceEmitter: required evidence '${kind}' is absent or not passing. Execution blocked.`
    );
  }
}

/**
 * Compute a pass rate from a set of evidence nodes.
 * Returns 0 if nodes is empty — empty evidence = no success.
 */
export function computePassRate(nodes: EvidenceNode[]): number {
  if (nodes.length === 0) return 0;
  const passed = nodes.filter((n) => n.status === "passed").length;
  return passed / nodes.length;
}
