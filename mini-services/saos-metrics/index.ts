/**
 * SAOS-METRICS ORGAN (:3042) — R218-a, "Step 1: metrics time-series"
 *
 * Design laws honored:
 *  - SINGLE-WRITER: this process is the ONLY writer of metrics.db (bun:sqlite, WAL).
 *    The engine's state files are READ-ONLY inputs. Zero write-contention with
 *    engine (:3040) / custodian (:3041) by construction.
 *  - DETERMINISM (R217 law): run as plain `bun index.ts` — no --hot, no silent
 *    mid-flight reload. Code swaps are deliberate edit -> kill -> respawn.
 *  - COLLISION PROTOCOL (R218-a): all-new files; no sovereign.ts, no engine,
 *    no prisma schema, no push-gate edits.
 *  - TRUTH LAW (R217): every series point carries its own UTC timestamp; the
 *    API exposes ageSec so the cockpit can never fake freshness.
 *
 * Survival: spawned from the next-server process tree via /api/saos/spawn-metrics
 * (the only lineage the sandbox does not reap — R216-b doctrine). Demand-healed:
 * the read API (/api/saos/metrics) resurrects it when callers actually need data.
 */

import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import { initAudits, maybeRunAudit, forceRunAudit } from "./audit"; // R218-b claims-auditor
import { merkleSnapshot, anchorNewBatch } from "./merkle"; // R218-c merkle event anchoring

const PORT = 3042;
const STATE_DIR = "/home/z/my-project/mini-services/saos-engine/state";
const DB_DIR = "/home/z/my-project/mini-services/saos-metrics/state";
const DB_PATH = path.join(DB_DIR, "metrics.db");
const EVERY_MS = 60_000; // 1 snapshot/min => ~1440 rows/day, 7d retention ~= 3MB
const RETAIN_MS = 7 * 24 * 3600 * 1000;
const BUCKET_MS = 15 * 60 * 1000; // series downsample bucket
const SERIES_WINDOW = 24 * 3600 * 1000; // 24h window
const SCHEMA = 1;

