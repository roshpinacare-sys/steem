/**
 * fleet-ledger.mjs — R297 · CHAIN-TRUTH UNIQUENESS (the shelling incident).
 *
 * WHY (measured 2026-10-14, api.steemit.com, window 10-06→10-14):
 *   · 75 EXACT duplicate bodies shipped cross-account in 8 days
 *     (one body from FIVE accounts: headcorner/cashmachine/macrame/woq/+).
 *   · 47 duplicate-title groups ("One Month on Cash" from 6 accounts).
 *   · 710/732 fleet votes at exactly 25.00% weight, 5-7 fleet votes per post.
 *   That signature got the WHOLE 14-account roster shelled on steemit.com
 *   (origin serves the landing shell for all 14 while chain truth stays
 *   intact; control accounts render fully — exec28/steem-2 measurement).
 *
 * THE HOLE THIS CLOSES: the existing vetoes see only shallow memory —
 * R277 said-ledger (48h, local state) and the queue-title scan (20 rows).
 * "Seven Floors" shipped from cashmachine 10-11 and again from headcorner
 * 10-13 (51h later — outside every local window). The chain forgets nothing:
 * this ledger is built FROM THE CHAIN (last N posts per roster account) and
 * vetoed against, so no local state rewind/sandbox-reset can blind the gate.
 *
 * Contract (fail-honest):
 *   loadOrBuild()   → chain-truth ledger (cached, TTL), or throws
 *   uniqueness()    → { ok, reasons[], against[] } — pure
 *   notePublished() → append this broadcast into the ledger (same-tick
 *                     siblings see it immediately)
 *   selftest()      → pure vectors, zero network
 * Zero secrets, zero names hardcoded (roster comes from army-social).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STEEM_NODES = [
  "https://api.steemit.com",
  "https://api.justyy.com",
  "https://steem-rpc.publicnode.com",
];

export const LEDGER_TTL_HOURS = 12;      // chain refresh cadence
export const BODY_WINDOW_DAYS = 45;      // steemit's memory is long; census window
export const TITLE_WINDOW_DAYS = 45;
export const MAX_JACCARD = 0.5;          // near-dup bar (matches R277's law)
export const PER_ACCOUNT_POSTS = 60;     // ~3 pages of 20 per account

/* ── pure: normalization ─────────────────────────────────────────────────── */
export function normalizeTitle(t) {
  return String(t ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function bodyCore(body) {
  return String(body ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")        // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")      // links → anchor text
    .replace(/https?:\/\/\S+/g, " ")              // bare urls
    .replace(/[#*_>`~\-]{1,}/g, " ")              // markdown noise
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim()
    .slice(0, 1200);
}

export function coreHash(s) {
  return createHash("sha256").update(String(s ?? "")).digest("hex").slice(0, 24);
}

export function contentTokens(s) {
  const words = String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/).filter(Boolean);
  const grams = new Set();
  for (let i = 0; i < words.length; i++) grams.add(words[i]);
  for (let i = 0; i + 1 < words.length; i++) grams.add(words[i] + "_" + words[i + 1]);
  return grams;
}

export function jaccard(a, b) {
  if (!a?.size || !b?.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/* ── network: RPC with failover ──────────────────────────────────────────── */
async function rpcAny(method, params) {
  const errs = [];
  for (const node of STEEM_NODES) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
      errs.push(`${new URL(node).host}: no-result`);
    } catch (e) {
      errs.push(`${new URL(node).host}: ${String(e?.message ?? e).slice(0, 50)}`);
    }
  }
  throw new Error(`fleet-ledger: all-steem-nodes-failed · ${errs.join(" | ")}`);
}

/** fetch the last `count` root posts of one account (newest first). */
export async function fetchAccountPosts(account, count = PER_ACCOUNT_POSTS) {
  const out = [];
  let start = "";
  while (out.length < count) {
    const page = await rpcAny("condenser_api.get_discussions_by_author_before_date",
      [account, start, "2100-01-01T00:00:00", 20]);
    if (!Array.isArray(page) || !page.length) break;
    for (const p of page) {
      if (p.depth === 0) {
        out.push({
          author: p.author,
          permlink: p.permlink,
          created: p.created,
          title: String(p.title ?? ""),
          core: bodyCore(p.body),
          coreHash: coreHash(bodyCore(p.body)),
          titleKey: normalizeTitle(p.title),
        });
        if (out.length >= count) break;
      }
      start = p.permlink;
    }
    if (!Array.isArray(page) || page.length < 20) break;
  }
  return out;
}

/** build the full fleet ledger from the chain (roster × perAccount posts). */
export async function buildLedger(accounts, { perAccount = PER_ACCOUNT_POSTS } = {}) {
  const posts = [];
  const failed = [];
  for (const acc of accounts) {
    try {
      posts.push(...(await fetchAccountPosts(acc, perAccount)));
    } catch (e) {
      failed.push({ account: acc, error: String(e?.message ?? e).slice(0, 80) });
    }
  }
  return { at: new Date().toISOString(), source: "chain-truth", accounts: [...accounts], failed, posts };
}

/* ── cache: state file with TTL ──────────────────────────────────────────── */
export function ledgerPath(stateDir) {
  return path.join(stateDir, "fleet-body-ledger.json");
}

export function loadCached(stateDir) {
  try {
    const j = JSON.parse(fs.readFileSync(ledgerPath(stateDir), "utf8"));
    if (j?.at && Array.isArray(j.posts)) return j;
  } catch { /* first run */ }
  return null;
}

export function saveLedger(stateDir, ledger) {
  const p = ledgerPath(stateDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const t = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(t, JSON.stringify(ledger));
  fs.renameSync(t, p);
  return p;
}

/**
 * loadOrBuild — cached chain-truth ledger. Refresh when older than TTL.
 * A cached ledger that fails to refresh is still the truth we veto against
 * (notePublished keeps it current for fresh broadcasts between refreshes).
 */
export async function loadOrBuild(accounts, { stateDir, ttlHours = LEDGER_TTL_HOURS, now = new Date().toISOString() } = {}) {
  const cached = loadCached(stateDir);
  const ageH = cached ? (Date.parse(now) - Date.parse(cached.at)) / 3600000 : Infinity;
  if (cached && ageH < ttlHours) return cached;
  const fresh = await buildLedger(accounts);
  /* merge: fresh chain rows + carried local notes survive (notePublished rows
   * for the same window; dedupe by author/permlink keeps the newest). */
  const merged = new Map();
  for (const p of [...(cached?.posts ?? []), ...fresh.posts]) {
    const k = `${p.author}/${p.permlink}`;
    const prev = merged.get(k);
    if (!prev || Date.parse(p.created ?? 0) >= Date.parse(prev.created ?? 0)) merged.set(k, p);
  }
  const ledger = { ...fresh, posts: [...merged.values()], refreshedAt: now, carriedFrom: cached?.posts?.length ?? 0 };
  try { saveLedger(stateDir, ledger); } catch { /* read-only state: veto still works in-memory */ }
  return ledger;
}

/* ── the veto ────────────────────────────────────────────────────────────── */
function withinDays(iso, days, nowMs) {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return true; // unknown age → treat as in-window (fail-closed)
  return nowMs - t <= days * 86400000;
}

/**
 * uniqueness(ledger, {account, title, body}, opts) → {ok, reasons[], against[]}
 *  1. exact body-core hash anywhere in the ledger (any account, any age)
 *  2. Jaccard ≥ MAX_JACCARD vs any ledger body in BODY_WINDOW_DAYS
 *  3. normalized-title match in TITLE_WINDOW_DAYS (any account incl. self)
 */
export function uniqueness(ledger, { account, title, body }, opts = {}) {
  const maxJ = opts.maxJaccard ?? MAX_JACCARD;
  const nowMs = Date.parse(opts.now ?? new Date().toISOString());
  const core = bodyCore(body);
  const hash = coreHash(core);
  const mine = contentTokens(core);
  const tKey = normalizeTitle(title);
  const reasons = [];
  const against = [];
  for (const p of ledger?.posts ?? []) {
    const self = p.author === account;
    if (p.coreHash === hash && core.length > 120) {
      reasons.push(`exact-body-dupe ${self ? "(self)" : ""}${p.author}/${String(p.permlink).slice(0, 40)}@${p.created}`);
      against.push(`${p.author}/${p.permlink}`);
      continue;
    }
    if (withinDays(p.created, opts.bodyWindowDays ?? BODY_WINDOW_DAYS, nowMs) && core.length > 200) {
      const sim = jaccard(mine, contentTokens(p.core));
      if (sim >= maxJ) {
        reasons.push(`near-body-dupe sim=${sim.toFixed(2)} ${self ? "(self)" : ""}${p.author}/${String(p.permlink).slice(0, 40)}`);
        against.push(`${p.author}/${p.permlink}`);
        continue;
      }
    }
    if (tKey && tKey.length > 8 && p.titleKey === tKey && withinDays(p.created, opts.titleWindowDays ?? TITLE_WINDOW_DAYS, nowMs)) {
      reasons.push(`title-dupe ${self ? "(self)" : ""}${p.author}/${String(p.permlink).slice(0, 40)}@${p.created}`);
      against.push(`${p.author}/${p.permlink}`);
    }
  }
  return { ok: reasons.length === 0, reasons, against: [...new Set(against)].slice(0, 5) };
}

/** notePublished — append this broadcast so same-tick siblings veto against it. */
export function notePublished(ledger, { account, permlink, title, body, created }) {
  const core = bodyCore(body);
  const row = {
    author: account, permlink: String(permlink ?? ""), created: created ?? new Date().toISOString(),
    title: String(title ?? ""), core, coreHash: coreHash(core), titleKey: normalizeTitle(title),
  };
  const posts = (ledger?.posts ?? []).filter((p) => !(p.author === row.author && p.permlink === row.permlink));
  posts.push(row);
  return { ...(ledger ?? { at: new Date().toISOString(), source: "in-memory", accounts: [], failed: [] }), posts };
}

/* ── selftest (pure, zero network) ───────────────────────────────────────── */
export function selftest() {
  const out = [];
  const A = "The workshop drawer holds a dozen half-finished projects. Each one started with a good intention. A loose chair leg, a sticky latch, a wobbly shelf. The drawer also holds the replies I never write. The numbers held.";
  const ledger = { at: "2026-10-14T00:00:00Z", source: "test", accounts: ["a", "b"], failed: [], posts: [
    { author: "a", permlink: "x1", created: "2026-10-13T10:00:00Z", title: "The Drawer of Replies", core: bodyCore(A), coreHash: coreHash(bodyCore(A)), titleKey: normalizeTitle("The Drawer of Replies") },
    { author: "b", permlink: "x2", created: "2026-10-13T11:00:00Z", title: "Something Else Entirely", core: bodyCore("Quiet hours: the kettle, the page, and the first light. Nothing loud happened and that was the point of it. Small rooms keep their promises."), coreHash: coreHash(bodyCore("Quiet hours: the kettle, the page, and the first light. Nothing loud happened and that was the point of it. Small rooms keep their promises.")), titleKey: normalizeTitle("Something Else Entirely") },
  ] };
  // 1. exact cross-account body dupe → refused
  let v = uniqueness(ledger, { account: "b", title: "A Fresh Title", body: A });
  out.push(["exact-dupe-refused", v.ok === false && String(v.reasons[0] ?? "").startsWith("exact-body-dupe")]);
  // 2. self repost (same account, new wrapper) → refused
  v = uniqueness(ledger, { account: "a", title: "A Brand New Title Today", body: A });
  out.push(["self-dupe-refused", v.ok === false]);
  // 3. near dupe (reworded core) → refused
  const near = A.replace("workshop drawer", "work bench drawer").replace("good intention", "good intention at heart");
  v = uniqueness(ledger, { account: "b", title: "Another Angle On Drawers", body: near });
  out.push(["near-dupe-refused", v.ok === false]);
  // 4. genuinely fresh body + fresh title → passes
  const freshBody = "The ferry timetable changed twice this autumn. I keep a paper copy in the glovebox because the app lags behind the harbor master by a day. Crossings cost the same but the queue moves differently at seven than at nine.";
  v = uniqueness(ledger, { account: "b", title: "Ferry Timetables In Autumn", body: freshBody });
  out.push(["fresh-passes", v.ok === true]);
  // 5. title dupe with fresh body → refused
  v = uniqueness(ledger, { account: "b", title: "the drawer  of REPLIES!!", body: freshBody });
  out.push(["title-dupe-refused", v.ok === false && String(v.reasons[0] ?? "").startsWith("title-dupe")]);
  // 6. stale title outside window → passes
  const old = { ...ledger, posts: ledger.posts.map((p) => ({ ...p, created: "2026-08-01T00:00:00Z" })) };
  v = uniqueness(old, { account: "b", title: "The Drawer of Replies", body: freshBody });
  out.push(["stale-title-passes", v.ok === true]);
  // 7. notePublished is visible to the next verdict
  const l2 = notePublished(ledger, { account: "b", permlink: "x3", title: "Ferry Timetables In Autumn", body: freshBody });
  v = uniqueness(l2, { account: "a", title: "Brand New Morning Post", body: freshBody });
  out.push(["note-visible", v.ok === false && String(v.reasons[0] ?? "").startsWith("exact-body-dupe")]);
  const failed = out.filter(([, ok]) => !ok);
  return { ok: failed.length === 0, passed: out.length - failed.length, total: out.length, failed: failed.map(([n]) => n) };
}

export default { buildLedger, loadOrBuild, uniqueness, notePublished, selftest, bodyCore, coreHash, normalizeTitle, jaccard, contentTokens };
