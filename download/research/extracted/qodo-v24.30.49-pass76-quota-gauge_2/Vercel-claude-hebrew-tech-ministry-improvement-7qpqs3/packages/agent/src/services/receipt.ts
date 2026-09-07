/**
 * receipt.ts — Verifiable Autonomy Receipts (qodo.receipt/v1).
 *
 * A receipt is a portable JSON artifact proving that an autonomous run
 * happened UNDER CONTROLS: which policy governed (sha256 of the raw trunk
 * file), what the five gates ruled, how approval was decided, what was spent
 * against which cap, the trust bond, the diff hash — anchored to the
 * hash-chained audit log. The chain and the receipt anchor each other: the
 * receipt records the chain head at issuance, then a `receipt-issued` event
 * carrying the receipt's own sha256 is appended to the chain.
 *
 * This module is BROWSER-SAFE by design (the Mission Control app imports it
 * through the `@qodo/agent` alias to verify receipts on-device): no top-level
 * node imports — hashing uses WebCrypto when available and falls back to
 * node:crypto via lazy dynamic import. File I/O lives in
 * `pipeline/receipt-emitter.ts`, not here.
 */

export const RECEIPT_SCHEMA = "qodo.receipt/v1";

export interface ReceiptGateVerdicts {
  lockCheck: boolean;
  blast: boolean;
  dom: boolean;
  shadow: boolean;
  chaos: boolean;
  test: boolean;
  contractGuard?: boolean;
  gateOpen: boolean;
}

export interface RehearsalEnvelope {
  phasesWalked: string[];
  gateOpen: boolean;
  filesPredicted: string[];
  llmPath: "simulation" | "ollama";
}

export interface AutonomyReceipt {
  schema: typeof RECEIPT_SCHEMA;
  subject: {
    owner: string;
    repo: string;
    prNumber: number;
    commitSha: string | null;
    diffSha256: string | null;
    filesTouched: string[];
  };
  run: {
    runId: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    outcome: "done" | "halted" | "failed";
  };
  controls: {
    policy: {
      source: string | null;
      sha256: string | null;
      autonomy: "full" | "mentor" | "dry-run";
      approval: "manual" | "trust" | "auto" | null;
      budgetCapCents: number | null;
    };
    approval: { mode: string; decision: string };
    gates: ReceiptGateVerdicts | null;
    budget: { capCents: number | null; spentCents: number; exceeded: boolean };
    trust: { category: string; score: number; canAutoMerge: boolean };
  };
  evidence: {
    auditHead: { seq: number; hash: string };
    auditEntries: number;
    chainValid: boolean;
  };
  rehearsal?: RehearsalEnvelope & { envelopeSha256: string };
  signature?: { alg: "HMAC-SHA256"; keyId: string; value: string };
  /**
   * Optional relay-hop lineage. Absent = this run's audit chain starts from
   * the all-zero genesis (a standalone run, unchanged prior behavior).
   * Present = this hop's audit chain was seeded with `genesis`, which MUST
   * equal `sha256(canonicalJson(parentReceipt))` for the hop immediately
   * before this one. That binds hop N's own tamper-evident chain to the
   * exact artifact hop N-1 handed over — see docs/RECEIPTS.md §
   * "Lineage across relay hops". A verifier at hop N does not need to trust
   * hop N-1's claims: it recomputes the parent's hash itself from the
   * parent receipt bytes and checks this field against that recomputation.
   */
  lineage?: {
    hopIndex: number;
    parentReceiptSha256: string | null;
    genesis: string;
  };
}

// ── Canonical JSON (receipt-only; the audit chain keeps insertion order) ────

/** Deterministic serialization: sorted object keys, no whitespace. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  const parts = keys
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`);
  return `{${parts.join(",")}}`;
}

// ── Dual-runtime hashing (WebCrypto first, node:crypto fallback) ────────────

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    return toHex(await subtle.digest("SHA-256", new TextEncoder().encode(text)));
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const k = await subtle.importKey(
      "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    return toHex(await subtle.sign("HMAC", k, new TextEncoder().encode(message)));
  }
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", key).update(message).digest("hex");
}

// ── Sign / identify ──────────────────────────────────────────────────────────

/** sha256 over the canonical form of the receipt WITHOUT its signature. */
async function receiptBodyHash(receipt: AutonomyReceipt): Promise<string> {
  const { signature: _sig, ...body } = receipt;
  return sha256Hex(canonicalJson(body));
}

/** sha256 identifying the FULL receipt (incl. signature) — what the audit
 * chain's `receipt-issued` event records. Whitespace-independent. */
export async function receiptSha256(receipt: AutonomyReceipt): Promise<string> {
  return sha256Hex(canonicalJson(receipt));
}

export async function signReceipt(receipt: AutonomyReceipt, key: string): Promise<AutonomyReceipt> {
  const value = await hmacSha256Hex(key, await receiptBodyHash(receipt));
  const keyId = (await sha256Hex(key)).slice(0, 8);
  return { ...receipt, signature: { alg: "HMAC-SHA256", keyId, value } };
}

// ── Verification ─────────────────────────────────────────────────────────────

export interface ReceiptCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ReceiptVerification {
  valid: boolean;
  checks: ReceiptCheck[];
}

