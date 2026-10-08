/**
 * hive.mjs — R254 · THE HIVE ORGAN (האיבר-החדש: בחינה-מבוקרת על האח-התאום).
 *
 * OPERATOR ORDER 2026-10-07 (verbatim intent): "אני מאשר ניסיון ובחינה
 * פתיחה בhive וזיהוי spaminator על מה הוא מסמן ולמה ומה הסיבות ותיקונים
 * לאחר מכן ... שאם הכל זורם שימשיכו עד שהם מקבלים downvote ואז לבדוק
 * למה.. כל עוד לא מקבלים ממשיכים" + "לגבי blurt תמתין".
 *
 * THE CUSTODY TRUTH (measured live 2026-10-07, api.hive.blog): nine army
 * accounts exist on Hive WITH the fork-era keys — the ORIGINAL posting keys
 * that Hive never saw rotated. Those WIFs live in the GEN-1 git vault
 * (agent/vault/KEYS-ZIP-2026-09-10.zip.enc @ commit-pinned history) whose
 * keys are "dead" ON STEEM (rotated away) and very much ALIVE ON HIVE.
 * Lawful chain: git history → sha-pin → decrypt → memory-only WIF →
 * derived pubkey MUST equal the LIVE Hive posting authority (fail-closed).
 *
 * THE LAWS:
 *  · WIFs never touch disk, logs, or state (memory for the run only).
 *  · cross-chain law honored via spamgate.CHAIN_POLICY (hive=trial with
 *    stricter gates, blurt=refused).
 *  · caps: ≤1 post/day/account on Hive, probe-sized rounds (≤3/day fleet),
 *    RC-gated (a broke account does not broadcast), voting OFF in probe.
 *  · THE DOWNVOTE VETO: before every post and in every watch pass — one
 *    flag pauses the author (flag-pauses.json, shared with the Steem rail);
 *    if the fleet is flagged, the whole Hive organ pauses for analysis.
 *  · every receipt is journaled; the cockpit sees verdicts, never keys.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { HIVE_CHAIN_ID, buildTx, wifDecode, pubkeyFromSeed } from "./steemtx.mjs";
import { spamVerdict, flagPauseVerdict } from "./spamgate.mjs";
import { wordCount, MIN_POST_WORDS, titleSimilarity, recentPublishedTitles } from "./content.mjs";
import { embedImage } from "./illustrate.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const HIVE_OPS_FILE = path.join(STATE, "hive-ops.json");
const FLAG_PAUSES_FILE = path.join(STATE, "flag-pauses.json");
const SECRETS = path.join(DIR, "..", "..", ".secrets");
const TMP = path.join(SECRETS, "hive-vault-tmp");

/* the GEN-1 vault commit — pinned by hash, never by a moving branch */
const GEN1_COMMIT = "1c9f00d0";
const GEN1_ZIP = "agent/vault/KEYS-ZIP-2026-09-10.zip.enc";
const GEN1_META = "agent/recovery-meta.json";

/* measured 2026-10-07: these 9 hold FULL custody on Hive (owner+active+
 * posting all match the GEN-1 pubs); tov/ynet/headcorner rotated there;
 * hcsoldier4/5/6 were born post-fork (not on Hive). */
export const HIVE_ROSTER = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "wic", "wog", "woq"];

const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/* ── node access ──────────────────────────────────────────────────────────── */
export async function rpcHive(method, params, timeoutMs = 12000) {
  for (const node of HIVE_NODES) {
    try {
      const r = await fetch(node, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.error) continue;
      return { ok: true, result: d.result, node };
    } catch { /* next node */ }
  }
  return { ok: false, error: "all-hive-nodes-failed" };
}

/* ── custody: memory-only WIF unlock from the GEN-1 git vault ─────────────── */
let memHive = {}; // account → { wif, pubkey, verifiedAt } — never persisted

function gitShowBytes(commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], { cwd: path.join(DIR, "..", ".."), maxBuffer: 64 * 1024 * 1024 });
}

/** pull + decrypt GEN-1, extract posting WIFs for HIVE_ROSTER into MEMORY.
 * Fail-closed: sha-pins both layers; wipes the plaintext tmp immediately. */
