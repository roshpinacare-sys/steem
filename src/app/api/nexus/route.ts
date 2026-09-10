import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * 117m — THE-NEXUS API · מרכז-הבקרה הריבוני
 *
 * מצבר-חי של כל-מדינות-הרשת מקבצי-המדינה-הריבוניים (sovereign/node):
 *   snapshot (ספר·relay·wrapped·pools·fees) · deposits-state (רכבת-חוץ) ·
 *   grid98-state (מנוע-הגריד) · harvest-cursor (כלכלה-פנימית) ·
 *   security-state (THE-SHIELD) · state-root (שורש-מקודם) ·
 *   + בדיקות-חיות: key-broker (localhost:3040) · TRON-now-block (ריבוי-מארחים)
 *   + fleet מ-guardian.log (השורה-האחרונה של GUARD DONE — כנות-בלבד)
 *
 * אפס-מפתחות-ללקוח: רק זהויות-ציבוריות ונתוני-מדינה.
 * 117p8-R12: stale-while-revalidate — הגשה-מיידית עד-10-דק' + רענון-רקע (הייה-קרה-הייתה ~800ms על tron+broker).
 */

export const dynamic = "force-dynamic";

const NODE = path.join(process.cwd(), "sovereign", "node");
const GUARD_LOG = path.join(process.cwd(), "agent", "guardian.log");
const BROKER_TOKEN = path.join(process.cwd(), "agent", "keys", "key-broker.token");
const REGISTRY = path.join(process.cwd(), "agent", "keys", "wallets-registry.json");
const TRON_HOSTS = ["https://api.trongrid.io", "https://api.tronstack.io", "https://tron.stackwallet.com"];

type J = Record<string, unknown>;
function readJ(p: string): J | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as J;
  } catch {
    return null;
  }
}
const obj = (v: unknown): J => (v && typeof v === "object" ? (v as J) : {});
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

let cache: { at: number; body: J } | null = null;
const TTL = 4000; // רענון-רקע אם-חם-ובקשה-חדשה
const STALE_MS = 600000; // הגשה-מיידית-מהמטמון עד-10-דק'
let refreshing: Promise<void> | null = null;

async function tronNowBlock(): Promise<{ height: number; alive: boolean }> {
  for (const h of TRON_HOSTS) {
    try {
      const r = await fetch(h + "/wallet/getnowblock", {
        method: "POST",
        signal: AbortSignal.timeout(4000),
      });
      const j = (await r.json()) as J;
      const raw = obj(j.block_header as unknown).raw_data as J | undefined;
      const n = num(raw?.number, 0);
      if (n > 0) return { height: n, alive: true };
    } catch {
      /* מארח-הבא */
    }
  }
  return { height: 0, alive: false };
}

async function brokerHealth(): Promise<{ alive: boolean; doors: number; addresses: string[] }> {
  try {
    const r = await fetch("http://127.0.0.1:3040/health", { signal: AbortSignal.timeout(2500) });
    const j = (await r.json()) as J;
    const alive = j.ok === true;
    let addresses: string[] = [];
    if (alive) {
      try {
        const token = fs.readFileSync(BROKER_TOKEN, "utf8").trim();
        const dr = await fetch("http://127.0.0.1:3040/doors", {
          headers: { "x-kb-token": token },
          signal: AbortSignal.timeout(2500),
        });
        const dj = (await dr.json()) as { doors?: Array<{ address: string }> };
        addresses = (dj.doors || []).map((d) => d.address);
      } catch {
        /* doors-detail נכשל — health עדיין אמת */
      }
    }
    return { alive, doors: num(j.doors, addresses.length || 0), addresses };
  } catch {
    return { alive: false, doors: 0, addresses: [] };
  }
}

function fleetFromGuardianLog(): { at: string | null; services: Array<{ name: string; ok: boolean }> } {
  try {
    const lines = fs.readFileSync(GUARD_LOG, "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const L = lines[i];
      if (!/GUARD DONE/.test(L)) continue;
      const m = L.match(/^\[([^\]]+)\]/);
      const body = L.split("GUARD DONE")[1] || "";
      const services = body
        .split("·")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const ok = !/FAIL|DEAD|DOWN|MISSING/i.test(s);
          const name = s.replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] || s;
          return { name, ok };
        });
      return { at: m ? m[1] : null, services };
    }
  } catch {
    /* קובץ-נעול/חסר — כנות */
  }
  return { at: null, services: [] };
}

function registryCount(): number {
  const r = readJ(REGISTRY);
  const acc = r ? (r.accounts as unknown[]) : null;
  return Array.isArray(acc) ? acc.length : 0;
}

