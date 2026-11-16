#!/usr/bin/env node
/**
 * army-revive-harvest.mjs — §㊾ · פקודת-הבעלים «הכל-בגיט · אין-חסימות-אמיתיות · אל-תעצור»
 * ═══════════════════════════════════════════════════════════════════════════
 * הנמדד: 8 מעטפות ARMY-ACTIVE-REVIVE-20261116T061649Z…065935Z.enc ב-vault-home/custody-intake
 * ("army active-key revival (owner-signed rotations, chain-verified txids)").
 * הפעולה: פתיחת-כולן (MAIN_KEY או SEAL_PASS — fail-closed-פר-מעטפה) → איסוף-מועמדים →
 * שיפוט-שרשרת-מלא (כל-צבא-החשבונות) → מיזוג-ל-LIVE_FLEET_KEYS → PUT ל-4-ריפויים.
 * חוקים: אפס-WIF-בלוג · אפס-שינוי-רשות (שליחת-מפתח-קיים) · קריאה-אחרי-כתיבה · קבלה.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as secp from "@noble/secp256k1";

const ROSTER = ["hcsoldier1","hcsoldier2","hcsoldier3","hcsoldier4","hcsoldier5","hcsoldier6","hcsoldier7","hcsoldier8","hcsoldier9","hcsoldier10","hcsoldier11","hcsoldier12","hcsoldier13","hcsoldier14","hcsoldier15","hcsoldier16","israelnews","cashmachine","siq","woq","tov","haran","lsa","macrame","headcorner","cornerstone"];
const TARGET_REPOS = ["saos-runtime", "steem", "Domain", "saos-dex"];
const STEEM_RPC = "https://api.steemit.com";
const WIF_RE = /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/;
const fp = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 8);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58d(s) { let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("b58char"); n = n * 58n + BigInt(i); } let h = n.toString(16); if (h.length % 2) h = "0" + h; return Buffer.from(h, "hex"); }
function b58e(buf) { let n = BigInt("0x" + buf.toString("hex")), o = ""; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } for (const b of buf) { if (b === 0) o = B58[0] + o; else break; } return o; }
function wifSeed(wif) { const d = b58d(wif); let body, chk; if (d.length === 38) { body = d.subarray(0, 34); chk = d.subarray(34); if (body[0] !== 0x80 || body[33] !== 0x01) throw new Error("wif-format"); } else if (d.length === 37) { body = d.subarray(0, 33); chk = d.subarray(33); if (body[0] !== 0x80) throw new Error("wif-format"); } else throw new Error("wif-length"); const c = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4); if (!c.equals(chk)) throw new Error("wif-checksum"); return Buffer.from(body.subarray(1, 33)); }
function wifCanonical(wif) { const seed = wifSeed(wif); const body = Buffer.concat([Buffer.from([0x80]), seed]); const chk = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4); return b58e(Buffer.concat([body, chk])); }
function steemPub(wif) { const pub = Buffer.from(secp.getPublicKey(wifSeed(wif), true)); const chk = createHash("ripemd160").update(pub).digest().subarray(0, 4); return "STM" + (() => { let n = BigInt("0x" + Buffer.concat([pub, chk]).toString("hex")), o = ""; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } return o; })(); }
async function rpc(method, params, tries = 3) { let last; for (let i = 0; i < tries; i++) { try { const r = await fetch(STEEM_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(20000) }); const j = await r.json(); if (j.error) throw new Error(String(j.error.message).slice(0, 100)); return j.result; } catch (e) { last = e; if (i < tries - 1) await new Promise((res) => setTimeout(res, 1200 * (i + 1))); } } throw last; }
function decryptWith(encPath, pass, outPath) { for (const iter of [300000, 200000, 100000, 600000]) { try { execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", String(iter), "-in", encPath, "-out", outPath, "-pass", "pass:" + pass], { stdio: "pipe" }); return true; } catch {} } return false; }
function collectWifs(node, out = new Set(), depth = 0) { if (!node || typeof node !== "object" || depth > 8) return out; if (Array.isArray(node)) { for (const v of node) collectWifs(v, out, depth + 1); return out; } for (const [k, v] of Object.entries(node)) { if (typeof v === "string" && WIF_RE.test(v)) out.add(v); else if (typeof v === "object") collectWifs(v, out, depth + 1); } return out; }

async function main() {
  const keys = { MAIN_KEY: process.env.MAIN_KEY || "", SEAL_PASS: process.env.SEAL_PASS || "" };
  const pat = process.env.GH_PAT || "";
  if (!pat || (!keys.MAIN_KEY && !keys.SEAL_PASS)) { console.error("army-revive-harvest: credentials missing — honest abort"); process.exit(1); }
  const work = mkdtempSync(join(tmpdir(), "arv-"));
  let opened = 0, envelopes = [];
  try {
    execFileSync("git", ["clone", "--quiet", "--depth", "1", "https://x-access-token:" + pat + "@github.com/roshpinacare-sys/vault-home.git", join(work, "vh")], { stdio: "pipe" });
    const dir = join(work, "vh", "custody-intake");
    envelopes = readdirSync(dir).filter(f => /^ARMY-ACTIVE-REVIVE-.*\.enc$/.test(f)).sort();
    console.log("[army-revive] מעטפות-נמדדו: " + envelopes.length);
    if (envelopes.length === 0) { console.log("[army-revive] אפס-מעטפות — סיום-כן"); process.exit(0); }
    const candidates = new Set(); const meta = [];
    for (const f of envelopes) {
      const encP = join(work, f + ".enc"); const outP = join(work, f + ".plain");
      writeFileSync(encP, readFileSync(join(dir, f)));
      let ok = false, used = "—";
      for (const [kn, kv] of Object.entries(keys)) { if (!kv || ok) continue; if (decryptWith(encP, kv, outP)) { ok = true; used = kn; } }
      if (!ok) { console.log("[army-revive] פתיחה-נכשלה-שני-המפתחות (דילוג-כן): " + f); continue; }
      opened++;
      const plain = readFileSync(outP, "utf8");
      let parsed = null; try { parsed = JSON.parse(plain); } catch {}
      const wifs = parsed ? collectWifs(parsed) : new Set(plain.match(new RegExp(WIF_RE.source, "g")) || []);
      for (const w of wifs) candidates.add(w);
      const accounts = parsed ? (Array.isArray(parsed) ? parsed.map(x => x?.account).filter(Boolean) : (parsed.account ? [parsed.account] : Object.keys(parsed))) : [];
      meta.push({ file: f, openedWith: used, wifs: wifs.size, accounts: [...new Set(accounts)].slice(0, 6), txids: (plain.match(/[0-9a-f]{40}/g) || []).slice(0, 4) });
      console.log("[army-revive] " + f + " · נפתח-עם-" + used + " · " + wifs.size + " מועמדים");
    }
    console.log("[army-revive] נפתחו " + opened + "/" + envelopes.length + " · מועמדים-ייחודיים " + candidates.size);
    if (candidates.size === 0) { console.log("[army-revive] אפס-מועמדים — קבלה-כנה-וסיום"); writeReceipt(meta, {}, {}); process.exit(0); }

    // שיפוט-שרשרת-מלא (השופט-היחיד)
    const accts = await rpc("condenser_api.get_accounts", [ROSTER]);
    const authorities = {};
    for (const a of accts) authorities[a.name] = { active: a.active.key_auths.map(([k2]) => k2), posting: a.posting.key_auths.map(([k2]) => k2), owner: a.owner.key_auths.map(([k2]) => k2), memo: [a.memo_key] };
    const liveRoles = {};
    for (const wif of candidates) {
      let pub; try { pub = steemPub(wif); } catch { continue; }
      for (const [acct, roles] of Object.entries(authorities)) for (const [role, pubs] of Object.entries(roles)) if (pubs.includes(pub)) { liveRoles[acct] = liveRoles[acct] || {}; if (!liveRoles[acct][role]) { liveRoles[acct][role] = wifCanonical(wif); console.log("[army-revive] חי-בשרשרת: " + acct + "/" + role + " (fp=" + fp(wif) + ")"); } }
    }
    const activeAccounts = Object.entries(liveRoles).filter(([, r]) => r.active).map(([a]) => a);
    console.log("[army-revive] חשבונות-עם-active-חי: " + (activeAccounts.join(", ") || "אף-אחד"));
    if (activeAccounts.length === 0) { writeReceipt(meta, {}, {}); process.exit(0); }

    // מיזוג-והזרמה
    const current = process.env.LIVE_FLEET_KEYS || "{}";
    let cur = {}; try { cur = JSON.parse(current); } catch {}
    cur.army_revive_harvest = liveRoles;
    const merged = JSON.stringify(cur);
    console.log("[army-revive] מוזג " + activeAccounts.length + " חשבונות (גודל-סוד " + merged.length + "B)");
    const mod = await import("libsodium-wrappers"); const sodium = mod.default ?? mod; await sodium.ready;
    const H = { Authorization: "token " + pat, Accept: "application/vnd.github+json", "User-Agent": "army-revive-harvest" };
    const results = {};
    for (const repo of TARGET_REPOS) {
      try {
        const pkR = await fetch("https://api.github.com/repos/roshpinacare-sys/" + repo + "/actions/secrets/public-key", { headers: H });
        if (pkR.status !== 200) { results[repo] = "public-key " + pkR.status; continue; }
        const pk = await pkR.json();
        const encBytes = sodium.crypto_box_seal(Uint8Array.from(Buffer.from(merged, "utf8")), Uint8Array.from(Buffer.from(pk.key, "base64")));
        const put = await fetch("https://api.github.com/repos/roshpinacare-sys/" + repo + "/actions/secrets/LIVE_FLEET_KEYS", { method: "PUT", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ encrypted_value: Buffer.from(encBytes).toString("base64"), key_id: pk.key_id }) });
        results[repo] = put.status === 201 || put.status === 204 ? "OK" : "PUT " + put.status;
      } catch (e) { results[repo] = "ERR " + String(e && e.message || e).slice(0, 50); }
    }
    console.log("[army-revive] תוצאות-הזרמה: " + JSON.stringify(results));
    for (const repo of TARGET_REPOS) { if (results[repo] !== "OK") continue; const r = await fetch("https://api.github.com/repos/roshpinacare-sys/" + repo + "/actions/secrets/LIVE_FLEET_KEYS", { headers: H }); if (r.status === 200) { const j = await r.json(); console.log("[army-revive] read-after-write " + repo + ": updated_at=" + j.updated_at); } }
    writeReceipt(meta, results, liveRoles);
    function writeReceipt(meta, results, liveRoles) {
      try {
        mkdirSync("receipts/army-revive-harvest", { recursive: true });
        writeFileSync("receipts/army-revive-harvest/latest.json", JSON.stringify({ schema: "ARMY-REVIVE-HARVEST/1", at: new Date().toISOString(), envelopesMeasured: envelopes.length, envelopesOpened: opened, meta: meta.map(m => ({ file: m.file, openedWith: m.openedWith, wifs: m.wifs, accounts: m.accounts, txidFps: m.txids.map(t => t.slice(0, 8)) })), liveActiveAccounts: Object.entries(liveRoles).filter(([, r]) => r.active).map(([a]) => a), liveRoles: Object.fromEntries(Object.entries(liveRoles).map(([a, r]) => [a, Object.fromEntries(Object.entries(r).map(([role, w]) => [role, "fp:" + fp(w)]))])), pushed: results, law: "שליחת-מפתח-קיים-חי · השרשרת-השופט · אפס-סודות-בקבלה" }, null, 1) + "\n");
        console.log("[army-revive] קבלה: receipts/army-revive-harvest/latest.json");
      } catch (e) { console.log("[army-revive] קבלה-נכשלה (לא-קטלני): " + String(e).slice(0, 80)); }
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
}
main().catch((e) => { console.error("army-revive-harvest: THROW " + String(e && e.message || e).slice(0, 140)); process.exit(1); });
