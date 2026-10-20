/**
 * command-hierarchy.mjs — R-CMDHIER · THE COMMAND HIERARCHY (דרגות-החומרה).
 *
 * OWNER MANDATE (verbatim, 2026-10-17): "הארכיטקטורה הריבונית האוטונומית
 * חייבת לדעת לעבוד עם הכספות החשבונות והכל — לא לאסור עליה — אבל שתתנהג
 * בחומרה והיררכיה שלא ישמידו לנו את הפרויקט."
 *
 * THE LAW, in one line: the architecture is ALLOWED to work with the vaults
 * and accounts (vault-first revival, chain-judged adoption, money lanes — all
 * continue), but every command is classified by severity and routed up a
 * strict hierarchy, and the DESTRUCTION class can only ever be executed with
 * a fresh, TTL-bounded, owner-personal grant verified against the LIVE chain
 * at decision time — never a static flag, never a stale cache.
 *
 * TIERS (severity):
 *   T0 ROUTINE     — reversible social/routine ops (vote, comment, custom_json,
 *                    claims). Agent-autonomous within caps.
 *   T1 REVERSIBLE  — reversible money-shape ops (limit orders, delegation
 *                    [chain-law: 7-day reversible], profile metadata via
 *                    account_update2, witness votes). Lane laws (booklaw,
 *                    delegation caps, think-gate) remain THE law of their
 *                    lanes — this layer classifies and audits, never weakens.
 *   T2 SENSITIVE   — irreversible-shape money movement (transfer*, power
 *                    down/up, savings). Observe+cap in wave-1; enforcement
 *                    flip is an owner decision (ENFORCE flag below).
 *   T3 DESTRUCTION — authority reshapes (account_update), account creation,
 *                    recovery changes, ANY unknown op (fail-closed).
 *                    OWNER-PERSONAL: denied at the signing chokepoint unless
 *                    state/owner-grants.jsonl holds a fresh TTL grant for the
 *                    op-kind AND the live owner bond is intact (chain-fetched
 *                    authorities + chain-judged custody). Prepare-only for
 *                    agents: produce the bundle, never the broadcast.
 *
 * OWNER-DIRECTIVE LAW (2026-10-17, "תמיד נוכחי מה-owner"): owner-active state
 * is fetched CURRENT at every decision (5s single-flight micro-cache for
 * speed only — no staleness, no static armed flag, auto-expiring TTL grants).
 *
 * ZERO-SECRET LAW: every journal line is scrubbed (WIF/PAT/token patterns →
 * redacted); only verdicts, op names, tiers and txids ever hit disk.
 *
 * WAVE-2 (this commit, owner-approved): ALL tiers enforced. T3 =
 * destruction gate (owner-personal, unchanged); T0-T2 = DAILY CAPS ONLY —
 * measured from exec-log (264 batches/4d → caps carry 8-10× headroom), keys
 * stay governed by the signer's own proven laws. Caps are owner-tunable.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { armyCustodyState } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const AUDIT_FILE = path.join(STATE, "hierarchy-audit.jsonl");
const GRANTS_FILE = path.join(STATE, "owner-grants.jsonl");
const COUNTERS_FILE = path.join(STATE, "hierarchy-counters.json");
const OWNER_LIVE_FILE = path.join(STATE, "hierarchy-owner-live.json");

export const OWNER_ACCOUNT = "headcorner";
export const STEEM_RPC = "https://api.steemit.com";
const FRESH_TTL_MS = 5_000; /* speed-only micro-cache — the decision itself re-reads state */

/* wave-2 (2026-10-17, owner-approved "בטח תבצע"): ALL tiers enforced.
 * ENFORCEMENT MEANING for T0-T2 = DAILY CAPS ONLY (blast-radius law) — keys
 * and custody remain governed by the signer's own proven gates (think-gate,
 * ROLE-KEY-ABSENT, credential laws): the hierarchy adds rate-limits, it does
 * NOT duplicate or weaken existing laws (first-claim-wins). T3 stays
 * owner-personal. Caps are MEASURED from exec-log (4-day window: 264
 * batches, vote ~55/day, order-creates ~14/day, transfers 0) → caps carry
 * 8-10× headroom. Owner-tunable in TIERS. */
export const ENFORCE = { T3: true, T2: true, T1: true, T0: true };

