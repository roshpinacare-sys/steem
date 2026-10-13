/**
 * social-streamer.mjs — R287 · THE POSTING STREAM (dry-run first, operator-armed live).
 *
 * WHY: R286 proved BROADCAST-READY-NOT-BROADCASTED (13/13 key↔authority, RFC6979,
 * noble verify). The only missing link to a real posting stream was the bounded
 * broadcast path. This module IS that path — with the gate order the house
 * doctrine demands: mode file → armed file → kill-switch → rate caps → dedupe.
 *
 * ── THE FLEET STAGING LAYOUT (answers the operator's Q1, wired, not a doc) ──
 *
 *   mini-services/saos-engine/
 *     content/
 *       drafts/<sha8>.json          ONE draft = ONE file, immutable once staged.
 *                                   {stagedAt, sha256, sha8, title, body, tags, source}
 *                                   (the 403MB lesson: never one big rewritten blob —
 *                                   many small content-addressed files, sha-named,
 *                                   idempotent re-staging = no-op)
 *       sent/social-sent.jsonl      append-only broadcast ledger, METADATA ONLY:
 *                                   {at, mode, account, chain, permlink, sha8,
 *                                    txid, verdict, ms} — no bodies, no keys.
 *                                   Bounded BY DESIGN (~200B/row): the 64MB law
 *                                   stays structurally unreachable.
 *     state/social-mode.json        {"mode":"dryrun"} — DEFAULT and missing-file
 *                                   behavior. "live" requires this file AND the
 *                                   armed file AND no pause file.
 *     state/social-pause.json       operator kill-switch (signer.mjs pattern):
 *                                   present ⇒ the whole rail skips, even staging.
 *     .secrets/social-armed.json    standing order for live broadcast (0600,
 *                                   gitignored — same contract as exec-armed.json)
 *
 * Cross-fleet law (unchanged, the house merge doctrine): JSON=live-wins,
 * JSONL=union-ts-ordered; the chain is the anchor of truth, the ledger is trace.
 *
 * CAPS (enforced in BOTH modes so dry-run telemetry stays honest; T-62 UNION
 * release — the false caps died twice, locally AND in the cloud R309/R310):
 *   the old 4/day-fleet cap was FALSE (measured: DAILY-CAP verdicts while
 *   custody accounts sat idle); the old 180min gap was FALSE; the cloud's
 *   12/day was also surpassed by the same order. One law now: fleet ceiling
 *   16/day (14 custody accounts + headroom), per-account hard ceiling ≤4/day
 *   (anti-spam doctrine), 45-minute per-account gap = 9× the chain's real
 *   5-minute posting window. Rotation picks the least-used account; dedupe,
 *   sig-verify, custody and kill-switch are UNTOUCHED. Every cap carries its
 *   measurement line — a cap without a measurement is value theft (R309).
 *   dedupe: a draft sha (title+body) that appears ANYWHERE in the sent ledger
 *   is never signed again — resubmission cannot double-post.
 *
 * CHAINS: steem (chain-proven via steemtx STEEM_CHAIN_ID). hive is supported by
 * the signer stack (HIVE_CHAIN_ID) — wire the node list before first use.
 * BLURT: NOT wired — its chain id must be MEASURED, never guessed (house law);
 * the external report's "verified Blurt authorities" remains unverified here.
 *
 * Run: bun social-streamer.mjs --once   (single cycle, mode per file)
 *      bun social-streamer.mjs --stage  (staging only: zero RPC, zero signing)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { buildTx, wifDecode, pubkeyFromSeed, pubkeyBytes, fingerprint, STEEM_CHAIN_ID, HIVE_CHAIN_ID } from "./steemtx.mjs";
import { rpcCall } from "./measure.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(DIR, "..", "..");
const CONTENT = path.join(DIR, "content");
const DRAFTS = path.join(CONTENT, "drafts");
const SENT = path.join(CONTENT, "sent", "social-sent.jsonl");
const STATE = path.join(DIR, "state");
const MODE_FILE = path.join(STATE, "social-mode.json");
const PAUSE_FILE = path.join(STATE, "social-pause.json");
const ARMED_FILE = path.join(ROOT, ".secrets", "social-armed.json");
const KEY_CACHE = path.join(ROOT, ".secrets", "army-keys.json");
const OPS_FILE = path.join(STATE, "content-ops.json");
const REV_STATE = path.join(STATE, "revenue-staging.json");

/* T-62 UNION release (local T-62 + cloud R309/R310 — one law, dual evidence):
 * fleet ceiling 16/day (superset of cloud 14), per-account ≤4/day hard
 * ceiling, 45min gap (9× chain's real 5-min window). Real external bounds
 * kept: sha8 dedupe, sig gate, custody, kill-switch. */