function unlockHiveKeysFromGitVault() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  try {
    const meta = JSON.parse(gitShowBytes(GEN1_COMMIT, GEN1_META).toString("utf8"));
    const enc = gitShowBytes(GEN1_COMMIT, GEN1_ZIP);
    if (sha256(enc) !== String(meta.keysZipSha256 ?? "")) throw new Error("gen1-outer-sha-mismatch");
    fs.writeFileSync(path.join(TMP, "k.enc"), enc, { mode: 0o600 });
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", path.join(TMP, "k.enc"), "-out", path.join(TMP, "inner.zip"),
      "-pass", `pass:${meta.keysZipPass}`], { stdio: ["ignore", "ignore", "pipe"] });
    const inner = fs.readFileSync(path.join(TMP, "inner.zip"));
    if (sha256(inner) !== String(meta.keysZipInnerSha256 ?? "")) throw new Error("gen1-inner-sha-mismatch");
    fs.writeFileSync(path.join(TMP, "inner.zip"), inner, { mode: 0o600 });
    execFileSync("unzip", ["-o", "-q", path.join(TMP, "inner.zip"), "agent/keys/vault.json", "-d", path.join(TMP, "o")]);
    const vault = JSON.parse(fs.readFileSync(path.join(TMP, "o", "agent", "keys", "vault.json"), "utf8"));
    const byName = new Map((vault.accounts ?? []).map((a) => [a.username, a]));
    const extracted = {};
    for (const name of HIVE_ROSTER) {
      const wif = byName.get(name)?.keys?.posting?.wif;
      if (wif) extracted[name] = wif; // memory-only from here
    }
    return extracted;
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
}

/** verify one WIF against the LIVE Hive chain posting authority */
async function verifyHivePosting(account, wif) {
  const acc = await rpcHive("condenser_api.get_accounts", [[account]]);
  const auth = acc.ok ? acc.result?.[0]?.posting?.key_auths?.[0]?.[0] : null;
  if (!auth) return { ok: false, reason: "no-live-authority" };
  let derived = null;
  try { derived = pubkeyFromSeed(wifDecode(String(wif).trim())); } catch { return { ok: false, reason: "wif-decode-fail" }; }
  if (derived !== auth) return { ok: false, reason: "authority-mismatch", derived };
  return { ok: true, pubkey: derived };
}

/** idempotent custody pass: unlock + verify all roster accounts. Returns
 * verdict-only state (never the keys). */
export async function hiveCustody({ now = new Date().toISOString() } = {}) {
  const results = {};
  let verified = 0;
  try {
    if (Object.keys(memHive).length === 0) memHive = unlockHiveKeysFromGitVault();
    for (const name of HIVE_ROSTER) {
      const wif = memHive[name];
      if (!wif) { results[name] = "NO-GEN1-KEY"; continue; }
      const v = await verifyHivePosting(name, wif);
      results[name] = v.ok ? "VERIFIED-VS-HIVE-CHAIN" : `REFUSED:${v.reason}`;
      if (v.ok) { memHive[name] = wif; verified++; }
      else delete memHive[name];
    }
  } catch (e) {
    const doc = { at: now, verdict: "UNLOCK-FAIL", error: String(e?.message ?? e).slice(0, 140) };
    writeJson(path.join(STATE, "hive-custody.json"), doc);
    appendLine(path.join(STATE, "events.jsonl"), { type: "hive.custody", at: now, ...doc });
    return { ...doc, verified: 0, results: {} };
  }
  const doc = { at: now, verdict: verified === HIVE_ROSTER.length ? "HIVE-CUSTODY-ALIVE" : verified > 0 ? "PARTIAL" : "NONE", verified, total: HIVE_ROSTER.length, results, law: "GEN-1 git vault → sha-pin → memory-only WIF → live Hive authority match" };
  writeJson(path.join(STATE, "hive-custody.json"), doc);
  appendLine(path.join(STATE, "events.jsonl"), { type: "hive.custody", at: now, verdict: doc.verdict, verified, total: HIVE_ROSTER.length });
  return doc;
}

