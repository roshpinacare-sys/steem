// ─────────────────────────────────────────────────────────────────────
// /api/money/claim — צינור claim_rewards (r148-a · B-1 דלפק-הדלק)
//
// עד היום claim_rewards לא היה ממומש בשום מקום בקודבייס (נמדד: 0 פגיעות).
// זה המימוש האמת הראשון — והוא עוקב אחרי הקנון הקיים:
//   · המפתח: readOwnerSource/steemSigningWif (r137 · D-026) — תפקיד "active",
//     הסוד בזיכרון-ההרצה בלבד; המפתח מכריז את החותם — השרשרת השופטת (R75):
//     אימות ביט-מול-ביט של הפומבי הנגזר מול רשות-ה-active החיה לפני כל שידור.
//   · השידור: steemBroadcast (steem.broadcast.sendAsync) — הדפוס המוכח
//     של קו-העוגן (graphene.ts), כמו ב-/api/publish (R98: sendAsync הוא
//     מקור-האמת היחיד; callback של steem-js אינו אמין).
//   · הכנות: אין זיוף — מדידה חיה מהשרשרת; נכשל מקור = null + הערה;
//     סירוב כנה כשאין מה לתבוע (מניעת-אבק: סף מקבילת-SP).
//
// GET  — מדידה בלבד: התגמולים-הממתינים של חשבון-הרשת (בלי שום חומר-מפתח
//        בתשובה) + מקבילת-SP של ה-VESTS הממתינים דרך יחס
//        total_vesting_fund_steem/total_vesting_shares מהפרופס הגלובלי.
// POST — שידור claim_rewards אמת: קורא חי את הממתינים בתוך ה-POST,
//        תובע בדיוק את הממתין (עד 100% מכל רכיב), מדווח קבלה ל
//        sovereign/businesses/fuel-log.jsonl. שמירות:
//          · שמירת-אותיות-זהות (idempotence): קבלת-הצלחה אחרונה ב-23ש'
//            האחרונות ⇒ סירוב כנה (התביעה מול השרשרת אינה כפולה).
//          · שמירת-מוצא-זהה: header Origin שקיים ואינו אותו מארח ⇒ 403.
//          · אין-מפתח / אין-התאמה / אין-ממתין ⇒ סירוב כנה, אף-שידור.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import steem from "steem";
import type { GrapheneOperation } from "steem";
import { readOwnerSource, steemSigningWif } from "@/lib/owner-key";
import { evaluateBrake, brakeLogLine } from "@/lib/cognition/brake"; // R30: הבלם-הריבוני לפני-כל-שידור (trace 1a10d6f880df9255)
import { rpcV4, STEEM_RPC_NODES, steemBroadcast } from "@/lib/weave/graphene";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HOME = "/home/z/my-project";
const FUEL_LOG = path.join(HOME, "sovereign", "businesses", "fuel-log.jsonl");

/** סף-מניעת-אבק: מקבילת-SP מינימלית של ה-VESTS הממתינים כדי לשדר תביעה */
const CLAIM_THRESHOLD_SP = 0.1;
/** שמירת-אותיות-זהות: מרווח מינימלי בין תביעות-הצלחה (23 שעות) */
const CLAIM_MIN_GAP_MS = 23 * 60 * 60 * 1000;

// ── עזרי-מדידה ─────────────────────────────────────────────────────────

/** "0.000 STEEM" → 0 */
function num(amount: string | undefined | null): number {
  return Number.parseFloat(String(amount ?? "0").split(" ")[0] ?? "0") || 0;
}

interface DgpVesting {
  total_vesting_shares: string;
  total_vesting_fund_steem: string;
}

interface PendingClaim {
  ok: boolean;
  account: string | null;
  rewardSteem: number | null;
  rewardSbd: number | null;
  rewardVests: number | null;
  spEquivalent: number | null;
  claimThresholdSp: number;
  claimable: boolean;
  measuredAt: string;
  source: string | null;
  error: string | null;
  noteHe: string | null;
}