interface AuditEntryShape {
  seq: number;
  timestamp: string;
  event: string;
  actor: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

/** Re-hash an audit entry exactly as audit-log.ts wrote it (writer key order). */
async function auditEntryHash(e: AuditEntryShape): Promise<string> {
  const partial = {
    seq: e.seq, timestamp: e.timestamp, event: e.event, actor: e.actor,
    payload: e.payload, prevHash: e.prevHash,
  };
  return sha256Hex(JSON.stringify(partial));
}

const GENESIS = "0".repeat(64);
const GATE_KEYS = ["lockCheck", "blast", "dom", "shadow", "chaos", "test"] as const;

/**
 * Verify a receipt. Offline, dependency-free.
 *  - `key`         → checks the HMAC signature (absence of key downgrades the
 *                    signature check to informational).
 *  - `auditNdjson` → full chain walk + head match + receipt-issued anchoring.
 */
export async function verifyReceipt(
  receipt: AutonomyReceipt,
  opts: { key?: string; auditNdjson?: string; parentReceipt?: AutonomyReceipt } = {},
): Promise<ReceiptVerification> {
  const checks: ReceiptCheck[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // 1. Schema
  const schemaOk = receipt?.schema === RECEIPT_SCHEMA
    && !!receipt.subject && !!receipt.run && !!receipt.controls && !!receipt.evidence
    && ["done", "halted", "failed"].includes(receipt.run?.outcome as string);
  push("schema", schemaOk, schemaOk ? RECEIPT_SCHEMA : `unexpected schema/shape (${String(receipt?.schema)})`);
  if (!schemaOk) return { valid: false, checks };

  // 2. Internal consistency — gates
  const g = receipt.controls.gates;
  if (g) {
    const verdicts = [...GATE_KEYS.map((k) => g[k]), ...(g.contractGuard === undefined ? [] : [g.contractGuard])];
    const allPass = verdicts.every(Boolean);
    const consistent = g.gateOpen === allPass;
    push("gates-consistent", consistent,
      consistent ? `gateOpen=${g.gateOpen} matches verdicts` : `gateOpen=${g.gateOpen} but verdicts say ${allPass}`);
  } else {
    push("gates-consistent", true, "no gate phase reached (run ended earlier)");
  }

  // 3. Internal consistency — budget
  const b = receipt.controls.budget;
  const budgetOk = b.capCents == null || b.exceeded || b.spentCents <= b.capCents;
  push("budget-consistent", budgetOk,
    budgetOk
      ? b.capCents == null ? "no cap set" : `spent ${b.spentCents}¢ within cap ${b.capCents}¢`
      : `spent ${b.spentCents}¢ exceeds cap ${b.capCents}¢ without exceeded flag`);

  // 4. Signature
  if (receipt.signature) {
    if (opts.key) {
      const expected = await hmacSha256Hex(opts.key, await receiptBodyHash(receipt));
      const keyId = (await sha256Hex(opts.key)).slice(0, 8);
      const sigOk = expected === receipt.signature.value && keyId === receipt.signature.keyId;
      push("signature", sigOk, sigOk ? `HMAC-SHA256 valid (key ${keyId})` : "signature does NOT match this key");
    } else {
      push("signature", true, `present (key ${receipt.signature.keyId}) — provide the key to check it`);
    }
  } else {
    push("signature", true, "unsigned — integrity rests on audit-chain anchoring");
  }

  // 5. Lineage — is this receipt's genesis the sha256 of the actual parent
  //    receipt it claims descent from? Independently recomputed here, never
  //    trusted from the child's say-so. Runs BEFORE the chain walk because
  //    the chain walk needs the right genesis to start from.
  let effectiveGenesis = GENESIS;
  if (receipt.lineage) {
    effectiveGenesis = receipt.lineage.genesis;
    if (opts.parentReceipt) {
      const parentHash = await receiptSha256(opts.parentReceipt);
      const ok = receipt.lineage.parentReceiptSha256 === parentHash
        && receipt.lineage.genesis === parentHash;
      push("lineage", ok,
        ok
          ? `hop ${receipt.lineage.hopIndex} anchored to parent receipt ${parentHash.slice(0, 8)}`
          : `lineage.genesis/parentReceiptSha256 does not match the recomputed parent hash ${parentHash.slice(0, 8)}`);
    } else {
      push("lineage", true, `hop ${receipt.lineage.hopIndex}, parent claimed but not supplied to re-hash — pass parentReceipt to check it`);
    }
  } else if (opts.parentReceipt) {
    push("lineage", false, "parentReceipt supplied but this receipt carries no lineage block");
  }

  // 6. Audit-chain anchoring
  if (opts.auditNdjson != null) {
    const lines = opts.auditNdjson.trim().split("\n").filter(Boolean);
    let prev = effectiveGenesis;
    let broken = -1;
    const entries: AuditEntryShape[] = [];
    for (const line of lines) {
      let e: AuditEntryShape;
      try { e = JSON.parse(line) as AuditEntryShape; } catch { broken = entries.length; break; }
      if (e.prevHash !== prev || (await auditEntryHash(e)) !== e.hash) { broken = e.seq; break; }
      prev = e.hash;
      entries.push(e);
    }
    push("audit-chain", broken === -1,
      broken === -1 ? `chain valid (${entries.length} entries)` : `chain broken at seq ${broken}`);

    if (broken === -1) {
      const head = receipt.evidence.auditHead;
      const at = entries.find((e) => e.seq === head.seq);
      const headOk = !!at && at.hash === head.hash;
      push("chain-head", headOk,
        headOk ? `receipt anchored at seq ${head.seq}` : `no matching entry at seq ${head.seq} with the recorded hash`);

      const selfHash = await receiptSha256(receipt);
      const issued = entries.some((e) => e.event === "receipt-issued" && e.payload?.receiptSha256 === selfHash);
      push("receipt-issued", issued,
        issued ? "chain records this exact receipt (mutual anchoring)" : "no receipt-issued event carries this receipt's sha256");
    }
  }

  return { valid: checks.every((c) => c.ok), checks };
}