fs.mkdirSync(DB_DIR, { recursive: true });
const bootedAt = new Date().toISOString();

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec(`CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  ts_epoch INTEGER NOT NULL,
  vp_eff REAL, vp_floor REAL, votes_today INTEGER,
  rc_pct REAL, rc_tank_pct REAL, rc_growth_pct REAL,
  fills_today INTEGER, realized_sbd_total REAL, edge_bps REAL,
  ops_today INTEGER, grid_ticks INTEGER,
  inv_steem REAL, inv_sbd REAL, parity REAL,
  cycle_ok INTEGER, cycle_ms INTEGER, cycle_health TEXT,
  auto_runs INTEGER, cyc_ok INTEGER, cyc_blocked INTEGER, cyc_fail INTEGER,
  wd_checks INTEGER, wd_heals INTEGER, wd_downs INTEGER,
  armed INTEGER, paused INTEGER,
  custody_age_sec INTEGER,
  raw TEXT
);`);
db.exec("CREATE INDEX IF NOT EXISTS idx_snap_e ON snapshots(ts_epoch);");
db.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);`);
db.exec(
  `INSERT INTO meta (k,v) VALUES ('schema','${SCHEMA}'), ('bootedAt','${bootedAt}')
   ON CONFLICT(k) DO UPDATE SET v=excluded.v WHERE k='bootedAt';`
);
initAudits(db); // R218-b: audits table (same single writer)

/* ---------- guarded state-file readers (engine may be mid-write) ---------- */
function readJson(p: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
function num(v: any): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** Latest edgeBps from events.jsonl tail (convert.planned) — bounded read. */
function lastEdgeBps(): number | null {
  try {
    const st = fs.statSync(path.join(STATE_DIR, "events.jsonl"));
    const len = Math.min(st.size, 256 * 1024);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(path.join(STATE_DIR, "events.jsonl"), "r");
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n").reverse();
    for (const l of lines) {
      if (!l.includes('"convert.planned"')) continue;
      try {
        const e = JSON.parse(l);
        if (typeof e?.edgeBps === "number") return e.edgeBps;
      } catch { /* torn tail line — skip */ }
    }
  } catch { /* no events yet */ }
  return null;
}

function snap(): Record<string, any> {
  const now = Date.now();
  const ts = new Date(now).toISOString();
  const cur = readJson(path.join(STATE_DIR, "curator.json")) ?? {};
  const grid = readJson(path.join(STATE_DIR, "hyper-grid.json")) ?? {};
  const tank = readJson(path.join(STATE_DIR, "rc-tank.json")) ?? {};
  const eco = readJson(path.join(STATE_DIR, "economics.json")) ?? {};
  const cyc = readJson(path.join(STATE_DIR, "cycle-run.json")) ?? {};
  const sov = readJson(path.join(STATE_DIR, "sovereign.json")) ?? {};
  const obs = readJson(path.join(STATE_DIR, "observe.json")) ?? {};
  const anchor = readJson(path.join(STATE_DIR, "custody-anchor.json")) ?? {};
  const mm = Array.isArray(eco.rails) ? eco.rails.find((r: any) => r?.id === "market-making") ?? {} : {};
  const mmMeta = mm.meta ?? {};

  const row = {
    ts,
    ts_epoch: now,
    vp_eff: num(cur.vpEff),
    vp_floor: num(cur.minVpEffPct),
    votes_today: num(cur.votesTodayCount),
    rc_pct: num(grid.rcPct),
    rc_tank_pct: num(tank.rcPct),
    rc_growth_pct: num(tank.growthPct),
    fills_today: num(mmMeta.fillsToday),
    realized_sbd_total: num(mmMeta.realizedSbdTotal),
    edge_bps: lastEdgeBps(),
    ops_today: num(grid.opsToday),
    grid_ticks: num(grid.ticks),
    inv_steem: num(obs?.inventory?.steem),
    inv_sbd: num(obs?.inventory?.sbd),
    parity: num(obs?.parity?.parity),
    cycle_ok: typeof cyc.ok === "boolean" ? (cyc.ok ? 1 : 0) : null,
    cycle_ms: num(cyc.ms),
    cycle_health: typeof cyc.health === "string" ? cyc.health : null,
    auto_runs: num(sov?.cycles?.autoRuns),
    cyc_ok: num(sov?.cycles?.ok),
    cyc_blocked: num(sov?.cycles?.blocked),
    cyc_fail: num(sov?.cycles?.fail),
    wd_checks: num(sov?.watchdog?.checks),
    wd_heals: num(sov?.watchdog?.heals),
    wd_downs: num(sov?.watchdog?.downs),
    armed: typeof sov.armed === "boolean" ? (sov.armed ? 1 : 0) : null,
    paused: typeof sov.paused === "boolean" ? (sov.paused ? 1 : 0) : null,
    custody_age_sec: num(anchor.at) !== null ? Math.round((now - anchor.at) / 1000) : null,
  };
  row.raw = JSON.stringify({ cur, grid, tank, eco, cyc, obs }).slice(0, 8000);
  return row;
}

const COLS = Object.keys(snap()).filter((k) => k !== "raw");
let snapshotCount = 0;

function persist() {
  try {
    const row = snap();
    const cols = [...COLS, "raw"];
    const ph = cols.map(() => "?").join(",");
    const vals = cols.map((c) => (row as any)[c] ?? null);
    db.prepare(`INSERT INTO snapshots (${cols.join(",")}) VALUES (${ph})`).run(...vals);
    db.prepare(`DELETE FROM snapshots WHERE ts_epoch < ?`).run(Date.now() - RETAIN_MS);
    snapshotCount++;
  } catch (e) {
    console.error("snapshot-fail", (e as Error).message);
  }
}

/* first sample immediately, then steady grid */
persist();
setInterval(persist, EVERY_MS);
/* R218-b: autonomous audit every 6h (bounded staleness even with no readers);
 * readers additionally trigger freshness via GET /audit -> maybeRunAudit */
setInterval(() => {
  maybeRunAudit(db).catch((e) => console.error("audit-tick-fail", (e as Error).message));
}, 6 * 3600 * 1000);
/* R218-c: anchor new events as a chained Merkle batch every 30 min */
setInterval(() => {
  try {
    const r = anchorNewBatch();
    if (r.ran) console.log(`[merkle] batch anchored -> offset ${r.record?.anchoredOffset} (batch #${r.record?.batchIndex})`);
  } catch (e) {
    console.error("merkle-tick-fail", (e as Error).message);
  }
}, 30 * 60 * 1000);