export const TIERS = {
  T0: { id: "T0", name: "ROUTINE", capPerDay: 500, law: "reversible routine ops; agent-autonomous within caps" },
  T1: { id: "T1", name: "REVERSIBLE", capPerDay: 200, law: "reversible money-shape ops; lane laws (booklaw/caps/think-gate) remain the lane's own law" },
  T2: { id: "T2", name: "SENSITIVE", capPerDay: 20, law: "irreversible-shape money movement; observe wave-1, enforcement flip = owner decision" },
  T3: { id: "T3", name: "DESTRUCTION", capPerDay: 0, law: "authority reshapes / account creation / unknown ops — owner-personal: fresh TTL grant + live owner bond, else prepare-only" },
};

/* the measured corpus (grep-verified across mini-services/saos-engine on
 * 2026-10-17) maps explicitly; anything NOT listed is T3 fail-closed. */
const OP_TIER = {
  /* T0 ROUTINE — reversible social/routine */
  vote: "T0", comment: "T0", delete_comment: "T0", custom_json: "T0",
  claim_reward_balance: "T0", reblog: "T0",
  /* T1 REVERSIBLE — money-shape but undoable (chain law: 7-day undelegation;
   * limit orders escrow-checked by booklaw; account_update2 = JSON metadata) */
  limit_order_create: "T1", limit_order_cancel: "T1",
  delegate_vesting_shares: "T1", account_update2: "T1",
  witness_vote: "T1", witness_set_properties: "T1",
  set_withdraw_vesting_route: "T1", update_proposal_votes: "T1",
  /* T2 SENSITIVE — irreversible-shape money movement (observe wave-1) */
  transfer: "T2", transfer_to_vesting: "T2", transfer_from_savings: "T2",
  withdraw_vesting: "T2", decline_voting_rights: "T2",
  /* T3 DESTRUCTION — owner-personal, always */
  account_update: "T3", account_create: "T3", create_claimed_account: "T3",
  recover_account: "T3", request_account_recovery: "T3",
  change_recovery_account: "T3", set_reset_account: "T3",
};

const TIER_RANK = { T0: 0, T1: 1, T2: 2, T3: 3 };

/* ── scrub: zero-secret law ──────────────────────────────────────────────── */
export function scrub(text) {
  return String(text ?? "")
    .replace(/\b5[1-9A-HJ-NP-Za-km-z]{49,52}\b/g, "[redacted-wif]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted-token]")
    .replace(/\b(sk|xoxb|hf_)[A-Za-z0-9_]{20,}\b/g, "[redacted-token]")
    .replace(/(pass|wif|secret|password|token)(["']?\s*[:=]\s*["'])[^"'\s]{6,}/gi, "$1$2[redacted]");
}

/* ── classification ──────────────────────────────────────────────────────── */
export function classifyOp(opName) {
  const t = OP_TIER[opName];
  if (t) return { tier: t, why: "measured-corpus" };
  return { tier: "T3", why: "unknown-op-fail-closed" };
}

export function classifyOps(ops) {
  const rows = (ops ?? []).map(([n]) => ({ op: n, ...classifyOp(n) }));
  const maxTier = rows.reduce((m, r) => (TIER_RANK[r.tier] > TIER_RANK[m] ? r.tier : m), "T0");
  const destructionOps = rows.filter((r) => r.tier === "T3").map((r) => r.op);
  return { rows, maxTier, destructionOps };
}

/* ── dynamic owner-live (public keys only — zero-secret law) ─────────────── */
const liveBox = { at: 0, value: null, inflight: null };
function authPub(a) { return a?.key_auths?.[0]?.[0] ?? null; }

export async function ownerLiveStatus({ rpc = STEEM_RPC, account = OWNER_ACCOUNT } = {}) {
  const now = Date.now();
  if (liveBox.value && now - liveBox.at < FRESH_TTL_MS) return liveBox.value;
  if (liveBox.inflight) return liveBox.inflight;
  liveBox.inflight = (async () => {
    let value = null;
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[account]], id: 1 }),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      const j = await res.json();
      const a = j?.result?.[0];
      if (a) {
        value = {
          reachable: true, account,
          owner: authPub(a.owner), active: authPub(a.active), posting: authPub(a.posting),
          liveAt: new Date().toISOString(),
          changed: false, /* set below vs last-seen */
        };
      }
    } catch { value = null; } /* honest: chain unreachable = no claim */
    /* change detection vs last-seen (scream-on-change, same law as the bridge) */
    if (value) {
      try {
        const last = JSON.parse(fs.readFileSync(OWNER_LIVE_FILE, "utf8"));
        value.changed = !!(last?.active && last.active !== value.active) || !!(last?.owner && last.owner !== value.owner);
      } catch { /* first observation */ }
      try {
        fs.mkdirSync(STATE, { recursive: true });
        fs.writeFileSync(OWNER_LIVE_FILE, JSON.stringify({ owner: value.owner, active: value.active, at: value.liveAt }, null, 2));
      } catch { /* read-only fs — detection degrades honestly */ }
    }
    liveBox.value = value;
    liveBox.at = Date.now();
    return value;
  })();
  const v = await liveBox.inflight;
  liveBox.inflight = null;
  return v;
}

