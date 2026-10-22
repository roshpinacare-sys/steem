/**
 * backtest-grid.mjs — W39 · THE GRID-BACKTEST ORGAN (v0)
 * ═══════════════════════════════════════════════════════════════════════
 * Adoption of the Vibe-Trading validation trio (HKUDS/Vibe-Trading ★36231,
 * W36/W38 evaluation: the only unbanked prize) — ported to the SAOS army
 * ladder, zero external deps, evidence-only:
 *
 *   1. SIGN-FLIP PERMUTATION TEST (10k) — H0: daily realized SBD is
 *      symmetric around 0. p = P(|mean(random flips)| >= |mean(observed)|).
 *   2. BOOTSTRAP SHARPE CI (10k, percentile 95).
 *   3. WALK-FORWARD CONSISTENCY — fraction of days with realized >= 0 +
 *      max drawdown of the cumulative curve.
 *
 * VERDICT LAW (Vibe harness: NOT_EVALUABLE ≠ success):
 *   n < 30            → NOT_EVALUABLE   (sample too small — measured, honest)
 *   p < 0.05 && S > 0 → EDGE-SUPPORTED
 *   otherwise         → NO-EDGE-MEASURED
 *
 * TRUST LAYER (run_card.py law): sha256 over the exact input bytes +
 * params; the run-card is append-only (.zscripts/backtest-runs.jsonl);
 * the commit is the receipt. No chain calls, no keys, read-only.
 *
 * Usage: node backtest-grid.mjs [engine-state-dir]
 *   default engine-state-dir = ../mini-services/saos-engine/state/army-grid/pnl
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const STEEM = path.join(HERE, "..");
const DEFAULT_PNL = path.join(STEEM, "mini-services", "saos-engine", "state", "army-grid", "pnl");
const PNL_DIR = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_PNL;
const OUT = path.join(HERE, "backtest-runs.jsonl");
const TRACE = process.env.SAOS_TRACE ?? "untraced";
const N_BOOT = 10_000;
const N_PERM = 10_000;
const MIN_N = 30;

/* deterministic RNG (mulberry32) — reproducible run-cards */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const std = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

/* ── ingest: per-day realized SBD across the whole army (nothing erased) ── */
function ingest() {
  const files = fs.readdirSync(PNL_DIR).filter((f) => f.endsWith(".json") && !/^routing|cashmachine/.test(f));
  const days = {}; const accounts = []; let inputsSha = crypto.createHash("sha256");
  for (const f of files.sort()) {
    const full = path.join(PNL_DIR, f);
    inputsSha.update(fs.readFileSync(full));
    let j; try { j = JSON.parse(fs.readFileSync(full, "utf8")); } catch { continue; }
    if (!j?.realized || typeof j.realized !== "object") continue;
    accounts.push({ account: j.account, fills: j.totals?.fills ?? 0, realizedSbd: j.totals?.realizedSbd ?? 0 });
    for (const [d, v] of Object.entries(j.realized)) {
      days[d] = days[d] ?? { realized: 0, fills: 0, vol: 0 };
      days[d].realized += v.realizedSbd ?? 0;
      days[d].fills += v.askFills ?? 0; days[d].fills += v.bidFills ?? 0;
      days[d].vol += v.volSteem ?? 0;
    }
  }
  const series = Object.entries(days).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([d, v]) => ({ day: d, realized: +v.realized.toFixed(9), fills: v.fills, vol: +v.vol.toFixed(3) }));
  return { series, accounts, inputsSha: inputsSha.digest("hex").slice(0, 16) };
}

/* ── the trio ──────────────────────────────────────────────────────────── */
function signFlipPerm(xs, rand) {
  const obs = Math.abs(mean(xs));
  let hits = 0;
  for (let i = 0; i < N_PERM; i++) {
    let s = 0;
    for (let k = 0; k < xs.length; k++) s += (rand() < 0.5 ? 1 : -1) * xs[k];
    if (Math.abs(s / xs.length) >= obs) hits++;
  }
  return (hits + 1) / (N_PERM + 1);
}
function bootstrapSharpe(xs, rand) {
  const n = xs.length; const out = [];
  for (let i = 0; i < N_BOOT; i++) {
    const s = []; for (let k = 0; k < n; k++) s.push(xs[(rand() * n) | 0]);
    const sd = std(s); out.push(sd > 0 ? mean(s) / sd : 0);
  }
  out.sort((a, b) => a - b);
  return { lo: out[(0.025 * N_BOOT) | 0], hi: out[(0.975 * N_BOOT) | 0] };
}
function walkForward(xs) {
  let cum = 0, peak = 0, mdd = 0, pos = 0;
  for (const x of xs) { if (x >= 0) pos++; cum += x; peak = Math.max(peak, cum); mdd = Math.max(mdd, peak - cum); }
  return { profitableDays: pos, consistency: +(pos / xs.length).toFixed(3), maxDrawdownSbd: +mdd.toFixed(9) };
}

/* ── run ───────────────────────────────────────────────────────────────── */
const t0 = Date.now();
const { series, accounts, inputsSha } = ingest();
const xs = series.map((d) => d.realized);
const n = xs.length;
const rand = rng(0x5a0 + n);
let card;
if (n === 0) {
  card = { verdict: "NOT_EVALUABLE", reason: "no realized series found (pnl dir empty or shape changed)" };
} else {
  const m = mean(xs), sd = std(xs);
  const sharpe = sd > 0 ? m / sd : 0;
  const p = signFlipPerm(xs, rng(0x1234 + n));
  const ci = bootstrapSharpe(xs, rng(0xabcd + n));
  const wf = walkForward(xs);
  const verdict = n < MIN_N ? "NOT_EVALUABLE" : (p < 0.05 && sharpe > 0 ? "EDGE-SUPPORTED" : "NO-EDGE-MEASURED");
  card = {
    verdict, n,
    totalRealizedSbd: +xs.reduce((s, x) => s + x, 0).toFixed(9),
    meanPerDaySbd: +m.toFixed(9), stdPerDaySbd: +sd.toFixed(9),
    sharpePerDay: +sharpe.toFixed(4),
    permPValue: +p.toFixed(4), permFlips: N_PERM,
    sharpeCI95: { lo: +ci.lo.toFixed(4), hi: +ci.hi.toFixed(4) }, bootstraps: N_BOOT,
    ...wf,
  };
}
const runCard = {
  schema: "SAOS-GRID-BACKTEST-RUNCARD/1",
  at: new Date().toISOString(), trace: TRACE,
  data: { pnlDir: PNL_DIR, window: { from: series[0]?.day ?? null, to: series.at(-1)?.day ?? null }, inputsSha256_16: inputsSha, accounts: accounts.length, armyFills: accounts.reduce((s, a) => s + a.fills, 0) },
  params: { minN: MIN_N, bootstraps: N_BOOT, permutations: N_PERM, seedLaw: "mulberry32 deterministic (seed=f(n))" },
  verdict: card.verdict, stats: card,
  ms: Date.now() - t0,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.appendFileSync(OUT, JSON.stringify(runCard) + "\n");
console.log(JSON.stringify(runCard, null, 2));