/* ---------- series (15-min buckets, 24h) ---------- */
function series(): Record<string, [number, number][]> {
  const since = Date.now() - SERIES_WINDOW;
  const rows = db
    .prepare(
      `SELECT ts_epoch, vp_eff, rc_pct, fills_today, realized_sbd_total, edge_bps
       FROM snapshots WHERE ts_epoch >= ? AND vp_eff IS NOT NULL ORDER BY ts_epoch ASC`
    )
    .all(since) as any[];
  const acc: Record<string, { s: number; n: number }> = {};
  const keys = ["vp_eff", "rc_pct", "fills_today", "realized_sbd_total", "edge_bps"] as const;
  for (const r of rows) {
    const b = Math.floor(r.ts_epoch / BUCKET_MS) * BUCKET_MS;
    const k = `${b}`;
    acc[k] = acc[k] ?? {};
    for (const key of keys) {
      const v = r[key];
      if (v === null || v === undefined) continue;
      acc[k][key] = acc[k][key] ?? { s: 0, n: 0 };
      acc[k][key].s += v;
      acc[k][key].n += 1;
    }
  }
  const out: Record<string, [number, number][]> = {
    vp: [], rc: [], fills: [], sbd: [], edge: [],
  };
  for (const k of Object.keys(acc).sort((a, b) => Number(a) - Number(b))) {
    const b = Number(k);
    const e = acc[k] as any;
    if (e.vp_eff) out.vp.push([b, +(e.vp_eff.s / e.vp_eff.n).toFixed(2)]);
    if (e.rc_pct) out.rc.push([b, +(e.rc_pct.s / e.rc_pct.n).toFixed(1)]);
    if (e.fills_today) out.fills.push([b, Math.round(e.fills_today.s / e.fills_today.n)]);
    if (e.realized_sbd_total) out.sbd.push([b, +(e.realized_sbd_total.s / e.realized_sbd_total.n).toFixed(4)]);
    if (e.edge_bps) out.edge.push([b, Math.round(e.edge_bps.s / e.edge_bps.n)]);
  }
  return out;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/health" || p === "/ping") {
      const last = db.prepare("SELECT ts FROM snapshots ORDER BY id DESC LIMIT 1").get() as any;
      return Response.json({
        ok: true,
        svc: "saos-metrics",
        port: PORT,
        schema: SCHEMA,
        bootedAt,
        everySec: EVERY_MS / 1000,
        snapshotCount,
        lastAt: last?.ts ?? null,
      });
    }
    if (p === "/audit") {
      /* R218-b: GET = fresh-if-stale (6h bound); POST = force re-run */
      try {
        const res = req.method === "POST" ? await forceRunAudit(db) : await maybeRunAudit(db);
        return Response.json({ ok: true, ran: res.ran, ...(res.result ?? {}) });
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }
    if (p === "/merkle") {
      /* R218-c: GET = snapshot + verify; POST = force-anchor a batch now */
      try {
        if (req.method === "POST") {
          const r = anchorNewBatch();
          const snap = merkleSnapshot();
          return Response.json({ ok: true, anchored: r.ran, reason: r.reason ?? null, ...snap });
        }
        return Response.json(merkleSnapshot());
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }
    if (p === "/snapshot") {
      const latest = db.prepare("SELECT * FROM snapshots ORDER BY id DESC LIMIT 1").get() as any;
      const fresh = latest ? Math.round((Date.now() - latest.ts_epoch) / 1000) : null;
      return Response.json({
        ok: true,
        schema: SCHEMA,
        everySec: EVERY_MS / 1000,
        bucketMin: BUCKET_MS / 60000,
        windowH: SERIES_WINDOW / 3600000,
        bootedAt,
        snapshotCount,
        freshness: { latestAt: latest?.ts ?? null, ageSec: fresh },
        latest: latest
          ? {
              ts: latest.ts,
              vpEff: latest.vp_eff, vpFloor: latest.vp_floor,
              rcPct: latest.rc_pct, rcTankPct: latest.rc_tank_pct, rcGrowthPct: latest.rc_growth_pct,
              fillsToday: latest.fills_today, realizedSbdTotal: latest.realized_sbd_total,
              edgeBps: latest.edge_bps, opsToday: latest.ops_today, gridTicks: latest.grid_ticks,
              invSteem: latest.inv_steem, invSbd: latest.inv_sbd, parity: latest.parity,
              cycleOk: latest.cycle_ok, cycleMs: latest.cycle_ms, cycleHealth: latest.cycle_health,
              autoRuns: latest.auto_runs, cycOk: latest.cyc_ok, cycBlocked: latest.cyc_blocked, cycFail: latest.cyc_fail,
              wdChecks: latest.wd_checks, wdHeals: latest.wd_heals, wdDowns: latest.wd_downs,
              armed: latest.armed, paused: latest.paused, custodyAgeSec: latest.custody_age_sec,
            }
          : null,
        series: series(),
      });
    }
    return new Response("not-found", { status: 404 });
  },
});

console.log(`[saos-metrics] up :${PORT} db=${DB_PATH} every=${EVERY_MS / 1000}s schema=${SCHEMA} pid=${process.pid}`);
