#!/usr/bin/env node
/* SAOS PORTFOLIO FEED (exec34 fuel · 2026-11-15 rebuild)
 *
 * Measured root cause of the standing SNAPSHOT-FAIL (heartbeat
 * portfolioSnapshot SNAPSHOT-FAIL, portfolioSig null): the snapshot reads
 * {repoRoot}/mini-services/saos-dex/state/{grids.json,ledger.json} — the
 * R328 paper-economy layout that lived inside the engine tree before the
 * wipe. The B8-rebuilt tree has no mini-services/saos-dex (the internal
 * dex is its own repo now, roshpinacare-sys/saos-dex), so every beat read
 * ENOENT and failed honestly.
 *
 * This feed converts the REAL, git-published saos-dex state into the legacy
 * shapes the snapshot already knows how to weigh — no fabrication, every
 * number measured:
 *   · db/grid-ledger.json open orders → grids.json stacks (per chain, one
 *     stack; each order one leg: qty/price/notionalQuote from the live
 *     order record)
 *   · db/dex-credits.json credits → ledger.json credit.supply = Σ usds
 *     (the fleet-native CREDIT paper currency, USD-normalized at claim
 *     time — the honest common denominator)
 *
 * Deterministic, zero-network (reads files passed to it), fail-closed:
 * missing/unparseable sources → exit 1, the snapshot keeps its honest
 * SNAPSHOT-FAIL. Usage:
 *   node portfolio-feed.mjs --from <saos-dex-dir-or-fetch-dir> --repo-root <engine-tree-root>
 */

import fs from "node:fs";
import path from "node:path";

function arg(name, dflt = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

const fromDir = arg("--from");
const repoRoot = arg("--repo-root");
if (!fromDir || !repoRoot) {
  console.error("portfolio-feed: --from and --repo-root are required");
  process.exit(1);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

let gridLedger, dexCredits;
try {
  gridLedger = readJson(path.join(fromDir, "db", "grid-ledger.json"));
  dexCredits = readJson(path.join(fromDir, "db", "dex-credits.json"));
} catch (e) {
  console.error("portfolio-feed: source unreadable — " + String(e?.message ?? e).slice(0, 160));
  process.exit(1);
}

/* ── open orders → stacks (the live grid plan, chain by chain) ──────────── */

const orders = Array.isArray(gridLedger?.orders) ? gridLedger.orders.filter((o) => o?.status === "open") : [];
const num = (s) => {
  const m = String(s ?? "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};
/* the stack shape the snapshot weighs is { pair, plan: { asks, bids } } —
 * every open order is ONE leg on its side, qty/price/notionalQuote taken
 * verbatim from the live order record. */
const stacksPlain = [];
for (const [chain, pair] of [["steem", ["STEEM", "SBD"]], ["hive", ["HIVE", "HBD"]]]) {
  const asks = [], bids = [];
  for (const o of orders) {
    if ((o.chain ?? "steem") !== chain) continue;
    const price = Number(o.priceSbdPerSteem);
    if (o.side === "ask") {
      const qty = num(o.sell), nq = num(o.receive);
      if (Number.isFinite(qty) && Number.isFinite(price) && Number.isFinite(nq)) asks.push({ qty, price, notionalQuote: nq });
    } else if (o.side === "bid") {
      const qty = num(o.receive), nq = num(o.sell);
      if (Number.isFinite(qty) && Number.isFinite(price) && Number.isFinite(nq)) bids.push({ qty, price, notionalQuote: nq });
    }
  }
  if (asks.length || bids.length) stacksPlain.push({ pair, plan: { asks, bids } });
}

/* ── credits → paper CREDIT supply (USD-normalized at claim time) ────────── */

const credits = Array.isArray(dexCredits?.credits) ? dexCredits.credits : [];
const supply = credits.reduce((s, c) => s + (Number.isFinite(Number(c?.usds)) ? Number(c.usds) : 0), 0);

/* ── write the legacy shapes atomically ──────────────────────────────────── */

const outDir = path.join(repoRoot, "mini-services", "saos-dex", "state");
fs.mkdirSync(outDir, { recursive: true });
const writeAtomic = (p, v) => {
  const t = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(t, JSON.stringify(v, null, 2));
  fs.renameSync(t, p);
};
const at = new Date().toISOString();
writeAtomic(path.join(outDir, "grids.json"), { at, source: "saos-dex db/grid-ledger.json open orders (live grid plan, measured)", stacks: stacksPlain });
writeAtomic(path.join(outDir, "ledger.json"), { at, source: "saos-dex db/dex-credits.json (USD-normalized at claim time)", credit: { supply: Number(supply.toFixed(6)), entries: credits.length } });
console.log(`portfolio-feed: ${stacksPlain.length} stack(s), ${stacksPlain.reduce((s, x) => s + x.plan.asks.length + x.plan.bids.length, 0)} leg(s), CREDIT supply ${supply.toFixed(2)} usds over ${credits.length} claims → ${outDir}`);
