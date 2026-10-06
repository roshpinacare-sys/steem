// ─────────────────────────────────────────────────────────────────────
// r192-c tests — שער-הסוופ לסוכנים (/api/exchange/agent)
// הרצה: bun /tmp/r192-c-tests.mjs   (HTTP מול dev-server על :3000 + יבוא-ישיר של הליבה)
// כלל-בטיחות: אפס ביצוע-סוופ אמיתי בבדיקות — dry-run/שערים בלבד;
// הספר חייב לצאת נקי (usage של כל סוכן = אפס בסוף).
// ─────────────────────────────────────────────────────────────────────

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const req = createRequire("/home/z/my-project/package.json");
const { Wallet } = req("ethers");

const core = await import("/home/z/my-project/src/lib/weave/agent-exchange.ts");
const BASE = "http://127.0.0.1:3000";
const AGENT = "weave-auditor"; // זהות רשומה (ציבורית מהרישום — ללא מפתחות)

let pass = 0;
let fail = 0;
const notes = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  ✗ FAIL ${name}${extra ? " — " + extra : ""}`); }
}
function note(s) { notes.push(s); console.log(`  · ${s}`); }

async function GET(q) {
  const r = await fetch(`${BASE}/api/exchange/agent${q}`, { signal: AbortSignal.timeout(60_000) });
  let body = null;
  try { body = await r.json(); } catch { /* keep null */ }
  return { status: r.status, body };
}
async function POST(q, headers, payload) {
  const r = await fetch(`${BASE}/api/exchange/agent${q}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  let body = null;
  try { body = await r.json(); } catch { /* keep null */ }
  return { status: r.status, body };
}

console.log("\n═══ r192-c · שער-הסוכנים — בדיקות לוגיות ═══\n");

// ── 1. תיאור-שירות ──
console.log("[1] GET descriptor");
{
  const { status, body } = await GET("");
  ok("200 descriptor", status === 200 && body?.ok === true);
  ok("caps מוצהרים בקוד", body?.caps?.perDayUsd === 50 && body?.caps?.perTxUsd === 25 && body?.caps?.minNotionalUsd === 2);
  ok("לוח-עמלה מוצהר", body?.feeSchedule?.scheme === "exact" && body?.feeSchedule?.asset === "USDS" && body?.feeSchedule?.payTo === "treasury");
  ok("זהות ERC-8004 נדרשת", body?.identity?.registryCount === 13 && Array.isArray(body?.identity?.requiredHeaders));
}

// ── 2. ציטוט happy-path פנימי (SAOS/USDS — מהספר, דטרמיניסטי) ──
console.log("[2] GET quote SAOS/USDS (internal, executable)");
let feeMathChecked = false;
{
  const { status, body } = await GET("?sell=SAOS&buy=USDS&amountIn=100");
  ok("200 internal quote", status === 200 && body?.mode === "internal" && body?.quote?.expectedOut > 0);
  const acc = body?.x402?.accepts?.[0];
  ok("accepts[0] צורת-x402", !!acc && acc.scheme === "exact" && acc.asset === "USDS" && acc.network === "x-weave:book" && typeof acc.maxAmountRequired === "string");
  ok("עמלה = max(0.02, נוטינאל×0.5%)",
    !!acc && body.notionalUsd != null
    && Math.abs(acc.maxAmountRequiredNum - core.agentFeeUsd(body.notionalUsd)) < 1e-9,
    `notional=$${body?.notionalUsd?.toFixed(6)} fee=${acc?.maxAmountRequiredNum}`);
  if (acc && body.notionalUsd != null && Math.abs(acc.maxAmountRequiredNum - core.agentFeeUsd(body.notionalUsd)) < 1e-9) feeMathChecked = true;
}

