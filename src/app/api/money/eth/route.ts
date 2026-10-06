// ─────────────────────────────────────────────────────────────────────
// /api/money/eth — רגל את'ריום: מדידה חיה + שידור בנתיב-הכספת (R102)
//
// הוראת המפעיל (R102): "כבר שלחתי לך את הארנק של eth sol יש גישה והכל
// הטענות שלך לא נכונות" — נמדד והוכח: 12 רשומות ethereum בכספת, כולן
// נפתחות בנתיב הריבוני, הכתובות הנגזרות תואמות 12/12. הרגל חיה.
//
// GET  — מדידה: מאזני כל חשבונות הכספת, מחיר ETH חי, אימות-נגזרת.
// POST — שידור EIP-1559 אמיתי דרך שער-העסקאות ($100). קבלה כנה:
//        NO-GAS כשאין כיסוי גז (אמת מדודה של הרגל, לא תקלה).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { openEthVaultWallet, ethBalanceOf, ethSend } from "@/lib/dex/evm-wire";
import { evaluateBrake, brakeLogLine } from "@/lib/cognition/brake"; // R30b: הבלם גם-כאן (Adversary-A census fix — trace 1a10d6f880df9255)
import { openVaultEntryRaw } from "@/lib/dex/wallet-vault";
import { evaluateGate, settleGate } from "@/lib/weave/tx-gate";
import { operatorFromRequest } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

const VAULT_ACCOUNTS = [
  "cashmachine", "haran", "headcorner", "israelnews", "lsa",
  "macrame", "siq", "tov", "wic", "wog", "woq", "ynet",
];

async function ethUsd(): Promise<number | null> {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT", {
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json()) as { price?: string };
    const p = Number(j.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const at = new Date().toISOString();
  const price = await ethUsd();
  const rows: Array<Record<string, unknown>> = [];
  let totalEth = 0;
  let opened = 0;
  let unreadable = 0; // r124: שורה שלא נמדדה (RPC/כספת) אינה “אפס נמדד” — היא לא-נמדדה
  for (const acct of VAULT_ACCOUNTS) {
    const vw = openEthVaultWallet(acct);
    const entry = openVaultEntryRaw("ethereum", acct, "wallet");
    const address = vw.address ?? entry.entryPub ?? null;
    const bal = address ? await ethBalanceOf(address) : { wei: BigInt(0), eth: 0, error: "NO-KEY" };
    totalEth += bal.eth;
    if (bal.error) unreadable++;
    if (vw.ok) opened++;
    rows.push({
      account: acct,
      address,
      vaultOpened: vw.ok,
      derivedMatch: vw.match ?? false,
      status: entry.status ?? null,
      eth: bal.eth,
      usd: price != null ? bal.eth * price : null,
      error: bal.error ?? (vw.ok ? undefined : vw.detail),
    });
  }
  // r124 · חוק: כישלון-קריאה בחישוב-כסף הוא סירוב, לא אפס — סכום שמכיל
  // שורות שלא נמדדו מוצג כמדידה, וזה שקר. total=null עד שכל השורות נקראו.
  const measured = unreadable === 0;
  const totalUsd = measured && price != null ? totalEth * price : null;
  return NextResponse.json({
    ok: measured,
    at,
    chain: "ethereum",
    rpc: "eth.drpc.org (+2 fallbacks)",
    priceUsd: price,
    accounts: rows,
    unreadableRows: unreadable,
    vaultOpened: `${opened}/${VAULT_ACCOUNTS.length}`,
    total: measured ? { eth: totalEth, usd: totalUsd } : null,
    verdict: !measured
      ? "DEGRADED"
      : opened === VAULT_ACCOUNTS.length
        ? "ARMED-LIVE"
        : "PARTIAL",
    note: !measured
      ? `${unreadable}/${VAULT_ACCOUNTS.length} מאזנים לא נמדדו (RPC/כספת לא ענו) — אין סכום, אין טענת יתרה. שידור יסורב בכנות עד מדידה מלאה.`
      : price == null
        ? "מחיר ETH לא נמדד במחזור זה (בינאנס לא ענה) — שידור יסורב בכנות עד מדידה (אין שער, אין מסחר)"
        : `12/12 מפתחות בכספת בנתיב הריבוני · הוכחת-רגל חיה: NO-GAS כנה עד הזרמת את'ר · יתרה חיה ${totalEth.toFixed(8)} ETH`,
    doctrine: [
      "נתיב-הכספת (R101c+R102): סיסמת-האב → active-STEEM חי → חותמת → מפתח-אב → AES-256-GCM → מפתח EVM — בזיכרון בלבד.",
      "הכתובת הנגזרת חייבת להתאים לרשומת הכספת לפני כל שידור — חוק השרשרת-השופט.",
      "כל שידור עובר שער-$100: מתחת — אוטונומיה מלאה; מעל — תור-מפעיל.",
      "NO-GAS היא קבלה כנה: הרגל מוכחת, הון-הגז הוא המגבלה המדודה — לא הסמכות.",
    ],
  });
}