/* ── broadcast ────────────────────────────────────────────────────────────── */
export async function broadcastHive(ops, wif, { ttlSec = 45 } = {}) {
  const dgpo = await rpcHive("condenser_api.get_dynamic_global_properties", []);
  if (!dgpo.ok || !dgpo.result?.head_block_number) return { ok: false, verdict: "NO-DGPO" };
  const tx = buildTx({ ops, dgpo: dgpo.result, wifs: [wif], ttlSec, chainId: HIVE_CHAIN_ID });
  for (const node of HIVE_NODES) {
    try {
      const r = await fetch(node, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.broadcast_transaction", params: [tx.json], id: 1 }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.error) return { ok: false, verdict: "REJECTED", error: String(d.error.message ?? "").slice(0, 160), node };
      return { ok: true, verdict: "BROADCAST", node, digest8: tx.digestHex.slice(0, 8), digestHex: tx.digestHex };
    } catch { /* next node */ }
  }
  return { ok: false, verdict: "ALL-NODES-FAILED" };
}

/** resolve the memory-only WIF for a custody-verified account and send ops */
export async function sendAs(account, ops) {
  const wif = memHive[account];
  if (!wif) return { ok: false, verdict: "NO-MEMORY-WIF", reason: "run hiveCustody first" };
  return broadcastHive(ops, wif);
}

/** the chain-id/sig validator: one tiny probe vote (measured weight ≤1%)
 * judged live by the node — the txid-oracle law, cross-chain edition */
export async function hiveProbeVote({ account, targetAuthor, targetPermlink, weightPct = 1 } = {}) {
  const cust = await hiveCustody({});
  if (cust.results[account] !== "VERIFIED-VS-HIVE-CHAIN") return { ok: false, verdict: "NO-CUSTODY", detail: cust.results[account] };
  const ops = [["vote", { voter: account, author: targetAuthor, permlink: targetPermlink, weight: Math.round(weightPct * 100) }]];
  const res = await sendAs(account, ops);
  appendLine(path.join(STATE, "events.jsonl"), { type: "hive.probe-vote", at: new Date().toISOString(), account, target: `${targetAuthor}/${targetPermlink}`, weightPct, verdict: res.verdict, error: res.error?.slice(0, 120) ?? null, node: res.node ?? null });
  return res;
}

/* ── the gate helpers ─────────────────────────────────────────────────────── */
function readPauses() { return readJson(FLAG_PAUSES_FILE, { accounts: {} })?.accounts ?? {}; }
function pauseActive(account) { return readPauses()[account]?.active === true; }
function fleetHivePaused() { return readJson(HIVE_OPS_FILE, null)?.fleetPaused?.active === true; }

export function hiveOpsState() { return readJson(HIVE_OPS_FILE, null); }

async function rcOk(account) {
  /* MEASURED (2026-10-07, node-judged): a ≥1600-char post at our tiny stake
   * costs ~2.3B RC (node rejected cashmachine@1.52B-available and haran@1.78B
   * with "needs 2301883372"). available = current + regen since update
   * (full regen = 5 days). Broken-stake accounts defer honestly — a node
   * rejection also maps to defer (fail-soft, nothing consumed). */
  const POST_RC_COST = 2_300_000_000;
  const r = await rpcHive("rc_api.find_rc_accounts", { accounts: [account] });
  const a = r?.result?.rc_accounts?.[0];
  if (!a) return false;
  const cur = Number(a.rc_manabar?.current_mana ?? 0);
  const max = Number(a.max_rc ?? 0);
  const upd = Number(a.rc_manabar?.last_update_time ?? 0);
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - (Number.isFinite(upd) ? upd : 0));
  const available = max > 0 ? Math.min(max, cur + (max * Math.min(elapsed, 432_000)) / 432_000) : cur;
  return available >= POST_RC_COST;
}

async function ownRecentHiveBodies(account) {
  const r = await rpcHive("condenser_api.get_discussions_by_blog", [{ tag: account, limit: 5 }]);
  return r.ok ? (r.result ?? []).filter((x) => x.author === account).map((x) => String(x.body ?? "")).slice(0, 10) : [];
}

async function postsTodayHive(account, day) {
  const r = await rpcHive("condenser_api.get_discussions_by_blog", [{ tag: account, limit: 10 }]);
  if (!r.ok) return 0;
  return (r.result ?? []).filter((x) => x.author === account && String(x.created ?? "").slice(0, 10) === day).length;
}