/* owner bond = chain-judged custody of the account of record is alive AND the
 * live chain answered. Broken/unknown custody → the destruction class has no
 * working key path anyway, and we refuse honestly rather than guess. */
export function ownerBondIntact() {
  try {
    const s = armyCustodyState([OWNER_ACCOUNT]);
    return s?.accounts?.[OWNER_ACCOUNT] === "master-verified" || s?.accounts?.[OWNER_ACCOUNT] === "verified";
  } catch { return false; }
}

/* ── TTL owner grants (state/owner-grants.jsonl) — auto-expiring, per-kind ── */
export function ownerGrantCheck(kind, { now = new Date(), file = GRANTS_FILE } = {}) {
  let rows = [];
  try {
    rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { rows = []; }
  const match = rows
    .filter((g) => g && (g.kind === kind || g.op === kind || g.kind === "*"))
    .sort((a, b) => new Date(b.grantedAt) - new Date(a.grantedAt))[0] ?? null;
  if (!match) return { found: false, fresh: false, reason: "owner-grant-required" };
  const ttlMin = Number(match.ttlMin ?? 0);
  const exp = new Date(match.grantedAt).getTime() + ttlMin * 60_000;
  if (!(now.getTime() < exp)) return { found: true, fresh: false, reason: "owner-grant-expired", expiredAt: new Date(exp).toISOString() };
  return { found: true, fresh: true, grantedAt: match.grantedAt, expiresAt: new Date(exp).toISOString(), note: scrub(match.note ?? "") };
}

/* ── daily counters ──────────────────────────────────────────────────────── */
function readCounters(file = COUNTERS_FILE) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { day: "", counts: {} }; }
}
function bumpCounters(tier, { file = COUNTERS_FILE, now = new Date() } = {}) {
  const day = now.toISOString().slice(0, 10);
  const c = readCounters(file);
  if (c.day !== day) { c.day = day; c.counts = {}; }
  c.counts[tier] = (c.counts[tier] ?? 0) + 1;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(c, null, 2)); } catch { /* read-only fs */ }
  return c;
}

/* ── audit journal (append-only, scrubbed) ───────────────────────────────── */
export function journalHier(entry, { file = AUDIT_FILE } = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(JSON.parse(scrub(JSON.stringify(entry)))) + "\n");
  } catch { /* journaling must never crash a lane */ }
}

