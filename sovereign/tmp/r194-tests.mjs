// ─────────────────────────────────────────────────────────────────────
// r194-tests — מצבת-בדיקות גל-r194 (הזרוע · מרכז-BLURT-חי · סדרת-הדלקה ·
// כוננות · מניפסט-MCP). ריצה: node sovereign/tmp/r194-tests.mjs
// ─────────────────────────────────────────────────────────────────────
const BASE = "http://127.0.0.1:3000";
const GRID = "http://127.0.0.1:3051";

let passed = 0;
const failed = [];
const t = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`  PASS ${name}`); }
  else { failed.push(name); console.log(`  FAIL ${name} ${extra}`); }
};

async function jget(url, ms = 25000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

// ── 1) הדיבון-החי: גרסה, הזרוע, מרכז-BLURT ───────────────────────────
console.log("1) דיבון-הגריד-המתנגד (:3051)");
const st = await jget(`${GRID}/status`);
t("גרסה-r194", String(st.version ?? "").includes("r194"), `version=${st.version}`);
t("configMode-armed", st.configMode === "armed", `configMode=${st.configMode}`);
t("אפס-שגיאות-חיות", st.lastError == null, `lastError=${st.lastError}`);
t("מרכז-BLURT-חי (היה-null)", st.centers?.["WBLURT/USDS"]?.value != null, JSON.stringify(st.centers?.["WBLURT/USDS"]));
t("מרכז-WSTEEM-חי", st.centers?.["WSTEEM/WSBD"]?.value != null);
const blurtCenter = st.centers?.["WBLURT/USDS"]?.value;
t("מרכז-BLURT-סביר-בגבולות", blurtCenter > 0.0001 && blurtCenter < 0.01, `value=${blurtCenter}`);

// ── 2) selftest מורחב ─────────────────────────────────────────────────
console.log("2) selftest-מורחב");
const st2 = await jget(`${GRID}/selftest`);
t("selftest-30/30", st2.ok === true && st2.passed >= 30 && st2.failed.length === 0, `passed=${st2.passed} failed=${JSON.stringify(st2.failed)}`);

// ── 3) סדרת-ההדלקה (drill) ────────────────────────────────────────────
console.log("3) סדרת-ההדלקה (/drill)");
const drill = await jget(`${GRID}/drill`);
t("drill-מובנה", drill.ok === true && Array.isArray(drill.checks) && drill.checks.length >= 9, `checks=${drill.checks?.length}`);
t("drill-verdict-ready", drill.verdict === "ready", `verdict=${drill.verdict} fails=${(drill.checks ?? []).filter((c) => !c.pass).map((c) => c.name).join(",")}`);
const quoteCheck = (drill.checks ?? []).find((c) => c.name === "quote-חי-A2B");
t("drill-quote-חי", quoteCheck?.pass === true, quoteCheck?.detail ?? "—");
const pnlCheck = (drill.checks ?? []).find((c) => c.name === "PnL-תיקון-מדומה");
t("drill-PnL-חיובי-מול-מרכז", pnlCheck?.pass === true, pnlCheck?.detail ?? "—");

// ── 4) כוננות (/ignite) — כנות: החוסם-היחיד-מותר-להיות-עומק ──────────
console.log("4) כוננות-ההדלקה (/ignite)");
const ig = await jget(`${GRID}/ignite`);
t("ignite-מובנה", ig.ok === true && typeof ig.ready === "boolean" && Array.isArray(ig.reasons));
t("ignite-sharshelet", ig.ignitionChain?.autoFlip?.length > 10 && Array.isArray(ig.ignitionChain?.fuelSources));
t("ignite-כתובות-קבלה", ig.receiveAddresses?.steem === "headcorner" && ig.receiveAddresses?.hive === "headcorner" && ig.receiveAddresses?.blurt === "headcorner" && String(ig.receiveAddresses?.tron ?? "").startsWith("TYV"));
t("ignite-כנות-עומק", ig.ready === false && ig.reasons.length >= 1 && /עומק/.test(ig.reasons.join(" ")), JSON.stringify(ig.reasons));
t("ignite-armed-משקף", ig.ignitionChain?.configMode === "armed");

// ── 5) ה-proxy-של-Next: drill/ignite דרך :3000 ────────────────────────
console.log("5) /api/dex-grid-proxy");
const px = await jget(`${BASE}/api/dex-grid?with=ignite`);
t("proxy-ignite", px.ok === true && typeof px.ready === "boolean");
const pxs = await jget(`${BASE}/api/dex-grid`);
t("proxy-status", pxs.ok === true && pxs.service === "dex-grid");

// ── 6) מניפסט-MCP לסוכני-AI ────────────────────────────────────────────
console.log("6) /api/exchange/mcp");
const mcp = await jget(`${BASE}/api/exchange/mcp`);
t("mcp-מובנה", mcp.mcp === "1.0" && mcp.server?.name === "sovereign-dex");
t("mcp-6-כלים", Array.isArray(mcp.tools) && mcp.tools.length === 6, `tools=${mcp.tools?.length}`);
t("mcp-דוגמאות-curl", mcp.tools.every((tool) => typeof tool.example === "string" && tool.example.startsWith("curl")));
t("mcp-חוקי-כנות", Array.isArray(mcp.resources?.honestyRules) && mcp.resources.honestyRules.length === 4);
t("mcp-כתובות", mcp.resources?.receiveAddresses?.steem === "headcorner");

// ── 7) רגרסיה: quote-WBLURT + ראוטר-עומק ──────────────────────────────
console.log("7) רגרסיה-ראוטר+ציטוט");
const qb = await jget(`${BASE}/api/exchange?with=quote&pair=${encodeURIComponent("WBLURT/USDS")}&side=A2B&amountIn=0.01`);
t("quote-WBLURT-חי", qb?.quote?.expectedOut > 0, JSON.stringify(qb?.quote));
const plan = await jget(`${BASE}/api/exchange/plan?from=USDS&to=WSTEEM&amountIn=2`);
t("plan-USDS→WSTEEM-רגרסיה", plan.ok === true && plan.routes.length > 0, `routes=${plan.routes?.length}`);
const arb = await jget(`${BASE}/api/exchange/agent/arb`);
t("arb-פלייבוק-רגרסיה", arb.ok === true && Array.isArray(arb.playbook));

// ── 8) שחזור-מצב: מוני-היום שרדו-עלייה (ticks המשיכו-מ-1010+) ─────────
console.log("8) שחזור-מצב");
t("ticks-שוחזרו-מהדיסק", st.ticks >= 1000, `ticks=${st.ticks}`);
t("realizedPnl-שמור", typeof st.realizedPnlUsd === "number");

// ── סיכום ─────────────────────────────────────────────────────────────
console.log(`\n═══ r194: ${passed} PASS · ${failed.length} FAIL ═══`);
if (failed.length) { console.log("נכשלו:", failed.join(" · ")); process.exit(1); }