/** R254 · downvote scan on our recent Hive posts — the veto evidence pass.
 * ERA LAW (measured 2026-10-07): the fleet's PRE-doctrine posts (T-85-era
 * thin content, pre-R243) are already eaten and already analyzed — they ARE
 * the doctrine's founding evidence. The veto judges the CURRENT trial era
 * only: anything created after HIVE_TRIAL_SINCE. Old scars must not
 * strangle the operator-approved fresh start; new flags absolutely stop it. */
export const HIVE_TRIAL_SINCE = "2026-10-07T00:00:00Z";
export async function hiveDownvoteScan({ now = new Date().toISOString(), sinceIso = HIVE_TRIAL_SINCE } = {}) {
  const pauses = readPauses();
  let newFlags = 0;
  const flagged = [];
  for (const account of HIVE_ROSTER) {
    const r = await rpcHive("condenser_api.get_discussions_by_blog", [{ tag: account, limit: 5 }]);
    if (!r.ok) continue;
    for (const post of (r.result ?? []).filter((x) => x.author === account && String(x.created ?? "") >= sinceIso).slice(0, 3)) {
      const votes = Array.isArray(post.active_votes) ? post.active_votes : [];
      const neg = votes.filter((v) => Number(v.percent) < 0);
      if (!neg.length) continue;
      newFlags++;
      flagged.push({ account, permlink: post.permlink, downvoters: neg.map((v) => v.voter) });
      pauses[account] = { active: true, since: now, chain: "hive", updatedAt: now, reasons: flagPauseVerdict({ flags: neg.length, author: account, permlink: post.permlink, chain: "hive" }).reasons };
      appendLine(path.join(STATE, "events.jsonl"), { type: "downvote.pause", at: now, chain: "hive", account, permlink: post.permlink, downvoters: neg.map((v) => v.voter).slice(0, 5) });
    }
  }
  if (newFlags) {
    writeJson(FLAG_PAUSES_FILE, { at: now, accounts: pauses });
    /* the whole Hive organ pauses for analysis when the trial draws fire */
    const st = readJson(HIVE_OPS_FILE, {}) ?? {};
    writeJson(HIVE_OPS_FILE, { ...st, fleetPaused: { active: true, since: now, reason: `${newFlags} flagged post(s) — analysis first (operator law)` } });
  }
  return { flagged, newFlags };
}

