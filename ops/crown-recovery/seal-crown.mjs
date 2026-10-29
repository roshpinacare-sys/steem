// seal-crown.mjs — seal the verified crown map to vault-home + relay LIVE_FLEET_KEYS.
// Same protocol as ops/custody-census/relay-seal.mjs (one mechanism, one law).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";

const PAT = process.env.GH_PAT || "";
const SEAL_PASS = process.env.SEAL_PASS || "";
const B64FILE = "/tmp/crown_map.b64";
if (!PAT) { console.error("seal-crown: GH_PAT missing"); process.exit(1); }
if (!SEAL_PASS || SEAL_PASS.length < 16) { console.error("seal-crown: seal_pass missing/short"); process.exit(1); }
if (!existsSync(B64FILE)) { console.error("seal-crown: no census output — honest abort"); process.exit(1); }
const b64 = readFileSync(B64FILE, "utf8").replace(/^CROWN_MAP_B64:/, "").replace(/:END\s*$/, "").trim();
const verified = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
writeFileSync("/tmp/verified.json", JSON.stringify(verified, null, 1), { mode: 0o600 });
console.log("verified accounts:", Object.keys(verified).join(","));

const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
execFileSync("git", ["clone", "--depth", "1", `https://x-access-token:${PAT}@github.com/roshpinacare-sys/vault-home.git`, "/tmp/vh2"], { stdio: "pipe" });
mkdirSync("/tmp/vh2/custody-intake", { recursive: true });
execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "300000", "-pass", `pass:${SEAL_PASS}`, "-in", "/tmp/verified.json", "-out", `/tmp/vh2/custody-intake/CROWN-RECOVERY-${ts}.enc`]);
const sha256 = (f) => execFileSync("sha256sum", [f], { encoding: "utf8" }).split(" ")[0];
const sha = sha256(`/tmp/vh2/custody-intake/CROWN-RECOVERY-${ts}.enc`);
writeFileSync("/tmp/vh2/vault-chain/CUSTODY-LEDGER.jsonl",
  JSON.stringify({ ts, event: "seal", artifact: `custody-intake/CROWN-RECOVERY-${ts}.enc`, purpose: "crown-vault-recovery: ALL live keys mined from secrets+vault+git-history, chain-judged; owner law one-clean-custody", sha256: sha, secrets: "NONE (ciphertext only)" }) + "\n",
  { flag: "a" });
const cwd = process.cwd();
process.chdir("/tmp/vh2");
execFileSync("git", ["add", `custody-intake/CROWN-RECOVERY-${ts}.enc`, "vault-chain/CUSTODY-LEDGER.jsonl"]);
execFileSync("git", ["-c", "user.email=sovereign@fleet", "-c", "user.name=sovereign-crown", "commit", "-m", `crown-vault-recovery seal ${ts}: full chain-verified key map [skip ci]`]);
execFileSync("git", ["push"]);
process.chdir(cwd);
rmSync("/tmp/vh2", { recursive: true, force: true });
console.log("sealed → vault-home custody-intake/CROWN-RECOVERY-" + ts + ".enc (sha " + sha.slice(0, 10) + ")");

execFileSync("npm", ["i", "--prefix", "/tmp/libsod", "libsodium-wrappers"], { stdio: "pipe" });
const payload = JSON.stringify({ live: verified, source: "crown-vault-recovery" });
async function putSecret(repo, name, value) {
  const get = (u) => fetch(u, { headers: { Authorization: `token ${PAT}`, "User-Agent": "crown" } }).then(r => r.json());
  const pk = await get(`https://api.github.com/repos/roshpinacare-sys/${repo}/actions/secrets/public-key`);
  const encv = execFileSync("node", ["-e", `
    const sodium = require("libsodium-wrappers");
    (async () => { await sodium.ready;
      const key = sodium.from_base64(process.argv[1], sodium.base64_variants.ORIGINAL);
      const ct = sodium.crypto_box_seal(Buffer.from(process.argv[2]), key);
      console.log(sodium.to_base64(ct, sodium.base64_variants.ORIGINAL));
    })();`, pk.key, value], { encoding: "utf8", env: { ...process.env, NODE_PATH: "/tmp/libsod/node_modules" } }).trim();
  const r = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/actions/secrets/${name}`, {
    method: "PUT",
    headers: { Authorization: `token ${PAT}`, "User-Agent": "crown", "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted_value: encv, key_id: pk.key_id }),
  });
  console.log(`  PUT ${name} → ${repo}: HTTP ${r.status}`);
}
for (const repo of ["saos-runtime", "Domain", "saos-dex", "steem"]) {
  try { await putSecret(repo, "LIVE_FLEET_KEYS", payload); }
  catch (e) { console.log(`  PUT ${repo} failed: ${String(e).slice(0, 120)}`); }
}
console.log("relay complete");
