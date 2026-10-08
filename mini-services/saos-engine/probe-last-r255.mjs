import { buildTx } from "./steemtx.mjs";
import { rpcCall } from "./measure.mjs";
import * as fs from "node:fs";
const cache = JSON.parse(fs.readFileSync("/home/z/my-project/.secrets/army-keys.json", "utf8"));
const g2 = cache.accounts.find((a) => a.name === "hcsoldier4").gens.find((g) => g.gen === "GEN-2");
const acc = (await rpcCall("condenser_api.get_accounts", [["hcsoldier4"]])).result[0];
const dgpo = (await rpcCall("condenser_api.get_dynamic_global_properties", [])).result;
const op = ["account_update2", { account: "hcsoldier4", owner: null, active: null, posting: null, memo_key: acc.memo_key, json_metadata: "", posting_json_metadata: "{}", extensions: [] }];
const tryBc = async (wif, label) => {
  const tx = buildTx({ ops: [op], dgpo, wifs: [wif] });
  const r = await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.broadcast_transaction_synchronous", params: [tx.json], id: 1 }) });
  const j = await r.json();
  const sigData = j?.error?.data?.stack?.find((s) => s?.data?.sigs)?.data ?? null;
  console.log(label, "->", j?.result ? "ACCEPTED" : (j?.error?.data?.message ?? j?.error?.message), sigData ? "recovered:" + JSON.stringify(sigData.sigs) : "");
};
await tryBc(g2.wif, "posting-signed");
await tryBc(g2.activeWif, "active-signed");
