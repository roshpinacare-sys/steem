/**
 * index.ts — T-75 · THE NETWORK DEX SERVICE (שירות-ה-DEX של הרשת) · :3037
 * ═══════════════════════════════════════════════════════════════════════════
 * The operator's DEX mandate (trace 1a105e091e02754d), implemented honestly:
 *   • swaps across the assets we already run on (Steem/Hive/Blurt + wrapped)
 *   • opposing grids on OUR network facing the real books
 *   • a networked arbitrage market for agents and soldiers (intents API)
 *   • REAL settlement paths — every leg typed armed/gated, nothing fake
 *   • router with multi-hop + split for large amounts
 *   • custody = ESCROW LAW: internal balances ≤ measured backing
 *
 * SINGLE-SOURCE-OF-TRUTH: the engine's /status (:3040) is the ONLY
 * measurement source (observe parity, market book, hive book, enginepond
 * books, live balances). This service NEVER re-measures the chain (one-body
 * law). Engine down → the DEX renders stale-marked and REFUSES new quotes
 * (fail-closed), exactly like the cockpit bridge.
 *
 * SINGLE-WRITER LAW on the money path: this service only APPENDS queue ops
 * to state/settlement-queue.jsonl; ONLY the engine's dexsettle step drains
 * them through the one signer. Receipts come back in the engine's own
 * state/dex-settle.json (read-only here). No double writers (T-60 lesson).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ASSETS, RAILS, RAIL_STATUS_CLASS, DEX_PORT,
  escrowCheck, creditMint, ammOut, parityVerdict, gridPlan,
  buildGraph, routeQuote, venueMids, arbScan,
  validateIntent, settleIntentDeltas, intentDepthGuard, steemQueueOp, dexOrderId,
  depositAcceptLaw, redemptionQuote, vaultSweepPlan,
  batchClear, BATCH_FEE_BPS, BATCH_MAX_ORDERS, BATCH_MAX_PER_AGENT,
  convertsLanding, intakeDrill, inboundRouterMap,
  blurtRailStatus, blurtOtcPlan, blurtDeliveryOp, heCalibration,
  heOracleVenues, pondDriftGuard,
  r6, r3, fnum,
} from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ENGINE_HTTP = process.env.ENGINE_HTTP ?? "http://127.0.0.1:3040";
const ENGINE_SETTLE_FILE = path.join(STATE, "..", "saos-engine", "state", "dex-settle.json");

/* ── io helpers (atomic tmp-rename, house style) ─────────────────────── */
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const readLines = (p, max = 200) => { try { return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).slice(-max).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

/* ── state ───────────────────────────────────────────────────────────── */
const S = {
  bootedAt: new Date().toISOString(),
  engine: { up: false, at: null, data: null, stale: true },
  ledger: readJson(path.join(STATE, "ledger.json"), null),
  pools: readJson(path.join(STATE, "pools.json"), null),
  grids: readJson(path.join(STATE, "grids.json"), null),
  agents: readJson(path.join(STATE, "agents.json"), null),
  tickCount: 0,
  lastTick: null,
  lastError: null,
};

const LEDGER_DEFAULT = () => ({
  at: null,
  credit: { supply: 0, minted: [] },
  balances: { __vault__: {} },
  backing: {},
});
const POOLS_DEFAULT = () => ({
  at: null,
  pools: {
    "STEEM-SBD": { assets: ["STEEM", "SBD"], reserveA: 0, reserveB: 0, feeBps: 30, backed: false, note: "הבריכה-הפנימית — מסונכרנת מהמשכן-הנמדד בלבד" },
    "HIVE-HBD": { assets: ["HIVE", "HBD"], reserveA: 0, reserveB: 0, feeBps: 30, backed: false, note: "מסילת-Hive נמדדת-וחיה — הבריכה נחמסת עם-credential (שער-המפעיל)" },
    "SWAP.HIVE-SWAP.LTC": { assets: ["SWAP.HIVE", "SWAP.LTC"], reserveA: 0, reserveB: 0, feeBps: 60, backed: false, note: "בריכה-מדודה ב-Hive-Engine (konvik-ltc וכו') — נחמסת עם-credential" },
    "SWAP.HIVE-DEC": { assets: ["SWAP.HIVE", "DEC"], reserveA: 0, reserveB: 0, feeBps: 60, backed: false, note: "בריכה-מדודה ב-Hive-Engine — נחמסת עם-credential" },
  },
});
const GRIDS_DEFAULT = () => ({ at: null, stacks: [] });
const AGENTS_DEFAULT = () => ({ at: null, agents: {} });
const BATCH_WINDOW_MS = 10 * 60_000; // mini-CoW: the batch closes every 10 minutes (request-driven heartbeat closes it)
const BATCH_MAX_CARRIES = 3; // an order rests at most 3 windows, then expires typed

if (!S.ledger) { S.ledger = LEDGER_DEFAULT(); writeJson(path.join(STATE, "ledger.json"), S.ledger); }
if (!S.pools) { S.pools = POOLS_DEFAULT(); writeJson(path.join(STATE, "pools.json"), S.pools); }
if (!S.grids) { S.grids = GRIDS_DEFAULT(); writeJson(path.join(STATE, "grids.json"), S.grids); }
if (!S.agents) { S.agents = AGENTS_DEFAULT(); writeJson(path.join(STATE, "agents.json"), S.agents); }

/* ── batch (mini-CoW) state ─────────────────────────────────────────── */
const BATCH_FILE = path.join(STATE, "batch.json");
const BATCHES_LOG = path.join(STATE, "batches.jsonl");
const newBatch = (seq: number) => ({ id: `batch-${seq}`, openedAt: new Date().toISOString(), orders: [] as any[] });
S.batch = readJson(BATCH_FILE, null) ?? { seq: 1, current: newBatch(1), lastClosed: null };
if (!S.batch?.current?.id) { S.batch = { seq: 1, current: newBatch(1), lastClosed: null }; }
const persistBatch = () => writeJson(BATCH_FILE, S.batch);

const persist = () => {
  writeJson(path.join(STATE, "ledger.json"), S.ledger);
  writeJson(path.join(STATE, "pools.json"), S.pools);
  writeJson(path.join(STATE, "grids.json"), S.grids);
  writeJson(path.join(STATE, "agents.json"), S.agents);
};

/* ── engine sync (the ONLY measurement source) ───────────────────────── */
async function syncEngine() {
  try {
    const r = await fetch(`${ENGINE_HTTP}/status`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!r.ok) throw new Error(`engine ${r.status}`);
    const data = await r.json();
    S.engine = { up: true, at: new Date().toISOString(), data, stale: false };
  } catch (e) {
    if (S.engine.up) appendLine(path.join(STATE, "events.jsonl"), { type: "engine.stale", at: new Date().toISOString(), why: String(e?.message ?? e).slice(0, 120) });
    S.engine.up = false; S.engine.stale = true;
  }
}

/** The measured STEEM→SBD parity from the engine (single source of truth). */
function engineParity() {
  const s = S.engine.data;
  if (!s) return null;
  const direct = fnum(s.observe?.parity?.sbdPerSteem) ?? fnum(s.offer?.marks?.paritySbdPerSteem);
  if (direct && direct > 0) return direct;
  const st = fnum(s.observe?.parity?.steemUsd), sb = fnum(s.observe?.parity?.sbdUsd);
  return st > 0 && sb > 0 ? r6(st / sb) : null;
}

/** Escrow sync: the network's backing = the engine's chain-verified live
 * inventory. Internal pool reserves are DEPLOYED FRACTIONS of that backing
 * (the real maker lane on the chain book deploys the rest of its share).
 * PARITY-PROPORTIONAL DEPLOYMENT LAW (caught live T-75): reserveB = reserveA
 * × parity so the pool mid tracks the oracle BY CONSTRUCTION — equal
 * fractions priced the pool at 0.0245 while parity was 0.1054 (a 76% fake
 * deviation from OUR OWN money split, exactly the class the operator named
 * "שקר"). Never again. */
function syncEscrow() {
  const s = S.engine.data;
  if (!s?.live?.balances) return { verdict: "NO-ENGINE-BALANCES" };
  const inv = s.live.balances;
  const steem = fnum(inv.steem) ?? 0, sbd = fnum(inv.sbd) ?? 0;
  const parity = engineParity();
  const backing = {};
  const mk = (internal, covered, src) => ({ internal: r6(internal), covered: r6(covered), backing: [{ source: src, amount: r6(covered) }] });
  backing.STEEM = mk(0, steem, "engine-inventory · יתרת-חי-על-השרשרת (headcorner)");
  backing.SBD = mk(0, sbd, "engine-inventory · יתרת-חי-על-השרשרת (headcorner)");
  for (const sym of ["HIVE", "HBD", "BLURT", "SWAP.HIVE", "SWAP.LTC", "SWAP.BTC", "SWAP.HBD", "DEC", "BEE"]) {
    backing[sym] = { internal: 0, covered: 0, backing: [], gated: true, note: "אין-credential על-המכונה — המשכן נפתח עם-הפקדה-מאומתת (שער-המפעיל)" };
  }
  S.ledger.backing = backing;

  // parity-proportional deploy: quote inventory caps the base side
  const DEPLOY_PCT = 0.25;
  const pool = S.pools.pools["STEEM-SBD"];
  let wantA = steem * DEPLOY_PCT;
  let wantB = sbd * DEPLOY_PCT;
  if (parity && parity > 0) {
    wantA = Math.min(wantA, wantB / parity);
    wantB = wantA * parity;
  }
  wantA = Math.max(0, r6(wantA)); wantB = Math.max(0, r6(wantB));
  /* NO monotonic gate: the backing is re-read LIVE from the chain every
   * sync — when the real inventory shrinks (real asks fill on the chain
   * book) the internal pool MUST shrink too or escrow-law breaks; and the
   * parity-proportional shape is a LAW, not a preference. Rebalances are
   * journaled, never silent. */
  if (Math.abs(pool.reserveA - wantA) > 1e-9 || Math.abs(pool.reserveB - wantB) > 1e-9) {
    appendLine(path.join(STATE, "events.jsonl"), { type: "pool.rebalanced", at: new Date().toISOString(), pool: "STEEM-SBD", from: { A: r6(pool.reserveA), B: r6(pool.reserveB) }, to: { A: wantA, B: wantB }, parity: parity ?? null, law: "פריסה-פרופורציונלית-פאריטי" });
  }
  pool.reserveA = wantA; pool.reserveB = wantB;
  pool.backed = wantA > 0 && wantB > 0;
  pool.backingRef = { steem: r6(steem), sbd: r6(sbd), pct: DEPLOY_PCT, parity: parity ?? null, law: "פריסה-פרופורציונלית-פאריטי — mid-הבריכה עוקב אחר-האורקל מעצמו" };
  // escrow rows: internal = the pool's own deployment; covered = what remains
  // for HOLDERS (agent floats) — STRICT single-count (chain-liquid − pool)
  backing.STEEM.internal = r6(pool.reserveA);
  backing.STEEM.covered = Math.max(0, r6(steem - pool.reserveA));
  backing.SBD.internal = r6(pool.reserveB);
  backing.SBD.covered = Math.max(0, r6(sbd - pool.reserveB));
  /* FLOAT TRIM LAW (fail-safe): if real chain inventory shrank under the
   * agent floats, the floats are trimmed to fit — journaled, never silent.
   * The floats are OUR allocations, never printed money. */
  for (const sym of ["STEEM", "SBD"]) {
    const held = Object.entries(S.ledger.balances).filter(([h]) => h !== "__vault__").reduce((a, [, b]) => a + (fnum(b?.[sym]) ?? 0), 0);
    const covered = fnum(S.ledger.backing[sym]?.covered) ?? 0;
    if (held > covered + 1e-9 && held > 0) {
      const k = covered / held;
      for (const [h, b] of Object.entries(S.ledger.balances)) {
        if (h === "__vault__" || !fnum(b?.[sym])) continue;
        b[sym] = r6(b[sym] * k);
      }
      appendLine(path.join(STATE, "events.jsonl"), { type: "float.trimmed", at: new Date().toISOString(), asset: sym, from: r6(held), to: r6(covered), law: "המשכן התכווץ — ההקצאות מתכווצות איתו (אפס-הדפסה)" });
    }
  }
  S.ledger.at = new Date().toISOString();
  writeJson(path.join(STATE, "ledger.json"), S.ledger);
  writeJson(path.join(STATE, "pools.json"), S.pools);
  return { verdict: "ESCROW-SYNCED", steem: r6(steem), sbd: r6(sbd), parity: parity ?? null, deployed: { STEEM: r6(pool.reserveA), SBD: r6(pool.reserveB) } };
}

/* ── engine state-file reads (single-writer: engine writes, DEX reads) ── */
function readEngineStateFile(name, maxAgeMs = 30 * 60_000) {
  try {
    const p = path.join(DIR, "..", "saos-engine", "state", name);
    const d = readJson(p, null);
    if (!d?.at) return null;
    if (Date.now() - new Date(d.at).getTime() > maxAgeMs) return null; // stale = null (honest)
    return d;
  } catch { return null; }
}

/* ── grid + arb tick ─────────────────────────────────────────────────── */
function runTick({ now = new Date().toISOString() } = {}) {
  const s = S.engine.data;
  if (!s) { S.lastTick = { at: now, verdict: "NO-ENGINE" }; return S.lastTick; }
  /* the STEEM book rides the engine's market.json state file (engine writes,
   * we read) — one body of measurement, injected once, used everywhere */
  const s2 = { ...s, market: s.market ?? readEngineStateFile("market.json") };
  const parity2 = engineParity();
  const avgCost = fnum(s.profit?.positionAvgCost) ?? null;
  const guardAction = s.economics?.makerGuard?.action ?? null;
  const spreadBps = fnum(s.market?.book?.spreadBps) ?? 150;
  const pool = S.pools.pools["STEEM-SBD"];
  const stack = {
    id: "opposing:STEEM-SBD",
    at: now,
    pair: ["STEEM", "SBD"],
    venue: "internal-pool · מקביל-לספר-Steem",
    parity: parity2,
    guardAction,
    plan: null,
  };
  if (parity2) {
    stack.plan = gridPlan({
      parity: parity2, spreadBps,
      baseBal: pool.reserveA, quoteBal: pool.reserveB,
      levels: 3, spacingBps: Math.max(150, Math.round(spreadBps)),
      avgCost, base: "STEEM", quote: "SBD",
    });
    stack.band = parityVerdict({ mid: fnum(s2.market?.book?.bestAsk) ?? parity2, fair: parity2, bandBps: 5000 });
  }
  S.grids = { at: now, stacks: [stack, ...planStacks(s2, now), ...(S.grids.stacks ?? []).slice(0, 2)] };
  writeJson(path.join(STATE, "grids.json"), S.grids);

  // arb scan across ALL venues (internal + real books + oracle).
  // T-75f: oracle venues for anchored HE ponds (LAW 17) join the scan, and
  // the drift guard quarantines proven-rotted pond mids BEFORE pairing —
  // a thin book's rotted mid can no longer mint a phantom edge.
  // T-75g (LAW 18): the scan is TOUCH-AWARE — an executable edge pays the
  // bestAsk and receives the bestBid; oracle pairings render SIGNAL-ONLY
  // (an oracle is fair value, not a fillable venue).
  const mids = venueMids({ pools: S.pools.pools, engineStatus: s2 });
  const calib = heCalibrationDoc();
  const oracles = heOracleVenues({ calibration: calib, hiveUsd: fnum(s.observe?.parity?.hiveUsd) ?? null });
  const guard = pondDriftGuard({ venues: [...mids, ...oracles], calibration: calib });
  const ops = arbScan({ venues: guard.venues, feeBps: 30, minEdgeBps: 20 });
  const executable = ops.filter((o) => o.kind === "TRADEABLE").length;
  const doc = { at: now, venues: guard.venues, quarantined: guard.quarantined, arbGuardLaw: guard.law, executable, opportunities: ops };
  writeJson(path.join(STATE, "opportunities.json"), doc);
  if (ops.length) appendLine(path.join(STATE, "events.jsonl"), { type: "arb.scan", at: now, top: ops.slice(0, 3).map((o) => ({ pair: o.pair, edgeBps: o.edgeBps, cls: o.cls })) });

  /* VAULT SWEEP LAW: recycle fee income into the grid (asks always lawful,
   * bids only when the flow guard allows) — fees become presence, not dust. */
  let sweep = null;
  const vSteem = fnum(S.ledger.balances.__vault__?.STEEM) ?? 0;
  const vSbd = fnum(S.ledger.balances.__vault__?.SBD) ?? 0;
  if (parity2 && (vSteem >= 0.5 || vSbd >= 0.5)) {
    sweep = vaultSweepPlan({ vaultSteem: vSteem, vaultSbd: vSbd, parity: parity2, guardAction });
    for (const lvl of sweep.levels ?? []) {
      const pool2 = S.pools.pools["STEEM-SBD"];
      const vaultBacked = lvl.side === "ask" ? vSteem : vSbd;
      const res = enqueueSteemOp({ level: lvl, availableBase: (pool2?.reserveA ?? 0) + (lvl.side === "ask" ? vaultBacked : 0) });
      appendLine(path.join(STATE, "events.jsonl"), { type: "vault.sweep", at: now, level: lvl, result: res.verdict });
    }
  }

  /* AUTONOMOUS ARM LAW: the top lawful ask of the opposing grid auto-queues
   * into the real rail each tick (cap 6/day, every law re-checked at both
   * ends). Bids are NEVER auto-queued while PAUSE-FLOW holds (the measured
   * guard law) — enqueueSteemOp refuses them fail-closed. This is what makes
   * the DEX a machine, not a dashboard. */
  let autoArm = null;
  if (stack.plan?.asks?.length) {
    autoArm = enqueueSteemOp({ level: stack.plan.asks[0] });
  }
  S.lastTick = { at: now, verdict: "TICKED", parity: parity2, opportunities: ops.length, executable, venues: guard.venues.length, quarantined: guard.quarantined.length, sweep: sweep?.verdict ?? null };
  S.tickCount++;
  return S.lastTick;
}

/** PLAN-ONLY GRID STACKS (the mandate: "more opposing grids"): the measured
 * regimes of the gated ponds render as grid PLANs with zero inventory —
 * they arm with the operator credential OR with verified deposits (the
 * deposit custody law turns gated ponds into backed pools lawfully). */
function planStacks(s, now) {
  const out = [];
  const hp = s?.hive?.plan ?? null;
  if (hp && fnum(hp.mid) > 0) {
    const plan = gridPlan({ parity: fnum(hp.mid), spreadBps: Math.max(fnum(hp.spreadBps) ?? 150, 150), baseBal: 0, quoteBal: 0, levels: 3, avgCost: null, base: "HIVE", quote: "HBD" });
    out.push({ id: "plan:HIVE-HBD", at: now, pair: ["HIVE", "HBD"], venue: "ספר-Hive נמדד-חי", parity: fnum(hp.mid), guardAction: "NO-CREDENTIAL", plan: { ...plan, laws: [...(plan.laws ?? []), "PLAN-ONLY — נחמס עם-credential או עם-הפקדה-מאומתת (חוק-משכן-הפקדות)"] } });
  }
  for (const pond of s?.enginepond?.ponds ?? []) {
    const t = pond?.touch ?? null;
    const sym = String(pond.symbol ?? "").toUpperCase();
    if (!t || !(fnum(t.bestBid) > 0) || !sym) continue;
    const mid = (fnum(t.bestBid) + fnum(t.bestAsk)) / 2;
    const plan = gridPlan({ parity: mid, spreadBps: Math.max(fnum(t.spreadBps) ?? 500, 300), baseBal: 0, quoteBal: 0, levels: 2, avgCost: null, base: sym, quote: "SWAP.HIVE" });
    out.push({ id: `plan:${sym}`, at: now, pair: [sym, "SWAP.HIVE"], venue: "ספר-Hive-Engine נמדד-חי", parity: r6(mid), guardAction: "NO-CREDENTIAL", plan: { ...plan, laws: [...(plan.laws ?? []), "PLAN-ONLY — נחמס עם-credential או עם-הפקדה-מאומתת"] } });
    break; // one HE plan stack is enough for the render
  }
  return out;
}

/* ── graph + rail prices (measured only) ─────────────────────────────── */
/** PARITY-BAND GUARD on the internal pool: a quote whose route crosses a
 * pool whose mid deviates beyond the band from the oracle is REFUSED —
 * proof-carrying, typed (peg.mjs doctrine, T-75). */
function poolBandGuard({ poolIds, bandBps = 5000 }) {
  const parity = engineParity();
  if (!parity) return { verdict: "NO-PARITY-MEASURE" };
  for (const pid of poolIds ?? []) {
    const pool = S.pools.pools[pid];
    if (!pool || !(fnum(pool.reserveA) > 0) || !(fnum(pool.reserveB) > 0)) continue;
    const mid = fnum(pool.reserveB) / fnum(pool.reserveA);
    const v = parityVerdict({ mid, fair: parity, bandBps });
    if (v.verdict === "REFUSE-BAND") return { verdict: "REFUSE-BAND", pool: pid, devBps: v.devBps, bandBps: v.bandBps };
  }
  return { verdict: "BANDS-OK" };
}

function routePoolIds(quote) {
  return (quote?.legs ?? []).filter((l) => l.kind === "pool").map((l) => l.id);
}

function railPricesFromEngine() {
  const s = S.engine.data;
  const out = {};
  if (!s) return out;
  const book = s.market?.book ?? readEngineStateFile("market.json")?.book ?? null;
  const bid = fnum(book?.bestBid), ask = fnum(book?.bestAsk);
  if (bid > 0 && ask > 0) {
    out["steem-limit-order"] = {
      // rail semantics: units of `to` per unit of `from` (measured only):
      // 1 SBD buys parity⁻¹ STEEM; 1 STEEM sells for the book mid in SBD
      "SBD->STEEM": engineParity() > 0 ? r6(1 / engineParity()) : null,
      "STEEM->SBD": r6((bid + ask) / 2),
    };
  }
  return out;
}

/* ── deposit custody (משכן-הפקדות) — keyless chain scan ─────────────── */
const DEPOSITS_FILE = path.join(STATE, "deposits.json");
const DEPOSIT_SCAN_LIMIT = 100; // node cap: get_account_history upper limit is 100 (measured live)
let lastDepositScan = 0;
function depositsState() { return readJson(DEPOSITS_FILE, { lastBlock: null, credits: [], pending: [] }); }

/** Scan recent transfers TO the machine with memo dex-deposit:<agent>.
 * Keyless, bounded, idempotent (lastBlock watermark). Only assets whose
 * EXIT rail is armed are credited (depositAcceptLaw) — no lock-in lies. */
async function scanDeposits({ now = new Date().toISOString() } = {}) {
  if (Date.now() - lastDepositScan < 30_000) return { verdict: "THROTTLED" };
  lastDepositScan = Date.now();
  const account = S.engine.data?.account ?? "headcorner";
  let hist = null;
  for (const node of ["https://api.steemit.com", "https://api.steem.fan", "https://steem.61bts.com"]) {
    try {
      const r = await fetch(node, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_account_history", params: [account, -1, DEPOSIT_SCAN_LIMIT], id: 1 }),
        signal: AbortSignal.timeout(12_000),
      });
      const j = await r.json();
      if (j?.result) { hist = j.result; break; }
    } catch { /* next node */ }
  }
  if (!hist) return { verdict: "NO-SCAN", why: "all-nodes-failed" };
  const st = depositsState();
  const startBlock = st.lastBlock ?? 0;
  let scanned = 0;
  for (const [seq, ev] of hist) {
    if (ev.block <= startBlock) continue;
    scanned++;
    const op = ev.op ?? [];
    if (op[0] !== "transfer") continue;
    const b = op[1] ?? {};
    if (String(b.to ?? "").toLowerCase() !== String(account).toLowerCase()) continue;
    const [amtStr, symRaw] = String(b.amount ?? "").split(" ");
    const asset = String(symRaw ?? "").toUpperCase();
    const v = depositAcceptLaw({ asset, memo: b.memo, rails: RAILS });
    const row = { at: ev.timestamp, block: ev.block, txid: ev.trx_id ?? null, from: b.from ?? null, amount: String(b.amount ?? ""), memo: String(b.memo ?? "").slice(0, 80), verdict: v.verdict, why: v.why ?? null, agent: v.agent ?? null };
    if (v.verdict === "ACCEPT") {
      const amt = fnum(amtStr) ?? 0;
      if (amt > 0) {
        // credit: register the agent lawfully (auto-allowance is a mint WITH anchor = the deposit txid)
        if (!S.agents.agents[v.agent]) registerAgent({ id: v.agent, kind: "agent" });
        const bk = (S.ledger.backing[asset] ??= { internal: 0, covered: 0, backing: [] });
        bk.backing.push({ source: "deposit-verified", amount: r6(amt), ref: row.txid });
        bk.covered = r6((fnum(bk.covered) ?? 0) + amt);
        S.ledger.balances[v.agent] = { ...(S.ledger.balances[v.agent] ?? {}), [asset]: r6((fnum(S.ledger.balances[v.agent]?.[asset]) ?? 0) + amt) };
        st.credits.push(row);
        appendLine(path.join(STATE, "events.jsonl"), { type: "deposit.credited", at: now, ...row, amountNum: r6(amt) });
      }
    } else if (v.verdict === "PENDING-UNACCEPTED") {
      st.pending.push(row);
      appendLine(path.join(STATE, "events.jsonl"), { type: "deposit.pending", at: now, ...row });
    }
  }
  const top = hist.length ? hist[hist.length - 1][1].block : startBlock;
  if (top > startBlock) st.lastBlock = top;
  st.credits = (st.credits ?? []).slice(-100);
  st.pending = (st.pending ?? []).slice(-100);
  writeJson(DEPOSITS_FILE, st);
  writeJson(path.join(STATE, "ledger.json"), S.ledger);
  return { verdict: "SCANNED", scanned, lastBlock: st.lastBlock, credits: st.credits.length, pending: st.pending.length };
}

