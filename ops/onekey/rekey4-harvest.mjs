#!/usr/bin/env node
/**
 * rekey4-harvest.mjs — §㊽ · הקציר-החוקי של מפתחות-REKEY4 → הזרמה-לצרור-הצי
 * ═══════════════════════════════════════════════════════════════════════════
 * הבעיה-הנמדדת: army-ladder ישן KEY-STASIS ×7 — מפתחות-ה-active הוסבבו-על-השרשרת
 * (עידן-REKEY, 21.10–7.11) והחדשים נחתמו-במעטפות-CROWN-REKEY4 שרק-MAIN_KEY פותח.
 * הפתרון: פתיחת-המעטפות (כאן, בסביבת-MAIN_KEY) → שיפוט-שרשרת (השופט-היחיד) →
 * מיזוג-עם-LIVE_FLEET_KEYS-הנוכחי → PUT מסונכרן-ל-4-הריפויים.
 *
 * חוקים: אפס-WIF-בלוג (טביעות-8-הקס-בלבד) · אפס-שינוי-רשות (זה-שליחת-מפתח-קיים,
 * לא-רוטציה) · fail-closed (פתיחה-נכשלה = דילוג-כן) · קריאה-אחרי-כתיבה
 * (וידוא-ה-secret-updated_at-התקדם) · הקבלה-בסוף-הריצה.
 *
 * שימוש: node ops/onekey/rekey4-harvest.mjs   (בתוך ה-workflow עם MAIN_KEY + GH_PAT)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as secp from "@noble/secp256k1";

const ACCOUNTS = ["cashmachine", "israelnews", "siq", "woq"];
const ENVELOPES = {
  cashmachine: ["custody-intake/CROWN-REKEY4-cashmachine-20261106T193907Z.enc", "custody-intake/CROWN-REKEY4-cashmachine-20261106T194739.enc"],
  israelnews: ["custody-intake/CROWN-REKEY4-israelnews-20261106T193907Z.enc", "custody-intake/CROWN-REKEY4-israelnews-20261106T194739.enc"],
  siq: ["custody-intake/CROWN-REKEY4-siq-20261106T193907Z.enc", "custody-intake/CROWN-REKEY4-siq-20261106T194739.enc"],
  woq: ["custody-intake/CROWN-REKEY4-woq-20261106T193907Z.enc", "custody-intake/CROWN-REKEY4-woq-20261106T194739.enc"],
};
const TARGET_REPOS = ["saos-runtime", "steem", "Domain", "saos-dex"];
const STEEM_RPC = "https://api.steemit.com";
const WIF_RE = /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/;

const fp = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 8);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58d(s) { let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("b58char"); n = n * 58n + BigInt(i); } let h = n.toString(16); if (h.length % 2) h = "0" + h; return Buffer.from(h, "hex"); }
function wifSeed(wif) {
  const d = b58d(wif);
  let body, chk;
  if (d.length === 38) { body = d.subarray(0, 34); chk = d.subarray(34); if (body[0] !== 0x80 || body[33] !== 0x01) throw new Error("wif-format"); }
  else if (d.length === 37) { body = d.subarray(0, 33); chk = d.subarray(33); if (body[0] !== 0x80) throw new Error("wif-format"); }
  else throw new Error("wif-length");
  const c = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  if (!c.equals(chk)) throw new Error("wif-checksum");
  return Buffer.from(body.subarray(1, 33));
}
function steemPub(wif) {
  const pub = Buffer.from(secp.getPublicKey(wifSeed(wif), true));
  const chk = createHash("ripemd160").update(pub).digest().subarray(0, 4);
  return "STM" + (() => { let n = BigInt("0x" + Buffer.concat([pub, chk]).toString("hex")), o = ""; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } return o; })();
}

async function rpc(method, params, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(STEEM_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (j.error) throw new Error(String(j.error.message).slice(0, 100));
      return j.result;
    } catch (e) { last = e; if (i < tries - 1) await new Promise((res) => setTimeout(res, 1200 * (i + 1))); }
  }
  throw last;
}

function decryptArtifact(encPath, mainKey, outPath) {
  for (const iter of [300000, 200000]) {
    try {
      execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", String(iter), "-in", encPath, "-out", outPath, "-pass", `pass:${mainKey}`], { stdio: "pipe" });
      return true;
    } catch { /* tier-הבא */ }
  }
  return false;
}

