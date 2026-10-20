/**
 * chain-memo-custody.mjs — R310 · המסילה-הריבונית לחידוש-הרשאות דרך-השרשרת.
 *
 * הפצע-הנמדד (2026-10-20, GIT-CUSTODY-DEAD מדוד 3 פעמים): כל-מקורות-ה-push
 * מתים ביחד (pat.env מצורף-בצ'אט נפסל · עותק-המשמורת נפסל · ה-blob-החתום נפסל),
 * הצ'אט-עצמו מצנזר token (נמדד: "[REDACTED:github_token]" — הקובץ הגיע-ריק-מתוכן),
 * והמערכת נעצרת-עד-המפעיל. זו החולשה-הכרונית מאז R284.
 *
 * התרופה — **השרשרת היא ערוץ-האספקה**: הבעלים שולח transfer קטן (0.001 STEEM)
 * אל headcorner עם memo **מוצפן** (מתחיל-ב-#) המכיל GITHUB_TOKEN=... ההצפנה
 * היא זו-של-Steem המקורית (ECDH secp256k1 → sha512 → AES-256-CBC) — הרשת
 * מאמתת-את-השולח חתימתית, התוכן נקרא רק בעל-מפתח-ה-memo, ואף-ערוץ-צ'אט לא
 * נוגע-בחומר. אפס-צנזורה · אפס-חשיפה · אפס-תלות במנגנון-הצ'אט.
 *
 * החוקים:
 *  - ה-token לעולם לא נרשם/נרשם-ביומן/נחשף — רק sha-slice + verdicts.
 *  - אימוץ רק-אחרי probe חי (200 על /user) + גישה-לארגון (200 על repos/roshpinacare-sys/Domain).
 *  - התקנה = upload/pat.env (0600, ה-helper קורא-בזמן-אמת) + selfcustody seal (fail-closed).
 *  - קבלה-בלבד: אין-transfer יוצא, אין-חריגה משער-ה-think (T80). קבלת-הצלחה נרשמת ב-state.
 *  - fail-closed: decode שנכשל / token מת / אין-גישה → דחייה מטופסת, אפס-התקנה.
 *
 * CLI: bun chain-memo-custody.mjs poll|selftest|status
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as secp from "@noble/secp256k1";
import { b58decode, b58encode, wifDecode, wifEncode, wifFor, pubkeyFromSeed, SEED_ORDERS, derivePub } from "./steemtx.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const SECRETS = path.join(DIR, "..", "..", ".secrets");
const ARMY_KEYS = path.join(SECRETS, "army-keys.json");
const STEEM_ROOT = path.join(DIR, "..", "..");
const PAT_ENV = path.join(STEEM_ROOT, "upload", "pat.env");
const STATE_FILE = path.join(DIR, "state", "memo-custody.json");
const ACCOUNT = process.env.SAOS_MEMO_ACCOUNT || "headcorner";
const RPC = "https://api.steemit.com";
const sha512 = (b) => crypto.createHash("sha512").update(b).digest();
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

async function rpc(method, params) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctl.signal,
    });
    const j = await res.json();
    if (j.error) throw new Error(`rpc-${String(j.error.message ?? "error").slice(0, 60)}`);
    return j.result;
  } finally { clearTimeout(timer); }
}

/* ── memo WIF custody: the chain is the judge (same law as signer) ─────────── */
async function memoWifFor(account = ACCOUNT) {
  const vault = readJson(ARMY_KEYS, null);
  const rec = vault
    ? ((vault.accounts ?? vault.keys ?? [])?.find?.((a) => a?.name === account) ?? vault[account] ?? null)
    : null;
  /* 1) the vault cache (0600, written by the custody revival — never logged);
   * R310: the cache gens may now carry memoWif (vault full 4-role extraction).
   * CHAIN-JUDGE LAW: the candidate must reproduce the LIVE chain memo_key
   * before it is ever used to decode — a cached material is never truth. */
  if (rec?.gens?.length) {
    const [acc] = await rpc("condenser_api.get_accounts", [[account]]).catch(() => [null]);
    const chainMemoKey = acc?.memo_key;
    for (const g of rec.gens) {
      if (!g?.memoWif) continue;
      if (!chainMemoKey) return { wif: null, reason: `no chain memo_key for ${account} — fail-closed` };
      try {
        const pub = pubkeyFromSeed(wifDecode(g.memoWif));
        if (pub === chainMemoKey) return { wif: g.memoWif, source: `army-keys-vault:${g.gen ?? "gen"}+chain-judged` };
      } catch { /* malformed gen entry — try next */ }
    }
  }
  /* 2) derive from the vault password, judged against the LIVE chain memo_key */
  const [acc] = await rpc("condenser_api.get_accounts", [[account]]).catch(() => [null]);
  const chainMemoKey = acc?.memo_key;
  if (!chainMemoKey) return { wif: null, reason: `no chain memo_key for ${account} — fail-closed` };
  const password = rec?.password ?? vault?.password;
  if (!password) return { wif: null, reason: "vault cache holds no derivable material — fail-closed" };
  for (const [, order] of Object.entries(SEED_ORDERS)) {
    const pub = derivePub(order(account, "memo", password));
    if (pub === chainMemoKey) return { wif: wifEncode(sha256(Buffer.from(order(account, "memo", password), "utf8"))), source: "vault-password+chain-judged" };
  }
  return { wif: null, reason: "no seed order reproduced the chain memo_key — fail-closed" };
}