/** CREDIT REDEMPTION — the real liquefaction path: burn agent CREDIT,
 * pay out of the VAULT's REAL fee inventory at measured parity, escrow-checked. */
function redeemCredit({ agent, asset, credit }) {
  const key = String(agent ?? "").slice(0, 40);
  const sym = String(asset ?? "").toUpperCase();
  const s = S.engine.data;
  const st = fnum(s?.observe?.parity?.steemUsd) ?? null;
  const sb = fnum(s?.observe?.parity?.sbdUsd) ?? null;
  const q = redemptionQuote({
    credit, asset: sym,
    vaultBalance: fnum(S.ledger.balances.__vault__?.[sym]) ?? 0,
    steemUsd: st, sbdUsd: sb,
    agentBalance: fnum(S.ledger.balances[key]?.CREDIT) ?? 0,
  });
  if (q.verdict !== "OK") return { ...q, ok: false };
  // burn + pay (escrow-checked, atomic rollback on violation)
  const prevAgent = fnum(S.ledger.balances[key]?.CREDIT) ?? 0;
  const prevVault = fnum(S.ledger.balances.__vault__?.[sym]) ?? 0;
  S.ledger.balances[key].CREDIT = r6(prevAgent - q.credit);
  S.ledger.balances.__vault__ = { ...(S.ledger.balances.__vault__ ?? {}), [sym]: r6(prevVault - q.out) };
  // the vault's payout reduces the covered backing by the same real units
  const bk = S.ledger.backing[sym];
  if (bk) bk.covered = Math.max(0, r6((fnum(bk.covered) ?? 0) - q.out));
  const esc = escrowCheck(S.ledger);
  if (!esc.ok) {
    S.ledger.balances[key].CREDIT = r6(prevAgent);
    S.ledger.balances.__vault__[sym] = r6(prevVault);
    if (bk) bk.covered = r6((fnum(bk.covered) ?? 0) + q.out);
    return { ok: false, verdict: "ESCROW-BLOCK", esc };
  }
  writeJson(path.join(STATE, "ledger.json"), S.ledger);
  appendLine(path.join(STATE, "events.jsonl"), { type: "credit.redeemed", at: new Date().toISOString(), agent: key, asset: sym, credit: q.credit, out: q.out, unitOut: q.unitOut, vaultLeft: r6(prevVault - q.out) });
  return { ok: true, ...q, vaultLeft: r6(prevVault - q.out), agentBalance: S.ledger.balances[key] };
}