/** מדידה חיה של התגמולים-הממתינים — fail-soft: מקור-נכשל מדווח null, לא מומצא */
async function measurePending(): Promise<PendingClaim> {
  const owner = readOwnerSource();
  const account = owner?.account ?? null;
  const base: PendingClaim = {
    ok: false,
    account,
    rewardSteem: null,
    rewardSbd: null,
    rewardVests: null,
    spEquivalent: null,
    claimThresholdSp: CLAIM_THRESHOLD_SP,
    claimable: false,
    measuredAt: new Date().toISOString(),
    source: null,
    error: null,
    noteHe: null,
  };
  if (!account) {
    return { ...base, error: "NO-KEY: אין מקור-מפתח ריבוני — שם-החשבון לא נקרא, המדידה לא רצה" };
  }
  let lastErr = "";
  for (const node of STEEM_RPC_NODES) {
    try {
      const accounts = await rpcV4<Record<string, unknown>[]>(node, "condenser_api.get_accounts", [[account]]);
      const a = accounts?.[0];
      if (!a) {
        lastErr = "empty-accounts";
        continue;
      }
      const dgp = await rpcV4<DgpVesting>(node, "condenser_api.get_dynamic_global_properties", []);
      const vests = num(a.reward_vesting_balance as string);
      const tvs = num(dgp?.total_vesting_shares);
      const tvf = num(dgp?.total_vesting_fund_steem);
      const spEquivalent = tvs > 0 ? Math.round((vests / tvs) * tvf * 1e6) / 1e6 : null;
      const rewardSteem = num(a.reward_steem_balance as string);
      const rewardSbd = num(a.reward_sbd_balance as string);
      // סף-מניעת-אבק: מקבילת-SP מעל הסף — וגם רכיבי-מזומן אמיתיים (STEEM/SBD)
      // הם לא "אבק" ולא יידחו רק כי אין-VESTS ממתין. אפס מכל רכיב = לא ניתן לתביעה.
      const claimable = spEquivalent != null && (spEquivalent > CLAIM_THRESHOLD_SP || rewardSteem > 0 || rewardSbd > 0);
      return {
        ...base,
        ok: true,
        rewardSteem,
        rewardSbd,
        rewardVests: vests,
        spEquivalent,
        claimable,
        source: node,
        error: null,
        noteHe:
          !claimable && rewardSteem === 0 && rewardSbd === 0 && vests === 0
            ? "אין תגמולים-ממתינים בשרשרת — אין מה לתבוע (מדידה חיה, לא הנחה)"
            : claimable
              ? "יש מה לתבוע — POST יתבע בדיוק את הממתין (עד 100% מכל רכיב)"
              : `מקבילת-SP מתחת לסף-מניעת-האבק (${CLAIM_THRESHOLD_SP} SP) ואין רכיבי-מזומן — סירוב-אבק כנה`,
      };
    } catch (e) {
      lastErr = String((e as Error)?.message ?? e).slice(0, 120);
    }
  }
  return { ...base, error: `steem-rpc-unreachable (${lastErr}) — מדווח null בכנות, לא מומצא` };
}

// ── יומן-התביעות (קבלות) ────────────────────────────────────────────────

interface FuelLogEntry {
  at: string;
  account?: string;
  event?: string;
  claimed?: { steem: number; sbd: number; vests: number };
  txid?: string | null;
  endpoint?: string | null;
  latencyMs?: number;
  error?: string | null;
}

