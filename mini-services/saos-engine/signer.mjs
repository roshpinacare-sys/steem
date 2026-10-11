/**
 * signer.mjs — the X-1 rail, engine-held: doctrine-bounded execution.
 *
 * SECURITY CONTRACT:
 *  - credential lives ONLY in .secrets/ (0600, gitignored) and process memory
 *  - WIFs are derived on demand, held in a module map, NEVER returned/logged
 *  - all public output: pubkeys, fingerprints (8 hex), booleans, txids
 *  - seed-composition order is SELF-VERIFIED against on-chain authorities —
 *    no guessing: the order that reproduces the account's own public keys wins
 *
 * SAFETY DOCTRINE (carried from T-8, now enforced at sign time):
 *  - exec-armed.json (.secrets/) is the standing order; state/exec-pause.json
 *    (written by the cockpit pause button) is the operator kill-switch
 *  - caps: maxOpsPerCycle, per-order max, SBD bid reserve, RC floor
 *  - batched into ONE atomic tx per cycle → all-or-nothing, fail-closed
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall, accountState } from "./measure.mjs";
import { SEED_ORDERS, wifFor, derivePub, buildTx, fingerprint, OP_IDS } from "./steemtx.mjs";
import { resolveClaimRole } from "./adaptation.mjs";
import { validateCredentialText, vpSpoilage, stickyNodeOrder, credentialGate, doctrineAccount } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const SECRETS = path.join(DIR, "..", "..", ".secrets");
const KEY_FILE = path.join(SECRETS, "headcorner.key");
const ARMED_FILE = path.join(SECRETS, "exec-armed.json");
const STATE = path.join(DIR, "state");
const PAUSE_FILE = path.join(STATE, "exec-pause.json");
const LOG_FILE = path.join(STATE, "exec-log.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); }; /* R235: atomic — rename is the commit point */
const SOLDIERS_SECRET = path.join(SECRETS, "soldiers.json");
const UPLOAD_KEY = path.join(DIR, "..", "..", "upload", "headcorner.txt");
const THINK_LOG = path.join(STATE, "think-log.jsonl");

/* ── T-80 · THE THINK GATE (operator order 2026-10-04, verbatim law):
 * "חייב לעצור ולבחון מה הסוכנים עושים ושיחשבו תמיד לפני שהם עושים דברים
 * כי הכל רץ אוטומטית בלי שכל ואינטילגנציה".
 * Every broadcast — no exceptions, no bypass — passes a mandatory REASONING
 * gate BEFORE any signing material is touched:
 *   1. CUSTODY: the signing account must have PROVEN custody (a verified
 *      credential that reproduces chain authorities). Keyless accounts are
 *      never signed for, never funded, never grid-run — instant typed refusal.
 *   2. FUNDS POLICY: outbound transfers (money leaving our accounts) are
 *      FORBIDDEN by default — policy.allowTransfersOut=false; an explicit
 *      allowlist is the only bypass. The measured leak (30 STEEM auto-topped
 *      into keyless hcsoldier1/2/3 on 09-30) dies here structurally.
 *   3. DELEGATION POLICY: delegate_vesting_shares is FORBIDDEN by default —
 *      policy.allowDelegation=false. The measured exposure (48,393 VESTS ×
 *      10 old-army accounts 09-29 + ~30k VESTS to keyless soldiers 10-04,
 *      both broadcast outside any gate) dies here structurally.
 * Every verdict — ALLOW and REFUSED alike — is journaled to think-log.jsonl
 * with the reasons, so "what did the agents think" is always answerable. */
export function custodyOf(name) {
  if (name === masterAccount()) return mem.identities[name]?.verified?.ok ? "master-verified" : "master-unverified";
  const id = mem.identities[name];
  if (id?.verified?.ok) return "verified";
  try {
    const s = readJson(SOLDIERS_SECRET, null);
    if ((s?.accounts ?? []).some((a) => a.name === name)) return "keyed-unverified";
  } catch { /* secrets unreadable = no custody evidence */ }
  return "no-custody";
}

/* ── T-86 · GIT-VAULT ARMY CUSTODY (the operator's law, 2026-10-06):
 * "אין מה לבקש מפתחות — הכל בכספת בגיט" — the vault IS the delivery, so
 * direct WIF adoption is the lawful revival path. FAIL-CLOSED LAW: a WIF is
 * adopted ONLY after its derived public key matches the account's LIVE
 * on-chain posting authority (the chain is the only judge — same law as
 * keymine). The WIF lives ONLY in memory (mem.identities) + the 0600 local
 * cache file; nothing is ever logged/returned but fingerprints. */
export async function adoptVerifiedWifIdentity(account, wif, { role = "posting", chainPubkeys = null } = {}) {
  try {
    const { wifDecode, pubkeyFromSeed } = await import("./steemtx.mjs");
    const seed32 = wifDecode(String(wif).trim()); // throws on checksum/format fail
    const derived = pubkeyFromSeed(seed32);
    let pubs = chainPubkeys;
    if (!pubs) {
      const r = await rpcCall("condenser_api.get_accounts", [[account]]);
      const acc = r.ok ? r.result?.[0] : null;
      if (!acc) return { ok: false, reason: "account-not-found" };
      /* R255 · ROLE-EXACT LAW (the old code compared EVERY role against the
       * POSTING authority — a live-chain-matching active wif was refused as
       * "posting-authority-mismatch", which silently amputated the active
       * role from the whole fleet). Each role is now judged against ITS OWN
       * live authority; the chain stays the only judge. */
      pubs = role === "active" ? (acc.active?.key_auths ?? []).map((k) => k[0])
        : role === "owner" ? (acc.owner?.key_auths ?? []).map((k) => k[0])
        : role === "memo" ? [acc.memo_key].filter(Boolean)
        : (acc.posting?.key_auths ?? []).map((k) => k[0]);
    }
    if (!pubs.includes(derived)) return { ok: false, reason: `${role}-authority-mismatch`, pubkey: derived };
    const fp = fingerprint(wif);
    /* R255 · IDENTITY MERGE: adopting a second role must ADD to the identity
     * already chain-verified in this process — the old whole-object replace
     * wiped the posting wif the moment an active wif was adopted (and vice
     * versa), breaking every later broadcast of the first role. */
    const prev = mem.identities[account];
    mem.identities[account] = {
      password: prev?.password ?? null,
      wifs: { ...(prev?.wifs ?? {}), [role]: String(wif).trim() },
      matchedOrder: "wif-direct",
      verified: {
        ok: true, account, matchedOrder: "wif-direct",
        roles: { ...(prev?.verified?.roles ?? {}), [role]: { pubkey: derived, matched: true } },
        fingerprint: fp,
      },
    };
    appendLine(LOG_FILE, { at: new Date().toISOString(), tag: "army-custody-adopted", account, role, fingerprint: fp, pubkey: derived, verdict: "VERIFIED-VS-CHAIN" });
    return { ok: true, account, role, pubkey: derived, fingerprint: fp };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
  }
}

/* army custody census (public-safe: counts + booleans only) */
export function armyCustodyState(roster) {
  const accounts = {};
  let verified = 0;
  for (const name of roster) {
    const c = custodyOf(name);
    accounts[name] = c;
    if (c === "verified" || c === "master-verified") verified++;
  }
  return { verified, total: roster.length, accounts };
}