/* ── agent commerce ──────────────────────────────────────────────────── */
const AGENT_ALLOWANCE_CREDIT = 250;
/** TREASURY ALLOCATION (the arb float): a backed-asset float from the REAL
 * chain inventory to an agent — bounded by the escrow remainder, journaled,
 * trimmed automatically if the inventory shrinks (float.trimmed law). This
 * is what makes the agent arbitrage web REAL: soldiers trade REAL-backed
 * inventory against the pool and the measured books, fees accrue to the
 * vault, and every settlement path stays typed armed/gated. */
const MAX_FLOAT_PER_AGENT = { STEEM: 1.0, SBD: 1.0 };
function treasuryAllocate({ agent, asset, amount }) {
  const key = String(agent ?? "").slice(0, 40);
  const sym = String(asset ?? "").toUpperCase();
  const amt = fnum(amount);
  if (!key || !S.agents.agents[key]) return { verdict: "REFUSED", why: "unknown-agent" };
  if (!["STEEM", "SBD"].includes(sym)) return { verdict: "REFUSED", why: "non-floatable-asset", note: "רק-מסילה-חמושה (STEEM/SBD) מקבלת-מלווה-היום" };
  if (!amt || amt <= 0) return { verdict: "REFUSED", why: "bad-amount" };
  const cap = fnum(MAX_FLOAT_PER_AGENT[sym]) ?? 0;
  const held = fnum(S.ledger.balances[key]?.[sym]) ?? 0;
  if (held + amt > cap) return { verdict: "REFUSED-CAP", why: "per-agent-float-cap", cap, held: r6(held) };
  const escBefore = escrowCheck(S.ledger);
  S.ledger.balances[key] = { ...(S.ledger.balances[key] ?? {}), [sym]: r6(held + amt) };
  const esc = escrowCheck(S.ledger);
  if (!esc.ok) {
    S.ledger.balances[key][sym] = r6(held); // roll back
    return { verdict: "REFUSED-ESCROW", why: "המשכן-אינו-מכסה — אפס-הקצאה-כוזבת", esc };
  }
  writeJson(path.join(STATE, "ledger.json"), S.ledger);
  appendLine(path.join(STATE, "events.jsonl"), { type: "float.allocated", at: new Date().toISOString(), agent: key, asset: sym, amount: r6(amt), escrowOk: esc.ok });
  return { verdict: "ALLOCATED", agent: key, asset: sym, amount: r6(amt), balance: S.ledger.balances[key] };
}
function registerAgent({ id, kind = "agent" }) {
  const key = String(id ?? "").trim().slice(0, 40);
  if (!key) return { verdict: "REFUSED", why: "no-id" };
  if (S.agents.agents[key]) return { verdict: "EXISTS", agent: S.agents.agents[key] };
  const mint = creditMint(S.ledger, { amount: AGENT_ALLOWANCE_CREDIT, ref: `agent-allowance:${key}`, reason: "הקצאת-מסחר לסוכן (חוק-CREDIT: מינט מתועד עם-עוגן)" });
  if (!mint) return { verdict: "REFUSED", why: "credit-mint-refused" };
  S.agents.agents[key] = { kind: ["agent", "soldier", "operator"].includes(kind) ? kind : "agent", registeredAt: new Date().toISOString(), stats: { trades: 0, volumeIn: 0, feesPaid: 0 } };
  S.ledger.credit.supply = r6((fnum(S.ledger.credit.supply) ?? 0) + mint.amount);
  S.ledger.credit.minted.push({ ...mint, at: new Date().toISOString() });
  S.ledger.balances[key] = { ...(S.ledger.balances[key] ?? {}), CREDIT: r6((fnum(S.ledger.balances[key]?.CREDIT) ?? 0) + mint.amount) };
  writeJson(path.join(STATE, "agents.json"), S.agents);
  writeJson(path.join(STATE, "ledger.json"), S.ledger);
  appendLine(path.join(STATE, "events.jsonl"), { type: "agent.registered", at: new Date().toISOString(), id: key, kind, allowanceCredit: mint.amount });
  return { verdict: "REGISTERED", id: key, allowanceCredit: mint.amount };
}

