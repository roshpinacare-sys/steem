// ─────────────────────────────────────────────────────────────────────
// /api/saos/relay (r144-g2) — ריליי רישומי-ארנק SAOS-LIVE באירוח הבית.
//
// מה נמדד ומה החוקה כאן:
//   · הקיים (saos-rail.saosLiveRegisterWallet) רושם רק כתובות
//     הנגזרות ממפתחות-הכספת — אינו תומך כתובות-צד-שלישי (נמדד,
//     L107-148: המפתח חייב להיות openVaultKey של החשבון).
//   · אבל הפרוטוקול עצמו (console/saos-live.js) נולד לזה: מעטפת
//     wallet.create חתומה-בידי-בעל-הארנק היא self-certifying — החתימה
//     הפנימית היא הסמכות, "הריליי הוא תעבורה בלבד: הוא אינו יכול
//     לזייף (אין לו את המפתח) וכל צומת מאמת מחדש כל חתימה".
//   · לכן הריליי הזה: מאמת צורה → מריץ את אותו קיפול (השרשרת היא
//     השופט) → שער-עוגן-ליבה + שער-RC → משדר דרך מפתח-התעבורה
//     של קו-העדות (אפס חומר-מפתח של המשתמש עובר כאן, אפס חוזר).
//   · מה שלא שודר מיידית — נשמר ב-sovereign/saos/relay-queue.json
//     (append-only) ומשוטף בפרסום-הקיפול הבא (saoslite).
//   · אפס הצלחה-מזויפת: כל תשובה נושאת מצב אמיתי בלבד.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { readLiveEnvelopes, readCoreAnchorAge, CORE_PRIORITY_H, SAOS_LIVE_OP_ID } from "@/lib/weave/saoslite";
import {
  validateRelayWalletCreateShape,
  readRelayQueue,
  appendRelayQueueEntry,
  markRelayQueueEntry,
  type SaosRelayEntry,
} from "@/lib/weave/saos-relay-queue";
import { openVaultKey } from "@/lib/dex/wallet-vault";
import { steemRcGate, steemBroadcast } from "@/lib/weave/graphene";

export const dynamic = "force-dynamic";

const WITNESS = (process.env.WEAVE_STEEM_ACCOUNT || "cashmachine").toLowerCase();
const BODY_LIMIT = 4096;

/* ── מגבלת-קצב: 10 שידורים לשעה לכל-IP (אותה משמעת כמו /api/arm) ── */
const hits = new Map<string, number[]>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

type SaosLiveModule = typeof import("../../../../../console/saos-live.js");
async function saosLib(): Promise<SaosLiveModule> {
  return (await import("../../../../../console/saos-live.js")) as unknown as SaosLiveModule;
}

/** מפתח-התעבורה של קו-העדות: סביבת-הענן קודם (WEAVE_STEEM_WIF), אחר-כך הכספת.
 *  אף פעם לא נכתב, נרשם או חוזר — רק נוכחות נחשפת. */
function transportWif(): { ok: boolean; wif?: string; detail: string } {
  const envWif = (process.env.WEAVE_STEEM_WIF || "").trim();
  if (envWif.length > 20) return { ok: true, wif: envWif, detail: "env" };
  const v = openVaultKey("steem", WITNESS, "posting");
  if (v.ok && v.wif) return { ok: true, wif: v.wif, detail: "vault" };
  return { ok: false, detail: `NO-TRANSPORT-KEY: ${v.detail}` };
}

function enqueueEntry(env: Record<string, unknown>, signedAt?: string, note?: string, test = false): SaosRelayEntry {
  const entry: SaosRelayEntry = {
    id: String(env.id),
    queuedAt: new Date().toISOString(),
    signedAt,
    source: "relay",
    test,
    status: "queued",
    env,
    note,
  };
  appendRelayQueueEntry(entry);
  return entry;
}

