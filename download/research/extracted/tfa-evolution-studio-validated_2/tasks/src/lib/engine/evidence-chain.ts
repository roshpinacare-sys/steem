/**
 * TFA Evolution Studio v28 — Evidence Chain
 *
 * Defines required evidence nodes and evaluates chain completeness.
 * All release decisions flow through here.
 */

import type { EvidenceNode, EvidenceNodeKind, CycleEvidenceChain } from "@/lib/types";

export const REQUIRED_EVIDENCE_NODES: EvidenceNodeKind[] = [
  "smoke_test_exists",
  "zip_integrity_verified",
  "artifact_hash_verified",
  "manifest_version_consistent",
  "build_passed",
  "adapter_selected",
  "release_gate_passed",
  "workspace_isolated",
  "version_coherence_verified",
  "strategy_assessed",
  "arch_graph_built",
  "reality_checked",
  "playbook_updated",
  "zip_filename_verified",
  "build_verified",
  "dependency_graph_verified",
  "sla_within_budget",
  "token_budget_respected",
  "circuit_breaker_clean",
  "delta_manifest_generated",
];

export function evaluateEvidenceChain(chain: CycleEvidenceChain): {
  complete: boolean;
  passRate: number;
  missing: EvidenceNodeKind[];
  failed: EvidenceNodeKind[];
} {
  const presentKinds = new Set(chain.nodes.map((n) => n.kind));
  const missing = REQUIRED_EVIDENCE_NODES.filter((k) => !presentKinds.has(k));
  const failed = chain.nodes
    .filter((n) => n.status === "failed" || n.status === "blocked")
    .map((n) => n.kind);

  const passedCount = chain.nodes.filter((n) => n.status === "passed").length;
  const total = Math.max(chain.nodes.length, REQUIRED_EVIDENCE_NODES.length);
  const passRate = total > 0 ? passedCount / total : 0;

  return {
    complete: missing.length === 0 && chain.complete,
    passRate,
    missing,
    failed: [...new Set(failed)],
  };
}

export function createEvidenceNode(
  kind: EvidenceNodeKind,
  status: EvidenceNode["status"],
  message: string,
  metadata?: Record<string, unknown>
): EvidenceNode {
  return {
    kind,
    status,
    message,
    timestamp: new Date().toISOString(),
    metadata,
  };
}
