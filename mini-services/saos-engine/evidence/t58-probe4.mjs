/* T-58 probe 4 — reproduce the rollup's curation parse (why curationVests=0 while ops exist) */
import { rpcCall } from "../measure.mjs";
import { rewardHistoryRollup } from "../lib.mjs";

const opTypeName = (op) => {
  if (Array.isArray(op)) return String(op[0] ?? "");
  if (op && typeof op === "object") return String(op.type ?? "").replace(/_operation$/, "");
  return "";
};

const ACC = "headcorner";
let r = await rpcCall("account_history_api.get_account_history", {
  account: ACC, start: -1, limit: 10000,
  select_ops: ["curation_reward", "author_reward", "claim_reward_balance"],
}).catch(() => ({ ok: false }));
console.log("ah_api ok:", r.ok, "node:", r.node);
const hist = r.ok ? (r.result?.history ?? []) : [];
console.log("ah rows:", hist.length);
const cur = hist.filter(([, e]) => opTypeName(e?.op) === "curation_reward");
const aut = hist.filter(([, e]) => opTypeName(e?.op) === "author_reward");
console.log("ah curation:", cur.length, "author:", aut.length);
if (cur.length) {
  const [idx, e] = cur[cur.length - 1];
  console.log("LAST CUR RAW:", JSON.stringify(e).slice(0, 400));
  const op = e.op;
  const v = (Array.isArray(op) ? op[1] : op?.value) ?? {};
  console.log("parsed reward field:", JSON.stringify(v.reward));
}
if (aut.length) {
  const [, e] = aut[aut.length - 1];
  console.log("LAST AUT RAW:", JSON.stringify(e).slice(0, 400));
}

const roll = rewardHistoryRollup({ rows: hist, steemUsd: null, sbdUsd: null, vestsToSteem: 6.198e-4 });
console.log("ROLLUP:", JSON.stringify({ opsCount: roll.opsCount, claims: roll.claims, curationVests: roll.curationVests, authorVests: roll.authorVests, confidence: roll.confidence, windowDays: roll.windowDays, newestTs: roll.newestTs }));

process.exit(0);