export function thinkGate(account, ops, { source = "execute", conf = null, journal = true, custodyOverride = null } = {}) {
  /* R233: conf/journal/custody injection — the gate's LAW is unit-testable
   * offline now (selftest vectors cover every refusal class; the battery
   * proved untested law decays). Default behavior is unchanged for all
   * production callers: they pass none of the overrides. */
  const c = conf ?? armedConf();
  const pol = {
    allowTransfersOut: c.policy?.allowTransfersOut === true,
    allowDelegation: c.policy?.allowDelegation === true,
    /* R292 · pure-recall exception: a delegate_vesting_shares op with amount 0
     * removes an existing delegation — it can NEVER create or raise exposure.
     * Still requires its own policy bit so arming is a recorded decision. */
    allowDelegationRecall: c.policy?.allowDelegationRecall === true,
    transferAllowlist: Array.isArray(c.policy?.transferAllowlist) ? c.policy.transferAllowlist : [],
  };
  const custody = custodyOverride ?? custodyOf(account);
  const reasons = [];
  const shown = ops.map(([n, o]) => ({ op: n, to: o?.to ?? o?.delegatee ?? null, amount: o?.amount ?? o?.vesting_shares ?? null }));
  // 1 · custody first — a keyless account can never be a signing subject
  if (custody === "no-custody") {
    reasons.push(`custody:${account}=none — no credential on this machine; signing, funding and grid use are frozen (T-80)`);
    return finishThink({ account, source, verdict: "REFUSED", reasons, shown }, journal);
  }
  if (custody === "keyed-unverified") {
    reasons.push(`custody:${account}=keyed-but-unverified — credential present but never chain-proven this run; refusing until verifyRoles passes`);
    return finishThink({ account, source, verdict: "REFUSED", reasons, shown }, journal);
  }
  if (custody === "master-unverified") {
    /* R233 GAP (caught by writing the gate's own test vectors): the master
     * branch of custodyOf returns "master-unverified" in a fresh process —
     * the old gate only refused no-custody / keyed-unverified, so a present-
     * but-unverified MASTER credential slipped THROUGH every policy check.
     * Unreachable in the healthy engine (boot verification precedes cycles)
     * but the gate must stand alone — fail closed, zero deadlock risk
     * (verifyRoles derives + reads chain only, never routes through here). */
    reasons.push(`custody:${account}=keyed-but-unverified — master credential present but never chain-proven this run; refusing until verifyRoles passes`);
    return finishThink({ account, source, verdict: "REFUSED", reasons, shown }, journal);
  }
  // 6 · BRAND-DENYLIST (P0-2 · master plan 2026-10-11 · session 8fa4709b):
  // an account named after a real-world brand we do not own must never be a
  // signing subject nor an op counterparty. One accidental broadcast from
  // "ynet" creates real-world attribution to a major news outlet. Unconditional,
  // fail-closed, no policy bit can arm it — only the owner DecisionQueue may
  // ever change this list (divest: transfer or abandon the name entirely).
  const BRAND_DENYLIST = new Set(["ynet"]);
  const opActors = ops.flatMap(([, o]) => [o?.to, o?.delegatee, o?.voter, o?.author, o?.from, o?.new_account_name].filter(Boolean));
  const brandHit = [...opActors].find((a) => BRAND_DENYLIST.has(String(a)));
  if (BRAND_DENYLIST.has(account) || brandHit) {
    reasons.push(`brand-denylist: ${BRAND_DENYLIST.has(account) ? `subject account "${account}"` : `op counterparty "${brandHit}"`} is a protected real-world brand — signing or interacting as/with it is FORBIDDEN unconditionally (P0-2; impersonation exposure per disclosure-policy)`);
    return finishThink({ account, source, verdict: "REFUSED", reasons, shown }, journal);
  }
  // 2 · outbound funds policy
  for (const [opName, op] of ops) {
    if (opName === "transfer" && op?.to && op.to !== account) {
      const allowed = pol.allowTransfersOut || pol.transferAllowlist.includes(op.to);
      if (!allowed) reasons.push(`transfer→${op.to} (${op.amount ?? "?"}): outbound funds FORBIDDEN by standing policy (allowTransfersOut=false, not in allowlist)`);
    }
    // 3 · delegation policy — forbidden by default; the ONLY crack is a
    // pure recall (amount exactly 0) when allowDelegationRecall is armed:
    // zero-amount delegation removes exposure and cannot forge exposure.
    if (opName === "delegate_vesting_shares" && !pol.allowDelegation) {
      const amt = parseFloat(String(op?.vesting_shares ?? "").replace(/[^0-9.\-]/g, "")) || 0;
      const isPureRecall = amt === 0;
      if (!(isPureRecall && pol.allowDelegationRecall)) {
        reasons.push(`delegate_vesting_shares→${op?.delegatee ?? "?"} (${op?.vesting_shares ?? "?"}): delegation FORBIDDEN by standing policy (allowDelegation=false${isPureRecall ? "; zero-amount recall also blocked — allowDelegationRecall not armed" : "; only zero-amount recalls may pass when allowDelegationRecall is armed"})`);
      }
    }
    // 4 · T-91 power-up policy: transfer_to_vesting must be SELF-directed
    // (from=to=account — value never leaves) AND explicitly armed by the
    // operator's doctrine (operator.allowPowerUp). Un-armed, it is refused
    // like every other value-moving op — safe-by-default holds.
    if (opName === "transfer_to_vesting") {
      const selfDirected = op?.from === account && op?.to === account;
      const armed = c.operator?.allowPowerUp === true;
      if (!selfDirected || !armed) {
        reasons.push(`transfer_to_vesting (${op?.amount ?? "?"}): power-up ${!selfDirected ? "must be self-directed (from=to=account)" : "FORBIDDEN by standing policy (operator.allowPowerUp=false — T-91 doctrine not armed)"}`);
      }
    }
    // 5 · R246 account_create policy: the creation fee is REAL value leaving
    // the treasury to the chain. It is allowed ONLY under a live, single-use,
    // fee-capped, name-bound operator order recorded in
    // policy.operatorOrders.account_create. Absent/consumed order ⇒ REFUSED
    // (fail-closed). The operator's R246 order ("pay what's needed to open a
    // community") travels with the order record itself — provenance, not vibes.
    if (opName === "account_create") {
      const ord = c.policy?.operatorOrders?.account_create ?? null;
      if (!ord || typeof ord !== "object" || ord.used) {
        reasons.push(`account_create (${op?.new_account_name ?? "?"}): FORBIDDEN — ${!ord ? "no operator order on record (policy.operatorOrders.account_create required)" : "operator order already used (single-use law; consumed orders never re-arm)"}`);
      } else {
        const feeSteem = Number(String(op?.fee ?? "0 STEEM").split(" ")[0]) || 0;
        if (!(feeSteem <= Number(ord.maxFeeSteem ?? 0))) {
          reasons.push(`account_create (${op?.new_account_name ?? "?"}): fee ${op?.fee} exceeds the operator-order cap ${ord.maxFeeSteem} STEEM`);
        }
        if (ord.account !== op?.new_account_name) {
          reasons.push(`account_create: target ${op?.new_account_name ?? "?"} does not match the operator-order account ${ord.account ?? "?"}`);
        }
      }
    }
  }
  const verdict = reasons.length ? "REFUSED" : "ALLOW";
  return finishThink({ account, source, verdict, reasons, shown, custody }, journal);
}

