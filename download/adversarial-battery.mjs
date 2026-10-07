/* ADVERSARIAL BATTERY — R233 falsification round
 * Tries to BREAK planRedeploy + redeployBidCapSbd with hostile inputs.
 * Every FAILURE here is a real finding; every PASS is a claim that survived. */
import { planRedeploy, redeployBidCapSbd } from "../mini-services/saos-engine/lib.mjs";

let findings = [];
const F = (id, ok, detail) => { findings.push({ id, ok, detail }); if (!ok) console.log(`FAIL ${id}: ${detail}`); };

const HOSTILE = [NaN, Infinity, -Infinity, 1e308, -1e308, 1e21, "30.749", "", null, undefined, {}, [], [5], () => 5, Symbol("x")];

/* 1 · planRedeploy must NEVER throw on hostile scalar input */
let crashed = 0, badVerdicts = [];
for (const h of HOSTILE) {
  for (const field of ["liquidSteem", "liquidSbd", "buyBookPct", "powerUpPct", "reservePct", "liquidSteemFloor", "liquidSbdFloor", "minPowerUpSteem"]) {
    try {
      const r = planRedeploy({ liquidSteem: 30.749, liquidSbd: 0.015, [field]: h });
      const v = r?.verdict;
      if (!["REDEPLOY-PLAN", "REDEPLOY-HOLD", "REDEPLOY-BLOCKED", "REDEPLOY-COOLDOWN"].includes(v)) badVerdicts.push(`${field}=${String(h)}→${String(v)}`);
    } catch (e) { crashed++; findings.push({ id: `crash-${field}-${String(h).slice(0,10)}`, ok: false, detail: e.message }); }
  }
}
F("no-crash-battery", crashed === 0, `${crashed} crashes`);
F("verdicts-wellformed", badVerdicts.length === 0, badVerdicts.join("; "));

/* 2 · the documented law says sum≠1 → BLOCKED; code tolerance is 0.999..1.001 */
const r9995 = planRedeploy({ liquidSteem: 30, buyBookPct: 0.4995, powerUpPct: 0.3, reservePct: 0.2 });
const r10005 = planRedeploy({ liquidSteem: 30, buyBookPct: 0.5005, powerUpPct: 0.3, reservePct: 0.2 });
const r1100 = planRedeploy({ liquidSteem: 30, buyBookPct: 0.6, powerUpPct: 0.3, reservePct: 0.2 });
console.log("sum=0.9995 →", r9995.verdict, "| sum=1.0005 →", r10005.verdict, "| sum=1.1 →", r1100.verdict);

/* 3 · float reality of the LIVE ratios: 0.5+0.3+0.2 in IEEE754 */
const sumLive = 0.5 + 0.3 + 0.2;
console.log("0.5+0.3+0.2 ===", sumLive.toPrecision(20), "→ verdict:", planRedeploy({ liquidSteem: 30 }).verdict);

/* 4 · PLAN-with-zero-amount contradiction: minPowerUpSteem=0 + excess=0 */
const rZero = planRedeploy({ liquidSteem: 5, minPowerUpSteem: 0 });
console.log("liquid=floor, min=0 →", rZero.verdict, "powerUp:", rZero.powerUpSteem);
F("no-plan-with-zero-amount", !(rZero.verdict === "REDEPLOY-PLAN" && rZero.powerUpSteem <= 0), `min=0 + excess=0 → ${rZero.verdict}/${rZero.powerUpSteem}`);

/* 5 · invariants across a liquid sweep (property test) */
let propFail = [];
for (let liq = -5; liq <= 500; liq += 0.123) {
  const r = planRedeploy({ liquidSteem: liq, liquidSbd: 0.015 });
  if (r.verdict === "REDEPLOY-PLAN") {
    const expect = Math.floor((r.excessSteem * 0.3 + 1e-9) * 1000) / 1000;
    if (Math.abs(r.powerUpSteem - expect) > 1e-9) propFail.push(`amt-mismatch@${liq}`);
    if (r.excessSteem < 0) propFail.push(`neg-excess@${liq}`);
    if (Math.abs(r.powerUpSteem * 1000 - Math.round(r.powerUpSteem * 1000)) > 1e-6) propFail.push(`not-3dp@${liq}`); // float-tolerant 3dp check (the battery's own first version lied here)
    if (r.powerUpSteem < r.minPowerUpSteem) propFail.push(`below-min-planned@${liq}`);
  }
  if (liq <= 5 && r.verdict === "REDEPLOY-PLAN") propFail.push(`plan-at-floor@${liq}`);
}
F("sweep-invariants", propFail.length === 0, propFail.slice(0, 5).join("; "));

/* 6 · determinism/purity: same input twice → identical output */
const a1 = JSON.stringify(planRedeploy({ liquidSteem: 30.749, liquidSbd: 0.015, now: "2026-10-07T00:00:00Z" }));
const a2 = JSON.stringify(planRedeploy({ liquidSteem: 30.749, liquidSbd: 0.015, now: "2026-10-07T00:00:00Z" }));
F("pure-determinism", a1 === a2, "outputs differ");

/* 7 · monotonicity: more liquid never yields less power-up */
let monoFail = [];
let prev = -1;
for (let liq = 0; liq <= 300; liq += 1) {
  const r = planRedeploy({ liquidSteem: liq });
  if (r.verdict === "REDEPLOY-PLAN") { if (prev > r.powerUpSteem + 1e-9) monoFail.push(`@${liq}`); prev = r.powerUpSteem; }
}
F("monotone-powerup", monoFail.length === 0, monoFail.join(";"));

/* 8 · redeployBidCapSbd adversarial */
let capCrash = 0, capFail = [];
for (const h of HOSTILE) for (const field of ["sbd", "floorSbd", "buyBookPct"]) {
  const args = { sbd: 10, floorSbd: 0.5, buyBookPct: 0.5, [field]: h };
  try {
    const c = redeployBidCapSbd(args.sbd, args.floorSbd, args.buyBookPct);
    if (!(typeof c === "number" && isFinite(c) && c >= 0)) capFail.push(`${field}=${String(h)}→${String(c)}`);
  } catch (e) { capCrash++; }
}
F("cap-no-crash", capCrash === 0, `${capCrash} crashes`);
F("cap-finite-nonneg", capFail.length === 0, capFail.slice(0, 5).join("; "));
console.log("cap(82.144,0.5,0.5) =", redeployBidCapSbd(82.144, 0.5, 0.5), "| cap(0.5,0.5,0.5) =", redeployBidCapSbd(0.5, 0.5, 0.5), "| cap(0.015,0.5,0.5) =", redeployBidCapSbd(0.015, 0.5, 0.5));

/* 9 · convergence property of the LIVE doctrine: sequence of power-ups must
 * never breach the floor and must terminate in HOLD (geometric decay) */
let liq = 82.144, cycles = 0, floorBreach = false, converged = false;
while (cycles < 40) {
  const r = planRedeploy({ liquidSteem: liq });
  if (r.verdict !== "REDEPLOY-PLAN") { converged = true; break; }
  liq -= r.powerUpSteem;
  if (liq < 5 - 1e-9) { floorBreach = true; break; }
  cycles++;
}
console.log(`convergence: converged=${converged} after ${cycles} power-ups, liquidEnd=${liq.toFixed(3)}, floorBreach=${floorBreach}`);
F("converges-no-floor-breach", converged && !floorBreach, `converged=${converged} breach=${floorBreach}`);

const fails = findings.filter(f => !f.ok).length;
console.log(`\n=== BATTERY DONE: ${findings.length} assertions, ${fails} FAIL ===`);
