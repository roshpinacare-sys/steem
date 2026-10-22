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
import { vaultPass } from "./vault-custody.mjs";
import { spamVerdict, flagPauseVerdict } from "./spamgate.mjs";
import { wordCount, MIN_POST_WORDS, titleSimilarity, recentPublishedTitles } from "./content.mjs";
import { embedImage } from "./illustrate.mjs";
import { mulberry32, hashSeed } from "./curator.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const HIVE_OPS_FILE = path.join(STATE, "hive-ops.json");
const FLAG_PAUSES_FILE = path.join(STATE, "flag-pauses.json");
const SECRETS = path.join(DIR, "..", "..", ".secrets");
const TMP = path.join(SECRETS, "hive-vault-tmp");

/* GEN-1 vault locator — R297 ADOPTS THE R278 ERA-META LAW (measured live
 * 2026-10-09 17:10Z: the pinned short-sha 1c9f00d0 died out of history and
 * the Hive hold fell to UNLOCK-FAIL while the army stayed 14/14 on the very
 * same vault — vault-revival.mjs carried the fix, hive.mjs never got it).
 * Resolution order: the era meta on any carrying ref (branch of record →
 * main → HEAD), the historical (commit, recovery-meta) carrier LAST. The
 * era meta OWNS the zip path + pass + both sha-pins (a re-seal moves file
 * AND pass together — R265). Nothing trusts the locator: outer sha-pin,
 * inner sha-pin, passphrase and the live-chain WIF verification below all
 * still fail-closed. */
const GEN1_ZIP = "agent/vault/KEYS-ZIP-2026-09-10.zip.enc";
const GEN1_META = "agent/recovery-meta.json";
const GEN1_ERA_META = "agent/vault/GEN-1-ERA-META.json";
const GIT_REF_CANDIDATES = ["origin/saos-cockpit", "origin/main", "HEAD"];
const GEN1_COMMIT = "1c9f00d0"; /* historical hint only — may be dead */

function resolveGen1Spec() {
  const candidates = [
    ...GIT_REF_CANDIDATES.map((ref) => ({ ref, metaRef: GEN1_ERA_META })),
    { ref: GEN1_COMMIT, metaRef: GEN1_META }, /* historical carrier */
  ];
  for (const c of candidates) {
    try { gitShowBytes(c.ref, c.metaRef); return c; } catch { /* try next */ }
  }
  throw new Error(`no-carrying-ref-for-gen1-meta (tried ${candidates.length} carriers)`);
}

/* G50 2026-10-22: these 9 hold FULL custody on Hive again (owner+active+
 * posting all match the MASTER-vault pubs — live-measured 0/27 → 27/27).
 * History: 2026-10-07 GEN-1 custody held; at some later rotation the HIVE
 * active/posting moved off the held pubs (owner stayed) — G50 re-installed
 * the vault pubs ADDITIVELY (account_update2 owner-elevation, no removals,
 * no owner/memo change) via hive-authority-upgrade.mjs; idempotent re-run
 * reports already-live for all 9. tov/headcorner: owner-rotated on Hive
 * (no owner-match) — not eligible; hcsoldier4/5/6 born post-fork. */
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
let memHive = {};        // account → posting WIF (never persisted)
let memHiveActive = {};  // account → active WIF (never persisted) — R262: Hive profile writes demand ACTIVE

function gitShowBytes(commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], { cwd: path.join(DIR, "..", ".."), maxBuffer: 64 * 1024 * 1024 });
}

/** pull + decrypt GEN-1, extract posting AND active WIFs for HIVE_ROSTER into
 * MEMORY. Fail-closed: sha-pins both layers; wipes the plaintext tmp immediately.
 * R262: the active WIF joins the memory-only set — the Hive node JUDGED live
 * (2026-10-08) that account_update2 profile writes demand ACTIVE authority on
 * Hive ("Missing Active Authority"), unlike the Steem posting_json_metadata
 * lane. Full custody was already measured (owner+active+posting all match the
 * GEN-1 pubs) — we simply were not carrying the key. */
/**
 * pickVaultKey — R265 VAULT-SHAPE LAW (pure, selftest-locked).
 * Two record shapes live in vault history: the roster's flat
 * keys.{posting,active}.wif and the master records' per-chain
 * keys.{chain}.{role}.wif. The chain-specific record WINS when present
 * (it is the only shape that can differ per chain); the flat record is the
 * fallback. Measured R265: headcorner's GEN-1 record carried a per-chain
 * hive entry whose wif field disagreed with its own pub — the SHAPE law is
 * not enough by itself; the caller still verifies every WIF against the
 * live authority (fail-closed, nothing here trusts a record).
 */