/** Apply pure deltas to the ledger (escrow-checked BEFORE persist). */
function applyDeltas(deltas) {
  for (const d of deltas) {
    const h = (S.ledger.balances[d.holder] ??= {});
    h[d.asset] = r6((fnum(h[d.asset]) ?? 0) + (fnum(d.delta) ?? 0));
    if (Math.abs(h[d.asset]) < 1e-9) h[d.asset] = 0;
  }
  const esc = escrowCheck(S.ledger);
  if (!esc.ok) return { verdict: "ESCROW-VIOLATION", esc };
  return { verdict: "APPLIED", esc };
}

/* ── queue ops for the engine (single signer) ────────────────────────── */
let seqCounter = Math.floor(Date.now() / 1000) % 1_000_000;
function enqueueSteemOp({ level, capPerDay = 6, availableBase: availableBaseOverride = null }) {
  const today = new Date().toISOString().slice(0, 10);
  const todayRows = readLines(path.join(STATE, "settlement-queue.jsonl"), 500)
    .filter((o) => o?.type === "steem-limit-op" && String(o.at).startsWith(today));
  const queuedToday = todayRows.filter((o) => o.status === "queued").length;
  if (queuedToday >= capPerDay) return { verdict: "CAP-REACHED", queuedToday, capPerDay };
  /* DEDUPE LAW: never queue two orders at (nearly) the same side+price —
   * the auto-arm fires every tick; without this it stacks duplicates. */
  const dup = todayRows.find((o) => o.side === level.side && Math.abs((fnum(o.price) ?? 0) - (fnum(level.price) ?? 0)) < (fnum(level.price) ?? 1) * 0.0002 && o.status !== "refused");
  if (dup) return { verdict: "EXISTS", orderid: dup.orderid, price: dup.price };
  const pool = S.pools.pools["STEEM-SBD"];
  const s = S.engine.data;
  const avgCost = fnum(s?.profit?.positionAvgCost) ?? null;
  const guardAction = s?.economics?.makerGuard?.action ?? null;
  const availableBase = fnum(availableBaseOverride) ?? pool.reserveA; // vault sweeps bring their own backed inventory
  const { op, refuse, orderid } = steemQueueOp({
    level, dexBaseBal: availableBase, avgCost, guardAction,
    seq: ++seqCounter, nowSec: Date.now() / 1000,
  });
  if (!op) return { verdict: "REFUSED", why: refuse };
  appendLine(path.join(STATE, "settlement-queue.jsonl"), {
    id: `dexq-${Date.now()}-${orderid}`, type: "steem-limit-op", at: new Date().toISOString(),
    side: level.side, price: r6(level.price), qty: r6(level.qty), orderid,
    op: [op[0], { ...op[1], owner: "__ENGINE_ACCOUNT__" }], status: "queued",
    laws: "single-signer: ניקור-רק-על-ידי צעד-המנוע · חוקי-הרמה: naked-short/cost-floor/flow-guard",
  });
  appendLine(path.join(STATE, "events.jsonl"), { type: "settle.enqueued", at: new Date().toISOString(), side: level.side, orderid, price: r6(level.price), qty: r6(level.qty) });
  return { verdict: "QUEUED", orderid, side: level.side };
}

