/**
 * probe-r265-deep.mjs — R265 deep probe (READ-ONLY, no keys, no broadcasts).
 *
 * The operator's order: "תמשיך יותר עמוק ודחוף" — deeper means the ledger is
 * judged on the CHAIN, not in our state files. This probe measures:
 *   1. Steem ledger (last 24h): posts, comments, votes, downvotes, external
 *      replies that wait for an answer (the polite-zero-detail law).
 *   2. Hive ledger (last 24h) for the 9-roster: same verdicts.
 *   3. headcorner on Hive: exists? in custody? (the r264 deferral verdict)
 *   4. RC deep table: max/avail/regen-to-post + donor eligibility math
 *      (who can donate after the floor without crossing its own line).
 *   5. The weave channel: last handshake state (craft addendum ack?).
 * Truth first. Everything else this round grows from this JSON.
 */
import { writeFileSync } from "node:fs";
import { rpcHive, HIVE_ROSTER } from "./hive.mjs";

const STEEM_NODES = ["https://api.steemit.com", "https://api.stem.fans", "https://steemapi.boylikegirl.club"];
const FLEET = ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"];
const HIVE_FLEET = new Set(HIVE_ROSTER);
const SINCE = Date.now() - 24 * 3600 * 1000;
const POST_RC_COST = 2_300_000_000;
const DONOR_KEEP_MAX = 2_450_000_000;
const MIN_DELEGATION = 1_607_605_799;

async function rpcSteem(method, params) {
  let lastErr = null;
  for (const node of STEEM_NODES) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(12000),
      });
      const j = await r.json();
      if (j?.result !== undefined) return j.result;
      lastErr = new Error(JSON.stringify(j?.error ?? "no result").slice(0, 120));
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("all steem nodes failed");
}

const isFleet = (a) => FLEET.includes(a) || HIVE_FLEET.has(a);

/* rpcSteem returns the unwrapped result (an array); rpcHive returns the full
 * response envelope ({ result: ... }). unwrap() makes both the same shape —
 * R265 lesson: the first draft of this probe measured a lie (double-unwrap
 * showed Steem at zero while the fleet published yesterday). */
const unwrap = (r) => (Array.isArray(r) ? r : (r?.result ?? []));

async function ledger(rpc, method, accounts, chain) {
  const out = {};
  for (const acc of accounts) {
    try {
      const posts = unwrap(await rpc("condenser_api.get_discussions_by_blog", [{ tag: acc, limit: 20 }]));
      const comments = unwrap(await rpc("condenser_api.get_discussions_by_comments", [{ start_author: acc, limit: 20 }]));
      const rec = {
        posts: [], comments: 0, downvotesReceived: 0, externalRepliesOpen: [],
      };
      for (const p of posts) {
        if (p.author !== acc) continue;
        const t = Date.parse(p.created ?? "");
        if (!Number.isFinite(t) || t < SINCE) continue;
        const downs = (p.active_votes ?? []).filter((v) => v.percent < 0);
        rec.downvotesReceived += downs.length;
        rec.posts.push({ permlink: p.permlink, created: p.created, votes: (p.active_votes ?? []).length, downs: downs.map((v) => v.voter) });
      }
      for (const c of comments) {
        if (c.author !== acc) continue;
        const t = Date.parse(c.created ?? "");
        if (Number.isFinite(t) && t >= SINCE) rec.comments++;
      }
      /* external replies on our posts (last 24h posts + yesterday's tail) */
      for (const p of posts.filter((p) => p.author === acc).slice(0, 6)) {
        try {
          const replies = unwrap(await rpc("condenser_api.get_content_replies", [acc, p.permlink]));
          for (const r of replies) {
            if (isFleet(r.author)) continue;
            const t = Date.parse((r.created ?? "").replace("T", "T"));
            if (!Number.isFinite(t)) continue;
            const ageH = (Date.now() - t) / 3600000;
            if (ageH <= 48) rec.externalRepliesOpen.push({ author: r.author, ageH: +ageH.toFixed(1), post: p.permlink.slice(0, 40), excerpt: String(r.body ?? "").replace(/\s+/g, " ").slice(0, 90) });
          }
        } catch { /* per-post failure is honest weather */ }
      }
      out[acc] = rec;
    } catch (e) {
      out[acc] = { error: String(e?.message ?? e).slice(0, 100) };
    }
  }
  return out;
}