export function pickVaultKey(rec, role, chain = "hive") {
  if (!rec) return null;
  const perChain = rec.keys?.[chain]?.[role]?.wif;
  if (perChain) return perChain;
  const flat = rec.keys?.[role]?.wif;
  if (flat) return flat;
  return null;
}

function unlockHiveKeysFromGitVault() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  try {
    const spec = resolveGen1Spec();
    const meta = JSON.parse(gitShowBytes(spec.ref, spec.metaRef).toString("utf8"));
    /* R297/R265: the archive path is OWNED BY THE META of that era — a
     * re-seal moves the file AND the pass together; GEN1_ZIP stays as a
     * fallback for metas from before the field existed. */
    const enc = gitShowBytes(spec.ref, String(meta.keysZipFile ?? GEN1_ZIP));
    if (sha256(enc) !== String(meta.keysZipSha256 ?? "")) throw new Error("gen1-outer-sha-mismatch");
    fs.writeFileSync(path.join(TMP, "k.enc"), enc, { mode: 0o600 });
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", path.join(TMP, "k.enc"), "-out", path.join(TMP, "inner.zip"),
      "-pass", `pass:${vaultPass(meta.keysZipUnlockRef ?? "gen1.keysZipUnlock")}`], { stdio: ["ignore", "ignore", "pipe"] });
    const inner = fs.readFileSync(path.join(TMP, "inner.zip"));
    if (sha256(inner) !== String(meta.keysZipInnerSha256 ?? "")) throw new Error("gen1-inner-sha-mismatch");
    fs.writeFileSync(path.join(TMP, "inner.zip"), inner, { mode: 0o600 });
    execFileSync("unzip", ["-o", "-q", path.join(TMP, "inner.zip"), "agent/keys/vault.json", "-d", path.join(TMP, "o")]);
    const vault = JSON.parse(fs.readFileSync(path.join(TMP, "o", "agent", "keys", "vault.json"), "utf8"));
    const byName = new Map((vault.accounts ?? []).map((a) => [a.username, a]));
    const extracted = { posting: {}, active: {} };
    for (const name of HIVE_ROSTER) {
      const pwif = pickVaultKey(byName.get(name), "posting", "hive");
      if (pwif) extracted.posting[name] = pwif; // memory-only from here
      const awif = pickVaultKey(byName.get(name), "active", "hive");
      if (awif) extracted.active[name] = awif;  // memory-only from here
    }
    return extracted;
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
}

/** verify one WIF against the LIVE Hive chain authority of the given role */
async function verifyHiveAuthority(account, wif, role = "posting") {
  const acc = await rpcHive("condenser_api.get_accounts", [[account]]);
  const auth = acc.ok ? acc.result?.[0]?.[role]?.key_auths?.[0]?.[0] : null;
  if (!auth) return { ok: false, reason: `no-live-${role}-authority` };
  let derived = null;
  try { derived = pubkeyFromSeed(wifDecode(String(wif).trim())); } catch { return { ok: false, reason: "wif-decode-fail" }; }
  if (derived !== auth) return { ok: false, reason: "authority-mismatch", derived };
  return { ok: true, pubkey: derived };
}

/** verify one WIF against the LIVE Hive chain posting authority (kept name —
 * used by every rail) */
async function verifyHivePosting(account, wif) {
  return verifyHiveAuthority(account, wif, "posting");
}

/** idempotent custody pass: unlock + verify all roster accounts (posting AND
 * active — both are required: posts/replies sign posting, profile writes sign
 * active, per the node's live judgment). Returns verdict-only state. */