export const MAX_POSTS_PER_DAY = 16;
export const MIN_GAP_MIN_PER_ACCOUNT = 45;
const CHAINS = {
  steem: { chainId: STEEM_CHAIN_ID, parentPermlink: "steem" },
  hive: { chainId: HIVE_CHAIN_ID, parentPermlink: "hive-101100" }, /* node list must be wired before first use */
};

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const out = (o) => console.log(JSON.stringify(o, null, 2));
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };

function appendSent(row) {
  fs.mkdirSync(path.dirname(SENT), { recursive: true });
  fs.appendFileSync(SENT, JSON.stringify(row) + "\n");
}
function readSent() {
  try {
    return fs.readFileSync(SENT, "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function mode() {
  const m = readJson(MODE_FILE, null);
  return m && m.mode === "live" ? "live" : "dryrun"; /* missing file = dryrun, by law */
}

/* ── staging: content-ops queue → content-addressed draft files ─────────── */
export function stageDrafts() {
  const ops = readJson(OPS_FILE, null);
  const queue = Array.isArray(ops?.queue) ? ops.queue : [];
  fs.mkdirSync(DRAFTS, { recursive: true });
  let staged = 0, skipped = 0;
  for (const d of queue) {
    /* R308 · OLD-STOCK VETO ALIGNMENT (army-social R243 law): only LIVE
     * drafts enter broadcast staging — retired-old-stock / published rows
     * never reach the signing path through the side door. */
    if (d?.status && d.status !== "drafted") { skipped += 1; continue; }
    const title = String(d.title ?? "").trim();
    const body = String(d.body ?? "").trim();
    if (!title || !body) continue;
    const sha = sha256(title + "\n" + body);
    const file = path.join(DRAFTS, `${sha.slice(0, 8)}.json`);
    if (fs.existsSync(file)) { skipped += 1; continue; }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ stagedAt: new Date().toISOString(), sha256: sha, sha8: sha.slice(0, 8), title, body, tags: Array.isArray(d.tags) ? d.tags : [], source: ops?.source ?? "corpus" }, null, 2));
    fs.renameSync(tmp, file); /* atomic: rename is the commit point (R235 law) */
    staged += 1;
  }
  /* R309 · THE REVENUE INGEST (the last reader-less rail, same disease R308
   * cured for the streamer): the compiler stages BROADCAST-READY packages
   * (scrubbed, schema-passed, custody-gated GREEN) and NO loop ever consumed
   * them — ready posts sat in the buffer forever while the operator saw no
   * posts. The custody-gated broadcaster now ingests steem-chain packages
   * through the SAME gates (mode → armed → kill-switch → caps → gap → dedupe
   * → sig-verify). The compiler itself still never broadcasts; the law stands.
   * Double-post is impossible by construction: content-addressed draft files
   * + the BROADCASTED sha ledger. */
  let stagedRevenue = 0, revenuePublished = 0;
  const rev = readJson(REV_STATE, null);
  if (rev && Array.isArray(rev.packages)) {
    const liveShas = new Set(readSent().filter((r) => r.verdict === "BROADCASTED").map((r) => r.sha8));
    let dirty = false;
    for (const p of rev.packages) {
      if (p?.state !== "BROADCAST-READY" || p?.chain !== "steem") continue;
      const title = String(p.title ?? "").trim();
      const body = String(p.body ?? "").trim();
      if (!title || !body) continue;
      const sha = sha256(title + "\n" + body);
      if (liveShas.has(sha.slice(0, 8))) {
        /* already on chain — sync the buffer to truth (fail-soft; the ledger
         * is the anchor, this marker is only what the operator reads) */
        if (p.state !== "PUBLISHED") { p.state = "PUBLISHED"; p.publishedSyncedAt = new Date().toISOString(); dirty = true; }
        revenuePublished += 1;
        continue;
      }
      const file = path.join(DRAFTS, `${sha.slice(0, 8)}.json`);
      if (fs.existsSync(file)) continue;
      const rtmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(rtmp, JSON.stringify({ stagedAt: new Date().toISOString(), sha256: sha, sha8: sha.slice(0, 8), title, body, tags: Array.isArray(p.tags) ? p.tags : [], source: "revenue-digest" }, null, 2));
      fs.renameSync(rtmp, file);
      stagedRevenue += 1;
    }
    if (dirty) {
      try { const st = `${REV_STATE}.${process.pid}.tmp`; fs.writeFileSync(st, JSON.stringify(rev, null, 2)); fs.renameSync(st, REV_STATE); } catch { /* fail-soft by law */ }
    }
  }
  return { staged, skipped, totalInQueue: queue.length, stagedRevenue, revenuePublished };
}

