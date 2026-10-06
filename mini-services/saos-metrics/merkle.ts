/**
 * SAOS-METRICS / MERKLE MODULE — R218-c, "Step 3: Merkle event anchoring"
 *
 * Purpose: the immortal-memory layer. events.jsonl is append-only but LOCAL —
 * the sandbox is ephemeral. This module folds the event stream into a
 * cumulative SHA-256 hash chain of per-batch Merkle roots and records it to
 * memory/merkle-events.json, which the custodian's EXISTING sweep commits and
 * its EXISTING hourly tip anchor witnesses on Steem. Trust path:
 *   event bytes -> batch root -> chain root -> record file -> signed commit
 *   -> tip anchor (custom_json, op 18) on the chain.
 *
 * KEY LAW: this organ holds NO keys and NEVER broadcasts. The custodian stays
 * the only signer; this module only does math + verification.
 *
 * Algo (documented, deterministic):
 *   leaf        = sha256(raw line bytes, without trailing \n)
 *   batchRoot   = binary Merkle over leaves, odd node promoted
 *   chainRoot_n = sha256(utf8(chainRoot_{n-1} + ":" + batchRoot_n)),
 *                 chainRoot_0 = sha256(utf8("saos-merkle-genesis:v1"))
 *
 * Local verification: recompute the last KEEP_BATCHES batch roots straight
 * from events.jsonl and refold the chain — detects tail truncation, line
 * edits, and reordering. Long-term binding is git's job: every record
 * version is signed-committed and chain-witnessed (per-version anchors).
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

export const EVENTS = "/home/z/my-project/mini-services/saos-engine/state/events.jsonl";
export const RECORD = "/home/z/my-project/memory/merkle-events.json";
const KEEP_BATCHES = 48; /* ~24h of local verifiability at 30-min batches */
const GENESIS_SEED = "saos-merkle-genesis:v1";

export type Batch = { i: number; from: number; to: number; root: string; chainAfter: string; at: string };
export type MerkleRecord = {
  algo: "sha256-line-merkle+chain:v1";
  updatedAt: string;
  genesisAt: string;
  batchIndex: number;
  chainRoot: string;
  chainBaseRoot: string; /* chainRoot before the OLDEST kept batch */
  baseOffset: number; /* anchoredOffset before the OLDEST kept batch */
  anchoredOffset: number;
  batches: Batch[];
};

const shaHex = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const genesisRoot = () => shaHex(Buffer.from(GENESIS_SEED, "utf8"));

function readLines(): string[] {
  /* events.jsonl is append-only; torn tail line (no \n yet) is excluded */
  try {
    const raw = fs.readFileSync(EVENTS, "utf8");
    const lines = raw.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines;
  } catch {
    return [];
  }
}

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return shaHex(Buffer.alloc(0));
  let level = leaves;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? shaHex(Buffer.from(level[i] + level[i + 1], "utf8")) : level[i]);
    }
    level = next;
  }
  return level[0];
}

export function loadRecord(): MerkleRecord | null {
  try {
    const r = JSON.parse(fs.readFileSync(RECORD, "utf8")) as MerkleRecord;
    return r?.algo === "sha256-line-merkle+chain:v1" ? r : null;
  } catch {
    return null;
  }
}

function saveRecord(rec: MerkleRecord) {
  fs.mkdirSync(path.dirname(RECORD), { recursive: true });
  const tmp = RECORD + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n");
  fs.renameSync(tmp, RECORD); /* atomic — custodian sweep never sees a torn file */
}

function batchRootFrom(lines: string[], from: number, to: number): string | null {
  if (to > lines.length) return null; /* truncated */
  return merkleRoot(lines.slice(from, to).map((l) => shaHex(Buffer.from(l, "utf8"))));
}