export async function hiveCustody({ now = new Date().toISOString() } = {}) {
  const results = {};
  let verified = 0;
  try {
    if (Object.keys(memHive).length === 0) {
      const unlocked = unlockHiveKeysFromGitVault();
      memHive = unlocked.posting;
      memHiveActive = unlocked.active;
    }
    for (const name of HIVE_ROSTER) {
      const wif = memHive[name];
      if (!wif) { results[name] = "NO-GEN1-KEY"; continue; }
      const v = await verifyHivePosting(name, wif);
      results[name] = v.ok ? "VERIFIED-VS-HIVE-CHAIN" : `REFUSED:${v.reason}`;
      if (v.ok) { memHive[name] = wif; verified++; }
      else delete memHive[name];
      /* the active key verifies too when present — profile writes depend on it */
      const awif = memHiveActive[name];
      if (awif) {
        const av = await verifyHiveAuthority(name, awif, "active");
        if (av.ok) memHiveActive[name] = awif;
        else delete memHiveActive[name];
      }
    }
  } catch (e) {
    const doc = { at: now, verdict: "UNLOCK-FAIL", error: String(e?.message ?? e).slice(0, 140) };
    writeJson(path.join(STATE, "hive-custody.json"), doc);
    appendLine(path.join(STATE, "events.jsonl"), { type: "hive.custody", at: now, ...doc });
    return { ...doc, verified: 0, results: {} };
  }
  const activeCount = Object.keys(memHiveActive).length;
  const doc = { at: now, verdict: verified === HIVE_ROSTER.length ? "HIVE-CUSTODY-ALIVE" : verified > 0 ? "PARTIAL" : "NONE", verified, total: HIVE_ROSTER.length, activeVerified: activeCount, results, law: "GEN-1 git vault → sha-pin → memory-only WIF → live Hive authority match (posting + active)" };
  writeJson(path.join(STATE, "hive-custody.json"), doc);
  appendLine(path.join(STATE, "events.jsonl"), { type: "hive.custody", at: now, verdict: doc.verdict, verified, total: HIVE_ROSTER.length, activeVerified: activeCount });
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

/** R262: send ops signed by the ACTIVE key (Hive profile writes — the node
 * judged: "Missing Active Authority" for account_update2). Memory-only. */
export async function sendAsActive(account, ops) {
  const wif = memHiveActive[account];
  if (!wif) return { ok: false, verdict: "NO-MEMORY-ACTIVE-WIF", reason: "active key not custody-verified" };
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

/* MEASURED (2026-10-07, node-judged): a ≥1600-char post at our tiny stake
 * costs ~2.3B RC (node rejected cashmachine@1.52B-available and haran@1.78B
 * with "needs 2301883372"). available = current + regen since update
 * (full regen = 5 days). Broken-stake accounts defer honestly — a node
 * rejection also maps to defer (fail-soft, nothing consumed).
 * R262: exported — the RC mutual-aid pool (rc-pool.mjs) plans lifts against
 * this measured line, one source of truth. */
export const POST_RC_COST = 2_300_000_000;

async function rcOk(account) {
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

/* pure (R262): the RC-fit draft pick — every queued draft passed the same
 * quality gates (≥300 words), so among ELIGIBLE drafts the SHORTEST one
 * gives a budget-limited account its best chance to actually fit under the
 * RC line. Quality is not traded: the pool is pre-sanitized. */
export function pickRcFitDraft(queue) {
  const eligible = (Array.isArray(queue) ? queue : []).filter((d) => d?.status === "drafted" && wordCount(d.body) >= MIN_POST_WORDS);
  if (!eligible.length) return null;
  return eligible.slice().sort((a, b) => wordCount(a.body) - wordCount(b.body))[0];
}

/* ── R263 · THE PERSONA-AFFINITY PICK (voice and profile are ONE identity) ──
 * The chain audit (R263 opening): drafts carry a persona tag from the
 * writers' room, and every account wears its persona ON CHAIN (profile
 * name/about/images). A draft tagged persona:cashmachine reads wrong when
 * haran's profile ships it — the reader sees one person in two bodies.
 * LAW: among eligible drafts, the one whose persona == the publishing
 * account wins; when none matches, the RC-fit fallback keeps quality (the
 * pool is pre-sanitized, so the fallback trades affinity, never law).
 * Pure, selftest-locked. */
export function pickPersonaFitDraft(queue, account) {
  const eligible = (Array.isArray(queue) ? queue : []).filter((d) => d?.status === "drafted" && wordCount(d.body) >= MIN_POST_WORDS);
  const own = eligible.find((d) => d.persona === account);
  if (own) return own;
  return eligible.slice().sort((a, b) => wordCount(a.body) - wordCount(b.body))[0] ?? null;
}

/* ── R263 · THE STAGGERED POST WINDOW (operator order verbatim intent:
 * "ופרסמו כל אחד בזמנו לא צריך כולם עכשיו" — each account publishes in its
 * OWN seeded minute, never a synchronized fleet burst). Same auditability
 * law as every lane: mulberry32(day|account) inside 07:00-23:00 UTC,
 * deterministic → reproducible post-hoc from state. The window OPENS at its
 * minute (like the hive-social lanes): a pass before the minute defers
 * honestly with SCHEDULE-LATER, a pass after it may ship. Pure. */
export const POST_WINDOW = { minMinute: 7 * 60, maxMinute: 23 * 60 };
export function hivePostMinuteFor(account, dayIso) {
  const rand = mulberry32(Number(hashSeed(`${dayIso}|${account}|hive-post`)) >>> 0);
  return Math.floor(POST_WINDOW.minMinute + rand() * (POST_WINDOW.maxMinute - POST_WINDOW.minMinute));
}
const minuteOfDayUtc = (iso) => { const d = new Date(iso); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

/* ── R263 · THE HUMAN PERMLINK (spaminator optics + SEO craft) ──────────────
 * The chain audit (R263 opening) showed Hive permlinks like
 * `d1791392700696-5` (raw draft ids): machine-shaped, and spaminators read
 * machine shapes. The permlink is now a TITLE SLUG — the same craft the
 * Steem rail ships — with the draft id only as fallback. Laws: lowercase
 * [a-z0-9-], no leading/trailing dash, STARTS WITH A LETTER (the node
 * contract), ≤64 chars. Pure, selftest-locked. */
export function slugPermlink(title, fallback = "") {
  const clean = (s) => String(s ?? "").toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  let slug = clean(title);
  if (slug && /^[0-9]/.test(slug)) slug = `post-${slug}`.slice(0, 64).replace(/-+$/g, "");
  if (slug.length >= 8 && /^[a-z]/.test(slug)) return slug;
  const fb = clean(fallback);
  if (fb && /^[0-9]/.test(fb)) return `post-${fb}`.slice(0, 64).replace(/-+$/g, "");
  return (fb.length >= 8 && /^[a-z]/.test(fb)) ? fb : "saos-post";
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
  /* RC-sorted roster: the strongest accounts speak first (measured, not vibes).
   * R263 · THE STAGGERED WINDOW gate runs FIRST (a pure map lookup, zero RPC):
   * an account whose seeded post minute has not arrived yet defers honestly —
   * the fleet never bursts in sync, each voice speaks in its own time. */
  const nowMin = minuteOfDayUtc(now);
  const order = [];
  for (const account of HIVE_ROSTER) {
    if (pauseActive(account)) { results.push({ account, verdict: "PAUSED-DOWNVOTE" }); continue; }
    const postMinute = hivePostMinuteFor(account, day);
    if (postMinute > nowMin) { results.push({ account, verdict: "SCHEDULE-LATER", postMinuteUtc: postMinute }); continue; }
    if (custody.results[account] !== "VERIFIED-VS-HIVE-CHAIN") { results.push({ account, verdict: custody.results[account] }); continue; }
    if (!(await rcOk(account))) { results.push({ account, verdict: "RC-LOW-HONEST-DEFER" }); continue; }
    const used = (prev.day === day ? (prev.accounts?.[account] ?? 0) : 0);
    if (used >= 1) { results.push({ account, verdict: "DAY-CAP" }); continue; }
    order.push({ account });
  }
  for (const { account } of order.slice(0, Math.max(0, limit))) {
    /* R263: persona-affinity first (voice == profile identity), RC-fit fallback */
    const draft = pickPersonaFitDraft(queue, account); // R262+R263: quality gates pre-passed; affinity then brevity
    if (!draft) { results.push({ account, verdict: "NO-DRAFT" }); continue; }
    const clash = recentTitles.find((t) => titleSimilarity(t, draft.title) >= 0.5);
    if (clash) { results.push({ account, verdict: "MONOCULTURE-VETO" }); continue; }
    const gate = spamVerdict(draft, { isComment: false, chain: "hive", ownRecentBodies: await ownRecentHiveBodies(account), postsToday: await postsTodayHive(account, day), dayCap: 1 });
    if (!gate.ok) {
      /* R299 PARITY (measured 96 wasted refusals/24h on the sibling rail): the
       * Steem rail marks the refused draft so a static draft is never re-picked
       * forever; the Hive rail now does the same — refusal leaves the queue. */
      draft.status = "refused-spam";
      draft.spamgate = { at: now, reasons: gate.reasons.slice(0, 6) };
      writeJson(path.join(DIR, "state", "content-ops.json"), c);
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
    /* R263: the HUMAN permlink — a title slug (SEO craft, spaminator optics),
     * the machine draft id only a fallback */
    const permlink = slugPermlink(draft.title, String(draft.id));
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
      /* R337 · the hive broadcast becomes a memory pattern TOO — the R303
       * book was steem-only by accident of wiring, not doctrine ("hive
       * bodies invisible" was R336's named limitation). Best-effort, the
       * R303 arc-law shape: a memory failure never un-publishes chain
       * truth. chain:"hive" rides in the record AND the id. */
      try {
        const { recordPublished } = await import("./content-memory.mjs");
        recordPublished(STATE, { account, permlink, title: draft.title, body, score: null, chain: "hive", at: now });
      } catch (e) {
        appendLine(path.join(STATE, "events.jsonl"), { type: "hive.memory-record-error", at: now, account, error: String(e?.message ?? e).slice(0, 120) });
      }
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
