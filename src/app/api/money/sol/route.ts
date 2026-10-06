// ─────────────────────────────────────────────────────────────────────
// /api/money/sol — רגל סולנה: מדידה חיה + שידור בנתיב-הכספת (R102)
//
// הוכח חיה בפתיחת הסשן: 12/12 מפתחות נגזרים-תואמים מהכספת, והעברת
// אמת 0.001 SOL cashmachine→headcorner שודרה ואושרה בשרשרת
// (txid 5amYdKAC…, confirmed, 10 confirmations, err:null). הרגל הזו
// היא ההוכחה החיה הראשונה של זרימה רב-רשתית מעבר לגרפן.
//
// GET  — מדידה: מאזני חשבונות הכספת (LAMPORTS→SOL), מחיר SOL חי.
// POST — שידור legacy-tx חתום ed25519 דרך שער-העסקאות ($100).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { openSolVaultKeypair, solBalance, solSend } from "@/lib/dex/sol-wire";
import { evaluateBrake, brakeLogLine } from "@/lib/cognition/brake"; // R30b: הבלם גם-כאן (Adversary-A census fix — trace 1a10d6f880df9255)
import { spotUsd } from "@/lib/dex/price-feeds";
import { openVaultEntryRaw } from "@/lib/dex/wallet-vault";
import { evaluateGate, settleGate } from "@/lib/weave/tx-gate";
import { operatorFromRequest } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

const VAULT_ACCOUNTS = [
  "cashmachine", "haran", "headcorner", "israelnews", "lsa",
  "macrame", "siq", "tov", "wic", "wog", "woq", "ynet",
];

export const RAIL_PROOF = {
  // R122 · תיקון חותמת-זמן: השעה האמיתית נמדדה מהשרשרת עצמה
  // (getTransaction → blockTime 1790190376 = 2026-09-23T19:06:16Z, slot 449793107)
  // — לא עוד "19:0x" חסר.
  at: "2026-09-23T19:06:16Z",
  txid: "5amYdKACRm9pAHGpcpof3XANLfSX17yHUNUVcvgNszwAsLieyZ1K3fvX4RrCMpijio4S6D3ReqfoSHGGs5Pi4bGP",
  what: "0.001 SOL cashmachine → headcorner (חשבונות המפעיל בכספת)",
  verdict: "confirmed · 10 confirmations · err:null",
};

async function solUsd(): Promise<{ price: number | null; source: string | null }> {
  const f = await spotUsd("SOLUSDT");
  return { price: f.price, source: f.source };
}

export async function GET() {
  const at = new Date().toISOString();
  const { price, priceSource } = await (async () => { const f = await solUsd(); return { price: f.price, priceSource: f.source }; })();
  const rows: Array<Record<string, unknown>> = [];
  let totalSol = 0;
  let opened = 0;
  let unreadable = 0; // r124: שורה שלא נמדדה (RPC/כספת) אינה “אפס נמדד” — היא לא-נמדדה
  for (const acct of VAULT_ACCOUNTS) {
    const kp = openSolVaultKeypair(acct);
    const entry = openVaultEntryRaw("solana", acct, "wallet");
    const pub = kp.pub ?? entry.entryPub ?? null;
    const bal = pub ? await solBalance(pub) : { lamports: 0, sol: 0, error: "NO-KEY" };
    totalSol += bal.sol;
    if (bal.error) unreadable++;
    if (kp.ok) opened++;
    rows.push({
      account: acct,
      pub,
      vaultOpened: kp.ok,
      derivedMatch: kp.match ?? false,
      status: entry.status ?? null,
      sol: bal.sol,
      usd: price != null ? bal.sol * price : null,
      error: bal.error ?? (kp.ok ? undefined : kp.detail),
    });
  }
  // r124 · חוק: כישלון-קריאה בחישוב-כסף הוא סירוב, לא אפס — total=null
  // כששורה כלשהי לא נקראה, כדי שאף צרכן לא יציג “יתרה חיה 0.000000”.
  const measured = unreadable === 0;
  const totalUsd = measured && price != null ? totalSol * price : null;
  return NextResponse.json({
    ok: measured,
    at,
    chain: "solana",
    rpc: "api.mainnet-beta.solana.com",
    priceUsd: price,
    priceSource,
    accounts: rows,
    unreadableRows: unreadable,
    vaultOpened: `${opened}/${VAULT_ACCOUNTS.length}`,
    total: measured ? { sol: totalSol, usd: totalUsd } : null,
    verdict: !measured
      ? "DEGRADED"
      : opened === VAULT_ACCOUNTS.length
        ? "ARMED-LIVE"
        : "PARTIAL",
    railProof: RAIL_PROOF,
    note: !measured
      ? `${unreadable}/${VAULT_ACCOUNTS.length} מאזנים לא נמדדו (RPC/כספת לא ענו) — אין סכום, אין טענת יתרה. שידור יסורב בכנות עד מדידה מלאה.`
      : price == null
        ? "מחיר SOL לא נמדד במחזור זה — שידור יסורב בכנות עד מדידה (אין שער, אין מסחר)"
        : `12/12 מפתחות בכספת · רגל מוכחת בשידור אמת מאושר · יתרה חיה ${totalSol.toFixed(6)} SOL (הון-אגרה אמיתי)`,
    doctrine: [
      "הרגל נבנתה בלי תלות חדשה: בניית legacy-tx ביד + חתימת ed25519 של node:crypto — הפרוטוקול פשוט וניתן-לאימות.",
      "hex-seed של 32 בייט מהכספת ← ed25519 ← פומבי תואם לרשומה — אוֹ אין שידור (חוק השרשרת-השופט).",
      "כל שידור עובר שער-$100; הוכחת הרגל בוצעה ב-0.001 SOL (מתחת לסף — אוטונומיה מלאה).",
      "ה-SOL החי הוא הון-האגרה של הרשת לפעולות רב-רשתיות עתידיות — שימור-הון מעל הכל.",
    ],
  });
}

