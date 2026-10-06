// ─────────────────────────────────────────────────────────────────────
// r193-tests — מצבת-בדיקות גל-ה-DEX הריבוני (ראוטר-עומק · גריד-מתנגד ·
// ארביטראז-רישתי · רגל-Blurt). ריצה: node sovereign/tmp/r193-tests.mjs
// ─────────────────────────────────────────────────────────────────────
const BASE = "http://127.0.0.1:3000";
const GRID = "http://127.0.0.1:3051";
const ARB = "http://127.0.0.1:3050";

let passed = 0;
const failed = [];
const t = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`  PASS ${name}`); }
  else { failed.push(name); console.log(`  FAIL ${name} ${extra}`); }
};

async function jget(url, ms = 20000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

// ── 1) מתמטיקה-טהורה: CPMM מול quoteSwap-החי ─────────────────────────
console.log("1) CPMM-מול-דלפק-חי");
const snap = await jget(`${BASE}/api/exchange`);
const wsteem = snap.pools.find((p) => p.pair === "WSTEEM/WSBD");
if (wsteem && wsteem.reserveA > 0 && wsteem.reserveB > 0) {
  const amt = wsteem.reserveA * 0.01; // 1% — בתוך-עומק
  const q = await jget(`${BASE}/api/exchange?with=quote&pair=WSTEEM/WSBD&side=A2B&amountIn=${amt}`);
  // quoteSwap: out = rOut·f·in/(rIn·10000+f·in)
  const f = 10000 - wsteem.feeBps;
  const expect = (wsteem.reserveB * amt * f) / (wsteem.reserveA * 10000 + amt * f);
  const got = q.quote?.expectedOut ?? -1;
  // הדלפק מעגל ל-µ-דיוק 1e9 (קנון-הספר) — סובלנות-2-יחידות-עיגול מוחלטת
  t("quoteSwap-==CPMM-יד", Math.abs(got - expect) < 2e-9, `got=${got} expect=${expect}`);
} else {
  t("בריכת-WSTEEM-קיימת-לבדיקה", false, "אבק");
}

// ── 2) ראוטר-העומק: מסלולים, כנות-עומק, רגלי-פדיון ───────────────────
console.log("2) ראוטר-העומק");
const plan1 = await jget(`${BASE}/api/exchange/plan?from=WSBD&to=STEEM&amountIn=1`);
t("plan-WSBD→STEEM-ok", plan1.ok === true);
t("plan-רגל-פדיון-קיימת", plan1.routes.some((r) => r.legs.some((l) => l.kind === "convert" && l.settleTimeSec === 302400)));
t("plan-ספר-חי-נקרא", (plan1.markets.steemBook || "").includes("חי"));
const bookRoute = plan1.routes.find((r) => r.legs.some((l) => l.kind === "book"));
t("plan-רגל-ספר-מדודה", !!bookRoute && bookRoute.outAmount > 0);
t("plan-refRate-חי", plan1.referenceRate != null && plan1.referenceRate > 0);
for (const r of plan1.routes) {
  t(`hops≤3:[${r.id}]`, r.legs.length <= 3);
  t(`out>0:[${r.id}]`, r.outAmount > 0);
  t(`legs-רציפים:[${r.id}]`, r.legs.every((l, i) => i === 0 || r.legs[i - 1].assetOut === l.assetIn));
}
t("plan-כנות-עומק-מפורשת", plan1.routes.some((r) => !r.executableNow && r.honesty.some((h) => h.includes("L1"))));

const plan2 = await jget(`${BASE}/api/exchange/plan?from=USDS&to=WSTEEM&amountIn=2`);
t("plan-USDS→WSTEEM-אבק-כנה", plan2.routes.length > 0 && plan2.routes.every((r) => r.executableNow === false || r.feasibleMaxIn != null));
if (plan2.split) t("split-עולה-על-היחיד", plan2.split.outAmount >= Math.max(...plan2.routes.map((r) => r.outAmount)) - 1e-9);

const plan3 = await jget(`${BASE}/api/exchange/plan?from=STEEM&to=HIVE&amountIn=5`);
t("plan-חוצה-רשתות-מודד", plan3.ok !== undefined); // חי-או-כנה-ריק — לא-קריסה
t("plan-הערת-Blurt-כנה", (plan3.markets.blurtBook || "").includes("אין"));

const planBad = await fetch(`${BASE}/api/exchange/plan?from=&to=`);
t("plan-400-בלי-פרמטרים", planBad.status === 400);

// ── 3) הגריד-המתנגד (dex-grid :3051) ─────────────────────────────────
console.log("3) הגריד-המתנגד");
const st = await jget(`${GRID}/selftest`);
t("selftest-23/23", st.ok === true && st.failed.length === 0, JSON.stringify(st.failed));
const gs = await jget(`${GRID}/status`);
t("מצב-מוצהר", ["dry", "live", "halted"].includes(gs.mode));
t("kill-כבוי", gs.killSwitch === false);
t("קפסות-L4-חיות", gs.caps && gs.caps.maxTxUsd > 0 && gs.caps.maxDailyVolumeUsd > 0);
t("oppose-נמדד-מהשכן", gs.oppose && gs.oppose.skew != null);
t("מרכז-פיד-חי", gs.centers && gs.centers["WSTEEM/WSBD"] && gs.centers["WSTEEM/WSBD"].value > 0.05 && gs.centers["WSTEEM/WSBD"].value < 0.2);
const gd = await jget(`${GRID}/grid`);
t("סולם-מפורסם", gd.ladder && gd.ladder["WSTEEM/WSBD"] && gd.ladder["WSTEEM/WSBD"].levels.length >= 3);
t("רמות-סימטריות-סביב-המרכז", (() => {
  const L = gd.ladder["WSTEEM/WSBD"];
  const c = L.center, s = L.stepPct;
  return Math.abs(L.levels[0].buy - c * (1 - s)) < 1e-12 && Math.abs(L.levels[0].sell - c * (1 + s)) < 1e-12;
})());
const gp = await jget(`${GRID}/pnl`);
t("PnL-ממילויים-בלבד-מוצהר", (gp.note || "").includes("L5"));
const proxy = await jget(`${BASE}/api/dex-grid`);
t("פרוקסי-ממשק-חי", proxy.ok === true && proxy.mode != null);

// ── 4) שוק-הארביטראז-הרישתי לסוכנים ─────────────────────────────────
console.log("4) ארביטראז-רישתי-לסוכנים");
const arb = await jget(`${BASE}/api/exchange/agent/arb`);
t("agent-arb-ok", arb.ok === true);
t("קפסות-מוצהרות", arb.caps && arb.caps.perTxUsd === 25 && arb.caps.dailyUsd === 50 && arb.caps.minNotionalUsd === 2);
t("מחזורים-פנימיים-נמדדים", Array.isArray(arb.internalCycles) && arb.internalCycles.length > 0);
t("מחזורי-אבק-כנים-שליליים", arb.internalCycles.every((c) => c.roundTripBps < 0)); // כנות: עמלות-גוברות-על-אבק
t("playbook-מבנה", Array.isArray(arb.playbook) && arb.playbook.every((p) => p.honesty.length > 0));
t("בלי-רגל-בת-ביצוע-מסומן-כנה", arb.playbook.every((p) => (p.executableLeg != null) || p.honesty.some((h) => h.includes("L5"))));

// ── 5) הגלאי — רגל-Blurt ─────────────────────────────────────────────
console.log("5) הגלאי-רגל-Blurt");
const as = await jget(`${ARB}/status`);
t("markets-blurt-נמדד", as.markets && ["ok", "empty", "fail"].includes(as.markets.blurt));
t("קריאה-בלבד-מוצהר", (as.mode || "").includes("READ-ONLY"));

// ── 6) יציבות-תחת-סכום-גדול ─────────────────────────────────────────
console.log("6) סכום-גדול-כנה");
const big = await jget(`${BASE}/api/exchange/plan?from=WSBD&to=STEEM&amountIn=5000`);
t("5000-WSBD-לא-קורס", big.ok !== undefined);
t("5000-מדווח-כנה-עומק", big.routes.every((r) => r.executableNow === false || r.feasibleMaxIn == null || r.feasibleMaxIn > 0));

// ── סיכום ────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} PASS · ${failed.length} FAIL ===`);
if (failed.length) { console.log("FAILED:", failed.join(" · ")); process.exit(1); }