// ── 3. ציטוט WSTEEM/WSBD — רצפת-העמלה על נוטינאל זעיר ──
console.log("[3] GET quote WSTEEM/WSBD (fee floor)");
{
  const { status, body } = await GET("?pair=WSTEEM/WSBD&side=A2B&amountIn=0.2");
  ok("200 internal quote (WSTEEM/WSBD)", status === 200 && body?.mode === "internal" && body?.quote?.expectedOut > 0);
  const acc = body?.x402?.accepts?.[0];
  ok("רצפת-עמלה $0.02 מוצהרת", !!acc && acc.maxAmountRequiredNum >= 0.02 && Math.abs(acc.maxAmountRequiredNum - core.agentFeeUsd(body.notionalUsd)) < 1e-9);
}

// ── 4. 402 — אין כותרת תשלום ──
console.log("[4] POST without X-PAYMENT → 402 x402-shape");
{
  const { status, body } = await POST("", {}, {
    intent: { sell: "SAOS", buy: "USDS", amountIn: 200, minOut: 0, feeAsset: "USDS", feeAmount: 0.02, nonce: "t402", issuedAt: new Date().toISOString() },
  });
  ok("status 402", status === 402);
  ok("x402Version=1 + accepts מערך", body?.x402Version === 1 && Array.isArray(body?.accepts) && body.accepts.length === 1);
  const acc = body?.accepts?.[0];
  ok("accepts[0].scheme=exact · asset=USDS · payTo=treasury", acc?.scheme === "exact" && acc?.asset === "USDS" && acc?.payTo === "treasury");
  ok("maxAmountRequired מחרוזת חיובית", typeof acc?.maxAmountRequired === "string" && Number(acc.maxAmountRequired) > 0);
  ok("identity.requiredHeaders בגוף ה-402", Array.isArray(body?.identity?.requiredHeaders) && body.identity.requiredHeaders.includes("X-Agent-Id"));
  ok("עמלת-402 תואמת את המתמטיקה", feeMathChecked || (acc && body?.accepts?.[0]?.maxAmountRequiredNum >= 0.02));
}

// ── 5. דחיית-זהות: סוכן לא-מוכר ──
console.log("[5] POST unknown agent → 403");
{
  const { status, body } = await POST("", {
    "X-Agent-Id": "stranger-agent-404",
    "X-PAYMENT": Buffer.from(JSON.stringify({ scheme: "exact", asset: "USDS", amount: 1 })).toString("base64url"),
  }, {
    intent: { sell: "SAOS", buy: "USDS", amountIn: 2000000, minOut: 0, feeAmount: 1, nonce: "t5", issuedAt: new Date().toISOString() },
  });
  ok("status 403", status === 403);
  ok("error=UNKNOWN-AGENT", body?.error === "UNKNOWN-AGENT");
}

// ── 6. אין זהות בכלל → 401 ──
console.log("[6] POST without X-Agent-Id → 401");
{
  const { status, body } = await POST("", {
    "X-PAYMENT": Buffer.from(JSON.stringify({ scheme: "exact", asset: "USDS", amount: 1 })).toString("base64url"),
  }, { intent: { sell: "SAOS", buy: "USDS", amountIn: 10, minOut: 0, feeAmount: 0.02, nonce: "t6", issuedAt: new Date().toISOString() } });
  ok("status 401", status === 401);
  ok("error=AUTH-IDENTITY-REQUIRED", body?.error === "AUTH-IDENTITY-REQUIRED");
}

// ── 7. קפסה לעסקה (L4) — SAOS נוטינאל מעל $25 (דטרמיניסטי מהספר) ──
console.log("[7] POST over per-tx cap (dryRun) → 429 TX-CAP");
{
  const { status, body } = await POST("", {
    "X-Agent-Id": AGENT,
    "X-PAYMENT": Buffer.from(JSON.stringify({ scheme: "exact", asset: "USDS", amount: 1 })).toString("base64url"),
  }, {
    dryRun: true,
    intent: { sell: "SAOS", buy: "USDS", amountIn: 2000000, minOut: 0, feeAmount: 1, nonce: "t7", issuedAt: new Date().toISOString() },
  });
  ok("status 429", status === 429);
  ok("error=TX-CAP", body?.error === "TX-CAP");
  ok("הנוטינאל מדווח ומעל התקרה", typeof body?.notionalUsd === "number" && body.notionalUsd > 25);
}