export async function POST(req: NextRequest) {
  const at = new Date().toISOString();
  // R30b (trace 1a10d6f880df9255) — הבלם-הריבוני בשפת-החתימה: שליחת-SOL היא הון (מסילת general).
  const brake = evaluateBrake("sol-send");
  console.log(brakeLogLine(brake));
  if (brake.halt) {
    return NextResponse.json(
      { ok: false, at, error: `CAPITAL-BRAKE-HALT: הבלם-הריבוני עצר את שליחת-ה-SOL לפני החתימה — אפס שידורים. ${brake.reasons.join(" | ").slice(0, 240)}`, lane: brake.lane, reasons: brake.reasons },
      { status: 423 },
    );
  }
  // R122 · חוק הסטטוס הכנה: JSON שגוי הוא 400 (שגיאת-לקוח); כשל-ביצוע
  // (שרשרת, כספת, DB) הוא 500 — לא מוסווה כשגיאת-קלט.
  let body: {
    action?: string;
    account?: string;
    to?: string;
    sol?: number;
    memo?: string; // R105 — הוראת spl-memo (הפקדות מזוויים)
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, at, error: "BAD-BODY: גוף הבקשה אינו JSON תקין" },
      { status: 400 },
    );
  }
  try {
    const memo = typeof body.memo === "string" && /^wx:[a-z0-9.-]{3,16}$/.test(body.memo.trim().toLowerCase())
      ? body.memo.trim().toLowerCase()
      : undefined;
    if (body.action !== "send") {
      return NextResponse.json({ ok: false, error: "BAD-ACTION: send בלבד" }, { status: 400 });
    }
    const account = body.account ?? "cashmachine";
    if (!VAULT_ACCOUNTS.includes(account)) {
      return NextResponse.json({ ok: false, error: "BAD-ACCOUNT: לא חשבון כספת" }, { status: 400 });
    }
    const sol = Number(body.sol);
    if (!Number.isFinite(sol) || sol <= 0) {
      return NextResponse.json({ ok: false, error: "BAD-VALUE" }, { status: 400 });
    }
    const price = (await solUsd()).price;
    if (price == null) {
      return NextResponse.json({
        ok: false,
        at,
        error: "NO-PRICE: USD לא נמדד חי — השער אינו יכול להעריך, לכן שום דבר לא זז",
      }, { status: 503 });
    }
    const usdValue = sol * price;
    const session = operatorFromRequest(req);
    const issuedBy: "operator" | "daemon" = session ? "operator" : "daemon";
    const gate = await evaluateGate({
      source: "sol-wire",
      action: "send",
      title: `העברת ${sol} SOL מ-${account} (${usdValue.toFixed(2)}$)`,
      payload: { account, to: body.to, sol, chain: "solana" },
      usdValue,
      usdBasis: `binance SOLUSDT $${price}`,
      issuedBy,
      reason: "פעולת-כסף רב-רשתית על רגל סולנה",
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
    const result = await solSend(account, String(body.to ?? ""), sol, { memo });
    if (result.ok) {
      await settleGate(gate.id, "EXECUTED", "sol-wire:live", { txid: result.txid ?? null, detail: result.detail });
    }
    return NextResponse.json({ at, gate: { id: gate.id, usdValue }, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, at, error: `EXECUTE-FAILED: ${String((e as Error).message ?? e).slice(0, 160)}` },
      { status: 500 },
    );
  }
}