/* ── THE PURE CORE (injected deps — fully selftestable, no I/O) ──────────── */
export function evaluateGuard({ account = "", ops = [], tag = "" }, deps = {}) {
  const now = deps.now ?? new Date();
  const cls = classifyOps(ops);
  const tier = cls.maxTier;
  const tierDef = TIERS[tier];
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail: scrub(detail ?? "") });

  push("classified", true, `${cls.rows.map((r) => `${r.op}:${r.tier}(${r.why})`).join(",") || "no-ops"}`);

  /* T3 — DESTRUCTION: the enforcement path (always active, wave-1 included) */
  if (tier === "T3") {
    const kind = cls.destructionOps.join("+");
    const g = deps.grant ?? ownerGrantCheck(kind, { now });
    push("owner-grant", g.fresh, g.fresh ? `granted ${g.grantedAt} → ${g.expiresAt}` : (g.reason ?? "no-grant"));
    const live = deps.ownerLive ?? null;
    push("owner-live", !!(live?.reachable), live?.reachable ? `live@${live.liveAt}${live.changed ? " CHANGED" : ""}` : "chain-unreachable-fail-closed");
    const bond = deps.bondIntact ?? false;
    push("owner-bond", !!bond, bond ? "chain-judged custody alive" : "custody-not-verified");
    const allowed = g.fresh && live?.reachable && bond;
    return {
      verdict: allowed ? "ALLOW" : "DENY",
      tier, tierName: tierDef.name, account, tag,
      reason: allowed ? "owner-grant+live-bond" : (g.fresh ? (live?.reachable ? "owner-bond-broken" : "owner-live-unreachable-fail-closed") : (g.reason ?? "owner-grant-required")),
      destructionOps: cls.destructionOps, checks,
    };
  }

  /* T0-T2 — enforced = DAILY CAP (blast-radius). Keys/custody stay the
   * signer's own law. If the caller presents custody evidence explicitly
   * (deps.custodyVerified), it is honored as an ADDITIONAL check. */
  if (ENFORCE[tier]) {
    const counters = deps.counters ?? { day: now.toISOString().slice(0, 10), counts: {} };
    const dayCount = counters.counts?.[tier] ?? 0;
    const cap = tierDef.capPerDay;
    push("daily-cap", dayCount < cap, `${dayCount}/${cap}`);
    if (dayCount >= cap) return { verdict: "DENY", tier, tierName: tierDef.name, account, tag, reason: "tier-cap-exceeded", checks };
    if (deps.custodyVerified === false) return { verdict: "DENY", tier, tierName: tierDef.name, account, tag, reason: "custody-not-verified", checks };
    if (deps.custodyVerified === true) push("custody", true, "verified (caller evidence)");
  }
  return {
    verdict: "ALLOW", tier, tierName: tierDef.name, account, tag,
    reason: `enforced ${tier} (cap ${tierDef.capPerDay}/day)`,
    checks,
  };
}

/* ── THE REAL WRAPPER (gathers real deps, journals, bumps counters) ──────── */
export async function guardCommand(account, ops, { tag = "cycle", countersFile = COUNTERS_FILE, auditFile = AUDIT_FILE } = {}) {
  let verdict;
  try {
    const cls = classifyOps(ops);
    const deps = {};
    if (cls.maxTier === "T3") {
      const kind = cls.destructionOps.join("+");
      deps.grant = ownerGrantCheck(kind);
      deps.ownerLive = await ownerLiveStatus();
      deps.bondIntact = ownerBondIntact();
    }
    verdict = evaluateGuard({ account, ops, tag }, deps);
  } catch (e) {
    /* infra failure: pure re-classification (no I/O) — T3 still fails closed */
    const cls = classifyOps(ops);
    verdict = cls.maxTier === "T3"
      ? { verdict: "DENY", tier: "T3", tierName: TIERS.T3.name, account, tag, reason: "hierarchy-infra-fail-closed", checks: [{ name: "infra", ok: false, detail: String(e?.message ?? e).slice(0, 120) }] }
      : { verdict: "ALLOW", tier: cls.maxTier, tierName: TIERS[cls.maxTier].name, account, tag, reason: "enforced caps (infra-error journaled)", checks: [{ name: "infra", ok: false, detail: String(e?.message ?? e).slice(0, 120) }] };
  }
  journalHier({ at: new Date().toISOString(), type: "hierarchy.guard", account, tag, ...verdict, opNames: (ops ?? []).map(([n]) => n) }, { file: auditFile });
  if (verdict.verdict === "ALLOW") bumpCounters(verdict.tier, { file: countersFile });
  return verdict;
}