/* ═══════════ GET — מצב כנה בלבד: registered / queued / unknown ═══════════ */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!/^saos1[1-9A-HJ-NP-Za-km-z]{33,35}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "BAD-ADDRESS", detail: "כתובת SAOS שגויה (צורה saos1…)" }, { status: 400 });
  }
  try {
    // השופט הראשון: הספר החי על השרשרת (חסר-מפתח לחלוטין)
    const S = await saosLib();
    const { envelopes: liveEnvs, node } = await readLiveEnvelopes();
    const folded = await S.fold(liveEnvs.map((e) => e.env));
    const w = (folded.state.wallets as Record<string, { nick?: string | null; at?: string | null; txid?: string | null }>)[address];
    if (w) {
      // op ref: ה-txid של השידור המקורי של wallet.create (מקריאת-השרשרת עצמה)
      const regOp = liveEnvs.find((e) => e.env?.k === "wallet.create" && e.env?.by === address);
      return NextResponse.json({
        ok: true,
        status: "registered",
        address,
        opRef: regOp?.txid ?? w.txid ?? null,
        nick: w.nick ?? null,
        foldedAt: w.at ?? null,
        stateRoot: folded.stateRoot,
        readFrom: node,
        checkedAt: new Date().toISOString(),
      });
    }
    // השופט השני: תור-הריליי המקומי (append-only)
    const q = readRelayQueue();
    const mine = q.entries.filter((e) => e.env?.by === address).sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))[0];
    if (mine) {
      return NextResponse.json({
        ok: true,
        status: mine.status === "queued" ? "queued" : mine.status === "rejected" ? "rejected" : "broadcast",
        address,
        queueId: mine.id,
        test: mine.test || undefined,
        opRef: mine.txid ?? null,
        note: mine.note ?? null,
        checkedAt: new Date().toISOString(),
      });
    }
    return NextResponse.json({ ok: true, status: "unknown", address, checkedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "JUDGE-UNREACHABLE", detail: String((e as Error).message ?? e).slice(0, 120), checkedAt: new Date().toISOString() },
      { status: 502 },
    );
  }
}

