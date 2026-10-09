/* T-36 · RAIL DOCTRINE — the measured routing law for the fleet's batteries.
 *
 * Every constant here is CHAIN-MEASURED (docs/measured/t35-probe.json +
 * docs/measured/t36-rails.json, 2026-10-09), never memory:
 *   - authorKeep 0.526: Steem paid-post split (n=18) — author side ≈ 52.6%,
 *     curators ≈ 47.4% (NOT the 50/25 folk model).
 *   - curation ROI: external-curation SP-per-vote ≈ 15-22× the vote's own
 *     value (0.030 SP/vote measured on master vs ~0.0014-0.002 SP vote value)
 *     — the pool-growth edge of early votes on rising posts.
 *   - ring ROI ≈ 1.0×: a fleet/self vote on own content keeps author+own
 *     curation ≈ the vote's own value. 15-20× worse per VP than external.
 *   - MM edge: −9bps median realized, −0.146 SBD/day over 144 fills/2.9d —
 *     the only rail measured BLEEDING.
 *
 * Pure, selftestable, zero network. The probe regenerates the constants;
 * this module turns them into routing decisions. */

/* measured constants (T-36, 2026-10-09) — probes own the truth, this pins it */
export const MEASURED = {
  authorKeep: 0.526,          // n=18 paid posts: author side of payout
  curatorShare: 0.474,
  curationSpPerMasterVote: 0.0303, // 2.914 SP / 96 votes (t35, month window)
  masterVoteValueSp: 0.00142,      // chain truth: 1.006e10 rshares × sbdPerRshare
                                   // ÷ steemPerSbd → SP, at w=43%, vp=56.3% (t36 calib)
  externalVsRingRatio: 21,    // per-unit-rshare: (0.0303/0.26) vs (0.00142/0.242)
                              // — weight/vp normalize out; ~20× robust
  masterEffSp: 1211.31,       // t36 probe
  ringKeepFactor: 0.95,       // author 52.6% + own-curation ≈ 47.4%×~0.9 (dust/rounding honesty)
  mmMedianEdgeBps: -9,
  regenPctPerDay: 20,         // Steem VP: full charge 5 days
  vpRegenPctPerHour: 100 / 120,
  rshareConstantK: 0.0206,    // rshares = effMana × vp × weight × K (3 fresh votes, stable)
};

/* VP burn law (curator-measured): burn%/day = Σ(maxPerDay × avgWeight)/100 */
export function vpBurnPerDayPct({ maxPerDay, baseWeightPct, minWeightPct }) {
  const d = (x) => (Number.isFinite(x) && x >= 0 ? x : 0);
  return (d(maxPerDay) * ((d(baseWeightPct) + d(minWeightPct)) / 2)) / 100;
}

/* VP headroom: how far the day-budget can scale before hitting the regen cap.
 * Returns maxScale (×) and the scaled maxPerDay (floor). */
export function vpHeadroom({ maxPerDay, baseWeightPct, minWeightPct, regenPctPerDay = MEASURED.regenPctPerDay }) {
  const burn = vpBurnPerDayPct({ maxPerDay, baseWeightPct, minWeightPct });
  if (!(burn > 0)) return { verdict: "NO-BURN", maxScale: 0, scaledMaxPerDay: maxPerDay, burnPerDayPct: 0 };
  const maxScale = Math.floor((regenPctPerDay / burn) * 100) / 100;
  return {
    verdict: maxScale > 1.05 ? "HEADROOM" : "AT-CAP",
    burnPerDayPct: Math.round(burn * 100) / 100,
    maxScale, // conservative: never exceed regen; a safety factor belongs to the caller
    scaledMaxPerDay: Math.floor(maxPerDay * maxScale),
  };
}

/* THE ROUTING DECISION per battery: external curation vs ring/self voting.
 * Both yields measured on the SAME rshare basis → the ratio is vp/weight-
 * invariant (~20×, chain truth). Returns SP/day for the SAME VP spend. */
export function routeVpBattery({ effSp, maxPerDay, avgWeightPct = 52, vpPct = 56 }) {
  if (!(effSp > 0) || !(maxPerDay > 0)) return { verdict: "UNUSABLE", externalSpPerDay: 0, ringSpPerDay: 0 };
  const spScale = effSp / MEASURED.masterEffSp;
  /* ring: keep ≈ ringKeepFactor × own vote value (SP terms, chain truth) */
  const voteValueSpPerVote = MEASURED.masterVoteValueSp * spScale * (avgWeightPct / 43) * (vpPct / 56.3);
  const ringSpPerDay = voteValueSpPerVote * MEASURED.ringKeepFactor * maxPerDay;
  /* external: the SAME vote's value times the measured ratio (chain truth) */
  const externalSpPerDay = voteValueSpPerVote * MEASURED.externalVsRingRatio * maxPerDay;
  return {
    verdict: externalSpPerDay > ringSpPerDay ? "EXTERNAL-WINS" : "RING-WINS",
    externalSpPerDay: Math.round(externalSpPerDay * 1e5) / 1e5,
    ringSpPerDay: Math.round(ringSpPerDay * 1e5) / 1e5,
    ratio: ringSpPerDay > 0 ? Math.round((externalSpPerDay / ringSpPerDay) * 10) / 10 : null,
    voteValueSpPerVote: Math.round(voteValueSpPerVote * 1e6) / 1e6,
  };
}

/* Market-making verdict from realized numbers (the only measured bleeding rail) */
export function mmVerdict({ realizedPerDaySbd, fills, windowDays, medianEdgeBps }) {
  const n = Number.isFinite(fills) ? fills : 0;
  const d = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 1;
  const perDay = Number.isFinite(realizedPerDaySbd) ? realizedPerDaySbd : 0;
  if (n < 30 || d < 2) return { verdict: "INSUFFICIENT-EVIDENCE", recommendation: "keep-measuring", realizedPerDaySbd: perDay, fills: n, windowDays: d };
  const bleeding = perDay < 0 && (Number.isFinite(medianEdgeBps) ? medianEdgeBps < -2 : true);
  return {
    verdict: bleeding ? "BLEEDING" : (perDay > 0 ? "POSITIVE" : "FLAT"),
    recommendation: bleeding ? "throttle-or-ab-with-peg-convert-audited" : "keep",
    realizedPerDaySbd: Math.round(perDay * 1e4) / 1e4,
    fills: n, windowDays: d, medianEdgeBps: medianEdgeBps ?? null,
  };
}

/* RC-aware vote pacing gate (measured: siq 17.1%, wic 22.4% — soldiers can
 * starve while the battery is full). A vote must never broadcast below floor. */
export function rcGate({ rcPct, floorPct = 15 }) {
  if (!(Number.isFinite(rcPct) && rcPct >= 0)) return { ok: false, reason: "rc-unread" };
  return { ok: rcPct >= floorPct, reason: rcPct >= floorPct ? "rc-ok" : `rc-starved (${rcPct}% < ${floorPct}%)` };
}
