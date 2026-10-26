/* R210 DEEP SWEEP · verdict-only.
 * A) Retry KEYS_BACKUP tar with the EXACT documented profile (-aes-256-cbc -pbkdf2 -iter 300000)
 * B) Headcorner master-password sweep: every distinct scroll token × SEED_ORDERS × roles
 *    vs LIVE chain authorities. Match → write upload/headcorner.txt (0600). Never print secrets. */
import fs from "fs";
import { spawnSync } from "child_process";
import { derivePub, pubkeyFromSeed, wifDecode } from "./steemtx.mjs";

const SCROLL = "/home/z/my-project/upload/הד.txt";
const TAR = "/home/z/my-project/upload/KEYS_BACKUP_2026_09_09.tar.enc";
const OUT = "/home/z/my-project/upload/headcorner.txt";
const ACCOUNT = "headcorner";
const RPC = "https://api.steemit.com";

const auth = await fetch(RPC, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[ACCOUNT]], id: 1 }),
}).then((r) => r.json()).then((j) => j.result?.[0]);
const AUTH = {
  owner: new Set(auth.owner.key_auths.map((k) => k[0])),
  active: new Set(auth.active.key_auths.map((k) => k[0])),
  posting: new Set(auth.posting.key_auths.map((k) => k[0])),
};

/* ── candidates ── */
const text = fs.readFileSync(SCROLL, "utf8");
const lines = text.split(/\r?\n/);
const tokens = new Set();
// every unicode word token 4..80 chars
for (const m of text.matchAll(/[\p{L}\p{N}!@#$%^&*()_+=.[\]{};:'",.<>/?\\|`~*-]{4,80}/gu)) tokens.add(m[0]);
// full lines from password-context ±3 (phrase-passwords)
const pwLines = new Set();
lines.forEach((l, i) => {
  if (/password|סיסמ|steemitwallet|peakd|התחבר/i.test(l)) for (let d = -3; d <= 3; d++) if (lines[i + d]?.trim()) pwLines.add(lines[i + d].trim());
});
const candList = [...tokens, ...pwLines];
console.log(`sweep candidates: ${candList.length} (tokens ${tokens.size} + phrase-lines ${pwLines.size})`);

/* ── B) account derivation sweep ── */
const ROLES = ["posting", "active", "owner"];
const ORDERS = { "name+role+pw": (a, r, p) => `${a}${r}${p}`, "pw+role+name": (a, r, p) => `${p}${r}${a}`, "role+name+pw": (a, r, p) => `${r}${a}${p}`, "name+pw+role": (a, r, p) => `${a}${p}${r}` };
let hit = null, tried = 0;
for (const cand of candList) {
  // raw WIF attempt
  const bare = cand.startsWith("P") && cand.length >= 51 ? cand.slice(1) : cand;
  try {
    const stm = pubkeyFromSeed(wifDecode(bare));
    tried++;
    const roles = ROLES.filter((r) => AUTH[r].has(stm));
    if (roles.length) { hit = { cand, via: "wif", roles }; break; }
  } catch { /* not a wif */ }
  // derivation attempt
  for (const role of ROLES) {
    for (const [order, fn] of Object.entries(ORDERS)) {
      tried++;
      const stm = derivePub(fn(ACCOUNT, role, cand));
      if (AUTH[role].has(stm)) { hit = { cand, via: `derive:${order}`, roles: [role] }; break; }
    }
    if (hit) break;
  }
  if (hit) break;
}
console.log(`derivation sweep: ${tried} tests → ${hit ? "HIT" : "no hit"}`);
if (hit) {
  fs.writeFileSync(OUT, `${ACCOUNT} ${hit.cand}\n`, { mode: 0o600 });
  fs.chmodSync(OUT, 0o600);
  console.log(`REVIVAL WRITTEN → upload/headcorner.txt · via=${hit.via} · roles=${hit.roles.join(",")} · secret never printed`);
} else {
  /* ── A) tar with exact profile ── */
  console.log("tar retry with documented profile (iter 300000)…");
  const prof = ["-aes-256-cbc", "-pbkdf2", "-iter", "300000"];
  let opened = null;
  for (const pass of candList) {
    const r = spawnSync("openssl", ["enc", "-d", "-salt", ...prof, "-in", TAR, "-pass", `pass:${pass}`, "-out", "/tmp/kb2.bin"], { timeout: 30000 });
    if (r.status === 0) {
      const fd = fs.openSync("/tmp/kb2.bin", "r");
      const b = Buffer.alloc(512); fs.readSync(fd, b, 0, 512, 0); fs.closeSync(fd);
      if (b.slice(257, 262).toString() === "ustar") { opened = pass; fs.copyFileSync("/tmp/kb2.bin", "/tmp/kb2.tar"); break; }
    }
  }
  if (opened) {
    console.log("TAR OPENED ✓ (documented profile) — inventory:");
    fs.mkdirSync("/home/z/my-project/.secrets/keys-backup-recovered", { recursive: true });
    spawnSync("tar", ["-xzf", "/tmp/kb2.tar", "-C", "/home/z/my-project/.secrets/keys-backup-recovered"]);
    spawnSync("chmod", ["-R", "go-rwx", "/home/z/my-project/.secrets/keys-backup-recovered"]);
    const ls = spawnSync("tar", ["-tzf", "/tmp/kb2.tar"], { encoding: "utf8" });
    for (const e of (ls.stdout || "").split(/\r?\n/).filter(Boolean)) console.log(`  ${e}`);
    console.log("NOTE: per README, headcorner CURRENT keys are NOT inside — but army vault + sovereign root are back.");
  } else console.log("tar still sealed with swept candidates.");
}