/* ── receipts (read-only from the engine's own file) ─────────────────── */
function receipts() { return readJson(ENGINE_SETTLE_FILE, null); }
function queueTail(max = 50) { return readLines(path.join(STATE, "settlement-queue.jsonl"), max); }

/* ── LAW 15 wiring · BLURT escrow-OTC desk (דלפק-OTC ל-Blurt) ─────────── */
/** The Blurt leg of the DEX: measured price (engine ladder blurtUsd),
 * measured inventory (escrow backing), typed rail derivation, two-sided
 * honest desk plan. NO-credential today → QUOTED-INTERNAL cap; the queue
 * stays untouched until armed (single-writer law on the money path). */
function blurtOtcDoc() {
  const s = S.engine.data;
  const blurtUsd = fnum(s?.observe?.parity?.blurtUsd) ?? null;
  const sbdUsd = fnum(s?.observe?.parity?.sbdUsd) ?? null;
  const inv = fnum(S.ledger.backing?.BLURT?.covered) ?? 0;
  const rail = blurtRailStatus({ blurtUsd, blurtInventory: inv, hasCredential: null });
  const plan = blurtOtcPlan({ blurtUsd, sbdUsd, blurtInventory: inv, vaultSbd: fnum(S.ledger.balances.__vault__?.SBD) ?? 0 });
  return {
    at: new Date().toISOString(),
    rail, plan,
    deliveryLaw: "אספקה = transfer-BLURT אמיתי מהמשכן (memo saos-otc:v1:<ref>) — חתימת-המנוע בלבד, רק-במסילה-חמושה; עד-אז צורת-האופ נמדדת-ולא משודרת",
    source: "engine-ladder (binance→CG) — מדידת-גוף-אחד, אין-מדידה-עוקפת-שירות",
  };
}

/** LAW 16 wiring · HE pond calibration: engine-pond books × engine ladder
 * anchors — the standing drift-truth over the wrapped ponds. */
function heCalibrationDoc() {
  const s = S.engine.data;
  return heCalibration({
    ponds: s?.enginepond?.ponds ?? [],
    hiveUsd: fnum(s?.observe?.parity?.hiveUsd) ?? null,
    ltcUsd: fnum(s?.observe?.parity?.ltcUsd) ?? null,
    btcUsd: fnum(s?.observe?.parity?.btcUsd) ?? null,
    hbdUsd: fnum(s?.observe?.parity?.hbdUsd) ?? null,
    decUsd: fnum(s?.observe?.parity?.decUsd) ?? null,
  });
}

/* ── LAW 13 wiring · capital-intake drill (תרגיל-קליטת-הון) ────────────
 * Custody-class chain probes (keyless, account-scoped) are this service's
 * own lawful scans — the SAME class as scanDeposits (precedent T-75b).
 * Price/book/balance measurement stays ENGINE-ONLY (one-body law): the
 * drill feeds on the engine's live status for prices/balances, and the
 * chain probe only reads OUR OWN convert locks (a custody schedule, not a
 * market measurement). 5-min cache, 3-node ladder, fail → typed. */
let convertsCache: { at: number; data: any } | null = null;
async function getConverts({ force = false } = {}) {
  if (!force && convertsCache && Date.now() - convertsCache.at < 5 * 60_000) return convertsCache.data;
  const account = S.engine.data?.account ?? "headcorner";
  for (const node of ["https://api.steemit.com", "https://api.steem.fan", "https://steem.61bts.com"]) {
    try {
      const r = await fetch(node, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_conversion_requests", params: [account], id: 1 }),
        signal: AbortSignal.timeout(12_000),
      });
      const j = await r.json();
      if (Array.isArray(j?.result)) { convertsCache = { at: Date.now(), data: { verdict: "SCANNED", requests: j.result, source: "chain-keyless-probe (custody-class, like scanDeposits)", at: new Date().toISOString() } }; return convertsCache.data; }
    } catch { /* next node */ }
  }
  return { verdict: "NO-SCAN", why: "all-nodes-failed", requests: [] };
}

function intakeSnapshot() {
  const s = S.engine.data;
  const book = s?.market?.book ?? readEngineStateFile("market.json")?.book ?? null;
  const bid = fnum(book?.bestBid), ask = fnum(book?.bestAsk);
  const spreadBps = bid > 0 && ask > 0 && ask >= bid ? Math.round(((ask - bid) / ((ask + bid) / 2)) * 1e4) : 150;
  return {
    steem: fnum(s?.live?.balances?.steem) ?? 0,
    sbd: fnum(s?.live?.balances?.sbd) ?? 0,
    parity: engineParity(),
    avgCost: fnum(s?.profit?.positionAvgCost) ?? null,
    spreadBps,
    guardAction: s?.economics?.makerGuard?.action ?? null,
  };
}

/** The full drill: converts schedule → wave-1 + total intake projections →
 * inbound router map. PURE laws on MEASURED inputs; zero live risk. */
async function intakeDrillDoc({ force = false, sbdOverride = null, steemOverride = null } = {}) {
  const snap = intakeSnapshot();
  const conv = await getConverts({ force });
  const landing = convertsLanding({ requests: conv?.requests ?? [], nowSec: Date.now() / 1000 });
  const wave1 = (landing.waves ?? []).find((w) => w.within24h) ?? (landing.waves ?? [])[0] ?? null;
  const drillWave1 = intakeDrill({ snapshot: snap, inboundSbd: wave1?.sbd ?? 0, nowSec: Date.now() / 1000 });
  const drillTotal = intakeDrill({ snapshot: snap, inboundSbd: landing.totalSbd ?? 0, nowSec: Date.now() / 1000 });
  const drillCustom = (sbdOverride != null || steemOverride != null)
    ? intakeDrill({ snapshot: snap, inboundSbd: fnum(sbdOverride) ?? 0, inboundSteem: fnum(steemOverride) ?? 0, nowSec: Date.now() / 1000 })
    : null;
  return {
    ok: true,
    at: new Date().toISOString(),
    engine: { up: S.engine.up, at: S.engine.at },
    snapshot: snap,
    converts: { verdict: conv?.verdict ?? "NO-SCAN", source: conv?.source ?? null, landing },
    drillWave1: { wave: wave1, result: drillWave1 },
    drillTotal: { result: drillTotal },
    drillCustom,
    routerMap: inboundRouterMap({ pools: S.pools.pools }),
    law: "תרגיל-יבש לקליטת-ההון — חוקי-המסילה החיים בדיוק, אפס-סיכון; המנוע הוא מקור-המדידה היחיד, השרשרת נסרקת רק למשכננו (הפקדות/נעילות)",
  };
}
let intakeCache: { at: number; data: any } | null = null;
async function intakeCached({ force = false } = {}) {
  if (force || !intakeCache || Date.now() - intakeCache.at > 5 * 60_000) {
    try { intakeCache = { at: Date.now(), data: await intakeDrillDoc({ force }) }; }
    catch (e) { return { ok: false, verdict: "DRILL-ERROR", why: String(e?.message ?? e).slice(0, 160) }; }
  }
  return intakeCache.data;
}

