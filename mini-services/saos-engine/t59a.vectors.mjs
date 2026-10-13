/**
 * t59a.vectors.mjs — T-59a · THE HIVE DENOMINATOR VECTORS.
 * Pure-law vectors: no chain calls, no IO writes, no state touches. Two
 * structural source-reads (economics.mjs / router.mjs / hive.mjs) prove the
 * WIRING, not the wire: the router row is actually mounted, the spacing
 * doctrine is actually shared, and the economics rollup is actually blind
 * to router/hive state (totals cannot move by construction).
 *
 * MEASURED REGIME (Phase-1 audit + T-57 live): HBD:HIVE, 24h vol 71,554 HIVE
 * ≈ $4,015/day ≈ 27× Steem's venue, spread 13.9bps, closes-only range
 * 239.1bps, tick 0.00005 (~8.9bps), plan-only maker ladder, levels 4,
 * budget 1000 HIVE. OLD inline spacing constant: (239.1/2)/4 = 29.8875bps.
 */
import * as fs from "node:fs";
import { flowSpacingLaw, routePlan, aggregateRails } from "./lib.mjs";
import { hivePlanLaw, HIVE_PLAN_BUDGET_HIVE, HIVE_PLAN_LEVELS, HIVE_PLAN_BASE_SPAN_BPS } from "./hive.mjs";
import { hiveVenueRow, HIVE_VENUE_ID, HIVE_VENUE_LABEL } from "./router.mjs";

const readSrc = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");

