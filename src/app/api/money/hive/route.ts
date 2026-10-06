// ─────────────────────────────────────────────────────────────────────
// /api/money/hive — רגל HIVE של הגריד-החוץ (R101 · בנייה מחדש בקנון)
//
// זהו המוח הכספי של רגל-HIVE, שנבנתה ב-R99 ואבדה לארעיות-הסנדבוקס
// (הפקודות על השרשרת חיות; המנוע לא הועלה לגיט — הפער שנתפס ב-R101).
// אותה דוקטרינת-STEEM בדיוק, בכפוף לחוק-החוט (src/lib/dex/hive-wire):
//   · מכירות רק מעל קו-הזהות החיצוני (parity = hiveUsd/hbdUsd)
//   · קניות רק מתחת לקו — נאכף בקוד, לא בכוונה
//   · שער-העסקאות: אוטונומיה מתחת ל-$100; מעל — GATE-QUEUED
//   · המפתח נגזר מסיסמת-האב ומאומת ביט-מול-ביט מול השרשרת לפני שידור
//   · ההיסטוריה השופטת: הקבלה מאומתת מה שבאמת פתוח על השרשרת
//
// GET  → מדידת הרגל החיה (מאזנים, פקודות, ספר, סימנים, מילויים, RC)
// POST → action=reprice: ביטול + פריסת סולם מיקרו דו-צדדי על פי המלאי
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { NextRequest, NextResponse } from "next/server";
import { evaluateBrake, brakeLogLine } from "@/lib/cognition/brake"; // R30: הבלם-הריבוני לפני-כל-שידור (trace 1a10d6f880df9255)
import { operatorFromRequest } from "@/lib/operator-auth";
import { evaluateGate } from "@/lib/weave/tx-gate";
import { rpcV4, HIVE_RPC } from "@/lib/weave/graphene";
import { openVaultKey } from "@/lib/dex/wallet-vault";
import { readOwnerSource } from "@/lib/owner-key"; // r137 · D-026: מקור-מפתח דו-מצבי
import {
  readHiveLeg,
  hiveSendMarket,
  hiveLimitOrder,
  hiveCancel,
  fmtAsset,
} from "@/lib/dex/hive-wire";

export const dynamic = "force-dynamic";

const HOME = "/home/z/my-project";
// r137 · D-026: קריאת המפתח עברה לספריית owner-key המשותפת (OWNER_FILE שם)
const HISTORY_FILE = `${HOME}/sovereign/money/history.json`;

interface SteemAuth {
  auth: {
    wifToPublic(wif: string): string;
    toWif(account: string, password: string, role: string): string;
  };
}

