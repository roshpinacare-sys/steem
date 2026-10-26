import { wifDecode, b58encode } from "./steemtx.mjs";
import * as secp from "@noble/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { readFileSync } from "fs";

const RPC = "https://blurt-rpc.saboin.com";
async function call(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
function bltPub(secret) {
  const pub = secp.getPublicKey(Buffer.from(secret), true);
  const chk = Buffer.from(ripemd160(Buffer.from(pub))).slice(0, 4);
  return "BLT" + b58encode(Buffer.concat([Buffer.from(pub), chk]));
}
// GEN-2 vault WIFs (decrypted in-memory only)
const vaultPath = process.env.VAULT_JSON || "";
if (!vaultPath) { console.error("VAULT_JSON env required"); process.exit(2); }
const vault = JSON.parse(readFileSync(vaultPath, "utf8"));
const held = {};
for (const a of vault.accounts) {
  held[a.username] = {};
  for (const [role, k] of Object.entries(a.keys ?? {})) {
    if (k?.wif) { try { held[a.username][role] = bltPub(wifDecode(k.wif)); } catch { /* skip */ } }
  }
}
const users = Object.keys(held);
const accs = await call("condenser_api.get_accounts", [users]);
const out = { at: new Date().toISOString(), rpc: RPC, matrix: {} };
for (const a of accs) {
  const u = a.name;
  out.matrix[u] = {
    owner: { held: held[u]?.owner ? held[u].owner.slice(0, 8) + "…" : null, live: a.owner.key_auths[0]?.[0].slice(0, 8) + "…", match: held[u]?.owner === a.owner.key_auths[0]?.[0] },
    active: { match: held[u]?.active === a.active.key_auths[0]?.[0] },
    posting: { match: held[u]?.posting === a.posting.key_auths[0]?.[0] },
    memo: { match: held[u]?.memo === a.memo_key },
  };
}
console.log(JSON.stringify(out, null, 1));