/* ── THE RAIL: probe-sized sovereign rounds on Hive ───────────────────────── */
export async function runHiveRail({ now = new Date().toISOString(), limit = 3 } = {}) {
  const t0 = Date.now();
  const day = String(now).slice(0, 10);
  const prev = readJson(HIVE_OPS_FILE, {}) ?? {};
  if (prev.fleetPaused?.active) {
    return { verdict: "HIVE-FLEET-PAUSED", reason: prev.fleetPaused.reason, executed: 0, ms: Date.now() - t0 };
  }
  const custody = await hiveCustody({ now });
  if (custody.verified === 0) {
    return { verdict: "HIVE-NO-CUSTODY", executed: 0, ms: Date.now() - t0 };
  }
  /* the veto pass runs BEFORE anything speaks */
  const scan = await hiveDownvoteScan({ now });
  if (scan.newFlags > 0) {
    return { verdict: "HIVE-FLAGGED-STOP", flagged: scan.flagged, executed: 0, ms: Date.now() - t0 };
  }
  const c = readJson(path.join(DIR, "state", "content-ops.json"), null);
  const queue = Array.isArray(c?.queue) ? c.queue : [];
  const recentTitles = recentPublishedTitles(queue, 12);
  const results = [];
  let executed = 0;
  /* RC-sorted roster: the strongest accounts speak first (measured, not vibes) */
  const order = [];
  for (const account of HIVE_ROSTER) {
    if (pauseActive(account)) { results.push({ account, verdict: "PAUSED-DOWNVOTE" }); continue; }
    if (custody.results[account] !== "VERIFIED-VS-HIVE-CHAIN") { results.push({ account, verdict: custody.results[account] }); continue; }
    if (!(await rcOk(account))) { results.push({ account, verdict: "RC-LOW-HONEST-DEFER" }); continue; }
    const used = (prev.day === day ? (prev.accounts?.[account] ?? 0) : 0);
    if (used >= 1) { results.push({ account, verdict: "DAY-CAP" }); continue; }
    order.push({ account });
  }
  for (const { account } of order.slice(0, Math.max(0, limit))) {
    const draft = queue.find((d) => d.status === "drafted" && wordCount(d.body) >= MIN_POST_WORDS);
    if (!draft) { results.push({ account, verdict: "NO-DRAFT" }); continue; }
    const clash = recentTitles.find((t) => titleSimilarity(t, draft.title) >= 0.5);
    if (clash) { results.push({ account, verdict: "MONOCULTURE-VETO" }); continue; }
    const gate = spamVerdict(draft, { isComment: false, chain: "hive", ownRecentBodies: await ownRecentHiveBodies(account), postsToday: await postsTodayHive(account, day), dayCap: 1 });
    if (!gate.ok) {
      results.push({ account, verdict: "SPAMGATE-REFUSED", reasons: gate.reasons.slice(0, 4) });
      appendLine(path.join(STATE, "events.jsonl"), { type: "hive.spamgate-refused", at: now, account, reasons: gate.reasons.slice(0, 5) });
      continue;
    }
    /* NO community meta on Hive: hive-457262 lives on STEEM. Plain tags +
     * the legal image contract. */
    const metaObj = { tags: draft.tags, app: "saos-hive-rail" };
    let body = draft.body;
    if (draft.image?.url && /^https:\/\/upload\.wikimedia\.org\//.test(draft.image.url)) {
      body = embedImage(body, draft.image);
      metaObj.image = [draft.image.url];
    }
    const permlink = String(draft.id).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80) || `saos-${day.replace(/-/g, "")}`;
    const firstTag = (draft.tags ?? [])[0] ?? "life";
    const ops = [["comment", { parent_author: "", parent_permlink: firstTag, author: account, permlink, title: draft.title, body, json_metadata: JSON.stringify(metaObj) }]];
    const res = await broadcastHive(ops, memHive[account], {});
    const rcDefer = !res.ok && /not enough RC mana|has_mana/i.test(String(res.error ?? ""));
    results.push({ account, verdict: res.ok ? "BROADCAST" : rcDefer ? "RC-DEFER" : "REJECTED", error: rcDefer ? null : (res.error ?? null), permlink: res.ok ? `${account}/${permlink}` : null, digest8: res.digest8 ?? null });
    appendLine(path.join(STATE, "events.jsonl"), { type: "hive.post", at: now, account, verdict: res.ok ? "BROADCAST" : rcDefer ? "RC-DEFER" : "REJECTED", permlink: res.ok ? `${account}/${permlink}` : null, node: res.node ?? null, error: rcDefer ? "rc-low (deferred, nothing consumed)" : String(res.error ?? "").slice(0, 120) });
    if (res.ok) {
      executed++;
      /* the draft is CONSUMED across chains: hivePosted marks it so the
       * steem rail never double-posts the same words (cheetah/re-post law) */
      draft.status = "published";
      draft.publishedAt = now;
      draft.publishedBy = account;
      draft.permlink = `${account}/${permlink}`;
      draft.chain = "hive";
      writeJson(path.join(DIR, "state", "content-ops.json"), c);
    }
  }
  const accountsToday = { ...(prev.day === day ? (prev.accounts ?? {}) : {}) };
  for (const r of results) if (r.verdict === "BROADCAST") accountsToday[r.account] = (accountsToday[r.account] ?? 0) + 1;
  const doc = {
    at: now, day, verdict: executed > 0 ? "HIVE-EXECUTED" : "HIVE-IDLE",
    custody: { verified: custody.verified, total: custody.total },
    accounts: accountsToday, receipts: [...(prev.day === day ? (prev.receipts ?? []) : []), ...results.filter((r) => r.permlink)].slice(-40),
    fleetPaused: prev.fleetPaused ?? null, results, executed,
    caps: "probe: ≤1 post/day/account · ≤limit fleet · votes OFF · veto-armed",
    ms: Date.now() - t0,
  };
  writeJson(HIVE_OPS_FILE, doc);
  return doc;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHiveRail({}).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("HIVE-FAIL", e); process.exit(1); });
}