/* ---- 1+2: the ledgers ---- */
const steemLedger = await ledger(rpcSteem, "condenser_api", FLEET, "steem");
const hiveLedger = await ledger(rpcHive, "condenser_api", HIVE_ROSTER, "hive");

/* ---- 3: headcorner on Hive ---- */
let headcornerHive = null;
try {
  const r = await rpcHive("condenser_api.get_accounts", [["headcorner"]]);
  const g = r?.result?.[0];
  headcornerHive = g
    ? { exists: true, created: g.created, hp: String(g.vesting_shares ?? "0").replace(" VESTS", ""), hasPosting: (g.posting?.key_auths ?? []).length > 0, hasActive: (g.active?.key_auths ?? []).length > 0, profile: (() => { try { return JSON.parse(g.posting_json_metadata || "{}")?.profile ?? null; } catch { return null; } })() }
    : { exists: false };
} catch (e) { headcornerHive = { error: String(e?.message ?? e).slice(0, 100) }; }

/* ---- 4: RC deep table + donor eligibility ---- */
const rc = {};
for (const acc of HIVE_ROSTER) {
  try {
    const r = await rpcHive("rc_api.find_rc_accounts", { accounts: [acc] });
    const a = r?.result?.rc_accounts?.[0];
    if (!a) { rc[acc] = { error: "no rc record" }; continue; }
    const cur = Number(a.rc_manabar?.current_mana ?? 0);
    const max = Number(a.max_rc ?? 0);
    const upd = Number(a.rc_manabar?.last_update_time ?? 0);
    const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - upd);
    const avail = Math.min(max, cur + (max * Math.min(elapsed, 432000)) / 432000);
    const delegated = Number(a.delegated_rc ?? 0);
    rc[acc] = {
      maxB: +(max / 1e9).toFixed(3),
      availB: +(avail / 1e9).toFixed(3),
      delegatedInB: +(delegated / 1e9).toFixed(3),
      canPostNow: avail >= POST_RC_COST,
      hoursToPost: avail >= POST_RC_COST ? 0 : +(((POST_RC_COST - avail) / (max / 120)) .toFixed(1)),
      donorEligible: max - MIN_DELEGATION >= DONOR_KEEP_MAX,
    };
  } catch (e) { rc[acc] = { error: String(e?.message ?? e).slice(0, 100) }; }
}

/* ---- 5: weave channel state ---- */
let weave = null;
try {
  const m = await import("./lib.mjs");
  weave = m.readJson ? m.readJson(new URL("./state/weave.json", import.meta.url).pathname, null) : null;
  if (weave) weave = { keys: Object.keys(weave), last: weave.last ?? weave.messages?.slice(-1)?.[0] ?? null, count: weave.messages?.length ?? null };
} catch { weave = { error: "unreadable" }; }

const summary = {
  at: new Date().toISOString(),
  steem: {
    accounts: FLEET.length,
    posts24h: Object.values(steemLedger).reduce((s, a) => s + (a.posts?.length ?? 0), 0),
    comments24h: Object.values(steemLedger).reduce((s, a) => s + (a.comments ?? 0), 0),
    downvotes: Object.values(steemLedger).reduce((s, a) => s + (a.downvotesReceived ?? 0), 0),
    externalRepliesOpen: Object.values(steemLedger).flatMap((a) => a.externalRepliesOpen ?? []),
  },
  hive: {
    accounts: HIVE_ROSTER.length,
    posts24h: Object.values(hiveLedger).reduce((s, a) => s + (a.posts?.length ?? 0), 0),
    comments24h: Object.values(hiveLedger).reduce((s, a) => s + (a.comments ?? 0), 0),
    downvotes: Object.values(hiveLedger).reduce((s, a) => s + (a.downvotesReceived ?? 0), 0),
    externalRepliesOpen: Object.values(hiveLedger).flatMap((a) => a.externalRepliesOpen ?? []),
  },
  headcornerHive,
  rcDonors: Object.entries(rc).filter(([, v]) => v.donorEligible).map(([k]) => k),
  rcCanPost: Object.entries(rc).filter(([, v]) => v.canPostNow).map(([k]) => k),
  rcNeverPost: Object.entries(rc).filter(([, v]) => v.maxB && v.maxB * 1e9 < POST_RC_COST).map(([k]) => k),
};

const OUT = { at: summary.at, summary, steemLedger, hiveLedger, headcornerHive, rc, weave };
writeFileSync(new URL("./state/r265-deep.json", import.meta.url), JSON.stringify(OUT, null, 1));
console.log(JSON.stringify(summary, null, 1));
