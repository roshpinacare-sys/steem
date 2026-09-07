import { NextRequest, NextResponse } from "next/server";
import { getLiveAccount } from "@/lib/steem/steem-live";
import { getMarketSnapshot, EXEC_SIZE_SBD } from "@/lib/steem/market-snapshot";

export const dynamic = "force-dynamic";

/**
 * Console execution layer — prepare-only operation payloads (docs/CONSOLE_PLAN.md §5).
 * IRON RULE: the platform ASSEMBLES ops from live chain data; the operator signs
 * them elsewhere (steemlogin for posting/active ops, offline for owner ops).
 * This endpoint NEVER receives, stores, or proxies private keys.
 *
 * GET /api/ops/prepare?username=headcorner
 *   → { ok, username, chain, actions: [{ id, title, ready, keyAuth, summary,
 *        signUrl?, opJson?, recipe?, docs? }] }
 */

const RPC_URL = "https://api.steemit.com";
const SIGN_BASE = "https://steemlogin.com/sign";
const USERNAME_RE = /^[a-z0-9\-.]{3,16}$/i;

let rpcId = 500;
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++rpcId }),
    cache: "no-store",
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message ?? "RPC error"}`);
  return json.result as T;
}

function parseAsset(a: string | undefined | null): number {
  if (!a) return 0;
  return parseFloat(a.split(" ")[0]) || 0;
}

function enc(v: string): string {
  return encodeURIComponent(v);
}

interface RawAccount {
  name: string;
  reward_steem_balance: string;
  reward_sbd_balance: string;
  reward_vesting_balance: string;
}

export async function GET(req: NextRequest) {
  const username = (req.nextUrl.searchParams.get("username") ?? "headcorner")
    .trim()
    .replace(/^@/, "");
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ ok: false, error: "שם משתמש לא תקין" }, { status: 400 });
  }

  try {
    // Live data in parallel: account snapshot (prices/security) + raw rewards + market
    const [live, rawArr, snap] = await Promise.all([
      getLiveAccount(username),
      rpc<RawAccount[]>("condenser_api.get_accounts", [[username]]).catch(() => undefined),
      getMarketSnapshot(),
    ]);
    const rawAcc: RawAccount | undefined = Array.isArray(rawArr) ? rawArr[0] : undefined;

    if (!live.ok) {
      return NextResponse.json({ ok: false, error: live.error }, { status: 502 });
    }

    const chain = live.chain;
    const actions: unknown[] = [];

    // ── 1. Claim pending rewards (posting key) ────────────────────────────
    const rewardSteem = rawAcc?.reward_steem_balance ?? "0.000 STEEM";
    const rewardSbd = rawAcc?.reward_sbd_balance ?? "0.000 SBD";
    const rewardVests = rawAcc?.reward_vesting_balance ?? "0.000000 VESTS";
    const pendingUsd =
      parseAsset(rewardSteem) * chain.steemUsd +
      parseAsset(rewardSbd) * chain.sbdUsd +
      parseAsset(rewardVests) * chain.vest2sp * chain.steemUsd;
    const claimReady = parseAsset(rewardVests) + parseAsset(rewardSteem) + parseAsset(rewardSbd) > 0.0001;
    const claimSignUrl = claimReady
      ? `${SIGN_BASE}/claim-reward-balance?account=${enc(username)}&reward_steem=${enc(rewardSteem)}&reward_sbd=${enc(rewardSbd)}&reward_vests=${enc(rewardVests)}`
      : undefined;
    actions.push({
      id: "claim-rewards",
      title: "תביעת פרסים ממתינים",
      ready: claimReady,
      keyAuth: "posting",
      summary: claimReady
        ? `ממתין לתביעה: ${rewardVests} (${pendingUsd.toFixed(2)}$) — פעולת posting-key, אפס סיכון.`
        : "אין פרסים ממתינים כרגע — הפעולה תופיע כשיצטברו.",
      signUrl: claimSignUrl,
      opJson: claimReady
        ? [
            [
              "claim_reward_balance",
              {
                account: username,
                reward_steem: rewardSteem,
                reward_sbd: rewardSbd,
                reward_vesting: rewardVests,
              },
            ],
          ]
        : undefined,
      docs: "docs/KEY_CAPABILITIES.md §4",
    });

    // ── 2. Authority hygiene (owner — offline only, NEVER a sign link) ────
    const stale = live.security.staleAuths;
    actions.push({
      id: "authority-hygiene",
      title: "ניקוי הרשאות posting מיושנות",
      ready: stale > 0,
      keyAuth: "owner-offline",
      summary:
        stale > 0
          ? `${stale} הרשאות מיושנות זוהו (${live.security.postingAuths.length} סה"כ) — נדרשת חתימת owner אופליין לפי מדריך 4 השלבים. לא ניתן לחתום מקוון מסיבות אבטחה.`
          : "כל ההרשאות נקיות — אין פעולה נדרשת.",
      docs: "docs/KEY_CAPABILITIES.md §5",
    });

    // ── 3. BOT-3 convert recipe (active key) — operative feed vs market bids ──
    const feed = snap.feed;
    const marketBid = snap.bidTop;
    const edgeInternalPct = snap.edgeInternalPct;
    const execEdge = snap.execEdgePct;
    const convertReady = execEdge > 3 && snap.openExec;
    const exampleSbd = EXEC_SIZE_SBD;
    const orderid = Date.now() % 1000000000;
    actions.push({
      id: "convert-cycle",
      title: "BOT-3 — מחזור המרה SBD→STEEM",
      ready: convertReady,
      keyAuth: "active",
      summary: convertReady
        ? `החלון פתוח: feed מפעיל ${feed.toFixed(4)} מול bid ${marketBid.toFixed(5)} — edge ניתן-לביצוע ב-${exampleSbd} SBD: ${execEdge >= 0 ? "+" : ""}${execEdge.toFixed(1)}% למחזור 3.5 יום. אימות feed חוזה סמוך לביצוע.`
        : `החלון סגור כרגע (feed מפעיל ${feed.toFixed(4)} מול bid ${marketBid.toFixed(5)} = ${edgeInternalPct.toFixed(1)}% ספר-על, ${execEdge.toFixed(1)}% ניתן-לביצוע) — המתכון יוצג רק כשייפתח. הסייר ב-HQ מדגום כל 5 דק'.`,
      signUrl: convertReady
        ? `${SIGN_BASE}/convert?owner=${enc(username)}&orderid=${orderid}&amount=${enc(`${exampleSbd} SBD`)}`
        : undefined,
      recipe: {
        feedSbdPerSteem: Number(feed.toFixed(6)),
        marketAskSbdPerSteem: Number(marketBid.toFixed(6)),
        steemPerSbd: Number(snap.steemPerSbd.toFixed(3)),
        edgeInternalPct: Number(edgeInternalPct.toFixed(2)),
        execEdgePct: execEdge,
        vol24hSbd: snap.vol24h?.sbd ?? null,
        steps: [
          "קניית SBD (חוץ בבורסה / פנימי בספר ההזמנות)",
          "convert — הפירעון לפי current_median_history בזמן הפירעון (3.5 יום)",
          "מכירת ה-STEEM לתוך פקודות הקנייה (bids) — לא דרך ה-ask",
          "רישום התוצאה ביומן ההון + מחזור חוזר אם החלון עוד פתוח",
        ],
        risks: [
          "הפירעון לפי ה-feed בזמן הפירעון — העדים עשויים להעלות את הציטוט ולסגור את הפער (החלון עצמי-מתקן)",
          "חשיפת מחיר STEEM ל-3.5 ימים",
          "עומק ה-bids מוגבל — מעל ~100 SBD ה-edge נשחק (VWAP)",
          `נפח מסחר אמיתי ב-24 שע': ${snap.vol24h ? `${snap.vol24h.sbd.toFixed(0)} SBD / ${snap.vol24h.trades} עסקאות` : "לא זמין"} — שוק דק`,
        ],
      },
      docs: "docs/ROAST.md §3 + docs/EXPLORATION_WAVE4.md §1 (מתוקן)",
    });

    // ── 4. Witness alliance (posting key) — per-witness sign template ─────
    actions.push({
      id: "witness-alliance",
      title: "ברית-עדים (S7) — הצבעה לעדים",
      ready: true,
      keyAuth: "posting",
      summary:
        "מילוי 30 מקומות ההצבעה לעדים איכותיים-מתואמים. תבנית קישור חתימה לכל עד — החלף את שם העד:",
      signTemplate: `${SIGN_BASE}/account-witness-vote?account=${enc(username)}&witness={WITNESS}&approve=true`,
      opJson: [
        [
          "account_witness_vote",
          { account: username, witness: "{WITNESS}", approve: true },
        ],
      ],
      docs: "docs/SOLO_MODEL_PLAYBOOK.md S7",
    });

    // ── 5. SP rental delegation (active key) — chain-MEASURED market ──────
    // Measurement: .zscripts/rental_scan.py (READ-ONLY, chain-only, 2026-09-02):
    // upvu verified as active delegation receiver (671,776 SP inflow observed in a
    // 10.2-day window); 13/13 sampled delegators with CURRENT delegations are paid
    // DAILY in STEEM (streaks of 281/282 days); observed APR median 4.15% (2.0–6.0%).
    // The advertised "15-17% APR" was REFUTED by direct measurement — docs/RENTAL_SCAN.md.
    const RENTAL = {
      delegatee: "upvu",
      aprMedianPct: 4.15,
      aprRangePct: [2.0, 6.0] as const,
      measuredAt: "2026-09-02",
    };
    const rentalSp = 1000; // offered default — operator can lower/raise before signing
    const vestsForSp = chain.vest2sp > 0 ? rentalSp / chain.vest2sp : 0;
    const rentalSteemYr = rentalSp * (RENTAL.aprMedianPct / 100);
    actions.push({
      id: "rental-delegation",
      title: "השכרת SP ראשונה — delegate ל-upvu",
      ready: vestsForSp > 0,
      keyAuth: "active",
      summary: vestsForSp > 0
        ? `שוק ההשכרה נמדד מהשרשרת (${RENTAL.measuredAt}): APR נצפה מרוכז ${RENTAL.aprMedianPct}% (טווח ${RENTAL.aprRangePct[0]}–${RENTAL.aprRangePct[1]}%), תשלום יומי ב-STEEM, 13/13 דוגמאות משלמות. הצעה: ${rentalSp.toLocaleString()} SP → ~${rentalSteemYr.toFixed(0)} STEEM/שנה במדידה המרוכזת. ה-SP נשאר רכושך — שיבה מלאה תוך ~5 ימים מביטול.`
        : "לא זמין — שיעור המרה VESTS לא נקרא.",
      signUrl: vestsForSp > 0
        ? `${SIGN_BASE}/delegate-vesting-shares?delegator=${enc(username)}&delegatee=${RENTAL.delegatee}&vesting_shares=${enc(`${vestsForSp.toFixed(6)} VESTS`)}`
        : undefined,
      opJson: vestsForSp > 0
        ? [["delegate_vesting_shares", { delegator: username, delegatee: RENTAL.delegatee, vesting_shares: `${vestsForSp.toFixed(6)} VESTS` }]]
        : undefined,
      recipe: {
        amountSp: rentalSp,
        amountVests: Number(vestsForSp.toFixed(0)),
        delegatee: RENTAL.delegatee,
        aprMedianObservedPct: RENTAL.aprMedianPct,
        aprRangeObservedPct: RENTAL.aprRangePct,
        expectedSteemPerYear: Number(rentalSteemYr.toFixed(1)),
        steps: [
          "לחתום delegate_vesting_shares מהקישור (active key) — אין צורך ב-SP נזיל, ההקצאה ישירות מה-SP המנופח",
          "התשלום היומי מגיע מ-upvu.bank (נמדד: 333 תשלומים/יום מהחשבון הזה)",
          "רישום התשלום הראשון ביומן ההון כ-CapitalEvent",
          "ביטול בכל רגע — ה-SP חוזר אחרי ~5 ימי המתנה",
        ],
        risks: [
          `תשואה נמוכה משמעותית מהמפורסם: נמדדו ${RENTAL.aprMedianPct}% מרוכז, לא 15% — התיקון מעוגן ב-docs/RENTAL_SCAN.md`,
          "עלות-אלתרות: ה-SP המוקצה לא מייצר קוראציה ביניים (קוראציה נמדדה 3.3–7.6% — בטווח דומה; ההשכרה היא אפס-מאמץ ותשלום ודאי יומי)",
          "סיכון-מפעיל: תלות ב-upvu כמשלם — נמדד אמין (רצפי תשלום של חודשים), אך מדובר בשירות חוץ-פרוטוקול; ההקצאה עצמה מוגנת בפרוטוקול",
        ],
      },
      docs: "docs/RENTAL_SCAN.md",
    });

    // ── 6. RC empirical test — claim_account (active key) ──────────────────
    // Chain evidence (rental_scan 2026-09-02): upvu performed 2,809 claim_account ops
    // in a 10.2-day window (~275/day), justyy ~165/day — account factories run at
    // industrial scale, so the RC→accounts→sale vector is alive. The exact RC cost
    // is NOT verifiable read-only; one signed claim closes that truth-gap (ROAST §6.1).
    const rcMax = live.power?.rcMax ?? 0;
    const rcMaxStr = rcMax > 0 ? `${(rcMax / 1e12).toFixed(1)}×10¹² RC` : "לא זמין";
    actions.push({
      id: "rc-claim-test",
      title: "בדיקת RC אמפירית — claim_account אחד",
      ready: true,
      keyAuth: "active",
      summary: `מסלול הכסף היחיד מאפס הון שנותר בלתי-מאומת: RC → חשבונות → מכירה. הראיות מהשרשרת: upvu ~275 claim_account/יום, justyy ~165/יום — המפעלים עובדים. עלות ה-RC לא ניתנת לאימות קריא-בלבד — חתימה אחת סוגרת את פער-האמת: ההפרש בתקציב ה-RC (כרגע ${rcMaxStr}, 100%) הוא העלות המדויקת, ו-pending_claimed_accounts יעלה ל-1.`,
      signUrl: `${SIGN_BASE}/claim-account?creator=${enc(username)}&fee=${enc("0.000 STEEM")}`,
      opJson: [["claim_account", { creator: username, fee: "0.000 STEEM", extensions: [] }]],
      recipe: {
        rcBudgetBefore: rcMax,
        steps: [
          "שמור תמונת מצב לפני: /api/steem/live?username= — power.rcPct/rcMax (עכשיו 100%)",
          "חתום claim_account עם fee=0.000 STEEM (התשלום ב-RC בלבד, active key)",
          "מדוד אחרי: ההפרש ב-RC = העלות האמיתית לחשבון; get_accounts → pending_claimed_accounts=1 מאמת",
          "עדכן את משימת הראנבוק בעלות — ואז ROI: חשבונות/יום אפשריים מהתקציב × מחיר-שוק-חוץ (לא מאומת)",
        ],
        risks: [
          "עלות ה-RC על claim_account גבוהה יחסית לאופס אחרים — זה בדיוק מה שהבדיקה מודדת לפני כל התחייבות",
          "מחיר מכירת חשבונות הוא שוק-חוץ לא מאומת — אין להניח ערך עד סריקה יזומה",
          "החשבון הנתבע נשאר ב-pending_claimed_accounts עד create_claimed_account — לא נזיל ביניים",
        ],
      },
      docs: "docs/ROAST.md §3 שורה 6 + docs/RAIL_PLAY_BRIEF.md",
    });

    return NextResponse.json({
      ok: true,
      username,
      fetchedAt: new Date().toISOString(),
      chain: {
        steemUsd: chain.steemUsd,
        sbdUsd: chain.sbdUsd,
        headBlock: chain.headBlock,
        vest2sp: chain.vest2sp,
        feedSbdPerSteem: Number(feed.toFixed(6)),
        marketAskSbdPerSteem: Number(marketBid.toFixed(6)),
        edgeInternalPct: Number(edgeInternalPct.toFixed(2)),
      },
      actions,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת RPC" },
      { status: 502 },
    );
  }
}
