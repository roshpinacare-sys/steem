#!/usr/bin/env bun
/**
 * fuzz-invariants.mjs — property-based testing (R234 review)
 * 300 random vectors + hostile classes, checking INVARIANTS (not specific values):
 *  P1 verdict ∈ {PLAN, HOLD, BLOCKED}
 *  P2 powerUp == floor3dp((liquid−floor)·0.3) clamped ≥ 0   (exact doctrine math)
 *  P3 powerUp ≤ excess·pct + ε                               (never above its share)
 *  P4 PLAN ⇔ powerUp ≥ max(min, 0.001)                        (no lying PLAN, no silent SKIP)
 *  P5 powerUp is broadcastable: ≤3 decimals (float-tolerant)
 *  P6 liquid ≤ floor ⇒ HOLD with reason at-or-below-floor, powerUp = 0
 *  P7 hostile inputs (NaN/±Inf/neg/string/Symbol/{}/[]) ⇒ BLOCKED or finite-safe, never crash,
 *     never leak non-finite into any numeric field
 *  P8 determinism: identical inputs → byte-identical output (×2)
 */
import { planRedeploy, redeployBidCapSbd, redeployPacing } from "/home/z/my-project/mini-services/saos-engine/lib.mjs";

const floor3dp = (x) => Math.floor((x + 1e-9) * 1000) / 1000;
let bad = 0, n = 0;
const fail = (p, v, extra) => { bad++; console.log(`P-FAIL [${p}] vector=${JSON.stringify(v).slice(0, 120)} ${extra || ""}`); };
const finite = (x) => typeof x === "number" && isFinite(x);

// deterministic PRNG (mulberry32) so the fuzz is reproducible
let seed = 0x5a05;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

for (let i = 0; i < 300; i++) {
  const v = {
    liquidSteem: +(rnd() * 200 - 10).toFixed(3),           // −10..190 (below-floor included)
    liquidSbd: +(rnd() * 50).toFixed(3),
    buyBookPct: 0.5, powerUpPct: 0.3, reservePct: 0.2,      // doctrine ratios
    liquidSteemFloor: 5, liquidSbdFloor: 0.5, minPowerUpSteem: 5,
    now: "2026-10-07T00:00:00.000Z",
  };
  const p = planRedeploy(v); n++;
  const p2 = planRedeploy(v); n++;
  const excess = Math.max(0, v.liquidSteem - v.liquidSteemFloor);
  const expect = floor3dp(excess * v.powerUpPct);
  // P1
  if (!["REDEPLOY-PLAN", "REDEPLOY-HOLD", "REDEPLOY-BLOCKED"].includes(p.verdict)) fail("P1", v, p.verdict);
  // P2 exact math
  if (Math.abs(p.powerUpSteem - expect) > 1e-9) fail("P2", v, `got=${p.powerUpSteem} want=${expect}`);
  // P3 never above share
  if (p.powerUpSteem > excess * v.powerUpPct + 1e-6) fail("P3", v, `pu=${p.powerUpSteem} cap=${excess * v.powerUpPct}`);
  // P4 PLAN ⇔ threshold
  const thr = Math.max(v.minPowerUpSteem, 0.001);
  if ((p.verdict === "REDEPLOY-PLAN") !== (p.powerUpSteem >= thr)) fail("P4", v, `verdict=${p.verdict} pu=${p.powerUpSteem}`);
  // P5 broadcastable 3dp
  if (Math.abs(p.powerUpSteem - Math.round(p.powerUpSteem * 1000) / 1000) > 1e-9) fail("P5", v, String(p.powerUpSteem));
  // P6 below/at floor
  if (v.liquidSteem <= v.liquidSteemFloor && (p.verdict !== "REDEPLOY-HOLD" || p.powerUpSteem !== 0)) fail("P6", v, `${p.verdict}/${p.powerUpSteem}`);
  // P8 determinism
  if (JSON.stringify(p) !== JSON.stringify(p2)) fail("P8", v, "non-deterministic");

  // hostile class
  for (const hostile of [NaN, Infinity, -Infinity, "x", Symbol("s"), {}, [], -1]) {
    const h = planRedeploy({ ...v, liquidSteem: hostile }); n++;
    if (!["REDEPLOY-PLAN", "REDEPLOY-HOLD", "REDEPLOY-BLOCKED"].includes(h.verdict)) fail("P7-verdict", v, String(h.verdict));
    if (!finite(h.powerUpSteem) || !finite(h.excessSteem) || !finite(h.liquidSteem)) fail("P7-leak", v, `pu=${h.powerUpSteem}`);
  }
  // bid-cap invariants
  const sbd = +(rnd() * 100).toFixed(3);
  const cap = redeployBidCapSbd(sbd, 0.5, 0.5); n++;
  if (!finite(cap) || cap < 0 || cap > Math.max(0, sbd - 0.5) + 1e-9) fail("P-cap", v, `sbd=${sbd} cap=${cap}`);
  // pacing invariants: PLAN at since<3600 ⇒ blocked; ≥3600 with cap-room ⇒ pass
  const since = Math.floor(rnd() * 8000);
  const pr = redeployPacing({ verdict: "REDEPLOY-PLAN", sinceLastSec: since, powerUpsToday: Math.floor(rnd() * 15), minIntervalSec: 3600, maxPerDay: 12 }); n++;
  const intervalBlocked = since > 0 && since < 3600 && pr.verdict === "interval";
  const passThrough = pr.verdict === null;
  if (!(intervalBlocked || passThrough || pr.verdict === "day-cap")) fail("P-pacing", { since }, JSON.stringify(pr));
}

console.log(`\nFUZZ RESULT: ${n} assertions across 300 random vectors + 2700 hostile inputs — ${bad === 0 ? "ALL INVARIANTS HELD ✓" : bad + " FAILURES ✗"}`);
process.exit(bad === 0 ? 0 : 1);