/* R233: journal or dry-return — selftest uses journal:false (zero state writes) */
function finishThink(entry, journal) {
  if (!journal) return { verdict: entry.verdict, reasons: entry.reasons, custody: entry.custody ?? null };
  return journalThink(entry);
}

function journalThink(entry) {
  try { appendLine(THINK_LOG, { at: new Date().toISOString(), ...entry }); } catch { /* journal best-effort */ }
  return { verdict: entry.verdict, reasons: entry.reasons, custody: entry.custody ?? null };
}

/**
 * T-12 sovereign self-service: if the operator drops a credential file into
 * upload/ (headcorner.txt: "<account> <master-password|P-key>"), the engine
 * secures it (0600 into .secrets/, upload copy removed) and self-adopts it on
 * the next cycle — zero manual restart, zero key exposure in logs.
 */
export function syncCredential() {
  try {
    if (fs.existsSync(UPLOAD_KEY)) {
      fs.mkdirSync(SECRETS, { recursive: true });
      fs.copyFileSync(UPLOAD_KEY, KEY_FILE);
      fs.chmodSync(KEY_FILE, 0o600);
      fs.rmSync(UPLOAD_KEY, { force: true }); // T-78 SAFETY FIX: the key file ONLY — upload/ holds operator evidence (הד.txt, KEYS_BACKUP); the old whole-dir rmSync would have incinerated it on adoption
      appendLine(LOG_FILE, { at: new Date().toISOString(), tag: "credential-adopted", fingerprint: fingerprint(fs.readFileSync(KEY_FILE, "utf8").trim().split(/[\s:=]+/).filter(Boolean).slice(1).join(" ")) });
      // credential changed → invalidate every cached identity (memory only)
      for (const k of Object.keys(mem.identities)) delete mem.identities[k];
      mem.master = null;
      return true;
    }
    if (!fs.existsSync(KEY_FILE)) {
      // T-16: the credential was REMOVED while identities may be cached — a
      // stale verified:false (or worse, verified wifs) must never outlive the
      // credential it was derived from. Wipe so the next verifyRoles hits
      // loadCredential → typed CREDENTIAL-MISSING → the honest alarm state.
      /* R302 · VAULT-ADOPTED-CUSTODY LAW (caught live 2026-10-10: t38 adopted
       * the vault WIF chain-judged GEN-2 → the immediately-following
       * verifyRoles called syncCredential → KEY_FILE missing → the wipe
       * DESTROYED the just-adopted chain-proven identity → CUSTODY-REFUSED
       * loop forever while the vault's WIF is alive 14/14 on-chain). The
       * T-16 hazard is a credential DERIVED FROM THE KEY FILE outliving it.
       * A wif-direct adoption is NOT derived from the key file — it is
       * derived from the sha-pinned git vault and judged by the CHAIN
       * itself (adoptVerifiedWifIdentity role-exact live-authority match).
       * Its validity is independent of the key file. Such evidence-backed
       * identities are EXEMPT from key-file-missing wipes; the chain gate
       * (verifyRoles → get_accounts → authority match) remains the only
       * admission, and a broadcast failure still fail-closes. */
      const vaultAdopted = Object.entries(mem.identities)
        .filter(([, id]) => id?.verified?.ok && id?.verified?.matchedOrder === "wif-direct")
        .map(([k]) => k);
      if (Object.keys(mem.identities).length || mem.master) {
        for (const k of Object.keys(mem.identities)) {
          if (vaultAdopted.includes(k)) continue; // chain-judged custody survives key-file loss
          delete mem.identities[k];
        }
        if (Object.keys(mem.identities).length === 0) { mem.master = null; }
        mem.keyFileFp = null;
      }
      return false;
    }
    // also: same-file content change detection (sha256 fingerprint)
    const fp = fingerprint(fs.readFileSync(KEY_FILE, "utf8"));
    if (mem.keyFileFp && mem.keyFileFp !== fp) {
      for (const k of Object.keys(mem.identities)) delete mem.identities[k];
      mem.master = null;
    }
    mem.keyFileFp = fp;
  } catch { /* best effort */ }
  return false;
}

/* in-memory only — never serialized anywhere. One identity per account. */
const mem = { identities: {}, master: null, keyFileFp: null }; // account → { password, wifs:{role:wif}, matchedOrder, verified }

/**
 * T-16 · paste-revival (the fastest operator path — measured 2026-09-30: the
 * file-drop revival waited ~1 day with zero action; friction kills revival).
 * Validates the text (pure half in lib.mjs), secures it (0600, .secrets/),
 * invalidates every cached identity, journals ONLY the fingerprint (the
 * secret itself is never logged/returned). The caller (engine route) then
 * runs verifyRoles for instant on-chain truth before answering.
 */
export function adoptCredentialText(text, { source = "paste" } = {}) {
  const v = validateCredentialText(text);
  if (!v.ok) return { ok: false, reason: v.reason };
  /* T-21 IDENTITY-INTEGRITY GATE: a paste for a FOREIGN account is refused
   * at the door — nothing written, nothing cached, nothing measured. The
   * proven-live failure (2026-10-01: one diagnostic paste flipped every
   * measurement rail to "testuser" for hours) dies here. The account name
   * is public; the refusal is journaled WITHOUT any secret material. */
  const gate = credentialGate(v.account, masterAccount());
  if (!gate.allow) {
    appendLine(path.join(STATE, "events.jsonl"), { type: "cred.adopt-refused", at: new Date().toISOString(), source, account: v.account, doctrine: masterAccount(), reason: gate.reason });
    return { ok: false, reason: gate.reason, doctrineAccount: masterAccount() };
  }
  // same normalized split as the validator — the secret stays inside this scope
  const fields = String(text ?? "").trim().split(/[\s:=]+/).filter(Boolean);
  const secret = fields.slice(1).join(" ");
  try {
    fs.mkdirSync(SECRETS, { recursive: true });
    fs.writeFileSync(KEY_FILE, `${v.account} ${secret}\n`, { mode: 0o600 });
    fs.chmodSync(KEY_FILE, 0o600);
    const fp = fingerprint(secret);
    appendLine(LOG_FILE, { at: new Date().toISOString(), tag: "credential-adopted", source, account: v.account, fingerprint: fp });
    // credential changed → invalidate every cached identity (memory only)
    for (const k of Object.keys(mem.identities)) delete mem.identities[k];
    mem.master = null;
    mem.keyFileFp = null;
    appendLine(path.join(STATE, "events.jsonl"), { type: "cred.adopted", at: new Date().toISOString(), source, account: v.account, fingerprint: fp, verdict: "ADOPTED" });
    return { ok: true, account: v.account, fingerprint: fp };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
  }
}

/* ── T-15 credential-truth (loud, honest, journaled once/hour — no spam) ────
 * The cold-reset lesson: a dead signing layer must SCREAM, not rot. This
 * state is public-safe (booleans + paths + guidance — never key material). */
