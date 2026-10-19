/**
 * economics.mjs — T-21 · THE MULTI-RAIL ECONOMICS ROLLUP
 * ("מערך-כלכלי מדומה → להתחיל להריץ ולהפוך לערך אמיתי").
 * The operator asked the simulated economic array to start RUNNING and to
 * be converted, step by step, into real value. The honest form of that is
 * ONE measured rollup of every rail the machine actually runs, each labeled
 * measured | estimated | blocked with its own evidence note — measured and
 * estimated totals NEVER merge (the honesty contract, enforced in the pure
 * core aggregateRails, lib.mjs).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { aggregateRails, x2Spectrum } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ECON_FILE = path.join(STATE, "economics.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

export function runEconomics(now = new Date().toISOString()) {
  const observe = readJson(path.join(STATE, "observe.json"), null);
  const market = readJson(path.join(STATE, "market.json"), null);
  const convert = readJson(path.join(STATE, "convert-plan.json"), null);
  const hyper = readJson(path.join(STATE, "hyper-grid.json"), null);
  const daily = readJson(path.join(STATE, "daily-report.json"), null);
  const discovery = readJson(path.join(STATE, "discovery.json"), null);
  const conf = readJson(path.join(DIR, "..", "..", ".secrets", "exec-armed.json"), null)
    ?? readJson(path.join(STATE, "exec-armed-doctrine.json"), null);

  const parity = observe?.parity?.parity ?? null;
  const sbdUsd = observe?.parity?.sbdUsd ?? null;
  const steemUsd = observe?.parity?.steemUsd ?? null;
  /* T-23 · the payouts instrument: settled chain rewards flip the curation
   * rail from estimated to measured. R282: the rollup now measures per-day
   * in raw UNITS (curationSteemPerDay, vests→steem converted chain-side) —
   * this rollup prices with ITS pricer only (single-pricer law). The old
   * gate divided vests by days and priced vests as steem units, AND keyed
   * the flip on the rollup's own $ field (null here) — the rail could
   * never flip even while the chain paid. Measured live 2026-10-08. */
  const payouts = readJson(path.join(STATE, "payouts.json"), null);
  const curationMeasuredUsdPerDay = payouts?.rollup?.confidence === "measured"
    && payouts.rollup.curationSteemPerDay != null && (steemUsd ?? 0) > 0
    ? Math.round(payouts.rollup.curationSteemPerDay * steemUsd * 1e6) / 1e6
    : null; /* unit-less rollups (no vests→steem ratio) HOLD at null —
              * pricing vests as steem is the lie class R282 killed */

  /* realized trading: measured by pnlFromFills over the observable fill
   * window; per-day normalization waits for fill-timestamp windows (honest)
   * W12-D · the window now comes from the PERSISTENT LEDGER ROLLUP (the
   * T-25 instrument, finally wired + fleet-swept): perDayReady (≥1 full
   * day of real fills) is the only key that flips the rail to measured —
   * a partial window stays blocked instead of annualizing noise. */
  const fillsRoll = readJson(path.join(STATE, "fills.json"), null);
  const ledgerReady = fillsRoll?.perDayReady === true && fillsRoll?.realizedPerDaySbd != null;
  const realizedSbd = ledgerReady ? fillsRoll.realizedSbd : (daily?.rollup?.realizedSbd ?? null);
  const realizedWindowDays = ledgerReady ? fillsRoll.windowDays : null;

  const curationEst = (discovery?.opportunities ?? []).find((o) => o.id === "curation-share")?.potential ?? null;

  const out = aggregateRails({
    realizedSbdTotal: realizedSbd,
    realizedWindowDays,
    sbdUsd, steemUsd, parity,
    curationEstSteemPerDay: curationEst,
    curationMeasuredUsdPerDay,
    convertEdgeBps: convert?.edgeBps ?? null,
    convertAmountSbd: convert?.amountSbd ?? null,
    convertVerdict: convert?.verdict ?? null,
    promoPostsPerDay: conf?.promo?.perDay ?? null,
    promoEstUsdPerPost: null,
    fuelUsdPerDay: observe?.fuel?.fuelUsdPerDay ?? null,
    hyperOpsPerDay: hyper?.economics?.opsPerDay ?? null,
    fillsToday: observe?.fills ?? null,
    marketFillsPerDay: market?.tradesPerDay ?? null,
  });

  const doc = {
    ...out,
    asof: now,
    context: {
      venueFillsPerDay: market?.tradesPerDay ?? null,
      venueVolSteem24h: market?.volSteem ?? null,
      ourFillsObservable: observe?.fills ?? null,
      scalingLaw: "ops/day ∝ RC ∝ SP — ההון-החכם מכפיל את התקרה, לא את הקוד",
    },
    /* T-23 · the payout clock + the X-2 capital spectrum (T-18f): the honest
     * scaling table from today's measured/estimated economics to $1000/day */
    payoutClock: payouts?.payout ?? null,
    pendingRewards: payouts?.pending ?? null,
    x2: x2Spectrum({
      currentUsdPerDay: out.totalMeasuredUsdPerDay > 0 ? out.totalMeasuredUsdPerDay : out.totalEstUsdPerDay,
      targetUsdPerDay: 1000,
      currentSp: observe?.inventory?.spOwn ?? null,
    }),
    /* T-91 · the redeployment doctrine, surfaced for the cockpit: the FIXED
     * SBD/STEEM allocation ratios (buy-book / power-up / reserve), the
     * protective floors, and the live plan verdict. The law is part of the
     * data: cashing out NEVER stops the autonomy. */
    redeployDoctrine: conf?.redeploy ? {
      ratios: {
        buyBookPct: conf.redeploy.buyBookPct ?? 0.5,
        powerUpPct: conf.redeploy.powerUpPct ?? 0.3,
        reservePct: conf.redeploy.reservePct ?? 0.2,
      },
      floors: {
        liquidSteemFloor: conf.redeploy.liquidSteemFloor ?? 5,
        liquidSbdFloor: conf.redeploy.liquidSbdFloor ?? 0.5,
      },
      minPowerUpSteem: conf.redeploy.minPowerUpSteem ?? 5,
      minIntervalSec: conf.redeploy.minIntervalSec ?? 3600,
      maxPerDay: conf.redeploy.maxPerDay ?? 12,
      executionArmed: conf?.operator?.allowPowerUp === true,
      plan: (() => {
        const p = readJson(path.join(STATE, "redeploy-plan.json"), null);
        return p ? { verdict: p.verdict, reason: p.reason ?? null, powerUpSteem: p.powerUpSteem ?? null, excessSteem: p.excessSteem ?? null, pacing: p.pacing ?? null, at: p.at ?? null } : null;
      })(),
      state: readJson(path.join(STATE, "redeploy-state.json"), null),
      law: "מימוש אף-פעם לא עוצר את האוטונומיה — הערך שממומש זורם חזרה למכונה לפי היחסים (ספר-קנייה / power-up / עתודה), מעל רצפות-ההפעלה בלבד",
    } : null,
    pid: process.pid,
  };
  writeJson(ECON_FILE, doc);
  return doc;
}

export function economicsState() {
  return readJson(ECON_FILE, null);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runEconomics(), null, 2));
}
