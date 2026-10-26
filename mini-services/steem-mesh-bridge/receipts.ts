// G71-2c — steem-mesh-bridge · receipts.ts
// sha256 hash-linked receipt chain (prevHash→hash) for every upstream decision —
// the same receipt language as the fleet. Tamper-evident by construction:
// any mutation of payload/kind/at/seq/hash/prevHash breaks verify() at that seq.
//
// Zero-slop law holds: clean production surface. Zero Date.now — clock is injected.
import { createHash } from "node:crypto";

export type Clock = () => number;

/** Genesis prevHash — 64 zeros. */
export const GENESIS = "0".repeat(64);

export type ReceiptKind =
  | "request"
  | "node_chosen"
  | "node_failed"
  | "failover"
  | "upstream_ok"
  | "upstream_error"
  | "cache_hit"
  | "stale_serve"
  | "breaker"
  | "broadcast_refused"
  | "broadcast_forward"
  | "all_nodes_failed"
  // G76-i — soldier voting mesh (per-soldier parallel scheduler receipts;
  // payloads carry soldier names, txids, verdicts and sanitized errors ONLY —
  // never key material).
  | "soldier_mesh_start"
  | "soldier_wound_skip"
  | "soldier_skipped"
  | "soldier_ok"
  | "soldier_fail"
  | "soldier_timeout"
  | "soldier_breaker"
  | "soldier_mesh_done";

export interface Receipt {
  seq: number;
  at: number; // epoch ms from the injected clock
  kind: ReceiptKind;
  payload: unknown;
  prevHash: string; // hex sha256 of the previous receipt
  hash: string; // hex sha256(prev|seq|at|kind|payload)
}

export interface VerifyVerdict {
  ok: boolean;
  brokenAt?: number;
  why?: string;
}

/** Canonical JSON: object keys sorted (recursively), array order preserved, types distinct. */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return "[" + value.map((item) => serialize(item)).join(",") + "]";
  }
  if (value instanceof Error) {
    return serialize({ name: value.name, message: value.message });
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(
      (k) => JSON.stringify(k) + ":" + serialize((value as Record<string, unknown>)[k]),
    );
    return "{" + parts.join(",") + "}";
  }
  // functions/symbols/undefined have no canonical form — honest refusal
  throw new TypeError("canonicalJson: unsupported value " + typeof value);
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** JSON-safe deep copy so append() can never throw on exotic payloads. */
function sanitize(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Map) return sanitize(Object.fromEntries(value));
  if (value instanceof Set) return sanitize([...value]);
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue; // dropped, like JSON.stringify semantics
      out[k] = sanitize(v);
    }
    return out;
  }
  return value;
}

export function hashReceipt(
  prevHash: string,
  seq: number,
  at: number,
  kind: string,
  payload: unknown,
): string {
  return sha256Hex(`${prevHash}|${seq}|${at}|${kind}|${canonicalJson(payload)}`);
}

/** Pure verification: walks an exported chain and re-computes every link. */
export function verifyChain(receipts: Receipt[]): VerifyVerdict {
  let prev = GENESIS;
  let expectSeq = 1;
  for (const r of receipts) {
    if (r.seq !== expectSeq) return { ok: false, brokenAt: r.seq, why: "seq gap" };
    if (r.prevHash !== prev) {
      return { ok: false, brokenAt: r.seq, why: "prevHash mismatch" };
    }
    const expectHash = hashReceipt(prev, r.seq, r.at, r.kind, r.payload);
    if (r.hash !== expectHash) {
      return { ok: false, brokenAt: r.seq, why: "hash mismatch" };
    }
    prev = r.hash;
    expectSeq++;
  }
  return { ok: true };
}

export interface ReceiptChainOptions {
  clock: Clock;
  maxInMemory?: number;
  /** Optional append-only JSONL sink (one line per receipt). Sink failures are counted, never thrown. */
  sink?: (line: string) => void;
}

export interface ReceiptHead {
  seq: number;
  head: string;
}

/**
 * In-memory hash-linked receipt chain. `recent()`/`exportAll()` hand out
 * structured copies so callers cannot mutate the internal truth.
 */
export class ReceiptChain {
  private receipts: Receipt[] = [];
  private lastHash = GENESIS;
  private nextSeq = 1;
  private readonly clock: Clock;
  private readonly maxInMemory: number;
  private readonly sink?: (line: string) => void;
  private writeFailures = 0;
  private droppedFromMemory = 0;

  constructor(opts: ReceiptChainOptions) {
    this.clock = opts.clock;
    this.maxInMemory = Math.max(1, opts.maxInMemory ?? 10_000);
    this.sink = opts.sink;
  }

  append(kind: ReceiptKind, payload: unknown): Receipt {
    const at = this.clock();
    const seq = this.nextSeq++;
    const safePayload = sanitize(payload);
    const hash = hashReceipt(this.lastHash, seq, at, kind, safePayload);
    const receipt: Receipt = { seq, at, kind, payload: safePayload, prevHash: this.lastHash, hash };
    this.lastHash = hash;
    this.receipts.push(receipt);
    if (this.receipts.length > this.maxInMemory) {
      this.receipts.shift();
      this.droppedFromMemory++;
    }
    if (this.sink) {
      try {
        this.sink(JSON.stringify(receipt));
      } catch {
        this.writeFailures++; // honest: receipt-write failure never crashes the gateway
      }
    }
    return receipt;
  }

  head(): ReceiptHead {
    if (this.receipts.length === 0) return { seq: 0, head: GENESIS };
    const last = this.receipts[this.receipts.length - 1];
    if (!last) return { seq: 0, head: GENESIS }; // noUncheckedIndexedAccess guard
    return { seq: last.seq, head: last.hash };
  }

  recent(n: number): Receipt[] {
    return this.receipts.slice(-Math.max(0, n)).map((r) => structuredClone(r));
  }

  exportAll(): Receipt[] {
    return this.receipts.map((r) => structuredClone(r));
  }

  verify(): VerifyVerdict {
    return verifyChain(this.receipts);
  }

  stats(): { seq: number; head: string; droppedFromMemory: number; writeFailures: number } {
    const h = this.head();
    return {
      seq: h.seq,
      head: h.head,
      droppedFromMemory: this.droppedFromMemory,
      writeFailures: this.writeFailures,
    };
  }
}
