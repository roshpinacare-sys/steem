// soldier-era-export.mjs — G-M6-era3 · יצוא-משמורת-חיילים-חוץ-runner (חד-פעמי, 2026-11-06)
// ═══════════════════════════════════════════════════════════════════════════════
// צו-בעלים (2026-11-06, "אני מאשר בצע הכי טוב שאפשר"): מפתחות saos-0005..0011
// חיים-רק-על-ה-runner (.secrets/soldiers.json + גזירה-חיה) — בן-ערובה-לדיסק-אחד.
// הכלי: קורא-סיסמאות → גוזר-4-תפקידים-לכל-חייל (אותו-חוק: name+role+password
// → sha256 → WIF — זהה-ל-soldiers.mjs/steemtx.wifFor) → שופט-מול-השרשרת-החיה →
// אוטם-מפה-מאומתת → vault-home/custody-intake/VERIFIED-SOLDIERS-<ts>.enc.
//
// חוקים: fail-closed (אפס-מאומת = אין-אטימה, exit-2) · אפס-ערכים-בפלט (טביעות-
// אצבע-8-hex-בלבד) · אין-סיבוב-מפתחות (אף-רשות-לא-משתנה) · אטימה:
// MAIN_KEY (env) או --seal-pass (≥16 · נבחר-בעלים · מת-אחרי-הפתיחה).
//
// שימוש:  node ops/soldier-era-export.mjs --judge          (שיפוט-בלבד, בלי-אטימה)
//         node ops/soldier-era-export.mjs                   (MAIN_KEY מה-env)
//         node ops/soldier-era-export.mjs --seal-pass XXXX  (סיסמה-חד-פעמית)
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, createRequire } from "node:crypto";
/* רזולוציית-noble: ops/ לא-יורש-node_modules — מושך-מ-saos-engine ישירות (נמדד-במבנה-ה-repo) */
let secp;
try { secp = await import("@noble/secp256k1"); }
catch { const here = path.dirname(new URL(import.meta.url).pathname); const req = createRequire(path.join(here, "..", "mini-services", "saos-engine", "package.json")); secp = req("@noble/secp256k1"); }

const args = process.argv.slice(2);
const judgeOnly = args.includes("--judge");
const sealPassIdx = args.indexOf("--seal-pass");
const sealPass = sealPassIdx >= 0 ? String(args[sealPassIdx + 1] ?? "") : "";
const PASS = sealPass || (process.env.MAIN_KEY ?? "").trim();
const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..", "..");
const SOLDIERS = path.join(REPO, ".secrets", "soldiers.json");
const ROLES = ["owner", "active", "posting", "memo"];

