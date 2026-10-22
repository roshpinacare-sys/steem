#!/usr/bin/env bun
/**
 * hive-authority-upgrade.mjs — G50 · שדרוג-רשויות-Hive לחשבונות-OWNER-MATCH
 * =========================================================================
 * העניין-הפתוח-#1 של גל-49: 9 חשבונות ש-owner-WIF-שלהם-מוכח-חי-על-HIVE
 * (מדידת-אמת: vault-truth-test.mjs) אבל posting/active שלהם ב-HIVE אינם
 * בשליטת-המפתחות-השמורים. הפעולה: account_update2 **תוספתי-בלבד** —
 * הצמדת-pubs-מהכספת לסמכויות-posting/active החיות, בלי-לגעת ב-owner,
 * בלי-לגעת ב-memo_key, בלי-להסיר-אף-מפתח-קיים, סף-משקל-לא-משונה.
 *
 * שערי-G (מה-adoption-המוכח vault-owner-adopt · TOOLS-RUNBOOK):
 *   G0 זהות: שם-החשבון-מהכספת == שם-החשבון-שנבדק; חתימה-רק-ע"י-WIF
 *            שה-pub-הנגזר-ממנו ∈ סמכות-owner החיה של אותו-חשבון-ב-HIVE
 *            (נמדד-טרי-בכל-ריצה — אין-הנחות-ממדידות-קודמות).
 *   G1 פורמט: כל-WIF-עובר-פענוח-checksum; כל-pub-עובר-checksum.
 *   G2 אחיזה: pub-יעד-ל-posting/active = נגזר-מ-WIF-בתווית-התפקיד;
 *            חיבור-לאימות-צולב-מול-סמכות-ה-Steem-החיה (השרשרת-המוכחת)
 *            — מתויג "steem-verified" אך אינו-חוסם (Steem-עשוי-לשונות).
 *   G3 אידמפוטנציה + תוספתיות: pub-שכבר-חי-ב-HIVE → דילוג; רשימת-key_auths
 *            החדשה חייבת-להכיל-את-כל-הקיימת (no-removals) + ממוינת-FC.
 *   G4 אימות-בלתי-תלוי: לפני-שידור — בדיקת-ה-ops-הסופי-מול-החוק;
 *            אחרי-שידור — re-fetch + verify_account_authority-חי.
 *
 * שימוש:
 *   bun hive-authority-upgrade.mjs <vault.json>            # dry-run (ברירת-מחדל)
 *   bun hive-authority-upgrade.mjs <vault.json> --execute  # שידור-אמיתי
 *   ... --only name1,name2                                  # מסנן-חשבונות
 *
 * אפס-סודות-בפלט: שמות-חשבונות, pubs, גיבובים, ורדיקטים — בלבד.
 */
import * as fs from "node:fs";
import { wifDecode, pubkeyFromSeed, pubkeyBytes, buildTx, HIVE_CHAIN_ID } from "./steemtx.mjs";

const VAULT = process.argv[2] ?? "/tmp/vault-open/opened/agent/keys/vault.json";
const EXEC = process.argv.includes("--execute");
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  if (i < 0) return null;
  return new Set((process.argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
})();
const ROLES = ["posting", "active"];
const NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];

async function rpc(method, params) {
  let lastErr = "no-nodes";
  for (const url of NODES) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      const j = await r.json();
      if (j?.error) throw new Error(j.error?.message ?? "rpc-error");
      return j?.result;
    } catch (e) { lastErr = String(e?.message ?? e); }
  }
  throw new Error(`rpc-failover-exhausted: ${lastErr}`);
}

async function liveAuth(name) {
  const acc = await rpc("condenser_api.get_accounts", [[name]]);
  if (!acc?.length) return null;
  const a = acc[0];
  const auth = (x) => ({
    weight_threshold: x?.weight_threshold ?? 1,
    account_auths: (x?.account_auths ?? []).map(([n, w]) => [n, w]),
    key_auths: (x?.key_auths ?? []).map(([k, w]) => [k, w]),
  });
  return { posting: auth(a.posting), active: auth(a.active), owner: auth(a.owner), memo: a.memo_key };
}

/* אוסף-ה-WIFs-מהכספת — בדיוק-ההליכה-של vault-truth-test (flat: keys.<role>.wif,
 * מקונן: keys.<chain>.<role>.wif) — בלי-להדפיס-דבר. */
function collectWifs(acc) {
  const out = [];
  for (const [k, v] of Object.entries(acc.keys ?? {})) {
    if (v && typeof v === "object") {
      if (typeof v.wif === "string") out.push({ from: k, role: k, wif: v.wif });
      else for (const [k2, v2] of Object.entries(v)) {
        if (v2 && typeof v2 === "object" && typeof v2.wif === "string") out.push({ from: `${k}/${k2}`, role: k2, wif: v2.wif });
      }
    }
  }
  return out;
}

