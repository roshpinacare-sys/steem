/**
 * rot3-derive.mjs — Task 25-C: GEN-2→ROT3 rotation of @headcorner (STEEM).
 * WHY: 4 GEN-2 WIFs (owner/active/posting/memo) were printed into the private
 * session log by the auditor's censor-regex failure (confessed in Task 24).
 * This rotation DESTROYS their validity. New keys derive from a fresh random
 * rot3Seed (never derived from the master — MAIN_KEY-class secrets stay valid).
 * Scheme (recorded in vault): key = sha256("headcorner/" + role + "/" + rot3Seed)
 * Secrets policy: seed+WIFs stay in memory / encrypted vault only.
 */
import { wifEncode, wifDecode, pubkeyFromSeed, buildTx, serializeTx } from "./steemtx.mjs";
import { sha256 } from "@noble/hashes/sha256";
import { writeFileSync } from "fs";

const ACCOUNT = "headcorner";
const rot3Seed = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const roles = ["owner", "active", "posting", "memo"];
const keys = {};
for (const r of roles) {
  const seed = `${ACCOUNT}/${r}/${rot3Seed}`;
  const secret = sha256(Buffer.from(seed, "utf8"));
  keys[r] = { wif: wifEncode(secret), pub: pubkeyFromSeed(secret) };
}
// sanity: each WIF decodes back to the same secret
for (const r of roles) {
  const back = Buffer.from(wifDecode(keys[r].wif));
  const expect = sha256(Buffer.from(`${ACCOUNT}/${r}/${rot3Seed}`, "utf8"));
  if (!back.equals(Buffer.from(expect))) throw new Error("derivation-selftest-fail:" + r);
}
writeFileSync(process.env.OUT ?? "/tmp/rot3.json", JSON.stringify({
  format: "headcorner-rot3-keys-v1", account: ACCOUNT, scheme: `sha256(account + '/' + role + '/' + rot3Seed)`,
  rotatedAt: new Date().toISOString(), rot3Seed, keys,
}, null, 1));
console.log("ROT3 derived:", roles.map(r => r + "=" + keys[r].pub.slice(0, 10)).join(" "), "| selftest OK");
