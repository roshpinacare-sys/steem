// ─────────────────────────────────────────────────────────────────────
// /api/exchange — זירת-המסחר הריבונית (R102)
//
// GET  — תמונת-זירה חיה: בריכות, רזרבת-USDS, חברים, ספר, דלת-ההפקדות.
// POST — פעולות החברים: swap | usds-mint | usds-burn | withdraw |
//        deposit-scan | quote | reward-pay | add-liquidity |
//        liquidity-stream — הכל דרך החוקים (שער-$100, hash-chain,
//        קבלה-כנה, אימות-סמכות ביט-מול-ביט בכל שידור).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import {
  ensureExchange, exchangeSnapshot, quoteSwap, swap,
  usdsMint, usdsBurn, withdraw, depositScan,
  rewardPay, addLiquidity, removeLiquidity, liquidityStream, agentCompound, poolGuard,
  treasuryUnwrap,
  type ExchangeAsset,
} from "@/lib/weave/sovereign-exchange";
import { operatorFromRequest } from "@/lib/operator-auth";
import { saosLiveRegisterWallet, saosAddressOf, foldLiveState, treasuryIdentity } from "@/lib/weave/saos-rail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get("with") === "quote") {
    const pair = url.searchParams.get("pair") ?? "";
    const side = (url.searchParams.get("side") === "B2A" ? "B2A" : "A2B") as "A2B" | "B2A";
    const amountIn = Number(url.searchParams.get("amountIn") ?? "0");
    const q = await quoteSwap(pair, side, amountIn);
    if (!("expectedOut" in q)) return NextResponse.json({ ...q }, { status: 400 });
    return NextResponse.json({ quote: q });
  }
  const snap = await exchangeSnapshot();
  return NextResponse.json(snap);
}