const fp = (s) => createHash("sha256").update(String(s)).digest().toString("hex").slice(0, 8);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58e(buf) { let n = BigInt("0x" + buf.toString("hex") || "0"), o = ""; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } for (const b of buf) { if (b === 0) o = "1" + o; else break; } return o; }
function wifEncode(seed32) { const body = Buffer.concat([Buffer.from([0x80]), Buffer.from(seed32), Buffer.from([0x01])]); const chk = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4); return b58e(Buffer.concat([body, chk])); }
function steemPub(seed32) { const pub = Buffer.from(secp.getPublicKey(Buffer.from(seed32), true)); const chk = createHash("ripemd160").update(pub).digest().subarray(0, 4); return "STM" + b58e(Buffer.concat([pub, chk])); }
async function rpc(method, params, tries = 3) { let last; for (let i = 0; i < tries; i++) { try { const r = await fetch("https://api.steemit.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(15000) }).then((x) => x.json()); if (r.error) throw new Error(r.error.message); return r.result; } catch (e) { last = e; } } throw last; }

const db = JSON.parse(fs.readFileSync(SOLDIERS, "utf8"));
const accounts = db.accounts ?? [];
if (!accounts.length) { console.error("soldier-era-export: soldiers.json empty — nothing to export (honest)"); process.exit(1); }
console.log(`soldier-era-export: ${accounts.length} soldier passwords loaded (fps: ${accounts.map((a) => a.fingerprint ?? fp(a.password)).join(",")})`);

const chain = await rpc("condenser_api.get_accounts", [accounts.map((a) => a.name)]);
const byName = new Map((chain ?? []).map((a) => [a.name, a]));
const map = {}; let verifiedRoles = 0, totalRoles = 0;
for (const s of accounts) {
  const live = byName.get(s.name);
  if (!live) { console.log(`  ${s.name}: NOT-ON-CHAIN — skipped`); continue; }
  const auth = { owner: live.owner.key_auths.map((k) => k[0]), active: live.active.key_auths.map((k) => k[0]), posting: live.posting.key_auths.map((k) => k[0]), memo: [live.memo_key] };
  map[s.name] = {};
  for (const role of ROLES) {
    totalRoles++;
    const seed = createHash("sha256").update(Buffer.from(`${s.name}${role}${s.password}`, "utf8")).digest();
    const pub = steemPub(seed);
    if ((auth[role] ?? []).includes(pub)) { map[s.name][role] = wifEncode(seed); verifiedRoles++; console.log(`  ${s.name}.${role}: MATCH (${pub.slice(0, 12)}…)`); }
    else console.log(`  ${s.name}.${role}: MISMATCH (derived ${pub.slice(0, 12)}… vs live ${(auth[role] ?? [])[0]?.slice(0, 12) ?? "none"}…) — recorded as wound, not sealed`);
  }
}
console.log(`\njudge: verified=${verifiedRoles}/${totalRoles}`);
if (judgeOnly) process.exit(verifiedRoles > 0 ? 0 : 2);
if (verifiedRoles === 0) { console.error("soldier-era-export: zero verified — fail-closed, no seal"); process.exit(2); }
if (!PASS || PASS.length < 16) { console.error("soldier-era-export: no MAIN_KEY/--seal-pass (≥16) — honest abort, nothing sealed"); process.exit(1); }

const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
const work = `/tmp/era3-soldiers-${Date.now()}`;
fs.mkdirSync(work, { recursive: true });
const plain = path.join(work, "verified-soldiers.json");
fs.writeFileSync(plain, JSON.stringify({ format: "verified-soldiers-1", at: new Date().toISOString(), judge: "live-chain", accounts: map }, null, 1), { mode: 0o600 });
execFileSync("git", ["clone", "--depth", "1", `https://x-access-token:${process.env.GH_PAT}@github.com/roshpinacare-sys/vault-home.git`, work + "/vh"], { stdio: "pipe" });
const encPath = `${work}/vh/custody-intake/VERIFIED-SOLDIERS-${ts}.enc`;
execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "300000", "-pass", `pass:${PASS}`, "-in", plain, "-out", encPath]);
const sha = execFileSync("sha256sum", [encPath], { encoding: "utf8" }).split(" ")[0];
fs.appendFileSync(`${work}/vh/vault-chain/CUSTODY-LEDGER.jsonl`, JSON.stringify({ ts, event: "seal", artifact: `custody-intake/VERIFIED-SOLDIERS-${ts}.enc`, purpose: "G-M6-era3: saos soldier custody off-runner (chain-judged per role; owner-approved)", sha256: sha, secrets: "NONE (ciphertext only)" }) + "\n");
const cwd = process.cwd(); process.chdir(work + "/vh");
execFileSync("git", ["add", `custody-intake/VERIFIED-SOLDIERS-${ts}.enc`, "vault-chain/CUSTODY-LEDGER.jsonl"]);
execFileSync("git", ["-c", "user.email=sovereign@fleet", "-c", "user.name=crown-soldier-era", "commit", "-m", `soldier-era3 custody seal ${ts}: ${verifiedRoles}/${totalRoles} roles chain-verified [skip ci]`]);
execFileSync("git", ["push"]); process.chdir(cwd);
fs.rmSync(work, { recursive: true, force: true });
console.log(`\nsealed → vault-home custody-intake/VERIFIED-SOLDIERS-${ts}.enc (sha ${sha.slice(0, 10)}) — seal-fp: ${fp(PASS)}`);
