/* R210 RE-ANCHOR · verdict-only KEYS_BACKUP opener.
 * Harvests password candidates from operator scrolls (password-mention context),
 * tries them against the openssl-enc tar with a profile matrix, validates the
 * plaintext as tar (ustar magic), and on success EXTRACTS to a 0600 dir +
 * reports inventory verdicts. Never prints passwords or key material. */
import fs from "fs";
import { spawnSync } from "child_process";

const SCROLL = "/home/z/my-project/upload/הד.txt";
const TAR_A = "/home/z/my-project/upload/KEYS_BACKUP_2026_09_09.tar.enc";
const TAR_B = "/home/z/my-project/upload/KEYS_BACKUP_2026_09_09.tar (2).enc";
const OUTDIR = "/home/z/my-project/.secrets/keys-backup-recovered";

const lines = fs.readFileSync(SCROLL, "utf8").split(/\r?\n/);
// 1) password-context lines ±2
const ctx = new Set();
lines.forEach((l, i) => {
  if (/password|סיסמ|passphrase/i.test(l)) for (let d = -2; d <= 2; d++) if (lines[i + d]) ctx.add(lines[i + d]);
});
// 2) harvest candidate tokens from context: words, quoted, code-ish, plus known shapes
const cands = new Set();
for (const l of ctx) {
  for (const m of l.matchAll(/"([^"]{4,64})"|'([^']{4,64})'|`([^`]{4,64})`/g)) cands.add(m[1] || m[2] || m[3]);
  for (const m of l.matchAll(/[\w\p{L}!@#$%^&*._+-]{6,64}/gu)) cands.add(m[0]);
}
// strip obvious non-passwords
const STOP = /^(את|של|על|אל|זה|זו|כמו|גם|לא|ולא|עם|יש|אין|כל|רק|היא|הוא|אנחנו|הסיסמ|password|passphrase|openssl|aes-256|scrypt|https?)/i;
const list = [...cands].filter((c) => !STOP.test(c) && c.length >= 6 && c.length <= 64);
console.log(`candidates harvested: ${list.length}`);

const PROFILES = [
  ["-aes-256-cbc", "-md", "sha256"],
  ["-aes-256-cbc", "-md", "md5"],
  ["-aes-256-cbc", "-pbkdf2", "-iter", "10000"],
  ["-aes-256-cbc", "-pbkdf2", "-iter", "100000"],
  ["-aes-128-cbc", "-md", "sha256"],
  ["-aes-256-ecb"],
  ["-des3", "-md", "sha256"],
];

function tryOpen(tar, pass) {
  for (const prof of PROFILES) {
    const out = `/tmp/kb_try.bin`;
    const r = spawnSync("openssl", ["enc", "-d", "-salt", ...prof, "-in", tar, "-pass", `pass:${pass}`, "-out", out], { timeout: 20000 });
    if (r.status === 0) {
      const fd = fs.openSync(out, "r");
      const buf = Buffer.alloc(512);
      fs.readSync(fd, buf, 0, 512, 0);
      fs.closeSync(fd);
      if (buf.slice(257, 262).toString() === "ustar") return { prof: prof.join(" "), out };
    }
  }
  return null;
}

const tars = [TAR_A, TAR_B].filter((t) => fs.existsSync(t));
let opened = null, usedPass = null, usedTar = null;
outer: for (const tar of tars) {
  console.log(`target: ${tar.split("/").pop()} (${fs.statSync(tar).size}B)`);
  for (const pass of list) {
    const hit = tryOpen(tar, pass);
    if (hit) { opened = hit; usedPass = pass; usedTar = tar; break outer; }
  }
}

if (opened) {
  console.log(`TAR OPENED ✓ (profile: ${opened.prof}) — extracting…`);
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.chmodSync(OUTDIR, 0o700);
  const t = `/tmp/kb_open.tar`;
  fs.copyFileSync(opened.out, t);
  const ls = spawnSync("tar", ["-tf", t], { encoding: "utf8" });
  const entries = (ls.stdout || "").split(/\r?\n/).filter(Boolean);
  console.log(`entries: ${entries.length}`);
  for (const e of entries.slice(0, 40)) console.log(`  ${e}`);
  spawnSync("tar", ["-xf", t, "-C", OUTDIR]);
  spawnSync("chmod", ["-R", "go-rwx", OUTDIR]);
  console.log(`extracted to 0700 dir. Inventory verdict only — contents not printed.`);
  // classify files by name/shape
  const walk = (d, p = "") => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const f = p + e.name;
    return e.isDirectory() ? walk(`${d}/${e.name}`, `${f}/`) : [f];
  });
  const files = walk(OUTDIR);
  const shape = (f) => {
    const head = fs.readFileSync(f).subarray(0, 64).toString("utf8");
    if (/^-----BEGIN/i.test(head)) return "PEM";
    if (/^5[JK]/.test(head) || /^[KL][1-9A-HJ-NP-Za-km-z]{51}/.test(head)) return "WIF-ish";
    if (/^P[1-9A-HJ-NP-Za-km-z]{50,}/.test(head)) return "P-KEY/PASSWORD";
    return `text(${head.slice(0, 12).replace(/[^\x20-\x7e]/g, ".")}…)`;
  };
  for (const f of files) console.log(`  file: ${f.replace(OUTDIR, "…")} shape=${shape(f)} size=${fs.statSync(f).size}`);
  fs.rmSync(t, { force: true }); fs.rmSync("/tmp/kb_try.bin", { force: true });
} else {
  console.log("NO PROFILE×PASSWORD OPENED THE TAR — verdict: password not in scroll context. Operator-gated next source.");
}