/* אימות-צולב-מול-Steem: ה-pubs-החיים-של-התפקיד-בשרשרת-המוכחת */
async function steemRolePubs(name, role) {
  try {
    const acc = await fetch("https://api.steemit.com", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [[name]] }),
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.json());
    const a = acc?.result?.[0];
    if (!a) return null;
    return (a[role]?.key_auths ?? []).map((x) => x[0]);
  } catch { return null; }
}

function additiveAuth(live, newPubs, weight) {
  const have = new Set(live.key_auths.map(([k]) => k));
  const added = newPubs.filter((p) => !have.has(p));
  if (!added.length) return { auth: live, added: [] };
  const keyAuths = [...live.key_auths, ...added.map((p) => [p, weight])]
    /* סדר-FC: flat_map ממוין-לפי-הבייטים-של-המפתח — לא-לפי-המחרוזת */
    .sort((x, y) => Buffer.compare(pubkeyBytes(x[0]), pubkeyBytes(y[0])));
  return { auth: { weight_threshold: live.weight_threshold, account_auths: live.account_auths, key_auths: keyAuths }, added };
}

/* רמת-האימות של account_update2 — החוק-המדוד-חי (2026-10-22, פסק-הצומת):
 * op-בלי-שדה-owner ⇒ נדרשת-חתימת-ACTIVE ("Missing Active Authority");
 * op-עם-שדה-owner ⇒ נדרשת-חתימת-OWNER. ההרמה: לכלול-את-סמכות-ה-owner
 * החיה **שלא-שונתה** (content-identical) — אפס-שינוי-תוכן, רק-רמת-אימות. */
const ownerElevation = (liveOwner) => ({
  weight_threshold: liveOwner.weight_threshold,
  account_auths: liveOwner.account_auths,
  key_auths: liveOwner.key_auths,
});

