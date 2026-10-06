// ─────────────────────────────────────────────────────────────────────
// /api/hunter — ציד ההזדמנויות הריבוני (R82 · THE HUNTER).
//
// הוראת המפעיל שיצרה את ה-API: "המערכת צריכה להיות דינמית ומבינה
// בשוק חי ולא לחכות אלא לפעול ותמיד לחפש הזדמנויות טובות יותר מתוך
// מה שיש לנו ברשת... שברגע שבאמת יפתח השער הכל יזרום באופן
// שוטף איכותי ולגיטימי."
//
// ה-API מרכיב את לוח הציד ממדידות חיות בלבד — שום סטטוס מומצא:
//   · הקנרית — הדלקת שער-הדקות: עבודת-echo בת-שניות במחסן הפרטי.
//     אם היא נכשלת בלי צעד אחד — הדקות אזלו (הוכחה חיה, לא טענה).
//   · שערים — פאריטה · חימוש SBD · פדיון TRX · מסלול פאוורדאון.
//   · לוח הזדמנויות — מדורג, כל שורה עם המספר הנמדד ומה המערכת
//     עושה עכשיו (אוטונומיה מלאה או שער-מפעיל — בכנות).
//   · אמת-תשתית — מלאי המחסנים, הרצות אמת (ציבוריות מול פרטיות),
//     התפלגות סודות (שמות בלבד), ודפי-הענן החיים.
//
// ה-PAT נקרא בצד-השרת בלבד (upload/pat.env) ולעולם לא מוחזר
// בתשובה. הכל מטומן-SWR עם כנות מלאה (cached/stale/cacheAgeSec).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { swrGet, cacheHeader } from "@/lib/live/swr";
import { headOk } from "@/lib/live/head-check";

export const dynamic = "force-dynamic";

const PAT_FILE = "/home/z/my-project/upload/pat.env";
const GH = "https://api.github.com";
const ORG = "roshpinacare-sys";
const PAGES_CONSOLE = "https://roshpinacare-sys.github.io/Console/";
const PAGES_DOMAIN = "https://roshpinacare-sys.github.io/Domain/";

// ── חוזה הנתונים ───────────────────────────────────────────────────

interface Gate {
  id: "minutes" | "parity" | "sbd" | "trx" | "powerdown";
  title: string;
  state: "OPEN" | "CLOSED" | "ARMED" | "WAIT" | "UNKNOWN";
  number: string;
  detail: string;
  opensWhen: string;
  flowsWhen: string;
  evidence: Record<string, string | number | null>;
}

interface Opportunity {
  id: string;
  title: string;
  state: "HUNTING" | "ARMED" | "GATED" | "FLOWING" | "WAITING" | "STALLED";
  number: string;
  detail: string;
  action: string;
  autonomy: "מלאה" | "שער-מפעיל";
  rank: number;
}

interface HunterPayload {
  ok: boolean;
  at: string;
  daemon: {
    alive: boolean;
    beats: number;
    scanIntervalSec: number;
    lastScanAt: string | null;
    lastDecision: { at: string; kind: string; detail: string } | null;
    canonLast: { at: string; ok: boolean; path: string } | null;
  } | null;
  canary: {
    lastRun: { id: number; conclusion: string | null; createdAt: string; stepsRun: number } | null;
    lastSuccessAt: string | null;
    nextDueAt: string | null;
  } | null;
  gates: Gate[];
  opportunities: Opportunity[];
  infra: {
    repos: {
      total: number;
      privateCount: number;
      publicCount: number;
      totalSizeKb: number;
      items: Array<{ name: string; visibility: string; pushedAt: string; sizeKb: number }>;
    };
    runs: {
      publicEvidence: Array<{ repo: string; name: string; conclusion: string | null; createdAt: string }>;
      privateEvidence: Array<{ repo: string; name: string; conclusion: string | null; createdAt: string }>;
    };
    secrets: Array<{ repo: string; count: number; names: string[] }>;
    pages: Array<{ name: string; url: string; live: boolean; httpStatus: number | null }>;
  };
  money: {
    ok: boolean;
    parity: number | null;
    deployedSteem: number;
    idleSteem: number;
    bestBid: number | null;
    distanceBps: number | null;
    sbdBalance: number;
    powerdown: {
      nextPayment: string;
      paymentsLeft: number;
      totalRemainingSteem: number;
      weeklySteem: number;
    } | null;
    redemption: { outboxTrx: number; sendThresholdTrx: number; verdict: string } | null;
    staleHours: number | null;
  };
  treasury: { ok: boolean; usdTotal: number | null; usdLiquid: number | null };
  pulse: { alive: boolean; nextDueAt: string | null } | null;
}

