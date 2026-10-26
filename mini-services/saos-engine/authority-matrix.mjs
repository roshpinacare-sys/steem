// authority-matrix — which vault candidates match LIVE headcorner authorities?
// Prints PUBLIC match verdicts only. Zero secret material in output.
import * as fs from "node:fs";
import { wifDecode, pubkeyFromSeed, derivePub, SEED_ORDERS, wifEncode, b58decode } from "./steemtx.mjs";
const KEY_FILES = ["./.env", "/tmp/.env.local", "./keys.env", "../../.env.local"];
const ACCT = "headcorner";
const HIVE_NODES = ["https://api.hive.blog", "https://api.hive.dev"];
const slot = (name) => { if (process.env[name]) return process.env[name].trim(); for (const f of KEY_FILES) { try { const m = fs.readFileSync(f, "utf8").match(new RegExp(`^${name}=(.+)$`, "m")); if (m?.[1]) return m[1].trim(); } catch {} } return ""; };
async function rpc(method, params) { for (const host of HIVE_NODES) { try { const r = await fetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(15000) }); const d = await r.json(); if (!d.error) return d.result; } catch {} } throw new Error("hive down"); }
const [a] = await rpc("condenser_api.get_accounts", [[ACCT]]);
const live = { owner: (a.owner.key_auths??[]).map(k=>k[0]), active: (a.active.key_auths??[]).map(k=>k[0]), posting: (a.posting.key_auths??[]).map(k=>k[0]) };
const pubOfWif = (w) => pubkeyFromSeed(wifDecode(w));
const cands = [];
for (const s of ["STEEM_OWNER_WIF_A","STEEM_ACTIVE_WIF_A","STEEM_POSTING_WIF_A","STEEM_OWNER_WIF_B","STEEM_ACTIVE_WIF_B","STEEM_POSTING_WIF_B","HIVE_HEADCORNER_POSTING_WIF_C"]) { const v = slot(s); if (v) cands.push([s, pubOfWif(v)]); }
const hb = slot("HEAD_CORNER_KEY_B64");
if (hb) {
  try { const raw = Buffer.from(hb, "base64"); if (raw.length === 32) cands.push(["HEAD_CORNER_KEY_B64(as-seed)", pubkeyFromSeed(raw)]); } catch {}
  try { const s = Buffer.from(hb, "base64").toString("utf8"); if (/^[5JKL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(s.trim())) cands.push(["HEAD_CORNER_KEY_B64(as-wif)", pubOfWif(s.trim())]); } catch {}
}
const master = slot("HEAD_CORNER_MASTER");
if (master) for (const [on, fn] of Object.entries(SEED_ORDERS)) for (const role of ["owner","active","posting"]) cands.push([`MASTER(${on},${role})`, derivePub(fn(ACCT, role, master))]);
const find = (pub) => Object.entries(live).find(([role, pubs]) => pubs.includes(pub))?.[0] ?? null;
for (const [name, pub] of cands) { const role = find(pub); console.log(JSON.stringify({ candidate: name, pubFp: pub.slice(0, 14) + "…", matchesLiveRole: role })); }