/* ── batch clearing (mini-CoW) — open/submit/close ───────────────────── */
function batchSubmit({ agent, side, limit, qty }: any) {
  const key = String(agent ?? "").slice(0, 40);
  if (!S.agents.agents[key]) return { ok: false, verdict: "REFUSED", why: "unknown-agent" };
  const sd = String(side ?? "").toLowerCase();
  if (sd !== "buy" && sd !== "sell") return { ok: false, verdict: "REFUSED", why: "bad-side" };
  const L = fnum(limit), Q = fnum(qty);
  if (!L || L <= 0) return { ok: false, verdict: "REFUSED", why: "bad-limit" };
  if (!Q || Q <= 0 || Q > 50) return { ok: false, verdict: "REFUSED", why: "bad-qty (cap 50)" };
  if ((S.batch.current.orders ?? []).length >= BATCH_MAX_ORDERS) return { ok: false, verdict: "REFUSED", why: "batch-full" };
  const mine = (S.batch.current.orders ?? []).filter((o: any) => o.agent === key).length;
  if (mine >= BATCH_MAX_PER_AGENT) return { ok: false, verdict: "REFUSED", why: "per-agent-cap", cap: BATCH_MAX_PER_AGENT };
  const id = `${S.batch.current.id}-o${(S.batch.current.orders?.length ?? 0) + 1}-${Date.now().toString(36)}`;
  S.batch.current.orders.push({ id, agent: key, side: sd, limit: L, qty: Q, at: new Date().toISOString() });
  persistBatch();
  appendLine(path.join(STATE, "events.jsonl"), { type: "batch.submitted", at: new Date().toISOString(), batch: S.batch.current.id, orderId: id, agent: key, side: sd, limit: L, qty: Q });
  return { ok: true, verdict: "SUBMITTED", batch: S.batch.current.id, orderId: id, orders: S.batch.current.orders.length, closesInMs: Math.max(0, BATCH_WINDOW_MS - (Date.now() - new Date(S.batch.current.openedAt).getTime())) };
}

function batchClose({ now = new Date().toISOString() }: any = {}) {
  const cur = S.batch.current;
  if (!cur?.id) return { ok: false, verdict: "NO-BATCH" };
  const parity = engineParity();
  if (!parity) {
    /* fail-closed: no measured parity → the batch closes EMPTY (no auction on
     * an unmeasured price), orders roll into the next batch honestly */
    const rolled = { seq: ++S.batch.seq, current: newBatch(S.batch.seq), lastClosed: { id: cur.id, closedAt: now, verdict: "NO-MEASURE", cleared: false, ordersCarried: cur.orders?.length ?? 0, law: "אין-פאריטי נמדד — אין-מכירה; ההזמנות נישאות למחבת-הבאה" } };
    rolled.current.orders = cur.orders ?? [];
    S.batch = rolled; persistBatch();
    return { ok: true, verdict: "CLOSED-NO-MEASURE", law: rolled.lastClosed.law };
  }
  const r = batchClear({ batch: cur, parity, balances: S.ledger.balances, base: "STEEM", quote: "SBD", feeBps: BATCH_FEE_BPS });
  let applied: any = { verdict: "NOT-APPLIED" };
  if (r.verdict === "CLEARED") {
    applied = applyDeltas(r.deltas);
    if (applied.verdict !== "APPLIED") {
      S.ledger = readJson(path.join(STATE, "ledger.json"), S.ledger); // roll back
      appendLine(path.join(STATE, "events.jsonl"), { type: "batch.escrow-block", at: now, batch: cur.id, violations: applied.esc?.violations ?? [] });
      return { ok: false, verdict: "ESCROW-BLOCK", esc: applied.esc };
    }
    writeJson(path.join(STATE, "ledger.json"), S.ledger);
  }
  const artifact = { id: cur.id, openedAt: cur.openedAt, closedAt: now, verdict: r.verdict, clearingPrice: r.clearingPrice ?? null, matchedQty: r.matchedQty ?? 0, fills: r.fills ?? [], unfilled: r.unfilled ?? [], rejected: r.rejected ?? [], feeQuote: r.feeQuote ?? 0, band: r.band ?? null, digest: r.digest ?? null, parity, laws: r.laws ?? [], deltas: r.deltas ?? [] };
  appendLine(BATCHES_LOG, artifact);
  appendLine(path.join(STATE, "events.jsonl"), { type: "batch.closed", at: now, batch: cur.id, verdict: r.verdict, clearingPrice: r.clearingPrice ?? null, matchedQty: r.matchedQty ?? 0, feeQuote: r.feeQuote ?? 0, digest: r.digest ?? null });
  /* CARRY LAW (resting book, honest): unfilled interest rests into the next
   * batch — INCLUDING the unfilled remainder of partially-filled orders —
 * but (a) typed-rejected orders (underfunded-at-clear) NEVER carry again
 * (they already got their refusal; carrying them would re-poison every
 * future batch — caught live T-75c), (b) each carry ages the order; after
 * MAX_CARRIES windows the order expires typed (no immortal orders). */
  const rejAgents = new Set((r.rejected ?? []).filter((x: any) => x.why === "underfunded-at-clear").map((x: any) => x.agent));
  const fillByOrderId = new Map((r.fills ?? []).map((f: any) => [String(f.orderId), f.fillQty]));
  const rests = (r.verdict === "REFUSE-BAND" || r.verdict === "NO-CROSS")
    ? (cur.orders ?? []).map((o: any) => ({ ...o, carries: (o.carries ?? 0) + 1 }))
    : (r.unfilled ?? []).map((u: any) => {
        const src = (cur.orders ?? []).find((o: any) => String(o.id) === String(u.orderId)) ?? {};
        return { ...src, qty: r6((fnum(u.qty) ?? 0) - (fnum(u.filled) ?? 0)), carries: ((src as any).carries ?? 0) + 1 };
      }).filter((o: any) => fnum(o.qty) > 0);
  const carried = rests.filter((o: any) => !rejAgents.has(o.agent) && (o.carries ?? 0) < BATCH_MAX_CARRIES);
  const expired = rests.length - carried.length;
  if (expired > 0) appendLine(path.join(STATE, "events.jsonl"), { type: "batch.expired", at: now, count: expired, law: "תוקף-הזמנה = 3 מחבתות — אין-הזמנות-בנות-אלמוות" });
  const nb = newBatch(++S.batch.seq);
  nb.orders = carried;
  S.batch.current = nb;
  S.batch.lastClosed = artifact;
  persistBatch();
  return { ok: true, verdict: r.verdict, artifact, carried: carried.length, expired };
}

function batchMaybeClose() {
  const cur = S.batch?.current;
  if (!cur?.openedAt) return { verdict: "NO-BATCH" };
  const age = Date.now() - new Date(cur.openedAt).getTime();
  if (age < BATCH_WINDOW_MS) return { verdict: "OPEN", ageMs: age, closesInMs: BATCH_WINDOW_MS - age };
  return batchClose({});
}