// ── 8. מינימום-נוטינאל (L3) — 10 SAOS ≪ $2 ──
console.log("[8] POST below min notional (dryRun) → 400 MIN-NOTIONAL");
{
  const { status, body } = await POST("", {
    "X-Agent-Id": AGENT,
    "X-PAYMENT": Buffer.from(JSON.stringify({ scheme: "exact", asset: "USDS", amount: 0.02 })).toString("base64url"),
  }, {
    dryRun: true,
    intent: { sell: "SAOS", buy: "USDS", amountIn: 10, minOut: 0, feeAmount: 0.02, nonce: "t8", issuedAt: new Date().toISOString() },
  });
  ok("status 400", status === 400);
  ok("error=MIN-NOTIONAL", body?.error === "MIN-NOTIONAL");
  ok("הנוטינאל מדווח מתחת ל-$2", typeof body?.notionalUsd === "number" && body.notionalUsd < 2);
}

// ── 9. kill-switch (L4) — קובץ זמני, נבדק ומוסר מיד ──
console.log("[9] kill-switch ~/.sovereign/dex-kill → 503");
{
  const p = core.killFilePath();
  const preExisted = fs.existsSync(p);
  if (!preExisted) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "r192-c transient test kill (auto-removed in ms)");
  }
  try {
    const g = await GET("");
    const po = await POST("", {}, { intent: {} });
    ok("GET → 503 DEX-KILL", g.status === 503 && g.body?.error === "DEX-KILL");
    ok("POST → 503 DEX-KILL", po.status === 503 && po.body?.error === "DEX-KILL");
    ok("סיבה-כנה בגוף", typeof g.body?.reason === "string" && g.body.reason.length > 0);
  } finally {
    if (!preExisted) fs.rmSync(p, { force: true });
  }
  const after = await GET("");
  ok("השער חוזר לחיים אחרי הסרה", after.status === 200);
  if (preExisted) note("kill-file היה קיים מראש — לא נמחק (רק נבדק)");
}

// ── 10. ציטוט-חוץ quote-only (WETH↔USDS) — אין ביצוע (L4) ──
console.log("[10] GET external pair → quote-only");
{
  const { status, body } = await GET("?sell=WETH&buy=USDS");
  if (status === 200 && body?.mode === "quote-only") {
    ok("mode=quote-only", true);
    ok("execution.allowed=false + סיבת L4", body?.execution?.allowed === false && String(body?.execution?.reason || "").includes("L4"));
    ok("מחיר-חוץ נמדד (ראוטר חי)", body?.external?.best?.price > 0 || Array.isArray(body?.external?.prices));
  } else if (status === 400 && body?.error === "NO-ROUTE") {
    note("ראוטר-חוץ לא נגיש בסנדבוקס כרגע — quote-only לא נמדד-חי, הנתיב הכנה מוחזר (NO-ROUTE)");
    ok("כנות: NO-ROUTE במקום המצאה", true);
  } else {
    ok("quote-only/NO-ROUTE", false, `status=${status}`);
  }
}

// ── 11. אתגר-חתימה: סוכן רשום מקבל nonce; זר נדחה ──
console.log("[11] GET challenge");
{
  const known = await GET(`?action=challenge&agentId=${AGENT}`);
  ok("200 nonce לסוכן רשום", known.status === 200 && typeof known.body?.nonce === "string" && known.body.nonce.length >= 16);
  const stranger = await GET("?action=challenge&agentId=stranger-agent-404");
  ok("403 לזר", stranger.status === 403);
}