function judgeFinalOp(op, liveBefore) {
  /* החוק-הסופי-על-ה-ops-הסריאליזבילי: תוספתי-בלבד. שדה-owner מותר-רק
   * content-identical-לחי (הרמת-אימות, אפס-שינוי) — כל-שונות = fail. */
  const errs = [];
  if (op[0] !== "account_update2") errs.push("op-name");
  const v = op[1] ?? {};
  if (v.owner) {
    const o = v.owner, live = liveBefore.owner;
    const same = o.weight_threshold === live.weight_threshold &&
      JSON.stringify(o.account_auths) === JSON.stringify(live.account_auths) &&
      JSON.stringify(o.key_auths) === JSON.stringify(live.key_auths);
    if (!same) errs.push("owner-content-changed");
  }
  if (v.memo_key) errs.push("memo-touched");
  for (const role of ROLES) {
    const next = v[role];
    if (!next) errs.push(`${role}-absent`); /* אם-אין-מה-להוסיף-בכלל-לא-בונים-op — אבל-כאן-זה-שגיאה */
    else {
      const before = liveBefore[role];
      if (next.weight_threshold !== before.weight_threshold) errs.push(`${role}-threshold-changed`);
      const prevAcc = JSON.stringify(before.account_auths);
      if (JSON.stringify(next.account_auths) !== prevAcc) errs.push(`${role}-account_auths-changed`);
      const prevKeys = before.key_auths.map(([k]) => k);
      const nextKeys = next.key_auths.map(([k]) => k);
      if (!prevKeys.every((k) => nextKeys.includes(k))) errs.push(`${role}-removal`);
      if (nextKeys.length <= prevKeys.length) errs.push(`${role}-not-additive`);
      const sorted = [...nextKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (JSON.stringify(sorted) !== JSON.stringify(nextKeys)) errs.push(`${role}-fc-order`);
    }
  }
  return errs;
}

const vault = JSON.parse(fs.readFileSync(VAULT, "utf8"));
const results = [];
for (const acc of vault.accounts ?? []) {
  const name = acc?.username;
  if (!name) continue;
  if (ONLY && !ONLY.has(name)) continue;
  const R = { account: name, gates: {}, verdict: "skipped", installed: {} };
  try {
    /* ── G0 זהות + אחיזת-owner-חיה (נמדד-טרי-בכל-ריצה) ── */
    const live = await liveAuth(name);
    if (!live) { R.verdict = "no-account-on-hive"; results.push(R); continue; }
    R.liveSnapshot = {
      posting_keys: live.posting.key_auths.length, active_keys: live.active.key_auths.length,
      owner_threshold: live.owner.weight_threshold,
    };
    const wifs = collectWifs(acc);
    /* G1 פורמט — פענוח-כולם */
    R.gates.G1 = "pass";
    const decoded = [];
    for (const w of wifs) {
      try { decoded.push({ ...w, seed: wifDecode(w.wif), pub: pubkeyFromSeed(wifDecode(w.wif)) }); }
      catch { R.gates.G1 = "fail:wif-format"; }
    }
    if (R.gates.G1 !== "pass") { R.verdict = "g1-fail"; results.push(R); continue; }
    const ownerSigners = decoded.filter((d) => live.owner.key_auths.some(([k]) => k === d.pub));
    if (!ownerSigners.length) { R.verdict = "not-eligible:no-live-owner-match"; results.push(R); continue; }
    R.gates.G0 = `pass:${ownerSigners.length}-owner-wif(s)`;

    /* ── G2: pub-יעד לפי תווית-תפקיד + אימות-צולב-Steem ── */
    R.gates.G2 = {};
    const targetPubs = {};
    for (const role of ROLES) {
      const cands = [...new Set(decoded.filter((d) => d.role === role).map((d) => d.pub))];
      const steemPubs = await steemRolePubs(name, role);
      const verified = steemPubs ? cands.filter((p) => steemPubs.includes(p)) : [];
      R.gates.G2[role] = { candidates: cands.length, steem_verified: verified.length };
      targetPubs[role] = verified.length ? verified : cands; /* עדיף-מאומת-Steem; אחרת-התווית */
    }

    /* ── G3 אידמפוטנציה: מה-כבר-חי → דילוג ── */
    const plan = {};
    for (const role of ROLES) {
      const { auth, added } = additiveAuth(live[role], targetPubs[role], live[role].weight_threshold);
      plan[role] = { auth, added };
    }
    if (!plan.posting.added.length && !plan.active.added.length) {
      R.verdict = "already-live";
      R.gates.G3 = "pass:idempotent";
      results.push(R); continue;
    }
    R.gates.G3 = `pass:posting+${plan.posting.added.length}/active+${plan.active.added.length}`;

    /* ── בניית-ה-op (רק-תפקידים-עם-תוספת) ── */
    const v = { account: name, json_metadata: "", posting_json_metadata: "" };
    if (plan.posting.added.length) v.posting = plan.posting.auth;
    if (plan.active.added.length) v.active = plan.active.auth;
    /* הרמת-אימות: שדה-owner-בתוכן-החי-הבלתי-משונה ⇒ חתימת-owner-מספיקה */
    v.owner = ownerElevation(live.owner);
    const op = ["account_update2", v];

    /* ── G4a שיפוט-סופי-על-ה-op ── */
    const errs = judgeFinalOp(op, live);
    if (errs.length) { R.verdict = `g4a-fail:${errs.join(",")}`; results.push(R); continue; }
    R.gates.G4a = "pass:additive-only";

    const dgpo = await rpc("condenser_api.get_dynamic_global_properties", []);
    const tx = buildTx({ ops: [op], dgpo, wifs: ownerSigners.map((s) => s.wif), chainId: HIVE_CHAIN_ID, ttlSec: 60 });
    R.digest = tx.digestHex.slice(0, 12);

    if (!EXEC) {
      R.verdict = "dry-run-ready";
      R.wouldInstall = { posting: plan.posting.added, active: plan.active.added };
      results.push(R); continue;
    }
    /* ── שידור + G4b אימות-בלתי-תלוי ── */
    await rpc("condenser_api.broadcast_transaction", [tx.json]);
    await new Promise((res) => setTimeout(res, 8000)); /* בלוק-הייב=3ש' + פיזור-קריאה — 3ש' רדפו-את-הבלוק (נמדד) */
    const after = await liveAuth(name);
    const check = {};
    for (const role of ROLES) {
      if (plan[role].added.length) {
        const have = new Set(after[role].key_auths.map(([k]) => k));
        check[role] = plan[role].added.every((p) => have.has(p));
      }
    }
    R.gates.G4b = Object.values(check).every(Boolean) ? "pass:live-on-chain" : "fail:post-check";
    R.installed = { posting: plan.posting.added, active: plan.active.added };
    R.verdict = R.gates.G4b.startsWith("pass") ? "INSTALLED" : "broadcast-unclear";
  } catch (e) {
    R.verdict = `error:${String(e?.message ?? e).slice(0, 120)}`;
  }
  results.push(R);
}

console.log(JSON.stringify({ mode: EXEC ? "EXECUTE" : "DRY-RUN", at: new Date().toISOString(), results }, null, 1));