const CRED_ALARM_FILE = path.join(STATE, "cred-alarm.json");
function noteCredMissing() {
  try {
    const now = new Date().toISOString();
    const prev = readJson(CRED_ALARM_FILE, { missingSince: null, lastAlertAt: null, alerts: 0 });
    const hourAgo = Date.now() - 3600_000;
    if (!prev.missingSince) prev.missingSince = now;
    if (!prev.lastAlertAt || Date.parse(prev.lastAlertAt) < hourAgo) {
      prev.lastAlertAt = now;
      prev.alerts = (prev.alerts ?? 0) + 1;
      appendLine(LOG_FILE, { at: now, tag: "cred-missing", verdict: "SIGNING-DEAD", keyFile: KEY_FILE, revival: "drop upload/headcorner.txt → engine self-adopts (0600) on next cycle" });
      appendLine(path.join(STATE, "events.jsonl"), { type: "cred.missing", at: now, verdict: "SIGNING-DEAD", agentsAffected: ["curate", "execute", "soldiers"], revival: "upload/headcorner.txt" });
    }
    writeJson(CRED_ALARM_FILE, prev);
  } catch { /* best effort — never crash the caller on alarm bookkeeping */ }
}

/* T-21 · foreign-credential alarm: the file exists but names a DIFFERENT
 * account than the doctrine account of record. Signing is honestly dead
 * (FOREIGN-CREDENTIAL thrown); measurement stays on the doctrine account.
 * Journaled at most once/hour like the missing alarm — no spam. */
function noteForeignCredential(fileAcct) {
  try {
    const now = new Date().toISOString();
    const prev = readJson(CRED_ALARM_FILE, { missingSince: null, lastAlertAt: null, alerts: 0, foreignSince: null, foreignAccount: null });
    if (!prev.foreignSince || prev.foreignAccount !== fileAcct) { prev.foreignSince = now; prev.foreignAccount = fileAcct; }
    const hourAgo = Date.now() - 3600_000;
    if (!prev.lastAlertAt || Date.parse(prev.lastAlertAt) < hourAgo) {
      prev.lastAlertAt = now;
      prev.alerts = (prev.alerts ?? 0) + 1;
      appendLine(LOG_FILE, { at: now, tag: "cred-foreign", verdict: "SIGNING-DEAD", fileAccount: fileAcct, doctrine: masterAccount(), revival: `paste the ${masterAccount()} credential (cockpit wallet console)` });
      appendLine(path.join(STATE, "events.jsonl"), { type: "cred.foreign", at: now, verdict: "SIGNING-DEAD", fileAccount: fileAcct, doctrine: masterAccount(), agentsAffected: ["curate", "execute", "soldiers", "promo"] });
    }
    writeJson(CRED_ALARM_FILE, prev);
  } catch { /* best effort — never crash the caller on alarm bookkeeping */ }
}

export function credentialState() {
  let present = false;
  try { fs.accessSync(KEY_FILE, fs.constants.R_OK); present = true; } catch { present = false; }
  const alarm = readJson(CRED_ALARM_FILE, { missingSince: null, lastAlertAt: null, alerts: 0 });
  const conf = armedConf();
  /* T-21 transparency: the file's own account vs the doctrine account of
   * record — a difference is a FOREIGN credential (signing dead, honest). */
  const fileAcct = credentialFileAccount();
  const doctrine = masterAccount();
  const foreign = present && fileAcct != null && fileAcct !== doctrine;
  return {
    present,
    keyFile: ".secrets/headcorner.key",
    doctrineAccount: doctrine,
    credentialAccount: fileAcct,
    foreignCredential: foreign,
    foreignSince: foreign ? (alarm.foreignSince ?? null) : null,
    armedButNoCredential: !!conf.armed && !present,
    missingSince: present ? null : (alarm.missingSince ?? null),
    alerts: alarm.alerts ?? 0,
    agentsAffected: present ? (foreign ? ["curate", "execute", "soldiers", "promo"] : []) : ["curate", "execute", "soldiers", "promo"],
    revival: present
      ? (foreign ? `the key file holds "${fileAcct}" but the account of record is "${doctrine}" — paste the ${doctrine} credential in the wallet console` : null)
      : "drop the CURRENT master-password file as upload/headcorner.txt → engine secures+adopts automatically (0600, upload copy removed, zero restart)",
  };
}

/**
 * T-16 · VP-spoilage — the visible price of the blocked signing rail.
 * Measured: days blocked × doctrine vote quota foregone. Estimated: STEEM
 * from discovery's PUBLIC reward-fund math (never claimed as measured).
 * Earliest of the two clocks wins — sovereign's boot-time firstDownAt can be
 * YOUNGER than the real absence; the cred-alarm file knows the true start.
 */
export function spoilagePublic(now = new Date().toISOString()) {
  const sov = readJson(path.join(STATE, "sovereign.json"), null);
  const alarm = readJson(CRED_ALARM_FILE, { missingSince: null });
  const disc = readJson(path.join(STATE, "discovery.json"), null);
  const conf = armedConf();
  const firstDown = [sov?.cred?.firstDownAt, alarm?.missingSince].filter(Boolean).sort()[0] ?? null;
  const est = (disc?.opportunities ?? []).find((o) => o.id === "curation-share")?.potential ?? null;
  const s = vpSpoilage({ firstDownAt: firstDown, now, maxPerDay: conf.curate?.maxPerDay ?? 0, estSteemPerDay: est });
  return { ...s, note: est != null ? "STEEM part is ESTIMATED (public reward-fund math) · days/votes are measured" : "days/votes measured; no discovery estimate available yet" };
}

export function defaultArmedConf() {
  return {
    armed: true,
    note: "operator standing order 2026-09-29: full autonomous execution, doctrine-capped",
    maxOpsPerCycle: 12,
    maxAskSteemPerCycle: 200,
    maxBidSbdPerCycle: 20,
    bidReserveSbd: 0.5,
    minRcPct: 20,
    /* T-80 defaults are SAFE-BY-DEFAULT: outbound funds and delegation are
     * forbidden, soldier deployment is operator-gated (T-76 law). The
     * operator's exec-armed.json can only LOOSEN these explicitly. */
    policy: { allowTransfersOut: false, allowDelegation: false, transferAllowlist: [] },
    /* T-91: power-up (self vesting) is OFF until the operator explicitly
     * orders it — value NEVER leaves, but even self-vesting is a signing
     * behavior that only an explicit doctrine may arm. */
    operator: { allowSoldierDeploy: false, allowPowerUp: false },
    /* T-91 redeployment doctrine defaults (ratios sum to 1; floors = reserve;
     * R231 review: pacing law — ≤1 power-up/hour, ≤12/day, bounded churn): */
    redeploy: { buyBookPct: 0.5, powerUpPct: 0.3, reservePct: 0.2, liquidSteemFloor: 5, liquidSbdFloor: 0.5, minPowerUpSteem: 5, minIntervalSec: 3600, maxPerDay: 12 },
    soldiers: { enabled: false, count: 3, prefix: "hcsoldier", steemEach: 10, sbdEach: 2, minLevel: 0.2 },
    promo: { armed: true, perDay: 1, tags: ["steem", "defi", "marketmaking", "saos"] },
    // T-13: the measured fuel rail — VP put to work (posting key only, vote op
    // can never move funds). The operator ordered it implemented and running.
    // R311 ALIGNMENT: these values now mirror curatorPolicy() (R289 measured
    // yield-tune). The old embedded 10/60 (T-13-era) persisted into
    // exec-armed.json on first write and OVERRODE the measured 30/35 forever —
    // two policy layers disagreeing, the stale one winning: exactly the
    // "limitations without a reason" disease. One source of truth per number.
    curate: { enabled: true, maxPerDay: 30, baseWeightPct: 70, minWeightPct: 35, minVpEffPct: 35 },
    // T-19b HYPER-GRID: the measured volume layer (rc-probe economics:
    // equilibrium ≈32k ops/day at current SP; cap = the measured equilibrium,
    // not an arbitrary number). Governor + RC-floor + id-partition inside.
    hyperGrid: { enabled: true, tickMs: 3000, levels: 10, spacingBps: 15, ttlSec: 60, orderTtlSec: 3600, askBudgetPct: 0.12, minRcPct: 25, setpointPct: 50, burst: 3, maxOpsPerTick: 24, opsDayCap: 32000, chainTailSec: 60 },
  };
}

