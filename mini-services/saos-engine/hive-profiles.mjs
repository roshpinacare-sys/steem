/**
 * hive-profiles.mjs — R262 · HIVE PROFILE SYNC (the visibility law, cross-chain).
 *
 * Operator order 2026-10-08 (verbatim intent): "צריך להחזיר להפעיל את כולם
 * על Hive לוודא החלפת פרופיל מקצועי לכולם והתאמת אישיות לכל משתמש במיוחד
 * שינוי צריך macrame ... של כולם שיהיו מקצוענים וקהילתיים".
 *
 * THE MEASURED TRUTH THAT TRIGGERED THIS MODULE (live get_accounts, R262):
 * every Hive profile still carried the PRE-doctrine identity — cashmachine
 * "Cash Machine / How To make Huge Profit With Crypto" with a shopify emoji
 * pic, haran "Haran-Follow4Follow", lsa "Psychonautic", and macrame carrying
 * a REAL PERSON'S photo with an Instagram link. siq/woq had nothing at all.
 * That is exactly what the operator ordered replaced.
 *
 * THE LAWS:
 *  · custody first: memory-only GEN-1 ACTIVE WIF verified against the live
 *    chain active authority (hiveCustody verifies posting AND active) — no
 *    verification, no broadcast.
 *  · idempotent against the chain: profileDiffers vs the LIVE metadata;
 *    nothing broadcasts when the chain already matches.
 *  · merge, never wipe: unknown top-level keys and unknown profile keys
 *    survive (mergeProfileMetadata); the persona doc OVERWRITES the old
 *    identity fields — name, about, images — and explicitly blanks
 *    location/website so no ghost of the old person survives on macrame.
 *  · the op is account_update2 (id 43 — the R255 chain-truth probe lesson:
 *    custom_json metadata updates were silently ignored by the plugin). ON
 *    HIVE THE NODE JUDGED LIVE (R262, 2026-10-08): profile writes demand
 *    ACTIVE authority ("Missing Active Authority macrame") — so this lane
 *    signs with the memory-only GEN-1 ACTIVE WIF, verified against the live
 *    active authority before anything broadcasts.
 *  · RC-gated but honest-cheap: a metadata write is a tiny op; the gate
 *    requires only META_RC_FLOOR available, and the node still judges every
 *    broadcast (txid-oracle law — a rejected op costs nothing).
 *  · macrame goes FIRST in the roster order (operator called it out).
 *  · verdicts only in state; keys never touch disk. Every receipt journaled.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcHive, HIVE_ROSTER, hiveCustody, sendAsActive } from "./hive.mjs";
import { profileDoc, profileDiffers, mergeProfileMetadata } from "./personas.mjs";
import { rcAvailable } from "./rc-pool.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "hive-profiles.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/** a metadata write must never starve a post: tiny op, tiny floor */
export const META_RC_FLOOR = 300_000_000;

/* macrame first — the operator named it; the rest follow canon order */
export const HIVE_PROFILE_ORDER = ["macrame", ...HIVE_ROSTER.filter((a) => a !== "macrame")];

/** pure: the HIVE profile fields for one account — the persona identity
 * (name/about/images) plus explicit blanks so the old-person fields
 * (macrame's Instagram, the fake locations) cannot survive the merge. */
export function hiveProfileDoc(account) {
  const doc = profileDoc(account);
  if (!doc) return null;
  return {
    name: doc.name,
    about: doc.about,
    profile_image: doc.profile_image ?? null,
    cover_image: doc.cover_image ?? null,
    location: "",
    website: "",
  };
}

/** pure: the account_update2 op — profile-only write, posting-signed on Hive */
export function hiveProfileOp(account, metadataJson, memoKey = "") {
  return ["account_update2", {
    account,
    owner: null, active: null, posting: null,
    memo_key: memoKey,
    json_metadata: "",
    posting_json_metadata: metadataJson,
    extensions: [],
  }];
}

/* ── the live pass (idempotent, custody-gated, chain-judged) ─────────────── */
export async function runHiveProfiles({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
  const custody = await hiveCustody({ now });
  const out = { at: now, custody: { verified: custody.verified, total: custody.total }, updated: [], skipped: [], deferred: [], caps: "idempotent-vs-chain · custody-gated · account_update2(43) · active-signed (the Hive node's live law) · macrame-first" };
  if (custody.verified === 0) {
    out.verdict = "HIVE-NO-CUSTODY";
    out.ms = Date.now() - t0;
    writeJson(FILE, out);
    return out;
  }
  for (const account of HIVE_PROFILE_ORDER) {
    const doc = hiveProfileDoc(account);
    if (!doc) { out.deferred.push({ account, reason: "exposure-guard-null" }); continue; }
    if (custody.results[account] !== "VERIFIED-VS-HIVE-CHAIN") {
      out.deferred.push({ account, reason: `custody:${custody.results[account]}` });
      continue;
    }
    const g = await rpcHive("condenser_api.get_accounts", [[account]]);
    const live = g?.ok ? g.result?.[0] : null;
    if (!live) { out.deferred.push({ account, reason: "chain-read-failed" }); continue; }
    const existingRaw = String(live.posting_json_metadata || live.json_metadata || "{}");
    if (!profileDiffers(existingRaw, doc)) {
      out.skipped.push({ account, reason: "chain-already-matches" });
      continue;
    }
    /* RC floor for the meta op: honest-defer a drained account (its profile
     * syncs next pass; a node rejection also maps here, fail-soft).
     * R263 PHYSICS FIX (measured live): the gate reads the REGEN-ADJUSTED
     * available mana (current + regen since last update — the same formula
     * every other rail and rc-pool use), NOT the raw current_mana. The raw
     * read deferred haran with 1.86B truly available (0.29B raw) — a
     * profile write costs a measured ~0.145B; the manabar IS the budget. */
    const rc = await rpcHive("rc_api.find_rc_accounts", { accounts: [account] });
    const a = rc?.result?.rc_accounts?.[0];
    const avail = a ? rcAvailable(a).available : 0;
    if (avail < META_RC_FLOOR) { out.deferred.push({ account, reason: "rc-low-meta-defer", avail }); continue; }
    const meta = mergeProfileMetadata(existingRaw, doc);
    const op = hiveProfileOp(account, meta, String(live.memo_key ?? ""));
    const res = await sendAsActive(account, [op]);
    const doc2 = {
      account, verdict: res.ok ? "BROADCAST" : res.verdict ?? "REJECTED",
      digest8: res.digest8 ?? null, error: res.error ? String(res.error).slice(0, 140) : null, node: res.node ?? null,
    };
    if (res.ok) {
      out.updated.push({ account, name: doc.name, digest8: doc2.digest8 });
      appendLine(path.join(STATE, "events.jsonl"), { type: "hive.profile-sync", at: now, account, name: doc.name, op: "account_update2", digest8: doc2.digest8, node: doc2.node });
    } else {
      out.deferred.push({ account, reason: doc2.verdict, error: doc2.error });
      appendLine(path.join(STATE, "events.jsonl"), { type: "hive.profile-refused", at: now, account, verdict: doc2.verdict, error: doc2.error });
    }
  }
  out.verdict = out.updated.length > 0 ? "HIVE-PROFILES-UPDATED" : out.deferred.length ? "DEFERRED" : "SYNCED";
  out.ms = Date.now() - t0;
  writeJson(FILE, out);
  return out;
}

export function hiveProfilesState() { return readJson(FILE, null); }

if (import.meta.url === `file://${process.argv[1]}`) {
  runHiveProfiles({}).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("HIVE-PROFILES-FAIL", e); process.exit(1); });
}