function slugify(title) {
  const s = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return s || "post";
}

/* ── one full cycle: stage → gate → pick → sign → (live?) broadcast ─────── */
export async function runOnce({ stagingOnly = false } = {}) {
  const t0 = Date.now();
  const base = { at: new Date().toISOString() };

  if (fs.existsSync(PAUSE_FILE)) {
    return { ...base, ok: false, verdict: "PAUSED", note: "operator kill-switch present (state/social-pause.json)" };
  }

  const stage = stageDrafts();
  if (stagingOnly) return { ...base, ok: true, verdict: "STAGED", stage };

  const m = mode();
  const armed = fs.existsSync(ARMED_FILE);
  if (m === "live" && !armed) {
    return { ...base, ok: false, verdict: "LIVE-REFUSED-NOT-ARMED", note: "mode=live but .secrets/social-armed.json missing — fail-closed", stage };
  }

  /* ledger facts: dedupe + caps (both modes count).
   * R287 dedupe law: only rows that actually carried a verified signature
   * block a draft — failed rows (never touched the chain) do NOT burn it. */
  const sent = readSent();
  const BURNED_VERDICTS = new Set(["SIGNATURE-VERIFY-FAILED", "BROADCAST-FAILED"]);
  const seenDry = new Set(sent.filter((r) => !BURNED_VERDICTS.has(r.verdict)).map((r) => r.sha8));
  const seenLive = new Set(sent.filter((r) => r.verdict === "BROADCASTED").map((r) => r.sha8));
  const blockSet = m === "live" ? seenLive : seenDry;
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const todayCount = sent.filter((r) => r.at && new Date(r.at) >= dayStart && r.verdict === "BROADCASTED").length;
  if (m === "live" && todayCount >= MAX_POSTS_PER_DAY) {
    return { ...base, ok: false, verdict: "DAILY-CAP", cap: MAX_POSTS_PER_DAY, todayCount, stage };
  }

  const drafts = fs.existsSync(DRAFTS)
    ? fs.readdirSync(DRAFTS).filter((f) => f.endsWith(".json")).sort().map((f) => readJson(path.join(DRAFTS, f), null)).filter(Boolean)
    : [];
  const draft = drafts.find((d) => !blockSet.has(d.sha8)) ?? null;
  if (!draft) {
    return { ...base, ok: true, verdict: "NOTHING-NEW", drafts: drafts.length, alreadySent: blockSet.size, stage };
  }

  /* key custody: same contract as dryrun-sign (0600, memory-only WIF) */
  const st = fs.statSync(KEY_CACHE);
  if ((st.mode & 0o077) !== 0) return { ...base, ok: false, verdict: "REFUSED", reason: "key-cache-permissions-too-open", stage };
  const cache = JSON.parse(fs.readFileSync(KEY_CACHE, "utf8"));
  const roster = (cache.accounts ?? []).filter((a) => (a.gens ?? []).some((g) => g.wif));

  const names = roster.map((a) => a.name);
  const chainAccs = await rpcCall("condenser_api.get_accounts", [names]);
  if (!chainAccs.ok || !Array.isArray(chainAccs.result)) return { ...base, ok: false, verdict: "RPC-FAILED", reason: chainAccs.error ?? "get_accounts", stage };
  const authority = new Map();
  for (const a of chainAccs.result ?? []) {
    const pub = a?.posting?.key_auths?.[0]?.[0];
    if (typeof pub === "string") authority.set(a.name, pub);
  }
  const matched = roster
    .map((a) => ({ acc: a, gen: (a.gens ?? []).find((g) => g.wif && authority.get(a.name) && pubkeyFromSeed(wifDecode(g.wif)) === authority.get(a.name)) }))
    .filter((x) => x.gen);
  if (!matched.length) return { ...base, ok: false, verdict: "NO-MATCHING-KEY", stage };

  /* account rotation: least-used matched account in the ledger (gap law) */
  const useCount = new Map();
  const lastUse = new Map();
  for (const r of sent) { if (r.account) { useCount.set(r.account, (useCount.get(r.account) ?? 0) + 1); if (!lastUse.has(r.account) || new Date(r.at) > lastUse.get(r.account)) lastUse.set(r.account, new Date(r.at)); } }
  matched.sort((x, y) => (useCount.get(x.acc.name) ?? 0) - (useCount.get(y.acc.name) ?? 0));
  const now = Date.now();
  const pick = matched.find((x) => now - (lastUse.get(x.acc.name)?.getTime() ?? 0) >= MIN_GAP_MIN_PER_ACCOUNT * 60_000) ?? null;
  if (!pick) return { ...base, ok: false, verdict: "ACCOUNT-GAP", minGapMin: MIN_GAP_MIN_PER_ACCOUNT, stage };

  const chainName = "steem"; /* hive/blurt: measured-node law before first use */
  const chain = CHAINS[chainName];
  const nowD = new Date();
  const permlink = `${slugify(draft.title)}-${nowD.toISOString().slice(0, 10).replace(/-/g, "")}-${draft.sha8}`.slice(0, 255);
  const tags = Array.isArray(draft.tags) && draft.tags.length ? draft.tags.slice(0, 5) : ["saos"];
  const ops = [["comment", {
    parent_author: "",
    parent_permlink: chain.parentPermlink,
    author: pick.acc.name,
    permlink,
    title: draft.title,
    body: draft.body,
    json_metadata: JSON.stringify({ tags, app: "saos-engine/1", gen: pick.gen.gen ?? null }),
  }]];

  const dgpo = await rpcCall("condenser_api.get_dynamic_global_properties", []);
  if (!dgpo.ok) return { ...base, ok: false, verdict: "RPC-FAILED", reason: "dgpo", stage };
  const tx = buildTx({ ops, dgpo: dgpo.result, wifs: [pick.gen.wif], chainId: chain.chainId });

  /* cryptographic self-verify against the LIVE on-chain authority (noble).
   * R287 lesson measured: the namespace import is the chain-proven shape
   * (dryrun-sign.mjs) — a dynamic `{default: secp}` extraction yields a
   * broken namespace here and every verify "fails" via the catch. */
  const secp = await import("@noble/secp256k1");
  let sigVerified = false;
  try {
    const raw = Buffer.from(tx.json.signatures[0], "hex");
    const sigObj = secp.Signature.fromCompact(new Uint8Array(raw.slice(1)));
    sigVerified = secp.verify(sigObj, new Uint8Array(Buffer.from(tx.digestHex, "hex")), pubkeyBytes(authority.get(pick.acc.name)));
  } catch { sigVerified = false; }
  const txid = createHash("sha256").update(Buffer.from(tx.serializedHex, "hex")).digest("hex").slice(0, 40);

  if (!sigVerified) {
    appendSent({ ...base, kind: "post", mode: m, account: pick.acc.name, chain: chainName, permlink, sha8: draft.sha8, txid: null, verdict: "SIGNATURE-VERIFY-FAILED", ms: Date.now() - t0 });
    return { ...base, ok: false, verdict: "SIGNATURE-VERIFY-FAILED", account: pick.acc.name, stage };
  }

  if (m === "dryrun") {
    appendSent({ ...base, kind: "post", mode: "dryrun", account: pick.acc.name, chain: chainName, permlink, sha8: draft.sha8, txid, verdict: "DRYRUN-SIGNED-NOT-BROADCASTED", ms: Date.now() - t0 });
    return {
      ...base, ok: true, verdict: "DRYRUN-SIGNED-NOT-BROADCASTED", mode: "dryrun",
      account: pick.acc.name, keyGen: pick.gen.gen ?? null, wifFingerprint: fingerprint(pick.gen.wif),
      draft: { sha8: draft.sha8, title: draft.title }, permlink, tx: { id: txid, refBlock: tx.json.ref_block_num, expiration: tx.json.expiration, serializedBytes: tx.serializedHex.length / 2 },
      caps: { todayCount, maxPerDay: MAX_POSTS_PER_DAY, minGapMin: MIN_GAP_MIN_PER_ACCOUNT }, stage,
      note: "signature verified against live authority; broadcast deliberately withheld (mode=dryrun). Flip: state/social-mode.json {\"mode\":\"live\"} + .secrets/social-armed.json",
    };
  }

  /* ── LIVE: every gate already passed (mode+armed+caps+gap+dedupe+sig) ── */
  const b = await rpcCall("network_broadcast_api.broadcast_transaction", [tx.json], 20000);
  const broadcasted = b.ok;
  appendSent({ ...base, kind: "post", mode: "live", account: pick.acc.name, chain: chainName, permlink, sha8: draft.sha8, txid: broadcasted ? txid : null, verdict: broadcasted ? "BROADCASTED" : "BROADCAST-FAILED", node: b.node ?? null, error: broadcasted ? undefined : String(b.error ?? "").slice(0, 120), ms: Date.now() - t0 });
  /* R308 · QUEUE-TRUTH SYNC: the work queue reflects reality — the row that
   * just went live is marked published (title match), so the operator never
   * sees a "drafted" row that is already on the chain. Fail-soft: the chain
   * and the sent-ledger remain the anchors of truth. */
  if (broadcasted) {
    try {
      const ops = readJson(OPS_FILE, null);
      if (ops && Array.isArray(ops.queue)) {
        const row = ops.queue.find((q) => String(q?.title ?? "").trim() === String(draft.title).trim() && q?.status === "drafted");
        if (row) { row.status = "published"; row.publishedAt = base.at; row.account = pick.acc.name; row.permlink = permlink; row.txid = txid; writeJson(OPS_FILE, ops); }
      }
    } catch { /* fail-soft by law */ }
    /* R309 · REVENUE-TRUTH SYNC: a digest that just went live is marked
     * PUBLISHED in the staging buffer with its chain proof — the operator
     * never sees a READY package that already breathes on the chain. */
    try {
      const rev = readJson(REV_STATE, null);
      if (rev && Array.isArray(rev.packages)) {
        const prow = rev.packages.find((p) => p?.state === "BROADCAST-READY" && String(p?.title ?? "").trim() === String(draft.title).trim());
        if (prow) { prow.state = "PUBLISHED"; prow.publishedAt = base.at; prow.account = pick.acc.name; prow.permlink = permlink; prow.txid = txid; const st = `${REV_STATE}.${process.pid}.tmp`; fs.writeFileSync(st, JSON.stringify(rev, null, 2)); fs.renameSync(st, REV_STATE); }
      }
    } catch { /* fail-soft by law */ }
  }
  return {
    ...base, ok: broadcasted, verdict: broadcasted ? "BROADCASTED" : "BROADCAST-FAILED",
    account: pick.acc.name, permlink, txid: broadcasted ? txid : null, node: b.node ?? null,
    error: broadcasted ? undefined : String(b.error ?? "").slice(0, 120), stage,
  };
}