export function armedConf() {
  const d = readJson(ARMED_FILE, null);
  if (!d) {
    const def = defaultArmedConf();
    try { fs.mkdirSync(SECRETS, { recursive: true }); fs.writeFileSync(ARMED_FILE, JSON.stringify(def, null, 2)); } catch { /* read-only fs */ }
    return def;
  }
  // shallow-merge: the operator's file wins on keys it defines, new doctrine
  // blocks (e.g. T-13 curate) appear without touching the operator's file
  return { ...defaultArmedConf(), ...d };
}

export function execPaused() { return readJson(PAUSE_FILE, { paused: false })?.paused === true; }

function identity(account) {
  if (!mem.identities[account]) mem.identities[account] = { password: null, wifs: {}, matchedOrder: null, verified: null };
  return mem.identities[account];
}

export function loadCredential(account = null) {
  let acct, password;
  if (account && account !== masterAccount()) {
    const s = readJson(SOLDIERS_SECRET, null);
    const rec = (s?.accounts ?? []).find((a) => a.name === account);
    if (!rec) throw new Error(`no-credential: ${account}`);
    acct = rec.name; password = rec.password;
  } else {
    let raw;
    try {
      raw = fs.readFileSync(KEY_FILE, "utf8");
    } catch (e) {
      // T-15 LOUD ALARM (measured live 2026-09-30: cold-reset wiped .secrets/;
      // 3 agents died SILENTLY every cycle for a whole day — curate/execute/
      // soldiers all rotting with raw ENOENT). A missing credential is a
      // TYPED, actionable state — never a generic ENOENT again:
      if (/ENOENT|no such file/i.test(String(e?.message ?? e))) {
        /* R302 · VAULT-ADOPTED-CREDENTIAL LAW (measured live 2026-10-10 05:11:
         * after the sandbox fall the grid kept journaling CREDENTIAL-MISSING
         * every 45s WHILE the same process held 29 chain-verified vault WIFs
         * (posting+active VERIFIED-VS-CHAIN) — the gate read the FILE, the
         * evidence sat in MEMORY). The file is ONE delivery channel, never
         * the custody itself. If a chain-judged wif-direct identity for this
         * account is already in memory (adoptVerifiedWifIdentity → the
         * chain matched its own live authority), the credential EXISTS —
         * hasPassword:false (no derivation path needed; signing uses the
         * adopted role WIFs and fail-closes per-broadcast). Without such an
         * identity the typed alarm still throws — fail-closed preserved. */
        const probe = account ?? masterAccount();
        const mid = mem.identities[probe];
        if (mid?.verified?.ok && mid?.verified?.matchedOrder === "wif-direct") {
          return { account: probe, hasPassword: false };
        }
        noteCredMissing();
        throw new Error(
          "CREDENTIAL-MISSING: .secrets/headcorner.key not found (sandbox cold-reset wipes gitignored secrets). " +
          "OPERATOR LAW 2026-10-06 (\"אין מה לבקש מפתחות — הכל בכספת בגיט\"): the operator is NEVER asked for secrets. " +
          "Self-revival is automatic: reviveArmyCustody (cycle step 1) pulls the git vault, chain-verifies the master WIF, " +
          "and writes this marker itself — no operator action exists or is required. Seeing this message means the custody " +
          "step did not run first — an engine sequencing bug, never an operator task."
        );
      }
      throw e;
    }
    const fields = raw.trim().split(/[\s:=]+/).filter(Boolean);
    if (fields.length < 2) throw new Error("credential-format");
    acct = fields[0]; password = fields.slice(1).join(" ");
    /* T-21: a credential file for a FOREIGN account is a typed honest
     * kill of SIGNING — measurement rails keep running on the doctrine
     * account (masterAccount() never reads this file anymore). */
    if (acct !== masterAccount()) {
      noteForeignCredential(acct);
      throw new Error(`FOREIGN-CREDENTIAL: the key file holds "${acct}" but this engine's account of record is "${masterAccount()}" — the marker is written by the git-vault revival (reviveArmyCustody), never by hand; re-run the custody step`);
    }
  }
  const id = identity(acct);
  id.password = password;
  return { account: acct, hasPassword: !!password };
}

export function masterAccount() {
  if (mem.master) return mem.master;
  /* T-21 IDENTITY-INTEGRITY LAW (the proven-live hijack, killed):
   * the account of record is the DOCTRINE account — NEVER the first field
   * of a credential file. A wrong or hostile paste can kill SIGNING (typed
   * CREDENTIAL-MISSING / FOREIGN-CREDENTIAL below) but can never steal
   * MEASUREMENT: RC, book ownership, cancels, governor economics all stay
   * pinned to the doctrine account no matter what lands in .secrets/. */
  mem.master = doctrineAccount(process.env.SAOS_ACCOUNT);
  return mem.master;
}

/** the credential file's own account field (public info) — transparency
 * only: it can DIFFER from masterAccount() (foreign credential), and that
 * difference must be visible, not silent. Never used for routing. */
export function credentialFileAccount() {
  try {
    const raw = fs.readFileSync(KEY_FILE, "utf8");
    return raw.trim().split(/[\s:=]+/).filter(Boolean)[0] ?? null;
  } catch { return null; }
}

export function credentialFingerprint(account = null) {
  loadCredential(account);
  return fingerprint(identity(account ?? masterAccount()).password);
}

