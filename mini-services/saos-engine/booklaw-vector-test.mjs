// booklaw-vector-test.mjs — the LIVE measured chain state (2026-10-16 13:50Z audit)
// as a law vector. Expected: cancel exactly [2026101406] (the orphaned phantom
// bid), keep 1405 (working top bid), keep fresh registry-owned levels.
import { booklawPlan } from "./booklaw.mjs";

const orders = [
  { orderid: 2026101402, side: "ask", base: "5.409 STEEM", quote: "0.566 SBD", unit: 0.10464 },
  { orderid: 2026101403, side: "ask", base: "5.409 STEEM", quote: "0.571 SBD", unit: 0.105564 },
  { orderid: 2026101405, side: "bid", base: "30.134 SBD", quote: "297.109 STEEM", unit: 9.86004 },
  { orderid: 2026101406, side: "bid", base: "30.134 SBD", quote: "306.442 STEEM", unit: 10.170013 },
  { orderid: 1792154386, side: "ask", base: "0.752 STEEM", quote: "0.079 SBD", unit: 0.105053 },
  { orderid: 1792154387, side: "ask", base: "0.752 STEEM", quote: "0.079 SBD", unit: 0.105053 },
  { orderid: 1792154388, side: "ask", base: "0.752 STEEM", quote: "0.078 SBD", unit: 0.103723 },
  { orderid: 1792154389, side: "ask", base: "0.752 STEEM", quote: "0.078 SBD", unit: 0.103723 },
  { orderid: 1792154390, side: "ask", base: "0.752 STEEM", quote: "0.078 SBD", unit: 0.103723 },
  { orderid: 1792154393, side: "ask", base: "0.302 STEEM", quote: "0.031 SBD", unit: 0.102649 },
  { orderid: 1792154753, side: "bid", base: "0.500 SBD", quote: "5.141 STEEM", unit: 10.282 },
  { orderid: 1792154754, side: "bid", base: "0.500 SBD", quote: "5.146 STEEM", unit: 10.292 },
];
const registryIds = [1792154386, 1792154387, 1792154388, 1792154389, 1792154390, 1792154393, 1792154753, 1792154754];

const plan = booklawPlan({ orders, steem: 22.761, sbd: 43.585, registryIds });
console.log(JSON.stringify(plan, null, 1));

const ok =
  plan.verdict === "REPAIRED" &&
  plan.cancelIds.length === 1 &&
  plan.cancelIds[0] === 2026101406 &&
  Math.abs(plan.coverage.bidOver - 20.33725) < 0.001 &&
  plan.coverage.askOver === 0;

console.log(ok ? "VECTOR-PASS: law cancels exactly the orphaned phantom bid" : "VECTOR-FAIL");
process.exit(ok ? 0 : 1);