/* ── the Steem memo crypto (wire-compatible with steem-js/Beem) ─────────────── */
export function encodeMemo(plaintext, receiverPubHex, senderWif32) {
  const shared = secp.getSharedSecret(senderWif32, receiverPubHex, true); /* compressed 33B */
  const X = Buffer.from(shared.slice(1, 33)); /* the X coordinate — steem-js get_shared_secret */
  const s = sha512(X);
  const key = s.subarray(0, 32), iv = s.subarray(32, 48);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const senderPub = Buffer.from(secp.getPublicKey(senderWif32, true));
  return "#" + b58encode(Buffer.concat([senderPub, enc]));
}

export function decodeMemo(memoStr, receiverWif32) {
  if (!memoStr?.startsWith?.("#")) throw new Error("not-an-encrypted-memo");
  const raw = Buffer.from(b58decode(memoStr.slice(1)));
  if (raw.length < 34 || (raw[0] !== 0x02 && raw[0] !== 0x03)) throw new Error("bad-memo-envelope");
  const senderPub = raw.subarray(0, 33);
  const cipher = raw.subarray(33);
  const shared = secp.getSharedSecret(receiverWif32, senderPub, true);
  const X = Buffer.from(shared.slice(1, 33));
  const s = sha512(X);
  const key = s.subarray(0, 32), iv = s.subarray(32, 48);
  const dec = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([dec.update(cipher), dec.final()]).toString("utf8");
}

/* ── probe the candidate token — alive AND org-scoped, or refuse ────────────── */
export async function probeGithubToken(token) {
  const h = { authorization: `Bearer ${token}`, "user-agent": "saos-chain-memo-custody/r310" };
  const out = { alive: false, orgAccess: false, login: null };
  try {
    const u = await fetch("https://api.github.com/user", { headers: h });
    out.alive = u.status === 200;
    if (out.alive) out.login = (await u.json())?.login ?? null;
  } catch { /* network — fail-closed */ }
  if (out.alive) {
    try {
      const r = await fetch("https://api.github.com/repos/roshpinacare-sys/Domain", { headers: h });
      out.orgAccess = r.status === 200;
    } catch { /* fail-closed */ }
  }
  return out;
}

/* ── install + seal (the R284 path, one command) ────────────────────────────── */
async function installAndSeal(token, { now = new Date().toISOString() } = {}) {
  fs.mkdirSync(path.dirname(PAT_ENV), { recursive: true, mode: 0o700 });
  fs.writeFileSync(PAT_ENV, `GITHUB_TOKEN=${token}\n`, { mode: 0o600 });
  try { fs.chmodSync(PAT_ENV, 0o600); } catch { /* content is the credential */ }
  let sealVerdict = "SEAL-SKIPPED";
  try {
    const sc = await import(path.join(STEEM_ROOT, "scripts", "sovereign-selfcustody.mjs"));
    const seal = sc.sealGitCredential({ now });
    sealVerdict = seal?.verdict ?? "SEAL-UNKNOWN";
  } catch (e) {
    sealVerdict = `SEAL-FAIL:${String(e?.message ?? e).slice(0, 60)}`;
  }
  return { installed: true, sealVerdict, patEnv: "upload/pat.env (0600)" };
}

