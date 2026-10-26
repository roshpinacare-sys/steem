/**
 * token-ledger.mjs — W14 · THE BOOK-LAW TOKEN (הטוקן-על-פי-חוק-הספר).
 *
 * OPERATOR ORDER 2026-10-19 (verbatim): "אפשר לפתוח טוקנים וארנקים על הרשת
 * לחיילים ולסוכנים ולכל האוטונומיה — היא צריכה להשתמש בעצמה ולפתח יכולות
 * העצמה טכנולוגית".
 *
 * HONESTY LABEL (absolute): HCT-1 ("Head Corner Token 1") is an INTERNAL
 * book-law instrument on the SAOS ledger (state/token-ledger.json) —
 * an append-only, sha256-chained accounting token for agent/worker rewards,
 * mission bounties, and internal equity tracking. It is NOT a chain token
 * (no SMT/SCOT contract exists), NOT tradable anywhere, and NOT a claim on
 * anyone. The label travels with the genesis and every consumer must keep
 * it. When a real on-chain or exchange token rail exists (owner-approved),
 * the book-law ledger is the lawful pre-ledger it can migrate FROM.
 *
 * LAWS:
 *  - append-only: entries are never edited or deleted; corrections are new
 *    entries referencing the corrected id (double-entry honesty).
 *  - sha256-chained: each entry carries prevHash + its own hash — tampering
 *    breaks the chain and verifyChain() fails closed.
 *  - balances are DERIVED from entries (never stored as truth); a balance
 *    can never go negative (issue > burn by construction: no credit entries).
 *  - zero secrets; the ledger is committed truth.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const DIR = path.dirname(new URL(import.meta.url).pathname);
export const LEDGER_FILE = path.join(DIR, "state", "token-ledger.json");

export const TOKEN_META = {
  id: "HCT-1",
  name: "Head Corner Token 1",
  class: "book-law-internal-1",
  honestyLabel:
    "INTERNAL accounting instrument on the SAOS ledger — NOT a chain token, NOT tradable, NOT a claim on anyone; lawful pre-ledger for a future owner-approved token rail",
  unit: "HCT",
  createdAt: null, /* set at genesis */
  law: "append-only · sha256-chained · derived balances · never negative",
};

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function entryHash(entry, prevHash) {
  const body = JSON.stringify({ ...entry, hash: undefined, prevHash });
  return sha256(body);
}

/** Genesis: mint the full supply to the treasury pseudo-holder, then execute
 * the allocation plan as REAL transfer entries (from treasury → holders).
 * Idempotent by file presence. */
export function genesisLedger({ file = LEDGER_FILE, supply = 1_000_000, treasury = "treasury:HCT-1", allocations = [] } = {}) {
  if (fs.existsSync(file)) return { created: false, why: "ledger-exists" };
  const at = new Date().toISOString();
  const meta = { ...TOKEN_META, createdAt: at };
  const mk = (body) => {
    const entry = { ...body };
    entry.prevHash = "0".repeat(64);
    return entry;
  };
  const entries = [];
  const g = mk({
    seq: 1, at, type: "genesis-mint", to: treasury, amount: supply,
    memo: "genesis — the autonomy's self-issued book-law token (operator order 2026-10-19)",
    plan: allocations, /* the allocation PLAN rides as documentation; movement = the transfer entries below */
  });
  entries.push(g);
  let prev = g;
  for (const a of allocations) {
    const e = {
      seq: prev.seq + 1, at, type: "transfer",
      from: treasury, to: a.to, amount: a.amount, memo: a.why ?? "",
    };
    e.prevHash = prev.hash;
    e.hash = entryHash(e, e.prevHash);
    entries.push(e);
    prev = e;
  }
  /* fill hashes for the genesis (single-entry hash calc) */
  g.hash = entryHash(g, g.prevHash);
  /* recompute chain hashes in order (transfers link to genesis hash) */
  let p = "0".repeat(64);
  for (const e of entries) {
    e.prevHash = p;
    e.hash = entryHash(e, e.prevHash);
    p = e.hash;
  }
  const ledger = { schema: "token-ledger-v1", token: meta, entries };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n");
  const v = verifyChain(ledger);
  if (!v.ok) return { created: false, why: "self-verify-fail:" + v.why };
  return { created: true, supply, entries: entries.length, tipHash: v.tipHash };
}

/** Load + verify the whole chain. Fails closed on ANY tamper. */
export function loadLedger({ file = LEDGER_FILE } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, why: "ledger-absent" };
  }
  let ledger;
  try {
    ledger = JSON.parse(raw);
  } catch (e) {
    return { ok: false, why: "ledger-not-json" };
  }
  const v = verifyChain(ledger);
  if (!v.ok) return { ok: false, why: v.why };
  return { ok: true, ledger };
}

/** Verify: schema, chain linkage, per-entry hashes. */
export function verifyChain(ledger) {
  if (!ledger || ledger.schema !== "token-ledger-v1" || !Array.isArray(ledger.entries)) {
    return { ok: false, why: "schema" };
  }
  let prev = "0".repeat(64);
  for (const e of ledger.entries) {
    if (e.prevHash !== prev) return { ok: false, why: `chain-break-at-seq-${e.seq}` };
    if (e.hash !== entryHash(e, e.prevHash)) return { ok: false, why: `hash-mismatch-at-seq-${e.seq}` };
    prev = e.hash;
  }
  return { ok: true, tipHash: prev, count: ledger.entries.length };
}

/** Derived balances (the only truth). Sum of issues minus burns and transfers. */
export function balances(ledger) {
  const out = {};
  for (const e of ledger.entries) {
    if (e.type === "genesis-mint" || e.type === "issue") {
      out[e.to] = (out[e.to] ?? 0) + e.amount;
    } else if (e.type === "burn") {
      out[e.from] = (out[e.from] ?? 0) - e.amount;
    } else if (e.type === "transfer") {
      out[e.from] = (out[e.from] ?? 0) - e.amount;
      out[e.to] = (out[e.to] ?? 0) + e.amount;
    }
  }
  return out;
}

/** Append an issue/burn/transfer entry. Refuses (typed) on: unknown type,
 * negative resulting balance, missing tip linkage, unverified chain. */
export function appendEntry({ type, to = null, from = null, amount, memo = "", file = LEDGER_FILE } = {}) {
  const loaded = loadLedger({ file });
  if (!loaded.ok) return { ok: false, why: loaded.why };
  if (!["issue", "burn", "transfer"].includes(type)) return { ok: false, why: "bad-entry-type" };
  if (!(typeof amount === "number" && Number.isFinite(amount) && amount > 0)) return { ok: false, why: "bad-amount" };
  if ((type === "issue" || type === "transfer") && !to) return { ok: false, why: type + "-needs-to" };
  if ((type === "burn" || type === "transfer") && !from) return { ok: false, why: type + "-needs-from" };
  const ledger = loaded.ledger;
  const bal = balances(ledger);
  if ((type === "burn" || type === "transfer") && (bal[from] ?? 0) < amount) return { ok: false, why: "balance-would-go-negative" };
  const tip = ledger.entries[ledger.entries.length - 1];
  const at = new Date().toISOString();
  const entry = {
    seq: tip.seq + 1,
    at,
    type,
    to: to ?? undefined,
    from: from ?? undefined,
    amount,
    memo,
  };
  entry.prevHash = tip.hash;
  entry.hash = entryHash(entry, entry.prevHash);
  ledger.entries.push(entry);
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n");
  return { ok: true, seq: entry.seq, hash: entry.hash };
}
