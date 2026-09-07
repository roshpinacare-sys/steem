/**
 * lib/transparency-log/pg-transparency-log-store.ts — PgTransparencyLogStore.
 *
 * PostgreSQL-backed TransparencyLog. Persists leaves and roots per-tenant,
 * rebuilds Merkle trees on read, and supports offline inclusion-proof
 * verification.
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. Cross-tenant getProof/currentRoot → null.
 *
 * SCHEMA
 * ------
 * Table: transparency_leaves
 *   tenant_id  TEXT
 *   leaf_hash  TEXT
 *   leaf_index INTEGER
 *   receipt_id TEXT  — nullable; maps to ExecutionReceipt.intentId when supplied
 *   created_at TEXT  — ISO-8601
 *
 * Table: transparency_roots
 *   tenant_id  TEXT
 *   root_hash  TEXT
 *   leaf_count INTEGER
 *   anchored_at TEXT — ISO-8601
 *
 * InMemoryPool limitations honoured:
 *   • No RETURNING, no ON CONFLICT, no COUNT(*), no JOINs, no JSONB.
 *   • init() creates both tables idempotently (IF NOT EXISTS).
 */

import type { DbPool } from "../db/types.ts";
import type { AuditRecord } from "../orchestrator/types.ts";
import type { ExecutionReceipt } from "../adapter/agent-adapter.ts";
import { buildMerkleTree, verifyInclusionProof } from "./merkle-tree.ts";
import type { AnchoredRoot, MerkleProof, ProofResult, TransparencyLog } from "./types.ts";
import { anchorReceipt, anchorAuditRecord, TransparencyLogError } from "./receipt-anchor.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_LEAVES_TABLE = `
  CREATE TABLE IF NOT EXISTS transparency_leaves (
    tenant_id  TEXT,
    leaf_hash  TEXT,
    leaf_index INTEGER,
    receipt_id TEXT,
    created_at TEXT
  )
`;

const CREATE_ROOTS_TABLE = `
  CREATE TABLE IF NOT EXISTS transparency_roots (
    tenant_id   TEXT,
    root_hash   TEXT,
    leaf_count  INTEGER,
    anchored_at TEXT
  )
