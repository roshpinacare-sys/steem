// gen1-backup-probe.mjs — G57 · KEYS-BACKUP-2026-09-09 CUSTODY PROBE (runner-only, fail-closed).
// אותו-חוק-כספת-כמו gen1-sign-hive.mjs: נפתח-את-הארכיון-הכבד-של-GEN-1
// (KEYS-BACKUP-2026-09-09.tar.enc) עם הסוד-שמור-ב-Actions (STEEM_VAULT_PASSES →
// gen1.keysBackupUnlock), שופט כל מפתח בתוכו מול הסמכויות החיות בשתי השרשרות
// (hive+steem), ומפיק קבלה כנה. אפס-חומר-סודי-נדפס-או-נכתב. כשל-קריא = ערך-אמת.
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { fingerprint } from "./steemtx.mjs";
import { wifDecode } from "./steemtx.mjs";
import { getPublicKey } from "@noble/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import bs58 from "bs58";

const sha256hex = (b) => crypto.createHash("sha256").update(b).digest("hex");
function pubFromSeed(seed32) {
  const pub = getPublicKey(Buffer.from(seed32), true);
  const chk = Buffer.from(ripemd160(Buffer.from(pub))).slice(0, 4);
  return "STM" + bs58.encode(Buffer.concat([Buffer.from(pub), chk]));
}
const pubOfWif = (wif) => pubFromSeed(wifDecode(wif));
const log = (o) => {
  console.log(JSON.stringify(o));
  try { fs.appendFileSync("custody-receipt.jsonl", JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n"); } catch {}
};

async function rpc(nodes, method, params) {
  let last = "no-node";
  for (const host of nodes) {
    try {
      const r = await fetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (d.error) { last = d.error.message; continue; }
      return d.result;
    } catch (e) { last = String(e); }
  }
  throw new Error("all nodes failed: " + last);
}

const [steemAcct] = await rpc(["https://api.steemit.com"], "condenser_api.get_accounts", [["headcorner"]]);
const hiveAcct = (await rpc(["https://api.hive.blog", "https://api.hive.dev"], "condenser_api.get_accounts", [["headcorner"]]))[0];
if (!steemAcct || !hiveAcct) { log({ ok: false, error: "headcorner-account-absent", steem: !!steemAcct, hive: !!hiveAcct }); process.exit(1); }
const live = {
  steem: { owner: steemAcct.owner.key_auths[0][0], active: steemAcct.active.key_auths[0][0], posting: steemAcct.posting.key_auths[0][0], memo: steemAcct.memo_key },
  hive: { owner: hiveAcct.owner.key_auths[0][0], active: hiveAcct.active.key_auths[0][0], posting: hiveAcct.posting.key_auths[0][0], memo: hiveAcct.memo_key },
};
log({ step: "live-authorities", hivePosting: fingerprint(live.hive.posting), steemPosting: fingerprint(live.steem.posting) });

const WIF_RE = /[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{50,52}/g;
const liveHits = [];
function judgeText(text, tag) {
  for (const tok of String(text).match(WIF_RE) ?? []) {
    try {
      const pub = pubOfWif(tok);
      const hits = [];
      for (const chain of ["hive", "steem"]) for (const [role, lp] of Object.entries(live[chain])) if (pub === lp) hits.push(`${chain}/${role}`);
      if (hits.length) liveHits.push({ tag, pub, hits });
    } catch { /* not a WIF */ }
  }
}

// ── 1. הארכיון-הכבד (sha-pinned מול recovery-meta-3) ─────────────────────────
const meta = JSON.parse(fs.readFileSync(new URL("../../agent/recovery-meta.json", import.meta.url).pathname, "utf8"));
const tarEnc = fs.readFileSync(new URL("../../agent/vault/KEYS-BACKUP-2026-09-09.tar.enc", import.meta.url).pathname);
if (sha256hex(tarEnc) !== meta.keysBackupSha256) { log({ ok: false, error: "backup-outer-sha-mismatch" }); process.exit(1); }
let bundle = {};
try { bundle = JSON.parse(process.env.STEEM_VAULT_PASSES ?? "{}"); } catch { log({ ok: false, error: "pass-bundle-not-json" }); process.exit(1); }
const pass = bundle?.gen1?.keysBackupUnlock;
if (typeof pass !== "string" || pass.length < 8) { log({ ok: false, error: "gen1.keysBackupUnlock-absent" }); process.exit(1); }

// ── 2. פתיחה — נסיון-וריאציות-openssl-בסדר-ידוע (מהמטריצה-של-G51), וריאציה-ראשונה=התבנית-של-הדור ──
const VARIANTS = [
  ["-aes-256-cbc", "-pbkdf2", "-iter", "300000", "-md", "sha256"],
  ["-aes-256-cbc", "-pbkdf2", "-iter", "300000", "-md", "md5"],
  ["-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-md", "sha256"],
  ["-aes-256-cbc", "-pbkdf2", "-iter", "100000", "-md", "sha256"],
  ["-aes-256-cbc", "-md", "md5"],
  ["-aes-256-cbc", "-md", "sha256"],
];
const tmp = fs.mkdtempSync(os.tmpdir() + "/g57-");
fs.writeFileSync(`${tmp}/b.enc`, tarEnc, { mode: 0o600 });
let inner = null, used = null;
for (const v of VARIANTS) {
  try {
    execFileSync("openssl", ["enc", "-d", ...v, "-in", `${tmp}/b.enc`, "-out", `${tmp}/inner.tar`, "-pass", `pass:${pass}`], { stdio: ["ignore", "ignore", "pipe"] });
    const cand = fs.readFileSync(`${tmp}/inner.tar`);
    const s = cand.subarray(257, 262).toString("latin1");
    if (cand.length > 512 && (s.startsWith("ustar") || cand.subarray(0, 2).toString("hex") === "504b" || cand.subarray(0, 2).toString("hex") === "1f8b")) { inner = cand; used = v.join(" "); break; }
  } catch { /* וריאציה-שגויה */ }
}
if (!inner) { log({ ok: false, error: "backup-unlock-failed-all-variants" }); process.exit(1); }
log({ step: "backup-opened-sha-pinned", variant: used, innerBytes: inner.length });
fs.writeFileSync(`${tmp}/inner.tar`, inner, { mode: 0o600 });
fs.rmSync(`${tmp}/inner.tar`, { force: true });
fs.writeFileSync(`${tmp}/inner.tar.raw`, inner, { mode: 0o600 });
fs.mkdirSync(`${tmp}/o`, { recursive: true });
try { execFileSync("tar", ["-xf", `${tmp}/inner.tar.raw`, "-C", `${tmp}/o`]); } catch (e) {
  try { execFileSync("tar", ["-xzf", `${tmp}/inner.tar.raw`, "-C", `${tmp}/o`]); } catch { log({ ok: false, error: "tar-extract-failed" }); process.exit(1); }
}
const files = [];
const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const fp = p + "/" + e.name; if (e.isDirectory()) walk(fp); else files.push(fp); } };
walk(`${tmp}/o`);
log({ step: "backup-files", n: files.length, names: files.map((f) => f.split("/").pop()).slice(0, 24) });
for (const f of files) {
  try { judgeText(fs.readFileSync(f, "utf8"), "backup:" + f.split("/").pop()); } catch { /* binary */ }
}

log({ step: "judged", liveHits: liveHits.length });
for (const h of liveHits) log({ hit: h.hits.join("+"), tag: h.tag, pubFp: fingerprint(h.pub) });

const hiveHits = liveHits.filter((h) => h.hits.some((x) => x.startsWith("hive/")));
log({ ok: true, verdict: hiveHits.length ? "live-hive-material-found" : "no-live-hive-material", steemHits: liveHits.length - hiveHits.length, hiveHits: hiveHits.length });
// יציאה-0 גם-ב-verdict-שלילי: הקבלה-הכנה-היא-התוצר, לא-החיות.