async function buildBody(): Promise<J> {
  const snapJ = readJ(path.join(NODE, "state-snapshot.json"));
  const st = obj(snapJ?.st);
  const meta = obj(st.meta);
  const relay = obj(st.relay);
  const wrapped = obj(st.wrapped);
  const poolW = obj(st.poolW);
  const poolsX = obj(st.poolsX);
  const fees = obj(st.fees);
  const dep = readJ(path.join(NODE, "deposits-state.json")) || {};
  const grid = readJ(path.join(NODE, "grid98-state.json")) || {};
  const harv = readJ(path.join(NODE, "harvest-cursor.json")) || {};
  const sec = readJ(path.join(NODE, "security-state.json")) || {};
  const root = readJ(path.join(NODE, "state-root.json")) || {};
  const fails = readJ(path.join(NODE, "relay-fails.json")) || {};
  const senders = readJ(path.join(NODE, "relay-senders.json")) || {};
  const book = readJ(path.join(NODE, "chain.json")) || {};
  const bookBlocks = Array.isArray(book.blocks) ? (book.blocks as unknown[]) : [];

  const [tron, broker, fleet] = await Promise.all([
    tronNowBlock(),
    brokerHealth(),
    Promise.resolve(fleetFromGuardianLog()),
  ]);

  const wrappedList = Object.entries(wrapped)
    .map(([sym, v]) => {
      const o = obj(v);
      return {
        sym,
        locked: num(o.locked),
        supply: num(o.supply),
        redeemed: num(o.redeemed),
        unlocked: num(o.unlocked),
        refs: Object.keys(obj(o.refs)).length,
      };
    })
    .sort((a, b) => b.supply - a.supply);

  const poolsList = Object.entries(poolsX).map(([pair, v]) => {
    const o = obj(v);
    return {
      pair,
      a: num(o.a),
      b: num(o.b),
      lp: num(o.lpSupply),
      feeBps: num(o.feeBps),
      symA: String(o.symA || pair.split("/")[0]),
      symB: String(o.symB || pair.split("/")[1]),
    };
  });

  const rpcHealth = Object.entries(obj(dep.rpcHealth)).map(([chain, v]) => {
    const o = obj(v);
    return { chain, ok: o.ok === true, at: String(o.at || "") };
  });

  const events = Array.isArray(dep.events) ? (dep.events as J[]).slice(-9).reverse() : [];
  const relayOpen = Array.isArray(relay.open) ? (relay.open as J[]) : (Object.values(obj(relay.open)) as J[]);
  const openList = relayOpen.slice(0, 8).map((r) => ({
    ref: String(r.ref || ""),
    via: String(r.via || ""),
    act: String(r.act || ""),
    status: String(r.status || ""),
    txid: r.txid ? String(r.txid) : null,
    chain: String(obj(r.payload).chain || ""),
  }));

  const leaderboard = Array.isArray(grid.leaderboard)
    ? (grid.leaderboard as J[]).slice(0, 6).map((l) => ({ name: String(l.name || ""), pnlµ: num(l["pnlµ"]) }))
    : [];

  const body: J = {
    ok: true,
    at: new Date().toISOString(),
    meta: {
      issuer: String(meta.issuer || "headcorner"),
      supply: num(meta.supply),
      saosHeight: num(meta.height) || num(snapJ?.height),
      lastHeartbeat: String(meta.lastHeartbeat || ""),
      lastTime: String(meta.lastTime || ""),
    },
    root: { height: num(root.height), promotedAt: String(root.promotedAt || "") },
    tron,
    broker: { alive: broker.alive, doors: broker.doors, addresses: broker.addresses.slice(0, 8) },
    registryDoors: registryCount(),
    fleet,
    relay: { sent: num(relay.sent), issued: num(relay.issued), open: relayOpen.length, openList },
    wrapped: wrappedList,
    pools: {
      poolW: { saos: num(poolW.saos), wtrx: num(poolW.wtrx), lp: num(poolW.lpSupply), feeBps: num(poolW.feeBps) },
      poolsX: poolsList,
    },
    fees,
    deposits: {
      tick: num(dep.tick),
      lastTickAt: String(dep.lastTickAt || ""),
      minted: num(dep.minted),
      eventsCount: Array.isArray(dep.events) ? dep.events.length : 0,
      events,
      rpcHealth,
      chainsOk: rpcHealth.filter((c) => c.ok).length,
      chainsTotal: rpcHealth.length,
    },
    grid: {
      at: String(grid.at || ""),
      ticks: num(grid.ticks),
      rounds: num(grid.rounds),
      tradesToday: num(grid.tradesToday),
      txsToday: num(grid.txsToday),
      treasuryPnlµ: num(grid["treasuryPnlµ"]),
      treasuryPnlTodayµ: num(grid["treasuryPnlTodayµ"]),
      leaderboard,
    },
    harvest: {
      feesTotalµ: num(harv["feesTotalµ"]),
      releases: num(harv.releases),
      railCredited: num(harv.railCredited),
      gridFeeµ: num(harv.gridFeeµ),
    },
    shield: {
      stats: obj(sec.stats),
      deny: Array.isArray(sec.deny) ? (sec.deny as string[]) : [],
      allow: Array.isArray(sec.allow) ? (sec.allow as string[]) : [],
      velocity: Array.isArray(sec.velocity) ? sec.velocity.length : 0,
    },
    book: { head: num(snapJ?.height) || bookBlocks.length },
    relayOps: {
      failsCount: Object.keys(obj(fails.fails ?? fails)).length,
      senders: obj(senders.pick ? { pick: senders.pick } : {}),
      lastPick: obj(senders.pick),
      degraded: senders.degraded === true,
    },
  };

  return body;
}

function refreshAsync(): void {
  if (refreshing) return;
  refreshing = buildBody()
    .then((body) => {
      cache = { at: Date.now(), body };
    })
    .catch(() => {
      /* כנות — מטמון-קיים נשאר */
    })
    .finally(() => {
      refreshing = null;
    });
}

export async function GET() {
  const age = cache ? Date.now() - cache.at : Infinity;
  if (age < TTL) return NextResponse.json(cache!.body);
  if (age < STALE_MS) {
    // SWR: הגש-מיידי-ישן · רענן-ברקע (הייה קרה ~800ms — נמדד ב-dev.log)
    refreshAsync();
    return NextResponse.json(cache!.body);
  }
  const body = await buildBody();
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