`;

// ─── Row shapes ───────────────────────────────────────────────────────────────

type LeafRow = {
  tenant_id: string;
  leaf_hash: string;
  leaf_index: number;
  receipt_id: string;
  created_at: string;
};

type RootRow = {
  tenant_id: string;
  root_hash: string;
  leaf_count: number;
  anchored_at: string;
};

// ─── PgTransparencyLogStore ─────────────────────────────────────────────────

export class PgTransparencyLogStore implements TransparencyLog {
  private readonly pool: DbPool;

  constructor(pool: DbPool) {
    this.pool = pool;
  }

  async init(): Promise<void> {
    await this.pool.query(CREATE_LEAVES_TABLE, []);
    await this.pool.query(CREATE_ROOTS_TABLE, []);
  }

  async appendReceipt(tenantId: string, receipt: ExecutionReceipt, receiptId?: string): Promise<number> {
    if (!tenantId) throw new TransparencyLogError("MISSING_TENANT", "tenantId required");
    const leaf = anchorReceipt(receipt);
    const index = await this.nextLeafIndex(tenantId);
    await this.pool.query(
      "INSERT INTO transparency_leaves (tenant_id, leaf_hash, leaf_index, receipt_id, created_at) VALUES ($1, $2, $3, $4, $5)",
      [tenantId, leaf, index, receiptId ?? "", new Date().toISOString()],
    );
    // Rebuild root every 8 leaves (same default as InMemoryTransparencyLog)
    const count = index + 1;
    if (count % 8 === 0) {
      await this.rebuildAndStoreRoot(tenantId, count);
    }
    return index;
  }

  async appendAuditRecord(tenantId: string, record: AuditRecord): Promise<number> {
    if (!tenantId) throw new TransparencyLogError("MISSING_TENANT", "tenantId required");
    const leaf = anchorAuditRecord(record);
    const index = await this.nextLeafIndex(tenantId);
    await this.pool.query(
      "INSERT INTO transparency_leaves (tenant_id, leaf_hash, leaf_index, receipt_id, created_at) VALUES ($1, $2, $3, $4, $5)",
      [tenantId, leaf, index, "", new Date().toISOString()],
    );
    const count = index + 1;
    if (count % 8 === 0) {
      await this.rebuildAndStoreRoot(tenantId, count);
    }
    return index;
  }

  async finalize(tenantId: string): Promise<AnchoredRoot | null> {
    const count = await this.leafCount(tenantId);
    if (count === 0) return null;
    return this.rebuildAndStoreRoot(tenantId, count);
  }

  async currentRoot(tenantId: string): Promise<AnchoredRoot | null> {
    const res = await this.pool.query<RootRow>(
      "SELECT root_hash, leaf_count, anchored_at FROM transparency_roots WHERE tenant_id = $1 ORDER BY anchored_at DESC LIMIT 1",
      [tenantId],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      root: row.root_hash,
      leafCount: row.leaf_count,
      anchoredAt: row.anchored_at,
    };
  }

  async getRoots(tenantId: string): Promise<AnchoredRoot[]> {
    const res = await this.pool.query<RootRow>(
      "SELECT root_hash, leaf_count, anchored_at FROM transparency_roots WHERE tenant_id = $1 ORDER BY anchored_at ASC",
      [tenantId],
    );
    return res.rows.map((row) => ({
      root: row.root_hash,
      leafCount: row.leaf_count,
      anchoredAt: row.anchored_at,
    }));
  }

  async leafCount(tenantId: string): Promise<number> {
    // InMemoryPool does not support COUNT(*) — fetch leaf_hashes and count rows.
    const res = await this.pool.query<{ leaf_hash: string }>(
      "SELECT leaf_hash FROM transparency_leaves WHERE tenant_id = $1",
      [tenantId],
    );
    return res.rows.length;
  }

  async getProof(tenantId: string, leafIndex: number): Promise<MerkleProof | null> {
    const leaves = await this.getLeafHashes(tenantId);
    if (leafIndex < 0 || leafIndex >= leaves.length) return null;
    const { proofs } = buildMerkleTree(leaves);
    return proofs[leafIndex] ?? null;
  }

  async getProofByReceiptId(tenantId: string, receiptId: string): Promise<ProofResult | null> {
    const res = await this.pool.query<LeafRow>(
      "SELECT leaf_hash, leaf_index FROM transparency_leaves WHERE tenant_id = $1 AND receipt_id = $2 LIMIT 1",
      [tenantId, receiptId],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    const leafIndex = typeof row.leaf_index === "string" ? parseInt(row.leaf_index, 10) : Number(row.leaf_index);
    const proof = await this.getProof(tenantId, leafIndex);
    if (!proof) return null;
    const root = await this.currentRoot(tenantId);
    if (!root) return null;
    return { proof, root, leafIndex };
  }

  async verifyReceipt(tenantId: string, receipt: ExecutionReceipt): Promise<boolean> {
    const root = await this.currentRoot(tenantId);
    if (!root) return false;
    const leaf = anchorReceipt(receipt);
    // Efficiency: ask the DB for this leaf's own row instead of fetching every
    // leaf the tenant has ever anchored and scanning it in JS (indexOf was
    // O(n) over an append-only, ever-growing table).
    const idx = await this.findLeafIndex(tenantId, leaf);
    if (idx === null) return false;
    const proof = await this.getProof(tenantId, idx);
    if (!proof) return false;
    return verifyInclusionProof(leaf, root.root, proof);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private async nextLeafIndex(tenantId: string): Promise<number> {
    const count = await this.leafCount(tenantId);
    return count;
  }

  private async getLeafHashes(tenantId: string): Promise<string[]> {
    const res = await this.pool.query<LeafRow>(
      "SELECT leaf_hash FROM transparency_leaves WHERE tenant_id = $1 ORDER BY leaf_index ASC",
      [tenantId],
    );
    return res.rows.map((r) => r.leaf_hash);
  }

  /** First leaf_index for a given (tenantId, leaf_hash) pair, or null if absent. */
  private async findLeafIndex(tenantId: string, leafHash: string): Promise<number | null> {
    const res = await this.pool.query<{ leaf_index: number | string }>(
      "SELECT leaf_index FROM transparency_leaves WHERE tenant_id = $1 AND leaf_hash = $2 ORDER BY leaf_index ASC LIMIT 1",
      [tenantId, leafHash],
    );
    if (res.rows.length === 0) return null;
    const raw = res.rows[0].leaf_index;
    return typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  }

  /**
   * Consistency proof for `tenantId` between `oldSize` leaves and the current
   * full leaf list. Fetches all leaves from the DB and delegates to the pure
   * `buildConsistencyProof` helper. Returns null if the tenant has no leaves or
   * oldSize is out of [1, currentLeafCount].
   */
  async getConsistencyProof(tenantId: string, oldSize: number): Promise<ConsistencyProof | null> {
    const leaves = await this.getLeafHashes(tenantId);
    if (leaves.length === 0) return null;
    if (!Number.isInteger(oldSize) || oldSize < 1 || oldSize > leaves.length) return null;
    const { buildConsistencyProof } = await import("./consistency-proof.ts");
    return buildConsistencyProof(leaves, oldSize);
  }

  private async rebuildAndStoreRoot(tenantId: string, leafCount: number): Promise<AnchoredRoot> {
    const leaves = await this.getLeafHashes(tenantId);
    const { root } = buildMerkleTree(leaves);
    const anchoredRoot: AnchoredRoot = {
      root,
      leafCount,
      anchoredAt: new Date().toISOString(),
    };
    await this.pool.query(
      "INSERT INTO transparency_roots (tenant_id, root_hash, leaf_count, anchored_at) VALUES ($1, $2, $3, $4)",
      [tenantId, root, leafCount, anchoredRoot.anchoredAt],
    );
    return anchoredRoot;
  }
}