// ── עזרים ───────────────────────────────────────────────────────────

function readPat(): string {
  try {
    return readFileSync(PAT_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

function ghHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function jfetch<T>(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<T | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── חיישנים ─────────────────────────────────────────────────────────

interface DaemonState {
  ok?: boolean;
  alive?: boolean;
  beats?: number;
  scanIntervalSec?: number;
  lastScanAt?: string | null;
  lastDecision?: { at: string; kind: string; detail: string } | null;
  canonLast?: { at: string; ok: boolean; path: string } | null;
  canary?: {
    lastRun?: { id: number; conclusion: string | null; createdAt: string; stepsRun: number } | null;
    lastSuccessAt?: string | null;
    nextDueAt?: string | null;
    gate?: "OPEN" | "QUOTA-DEAD";
  };
}

interface MoneySense {
  ok: boolean;
  marks?: { parity: number | null; steemUsd?: number; sbdUsd?: number };
  balances?: { steem?: number; sbd?: number };
  book?: { bestBid?: number | null };
  orders?: Array<{ orderid: number; amount: number; price: number; vsParityBps: number | null }>;
  deployedSteem?: number;
  idleSteem?: number;
  powerdown?: { active: boolean; weeklySteem: number; nextPayment: string; paymentsLeft: number; totalRemainingSteem: number };
  sbdArming?: { balance: number; needed: number; commitable: number; state: string };
  redemption?: { outboxTrx: number; custodyTrx: number; sendThresholdTrx: number; verdict: string };
  diagnosis?: { staleHours: number };
}

interface TreasurySense {
  ok: boolean;
  usd?: { total: number; liquid: number; vesting: number };
}

interface PulseSense {
  ok?: boolean;
  alive?: boolean;
  nextDueAt?: string | null;
}

interface GhRepo {
  name: string;
  visibility?: string;
  private?: boolean;
  pushed_at?: string;
  size?: number;
}

interface GhRun {
  name?: string;
  conclusion?: string | null;
  created_at?: string;
}

// ── ההרכבה ──────────────────────────────────────────────────────────

async function buildBoard(): Promise<HunterPayload> {
  const pat = readPat();

  // ① צייד + מוביל + אוצר + דופק — חיישנים מקומיים
  const [daemon, money, treasury, pulse] = await Promise.all([
    jfetch<DaemonState>("http://localhost:3035/", undefined, 4000),
    jfetch<MoneySense>("http://localhost:3000/api/money", undefined, 60_000),
    jfetch<TreasurySense>("http://localhost:3000/api/treasury", undefined, 60_000),
    jfetch<PulseSense>("http://localhost:3033/", undefined, 2500),
  ]);

  // ② מלאי-המחסנים — מדידת GitHub חיה (הרשימה דורשת PAT כי רוב המחסנים פרטיים)
  const reposSwr = await swrGet("hunter:repos", 5 * 60_000, async () => {
    const named = ["Zip", "Console", "Domain", "steem", "saos-dex", "Defi", "saos-sovereign-foundry",
      "Adsmarket", "anchor-baseline", "roshpina", "Sdk", "saos-jummper", "Project-files",
      "saos-control-center", "saos-sovereign-platform", "Saosmartwallet"];
    const items: GhRepo[] = [];
    if (pat) {
      const listed = await jfetch<GhRepo[]>(`${GH}/users/${ORG}/repos?per_page=100&type=all`, { headers: ghHeaders(pat) });
      if (listed && listed.length > 0) items.push(...listed);
      const have = new Set(items.map((r) => r.name));
      for (const n of named) {
        if (have.has(n)) continue;
        const r = await jfetch<GhRepo>(`${GH}/repos/${ORG}/${n}`, { headers: ghHeaders(pat) });
        if (r) items.push(r);
      }
    }
    return items;
  });

  // ③ הרצות-אמת — הצד הציבורי מול הצד הפרטי (הוכחת הפיצול)
  const runsSwr = await swrGet("hunter:runs", 5 * 60_000, async () => {
    const evidence = async (repo: string) => {
      const d = pat
        ? await jfetch<{ workflow_runs?: GhRun[] }>(
            `${GH}/repos/${ORG}/${repo}/actions/runs?per_page=1`,
            { headers: ghHeaders(pat) },
          )
        : null;
      const r = d?.workflow_runs?.[0];
      return r
        ? { repo, name: r.name ?? "?", conclusion: r.conclusion ?? null, createdAt: r.created_at ?? "?" }
        : null;
    };
    const [consoleRun, domainRun, zipRun, steemRun] = await Promise.all([
      evidence("Console"),
      evidence("Domain"),
      evidence("Zip"),
      evidence("steem"),
    ]);
    return {
      publicEvidence: [consoleRun, domainRun].filter((x): x is NonNullable<typeof x> => x != null),
      privateEvidence: [zipRun, steemRun].filter((x): x is NonNullable<typeof x> => x != null),
    };
  });

  // ④ התפלגות הסודות — שמות בלבד (ערכים לעולם לא נקראים)
  const secretsSwr = await swrGet("hunter:secrets", 30 * 60_000, async () => {
    const repos = ["Zip", "Console", "steem", "saos-dex", "Defi", "Saosmartwallet", "saos-control-center"];
    const out: Array<{ repo: string; count: number; names: string[] }> = [];
    for (const repo of repos) {
      const d = pat
        ? await jfetch<{ secrets?: Array<{ name: string }> }>(
            `${GH}/repos/${ORG}/${repo}/actions/secrets`,
            { headers: ghHeaders(pat) },
          )
        : null;
      const names = (d?.secrets ?? []).map((s) => s.name).sort();
      out.push({ repo, count: names.length, names });
    }
    return out;
  });

  // ⑤ דפי-הענן החיים
  const pagesSwr = await swrGet("hunter:pages", 5 * 60_000, async () => {
    const [consolePage, domainPage] = await Promise.all([
      headOk(PAGES_CONSOLE),
      headOk(PAGES_DOMAIN),
    ]);
    return [
      { name: "Console (ציבורי)", url: PAGES_CONSOLE, ...consolePage },
      { name: "Domain (ציבורי)", url: PAGES_DOMAIN, ...domainPage },
    ];
  });

  // ⑥ מלאי-המחסנים
  const repoItems = reposSwr.value
    .map((r) => ({
      name: r.name,
      visibility: r.visibility ?? (r.private ? "private" : "public"),
      pushedAt: r.pushed_at ?? "?",
      sizeKb: r.size ?? 0,
    }))
    .sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : -1));
  const privateCount = repoItems.filter((r) => r.visibility === "private").length;

  // ⑦ חישוב המרחק לפאריטה (ביד חי מול הסולם)
  const parity = money?.marks?.parity ?? null;
  const bestBid = money?.book?.bestBid ?? null;
  const distanceBps =
    parity != null && bestBid != null && bestBid > 0
      ? Math.round(((parity - bestBid) / bestBid) * 10_000)
      : null;

  // ⑧ שערים — כל שער עם מספר נמדד ומה זורם כשנפתח
  const canary = daemon?.canary ?? null;
  const canaryClosed =
    canary?.lastRun != null &&
    canary.lastRun.conclusion === "failure" &&
    canary.lastRun.stepsRun === 0;
  // R123 — חוק הקצב הנגזר: "בודק כל 6 שעות" היה נכון רק לשער פתוח. שער
  // מת (QUOTA-DEAD) נבדק יומית בבאסה כנה — הדיבון עצמו מודד וכותב את זה;
  // הנוסח כאן נגזר ממצב-השער שבמדידה, לא מזיכרון (המשך חוק r121/r122).
  const canaryGateDead = canary?.gate === "QUOTA-DEAD";
  const canaryCadenceHe = canaryGateDead
    ? "שער מת (חנקת-Actions) — הצייד בבאסה יומית כנה עד חידוש המכסה"
    : "הצייד בודק בקצב מדיניות (כל 6ש' בשער פתוח · 15דק' אחרי כישלון שליחה)";
  const gates: Gate[] = [
    {
      id: "minutes",
      title: "שער הדקות — הקנרית",
      state: canary?.lastSuccessAt ? "OPEN" : canaryClosed ? "CLOSED" : "UNKNOWN",
      number: canary?.lastRun
        ? `${canary.lastRun.conclusion ?? "?"} · ${canary.lastRun.stepsRun} צעדים`
        : "לא נמדד",
      detail: canaryClosed
        ? "עבודת-echo בת-שניות במחסן הפרטי Defi נכשלה בלי שצעד אחד רץ — הראנר מעולם לא קם. זו חתימת דלדול-הדקות במחסנים הפרטיים (הציבוריים רצים חופשי)."
        : canary?.lastSuccessAt
          ? "הקנרית צייצה — לדקות חזרה זרימה ומנוע-הענן הופעל מחדש."
          : "הקנרית טרם מדדה — הצייד בודק.",
      opensWhen: canaryCadenceHe,
      flowsWhen: "מנועי-הענן (web-publish · weave-heart · anchor-lines) חוזרים לזרום מיד",
      evidence: {
        canaryRunId: canary?.lastRun?.id ?? null,
        canaryConclusion: canary?.lastRun?.conclusion ?? null,
        stepsRun: canary?.lastRun?.stepsRun ?? null,
        lastSuccessAt: canary?.lastSuccessAt ?? null,
        nextDueAt: canary?.nextDueAt ?? null,
      },
    },
    {
      id: "parity",
      title: "שער הפאריטה — הסולם על הקו",
      state: "ARMED",
      number: distanceBps != null ? `${distanceBps.toLocaleString("en-US")}bps` : "—",
      detail:
        parity != null
          ? `הסולם המלא (${money?.deployedSteem ?? 0} STEEM) יושב על קו הפאריטה החיה (${parity.toFixed(6)} SBD/STEEM). הביד החי רחוק ${distanceBps != null ? distanceBps.toLocaleString("en-US") : "?"}bps מתחת — השוק חייב לשלם ערך-חוץ כדי לגעת בכסף.`
          : "אין שער חי — המוביל לא פועל בלי מדידה (חוק הרצפה).",
      opensWhen: "ביד חוצה את קו הפאריטה — המוביל צד כל נגיעה",
      flowsWhen: "מילוי הסולם → SBD זורם → צד-הקנייה נחמש → עודף נמדד",
      evidence: { parity, bestBid, distanceBps, deployedSteem: money?.deployedSteem ?? 0 },
    },
    {
      id: "sbd",
      title: "חימוש צד-הקנייה (SBD)",
      state: money?.sbdArming?.state === "WAIT" ? "WAIT" : "ARMED",
      number: money?.sbdArming
        ? `${money.sbdArming.commitable.toFixed(3)}/${money.sbdArming.needed} SBD`
        : "—",
      detail:
        "כשהקופה תעבור את הסף — צד-הקנייה מתחת לפאריטה מתחמש: כל קנייה מתחת לקו היא עודף נמדד. השער נפתח רק ממילוי אמיתי, לא ממכירה מתחת לערך.",
      opensWhen: "מילוי ראשון של הסולם מזרים SBD מעל הסף",
      flowsWhen: "קניות-עודף מתחת לקו → היצע נקנה זול → הגלגל מתהדק",
      evidence: {
        balance: money?.sbdArming?.balance ?? null,
        needed: money?.sbdArming?.needed ?? null,
        commitable: money?.sbdArming?.commitable ?? null,
      },
    },
    {
      id: "trx",
      title: "פדיון המשמרת (TRON)",
      state: money?.redemption?.verdict === "WAIT" ? "WAIT" : "ARMED",
      number: money?.redemption
        ? `${money.redemption.outboxTrx.toFixed(3)}/${money.redemption.sendThresholdTrx} TRX`
        : "—",
      detail:
        "דלק-היציאה של המשמרת נאסף; כשיחצה את סף-השליחה — נתיב היציאה נפתח: משמרת → SunSwap → JustLend (אספקה). מעל סף-העלות הכלכלי בלבד.",
      opensWhen: "יתרת היציאה חוצה את סף השליחה",
      flowsWhen: "TRX נפדה → מסלול DeFi חוץ-רשתי ראשון נפתח",
      evidence: {
        outboxTrx: money?.redemption?.outboxTrx ?? null,
        threshold: money?.redemption?.sendThresholdTrx ?? null,
      },
    },
    {
      id: "powerdown",
      title: "מסלול הפאוורדאון — הדלק שמגיע",
      state: money?.powerdown?.active ? "ARMED" : "UNKNOWN",
      number: money?.powerdown
        ? `${money.powerdown.totalRemainingSteem.toFixed(0)} STEEM · עוד ${money.powerdown.paymentsLeft} תשלומים`
        : "—",
      detail: money?.powerdown
        ? `התשלום הבא (~${money.powerdown.weeklySteem.toFixed(1)} STEEM) נוחת ב-${money.powerdown.nextPayment.slice(0, 16).replace("T", " ")}Z — המוביל פורס אותו בתוך מחזור אחד (חוק 4).`
        : "לא נמדד",
      opensWhen: "נחיתת התשלום השבועי — אוטומטי",
      flowsWhen: "הדלק החדש נפרס לסולם על הקו — אפס המתנה",
      evidence: {
        nextPayment: money?.powerdown?.nextPayment ?? null,
        paymentsLeft: money?.powerdown?.paymentsLeft ?? null,
        remaining: money?.powerdown?.totalRemainingSteem ?? null,
      },
    },
  ];

  // ⑨ לוח ההזדמנויות — מדורג לפי מה שהמערכת עושה עכשיו
  // R122 · חוק הסטטוס הנמדד: אף שורה לא טוענת מצב-חי מהזיכרון — כל
  // state נגזר מהמדידה שבאותה שורה (סולם פרוס / פאוורדאון פעיל /
  // דפים חיים); לא נמדד = ממתין, לא זורם.
  const livePages = pagesSwr.value.filter((p) => p.live).length;
  const totalPages = pagesSwr.value.length;
  const opportunities: Opportunity[] = [
    {
      id: "ladder-fill",
      title: "מלכודת הפאריטה",
      state: money != null && (money.deployedSteem ?? 0) > 0 ? "HUNTING" : "WAITING",
      number: distanceBps != null ? `${distanceBps.toLocaleString("en-US")}bps` : "—",
      detail: "הסולם המלא על הקו — כל ביד שיחצה את הפאריטה נתפס מיד בשלוש רמות.",
      action: "המוביל בודק כל דקה · גורר את הסולם אם הקו זז >50bps",
      autonomy: "מלאה",
      rank: 1,
    },
    {
      id: "minutes-gate",
      title: "שער הדקות — הקנרית צדה",
      state: canary?.lastSuccessAt ? "FLOWING" : "HUNTING",
      number: canary?.nextDueAt
        ? `בדיקה הבאה ${canary.nextDueAt.slice(11, 16)}Z`
        : "—",
      detail: canaryGateDead
        ? "השער נמדח (חנקת-Actions) — הצייד בבאסה יומית כנה: גשאוש אחד ביום עד שהמכסה תחזור. ברגע שעבודת-echo תצליח — מנוע-הענן מופעל מיד."
        : "הצייד משגר עבודת-echo בקצב מדיניות (כל 6ש' בשער פתוח · 15דק' אחרי כישלון שליחה) למחסן הפרטי. ברגע שהיא מצליחה — מנוע-הענן מופעל מיד.",
      action: "קנרית אוטונומית · הפעלת web-publish עם הציוץ הראשון",
      autonomy: "מלאה",
      rank: 2,
    },
    {
      id: "fuel-in",
      title: "נחיתת הדלק הבאה",
      state: money?.powerdown?.active ? "ARMED" : "WAITING",
      number: money?.powerdown ? `~${money.powerdown.weeklySteem.toFixed(1)} STEEM` : "—",
      detail: "הפאוורדאון ממשיך לזרום — כל נחיתה נפרסת לסולם בתוך מחזור אחד של המוביל.",
      action: "טריגר T3/T4 במוביל — דלק נזיל נפרס אוטומטית",
      autonomy: "מלאה",
      rank: 3,
    },
    {
      id: "sbd-arming",
      title: "חימוש צד-הקנייה",
      state:
        money?.sbdArming && money.sbdArming.commitable >= money.sbdArming.needed ? "ARMED" : "GATED",
      number: money?.sbdArming
        ? `${money.sbdArming.commitable.toFixed(3)}/${money.sbdArming.needed} SBD`
        : "—",
      detail: "כל מילוי של הסולם מזרים SBD לקופה; מעל הסף — קניות-עודף מתחת לקו.",
      action: "ממתין למילוי אמיתי — השער הלגיטימי",
      autonomy: "מלאה",
      rank: 4,
    },
    {
      id: "trx-redemption",
      title: "פדיון המשמרת",
      state: "GATED",
      number: money?.redemption
        ? `${money.redemption.outboxTrx.toFixed(3)}/${money.redemption.sendThresholdTrx} TRX`
        : "—",
      detail: "נתיב היציאה החוץ-רשתי הראשון — נפתח רק מעל סף-העלות הכלכלי.",
      action: "הצופה מודד · הסף נבדק כל מחזור",
      autonomy: "שער-מפעיל",
      rank: 5,
    },
    {
      id: "pulse",
      title: "הדופק — השידור היומי",
      state: pulse?.alive ? "ARMED" : "WAITING",
      number: pulse?.nextDueAt ? `${pulse.nextDueAt.slice(0, 16).replace("T", " ")}Z` : "—",
      detail: "הרשת משדרת לשרשרת פעם ביום-UTC — עוגן-אמת שלא תלוי בקהל. אנחנו הקהל.",
      action: "הדופק מחליט לבד מתי לשדר · עד 3 ניסיונות ביום",
      autonomy: "מלאה",
      rank: 6,
    },
    {
      id: "public-mirrors",
      title: "מראות-הענן הציבוריות",
      // R122: "זורם" נגזר מהמדידה — כל הדפים חיים; דף מטופל = מתעכב,
      // לא זורם-מהזיכרון.
      state: totalPages > 0 && livePages === totalPages ? "FLOWING" : "STALLED",
      number: `${livePages}/${totalPages} חיות`,
      detail: "Console ו-Domain ממשיכות להיבנות ולהתפרסם על דקות-חינם ציבוריות — הפנים של הרשת לעולם.",
      action: "agents-watch · money-watch · moment-watch רצים — הוכחה חיה",
      autonomy: "מלאה",
      rank: 7,
    },
    {
      id: "idle-capital",
      title: "סריקת הון-נזיל",
      state: money && (money.idleSteem ?? 0) > 1 ? "STALLED" : "FLOWING",
      number:
        treasury?.usd != null
          ? `$${treasury.usd.liquid.toFixed(2)} נזיל · ${money?.idleSteem ?? 0} STEEM מחוץ לסולם`
          : "—",
      detail:
        money && (money.idleSteem ?? 0) > 1
          ? "יש דלק שיושב מחוץ לסולם — המוביל יפרוש אותו במחזור הבא (T3)."
          : "אפס הון ראשי מחוץ לעבודה: הסולם מלא, הנזיל מינימלי. שאר הרשתות נקראות בכל סריקה — כל הפקדה ≥$5 נתפסת.",
      action: "הצופה חסר-המפתחות קורא 4 רשתות כל 20 דקות",
      autonomy: "מלאה",
      rank: 8,
    },
  ];
  opportunities.sort((a, b) => a.rank - b.rank);

  return {
    ok: true,
    at: new Date().toISOString(),
    daemon: daemon?.alive
      ? {
          alive: true,
          beats: daemon.beats ?? 0,
          scanIntervalSec: daemon.scanIntervalSec ?? 600,
          lastScanAt: daemon.lastScanAt ?? null,
          lastDecision: daemon.lastDecision ?? null,
          canonLast: daemon.canonLast ?? null,
        }
      : null,
    canary: canary
      ? {
          lastRun: canary.lastRun ?? null,
          lastSuccessAt: canary.lastSuccessAt ?? null,
          nextDueAt: canary.nextDueAt ?? null,
        }
      : null,
    gates,
    opportunities,
    infra: {
      repos: {
        total: repoItems.length,
        privateCount,
        publicCount: repoItems.length - privateCount,
        totalSizeKb: repoItems.reduce((s, r) => s + r.sizeKb, 0),
        items: repoItems,
      },
      runs: runsSwr.value,
      secrets: secretsSwr.value,
      pages: pagesSwr.value,
    },
    money: {
      ok: money?.ok ?? false,
      parity,
      deployedSteem: money?.deployedSteem ?? 0,
      idleSteem: money?.idleSteem ?? 0,
      bestBid,
      distanceBps,
      sbdBalance: money?.sbdArming?.balance ?? 0,
      powerdown: money?.powerdown
        ? {
            nextPayment: money.powerdown.nextPayment,
            paymentsLeft: money.powerdown.paymentsLeft,
            totalRemainingSteem: money.powerdown.totalRemainingSteem,
            weeklySteem: money.powerdown.weeklySteem,
          }
        : null,
      redemption: money?.redemption ?? null,
      staleHours: money?.diagnosis?.staleHours ?? null,
    },
    treasury: {
      ok: treasury?.ok ?? false,
      usdTotal: treasury?.usd?.total ?? null,
      usdLiquid: treasury?.usd?.liquid ?? null,
    },
    pulse: pulse
      ? { alive: Boolean(pulse.alive), nextDueAt: pulse.nextDueAt ?? null }
      : null,
  };
}

export async function GET() {
  const swr = await swrGet("hunter:board", 60_000, buildBoard);
  return NextResponse.json(
    { ...swr.value, cached: swr.meta.cached, stale: swr.meta.stale, cacheAgeSec: swr.meta.cacheAgeSec },
    {
      headers: {
        "X-SAOS-Cache": cacheHeader(swr.meta),
        "Cache-Control": "no-store",
      },
    },
  );
}
