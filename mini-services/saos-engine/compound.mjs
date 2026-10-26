/**
 * compound.mjs — T-24 · מכשיר-ההקפדה (הריבונות-כמפעיל).
 * The operator's directive: "איך הריבונות מפתחת את עצמה בלי להמתין למפתחות-
 * המשתמש" + "להפוך את המערך-המדומה לערך אמיתי צעד-צעד". The payout that
 * lands (clock: 2026-10-04) becomes SP by the machine's OWN hand:
 * claim_reward_balance + transfer_to_vesting in ONE transaction — the X-2
 * ladder walks itself, compounding is the walk.
 *
 * LAWS (vector-locked in lib.compoundPlan + selftest):
 *  - credential-gated + pause-gated (signer.mjs doctrine, no exceptions)
 *  - 1 compound/day (day-cap law, max(state, chain-truth) counting basis)
 *  - SBD is NEVER sold here — it stays liquid for the peg/convert rails
 *  - the resume branch closes the claim-without-powerup loss window
 *  - every broadcast journaled with txid; post-broadcast chain-verified
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { compoundPlan } from "./lib.mjs";
import { loadCredential, execPaused, masterAccount, executeOps } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "compound.json");
const EVENTS = path.join(STATE, "events.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

export function compoundState() { return readJson(FILE, null); }

const num = (s) => { const n = Number(String(s ?? "0").split(" ")[0]); return Number.isFinite(n) ? n : 0; };

/* one cheap chain read: pending rewards + liquid balances (both live) */
export async function liveRewards(account) {
  const r = await rpcCall("condenser_api.get_accounts", [[account]]).catch(() => null);
  const a = r?.ok ? (Array.isArray(r.result) ? r.result[0] : null) : null;
  if (!a) return null;
  const pending = { steem: num(a.reward_steem_balance), sbd: num(a.reward_sbd_balance), vests: num(a.reward_vesting_balance) };
  pending.any = pending.steem > 0 || pending.sbd > 0 || pending.vests > 0;
  return {
    pending,
    liquid: { steem: num(a.balance), sbd: num(a.sbd_balance), vests: num(a.vesting_shares) },
  };
}

export async function runCompound({ now = new Date().toISOString(), account } = {}) {
  const acc = account || masterAccount();
  const day = now.slice(0, 10);
  const prev = readJson(FILE, null);

  /* the counting basis is max(state, chain-truth) — the same law the curator
   * and the day-cap live by: our own journal is never the whole ledger.
   * A txid TODAY is chain proof of an action — the verdict string is NOT the
   * count (live-caught: WAIT-PENDING rows overwrote the RESUME-POWERUP txid
   * and would have reset the cap). actedToday carries the day's evidence
   * forward across every verdict; the cap can never amnesia-reset. */
  const prevActed = prev?.day === day ? (prev?.actedToday ?? (prev?.txid ? { txid: prev.txid, verdict: prev.verdict, powerupSteem: prev.powerupSteem, at: prev.at } : null)) : null;
  const prevCompoundToday = prevActed?.txid ? 1 : 0;
  const live = await liveRewards(acc);

  if (!live) {
    const out = { day, at: now, account: acc, verdict: "MEASURE-BLOCKED", ops: [], claim: null, powerupSteem: 0, txid: null, compoundedToday: prevCompoundToday, error: "chain read failed — no compound without a fresh measurement" };
    writeJson(FILE, out);
    return out;
  }

  /* credential gate: try; the typed errors are the honest blocked state */
  let credentialOk = false, credNote = null;
  try { credentialOk = !!loadCredential(acc); } catch (e) { credNote = String(e?.message ?? e).slice(0, 140); }

  const plan = compoundPlan({
    pending: live.pending, liquid: live.liquid,
    credentialOk, paused: execPaused(),
    compoundedToday: prevCompoundToday, maxPerDay: 1, account: acc,
  });

  const out = {
    day, at: now, account: acc,
    verdict: plan.verdict, reason: plan.reason ?? null,
    claim: plan.claim ?? null, powerupSteem: plan.powerupSteem ?? 0,
    opsPlanned: (plan.ops ?? []).map(([n]) => n),
    txid: null, error: null,
    compoundedToday: prevCompoundToday,
    actedToday: prevActed,
    pending: live.pending, liquid: live.liquid,
    post: null, credNote,
    laws: [
      "claim+powerup בעסקה-אחת — אין חלון-הפסד-חלקיות",
      "תשואה-היא-כסף-חדש; STEEM-ישן מתגלגל רק מעל רזרבת-הספר (10 STEEM)",
      "SBD לעולם לא נמכר כאן — הוא נשאר נזיל למסילת-ההמרה",
      "1 הקפדה/יום, מבוסס max(state, chain-truth)",
      "כל שידור נושא txid ומאומת-שרשרת אחריו",
    ],
  };

  if ((plan.ops ?? []).length > 0) {
    const res = await executeOps(plan.ops, { tag: "compound" }).catch((e) => ({ ok: false, verdict: "BROADCAST-FAIL", error: String(e?.message ?? e).slice(0, 160) }));
    out.txid = res.ok ? res.txid ?? null : null;
    out.error = res.ok ? null : (res.error ?? res.reason ?? res.verdict ?? "broadcast-failed");
    if (res.ok) {
      out.compoundedToday = 1;
      out.actedToday = { txid: out.txid, verdict: plan.verdict, powerupSteem: out.powerupSteem, at: now };
      /* post-broadcast chain verification: the truth AFTER our hand */
      const post = await liveRewards(acc).catch(() => null);
      out.post = post ? { pending: post.pending, liquid: post.liquid } : null;
      appendLine(EVENTS, {
        type: "compound.broadcast", at: now, verdict: plan.verdict,
        txid: out.txid, claim: out.claim, powerupSteem: out.powerupSteem,
        postPendingAny: post?.pending?.any ?? null,
      });
    } else {
      appendLine(EVENTS, { type: "compound.broadcast-fail", at: now, error: out.error });
    }
  }

  writeJson(FILE, out);
  return out;
}

/* recruiter evidence: a fresh compound artifact with a real verdict */
export function compoundEvidence(nowMs = Date.now()) {
  const s = readJson(FILE, null);
  if (!s || typeof s !== "object" || !s.verdict) return null;
  const ageMs = nowMs - (Date.parse(s.at ?? "") || 0);
  if (ageMs < 0 || ageMs > 26 * 3600_000) return null;
  return `state/compound.json: ${s.verdict} (powerup ${s.powerupSteem ?? 0} STEEM${s.txid ? `, txid ${String(s.txid).slice(0, 10)}…` : ""}) — ההון מתגלגל בידי-המכונה`;
}

/* recruiter evidence for the arbitration judge: the ruling inside weave.json */
export function weaveRulingEvidence() {
  const w = readJson(path.join(STATE, "weave.json"), null);
  const r = w?.ruling ?? null;
  if (!r || !r.verdict) return null;
  return `state/weave.json ruling: ${r.verdict}${r.breach ? ` (breach ${r.breach.combined}>${r.breach.cap})` : ""} — פסיקת-הבוררות פומבית`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCompound({ now: new Date().toISOString() }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("COMPOUND-FAIL", e); process.exit(1); });
}