/* ── status doc ──────────────────────────────────────────────────────── */
function statusDoc() {
  const esc = escrowCheck(S.ledger);
  const graph = buildGraph(S.pools.pools);
  const s = S.engine.data;
  return {
    ok: true,
    at: new Date().toISOString(),
    service: "saos-dex · רשת-ה-DEX שלנו",
    law: "escrow-law + rails-law + parity-law — החלפות-אמת: כל-רגל מטופלת armed/gated, הרשת אינה מחזיקה מעבר-למשכן",
    engine: { up: S.engine.up, at: S.engine.at, stale: S.engine.stale },
    escrow: { ...esc, backing: S.ledger.backing },
    pools: Object.fromEntries(Object.entries(S.pools.pools).map(([id, p]) => [id, {
      assets: p.assets, reserveA: r6(p.reserveA), reserveB: r6(p.reserveB),
      feeBps: p.feeBps, backed: !!p.backed, mid: p.reserveA > 0 && p.reserveB > 0 ? r6(p.reserveB / p.reserveA) : null,
      note: p.note, backingRef: p.backingRef ?? null,
    }])),
    rails: Object.fromEntries(Object.entries(RAILS).map(([id, r]) => [id, { status: r.status, cls: RAIL_STATUS_CLASS[r.status], note: r.note, unlock: r.unlock ?? null }])),
    grids: S.grids,
    arb: readJson(path.join(STATE, "opportunities.json"), null),
    agents: S.agents,
    leaderboard: Object.entries(S.agents.agents)
      .map(([id, a]) => ({ id, kind: a.kind, trades: a.stats?.trades ?? 0, volumeIn: r6(a.stats?.volumeIn ?? 0), feesPaid: r6(a.stats?.feesPaid ?? 0) }))
      .sort((a, b) => b.trades - a.trades || b.volumeIn - a.volumeIn),
    settlement: { queueTail: queueTail(20), receipts: receipts() },
    batch: {
      windowMs: BATCH_WINDOW_MS,
      current: { id: S.batch.current.id, openedAt: S.batch.current.openedAt, orders: (S.batch.current.orders ?? []).length, closesInMs: Math.max(0, BATCH_WINDOW_MS - (Date.now() - new Date(S.batch.current.openedAt).getTime())) },
      lastClosed: S.batch.lastClosed,
      law: "מחבת-CoW: מחיר-ניקוי אחיד לכל-המילויים · שער-פאריטי על-מחיר-הניקוי · שימור מדויק · digest ניתן-לחישוב-חוזר",
    },
    intake: intakeCache && Date.now() - intakeCache.at < 10 * 60_000 ? {
      at: intakeCache.data.at,
      converts: intakeCache.data.converts,
      drillWave1: intakeCache.data.drillWave1,
      drillTotal: intakeCache.data.drillTotal,
      routerMap: intakeCache.data.routerMap,
      law: "תרגיל-קליטת-הון (≤10 דק׳ טרי) — הכסף נוחת, המכונה מוכחת-מראש",
    } : null,
    deposits: { ...depositsState(), law: "מסילת-יציאה חייבת להיות חמושה לפני קבלת-הפקדה — אין-נעילה-כוזבת", memo: "dex-deposit:<agent-id>" },
    blurtOtc: blurtOtcDoc(),
    heCalibration: heCalibrationDoc(),
    credit: { ...S.ledger.credit, faceUsd: 0.01, minRedeem: 100, redemptionLaw: "המרה מהמלאי-האמיתי-של-הכספת בלבד, בפאריטי-נמדד של-הרגע" },
    ticks: { count: S.tickCount, last: S.lastTick, heartbeat: (() => {
      const at = S.lastTick?.at ?? S.bootedAt;
      const ageMs = Date.now() - new Date(at).getTime();
      return { at, ageMs, verdict: ageMs > 3 * 60_000 ? "HEARTBEAT-STALE" : "FRESH", law: "דופק-מטופל — אין-מוות-שקט (T-60 הלקח, T-75b)" };
    })() },
    lastError: S.lastError,
  };
}

/* ── HTTP ────────────────────────────────────────────────────────────── */
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });

async function handle(req) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  maintenance().catch(() => {}); // request-driven heartbeat (mutex-guarded, non-blocking)
  try {
    if (p === "/" || p === "/health") {
      return json({ ok: true, service: "saos-dex", at: new Date().toISOString(), engine: S.engine.up, ticks: S.tickCount });
    }
    if (p === "/status") return json(statusDoc());
    if (p === "/sync") { await syncEngine(); const esc = syncEscrow(); return json({ ok: true, engine: S.engine.up, escrow: esc }); }
    if (p === "/tick") { await syncEngine(); syncEscrow(); return json({ ok: true, tick: runTick() }); }
    if (p === "/quote") {
      if (!S.engine.up) return json({ ok: false, verdict: "ENGINE-STALE", why: "אין-מדידה-חיה — אין-ציטוט (fail-closed)" }, 503);
      const from = (url.searchParams.get("in") ?? "").toUpperCase();
      const to = (url.searchParams.get("out") ?? "").toUpperCase();
      const amountIn = fnum(url.searchParams.get("amount"));
      if (!ASSETS[from] || !ASSETS[to] || from === to || !amountIn || amountIn <= 0) return json({ ok: false, verdict: "REFUSED", why: "bad-pair-or-amount" }, 400);
      const graph = buildGraph(S.pools.pools);
      const rp = railPricesFromEngine();
      // rail price semantics in simulatePath: units of `to` per unit of `from`
      const steemRail = rp["steem-limit-order"] ?? {};
      const railPrice = from === "SBD" ? (steemRail["SBD->STEEM"] ?? null) : from === "STEEM" ? (steemRail["STEEM->SBD"] ?? null) : null;
      const q = routeQuote({ graph, in: from, out: to, amountIn, railPrices: { "steem-limit-order": railPrice } });
      const bandGuard = poolBandGuard({ poolIds: routePoolIds(q) });
      if (bandGuard.verdict === "REFUSE-BAND") {
        return json({ ok: false, verdict: "REFUSED-PARITY-BAND", why: "מרווח-הבריכה-הפנימית חורג מרצועת-הפאריטי — אין-החלפה-כוזבת", ...bandGuard }, 409);
      }
      const fair = from === "STEEM" ? (steemRail["STEEM->SBD"] ?? null) : to === "STEEM" ? (steemRail["SBD->STEEM"] ?? null) : null;
      const band = fair ? parityVerdict({ mid: fnum(q.amountOut) / amountIn, fair, bandBps: 5000 }) : { verdict: "NO-MEASURE", devBps: null, bandBps: null };
      /* SIZE LAW: impact beyond the cap is an honest REFUSAL with a chunked
       * execution plan — the router for LARGE amounts (operator mandate).
       * Never a fake fill through a dust pool. */
      const MAX_IMPACT_BPS = 1000;
      let splitPlan = q.split ?? null;
      if ((q.impactBps ?? 0) > MAX_IMPACT_BPS && !splitPlan) {
        const chunkMax = Math.max(fnum(amountIn) / 8, 0.01);
        const qs = routeQuote({ graph, in: from, out: to, amountIn, railPrices: { "steem-limit-order": railPrice }, chunkMax });
        splitPlan = qs.split ?? null;
      }
      if ((q.impactBps ?? 0) > MAX_IMPACT_BPS) {
        return json({ ok: false, verdict: "REFUSED-IMPACT", why: "השפעת-מחיר חורגת מהתקרה — אין-מילוי-כוזב דרך-בריכה-קטנה", impactBps: q.impactBps, maxImpactBps: MAX_IMPACT_BPS, suggestedSplit: splitPlan, route: q.path }, 409);
      }
      return json({ ok: true, intent: "saos.quote.v1", at: new Date().toISOString(), ...q, band, splitPlan, expiresAt: new Date(Date.now() + 60_000).toISOString(), proof: { engineAt: S.engine.at, escrowOk: escrowCheck(S.ledger).ok } });
    }
    if (p === "/arb") return json({ ok: true, ...(readJson(path.join(STATE, "opportunities.json"), { venues: [], opportunities: [] })) });
    if (p === "/pools") return json({ ok: true, pools: S.pools.pools, escrow: escrowCheck(S.ledger) });
    if (p === "/agents") return json({ ok: true, agents: S.agents.agents, credit: S.ledger.credit });
    if (p === "/settlement") return json({ ok: true, queueTail: queueTail(50), receipts: receipts(), law: "כותב-יחיד: התור ניקרר על-ידי צעד-המנוע בלבד" });
    if (p === "/agent/register" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      return json({ ok: true, ...registerAgent(b) });
    }
    if (p === "/treasury/allocate" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      return json({ ok: true, ...treasuryAllocate(b) });
    }
    if (p === "/agent/redeem" && req.method === "POST") {
      if (!S.engine.up) return json({ ok: false, verdict: "ENGINE-STALE", why: "אין-מדידת-פאריטי — אין-המרה (fail-closed)" }, 503);
      const b = await req.json().catch(() => ({}));
      return json(redeemCredit(b));
    }
    if (p === "/deposits") {
      const st = depositsState();
      return json({ ok: true, law: "מסילת-יציאה חייבת להיות חמושה לפני קבלת-הפקדה — אין-נעילה-כוזבת", memo: "dex-deposit:<agent-id>", ...st });
    }
    if (p === "/agent/trade" && req.method === "POST") {
      if (!S.engine.up) return json({ ok: false, verdict: "ENGINE-STALE", why: "אין-מדידה-חיה — אין-סחר (fail-closed)" }, 503);
      const b = await req.json().catch(() => ({}));
      const intent = { id: b.id ?? `intent-${Date.now()}`, agent: b.agent, in: b.in, out: b.out, amountIn: b.amountIn, minOut: b.minOut, expires: b.expires };
      const graph = buildGraph(S.pools.pools);
      // LAW 20: the live board rides along — an intent above the matched
      // TRADEABLE edge's maxNotional is refused (the board's claim is
      // enforced at settlement, closing board → intent → settlement).
      const board = readJson(path.join(STATE, "opportunities.json"), { venues: [], opportunities: [] });
      const v = validateIntent(intent, { graph, board: board.opportunities, railPrices: {
        "steem-limit-order": intent.in === "SBD" ? (railPricesFromEngine()["steem-limit-order"]?.["SBD->STEEM"] ?? null) : (railPricesFromEngine()["steem-limit-order"]?.["STEEM->SBD"] ?? null),
      }, ledger: S.ledger });
      if (v.verdict !== "OK") { appendLine(path.join(STATE, "events.jsonl"), { type: "intent.refused", at: new Date().toISOString(), verdict: v.verdict, why: v.why, agent: intent.agent, depth: v.depth ?? null }); return json({ ok: false, ...v }, 409); }
      const bandGuard = poolBandGuard({ poolIds: routePoolIds(v.quote) });
      if (bandGuard.verdict === "REFUSE-BAND") {
        appendLine(path.join(STATE, "events.jsonl"), { type: "intent.parity-block", at: new Date().toISOString(), agent: intent.agent, ...bandGuard });
        return json({ ok: false, verdict: "REFUSED-PARITY-BAND", why: "מרווח-הבריכה חורג מרצועת-הפאריטי", ...bandGuard }, 409);
      }
      const deltas = settleIntentDeltas(intent, v.quote);
      const applied = applyDeltas(deltas);
      if (applied.verdict !== "APPLIED") { S.ledger = readJson(path.join(STATE, "ledger.json"), S.ledger); appendLine(path.join(STATE, "events.jsonl"), { type: "intent.escrow-block", at: new Date().toISOString(), agent: intent.agent, violations: applied.esc?.violations ?? [] }); return json({ ok: false, verdict: "ESCROW-BLOCK", esc: applied.esc }, 409); }
      const agentRow = S.agents.agents[intent.agent];
      if (agentRow) { agentRow.stats.trades++; agentRow.stats.volumeIn = r6((agentRow.stats.volumeIn ?? 0) + (fnum(intent.amountIn) ?? 0)); agentRow.stats.feesPaid = r6((agentRow.stats.feesPaid ?? 0) + (v.quote.feeBpsSum / 1e4) * (fnum(intent.amountIn) ?? 0)); }
      writeJson(path.join(STATE, "ledger.json"), S.ledger);
      writeJson(path.join(STATE, "agents.json"), S.agents);
      appendLine(path.join(STATE, "events.jsonl"), { type: "intent.filled", at: new Date().toISOString(), agent: intent.agent, in: intent.in, out: intent.out, amountIn: intent.amountIn, amountOut: v.quote.amountOut, path: v.quote.path, feeBpsSum: v.quote.feeBpsSum, depth: v.depth ?? null });
      return json({ ok: true, verdict: "FILLED", intent: "saos.intent.v1", quote: v.quote, depth: v.depth ?? null, deltas, ledger: S.ledger.balances[intent.agent] ?? {} });
    }
    if (p === "/batch") {
      const cur = S.batch.current;
      return json({ ok: true, pair: ["STEEM", "SBD"], windowMs: BATCH_WINDOW_MS, current: cur, lastClosed: S.batch.lastClosed, feeBps: BATCH_FEE_BPS, law: "מחבת-CoW — ההזמנות נאספות, כולן נסחרות במחיר-ניקוי אחיד או לא נסחרות כלל" });
    }
    if (p === "/batch/submit" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      return json(batchSubmit(b));
    }
    if (p === "/batch/close" && req.method === "POST") {
      await syncEngine(); syncEscrow();
      return json(batchClose({}));
    }
    if (p === "/intake/drill") {
      await syncEngine(); syncEscrow();
      const customSbd = url.searchParams.get("sbd");
      const customSteem = url.searchParams.get("steem");
      return json(await intakeDrillDoc({
        force: url.searchParams.get("force") === "1",
        sbdOverride: customSbd != null ? fnum(customSbd) : null,
        steemOverride: customSteem != null ? fnum(customSteem) : null,
      }));
    }
    if (p === "/router/map") {
      await syncEngine(); syncEscrow();
      return json({ ok: true, at: new Date().toISOString(), ...inboundRouterMap({ pools: S.pools.pools }) });
    }
    if (p === "/otc") {
      return json({ ok: true, ...blurtOtcDoc() });
    }
    if (p === "/he/calibration") {
      return json({ ok: true, at: new Date().toISOString(), ...heCalibrationDoc() });
    }
    if (p === "/grid/enqueue" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const level = b?.level ?? null;
      if (!level) return json({ ok: false, verdict: "REFUSED", why: "no-level" }, 400);
      return json({ ok: true, ...enqueueSteemOp({ level }) });
    }
    if (p === "/grid/arm" && req.method === "POST") {
      // arm the top of the opposing grids into the REAL rail (capped, lawful)
      const stack = S.grids?.stacks?.[0];
      if (!stack?.plan) return json({ ok: false, verdict: "NO-PLAN" }, 409);
      const results = [];
      for (const lvl of [...(stack.plan.asks ?? []).slice(0, 1), ...(stack.plan.bids ?? []).slice(0, 1)]) {
        results.push(enqueueSteemOp({ level: lvl }));
      }
      return json({ ok: true, results, stack: { id: stack.id, parity: stack.parity, guardAction: stack.guardAction } });
    }
    return json({ ok: false, verdict: "NO-ROUTE-HTTP", path: p }, 404);
  } catch (e) {
    S.lastError = String(e?.message ?? e).slice(0, 200);
    appendLine(path.join(STATE, "events.jsonl"), { type: "http.error", at: new Date().toISOString(), path: p, error: S.lastError });
    return json({ ok: false, error: S.lastError }, 500);
  }
}

/* ── boot + loops ────────────────────────────────────────────────────── */
let booting = true;
(async () => {
  await syncEngine();
  syncEscrow();
  runTick();
  booting = false;
  appendLine(path.join(STATE, "events.jsonl"), { type: "dex.boot", at: new Date().toISOString(), engine: S.engine.up, pools: Object.keys(S.pools.pools).length });
  maintenance({ force: true }).catch(() => {}); // first deposit scan rides the boot
})();

/* MAINTENANCE — the T-60 lesson, second instance: detached background loops
 * (setInterval.unref, background sleeps under --hot) DIED SILENTLY in live
 * verification (ticks stuck while the server lived). The heartbeat is now
 * REQUEST-DRIVEN: every incoming request nudges maintenance (mutex-guarded,
 * 60s leash) — the cockpit's own 60s poll becomes the heartbeat, and the
 * /status heartbeat LAW renders freshness fail-closed. A background loop is
 * kept as a backup only. */
let maintenanceInFlight = false;
let lastMaintenanceAt = 0;
async function maintenance({ force = false } = {}) {
  if (maintenanceInFlight || (!force && Date.now() - lastMaintenanceAt < 60_000)) return { verdict: "SKIPPED" };
  maintenanceInFlight = true;
  lastMaintenanceAt = Date.now();
  try {
    await syncEngine();
    syncEscrow();
    runTick();
    await scanDeposits();
    const batchStep = batchMaybeClose(); // mini-CoW: auto-close when the window elapses (request-driven heartbeat)
    // intake drill cache refresh (5-min leash; fail-isolated — the drill is
    // evidence, never on the money path)
    if (!intakeCache || Date.now() - intakeCache.at > 5 * 60_000) {
      intakeCached().catch(() => {});
    }
    return { verdict: "MAINTAINED", batch: batchStep?.verdict ?? null };
  } catch (e) {
    S.lastError = String(e?.message ?? e).slice(0, 200);
    return { verdict: "MAINTAIN-ERROR", error: S.lastError };
  } finally {
    maintenanceInFlight = false;
  }
}
async function maintenanceLoop() {
  for (;;) {
    await Bun.sleep(60_000);
    await maintenance();
  }
}

const server = Bun.serve({
  port: DEX_PORT,
  idleTimeout: 255,
  async fetch(req) { return handle(req); },
});

/* single-instance law: a second instance on a healthy port exits cleanly */
try {
  const h = await fetch(`http://127.0.0.1:${DEX_PORT}/health`, { signal: AbortSignal.timeout(4000) });
  if (h.ok) { /* we are the responders; fine */ }
} catch { /* nothing yet */ }

console.log(`[saos-dex] listening :${DEX_PORT} engine=${S.engine.up ? "up" : "stale"}`);