/** verify derived keys against the chain's own authorities (self-proving) */
export async function verifyRoles(account = null) {
  syncCredential();
  const acct = account ?? masterAccount();
  const id = identity(acct);
  if (id.verified) return id.verified;
  loadCredential(acct);
  const r = await rpcCall("condenser_api.get_accounts", [[acct]]);
  const acc = r.ok ? r.result?.[0] : null;
  if (!acc) return { ok: false, reason: "account-not-found" };
  const chain = {
    owner: (acc.owner?.key_auths ?? []).map((k) => k[0]),
    active: (acc.active?.key_auths ?? []).map((k) => k[0]),
    posting: (acc.posting?.key_auths ?? []).map((k) => k[0]),
    memo: acc.memo_key ? [acc.memo_key] : [],
  };
  let matchedOrder = null;
  for (const [name, compose] of Object.entries(SEED_ORDERS)) {
    const pk = derivePub(compose(acct, "active", id.password));
    if (chain.active.includes(pk)) { matchedOrder = name; break; }
  }
  if (!matchedOrder) {
    // engine-derived pubkeys from THIS credential (steem-js standard order) —
    // if the operator installs these (steemit.com → Permissions), the engine
    // becomes the account's controller on the next verification pass
    const composeStd = SEED_ORDERS["name+role+pw"];
    const proposed = {};
    for (const role of ["owner", "active", "posting", "memo"]) {
      proposed[role] = derivePub(composeStd(acct, role, id.password));
    }
    return {
      ok: false,
      verdict: "CREDENTIAL-MISMATCH",
      reason: "derived pubkeys do not match this account's on-chain authorities under any standard scheme — the credential was likely never installed (or belongs to a different account)",
      fingerprint: fingerprint(id.password),
      proposedPubkeys: proposed,
      guidance: "operator law (2026-09-10 + 2026-10-06, standing): the operator is NEVER asked for secrets — the git vault is the only adoption channel and the automatic vault revival (chain-judged wif-direct) keeps signing regardless of any pasted credential. This mismatch is informational for a manually-pasted credential only; no action by the operator is required or wanted.",
    };
  }
  const roles = {};
  for (const role of ["owner", "active", "posting", "memo"]) {
    const compose = SEED_ORDERS[matchedOrder];
    const seed = compose(acct, role, id.password);
    const pk = derivePub(seed);
    roles[role] = { pubkey: pk, matched: (chain[role] ?? []).includes(pk) };
    if (roles[role].matched) id.wifs[role] = wifFor(seed); // memory only
  }
  id.matchedOrder = matchedOrder;
  id.verified = {
    ok: roles.active.matched,
    account: acct,
    matchedOrder,
    roles: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, { pubkey: v.pubkey, matched: v.matched }])),
    fingerprint: fingerprint(id.password),
  };
  return id.verified;
}

/** public status (safe for APIs/UI) */
export async function execStatus() {
  const conf = armedConf();
  const cred = credentialState();
  let master = null;
  try { master = masterAccount(); } catch { master = "headcorner"; }
  let ver = null;
  try { ver = await verifyRoles(master); } catch (e) { ver = { ok: false, reason: String(e?.message ?? e).slice(0, 120) }; }
  return {
    credentialPresent: cred.present,
    credential: cred,
    fingerprint: ver?.fingerprint ?? null,
    account: master,
    credentialAccount: credentialFileAccount(),
    armed: conf.armed && !execPaused(),
    standingOrder: conf.armed,
    operatorPaused: execPaused(),
    verdict: ver?.verdict ?? (ver?.ok ? "VERIFIED" : null),
    caps: { maxOpsPerCycle: conf.maxOpsPerCycle, maxAskSteemPerCycle: conf.maxAskSteemPerCycle, maxBidSbdPerCycle: conf.maxBidSbdPerCycle, minRcPct: conf.minRcPct },
    soldiers: conf.soldiers,
    promo: conf.promo,
    curate: conf.curate ?? null,
    roles: ver?.roles ?? null,
    matchedOrder: ver?.matchedOrder ?? null,
    reason: ver?.reason ?? null,
    guidance: ver?.guidance ?? null,
    proposedPubkeys: ver?.proposedPubkeys ?? null,
  };
}

/* ── broadcast: own node loop so error details survive (fail-closed) ───────
 * T-17: STICKY node order + 8s per-node timeout. Measured 2026-09-30: the
 * fixed node order burned up to 15s on a dead/slow first node for EVERY tx
 * (~60s/vote, ~18min/curate run — the tx layer was the "slow and stupid"
 * hotspot). The last node that ACTUALLY accepted a broadcast is tried
 * first from then on; failover stays deterministic (stickyNodeOrder). */
