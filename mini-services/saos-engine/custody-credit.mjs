/**
 * custody-credit.mjs — W17 · THE CUSTODY-CREDIT READER + BACKING-FLOOR GATE.
 *
 * The wrapper that turns the PURE law (lib.mjs backingFloorLaw) into the
 * enforced gate at every custody sell-broadcast site (daily.mjs ladders ·
 * dexflow.mjs trips/completions · hypergrid.mjs grid creates):
 *   1. reads state/custody-credit.json (the outstanding CSTEEM/CSBD credits —
 *      seeded from the T27 live measurement, owner-approved via the T29 spec)
 *   2. calls the pure law with the live measured balance from the call site
 *   3. journals every REFUSAL to state/backing-floor.jsonl — deduped to one
 *      row per (asset+verdict) per 10 minutes (the volume layers tick every
 *      few seconds; the journal must stay readable, the verdicts never lost)
 * Fail-closed: an unreadable custody state REFUSES (the MONEYGATE family) —
 * the deficit may never be deepened by an unmeasured gate.
 * Zero secrets: verdicts and numbers only.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { backingFloorLaw } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const CREDIT_FILE = path.join(STATE, "custody-credit.json");
const JOURNAL = path.join(STATE, "backing-floor.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

const lastJournalAt = new Map();
const JOURNAL_DEDUP_MS = 10 * 60 * 1000;

function journalRefusal(verdict) {
  const key = `${verdict.detail?.asset ?? "?"}:${verdict.verdict}`;
  const t = Date.now();
  if (t - (lastJournalAt.get(key) ?? 0) < JOURNAL_DEDUP_MS) return;
  lastJournalAt.set(key, t);
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.appendFileSync(JOURNAL, JSON.stringify({ at: new Date().toISOString(), source: "backing-floor-gate", ...verdict }) + "\n");
  } catch { /* journal gap never blocks the gate — the verdict itself is the law */ }
}

/** Outstanding credit for an asset (CSTEEM/CSBD) — fail-closed on unreadable state. */
export function outstandingFor(asset) {
  const c = readJson(CREDIT_FILE, null);
  if (!c || typeof c.outstanding !== "object") return { ok: false, why: "custody-credit.json unreadable" };
  const key = asset === "STEEM" ? "CSTEEM" : asset === "SBD" ? "CSBD" : null;
  if (!key) return { ok: false, why: "unknown-asset" };
  const v = Number(c.outstanding[key]);
  return Number.isFinite(v) ? { ok: true, outstanding: v } : { ok: false, why: `outstanding.${key} not finite` };
}

/** THE GATE — call before every custody sell broadcast.
 * allow:false ⇒ the caller must NOT broadcast that sale (the refusal is
 * journaled here, deduped). Verdicts: BACKING-FLOOR-OK · BACKING-FLOOR-REFUSED ·
 * OVERRIDE-RECORDED (explicit owner order ref) · CUSTODY-STATE-UNREADABLE ·
 * MEASUREMENT-GAP · UNKNOWN-ASSET. */
export function backingFloorGate(asset, saleAmount, measuredAvailable, overrideRef = null) {
  const o = outstandingFor(asset);
  if (!o.ok) {
    const verdict = { allow: false, verdict: "CUSTODY-STATE-UNREADABLE", detail: { asset: asset ?? null, saleAmount, why: o.why } };
    journalRefusal(verdict);
    return verdict;
  }
  const v = backingFloorLaw(asset, saleAmount, measuredAvailable, o.outstanding, overrideRef);
  if (!v.allow) journalRefusal(v);
  return v;
}