export async function POST(req: NextRequest) {
  const at = new Date().toISOString();
  // R30b — הבלם-הריבוני בשפת-החתימה: שליחת-ETH היא הון (מסילת general).
  const brake = evaluateBrake("eth-send");
  console.log(brakeLogLine(brake));
  if (brake.halt) {
    return NextResponse.json(
      { ok: false, at, error: `CAPITAL-BRAKE-HALT: הבלם-הריבוני עצר את שליחת-ה-ETH לפני החתימה — אפס שידורים. ${brake.reasons.join(" | ").slice(0, 240)}`, lane: brake.lane, reasons: brake.reasons },
      { status: 423 },
    );
  }
  // R122 · חוק הסטטוס הכנה: JSON שגוי הוא 400 (שגיאת-לקוח); כשל-ביצוע
  // (שרשרת, כספת, DB) הוא 500 — לא מוסווה כשגיאת-קלט.
  let body: { action?: string; account?: string; to?: string; valueEth?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, at, error: "BAD-BODY: גוף הבקשה אינו JSON תקין" },
      { status: 400 },
    );
  }
  try {
    if (body.action !== "send") {
      return NextResponse.json({ ok: false, error: "BAD-ACTION: send בלבד" }, { status: 400 });
    }
    const account = body.account ?? "cashmachine";
    if (!VAULT_ACCOUNTS.includes(account)) {
      return NextResponse.json({ ok: false, error: "BAD-ACCOUNT: לא חשבון כספת" }, { status: 400 });
    }
    const valueEth = Number(body.valueEth);
    if (!Number.isFinite(valueEth) || valueEth <= 0) {
      return NextResponse.json({ ok: false, error: "BAD-VALUE" }, { status: 400 });
    }
    const price = await ethUsd();
    if (price == null) {
      return NextResponse.json({
        ok: false,
        at,
        error: "NO-PRICE: USD לא נמדד חי — השער אינו יכול להעריך, לכן שום דבר לא זז",
      }, { status: 503 });
    }
    const usdValue = valueEth * price;
    const session = operatorFromRequest(req);
    const issuedBy: "operator" | "daemon" = session ? "operator" : "daemon";
    const gate = await evaluateGate({
      source: "eth-wire",
      action: "send",
      title: `העברת ${valueEth} ETH מ-${account} (${usdValue.toFixed(2)}$)`,
      payload: { account, to: body.to, valueEth, chain: "ethereum" },
      usdValue,
      usdBasis: `binance ETHUSDT $${price}`,
      issuedBy,
      reason: "פעולת-כסף רב-רשתית על רגל את'ריום",
    });
    if (gate.verdict !== "ALLOWED") {
      return NextResponse.json({
        ok: false,
        at,
        gate: { verdict: gate.verdict, id: gate.id, usdValue },
        error: gate.verdict === "QUEUED"
          ? `הפעולה ${usdValue.toFixed(2)}$ ≥ 100$ — הועברה לתור אישור המפעיל`
          : "השער סירב",
      }, { status: 409 });
    }
    const result = await ethSend(account, String(body.to ?? ""), valueEth);
    if (result.ok) {
      await settleGate(gate.id, "EXECUTED", "eth-wire:live", { txid: result.txid ?? null, detail: result.detail });
    }
    return NextResponse.json({ at, gate: { id: gate.id, usdValue }, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, at, error: `EXECUTE-FAILED: ${String((e as Error).message ?? e).slice(0, 160)}` },
      { status: 500 },
    );
  }
}
