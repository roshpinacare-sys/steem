/**
 * lib/transparency-log/index.ts — barrel export for the Transparency Log (Merkle anchoring).
 *
 * Public surface:
 *   • MerkleTree — buildMerkleTree, verifyInclusionProof
 *   • ReceiptAnchor — anchorReceipt, anchorAuditRecord
 *   • TransparencyLog — InMemoryTransparencyLog, PgTransparencyLogStore
 *   • All types + errors
 */

export {
  buildMerkleTree,
  verifyInclusionProof,
  MerkleTreeError,
} from "./merkle-tree.ts";

export type { MerkleProof, MerkleTreeResult } from "./merkle-tree.ts";
export type { MerkleTreeErrorCode } from "./merkle-tree.ts";

export {
  anchorReceipt,
  anchorAuditRecord,
  InMemoryTransparencyLog,
  TransparencyLogError,
} from "./receipt-anchor.ts";

export type {
  AnchoredRoot,
  ProofResult,
  TransparencyLog,
  TransparencyLogErrorCode,
} from "./types.ts";

export { PgTransparencyLogStore } from "./pg-transparency-log-store.ts";

export {
  computeRoot,
  buildConsistencyProof,
  verifyConsistencyProof,
  ConsistencyProofError,
} from "./consistency-proof.ts";

export type { ConsistencyProof, ConsistencyProofErrorCode } from "./consistency-proof.ts";

export { runConsistencyMonitor } from "./consistency-monitor.ts";
export type { MonitorResult, ConsistencyCheckable } from "./consistency-monitor.ts";

export {
  buildFederationAnchor,
  verifyFederationAnchor,
  federationAnchorSigningPayload,
  FEDERATION_ANCHOR_VERSION,
  FederationAnchorError,
} from "./federation-anchor.ts";

export type {
  FederationAnchor,
  FederationAnchorPayload,
  FederationAnchorErrorCode,
  LogEndpoint,
} from "./federation-anchor.ts";

export {
  verifyCrossLogConsistency,
  CrossLogConsistencyError,
} from "./cross-log-consistency.ts";

export type {
  CrossLogConsistencyResult,
  CrossLogConsistencyErrorCode,
} from "./cross-log-consistency.ts";

export {
  computeMeshRoot,
  buildMeshMembershipProof,
  verifyMeshMembershipProof,
  meshMemberLeaf,
  MESH_MEMBER_LEAF_VERSION,
  MeshMembershipError,
} from "./mesh-membership.ts";

export type {
  MeshMember,
  MeshMembershipProof,
  MeshMembershipErrorCode,
} from "./mesh-membership.ts";