export async function run({ eq, ok }) {
  /* the measured-regime fixtures (selftest 63's book shape + the audit's numbers) */
  const BOOK = { bestAsk: 0.0562261, bestBid: 0.0561518, spreadBps: 13.9 };
  const OLD_SPACING_BPS = 239.1 / 2 / 4; // the pre-T-59a inline constant: 29.8875
  const HIVE_STATE = {
    at: "2026-10-03T19:29:25.743Z", pair: "HBD:HIVE", ok: true,
    endpoints: ["https://api.hive.blog"],
    volume: { hiveVolume24h: 71554, hbdVolume24h: 4015 },
    book: { bestAsk: 0.0561322, bestBid: 0.05608, spreadBps: 13.9 },
    range: { hi: 0.056638, lo: 0.0553, mid: 0.055969, rangeBps: 239.1, closes: 23, source: "closes-only" },
    tick: 0.00005,
    plan: { verdict: "PLANNED", mid: 0.056106, spacingBps: 29.9, levels: 4, budgetHive: 1000, execution: "credential-gated-plan-only" },
  };
  const REGIME_NOTE = "מדוד-כל-מחזור: פער 13.9bps · טווח-24ש 239.1bps · טיק 0.00005 · נפח 71554 HIVE/24ש — סולם-המייקר נכתב-בלבד (credential-gated-plan-only); ההכנסה חסומה: אין-credential-Hive על-המכונה — אפס במניין-ההכנסה-הנמדדת";

  /* ── A · ONE SPACING DOCTRINE (hivePlanLaw rides lib.flowSpacingLaw) ── */

  // A1 — the shared law at the measured regime: 30bps/level, span 120bps
  eq("t59a.A1 flow-law measured-regime", flowSpacingLaw({ rangeBps24h: 239.1, levels: 4, baseBps: HIVE_PLAN_BASE_SPAN_BPS / 4 }), {
    spacingBps: 30, source: "adaptive-range", spanBps: 120,
    reason: "ladder spans 120bps of the measured 239bps/day range (T-19d-2)",
  });

  // A2 — the shared law's no-range branch = the 60bps hive base, honestly sourced
  eq("t59a.A2 flow-law no-range base", flowSpacingLaw({ rangeBps24h: null, levels: 4, baseBps: HIVE_PLAN_BASE_SPAN_BPS / 4 }), {
    spacingBps: 15, source: "base", spanBps: 60,
    reason: "no measured 24h range — base width, nothing invented",
  });

  const plan = hivePlanLaw({ book: BOOK, rangeBps: 239.1, tick: 0.00005 });
  const tickBps = (0.00005 / plan.mid) * 1e4;

  // A3 — hive spacing ≥ tick floor at the measured regime (the clamp AFTER the law)
  ok("t59a.A3 spacing>=tick-floor", plan.spacingBps >= tickBps - 0.1 && (plan.spacingBps / 1e4) * plan.mid >= 0.00005);

  // A4 — same-or-improved vs the old inline constant (30 ≥ 29.8875 — never narrower)
  ok("t59a.A4 same-or-improved-vs-old", plan.spacingBps >= OLD_SPACING_BPS);
  eq("t59a.A5 measured-regime spacing value", plan.spacingBps, 30);
  eq("t59a.A6 measured-regime span value", plan.spacingBps * plan.levels, 120);

  // A7 — the tick floor WINS over the law when the chain demands it (huge tick)
  const tight = hivePlanLaw({ book: BOOK, rangeBps: 239.1, tick: 0.0005 });
  eq("t59a.A7 tick-floor-wins", tight.spacingBps, 89); // 88.99bps → clamped above the law's 30
  ok("t59a.A8 tick-price-floor", (tight.spacingBps / 1e4) * tight.mid >= 0.0005);

  // A9 — live-regime tick (0.000017, ~3bps) leaves the law's spacing untouched
  const live = hivePlanLaw({ book: BOOK, rangeBps: 239.1, tick: 0.000017 });
  eq("t59a.A9 live-tick spacing", live.spacingBps, 30);

  // A10 — no measured range → 60bps base span, honestly labeled (unchanged behavior)
  const base = hivePlanLaw({ book: BOOK, rangeBps: null, tick: null });
  eq("t59a.A10 base-width-60bps", [base.spacingBps, base.spacingBps * base.levels], [15, 60]);
  eq("t59a.A11 base-honest-source", base.widthSource, "base-no-measurement");

  /* ── B · PLAN SHAPE FROZEN (fields, order fields, grids) ───────────── */

  // B1 — the plan's field set and order are unchanged (T-57 contract)
  eq("t59a.B1 plan-shape-fields", Object.keys(plan), [
    "verdict", "mid", "spreadBps", "rangeBps", "widthSource", "tick", "spacingBps",
    "levels", "budgetHive", "orders", "execution", "law",
  ]);

  // B2 — the order shape is unchanged: side/price/hive, 8 rows, maker-clean
  eq("t59a.B2 order-shape-fields", Object.keys(plan.orders[0]), ["side", "price", "hive"]);
  eq("t59a.B3 order-count", plan.orders.length, 8);
  eq("t59a.B4 size-3dp", plan.orders[0].hive, 250);
  ok("t59a.B5 six-dp-grid", plan.orders.every((o) => Math.abs(o.price * 1e6 - Math.round(o.price * 1e6)) < 1e-6));
  ok("t59a.B6 never-cross", Math.min(...plan.orders.filter((o) => o.side === "ask").map((o) => o.price)) > Math.max(...plan.orders.filter((o) => o.side === "bid").map((o) => o.price)));

  // B7 — constants frozen (budget/levels/base-span)
  eq("t59a.B7 constants", [HIVE_PLAN_BUDGET_HIVE, HIVE_PLAN_LEVELS, HIVE_PLAN_BASE_SPAN_BPS], [1000, 4, 60]);

  // B8 — budget floor unchanged
  const poor = hivePlanLaw({ book: BOOK, budgetHive: 2, levels: 4 });
  eq("t59a.B8 budget-below-floor", [poor.verdict, poor.orders.length], ["BUDGET-BELOW-FLOOR", 0]);

  // B9 — the unification is REAL in source: hive.mjs actually rides flowSpacingLaw
  ok("t59a.B9 hive-rides-flow-law", /flowSpacingLaw\(\{/.test(readSrc("./hive.mjs")));

  /* ── C · THE ROUTER'S HIVE ROW (visible, honestly blocked) ─────────── */

  // C1 — with measured hive state: blocked-no-credential + the full measured regime in the note
  eq("t59a.C1 hive-row-measured", hiveVenueRow(HIVE_STATE), {
    id: HIVE_VENUE_ID, label: HIVE_VENUE_LABEL,
    class: "blocked-no-credential", usdPerDay: null, note: REGIME_NOTE,
  });
  // C2 — the note carries every measured regime number + plan-only status
  const measuredNote = hiveVenueRow(HIVE_STATE).note;
  ok("t59a.C2 note-has-regime", measuredNote.includes("13.9bps") && measuredNote.includes("239.1bps") && measuredNote.includes("0.00005") && measuredNote.includes("71554") && measuredNote.includes("credential-gated-plan-only"));
  // C3 — volumeUsd rides ONLY when the state itself carries one (no invented HIVE/USD pricer)
  const withUsd = hiveVenueRow({ ...HIVE_STATE, volume: { ...HIVE_STATE.volume, volumeUsd: 4015 } });
  ok("t59a.C3 volumeUsd-when-present", withUsd.note.includes("≈ $4015") && !measuredNote.includes("$"));

  // C4 — fail-open: no state / empty state / junk state → honest null row, never a lying zero
  const noRow = { id: HIVE_VENUE_ID, label: HIVE_VENUE_LABEL, class: "blocked-no-credential", usdPerDay: null, note: "אין מדידה" };
  eq("t59a.C4 fail-open-null-state", hiveVenueRow(null), noRow);
  eq("t59a.C5 fail-open-empty-state", hiveVenueRow({}), noRow);
  eq("t59a.C6 fail-open-junk-state", [hiveVenueRow("junk").class, hiveVenueRow("junk").usdPerDay, hiveVenueRow("junk").note], ["blocked-no-credential", null, "אין מדידה"]);

  // C7 — honest half: volume-only state keeps the blocked class + carries the measured half
  const half = hiveVenueRow({ volume: { hiveVolume24h: 71554 } });
  eq("t59a.C7 half-state-class", [half.class, half.usdPerDay], ["blocked-no-credential", null]);
  ok("t59a.C8 half-state-note", half.note.includes("נפח 71554") && !half.note.includes("פער"));

  // C9 — the row is actually MOUNTED in runRouter's venue table
  ok("t59a.C9 row-mounted-in-runRouter", readSrc("./router.mjs").includes("hiveVenueRow(hiveState())"));

  /* ── D · THE DENOMINATOR STAYS HONEST (zero contribution, by law) ──── */

  const baseVenues = [
    { id: "mm", label: "מעשה-שוק", class: "measured", usdPerDay: 0.0255, note: "" },
    { id: "cur", label: "קיורציה", class: "measured", usdPerDay: 0, note: "" },
    { id: "conv", label: "המרה", class: "estimated", usdPerDay: 1.2, note: "" },
    { id: "offer", label: "הצעה", class: "blocked", usdPerDay: null, note: "" },
  ];
  const p1 = routePlan({ venues: baseVenues, targetUsdPerDay: 1000 });
  const p2 = routePlan({ venues: [...baseVenues, hiveVenueRow(HIVE_STATE)], targetUsdPerDay: 1000 });

  // D1 — totals IDENTICAL with vs without the hive row (routePlan-level)
  eq("t59a.D1 totals-unchanged", p1.totals, p2.totals);
  // D2 — verdict/gap/factor unchanged
  eq("t59a.D2 verdict-unchanged", [p1.binding, p1.gap, p1.neededFactor, p1.nextRungUsdPerDay], [p2.binding, p2.gap, p2.neededFactor, p2.nextRungUsdPerDay]);
  // D3 — every pre-existing venue's weight unchanged (no dilution, no shift)
  eq("t59a.D3 weights-unchanged", p1.venues.map((v) => v.weight), p2.venues.slice(0, 4).map((v) => v.weight));
  // D4 — the hive row rides through routePlan: normalized to blocked, effective 0, weight 0
  eq("t59a.D4 hive-row-normalized-zero", p2.venues[4], {
    id: HIVE_VENUE_ID, label: HIVE_VENUE_LABEL, class: "blocked",
    usdPerDay: null, effective: 0, note: REGIME_NOTE, weight: 0,
  });
  eq("t59a.D5 venue-count", [p1.venues.length, p2.venues.length], [4, 5]);

  // D6 — the economics rollup's totals PIN (aggregateRails is hive-blind: no hive input exists)
  const econ = aggregateRails({
    realizedSbdTotal: 0.0255, realizedWindowDays: 5, sbdUsd: 1, steemUsd: 0.1041, parity: 0.1041,
    curationEstSteemPerDay: 0.001, curationMeasuredUsdPerDay: 0,
    convertEdgeBps: 13.9, convertAmountSbd: 10, convertVerdict: "CONVERT-HOLD",
    promoPostsPerDay: 1, promoEstUsdPerPost: null,
    fuelUsdPerDay: 0.01, hyperOpsPerDay: 28128, fillsToday: 42, marketFillsPerDay: 900,
  });
  eq("t59a.D6 aggregateRails-pinned", [econ.totalMeasuredUsdPerDay, econ.totalEstUsdPerDay], [0.0051, 0.0239]);

  // D7 — structural: economics.mjs never reads router.json/hive.json (totals cannot see the hive row)
  ok("t59a.D7 economics-hive-blind", !/"(router|hive)\.json"/.test(readSrc("./economics.mjs")));
}
