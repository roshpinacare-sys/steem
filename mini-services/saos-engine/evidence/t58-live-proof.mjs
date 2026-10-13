/* T-58 live proof — runPayouts directly: the new asset law + trailing window
 * land in payouts.json (read-only chain scan, credential-free). */
import { runPayouts } from "../payouts.mjs";

const out = await runPayouts({ now: new Date().toISOString(), account: "headcorner" });
console.log("verdict:", out.verdict);
console.log("rollup.confidence:", out.rollup?.confidence);
console.log("rollup.curationVests:", out.rollup?.curationVests);
console.log("rollup.authorSbd/Steem/Vests:", out.rollup?.authorSbd, out.rollup?.authorSteem, out.rollup?.authorVests);
console.log("rollup.windowDays:", out.rollup?.windowDays, "oldest:", out.rollup?.oldestTs, "newest:", out.rollup?.newestTs);
console.log("rollup.trailing:", JSON.stringify(out.rollup?.trailing));
console.log("forecast tonightUsd:", out.forecast?.tonightUsd, "tranches:", out.forecast?.tranches);
console.log("calibration:", out.calibration?.verdict);
process.exit(0);