const BROADCAST_NODES = ["https://steemapi.boylikegirl.club", "https://api.justyy.com", "https://api.steemit.com"];
let lastGoodBroadcastNode = null;
export function broadcastNodeOrder() { return stickyNodeOrder(lastGoodBroadcastNode, BROADCAST_NODES); }
async function broadcastTx(json) {
  let lastErr = "";
  for (const node of broadcastNodeOrder()) {
    try {
      const r = await fetch(node, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.broadcast_transaction", params: [json], id: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      const d = await r.json().catch(() => null);
      if (d?.error) { lastErr = String(d.error.message ?? JSON.stringify(d.error)).slice(0, 200); continue; }
      if (d?.result !== undefined) { lastGoodBroadcastNode = node; return { ok: true, node }; }
      lastErr = "no-result";
    } catch (e) { lastErr = String(e?.message ?? e).slice(0, 160); }
  }
  return { ok: false, error: lastErr || "all-nodes-failed" };
}

/* ── R293 · THE AUTHORITY-SPLIT LAW (pure, offline-testable core) ────────── */

/** Ops the chain authorizes with the POSTING authority alone. Everything
 * else (orders, transfers, converts, vesting, custom_json — which can ride
 * either authority depending on the op id) belongs to the main leg and is
 * signed under the caller's requested role, exactly as before this law. */
export const POSTING_ONLY_OPS = new Set([
  "claim_reward_balance",
  "vote",
  "comment",
  "delete_comment",
  "reblog",
]);

/**
 * Partition a batch into { postingOps, restOps }.
 *
 * `dropClaimReason` (the R293 §XIII reinterpretation): when the claim
 * adaptation rule fail-closes, the claim ops are DROPPED (not sent, reason
 * journaled by the caller) while the rest of the batch proceeds — the rule
 * refusal must never strand financial ops that share a batch with it.
 *
 * Pure function — no I/O, deterministic, covered by offline vectors
 * (test-claim-role-split.mjs). Unknown op names default to the MAIN leg
 * (fail-safe: unknown never silently gains posting authority).
 */
export function splitOpsByAuthority(ops, dropClaimReason = null) {
  const postingOps = [];
  const restOps = [];
  for (const op of ops) {
    const name = op[0];
    if (name === "claim_reward_balance" && dropClaimReason != null) continue;
    (POSTING_ONLY_OPS.has(name) ? postingOps : restOps).push(op);
  }
  return { postingOps, restOps };
}

/* ── the one execution entry-point: sign & broadcast a capped, atomic tx ── */
/* T-17 fast path: callers that ALREADY measured RC (curator's VP read) and
 * hold a fresh DGPO (≤60s) pass them in — the per-vote accountState + DGPO
 * network re-reads die (measured ~6s/vote of pure waste × up-to-18 votes).
 * Guards are NOT skipped — they are HOISTED: the caller presents the same
 * evidence executeAs would have fetched, freshness-capped below. */
export async function executeAs(account, ops, { tag = "cycle", role = "active", rcPct = null, dgpo = null, dgpoAt = 0, predictionId = null } = {}) {
  const conf = armedConf();
  if (!conf.armed) return { ok: false, verdict: "DISARMED", reason: "standing-order-off" };
  if (execPaused()) return { ok: false, verdict: "OPERATOR-PAUSED", reason: "kill-switch" };
  if (!ops.length) return { ok: true, verdict: "NO-OPS", ops: 0 };
  if (ops.length > conf.maxOpsPerCycle) ops = ops.slice(0, conf.maxOpsPerCycle);

  /* T-80 · THE THINK GATE — mandatory reasoning BEFORE any key material is
   * touched (cheapest guard first: pure local policy, zero network). A refusal
   * here is final for this call; the caller sees the typed verdict + reasons. */
  const think = thinkGate(account, ops, { source: tag });
  if (think.verdict === "REFUSED") {
    return { ok: false, verdict: "THINK-GATE-REFUSED", reasons: think.reasons, custody: think.custody, ops: 0 };
  }

  /* R210 §IV · THE RESOLVER CONSUMPTION POINT — the learned rule is consumed
   * HERE, in the signer hot path, before any key material is touched. The
   * rule can only ever select the POSTING role (already held by the
   * credential) — learning never creates authority (§XI absolute boundary).
   * A superseded/refuted rule fail-closes claim ops entirely (§XIII). */
  let adaptationMeta = null;
  let rr = null;
  const hasClaim = ops.some(([n]) => n === "claim_reward_balance");
  if (hasClaim) {
    rr = resolveClaimRole(); // hot-path consumption — counted
    if (rr.failClosed) {
      appendLine(LOG_FILE, { at: new Date().toISOString(), tag, account, ok: false, verdict: "CLAIM-FAIL-CLOSED", ops: ops.map(([n]) => n), reason: rr.reason, adaptationId: rr.adaptationId, status: rr.status, roleSource: rr.roleSource, ruleVersion: rr.ruleVersion, predictionId });
      /* R293 · SPLIT LAW (§XIII reinterpretation): "fail-closes claim ops
       * entirely" means the CLAIM OPS are dropped — not the whole batch.
       * Dropping the batch here is what wedged the economy: the claim's
       * posting-role refusal took the order ladder down with it. The claim
       * ops are removed below by the authority split; the rest proceed. */
      journalThink({ account, source: tag, verdict: "CLAIM-FAIL-CLOSED-SPLIT", reasons: [`claim dropped (${rr.reason}); remaining ${ops.filter(([n]) => n !== "claim_reward_balance").length} op(s) proceed under the caller's role`], shown: [] });
    }
  }

  /* R293 · THE AUTHORITY-SPLIT LAW — one tx, one key.
   *
   * A Steem/Hive tx is signed by a SINGLE key; the chain rejects any batch
   * whose ops require a different authority than the signing key
   * (`Assert Exception: required_active.size() == 0` — measured twice daily
   * on 2026-10-11 exec-log when a claim[posting] rode with an order
   * ladder[active]). Splitting at the chokepoint: posting-only ops broadcast
   * in their OWN tx under the adaptation-selected posting role; every other
   * op broadcasts under the caller's requested role. Two atomic txs, two
   * complete ledger rows, one honest combined verdict — a claim failure can
   * never again strand the ladder, and the ladder can never poison a claim. */
  const { postingOps, restOps } = splitOpsByAuthority(ops, hasClaim && rr?.failClosed ? rr.reason : null);
  if (postingOps.length > 0 && restOps.length > 0) {
    const callerRole = role; // caller's requested role for the main leg
    const ver = await verifyRoles(account);
    if (!ver.ok) {
      if (adaptationMeta) appendLine(LOG_FILE, { at: new Date().toISOString(), tag, account, ok: false, verdict: "KEY-UNVERIFIED", ops: ops.map(([n]) => n), reason: ver.reason ?? "no-match", adaptation: adaptationMeta, predictionId });
      return { ok: false, verdict: "KEY-UNVERIFIED", reason: ver.reason ?? "no-match" };
    }
    const id = identity(account);
    const postingRole = (hasClaim && rr && !rr.failClosed) ? rr.role : "posting";
    const missingLegs = [];
    if (!id.wifs[postingRole]) missingLegs.push({ leg: "posting", role: postingRole });
    if (!id.wifs[callerRole]) missingLegs.push({ leg: "main", role: callerRole });
    if (missingLegs.length === 2) {
      appendLine(LOG_FILE, { at: new Date().toISOString(), tag, account, ok: false, verdict: "ROLE-KEY-ABSENT", ops: ops.map(([n]) => n), role: callerRole, postingRole, missing: missingLegs, predictionId });
      return { ok: false, verdict: "ROLE-KEY-ABSENT", role: callerRole, postingRole, missing: missingLegs };
    }
    journalThink({ account, source: tag, verdict: "AUTHORITY-SPLIT", reasons: [`${postingOps.length} posting-only op(s) → own tx under ${postingRole}; ${restOps.length} op(s) → own tx under ${callerRole}`], shown: [] });

    // Shared DGPO — both legs broadcast within seconds of one head read.
    let dgpoRes = dgpo && Number.isFinite(dgpoAt) && Date.now() - dgpoAt < 60_000 ? dgpo : null;
    if (!dgpoRes) {
      const dgpoR = await rpcCall("condenser_api.get_dynamic_global_properties", []);
      if (!dgpoR.ok) return { ok: false, verdict: "NO-DGPO" };
      dgpoRes = dgpoR.result;
    }

    // RC floor — evaluated once for the account; both legs ride the same
    // evidence (identical account, sub-minute window — same as the single-tx
    // path where one check covers the whole batch).
    let rcBlock = null;
    if (account === masterAccount()) {
      let rcNow = rcPct;
      if (rcNow == null) {
        const acc = await accountState(account);
        if (acc.ok && acc.rcPct != null) rcNow = acc.rcPct;
      }
      if (rcNow != null && rcNow < conf.minRcPct) {
        rcBlock = { verdict: "RC-FLOOR", rcPct: rcNow, reason: `rc below ${conf.minRcPct}%` };
      }
    }

    const execAt = new Date().toISOString();
    const crypto = await import("node:crypto");
    const out = { split: true, legs: [], ok: true, verdict: "BROADCAST-SPLIT", adaptation: adaptationMeta, execAt };

    // LEG 1 · posting-only tx (claim/comment/vote).
    if (id.wifs[postingRole] && !rcBlock) {
      const t = buildTx({ ops: postingOps, dgpo: dgpoRes, wifs: [id.wifs[postingRole]] });
      const txid = crypto.createHash("sha256").update(Buffer.from(t.serializedHex, "hex")).digest("hex").slice(0, 40);
      const res = await broadcastTx(t.json);
      appendLine(LOG_FILE, { at: execAt, tag: `${tag}:claim-leg`, account, ok: res.ok, txid, ops: postingOps.map(([n]) => n), node: res.node ?? null, error: res.error ?? null, fingerprint: ver.fingerprint, role: postingRole, serialization: { claimOpId: postingOps.some(([n]) => n === "claim_reward_balance") ? OP_IDS.claim_reward_balance : null }, adaptation: adaptationMeta, predictionId });
      out.legs.push({ leg: "posting", role: postingRole, ok: res.ok, txid, ops: postingOps.length, error: res.error ?? null });
      out.postingTxid = res.ok ? txid : null;
      out.postingVerdict = res.ok ? "BROADCAST" : "BROADCAST-FAIL";
      out.postingOps = postingOps.map(([n]) => n);
      if (!res.ok) out.ok = false;
    } else {
      const why = rcBlock ? `rc ${rcBlock.rcPct} below floor` : `no ${postingRole} key on credential`;
      appendLine(LOG_FILE, { at: execAt, tag: `${tag}:claim-leg`, account, ok: false, verdict: "CLAIM-LEG-DEFERRED", ops: postingOps.map(([n]) => n), reason: why, predictionId });
      out.legs.push({ leg: "posting", role: postingRole, ok: false, txid: null, ops: postingOps.length, deferred: true, reason: why });
      out.postingVerdict = "CLAIM-LEG-DEFERRED";
      out.postingOps = postingOps.map(([n]) => n);
      out.ok = false;
    }

    // LEG 2 · main tx under the caller's role (orders/transfers/converts…).
    if (id.wifs[callerRole] && !rcBlock) {
      const t = buildTx({ ops: restOps, dgpo: dgpoRes, wifs: [id.wifs[callerRole]] });
      const txid = crypto.createHash("sha256").update(Buffer.from(t.serializedHex, "hex")).digest("hex").slice(0, 40);
      const res = await broadcastTx(t.json);
      appendLine(LOG_FILE, { at: execAt, tag: `${tag}:main-leg`, account, ok: res.ok, txid, ops: restOps.map(([n]) => n), node: res.node ?? null, error: res.error ?? null, fingerprint: ver.fingerprint, role: callerRole, serialization: { claimOpId: null }, adaptation: adaptationMeta, predictionId });
      out.legs.push({ leg: "main", role: callerRole, ok: res.ok, txid, ops: restOps.length, error: res.error ?? null });
      out.txid = res.ok ? txid : null;
      out.mainVerdict = res.ok ? "BROADCAST" : "BROADCAST-FAIL";
      out.opNames = restOps.map(([n]) => n);
      out.ops = restOps.length;
      if (!res.ok) out.ok = false;
    } else {
      const why = rcBlock ? rcBlock.reason : `no ${callerRole} key on credential`;
      appendLine(LOG_FILE, { at: execAt, tag: `${tag}:main-leg`, account, ok: false, verdict: rcBlock ? "RC-FLOOR" : "ROLE-KEY-ABSENT", ops: restOps.map(([n]) => n), role: callerRole, reason: why, missing: rcBlock ? undefined : { leg: "main", role: callerRole }, rcPct: rcBlock?.rcPct, predictionId });
      out.legs.push({ leg: "main", role: callerRole, ok: false, txid: null, ops: restOps.length, deferred: true, reason: why });
      out.mainVerdict = rcBlock ? "RC-FLOOR" : "ROLE-KEY-ABSENT";
      out.ok = false;
      if (rcBlock) out.rcPct = rcBlock.rcPct;
    }
    return out;
  }

  /* Single-leg path (one authority class only). If a claim rides alone (or
   * with other posting ops), the adaptation rule still selects its role. */
  if (hasClaim && rr && !rr.failClosed) {
    if (role !== rr.role) {
      journalThink({ account, source: tag, verdict: "ADAPTATION-ROLE-OVERRIDE", reasons: [`claim_reward_balance role ${role} → ${rr.role} via ${rr.roleSource} (within already-authorized space — no new authority)`], shown: [] });
      role = rr.role;
    }
    adaptationMeta = { roleSource: rr.roleSource, adaptationId: rr.adaptationId, ruleVersion: rr.ruleVersion, status: rr.status };
  }

  const ver = await verifyRoles(account);
  if (!ver.ok) {
    if (adaptationMeta) appendLine(LOG_FILE, { at: new Date().toISOString(), tag, account, ok: false, verdict: "KEY-UNVERIFIED", ops: ops.map(([n]) => n), reason: ver.reason ?? "no-match", adaptation: adaptationMeta, predictionId });
    return { ok: false, verdict: "KEY-UNVERIFIED", reason: ver.reason ?? "no-match" };
  }
  const id = identity(account);
  if (!id.wifs[role]) {
    if (adaptationMeta) appendLine(LOG_FILE, { at: new Date().toISOString(), tag, account, ok: false, verdict: "ROLE-KEY-ABSENT", ops: ops.map(([n]) => n), role, adaptation: adaptationMeta, predictionId });
    return { ok: false, verdict: "ROLE-KEY-ABSENT", role, matched: ver.roles?.[role]?.matched ?? null };
  }

  // RC floor — chain resource health before any op (master only; soldiers ride
  // small). Caller-supplied rcPct (measured THIS run) counts as the same
  // evidence a fresh accountState would return — the floor itself is untouched.
  if (account === masterAccount()) {
    if (rcPct != null) {
      if (rcPct < conf.minRcPct) {
        if (adaptationMeta) appendLine(LOG_FILE, { at: new Date().toISOString(), tag, account, ok: false, verdict: "RC-FLOOR", rcPct, adaptation: adaptationMeta, predictionId });
        return { ok: false, verdict: "RC-FLOOR", rcPct, reason: `rc below ${conf.minRcPct}%` };
      }
    } else {
      const acc = await accountState(account);
      if (acc.ok && acc.rcPct != null && acc.rcPct < conf.minRcPct) {
        if (adaptationMeta) appendLine(LOG_FILE, { at: new Date().toISOString(), tag, account, ok: false, verdict: "RC-FLOOR", rcPct: acc.rcPct, adaptation: adaptationMeta, predictionId });
        return { ok: false, verdict: "RC-FLOOR", rcPct: acc.rcPct, reason: `rc below ${conf.minRcPct}%` };
      }
    }
  }

  // DGPO: reuse a ≤60s-old caller-supplied head block (TaPoS needs ANY past
  // block within 65536 — a minute-old head is far inside that); else fetch.
  let dgpoRes = dgpo && Number.isFinite(dgpoAt) && Date.now() - dgpoAt < 60_000 ? dgpo : null;
  if (!dgpoRes) {
    const dgpoR = await rpcCall("condenser_api.get_dynamic_global_properties", []);
    if (!dgpoR.ok) return { ok: false, verdict: "NO-DGPO" };
    dgpoRes = dgpoR.result;
  }
  const t = buildTx({ ops, dgpo: dgpoRes, wifs: [id.wifs[role]] });
  const crypto = await import("node:crypto");
  const txid = crypto.createHash("sha256").update(Buffer.from(t.serializedHex, "hex")).digest("hex").slice(0, 40);
  const res = await broadcastTx(t.json);
  const execAt = new Date().toISOString();
  appendLine(LOG_FILE, {
    at: execAt, tag, account, ok: res.ok, txid,
    ops: ops.map(([n]) => n), node: res.node ?? null, error: res.error ?? null,
    fingerprint: ver.fingerprint,
    role, // R210 §XV: the ACTUAL role used travels with every execution row
    serialization: { claimOpId: ops.some(([n]) => n === "claim_reward_balance") ? OP_IDS.claim_reward_balance : null },
    adaptation: adaptationMeta, // roleSource/adaptationId/ruleVersion on every row
    predictionId,
  });
  return { ok: res.ok, verdict: res.ok ? "BROADCAST" : "BROADCAST-FAIL", txid, ops: ops.length, opNames: ops.map(([n]) => n), node: res.node ?? null, error: res.error ?? null, role, adaptation: adaptationMeta, execAt, serialization: { claimOpId: hasClaim ? OP_IDS.claim_reward_balance : null } };
}

export async function executeOps(ops, opts = {}) {
  return executeAs(masterAccount(), ops, opts);
}

export const EXEC_FILES = { ARMED_FILE, PAUSE_FILE, LOG_FILE };