function bad(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function readOwnerKey(): { account: string; password: string } | null {
  // r137 · D-026: מקור-המפתח הדו-מצבי — הרגל עצמה חותמת רק דרך הכספת
  // (openVaultKey פותחת בשני-המצבים), כאן נבדקת נוכחות וזהות בלבד.
  const src = readOwnerSource();
  if (!src) return null;
  return { account: src.account, password: src.mode === "master" ? (src.master ?? "") : "" };
}

interface HiveReceipt {
  at: string;
  kind: "HIVE-REPRICE";
  reason: string;
  parity: number | null;
  cancelled: Array<{ orderid: number; accepted: boolean; note?: string }>;
  placed: Array<{ orderid: number; side: "ask" | "bid"; sell: string; receive: string; price: number; accepted: boolean; note?: string }>;
  verify?: { ordersNow: number; asks: number; bids: number } | null;
  error?: string;
}

// r125a · חוק הראיה (אותו חוק כמו רגל ה-STEEM): כשל כתיבת-הקבלה לדיסק אינו
// מפיל פעולת-שרשרת שכבר בוצעה — אבל גם לא נבלע: התוצאה חוזרת לקורא
// (receiptPersisted:false) — אובדן-הראיה מתועד בגלוי.
function appendReceipt(r: HiveReceipt): boolean {
  try {
    let h: Array<Record<string, unknown>> = [];
    try {
      h = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
      if (!Array.isArray(h)) h = [];
    } catch {
      /* קובץ חדש */
    }
    h.push(r as unknown as Record<string, unknown>);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(h.slice(-200), null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

// ── GET: המדידה החיה (ציבורי, כמו /api/money) ────────────────────────

export async function GET() {
  const leg = await readHiveLeg();
  const { balances, orders, book, marks, fills, policy } = leg;

  const asks = orders.filter((o) => o.forSaleSymbol === "HIVE"); // מוכר HIVE
  const bids = orders.filter((o) => o.forSaleSymbol === "HBD"); // מוכר HBD = קונה HIVE
  const deployedHive = asks.reduce((s, o) => s + o.forSaleNum, 0);
  const deployedHbd = bids.reduce((s, o) => s + o.forSaleNum, 0);

  // הסולם המומלץ מהפאריטה החיה — מה שה-reprice היה פורש
  const ladder =
    marks.parity != null
      ? {
          asks: policy.askOffsetsBps.map((bps) => ({
            level: bps / 100,
            price: Math.round(marks.parity! * (1 + bps / 10_000) * 1e6) / 1e6,
          })),
          bids: policy.bidOffsetsBps.map((bps) => ({
            level: bps / 100,
            price: Math.round(marks.parity! * (1 - bps / 10_000) * 1e6) / 1e6,
          })),
        }
      : null;

  // סטיית הפקודות הקיימות מהסולם (טריגר-הדיבון)
  let maxDriftBps: number | null = null;
  if (marks.parity != null && orders.length) {
    for (const o of orders) {
      const drift = Math.abs((o.price / marks.parity - 1) * 10_000);
      if (maxDriftBps == null || drift > maxDriftBps) maxDriftBps = Math.round(drift);
    }
  }

  const usdNow =
    marks.hiveUsd != null && marks.hbdUsd != null
      ? Math.round((balances.hive * marks.hiveUsd + balances.hbd * marks.hbdUsd) * 100) / 100
      : null;

  return NextResponse.json({
    ok: leg.ok,
    at: leg.at,
    account: leg.account,
    balances,
    deployed: { hive: Math.round(deployedHive * 1000) / 1000, hbd: Math.round(deployedHbd * 1000) / 1000 },
    orders,
    book,
    marks,
    ladder,
    fills,
    policy,
    rc: leg.rc,
    usdNow,
    maxDriftBps,
    verdict:
      orders.length > 0
        ? "ARMED-LIVE"
        : balances.hive >= policy.minLevelHive || balances.hbd >= policy.minLevelHbd
          ? "FUEL-IDLE"
          : "EMPTY",
    doctrine: [
      "חוק-החוט (R99): החתימה על בייטים של שמות-האב, השידור בשמות האמיתיים — מנוע hive-wire.",
      "קו-זהות חיצוני: parity = hiveUsd/hbdUsd — מכירה רק מעליו, קנייה רק מתחתיו; נאכף בקוד.",
      "מיקרו-סקאלות: היתרון המדוד של הרשת — השוק הפנימי של HIVE צמוד (spread ~25bps) וממלא פרימיות אמיתיות.",
      "שער-עסקאות $100 — אותו חוק אחד לכל הרגליים; ה-USD נמדד חי בזמן ההחלטה.",
      "המפתח בזיכרון-ההרצה בלבד, מאומת ביט-מול-ביט מול הרשות החיה של HIVE — ואף פעם לא נכתב.",
    ],
  });
}

// ── POST: reprice — ביטול ופריסה מחדש של סולם המיקרו ───────────────────

// R101c - single-flight per process: operator + daemon overlap is a real
// measured race (two cancel+place cycles 30s apart). One money action at a time.
let hiveMoneyInFlight = false;

export async function POST(req: NextRequest) {
  if (hiveMoneyInFlight) {
    return bad("another hive action is executing - single-flight per process", 409, { code: "IN-FLIGHT" });
  }
  hiveMoneyInFlight = true;
  try {
    return await POST_core(req);
  } finally {
    hiveMoneyInFlight = false;
  }
}

async function POST_core(req: NextRequest) {
  let action = "";
  let reason = "";
  // r206 — הדיון נוסע עם הפעולה (אותו חוזה כמו /api/money)
  let deliberationBody: Record<string, string> = {};
  let deliberationOk = false;
  try {
    const body = (await req.json()) as { action?: unknown; reason?: unknown; deliberation?: unknown };
    action = typeof body.action === "string" ? body.action : "";
    reason = typeof body.reason === "string" ? body.reason : "";
    if (body?.deliberation && typeof body.deliberation === "object") {
      const d = body.deliberation as Record<string, unknown>;
      for (const k of ["claim", "why", "expected", "risk", "rollback", "falsifier"]) {
        const v = d[k];
        if (typeof v === "string" && v.trim().length >= 8) deliberationBody[k] = v.slice(0, 400);
      }
      deliberationOk = ["claim", "why", "expected", "risk", "rollback"].every((k) => typeof deliberationBody[k] === "string");
    }
  } catch {
    return bad("גוף בקשה שגוי", 400);
  }
  if (action !== "reprice") {
    return bad("פעולה לא נתמכת — reprice בלבד ברגל זו", 400);
  }

  const ownerKey = readOwnerKey();
  if (!ownerKey) {
    return bad("מקור המפתח (upload/headcorner.txt) לא נמצא — אין חתימה בלי סמכות חיה", 409, { code: "NO-OWNER-KEY" });
  }

  // R30 — הבלם-הריבוני בשפת-החתימה: STASIS + lane-guards, fail-closed, אפס-סודות.
  const brake = evaluateBrake("money-hive");
  console.log(brakeLogLine(brake));
  if (brake.halt) {
    return bad(
      `הבלם-הריבוני עצר את רגל-HIVE לפני השידור (STASIS/lane-guards) — אפס פעולות. סירוב-כנה. ${brake.reasons.join(" | ").slice(0, 300)}`,
      423,
      { code: "CAPITAL-BRAKE-HALT", lane: brake.lane, reasons: brake.reasons },
    );
  }

  const nodeRequire = createRequire(path.join(HOME, "package.json"));
  const steemLib = nodeRequire("steem") as unknown as SteemAuth;

  // מדידה חיה טרייה — הפעולה מחליטה על הסולם עכשיו
  const leg = await readHiveLeg(ownerKey.account);
  if (!leg.ok) {
    return bad("קריאת השרשרת (HIVE) נכשלה — אין פעולה בלי מדידה", 502, { code: "HIVE-RPC-DOWN" });
  }
  const parity = leg.marks.parity;
  if (parity == null || parity <= 0) {
    return bad("קו-הזהות לא נמדד חי (hiveUsd/hbdUsd) — אין שער, אין מסחר. סירוב-כנה.", 409, { code: "NO-PARITY" });
  }

  // דוקטרינת R75: המפתח מכריז את החותם — ביט-מול-ביט מול ה-active החי של HIVE
  // R101c - THE WALLET-VAULT: the master key connects all networks.
  // The password derives the LIVE STEEM active (the legacy root), which opens
  // the vault seal -> master -> AES-GCM -> the HIVE active WIF (in-memory only).
  // R99 proved the vault holds the HIVE keys; the password alone does NOT
  // derive them (measured live: KEY-MISMATCH) - the vault is the bridge.
  const vault = openVaultKey("hive", ownerKey.account, "active");
  if (!vault.ok || !vault.wif || !vault.pub) {
    return bad(`הארנק לא נפתח בנתיב הריבוני — ${vault.detail ?? "שידור נדחה"}. אין חתימה בלי מפתח חי.`, 409, { code: "VAULT-LOCKED" });
  }
  const wif = vault.wif;
  const derivedPub = vault.pub;
  const liveAcct = await rpcV4<Array<{ active: { key_auths: Array<[string, number]> } }>>(
    HIVE_RPC,
    "condenser_api.get_accounts",
    [[ownerKey.account]],
  ).catch(() => null);
  const liveActive = liveAcct?.[0]?.active?.key_auths?.[0]?.[0] ?? null;
  if (!liveActive || derivedPub !== liveActive) {
    return bad("המפתח שנגזר אינו תואם את רשות-ה-active החיה של HIVE — שום דבר לא שודר. סירוב-כנה.", 409, { code: "KEY-MISMATCH" });
  }

  const { balances, orders, policy } = leg;
  // R101c fix: fuel = liquid + deployed (the cancels at the start of every
  // reprice return the deployed amounts to liquid - same law as the STEEM leg
  // totalFuel). Without this, a fully-deployed ladder could never reprice
  // (measured live: NO-FUEL deadlock at 0.002 liquid while 6 orders held it).
  const deployedHive = orders.filter((o) => o.forSaleSymbol === "HIVE").reduce((sum, o) => sum + o.forSaleNum, 0);
  const deployedHbd = orders.filter((o) => o.forSaleSymbol === "HBD").reduce((sum, o) => sum + o.forSaleNum, 0);
  const askFuel = Math.round((balances.hive + deployedHive) * 1000) / 1000;
  const bidFuel = Math.floor((balances.hbd + deployedHbd) * 1000) / 1000;

  const perAsk = Math.floor((askFuel / 3) * 1000) / 1000;
  const perBid = Math.floor((bidFuel / 3) * 1000) / 1000;

  if (perAsk < policy.minLevelHive && perBid < policy.minLevelHbd) {
    return bad(
      `אין דלק לפריסה (HIVE ${askFuel.toFixed(3)} / HBD ${bidFuel.toFixed(3)}) — המיקרו-גריד מחכה למלאי`,
      409,
      { code: "NO-FUEL" },
    );
  }

  // ── שער-העסקאות: אותו חוק $100 אחד ────────────────────────────────
  const gateUsd =
    leg.marks.hiveUsd != null && leg.marks.hbdUsd != null
      ? Math.round((askFuel * leg.marks.hiveUsd + bidFuel * leg.marks.hbdUsd) * 100) / 100
      : null;
  const session = operatorFromRequest(req);
  const issuedBy: "operator" | "daemon" = session ? "operator" : "daemon";
  const hivePayload: Record<string, unknown> = { askFuel, bidFuel, parity, askOffsets: policy.askOffsetsBps, bidOffsets: policy.bidOffsetsBps, reason };
  if (deliberationOk) hivePayload.deliberation = deliberationBody; // r206 — המחשבה מגיעה לשופט
  const gate = await evaluateGate({
    source: "money-mover",
    action: "hive-reprice",
    title: `hive-reprice — סולם מיקרו דו-צדדי · ${askFuel} HIVE + ${bidFuel} HBD`,
    payload: hivePayload,
    usdValue: gateUsd,
    usdBasis:
      gateUsd != null
        ? `${askFuel} HIVE × $${leg.marks.hiveUsd} + ${bidFuel} HBD × $${leg.marks.hbdUsd}`
        : "usd-mark לא נמדד חי",
    issuedBy,
    reason: reason || "reprice מחזורי של רגל HIVE",
  });
  if (gate.verdict === "REFUSED") {
    // r206 — ייחוס-אמת: אותו מיפוי-שקר של /api/money תוקן גם כאן (שכפול מדויק של
    // המיפוי הישן — כל REFUSED דווח "USD לא נמדד חי" בלי קשר לסיבה האמיתית)
    const decidedBy = String(gate.decidedBy ?? "unknown");
    const gateRef = `[שער#${String(gate.id).slice(0, 8)}]`;
    if (decidedBy === "autonomy:NO-DELIBERATION") {
      return bad(`THINKING — הפעולה הגיעה לשער בלי דיון מלא — לחשוב לפני שעושים (חוק-r197) ${gateRef}`, 409, { code: "NO-DELIBERATION", gateId: gate.id, gateDecidedBy: decidedBy });
    }
    if (decidedBy === "autonomy:PAUSED") {
      return bad(`האוטונומיה עוצרה על-ידי המפעיל — אף פעולה אוטומטית לא זזה ${gateRef}`, 409, { code: "AUTONOMY-PAUSED", gateId: gate.id, gateDecidedBy: decidedBy });
    }
    if (decidedBy === "policy:no-usd-mark") {
      return bad(`USD לא נמדד חי — השער אינו יכול להעריך, לכן שום דבר לא זז (אין שער, אין מסחר) ${gateRef}`, 409, { code: "NO-USD-MARK", gateId: gate.id, gateDecidedBy: decidedBy });
    }
    return bad(`השער סירב (${decidedBy}) ${gateRef} — ${String(gate.reason ?? "").slice(0, 140)}`, 409, { code: "GATE-REFUSED", gateId: gate.id, gateDecidedBy: decidedBy });
  }
  if (gate.verdict === "QUEUED") {
    return NextResponse.json(
      {
        ok: false,
        code: "GATE-QUEUED",
        gateId: gate.id,
        usdValue: gate.usdValue,
        threshold: gate.threshold,
        error: "GATE-QUEUED",
        he: `הפעולה (${gate.usdValue?.toFixed(2)}$) מעל סף האוטונומיה $${gate.threshold} — הועברה לתור אישור המפעיל. שום כסף לא זז.`,
      },
      { status: 403 },
    );
  }

  // ── ביצוע: ביטול הכול, פריסה מחדש ──────────────────────────────────
  const receipt: HiveReceipt = {
    at: new Date().toISOString(),
    kind: "HIVE-REPRICE",
    reason: reason || "reprice מחזורי",
    parity,
    cancelled: [],
    placed: [],
  };
  // r125a: ה-persist האחרון קובע — אם כתיבת הקבלה נפלה, התשובה מגלה זאת
  // ולא מסתירה את אובדן-הראיה מאחורי ok:true.
  let receiptPersisted = true;
  const persist = () => {
    receiptPersisted = appendReceipt(receipt);
  };

  // 1) ביטול כל הפקודות הפתוחות שלנו
  for (const o of orders) {
    const r = await hiveSendMarket([hiveCancel(ownerKey.account, o.orderid)], wif);
    receipt.cancelled.push({ orderid: o.orderid, accepted: r.accepted, note: r.note });
    persist();
  }

  // 2) סולם המכירה — HIVE → HBD מעל הקו (ceil על התקבול: לקח-המיל-צעד של R99)
  const expiration = new Date(Date.now() + 27 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "");
  const orderBase = Number(new Date().toISOString().slice(0, 10).replace(/-/g, "")) * 100;

  if (perAsk >= policy.minLevelHive) {
    for (let i = 0; i < policy.askOffsetsBps.length; i++) {
      const bps = policy.askOffsetsBps[i];
      const price = parity * (1 + bps / 10_000); // מעל הקו — תמיד
      const receive = Math.ceil(perAsk * price * 1000) / 1000; // ceil על התקבול
      const orderid = orderBase + i + 1;
      const r = await hiveSendMarket(
        [hiveLimitOrder(ownerKey.account, orderid, fmtAsset(perAsk, "HIVE"), fmtAsset(receive, "HBD"), expiration)],
        wif,
      );
      receipt.placed.push({ orderid, side: "ask", sell: fmtAsset(perAsk, "HIVE"), receive: fmtAsset(receive, "HBD"), price, accepted: r.accepted, note: r.note });
      persist();
    }
  }

  // 3) סולם הקנייה — HBD → HIVE מתחת לקו (חוק-הזהות: לעולם לא מעל)
  if (perBid >= policy.minLevelHbd) {
    for (let i = 0; i < policy.bidOffsetsBps.length; i++) {
      const bps = policy.bidOffsetsBps[i];
      const price = parity * (1 - bps / 10_000); // מתחת לקו — תמיד
      const receive = Math.floor(perBid / price * 1000) / 1000; // floor על התקבול
      if (receive < 0.02) continue; // רמת-אבק — דילוג כנה (לקח R99)
      const orderid = orderBase + 10 + i + 1;
      // r125 — חוק הגג מהאח-STEEM (R97): עיגול-מטה על התקבול מעלה את המחיר
      // היעיל — העיגול יכול לאכול את המרווח ולהציב קנייה מעל הפאריטה. אסור.
      const effPrice = receive > 0 ? perBid / receive : 0;
      if (effPrice >= parity) {
        receipt.placed.push({
          orderid, side: "bid",
          sell: fmtAsset(perBid, "HBD"), receive: fmtAsset(receive, "HIVE"), price,
          accepted: false,
          note: `מחיר יעיל ${effPrice.toFixed(6)} אינו מתחת לפאריטה ${parity.toFixed(6)} — לא הוצב (חוק הגג, כמו R97 באח-STEEM)`,
        });
        continue;
      }
      const r = await hiveSendMarket(
        [hiveLimitOrder(ownerKey.account, orderid, fmtAsset(perBid, "HBD"), fmtAsset(receive, "HIVE"), expiration)],
        wif,
      );
      receipt.placed.push({ orderid, side: "bid", sell: fmtAsset(perBid, "HBD"), receive: fmtAsset(receive, "HIVE"), price, accepted: r.accepted, note: r.note });
      persist();
    }
  }

  // 4) אימות-סוף — השרשרת השופטת: מה באמת פתוח שם
  const after = await readHiveLeg(ownerKey.account);
  receipt.verify = {
    ordersNow: after.orders.length,
    asks: after.orders.filter((o) => o.forSaleSymbol === "HIVE").length,
    bids: after.orders.filter((o) => o.forSaleSymbol === "HBD").length,
  };
  persist();

  // R122 · חוק הכנות: אין עוד ok:true אוטומטי — ההצלחה נמדדת מהקבלות
  // (כל ביטול/הצבה שנדחה מפיל את ה-ok, כמו באח ה-STEEM) ומוצלבת מול
  // אימות-השרשרת: מה באמת פתוח שם.
  const opsOk =
    receipt.cancelled.every((c) => c.accepted) && receipt.placed.every((p) => p.accepted);
  const placedAccepted = receipt.placed.filter((p) => p.accepted).length;
  const cancelAccepted = receipt.cancelled.filter((c) => c.accepted).length;
  const anyOp = receipt.cancelled.length + receipt.placed.length > 0;
  const chainOk = (receipt.verify?.ordersNow ?? 0) > 0;
  const ok = opsOk && (chainOk || placedAccepted > 0 || cancelAccepted > 0 || !anyOp);

  return NextResponse.json({
    ok,
    kind: receipt.kind,
    at: receipt.at,
    parity,
    cancelled: receipt.cancelled.length,
    placed: receipt.placed.length,
    verify: receipt.verify,
    receiptPersisted,
    notes: receipt.placed.filter((p) => !p.accepted).map((p) => ({ orderid: p.orderid, note: p.note })),
    he: (ok
      ? `רגל HIVE הוצמדה מחדש (נמדד): בוטלו ${cancelAccepted}/${receipt.cancelled.length} · הוצבו ${placedAccepted}/${receipt.placed.length} · בשרשרת ${receipt.verify?.ordersNow ?? "—"} פקודות`
      : "ה-reprice נכשל בכנות — לפחות ביטול/הצבה אחד נדחה; הקבלה המלאה ב-receipts (שום כסף לא אבד: העטיפה מוחזרת בכל כשל)") + (receiptPersisted ? "" : " · אזהרה: כתיבת הקבלה לדיסק נכשלה — הראיה על השרשרת בלבד"),
  });
}