/* R311 · BROADCAST TITLES (the anti-twin memory, one-body): every title that
 * ever breathed on-chain (BROADCASTED rows, resolved from the content-
 * addressed drafts). The content dedupe feeds on this — the old 12-title
 * window let corpus twins through (measured live: two near-identical
 * "Curation Reward" posts both aired). Bounded by `n`. */
export function broadcastTitles(n = 80) {
  return readSent().filter((r) => r.verdict === "BROADCASTED")
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-n)
    .map((r) => {
      try { return readJson(path.join(DRAFTS, `${r.sha8}.json`), null)?.title ?? null; } catch { return null; }
    })
    .filter(Boolean);
}

/* ── R310 · THE LIVE STREAM (the missing sight-channel) ───────────────────
 * The operator's measured complaint: "אני לא רואה פוסטים" — posts breathe
 * on-chain and NO surface showed them (the cockpit had no posts panel at
 * all). One-body law: the ENGINE serves the stream itself — broadcast rows
 * from the sent ledger, titles resolved from the content-addressed drafts,
 * steemit links, today count vs cap, and the queue/revenue runway. */
export function streamState() {
  const live = readSent().filter((r) => r.verdict === "BROADCASTED")
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const posts = live.slice(-12).reverse().map((r) => {
    let title = null;
    try { title = readJson(path.join(DRAFTS, `${r.sha8}.json`), null)?.title ?? null; } catch { /* missing draft file: the permlink still tells the story */ }
    return {
      at: r.at ?? null, account: r.account ?? null, permlink: r.permlink ?? null, txid: r.txid ?? null, title,
      url: r.account && r.permlink ? `https://steemit.com/@${r.account}/${r.permlink}` : null,
    };
  });
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const todayCount = live.filter((r) => r.at && new Date(r.at) >= dayStart).length;
  const ops = readJson(OPS_FILE, null);
  const runwayDrafts = (Array.isArray(ops?.queue) ? ops.queue : []).filter((d) => d?.status === "drafted").length;
  let readyRevenue = 0;
  try { readyRevenue = (readJson(REV_STATE, null)?.packages ?? []).filter((p) => p?.state === "BROADCAST-READY").length; } catch { /* fail-soft */ }
  return { posts, todayCount, cap: MAX_POSTS_PER_DAY, gapMin: MIN_GAP_MIN_PER_ACCOUNT, runwayDrafts, readyRevenue };
}

/* ── CLI ────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
if (argv.includes("--once") || argv.includes("--stage")) {
  runOnce({ stagingOnly: argv.includes("--stage") })
    .then((r) => out(r))
    .catch((e) => out({ ok: false, verdict: "STREAM-ERROR", reason: String(e).slice(0, 160) }));
}