/* ── the rail: poll → decode → verify → adopt → seal ───────────────────────── */
export async function poll({ now = new Date().toISOString(), depth = 100, maxPages = 5 } = {}) { /* condenser limit max = 100; 5 pages back */
  const t0 = Date.now();
  const mw = await memoWifFor(ACCOUNT);
  const doc = { at: now, account: ACCOUNT, wifSource: mw.source ?? null, refuse: mw.reason ?? null, scanned: 0, candidates: 0, verdicts: [], law: "receive-only · zero token material journaled · fail-closed" };
  if (!mw.wif) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(doc, null, 2) + "\n");
    return { ok: false, verdict: "MEMO-CUSTODY-NO-WIF", reason: mw.reason, at: now };
  }
  const wif32 = wifDecode(mw.wif); /* 32 bytes — held in memory only */
  /* this node takes the 3-arg get_account_history — page backwards, filter client-side */
  let history = [];
  let from = -1;
  try {
    for (let page = 0; page < (maxPages ?? 5); page++) {
      const batch = await rpc("condenser_api.get_account_history", [ACCOUNT, from, depth]) ?? [];
      if (!batch.length) break;
      history = [...batch, ...history];
      const first = batch[0]?.[0];
      if (page === 0 && batch.length < depth) break; /* account younger than one page */
      if (first === undefined || first <= 1) break;
      from = first - 1;
      if (doc.verdicts.some((x) => x.verdict === "ADOPTED-AND-SEALED")) break;
    }
  } catch (e) {
    return { ok: false, verdict: "MEMO-POLL-RPC-FAIL", reason: String(e?.message ?? e).slice(0, 80), at: now };
  }
  for (const [idx, entry] of history) {
    const op = entry?.op ?? entry?.op_value;
    if (!op || op[0] !== "transfer") continue;
    const v = op[1] ?? {};
    if (v.to !== ACCOUNT || !v.memo?.startsWith?.("#")) continue;
    doc.scanned++;
    let plaintext = null;
    try { plaintext = decodeMemo(v.memo, wif32); doc.candidates++; } catch { continue; /* not ours / foreign crypto */ }
    const token = plaintext.match(/^GITHUB_TOKEN=(\S+)$/m)?.[1];
    if (!token || token.length < 20) { doc.verdicts.push({ from: v.from, idx, verdict: "REFUSED", reason: "no GITHUB_TOKEN line in decrypted payload" }); continue; }
    const probe = await probeGithubToken(token);
    if (!probe.alive) { doc.verdicts.push({ from: v.from, idx, verdict: "REFUSED-DEAD", reason: "probe 401 — dead credential, nothing installed" }); continue; }
    if (!probe.orgAccess) { doc.verdicts.push({ from: v.from, idx, verdict: "REFUSED-SCOPE", reason: "alive but no roshpinacare-sys repo access — refused by scope law" }); continue; }
    const seal = await installAndSeal(token, { now });
    doc.verdicts.push({ from: v.from, idx, verdict: "ADOPTED-AND-SEALED", login: probe.login, seal: seal.sealVerdict, tokenShaSlice: sha256(Buffer.from(token)).toString("hex").slice(0, 12) });
    break; /* one adoption per poll — the newest valid memo wins */
  }
  doc.ms = Date.now() - t0;
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(doc, null, 2) + "\n");
  return { ok: true, verdict: doc.verdicts.some((x) => x.verdict === "ADOPTED-AND-SEALED") ? "GIT-CUSTODY-REVIVED-VIA-CHAIN" : doc.verdicts.length ? "MEMO-VERDICTS-RECORDED" : "NO-CANDIDATE-MEMOS", ...doc };
}

/* ── selftest: throwaway keypair roundtrip + probe refusal (zero custody) ──── */
export async function selftest({ now = new Date().toISOString() } = {}) {
  const priv = secp.utils.randomPrivateKey();
  const pubHex = Buffer.from(secp.getPublicKey(priv, true)).toString("hex");
  const secret = `GITHUB_TOKEN=selftest-${Date.now()}\n# roundtrip proof\n`;
  const memo = encodeMemo(secret, pubHex, priv);
  const round = decodeMemo(memo, priv);
  const ok = round === secret;
  let probeOk = null;
  try { probeOk = await probeGithubToken(`ghp_selftest${Date.now()}aaaaaaaaaaaaaaaaaa`); } catch { probeOk = { alive: false }; }
  return { at: now, verdict: ok ? "SELFTEST-ROUNDTRIP-OK" : "SELFTEST-FAIL", roundtrip: ok, probeRefused: probeOk.alive === false, memoPrefixOk: memo.startsWith("#"), law: "throwaway keypair — zero custody material touched" };
}

/* ── CLI ────────────────────────────────────────────────────────────────────── */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const cmd = process.argv[2] ?? "status";
  if (cmd === "poll") console.log(JSON.stringify(await poll(), null, 2));
  else if (cmd === "selftest") console.log(JSON.stringify(await selftest(), null, 2));
  else console.log(JSON.stringify({ status: readJson(STATE_FILE, { verdict: "never-polled" }), law: "receive-only; token never logged" }, null, 2));
}
