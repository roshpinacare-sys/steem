/**
 * T-60 vector suite — the heartbeat & dead-capital laws (lib.mjs):
 *   gridWatchdogLaw — the silent-death killer (reload-orphaned tick mutex,
 *     measured live 20:02:30Z → 30+ min of zero ticks under running:true).
 *   driftReclaimLaw — the dead-capital unlock (TODO #1): quotes outside the
 *     measured 24h envelope with age > 6h are provably unfillable.
 * Pure laws only — no chain, no state writes. Live-measured pins from the
 * 2026-10-03 headcorner book (18 open orders, envelope 0.103916/0.097826).
 */
import { gridWatchdogLaw, driftReclaimLaw, RECLAIM_MIN_AGE_MS, WATCHDOG_STALE_TICKS } from "./lib.mjs";

export async function run({ eq, ok }) {
  /* ── §A gridWatchdogLaw — verdicts, thresholds, TZ law ─────────────────── */
  const NOW = Date.parse("2026-10-03T20:32:31.039Z");
  const DEAD = "2026-10-03T20:02:30.039Z";
  eq("wd kick on dead loop", gridWatchdogLaw({ lastTickAt: DEAD, running: true, now: NOW }),
    { verdict: "KICK", staleMs: 1801000, kickMs: 90000 });
  eq("wd ok on fresh tick", gridWatchdogLaw({ lastTickAt: DEAD, running: true, now: Date.parse("2026-10-03T20:02:33.039Z") }),
    { verdict: "OK", staleMs: 3000, kickMs: 90000 });
  eq("wd boundary exact-90s is OK", gridWatchdogLaw({ lastTickAt: "2026-10-03T20:31:01.000Z", running: true, now: Date.parse("2026-10-03T20:32:31.000Z") }).verdict,
    "OK");
  eq("wd boundary +1ms kicks", gridWatchdogLaw({ lastTickAt: "2026-10-03T20:31:00.999Z", running: true, now: Date.parse("2026-10-03T20:32:31.000Z") }).verdict,
    "KICK");
  eq("wd idle when not running", gridWatchdogLaw({ lastTickAt: DEAD, running: false, now: NOW }).verdict,
    "IDLE");
  eq("wd idle refuses undefined running", gridWatchdogLaw({ lastTickAt: DEAD, now: NOW }).verdict,
    "IDLE");
  eq("wd no-evidence on null", gridWatchdogLaw({ lastTickAt: null, running: true, now: NOW }),
    { verdict: "NO-EVIDENCE", staleMs: null, kickMs: null });
  eq("wd no-evidence on junk", gridWatchdogLaw({ lastTickAt: "garbage", running: true, now: NOW }).verdict,
    "NO-EVIDENCE");
  eq("wd no-evidence on number", gridWatchdogLaw({ lastTickAt: 1801000, running: true, now: NOW }).verdict,
    "NO-EVIDENCE");
  eq("wd naive timestamp gets Z law", gridWatchdogLaw({ lastTickAt: "2026-10-03T20:02:30.039", running: true, now: NOW }).staleMs,
    1801000);
  eq("wd custom tickMs scales threshold", gridWatchdogLaw({ lastTickAt: DEAD, running: true, now: NOW, tickMs: 10000 }).kickMs,
    300000);
  eq("wd junk tickMs falls back", gridWatchdogLaw({ lastTickAt: DEAD, running: true, now: NOW, tickMs: -5 }).kickMs,
    90000);
  eq("wd custom staleTicks", gridWatchdogLaw({ lastTickAt: DEAD, running: true, now: NOW, staleTicks: 60 }).kickMs,
    180000);
  eq("wd frozen constants", [WATCHDOG_STALE_TICKS, RECLAIM_MIN_AGE_MS], [30, 21600000]);
  ok("wd inputs not mutated", (() => {
    const inp = Object.freeze({ lastTickAt: DEAD, running: true, now: NOW });
    gridWatchdogLaw(inp);
    return inp.lastTickAt === DEAD && inp.running === true && inp.now === NOW;
  })());

  /* ── §B driftReclaimLaw — the LIVE-MEASURED 18-order book (2026-10-03) ──── */
  const T = (h, m, s) => `2026-10-03T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const LIVE18 = [
    { orderid: 1790996080, side: "ask", unit: 0.104661, created: T(2, 54, 42) },
    { orderid: 1790996081, side: "ask", unit: 0.104661, created: T(2, 54, 42) },
    { orderid: 1790996082, side: "ask", unit: 0.104661, created: T(2, 54, 42) },
    { orderid: 1790996083, side: "ask", unit: 0.104661, created: T(2, 54, 42) },
    { orderid: 1790996084, side: "ask", unit: 0.104661, created: T(2, 54, 42) },
    { orderid: 1791050734, side: "ask", unit: 0.101171, created: T(18, 5, 33) },
    { orderid: 1791050735, side: "ask", unit: 0.101576, created: T(18, 5, 33) },
    { orderid: 1791050736, side: "ask", unit: 0.101983, created: T(18, 5, 33) },
    { orderid: 1791050737, side: "ask", unit: 0.102389, created: T(18, 5, 33) },
    { orderid: 1791050738, side: "bid", unit: 10.04, created: T(18, 5, 33) },
    { orderid: 1791050739, side: "bid", unit: 10.08, created: T(18, 5, 33) },
    { orderid: 1791056833, side: "ask", unit: 0.100515, created: T(19, 50, 0) },
    { orderid: 2026100304, side: "ask", unit: 0.105072, created: T(2, 51, 0) },
    { orderid: 2026100391, side: "bid", unit: 10.277637, created: T(13, 35, 0) },
    { orderid: 2026100392, side: "bid", unit: 10.298168, created: T(13, 35, 0) },
    { orderid: 2026100393, side: "bid", unit: 10.339861, created: T(13, 35, 0) },
    { orderid: 2026100394, side: "bid", unit: 10.423879, created: T(13, 35, 0) },
    { orderid: 2026100395, side: "bid", unit: 10.59602, created: T(13, 35, 0) },
  ];
  const NOWB = Date.parse("2026-10-03T20:35:00Z");
  const ENV = { priceMax: 0.103916, priceMin: 0.097826 };
  const full = driftReclaimLaw({ orders: LIVE18, now: NOWB, ...ENV });
  eq("live18 reclaim ids exactly the 11 dead", full.reclaim.map((r) => r.orderid),
    [1790996080, 1790996081, 1790996082, 1790996083, 1790996084, 2026100304, 2026100391, 2026100392, 2026100393, 2026100394, 2026100395]);
  eq("live18 keep ids the 7 living", full.keep.map((r) => r.orderid),
    [1791050734, 1791050735, 1791050736, 1791050737, 1791050738, 1791050739, 1791056833]);
  eq("live18 reason dead-capital", full.reason, "dead-capital");
  eq("live18 envelope echoed", full.envelope, { priceMax: 0.103916, priceMin: 0.097826 });
  eq("dead ask row full pin (drift 72 over 24h high)", full.reclaim.find((r) => r.orderid === 1790996080),
    { orderid: 1790996080, side: "ask", unit: 0.104661, price: 0.104661, driftBps: 72, ageMs: 63618000, why: "outside-measured-envelope" });
  eq("dead bid row full pin (inverted unit → 0.094375, 353 under low)", full.reclaim.find((r) => r.orderid === 2026100395),
    { orderid: 2026100395, side: "bid", unit: 10.59602, price: 0.094375, driftBps: 353, ageMs: 25200000, why: "outside-measured-envelope" });
  eq("inside-envelope deep bid kept (unit 10.04 → 0.099602)", full.keep.find((r) => r.orderid === 1791050738).orderid,
    1791050738);
  ok("age gate: dead price but young order survives", (() => {
    const young = driftReclaimLaw({
      orders: [{ orderid: 99, side: "ask", unit: 0.105072, created: T(18, 35, 0) }],
      now: NOWB, ...ENV,
    });
    return young.reclaim.length === 0 && young.keep.length === 1 && young.reason === "none-dead";
  })());
  ok("bid unit inversion is the law (1/unit < min ⇒ dead)", (() => {
    const r = driftReclaimLaw({ orders: [{ orderid: 5, side: "bid", unit: 12.5, created: T(1, 0, 0) }], now: NOWB, ...ENV });
    return r.reclaim.length === 1 && r.reclaim[0].price === 0.08 && r.reclaim[0].driftBps === 1822;
  })());
  ok("bid inside envelope kept (1/unit within [min,max])", (() => {
    const r = driftReclaimLaw({ orders: [{ orderid: 6, side: "bid", unit: 9.8, created: T(1, 0, 0) }], now: NOWB, ...ENV });
    return r.reclaim.length === 0 && r.keep.length === 1;
  })());
  eq("no envelope evidence refuses", driftReclaimLaw({ orders: LIVE18, now: NOWB, priceMax: null, priceMin: 0.097826 }).reason,
    "no-envelope-evidence");
  eq("inverted envelope refuses", driftReclaimLaw({ orders: LIVE18, now: NOWB, priceMax: 0.05, priceMin: 0.097826 }).reason,
    "no-envelope-evidence");
  eq("zero minAge refuses", driftReclaimLaw({ orders: LIVE18, now: NOWB, ...ENV, minAgeMs: 0 }).reason,
    "bad-thresholds");
  eq("non-array orders refuses", driftReclaimLaw({ orders: "junk", now: NOWB, ...ENV }).reason,
    "no-orders-evidence");
  ok("junk rows ride keep, never crash", (() => {
    const r = driftReclaimLaw({ orders: [null, {}, { orderid: -1, side: "ask", unit: 5, created: T(1, 0, 0) }, { orderid: 7, side: "sideways", unit: 1, created: T(1, 0, 0) }, { orderid: 8, side: "ask", unit: "x", created: T(1, 0, 0) }], now: NOWB, ...ENV });
    return r.reclaim.length === 0 && r.keep.length === 4 && r.reason === "none-dead"; // null row is skipped, not kept
  })());
  ok("hyper-space ids excluded (own TTL law owns them)", (() => {
    const r = driftReclaimLaw({ orders: [{ orderid: 2100000944, side: "ask", unit: 0.106, created: T(1, 0, 0) }], now: NOWB, ...ENV, hyperSpace: (id) => id >= 2100000000 });
    return r.reclaim.length === 0 && r.keep.length === 1;
  })());
  ok("no hyper fn supplied → no exclusion", (() => {
    const r = driftReclaimLaw({ orders: [{ orderid: 2100000944, side: "ask", unit: 0.106, created: T(1, 0, 0) }], now: NOWB, ...ENV });
    return r.reclaim.length === 1;
  })());
  ok("future created → keep (negative age)", (() => {
    const r = driftReclaimLaw({ orders: [{ orderid: 9, side: "ask", unit: 0.106, created: "2026-10-04T00:00:00Z" }], now: NOWB, ...ENV });
    return r.reclaim.length === 0 && r.keep.length === 1;
  })());
  ok("naive created gets Z law (same verdict either way)", (() => {
    const a = driftReclaimLaw({ orders: [{ orderid: 10, side: "ask", unit: 0.104661, created: T(2, 54, 42) }], now: NOWB, ...ENV });
    const b = driftReclaimLaw({ orders: [{ orderid: 10, side: "ask", unit: 0.104661, created: T(2, 54, 42) + "Z" }], now: NOWB, ...ENV });
    return a.reclaim.length === 1 && b.reclaim.length === 1 && a.reclaim[0].ageMs === b.reclaim[0].ageMs;
  })());
  eq("now junk falls back to Date.now (no crash)", Number.isFinite(driftReclaimLaw({ orders: [], now: "x", ...ENV }).reclaim.length), true);

  /* ── §C partition & immutability seams ──────────────────────────────────── */
  ok("reclaim+keep partitions the whole book", full.reclaim.length + full.keep.length === LIVE18.length);
  ok("law never mutates the caller's orders", (() => {
    const snapshot = JSON.stringify(LIVE18);
    driftReclaimLaw({ orders: LIVE18, now: NOWB, ...ENV });
    return JSON.stringify(LIVE18) === snapshot;
  })());
  ok("keep rows carry the original evidence untouched", (() => {
    const kept = full.keep.find((r) => r.orderid === 1791056833);
    return kept.unit === 0.100515 && kept.created === "2026-10-03T19:50:00" && kept.side === "ask";
  })());
}
