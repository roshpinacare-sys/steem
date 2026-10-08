/* R258 vault probe — opens the keys backup archive in-memory, prints NAMES ONLY.
 * Zero secret material is ever printed, echoed, or written outside 0700 tmp. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ROOT = "/home/z/my-project";
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "agent", "recovery-meta.json"), "utf8"));
const tmp = path.join(ROOT, ".probe-vaultbak");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });

const rel = meta.keysBackupFile ?? "";
const abs = path.join(ROOT, rel);
console.log("BACKUP_FILE:", rel, fs.existsSync(abs) ? "(local)" : "(MISSING locally)");

if (fs.existsSync(abs)) {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  console.log("SHA-PIN:", sha === meta.keysBackupSha256 ? "MATCH" : `MISMATCH got=${sha.slice(0, 8)}`);
  try {
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", abs, "-out", path.join(tmp, "inner.zip"), "-pass", `pass:${meta.keysBackupPass}`],
      { stdio: ["ignore", "ignore", "pipe"] });
    console.log("DECRYPT: OK");
  } catch (e) {
    console.log("DECRYPT: FAIL status=" + (e?.status ?? "?"));
    process.exit(0);
  }
  const inner = fs.readFileSync(path.join(tmp, "inner.zip"));
  const innerSha = crypto.createHash("sha256").update(inner).digest("hex");
  console.log("INNER-SHA:", innerSha.slice(0, 16), "(no meta pin for inner — recorded)");
  const list = execFileSync("unzip", ["-l", path.join(tmp, "inner.zip")], { encoding: "utf8" });
  console.log("---- inner archive listing (names only) ----");
  for (const line of list.split("\n")) {
    if (/^\s*\d+\s+/.test(line)) console.log(line.trim().slice(0, 120));
  }
} else {
  try {
    execFileSync("git", ["-C", ROOT, "show", `origin/saos-cockpit:${rel}`], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64e6 });
    console.log("PRESENT-ON-ORIGIN (fetchable from git history)");
  } catch {
    console.log("NOT-ON-ORIGIN either — meta points to an era whose archive is gone");
  }
}
console.log("TMP-WIPE:", (fs.rmSync(tmp, { recursive: true, force: true }), "done"));