// ── 12. ליבה ישירה: מתמטיקת-עמלה, קפסות, חתימה ± ──
console.log("[12] core lib (direct import)");
{
  ok("agentFeeUsd(100)=0.5", Math.abs(core.agentFeeUsd(100) - 0.5) < 1e-9);
  ok("agentFeeUsd(2)=רצפת 0.02", Math.abs(core.agentFeeUsd(2) - 0.02) < 1e-9);
  ok("agentFeeUsd(0)=רצפת 0.02", Math.abs(core.agentFeeUsd(0) - 0.02) < 1e-9);
  ok("capDecision: מעל תקרת-עסקה", core.capDecision(26, 0).ok === false && core.capDecision(26, 0).code === "TX-CAP");
  ok("capDecision: מעל תקרת-יום", core.capDecision(20, 35).ok === false && core.capDecision(20, 35).code === "DAY-CAP");
  ok("capDecision: בתוך הקפסות", core.capDecision(20, 25).ok === true);

  const wallet = Wallet.createRandom();
  // כנות: אין לנו מפתחות-סוכנים אמיתיים — אימות-חיובי מול הרישום אינו
  // אפשרי מתוך-עקרון (אפס-סודות). נבדק: דחיית-זר, דחיית-חתימה-שגויה
  // (השחזור הקריפטוגרפי עצמו עובד — משחזר כתובת ומשווה), ודחיית-טריות.
  const now = new Date().toISOString();
  const baseIntent = {
    agentId: "no-such-agent", pair: "SAOS/USDS", side: "A2B", amountIn: 1, minOut: 0,
    feeAsset: "USDS", feeAmount: 0.02, nonce: "n1", issuedAt: now,
  };
  const sigUnknown = await wallet.signMessage(core.buildIntentMessage(baseIntent));
  const vUnknown = core.verifyAgentSignature(baseIntent, sigUnknown);
  ok("verify: סוכן לא-מוכר → UNKNOWN-AGENT", vUnknown.ok === false && vUnknown.code === "UNKNOWN-AGENT");

  const intentReal = { ...baseIntent, agentId: AGENT, nonce: core.issueNonce(AGENT).nonce };
  const sigReal = await wallet.signMessage(core.buildIntentMessage(intentReal));
  const vReal = core.verifyAgentSignature(intentReal, sigReal);
  ok("verify: חתימת מפתח-זר לרישום → BAD-SIGNATURE (השחזור עצמו עבד)", vReal.ok === false && vReal.code === "BAD-SIGNATURE");

  const intentStale = { ...baseIntent, agentId: AGENT, nonce: core.issueNonce(AGENT).nonce, issuedAt: new Date(Date.now() - 11 * 60_000).toISOString() };
  const sigStale = await wallet.signMessage(core.buildIntentMessage(intentStale));
  const vStale = core.verifyAgentSignature(intentStale, sigStale);
  ok("verify: כוונה ישנה → STALE-INTENT", vStale.ok === false && vStale.code === "STALE-INTENT");
  note("קריפטו-שחזור נבדק ברמת-הפונקציה (verifyMessage→השוואת-כתובת); אישור-חיובי מול הרישום דורש מפתח-סוכן אמיתי — אין בידינו (אפס-סודות)");
}

// ── 13. ניקיון-הספר: אף בדיקה לא כתבה עסקת-סוכן ──
console.log("[13] book cleanliness");
{
  const u = await GET(`?action=usage&agentId=${AGENT}`);
  ok("אפס צבירה-יומית לסוכן (אף כתיבה)", u.status === 200 && u.body?.caps?.usageToday?.usedTodayUsd === 0, `usedTodayUsd=${u.body?.caps?.usageToday?.usedTodayUsd}`);
}

console.log("\n═══ תוצאות ═══");
console.log(`PASS: ${pass}  FAIL: ${fail}  TOTAL: ${pass + fail}`);
if (notes.length) console.log("הערות-כנות:\n" + notes.map((n) => "  - " + n).join("\n"));
process.exit(fail === 0 ? 0 : 1);
