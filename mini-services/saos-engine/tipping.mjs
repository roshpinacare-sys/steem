/**
 * tipping.mjs — T-28 · THE TIPPING SENTINEL (emergence-world countermeasure).
 * world.emergence.ai Season-1 measured: two of five societies lost ALL agents
 * in 15 days and "collapse has no warning shot" — the machine that watches
 * levels never sees the cliff. This runner keeps a bounded MEASURED series
 * (fuel / cycle-health / capital / realized-bleed) every cycle, scans slopes
 * with the pure core (lib.tippingScan), and on CRITICAL drops the machine to
 * a typed MINIMUM-VIABLE POSTURE the same cycle: spending rails stop, senses
 * and free-fuel rails keep running. Survive first, earn second.
 * State: state/tipping.json → /status → cockpit. Transitions journaled.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { tippingScan } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const TIPPING_FILE = path.join(STATE, "tipping.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");
const ECONOMICS_FILE = path.join(STATE, "economics.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

export const TIPPING_LAW = "הסנטינל קורא מגמות-מדודות בחלון-חסום; CRITICAL ⇒ פוסטור-מינימום באותו-מחזור — לשרוד קודם, להרוויח אחר-כך";

export function runTipping({ obs = null, now = new Date().toISOString() } = {}) {
  const prev = readJson(TIPPING_FILE, { series: [] });
  const series = Array.isArray(prev.series) ? prev.series : [];

  /* cycle-health truth: at tipping time the CURRENT cycle is still running,
   * so sovereign.cycles.lastOk is the PREVIOUS cycle's real outcome — the
   * honest "did the machine do its job" signal, not a self-report. */
  const sov = readJson(path.join(STATE, "sovereign.json"), null);
  const cycleOk = typeof sov?.cycles?.lastOk === "boolean" ? sov.cycles.lastOk : null;

  /* capital in USD from THIS cycle's measured inventory + measured prices
   * (both live; null-safe — a missing leg is a null sample, never a zero).
   * T-28 refinement (measured live): liquid balances sit near-zero while the
   * machine QUOTES — but our own open orders are CANCELABLE, i.e. capital is
   * recoverable, not dead. The dust line therefore measures liquid + own-
   * locked (recoverable) capital; only a machine with neither free nor
   * recoverable capital is truly at the cliff. */
  let capitalUsd = null;
  const inv = obs?.ok ? obs.inventory ?? null : null;
  const p = obs?.ok ? obs.parity ?? null : null;
  if (inv && p && Number.isFinite(inv.steem) && Number.isFinite(inv.sbd) && Number.isFinite(p.steemUsd) && Number.isFinite(p.sbdUsd)) {
    let lockedUsd = 0;
    for (const o of Array.isArray(obs.orders) ? obs.orders : []) {
      const base = String(o?.base ?? "");
      const amt = Number(base.split(" ")[0]) || 0;
      if (!(amt > 0)) continue;
      if (o?.side === "ask" && /STEEM/i.test(base)) lockedUsd += amt * p.steemUsd;
      else if (o?.side === "bid" && /SBD/i.test(base)) lockedUsd += amt * p.sbdUsd;
    }
    capitalUsd = Math.round((inv.steem * p.steemUsd + inv.sbd * p.sbdUsd + lockedUsd) * 1000) / 1000;
  }
  /* market-making realized SBD/day — T-65.1 UNIT-GHOST FIX (audit 5-c #4,
   * measured): this field was fed the economics rail's measuredUsdPerDay
   * ($/day) while the law's BLEED bound (lossSlopeCritical 0.05) is
   * CALIBRATED in SBD/day — the sentinel's steepening slope compared mixed
   * units (the driver that fired CRITICAL at 00:29Z read $ as SBD). Real
   * SBD/day is chain truth already measured in observe.pnl (realizedSbd
   * over the RAW span window). New rows carry pnlUnit:"SBD"; the slope in
   * the law compares same-unit samples only — the old ghost rows retire
   * naturally from the 48-sample window. */
  let realizedSbdPerDay = null;
  const pnlM = obs?.ok ? obs.pnl ?? null : null;
  if (pnlM && Number.isFinite(pnlM.realizedSbd) && Number.isFinite(pnlM.pnlWindowDays) && pnlM.pnlWindowDays > 0) {
    realizedSbdPerDay = Math.round((pnlM.realizedSbd / pnlM.pnlWindowDays) * 1e6) / 1e6;
  }

  series.push({
    at: now,
    rcPct: Number.isFinite(inv?.rcPct) ? inv.rcPct : null,
    ok: cycleOk,
    capitalUsd,
    realizedSbdPerDay,
    pnlUnit: realizedSbdPerDay != null ? "SBD" : null,
  });
  const capped = series.slice(-48);

  const scan = tippingScan(capped);
  const out = {
    at: now,
    law: TIPPING_LAW,
    verdict: scan.verdict,
    posture: scan.posture,
    drivers: scan.drivers,
    samples: scan.samples,
    series: capped,
    latestSample: { rcPct: capped[capped.length - 1]?.rcPct ?? null, capitalUsd, realizedSbdPerDay },
  };

  /* transitions are JOURNALED — a posture change is a typed event, never a
   * silent gear-shift (the whole reason their collapse had no warning shot
   * is that nobody wrote down the tipping evidence until it was over) */
  if (prev.verdict && prev.verdict !== out.verdict) {
    appendLine(EVENTS_FILE, { type: "tipping.verdict-change", at: now, from: prev.verdict, to: out.verdict, drivers: out.drivers.map((d) => d.id) });
  }
  if (out.posture.level !== "FULL") {
    appendLine(EVENTS_FILE, { type: "tipping.minimum-posture", at: now, verdict: out.verdict, stops: out.posture.stops, why: out.posture.why });
  }
  writeJson(TIPPING_FILE, out);
  return { verdict: out.verdict, posture: out.posture, drivers: out.drivers, samples: out.samples };
}

export function tippingState() {
  return readJson(TIPPING_FILE, null);
}
