/* decisive: engine-noble (v2.3.0) active-signed profile tx → full node verdict */
import { buildTx } from "./steemtx.mjs";
import { rpcCall } from "./measure.mjs";
import * as fs from "node:fs";
const cache = JSON.parse(fs.readFileSync("/home/z/my-project/.secrets/army-keys.json", "utf8"));
const g2 = cache.accounts.find((a) => a.name === "hcsoldier4").gens.find((g) => g.gen === "GEN-2");
const acc = (await rpcCall("condenser_api.get_accounts", [["hcsoldier4"]])).result[0];
const meta = JSON.stringify({ profile: { name: "First Draft Ledger", about: "Learning in public: first drafts, shown work, the arithmetic of small habits.", interests: ["learning", "drafts"] } });
const tx = buildTx({ ops: [["account_update2", { account: "hcsoldier4", owner: null, active: null, posting: null, memo_key: acc.memo_key, json_metadata: "", posting_json_metadata: meta, extensions: [] }]], dgpo: (await rpcCall("condenser_api.get_dynamic_global_properties", [])).result, wifs: [g2.activeWif] });
const r = await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.broadcast_transaction_synchronous", params: [tx.json], id: 1 }) });
const j = await r.json();
const sigData = j?.error?.data?.stack?.find((s) => s?.data?.sigs)?.data ?? null;
console.log("verdict:", j?.result ? "ACCEPTED " + JSON.stringify(j.result).slice(0, 120) : (j?.error?.data?.message ?? j?.error?.message));
console.log("node-recovered sigs:", sigData ? JSON.stringify(sigData.sigs) : "?");
console.log("expected active key: derived at runtime from the in-memory wif (no key-shaped literals by law R-VAULTPASS-1)");