function readFuelLog(): FuelLogEntry[] {
  try {
    const raw = fs.readFileSync(FUEL_LOG, "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as FuelLogEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is FuelLogEntry => x != null);
  } catch {
    return [];
  }
}

function appendFuelLog(entry: FuelLogEntry): void {
  try {
    fs.mkdirSync(path.dirname(FUEL_LOG), { recursive: true });
    fs.appendFileSync(FUEL_LOG, `${JSON.stringify(entry)}\n`);
  } catch {
    /* יומן שלא נכתב לא מזויף שידור — התשובה נושאת את הקבלה בכנות */
  }
}

/** חותמת-זמן של תביעת-ההצלחה האחרונה (txid אמיתי) — לשמירת-ה-23ש' */
function lastSuccessfulClaimAt(): number | null {
  let last: number | null = null;
  for (const e of readFuelLog()) {
    if (!e.txid) continue;
    const t = Date.parse(e.at);
    if (Number.isFinite(t) && (last == null || t > last)) last = t;
  }
  return last;
}

// ── שמירת-מוצא-זהה: Origin שקיים ושונה-מארח ⇒ נדחה ─────────────────────

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // קריאה תוך-מארח (הדיבון/מסוף) — בלי header-מוצא
  try {
    const host = req.headers.get("host") ?? new URL(req.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// ── GET — מדידה בלבד, אפס חומר-מפתח בתשובה ─────────────────────────────

export async function GET() {
  const measured = await measurePending();
  return NextResponse.json(measured, { headers: { "cache-control": "no-store" } });
}

// ── POST — שידור claim_rewards אמת ─────────────────────────────────────

function refuse(status: number, code: string, he: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, code, he, at: new Date().toISOString(), ...extra }, { status });
}

export async function POST(req: Request) {
  // 1) שמירת-מוצא-זהה — בקשה חוצת-מוצא נדחית לפני כל דבר אחר
  if (!sameOrigin(req)) {
    return refuse(403, "CROSS-ORIGIN", "בקשה חוצת-מוצא נדחית — התביעה מותרת מאותו-מארח בלבד");
  }

  // 2) שמירת-אותיות-זהות: תביעת-הצלחה ב-23ש' האחרונות ⇒ סירוב כנה
  const lastClaim = lastSuccessfulClaimAt();
  if (lastClaim != null && Date.now() - lastClaim < CLAIM_MIN_GAP_MS) {
    const hoursAgo = Math.round(((Date.now() - lastClaim) / 3_600_000) * 10) / 10;
    return refuse(409, "ALREADY-CLAIMED", `תביעת-הצלחה רשומה לפני ${hoursAgo} ש' (קבלה ב-fuel-log) — תביעה כפולה אסורה; המתינו ל-23ש'`, {
      lastClaimAt: new Date(lastClaim).toISOString(),
    });
  }

  // 3) המפתח: תפקיד active — בזיכרון-ההרצה בלבד (מצב-אב גוזר toWif; אין-מקור = סירוב)
  const owner = readOwnerSource();
  if (!owner) {
    return refuse(409, "NO-KEY", "אין מקור-מפתח ריבוני — אין חתימת-active, שום דבר לא שודר. סירוב-כנה.");
  }
  const signing = steemSigningWif("active", owner.account);
  if (!signing) {
    return refuse(409, "NO-SIGNING", "לא נגזר WIF-active ממקור-המפתח — אין חתימה. שום דבר לא שודר. סירוב-כנה.");
  }

  // 4) מדידה חיה בתוך ה-POST — תובעים בדיוק את הממתין, לא את הזיכרון
  const measured = await measurePending();
  const rewardSteem = measured.rewardSteem;
  const rewardSbd = measured.rewardSbd;
  const rewardVests = measured.rewardVests;
  if (!measured.ok || rewardSteem == null || rewardSbd == null || rewardVests == null) {
    return refuse(503, "UNMEASURED", `המדידה החיה נכשלה — לא משדרים על-סמך זיכרון. ${measured.error ?? ""}`, {
      measured: { ...measured, claimable: false },
    });
  }
  const pendingZero = rewardSteem === 0 && rewardSbd === 0 && rewardVests === 0;
  if (pendingZero || !measured.claimable) {
    return refuse(409, "NOTHING-PENDING", "אין תגמולים-ממתינים מעל סף-האבק — אין שידור תביעה. מדידה חיה, סירוב-כנה (זו ההתנהגות-הנכונה).", {
      measured: { ...measured },
    });
  }

  // 5) דוקטרינת R75: המפתח מכריז את החותם — אימות הפומבי הנגזר מול רשות-ה-active החיה
  try {
    const liveAccounts = await rpcV4<Record<string, unknown>[]>(
      measured.source ?? STEEM_RPC_NODES[0]!,
      "condenser_api.get_accounts",
      [[owner.account]],
    );
    const liveActive = (liveAccounts?.[0]?.active as { key_auths?: string[][] } | undefined)?.key_auths?.[0]?.[0];
    const derivedPub = steem.auth.wifToPublic(signing.wif);
    if (!liveActive || derivedPub !== liveActive) {
      return refuse(409, "KEY-MISMATCH", "ה-WIF שנגזר אינו תואם את רשות-ה-active החיה בשרשרת — שום דבר לא שודר. סירוב-כנה.");
    }
  } catch (e) {
    return refuse(503, "AUTHORITY-UNREACHABLE", `רשות-ה-active החיה לא נאמתה (${String((e as Error)?.message ?? e).slice(0, 80)}) — לא משדרים על-סמך אמון-עיוור`);
  }

  // 5b) R30 — הבלם-הריבוני בשפת-החתימה: STASIS + lane-guards (close-only), fail-closed, אפס-סודות.
  const brake = evaluateBrake("money-claim");
  console.log(brakeLogLine(brake));
  if (brake.halt) {
    return refuse(423, "CAPITAL-BRAKE-HALT", `הבלם-הריבוני עצר את מסילת-התביעות לפני השידור — אפס פעולות. סירוב-כנה. ${brake.reasons.join(" | ").slice(0, 240)}`, { lane: brake.lane, reasons: brake.reasons });
  }

  // 6) שידור claim_rewards — האופ הראשון שלו בקודבייס; sendAsync (דפוס R98)
  const ops = [
    [
      "claim_rewards",
      {
        account: owner.account,
        reward_steem: `${rewardSteem.toFixed(3)} STEEM`,
        reward_sbd: `${rewardSbd.toFixed(3)} SBD`,
        reward_vesting_shares: `${rewardVests.toFixed(6)} VESTS`,
      },
    ],
  ] as GrapheneOperation[];

  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    steemBroadcast(ops, signing.wif),
    new Promise<{ txid: null; note: string }>((_, reject) => {
      timer = setTimeout(() => reject(new Error("broadcast-timeout-45s")), 45_000);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  const latencyMs = Date.now() - startedAt;
  const txid = result.txid;

  // 7) קבלה כנה ליומן-הדלק — גם כישלון נרשם, לא נבלע
  const receipt: FuelLogEntry = {
    at: new Date().toISOString(),
    account: owner.account,
    claimed: { steem: rewardSteem, sbd: rewardSbd, vests: rewardVests },
    txid,
    endpoint: measured.source,
    latencyMs,
    ...(txid ? {} : { error: result.note ?? "broadcast-returned-no-txid" }),
  };
  appendFuelLog(receipt);

  if (!txid) {
    return refuse(502, "BROADCAST-FAILED", `השידור נכשל בכנות: ${String(result.note ?? "no-txid").slice(0, 160)}`, { receipt });
  }
  return NextResponse.json({
    ok: true,
    receipt,
    he: `claim_rewards שודר בהצלחה — ${rewardSteem.toFixed(3)} STEEM · ${rewardSbd.toFixed(3)} SBD · ${rewardVests.toFixed(6)} VESTS (מקבילת-SP נתבעה כולה)`,
  });
}
