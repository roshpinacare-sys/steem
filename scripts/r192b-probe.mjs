import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { ethers } from "ethers";

const ROOT = "/home/z/my-project";
const ENC_PATH = path.join(ROOT, "sovereign", "weave-seal.enc");
const META_PATH = path.join(ROOT, "sovereign", "weave-seal.meta.json");
const MAGIC = "WEAVE-CLOUD-SEAL-1";

function sealPassphrase() {
  const env = process.env.WEAVE_SEAL_PASSPHRASE;
  if (env && env.length > 0) return env;
  const vaultKey = path.join(os.homedir(), ".sovereign", "vault", "secrets", "MAIN_KEY");
  return fs.readFileSync(vaultKey, "utf8").trim();
}
function sealOpen() {
  const raw = fs.readFileSync(ENC_PATH, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines[0] !== MAGIC) throw new Error("seal format unknown");
  const payload = Buffer.from(lines.slice(1).join(""), "hex");
  const salt = payload.subarray(0, 16), iv = payload.subarray(16, 28), tag = payload.subarray(28, 44), ct = payload.subarray(44);
  const key = crypto.scryptSync(sealPassphrase(), salt, 32);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}
const seal = sealOpen();
const wallet = new ethers.Wallet(seal.networkKeyHex);
if (wallet.address.toLowerCase() !== seal.networkAddress.toLowerCase()) throw new Error("self-verify FAILED");
console.log("signer:", wallet.address, "(self-verify OK, key never printed)");

const p = new ethers.JsonRpcProvider("https://rpc.zero.tech", 9369, { batchMaxCount: 1 });
const [chainId, gasWei, blockHex, bal, nonce] = await Promise.all([
  p.send("eth_chainId", []), p.send("eth_gasPrice", []), p.send("eth_blockNumber", []),
  p.send("eth_getBalance", [wallet.address, "latest"]), p.send("eth_getTransactionCount", [wallet.address, "latest"]),
]);
console.log("chainId:", parseInt(chainId, 16), "| gasPrice(wei):", BigInt(gasWei).toString(), "| block:", parseInt(blockHex, 16), "| balance(wei):", BigInt(bal).toString(), "| nonce:", parseInt(nonce, 16));
p.destroy();
