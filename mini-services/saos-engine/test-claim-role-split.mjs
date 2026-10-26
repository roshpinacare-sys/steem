/**
 * test-claim-role-split.mjs — R293 AUTHORITY-SPLIT LAW vectors (offline, pure).
 *
 * Pins the fix for the twice-daily economy wedge: a claim[posting] batched
 * with an order ladder[active] MUST split into two txs, and a fail-closed
 * claim rule must drop ONLY the claim — never the financial ops.
 *
 * Run: node test-claim-role-split.mjs   (or bun)
 */
import { splitOpsByAuthority, POSTING_ONLY_OPS } from "./signer.mjs";

let failures = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

const claim = ["claim_reward_balance", { account: "x", reward_steem: "0.000 STEEM", reward_sbd: "0.000 SBD", reward_vests: "1.000000 VESTS" }];
const buy = ["limit_order_create", { owner: "x", orderid: 1, amount_to_sell: "1.000 SBD", min_to_receive: "2.000 STEEM", fill_or_kill: false, expiration: "2026-10-12T00:00:00" }];
const cancel = ["limit_order_cancel", { owner: "x", orderid: 1 }];
const vote = ["vote", { voter: "x", author: "y", permlink: "p", weight: 1000 }];
const comment = ["comment", { parent_author: "", parent_permlink: "hive", author: "x", permlink: "pp", title: "t", body: "b", json_metadata: "{}" }];
const transfer = ["transfer", { from: "x", to: "y", amount: "1.000 STEEM", memo: "" }];
const cj = ["custom_json", { required_auths: [], required_posting_auths: ["x"], id: "saos-bus-v1", json: "{}" }];
const unknown = ["future_op", {}];

// 1 · THE wedge vector: claim + ladder → two legs, claim first-class
{
  const { postingOps, restOps } = splitOpsByAuthority([claim, buy, cancel, cancel]);
  ok("wedge: claim isolated to posting leg", postingOps.length === 1 && postingOps[0][0] === "claim_reward_balance");
  ok("wedge: ladder intact on main leg", restOps.length === 3 && restOps.every(([n]) => n.startsWith("limit_order")));
}

// 2 · fail-closed rule drops ONLY the claim
{
  const { postingOps, restOps } = splitOpsByAuthority([claim, buy], "rule-refuted");
  ok("failClosed: claim dropped", postingOps.length === 0);
  ok("failClosed: ladder survives", restOps.length === 1 && restOps[0][0] === "limit_order_create");
}

// 3 · pure batches stay single-leg (no behavior change for existing callers)
{
  const a = splitOpsByAuthority([claim]);
  ok("pure claim: posting leg only", a.postingOps.length === 1 && a.restOps.length === 0);
  const b = splitOpsByAuthority([buy, cancel]);
  ok("pure ladder: main leg only", b.postingOps.length === 0 && b.restOps.length === 2);
}

// 4 · comment/vote are posting-class
{
  const { postingOps } = splitOpsByAuthority([comment, vote]);
  ok("social ops are posting-class", postingOps.length === 2);
}

// 5 · custom_json stays flexible (main leg) — preserves today's working bus path
{
  const { postingOps, restOps } = splitOpsByAuthority([cj, transfer]);
  ok("custom_json flexible: main leg", postingOps.length === 0 && restOps.length === 2);
}

// 6 · unknown ops default to MAIN leg (unknown never gains posting authority)
{
  const { postingOps, restOps } = splitOpsByAuthority([unknown, claim]);
  ok("unknown op defaults to main leg", postingOps.length === 1 && restOps.length === 1 && restOps[0][0] === "future_op");
}

// 7 · dropClaimReason only affects claims, not votes/comments
{
  const { postingOps, restOps } = splitOpsByAuthority([claim, vote, comment], "rule-refuted");
  ok("dropClaimReason spares vote/comment", postingOps.length === 2 && restOps.length === 0);
}

// 8 · the posting-only set is exactly the documented five
ok("POSTING_ONLY_OPS membership", ["claim_reward_balance","vote","comment","delete_comment","reblog"].every((n) => POSTING_ONLY_OPS.has(n)) && POSTING_ONLY_OPS.size === 5);

// 9 · empty batch → both legs empty (executeAs NO-OPS guard still upstream)
{
  const { postingOps, restOps } = splitOpsByAuthority([]);
  ok("empty batch", postingOps.length === 0 && restOps.length === 0);
}

console.log(failures === 0 ? "\nCLAIM-ROLE-SPLIT: ALL VECTORS PASS" : `\nCLAIM-ROLE-SPLIT: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