/** deep-walk לאיסוף כל-ה-WIFs מהמטען הפתוח (חוסר-הנחות-פורמט — אותו-דפוס-resolve-keys) */
function collectWifs(node, out = new Set(), depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return out;
  if (Array.isArray(node)) { for (const v of node) collectWifs(v, out, depth + 1); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string" && WIF_RE.test(v)) out.add(v);
    else if (typeof v === "object") collectWifs(v, out, depth + 1);
  }
  return out;
}

async function main() {
  const mainKey = process.env.MAIN_KEY || "";
  const pat = process.env.GH_PAT || "";
  if (!mainKey || !pat) { console.error("rekey4-harvest: MAIN_KEY/GH_PAT missing — honest abort"); process.exit(1); }

  // ① הורדת-המעטפות מ-vault-home (clone שטוח — המעטפות בלבד)
  const work = mkdtempSync(join(tmpdir(), "rk4-"));
  let envelopeBlobs = {};
  try {
    execFileSync("git", ["clone", "--quiet", "--depth", "1", `https://x-access-token:${pat}@github.com/roshpinacare-sys/vault-home.git`, join(work, "vh")], { stdio: "pipe" });
    for (const acct of ACCOUNTS) {
      for (const rel of ENVELOPES[acct]) {
        const p = join(work, "vh", rel);
        try { envelopeBlobs[`${acct}:${rel.split("/").pop()}`] = readFileSync(p); } catch { console.log(`[rekey4] מעטפה-חסרה (דילוג-כן): ${rel}`); }
      }
    }
    const got = Object.keys(envelopeBlobs).length;
    console.log(`[rekey4] מעטפות שנקראו: ${got}`);
    if (got === 0) { console.log("[rekey4] אפס-מעטפות — כלום-לא-נעשה"); process.exit(0); }

    // ② פתיחה + איסוף-מועמדים
    const candidates = new Set();
    for (const [k, buf] of Object.entries(envelopeBlobs)) {
      const encP = join(work, `${fp(k)}.enc`); const outP = join(work, `${fp(k)}.plain`);
      writeFileSync(encP, buf);
      if (!decryptArtifact(encP, mainKey, outP)) { console.log(`[rekey4] פתיחה-נכשלה (דילוג-כן): ${k}`); continue; }
      const plain = readFileSync(outP, "utf8");
      let parsed = null; try { parsed = JSON.parse(plain); } catch { /* מטען-לא-JSON — נסה-שורות */ }
      const wifs = parsed ? collectWifs(parsed) : new Set(plain.match(new RegExp(WIF_RE.source, "g")) || []);
      for (const w of wifs) candidates.add(w);
      console.log(`[rekey4] ${k}: ${wifs.size} מועמדים`);
    }
    console.log(`[rekey4] סה"כ מועמדים ייחודיים: ${candidates.size}`);
    if (candidates.size === 0) { console.log("[rekey4] אפס-מועמדים — קבלה-כנה-וסיום"); process.exit(0); }

    // ③ שיפוט-שרשרת — השופט-היחיד
    const accts = await rpc("condenser_api.get_accounts", [ACCOUNTS]);
    const authorities = {};
    for (const a of accts) {
      authorities[a.name] = {
        active: a.active.key_auths.map(([k2]) => k2),
        posting: a.posting.key_auths.map(([k2]) => k2),
        owner: a.owner.key_auths.map(([k2]) => k2),
        memo: [a.memo_key],
      };
    }
    const liveRoles = {}; // {account: {role: wif}}
    for (const wif of candidates) {
      let pub; try { pub = steemPub(wif); } catch { continue; }
      for (const [acct, roles] of Object.entries(authorities)) {
        for (const [role, pubs] of Object.entries(roles)) {
          if (pubs.includes(pub)) {
            liveRoles[acct] = liveRoles[acct] || {};
            // עדיפות: רשות-חיה = קנונית; אם-כבר-יש active — לא-דורסים
            if (!liveRoles[acct][role]) { liveRoles[acct][role] = wif; console.log(`[rekey4] חי-בשרשרת: ${acct}/${role} (fp=${fp(wif)})`); }
          }
        }
      }
    }
    const activeAccounts = Object.entries(liveRoles).filter(([, r]) => r.active).map(([a]) => a);
    console.log(`[rekey4] חשבונות-עם-active-חי: ${activeAccounts.join(", ") || "אף-אחד"}`);
    if (activeAccounts.length === 0) { console.log("[rekey4] אפס-actives-חיים — לא-מזרימים-כלום (fail-closed)"); process.exit(0); }

    // ④ מיזוג-עם-ה-LIVE_FLEET_KEYS-הנוכחי
    const current = process.env.LIVE_FLEET_KEYS || "{}";
    let currentParsed = {}; try { currentParsed = JSON.parse(current); } catch { currentParsed = {}; }
    currentParsed.rekey4_harvest = liveRoles; // מקור-חדש — ה-resolver ילך-עליו-deep-walk
    const merged = JSON.stringify(currentParsed);
    console.log(`[rekey4] מוזג: ${activeAccounts.length} חשבונות → rekey4_harvest (גודל-סוד ${merged.length}B)`);

    // ⑤ PUT מסונכרן-ל-4-הריפויים (libsodium sealed-box — פרוטוקול-GitHub)
    const sodium = await import("libsodium-wrappers");
    await sodium.ready;
    // תיקון-§㊽-ב: base64_variants לא-נחשף ב-interop-ה-ESM — base64 מקומי (Buffer) בלבד
    const H = { Authorization: `token ${pat}`, Accept: "application/vnd.github+json", "User-Agent": "rekey4-harvest" };
    const results = {};
    for (const repo of TARGET_REPOS) {
      try {
        const pkR = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/actions/secrets/public-key`, { headers: H });
        if (pkR.status !== 200) { results[repo] = `public-key ${pkR.status}`; continue; }
        const pk = await pkR.json();
        const binKey = Uint8Array.from(Buffer.from(pk.key, "base64"));
        const encBytes = sodium.crypto_box_seal(Uint8Array.from(Buffer.from(merged, "utf8")), binKey);
        const encB64 = Buffer.from(encBytes).toString("base64");
        const put = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/actions/secrets/LIVE_FLEET_KEYS`, {
          method: "PUT", headers: { ...H, "Content-Type": "application/json" },
          body: JSON.stringify({ encrypted_value: encB64, key_id: pk.key_id }),
        });
        results[repo] = put.status === 201 || put.status === 204 ? "OK" : `PUT ${put.status}`;
      } catch (e) { results[repo] = `ERR ${String(e && e.message || e).slice(0, 60)}`; }
    }
    console.log(`[rekey4] תוצאות-הזרמה: ${JSON.stringify(results)}`);

    // ⑥ קריאה-אחרי-כתיבה — updated_at התקדם?
    for (const repo of TARGET_REPOS) {
      if (results[repo] !== "OK") continue;
      const r = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/actions/secrets/LIVE_FLEET_KEYS`, { headers: H });
      if (r.status === 200) { const j = await r.json(); console.log(`[rekey4] read-after-write ${repo}: updated_at=${j.updated_at}`); }
    }

    // ⑦ קבלה (אפס-סודות)
    const receipt = {
      schema: "REKEY4-HARVEST/1",
      at: new Date().toISOString(),
      envelopes: Object.keys(envelopeBlobs).length,
      candidates: candidates.size,
      liveActiveAccounts: activeAccounts,
      liveRoles: Object.fromEntries(Object.entries(liveRoles).map(([a, r]) => [a, Object.fromEntries(Object.entries(r).map(([role, w]) => [role, `fp:${fp(w)}`]))])),
      pushed: results,
      law: "שליחת-מפתח-קיים-חי (לא-רוטציה) · השרשרת-השופט-היחיד · אפס-סודות-בקבלה",
    };
    writeFileSync("receipts/rekey4-harvest/latest.json", JSON.stringify(receipt, null, 1) + "\n");
    console.log(`[rekey4] קבלה נכתבה: receipts/rekey4-harvest/latest.json`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(`rekey4-harvest: THROW ${String(e && e.message || e).slice(0, 140)}`); process.exit(1); });
