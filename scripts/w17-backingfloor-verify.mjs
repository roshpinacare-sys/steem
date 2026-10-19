/**
 * w17-backingfloor-verify.mjs — W17 · THE BACKING-FLOOR ACCEPTANCE BATTERY.
 *
 * BACKING-FLOOR-SPEC.md §4 acceptance (owner-approved, T29):
 *   (a) selftest vectors — 2×pass · 2×refuse (the battery law: untested law decays)
 *   (b) a live refusal simulation of a sale that would deepen the deficit →
 *       BACKING-FLOOR-REFUSED, recorded live in state/backing-floor.jsonl
 * Zero secrets — verdicts and public numbers only.
 *
 * Usage: node scripts/w17-backingfloor-verify.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { backingFloorLaw } from "../mini-services/saos-engine/lib.mjs";
import { outstandingFor, backingFloorGate } from "../mini-services/saos-engine/custody-credit.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "..", "mini-services", "saos-engine", "state");
const JOURNAL = path.join(STATE, "backing-floor.jsonl");

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
};

console.log("W17 backing-floor battery:");

/* (a) vectors — 2×pass · 2×refuse (per the T29 spec battery) */
const v1 = backingFloorLaw("STEEM", 10, 600, 528.097);
check("v1 pass: covered sale (600−10=590 ≥ 528.097)", v1.allow === true && v1.verdict === "BACKING-FLOOR-OK", `steem_after=${v1.detail.steem_after}`);
const v2 = backingFloorLaw("STEEM", 10, 61.452, 528.097);
check("v2 refuse: the T27 deficit shape (61.452−10=51.452 < 528.097)", v2.allow === false && v2.verdict === "BACKING-FLOOR-REFUSED" && v2.detail.steem_after === 51.452 && v2.detail.csteem === 528.097, `steem_after=${v2.detail.steem_after} < csteem=${v2.detail.csteem}`);
const v3 = backingFloorLaw("SBD", 100, 539.6, 439.6);
check("v3 pass: exact-boundary equality (539.6−100=439.6 ≥ 439.6)", v3.allow === true, `sbd_after=${v3.detail.sbd_after} = csbd=${v3.detail.csbd}`);
const v4 = backingFloorLaw("SBD", 1, 0.5, 0);
check("v4 refuse: zero-outstanding negative-after (0.5−1=−0.5 < 0)", v4.allow === false && v4.verdict === "BACKING-FLOOR-REFUSED", `sbd_after=${v4.detail.sbd_after} < csbd=${v4.detail.csbd}`);
const v5 = backingFloorLaw("BTC", 1, 10, 0);
check("v5 fail-closed: unknown asset", v5.allow === false && v5.verdict === "UNKNOWN-ASSET");
const v6 = backingFloorLaw("STEEM", 10, 61.452, 528.097, "owner-order-ref-example");
check("v6 override lane: explicit owner order ref only", v6.allow === true && v6.verdict === "OVERRIDE-RECORDED" && v6.detail.overrideRef === "owner-order-ref-example");

/* (b) the gate against the SEEDED custody state + a live refusal simulation */
const seed = outstandingFor("STEEM");
check("custody state readable (fail-closed family)", seed.ok && seed.outstanding === 528.097, `CSTEEM outstanding=${seed.outstanding}`);

let liveMeasured = null, liveSource = "seed (T27 measured 61.452 — RPC unavailable)";
try {
  const { accountState } = await import("../mini-services/saos-engine/measure.mjs");
  const acc = await accountState("headcorner");
  if (acc.ok && Number.isFinite(acc.steem)) { liveMeasured = acc.steem; liveSource = "live chain (accountState)"; }
} catch { /* engine-off host — the seed IS the measured truth */ }
const measured = liveMeasured ?? 61.452;
const sim = backingFloorGate("STEEM", 10, measured);
check("live refusal simulation: sale of 10 STEEM against the standing deficit", sim.allow === false && sim.verdict === "BACKING-FLOOR-REFUSED", `measured=${measured} (${liveSource}) → ${JSON.stringify(sim.detail)}`);
try {
  fs.mkdirSync(STATE, { recursive: true });
  fs.appendFileSync(JOURNAL, JSON.stringify({ at: new Date().toISOString(), source: "w17-verify-live-simulation", saleSteem: 10, measured, measuredSource: liveSource, verdict: sim.verdict, detail: sim.detail }) + "\n");
  console.log(`  recorded live → state/backing-floor.jsonl (spec §4 acceptance)`);
} catch (e) {
  console.error(`  journal write failed: ${String(e?.message ?? e).slice(0, 80)}`);
}

console.log(`BATTERY: ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