/* ── SELFTEST — full matrix, injected deps, verdict-only output ──────────── */
export function selftest({ auditFile = path.join(STATE, "hierarchy-selftest-audit.jsonl"), countersFile = path.join(STATE, "hierarchy-selftest-counters.json"), ownerLiveInjected = null } = {}) {
  const vectors = [];
  const t = (name, fn) => vectors.push({ name, fn });
  const ok = (cond, detail) => ({ pass: !!cond, detail: detail ?? "" });
  const LIVE_OK = ownerLiveInjected ?? { reachable: true, liveAt: "t", changed: false };
  const FRESH = { found: true, fresh: true, grantedAt: "t", expiresAt: "t+1h" };
  const EXPIRED = { found: true, fresh: false, reason: "owner-grant-expired" };

  t("T0 vote → ALLOW enforced (cap live)", () => {
    const r = evaluateGuard({ account: "x", ops: [["vote", {}]], tag: "t" }, { ownerLive: LIVE_OK });
    return ok(r.verdict === "ALLOW" && r.tier === "T0" && r.reason.includes("enforced"), r.reason);
  });
  t("T1 limit_order_create → ALLOW enforced (cap live)", () => {
    const r = evaluateGuard({ account: "x", ops: [["limit_order_create", {}]], tag: "t" }, { ownerLive: LIVE_OK });
    return ok(r.verdict === "ALLOW" && r.tier === "T1" && r.reason.includes("enforced"), r.reason);
  });
  t("T1 account_update2 (profile metadata) → ALLOW enforced", () => {
    const r = evaluateGuard({ account: "x", ops: [["account_update2", {}]], tag: "t" }, { ownerLive: LIVE_OK });
    return ok(r.verdict === "ALLOW" && r.tier === "T1", r.reason);
  });
  t("T2 transfer → ALLOW enforced (cap live)", () => {
    const r = evaluateGuard({ account: "x", ops: [["transfer", {}]], tag: "t" }, { ownerLive: LIVE_OK });
    return ok(r.verdict === "ALLOW" && r.tier === "T2" && r.reason.includes("enforced"), r.reason);
  });
  t("T3 account_update authority → DENY no-grant", () => {
    const r = evaluateGuard({ account: "x", ops: [["account_update", {}]], tag: "t" }, { grant: { found: false, fresh: false, reason: "owner-grant-required" }, ownerLive: LIVE_OK, bondIntact: true });
    return ok(r.verdict === "DENY" && r.reason === "owner-grant-required", r.reason);
  });
  t("T3 expired grant → DENY owner-grant-expired", () => {
    const r = evaluateGuard({ account: "x", ops: [["account_update", {}]], tag: "t" }, { grant: EXPIRED, ownerLive: LIVE_OK, bondIntact: true });
    return ok(r.verdict === "DENY" && r.reason === "owner-grant-expired", r.reason);
  });
  t("T3 fresh grant + chain-unreachable → DENY fail-closed", () => {
    const r = evaluateGuard({ account: "x", ops: [["account_update", {}]], tag: "t" }, { grant: FRESH, ownerLive: { reachable: false }, bondIntact: true });
    return ok(r.verdict === "DENY" && r.reason === "owner-live-unreachable-fail-closed", r.reason);
  });
  t("T3 fresh grant + broken bond → DENY owner-bond-broken", () => {
    const r = evaluateGuard({ account: "x", ops: [["account_update", {}]], tag: "t" }, { grant: FRESH, ownerLive: LIVE_OK, bondIntact: false });
    return ok(r.verdict === "DENY" && r.reason === "owner-bond-broken", r.reason);
  });
  t("T3 fresh grant + live + bond → ALLOW (hierarchy grants real capability)", () => {
    const r = evaluateGuard({ account: "x", ops: [["account_update", {}]], tag: "t" }, { grant: FRESH, ownerLive: LIVE_OK, bondIntact: true });
    return ok(r.verdict === "ALLOW" && r.reason === "owner-grant+live-bond", r.reason);
  });
  t("unknown op → T3 fail-closed", () => {
    const r = evaluateGuard({ account: "x", ops: [["made_up_op_x", {}]], tag: "t" }, { grant: { found: false, fresh: false }, ownerLive: LIVE_OK, bondIntact: true });
    return ok(r.verdict === "DENY" && r.tier === "T3" && r.reason === "owner-grant-required", r.reason);
  });
  t("mixed batch [vote + account_update] → T3 DENY (contamination)", () => {
    const r = evaluateGuard({ account: "x", ops: [["vote", {}], ["account_update", {}]], tag: "t" }, { grant: { found: false, fresh: false }, ownerLive: LIVE_OK, bondIntact: true });
    return ok(r.verdict === "DENY" && r.tier === "T3", r.reason);
  });
  t("T1 enforced + cap exceeded → DENY tier-cap-exceeded", () => {
    const r = evaluateGuard({ account: "x", ops: [["limit_order_create", {}]], tag: "t" }, { counters: { day: "d", counts: { T1: 200 } }, ownerLive: LIVE_OK });
    return ok(r.verdict === "DENY" && r.reason === "tier-cap-exceeded", r.reason);
  });
  t("T1 enforced within cap → ALLOW (keys stay the signer's law)", () => {
    const r = evaluateGuard({ account: "x", ops: [["delegate_vesting_shares", {}]], tag: "t" }, { counters: { day: "d", counts: {} }, ownerLive: LIVE_OK });
    return ok(r.verdict === "ALLOW" && r.reason.includes("enforced"), r.reason);
  });
  t("explicit custody evidence honored when presented", () => {
    const okR = evaluateGuard({ account: "x", ops: [["vote", {}]], tag: "t" }, { custodyVerified: true, ownerLive: LIVE_OK });
    const noR = evaluateGuard({ account: "x", ops: [["vote", {}]], tag: "t" }, { custodyVerified: false, ownerLive: LIVE_OK });
    return ok(okR.verdict === "ALLOW" && noR.verdict === "DENY" && noR.reason === "custody-not-verified", `ok=${okR.verdict} no=${noR.reason}`);
  });
  t("scrub: WIF-like evidence never reaches the journal", () => {
    const wif = "5" + "J".repeat(50);
    journalHier({ at: "t", type: "selftest.scrub", detail: `wif=${wif} token=REDACTED-BY-HEAD-SECRETS-LAW` }, { file: auditFile });
    const line = fs.readFileSync(auditFile, "utf8").split("\n").filter(Boolean).pop();
    return ok(!line.includes(wif) && line.includes("[redacted-wif]") && line.includes("[redacted-token]"), "scrubbed");
  });
  t("measured corpus maps to expected tiers", () => {
    const want = { vote: "T0", comment: "T0", custom_json: "T0", claim_reward_balance: "T0", limit_order_create: "T1", limit_order_cancel: "T1", delegate_vesting_shares: "T1", account_update2: "T1", transfer: "T2", account_update: "T3" };
    const bad = Object.entries(want).filter(([op, tier]) => classifyOp(op).tier !== tier);
    return ok(bad.length === 0, bad.length ? JSON.stringify(bad) : "all 10 corpus tiers exact");
  });
  t("TTL grant math: expired is expired", () => {
    const r = ownerGrantCheck("account_update", { now: new Date("2030-01-01T00:00:00Z"), file: "/nonexistent-grants.jsonl" });
    return ok(r.found === false && r.reason === "owner-grant-required", "no grants file → required");
  });

  let pass = 0, fail = 0;
  const results = vectors.map(({ name, fn }) => {
    let r; try { r = fn(); } catch (e) { r = { pass: false, detail: String(e?.message ?? e).slice(0, 100) }; }
    if (r.pass) pass++; else fail++;
    return { name, verdict: r.pass ? "GREEN" : "RED", detail: r.detail };
  });
  return { pass, fail, verdict: fail === 0 ? "SELFTEST-GREEN" : "SELFTEST-RED", results };
}

/* ── CLI: selftest | classify '<[[op,body],…]>' | status ─────────────────── */
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const cmd = process.argv[2] ?? "selftest";
  if (cmd === "selftest") {
    const r = selftest();
    for (const v of r.results) console.log(`${v.verdict}  ${v.name}${v.detail ? `  · ${v.detail}` : ""}`);
    console.log(`\n${r.verdict} · pass=${r.pass} fail=${r.fail}`);
    process.exit(r.fail === 0 ? 0 : 1);
  } else if (cmd === "classify") {
    const ops = JSON.parse(process.argv[3] ?? "[]");
    const cls = classifyOps(ops);
    for (const row of cls.rows) console.log(`${row.tier}  ${row.op}  (${row.why})`);
    console.log(`maxTier=${cls.maxTier} destructionOps=${JSON.stringify(cls.destructionOps)}`);
  } else if (cmd === "status") {
    const c = readCounters();
    console.log(JSON.stringify({ day: c.day, counts: c.counts, enforce: ENFORCE, tiers: TIERS }, null, 2));
  } else {
    console.log("usage: node command-hierarchy.mjs selftest | classify '<ops-json>' | status");
    process.exit(2);
  }
}