export async function POST(req: NextRequest) {
  const at = new Date().toISOString();
  // R122 · חוק הסטטוס הכנה: JSON שגוי הוא 400 (שגיאת-לקוח); כשל-ביצוע
  // (שרשרת, כספת, DB) הוא 500 — לא מוסווה כשגיאת-קלט.
  let body: {
    action?: string;
    member?: string;
    pair?: string;
    side?: "A2B" | "B2A";
    amountIn?: number;
    minOut?: number;
    asset?: ExchangeAsset;
    stable?: "WSBD" | "WHBD";
    amount?: number;
    toAccount?: string;
    note?: string;
    maxA?: number;
    maxB?: number;
    sharePct?: number;
    share?: number;
    bandBps?: number;
    seq?: number; // R111 — treasury-unwrap: מזהה אירוע ה-WRAP המקורי
    reason?: string; // R111 — סיבת-ההיפוך המתועדת בשרשרת-הספר
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
    await ensureExchange();
    const session = operatorFromRequest(req);
    const issuedBy: "operator" | "daemon" = session ? "operator" : "daemon";
    // המפעיל פועל כראש-הזירה; פעולות של חברים אחרים מחייבות סשן-מפעיל
    // (חברות-ציבור עוברת דרך דלת-ההפקדות החיה — ההיסטוריה מזהה אותם)
    const member = session ? (body.member ?? "operator") : "treasury";

    switch (body.action) {
      case "quote": {
        const q = await quoteSwap(String(body.pair), body.side === "B2A" ? "B2A" : "A2B", Number(body.amountIn ?? 0));
        if (!("expectedOut" in q)) return NextResponse.json({ ...q, at }, { status: 400 });
        return NextResponse.json({ quote: q, at });
      }
      case "swap": {
        const r = await swap({
          member,
          pair: String(body.pair),
          side: body.side === "B2A" ? "B2A" : "A2B",
          amountIn: Number(body.amountIn ?? 0),
          minOut: body.minOut != null ? Number(body.minOut) : 0,
        });
        return NextResponse.json({ ...r, at });
      }
      case "usds-mint": {
        const stable = body.stable === "WHBD" ? "WHBD" : "WSBD";
        const r = await usdsMint(member, stable, Number(body.amount ?? 0));
        return NextResponse.json({ ...r, at });
      }
      case "usds-burn": {
        const stable = body.stable === "WHBD" ? "WHBD" : "WSBD";
        const r = await usdsBurn(member, stable, Number(body.amount ?? 0));
        return NextResponse.json({ ...r, at });
      }
      case "withdraw": {
        // R107 — חור שנמצא ונסגר: בלי סשן, member=treasury — קריאה אנונימית
        // הייתה מוציאה כסף אמיתי מהאוצר מתחת לסף $100. משיכה היא
        // יציאת-כסף — דלת סגורה לאלמונים, סשן-מפעיל בלבד.
        if (!session) {
          return NextResponse.json({ ok: false, at, error: "AUTH: משיכה מחייבת סשן-מפעיל — הדלת נעולה לאלמונים (R107)" }, { status: 401 });
        }
        const r = await withdraw({
          member,
          asset: String(body.asset) as ExchangeAsset,
          amount: Number(body.amount ?? 0),
          toAccount: String(body.toAccount ?? ""),
          issuedBy,
        });
        return NextResponse.json({ ...r, at });
      }
      case "deposit-scan": {
        const r = await depositScan();
        return NextResponse.json({ ...r, at });
      }
      case "reward-pay": {
        // R108 — רייל-התגמול לצי: חברי-הצי מוגדרים עם תקרות-יום
        // שהשרת אוכף בעצמו (REWARD_DAILY_CAPS ב-rewardPay) — ההיתר
        // כאן רק פותח את הדלת למסלול; הכסף מוגן שם. חבר אחר — סשן-מפעיל.
        const FLEET = ["money-mover", "keeper", "pulse", "student", "hunter"] as const;
        const rewardMember = String(body.member ?? "money-mover");
        if (!session && !(FLEET as readonly string[]).includes(rewardMember)) {
          return NextResponse.json({ ok: false, at, error: "AUTH: תגמול לחברים מחוץ לצי מחייב סשן-מפעיל (R108)" }, { status: 401 });
        }
        const r = await rewardPay({
          member: rewardMember,
          amount: Number(body.amount ?? 0),
          note: String(body.note ?? "עבודה"),
          issuedBy,
        });
        return NextResponse.json({ ...r, at });
      }
      case "add-liquidity": {
        const r = await addLiquidity({
          member,
          pair: String(body.pair ?? ""),
          maxA: Number(body.maxA ?? 0),
          maxB: Number(body.maxB ?? 0),
        });
        return NextResponse.json({ ...r, at });
      }
      case "treasury-unwrap": {
        // R111 — רייל היפוך-עטיפה: מחזיר עטיפה מוטעית לספר ביושר.
        // מזהה את אירוע ה-WRAP המקורי לפי seq — אין המצאת סכומים,
        // אין נגיעה בעטיפות הטבעה, וכל צעד בשרשרת-הספר.
        const seq = Number(body.seq ?? 0);
        if (!Number.isInteger(seq) || seq <= 0) {
          return NextResponse.json({ ok: false, detail: "BAD-SEQ: נדרש מזהה אירוע WRAP (seq)" }, { status: 400 });
        }
        const r = await treasuryUnwrap({
          seq,
          reason: String(body.reason ?? ""),
          issuedBy,
        });
        return NextResponse.json({ ...r, at });
      }
      case "liquidity-stream": {
        const r = await liquidityStream({
          share: body.share != null ? Number(body.share) : undefined,
          issuedBy,
        });
        return NextResponse.json({ ...r, at });
      }
      case "agent-compound": {
        // R107 — שרשרת הגלגול האוטונומית: תגמולי-SAOS ← מחצית ל-USDS
        // ← שני הצדדים כעומק-LP. הדיבון מפעיל אותה אחרי reward-pay —
        // דבר גורר דבר, בשומרי-צינון/תקציב של מנוע-השרשרת.
        const r = await agentCompound({
          member: String(body.member ?? "money-mover"),
          firedBy: String(body.note ?? "daemon"),
        });
        return NextResponse.json({ ...r, at });
      }
      case "fleet-compound": {
        // R108 — גלגול-צי: כל חבר מעל רף-הגלגול מגולגל באותה שרשרת-אחת.
        // הצי כולו הופך בעל-נזילות — לא רק מוביל-הכסף.
        const results: Array<{ member: string; ok: boolean; detail: string }> = [];
        const snap = await exchangeSnapshot();
        for (const m of snap.members) {
          if (m.member === "treasury" || m.member === "reserve") continue;
          const saos = m.balances.SAOS ?? 0;
          if (saos < 4) continue;
          const r = await agentCompound({ member: m.member, firedBy: "fleet-sweep" });
          results.push({ member: m.member, ok: r.ok, detail: r.detail.slice(0, 160) });
        }
        const rolled = results.filter((r) => r.ok).length;
        const held = results.length - rolled;
        return NextResponse.json({
          ok: true,
          at,
          detail: results.length === 0
            ? "אף חבר מעל רף-הגלגול — מצברים בסבלנות"
            : `גולגלו ${rolled} חברים${held > 0 ? ` · ${held} מוחזקים (צינון/חסימה)` : ""}`,
          results,
        });
      }
      case "pool-guard": {
        // R108 — טריגר איזון-הבריכות: סטייה מהשווי-החיצוני האמיתי ← האוצר
        // סוגר את הפער. הפרמייה נשארת בבית.
        const r = await poolGuard({ issuedBy, bandBps: body.bandBps != null ? Number(body.bandBps) : undefined });
        return NextResponse.json({ ...r, at });
      }
      case "remove-liquidity": {
        // R107 — מסילת-היציאה: מניות-LP ← חילוץ פרו-רטה. הנזילות
        // אף פעם לא נלכדת בבריכה.
        const r = await removeLiquidity({
          member,
          pair: String(body.pair ?? ""),
          sharePct: Number(body.sharePct ?? 0),
        });
        return NextResponse.json({ ...r, at });
      }
      case "saos-register": {
        // R104 — הרשמת ארנק SAOS-LIVE לחשבון שבכספת (self-certifying מהמפתח).
        // רישום זהות בלבד — אין תנועת כסף; השרשרת היא השופט.
        const account = String(body.toAccount || "headcorner").toLowerCase();
        if (!/^[a-z0-9.-]{3,16}$/.test(account)) {
          return NextResponse.json({ ok: false, at, error: "BAD-ACCOUNT" }, { status: 400 });
        }
        const r = await saosLiveRegisterWallet({ account, nick: account });
        return NextResponse.json({ ...r, at });
      }
      case "saos-live": {
        // מצב שרשרת-החי לתצוגה — קיפול נטול-מפתח, הצומת הוא השופט
        const id = await treasuryIdentity();
        const live = await foldLiveState(id.ok ? id.treasuryAddr : undefined);
        const operator = await saosAddressOf("headcorner");
        return NextResponse.json({
          ok: live.ok,
          at,
          node: live.node,
          envelopes: live.envelopes,
          stateRoot: live.stateRoot,
          wallets: Object.keys(live.wallets),
          treasuryBalSaos: live.treasuryBalSaos,
          operatorSaosAddr: operator.ok ? operator.addr : null,
          detail: live.detail,
        });
      }
      default:
        return NextResponse.json({ ok: false, at, error: "BAD-ACTION" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, at, error: `EXECUTE-FAILED: ${String((e as Error).message ?? e).slice(0, 160)}` },
      { status: 500 },
    );
  }
}