/* ═══════════ POST — קבלת מעטפה חתומה, שידור תעבורה-בלבד ═══════════ */
export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const at = new Date().toISOString();
  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "RATE-LIMITED", detail: "10 מעטפות לשעה לכל-IP — נסה שוב מאוחר יותר", at },
      { status: 429 },
    );
  }

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD-BODY", at }, { status: 400 });
  }
  if (!raw.length || raw.length > BODY_LIMIT) {
    return NextResponse.json({ ok: false, error: "BAD-BODY", detail: `גוף ריק או חורג (${BODY_LIMIT} בתים)`, at }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "BAD-JSON", at }, { status: 400 });
  }
  const envelopeIn = (body as { envelope?: unknown }).envelope ?? body;
  const shape = validateRelayWalletCreateShape(envelopeIn);
  if (!shape.ok || !shape.env) {
    return NextResponse.json({ ok: false, error: "BAD-ENVELOPE", detail: shape.detail, at }, { status: 400 });
  }
  const env = shape.env;

  // רשומת-בדיקה (test:true): לעולם לא משודרת — נכנסת לתור כרשומת
  // בדיקה (append-only, test:true, ומשטף-הקיפול מדלג עליה) כדי
  // למדוד את מסלול התור וה-GET בלבד. התשובה אומרת זאת בכנות.
  if ((body as { test?: unknown }).test === true) {
    enqueueEntry(env, shape.signedAt, "רשומת-בדיקה (test:true) — לעולם לא משודרת", true);
    return NextResponse.json({ ok: true, queued: true, queueId: String(env.id), status: "queued", test: true, note: "רשומת-בדיקה — לעולם לא משודרת", at });
  }

  try {
    // השרשרת היא השופט: אותו קיפול בדיוק, עם המעטפה בתור — אימות-צורה
    // מקצה לקצה (sig→pub→addr, wallet-exists, pub-taken, dup-id).
    const S = await saosLib();
    const { envelopes } = await readLiveEnvelopes();
    const liveEnvs = envelopes.map((e) => e.env);
    const judged = await S.fold([...liveEnvs, env]);
    const bad = (judged.invalid ?? []).find((x) => x.id === env.id);

    if (bad && bad.err === "wallet-exists") {
      // כבר רשום — הצלחה-כנה ואידמפוטנטית, עם ה-op ref מהספר
      markRelayQueueEntry(String(env.id), { status: "registered", note: "כבר רשום על השרשרת" });
      return NextResponse.json({ ok: true, status: "registered", address: env.by, opRef: null, note: "כבר רשום על השרשרת — אין מה לשדר", at });
    }
    if (bad && bad.err === "dup-id") {
      const prev = readRelayQueue().entries.find((e) => e.id === String(env.id));
      if (prev?.txid) return NextResponse.json({ ok: true, status: "broadcast", address: env.by, opRef: prev.txid, note: "כבר שודר דרך הריליי", at });
      return NextResponse.json({ ok: false, error: "FOLD-REJECT", err: "dup-id", detail: "מזהה-המעטפה כבר קיים בספר החי", at }, { status: 422 });
    }
    if (bad) {
      enqueueEntry(env, shape.signedAt, `FOLD-REJECT: ${bad.err}`, false);
      markRelayQueueEntry(String(env.id), { status: "rejected", note: `FOLD-REJECT: ${bad.err}` });
      return NextResponse.json({ ok: false, error: "FOLD-REJECT", err: bad.err, detail: "השופט (הקיפול) דחה את המעטפה — לא שודר כלום", at }, { status: 422 });
    }
    // תקפה. נותרים: עדיפות עוגן-הליבה, שער-RC, מפתח-תעבורה.
    const core = await readCoreAnchorAge();
    const coreHungry = !core.ok || (core.ageHours ?? 0) > CORE_PRIORITY_H;
    if (coreHungry) {
      const note = `דחה-לתור: עדיפות עוגן-הליבה (${!core.ok ? core.reason : `גיל ${(core.ageHours ?? 0).toFixed(1)} ש' > ${CORE_PRIORITY_H} ש'`}) — ישוטף בפרסום-הקיפול הבא`;
      enqueueEntry(env, shape.signedAt, note);
      return NextResponse.json({ ok: true, queued: true, queueId: env.id, status: "queued", note, at });
    }
    const gate = await steemRcGate(WITNESS);
    if (!gate.ok) {
      const note = `דחה-לתור: RC נמוך (${gate.reason ?? "gated"}) — ישוטף בפרסום-הקיפול הבא`;
      enqueueEntry(env, shape.signedAt, note);
      return NextResponse.json({ ok: true, queued: true, queueId: env.id, status: "queued", note, at });
    }
    const t = transportWif();
    if (!t.ok || !t.wif) {
      const note = `דחה-לתור: אין מפתח-תעבורה בסביבה הזו (${t.detail}) — ישוטף מהענן`;
      enqueueEntry(env, shape.signedAt, note);
      return NextResponse.json({ ok: true, queued: true, queueId: env.id, status: "queued", note, at });
    }

    const txOps = [[
      "custom_json",
      {
        required_auths: [],
        required_posting_auths: [WITNESS],
        id: SAOS_LIVE_OP_ID,
        json: JSON.stringify(env),
      },
    ]] as unknown as Parameters<typeof steemBroadcast>[0];
    const res = await steemBroadcast(txOps, t.wif);
    if (!res.txid) {
      const note = `שידור נכשל (${(res.note ?? "?").slice(0, 60)}) — ישוטף בפרסום-הקיפול הבא`;
      enqueueEntry(env, shape.signedAt, note);
      return NextResponse.json({ ok: true, queued: true, queueId: env.id, status: "queued", note, at });
    }
    markRelayQueueEntry(String(env.id), { status: "broadcast", txid: res.txid, broadcastAt: at, note: "שודר ישירות דרך הריליי" });
    return NextResponse.json({
      ok: true,
      status: "broadcast",
      address: env.by,
      opRef: res.txid,
      txid: res.txid,
      note: "wallet.create שודר — הקיפול יזקוף בבלוק הבא (transport only: החתימה שלך היא הסמכות)",
      at,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "RELAY-ERROR", detail: String((e as Error).message ?? e).slice(0, 140), at },
      { status: 500 },
    );
  }
}