/* ---------- anchor a new batch (timer or force) ---------- */
export function anchorNewBatch(): { ran: boolean; reason?: string; record: MerkleRecord | null } {
  const lines = readLines();
  const total = lines.length;
  const prev = loadRecord();
  const from = prev ? prev.anchoredOffset : 0;
  if (total <= from) return { ran: false, reason: "no-new-events", record: prev };

  const now = new Date().toISOString();
  const batchRoot = batchRootFrom(lines, from, total);
  if (batchRoot === null) return { ran: false, reason: "file-shrunk", record: prev };

  const prevChain = prev?.chainRoot ?? genesisRoot();
  const chainRoot = shaHex(Buffer.from(prevChain + ":" + batchRoot, "utf8"));

  const rec: MerkleRecord = prev ?? {
    algo: "sha256-line-merkle+chain:v1",
    updatedAt: now,
    genesisAt: now,
    batchIndex: 0,
    chainRoot: genesisRoot(),
    chainBaseRoot: genesisRoot(),
    baseOffset: 0,
    anchoredOffset: 0,
    batches: [],
  };
  rec.batchIndex += 1;
  rec.batches.push({ i: rec.batchIndex, from, to: total, root: batchRoot, chainAfter: chainRoot, at: now });
  rec.chainRoot = chainRoot;
  rec.anchoredOffset = total;
  rec.updatedAt = now;

  /* trim window: the successor base is the cumulative chain AFTER the last
   * dropped batch — carried by the dropped entry itself (chainAfter), so
   * refold verification stays exact, not approximate */
  if (rec.batches.length > KEEP_BATCHES) {
    const drop = rec.batches.length - KEEP_BATCHES;
    const dropped = rec.batches.slice(0, drop);
    rec.batches = rec.batches.slice(drop);
    rec.baseOffset = rec.batches[0].from;
    rec.chainBaseRoot = dropped[dropped.length - 1].chainAfter;
  }
  saveRecord(rec);
  return { ran: true, record: rec };
}

/* ---------- local verification (recompute from raw bytes) ---------- */
export type VerifyResult = {
  verdict: "VERIFIED" | "BROKEN" | "NO-RECORD";
  checked: number;
  detail: string;
  record: MerkleRecord | null;
  coverage: { totalEvents: number; anchored: number; pending: number };
};

export function verifyChain(): VerifyResult {
  const rec = loadRecord();
  const lines = readLines();
  const total = lines.length;
  const coverage = {
    totalEvents: total,
    anchored: rec?.anchoredOffset ?? 0,
    pending: Math.max(0, total - (rec?.anchoredOffset ?? 0)),
  };
  if (!rec) return { verdict: "NO-RECORD", checked: 0, detail: "אין רשומת-עיגון עדיין", record: null, coverage };
  if (total < rec.anchoredOffset)
    return { verdict: "BROKEN", checked: 0, detail: `קיצוץ-זנב זוהה: הקובץ ${total} קצר מהעוגן ${rec.anchoredOffset}`, record: rec, coverage };

  /* recompute each kept batch root from raw bytes, refold step-by-step and
   * check every cumulative value against the batch's own chainAfter */
  let chain = rec.chainBaseRoot;
  for (const b of rec.batches) {
    const r = batchRootFrom(lines, b.from, b.to);
    if (r === null)
      return { verdict: "BROKEN", checked: b.i, detail: `גבול-אצווה ${b.i} מעבר לקובץ — קיצוץ`, record: rec, coverage };
    if (r !== b.root)
      return { verdict: "BROKEN", checked: b.i, detail: `אצווה ${b.i} שונתה (root mismatch) — עריכה או סדר-שונה`, record: rec, coverage };
    chain = shaHex(Buffer.from(chain + ":" + r, "utf8"));
    if (chain !== b.chainAfter)
      return { verdict: "BROKEN", checked: b.i, detail: `השרשרת חורגת באצווה ${b.i} — אצווה חסרה/נוספה`, record: rec, coverage };
  }
  if (chain !== rec.chainRoot)
    return { verdict: "BROKEN", checked: rec.batches.length, detail: "שרשרת אינה מתקפלת ל-chainRoot הרשום", record: rec, coverage };

  return {
    verdict: "VERIFIED",
    checked: rec.batches.length,
    detail: `${rec.batches.length} אצוות אומתו מהבייטים הגולמיים · כיסוי ${rec.anchoredOffset}/${total} אירועים`,
    record: rec,
    coverage,
  };
}

export function merkleSnapshot() {
  const v = verifyChain();
  return {
    ok: true,
    algo: "sha256-line-merkle+chain:v1",
    verdict: v.verdict,
    detail: v.detail,
    checkedBatches: v.checked,
    coverage: v.coverage,
    record: v.record
      ? {
          genesisAt: v.record.genesisAt,
          updatedAt: v.record.updatedAt,
          batchIndex: v.record.batchIndex,
          chainRoot: v.record.chainRoot,
          anchoredOffset: v.record.anchoredOffset,
          batchesKept: v.record.batches.length,
          lastBatch: v.record.batches[v.record.batches.length - 1] ?? null,
        }
      : null,
    trustPath: "event-bytes → batch-root → chain-root → memory/merkle-events.json → signed commit → hourly tip anchor (Steem)",
  };
}
