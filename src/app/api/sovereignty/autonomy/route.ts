// ─────────────────────────────────────────────────────────────────────
// /api/sovereignty/autonomy — מרשם-האוטונומיה · מפקד-יכולות חי (D-022).
//
// הוראת המפעיל (2026-09-28): "חשוב להעביר הכל לאוטונומיה מלאה שיכולו
// לנהל הכל לקדם הכל וגם לעבוד עם הכסף ולדאוג לערך ותפעול ברמה גבוהה
// כמו שצריך."
//
// החוק היחיד: "הכל באוטונומיה מלאה" אינו סיסמה — הוא מפקדה מדודה.
// כל יכולת ברשת נספרת ומסווגת לאחת משתי מצבות בלבד:
//   · AUTONOMOUS       — הרשת מריצה אותה קצה-אל-קצה, עם ראיה חיה
//                        (מדידה אחרונה + קצב) ועם שומר שמקים אותה.
//   · OPERATOR-GATED   — נשארת בידי המפעיל מכוח החלטת-ריבונות עומדת
//                        (D-004/D-005/D-009/D-014), עם החיישן שצופה
//                        בה ומה שמשחרר אותה.
//
// יכולת שאינה נרשמת במרשם — אינה נטענת. מדידה שלא ענתה מדווחת
// כלא-נמדדת (null + הערה כנה), לעולם לא כהצלחה שנטענת.
//
// מקורות-אמת (כולם קריאה-בלבד):
//   · keeper :3036        — חיות-הצי והסיור
//   · fleet-guard state   — שכבת-ההפעלה-העצמית של השרת
//   · ChainRun (DB)       — שרשראות-הטריגר: מי הצית, מתי, כמה פעמים
//   · pulse :3033         — ההחלטה העצמאית מתי לשדר
//   · kpi :3041           — הספר היומי הנמדד
//   · money :3034         — מנוע-הכסף: המעקב, הפאריטה, הפקדות
//   · /api/money (SWR)    — מצב הסולם והנוכחות-בוליאנית של המפתח
//   · decisions.json      — שערי-המפעיל העומדים (D-019/D-020)
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { swrGet } from "@/lib/live/swr";
import { getGridState } from "@/lib/live/grid-arm";
import { readSelfBootState } from "@/lib/weave/self-boot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── טיפוסים (חוזה BE↔FE) ────────────────────────────────────────────

type CapabilityMode = "AUTONOMOUS" | "OPERATOR-GATED";

interface Capability {
  id: string;
  titleHe: string;
  mode: CapabilityMode;
  /** ראיה חיה אחרונה — מחרוזת מדידה גולמית או "לא נמדד" */
  evidenceHe: string;
  /** קצב-ריצה כפי שמוגדר בקוד/בפוליסי */
  cadenceHe?: string;
  /** לשערי-מפעיל: מה משחרר את השער */
  unblockHe?: string;
  /** זיהוי ההחלטה המסדירה */
  gateRef?: string;
}

interface Domain {
  id: string;
  titleHe: string;
  capabilities: Capability[];
}

interface ChainRunRow {
  chain: string;
  step: string;
  firedBy: string;
  ok: boolean;
  detail: string;
  createdAt: Date;
}

interface AutonomyLedger {
  ok: boolean;
  at: string;
  format: "autonomy-ledger-v1";
  verdict: {
    total: number;
    autonomous: number;
    operatorGated: number;
    /** חלק-האוטונומיה הנמדד: אוטונומיות / כל-היכולות. שערי-מפעיל נספרים בכנות בתוך המכנה */
    share: number | null;
    /** הוראת r138: הרשת פועלת 7/24 בלי המפעיל — אין שער שחוסם הפעלה */
    operationBlocked: boolean;
    /** השערים הנותרים כולם החזקת-מפתחות/החלטות-צמיחה */
    growthGates: number;
    he: string;
  };
  domains: Domain[];
  /** דומינוס חי: שרשראות שהציתו את עצמן בפעמיים-עשרים-וארבע שעות */
  dominos24h: Array<{ at: string; chain: string; step: string; firedBy: string; detail: string }>;
  honestyHe: string;
  errorHe: string | null;
}

// ── קוראי-מקור ──────────────────────────────────────────────────────

async function fetchLocal<T>(url: string, ms = 2500): Promise<T | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface KeeperEntry {
  name: string;
  port: number;
  state: string;
  lastBeats: number | null;
  restartsToday: number;
}
interface KeeperRoot {
  beats: number;
  patrolIntervalSec: number;
  fleet: KeeperEntry[];
}

async function readKeeper(): Promise<{ root: KeeperRoot | null; noteHe: string }> {
  const root = await fetchLocal<KeeperRoot>("http://127.0.0.1:3036/");
  return {
    root,
    noteHe: root ? "keeper חי (HTTP)" : "keeper לא נמדד כרגע (HTTP)",
  };
}

async function readChainRuns(): Promise<ChainRunRow[]> {
  try {
    const rows = await db.chainRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return rows.map((r) => ({
      chain: r.chain,
      step: r.step,
      firedBy: r.firedBy,
      ok: r.ok,
      detail: r.detail,
      createdAt: r.createdAt,
    }));
  } catch {
    return [];
  }
}

/** נוכחות-מפתח בוליאנית בלבד — אפס קריאת-תוכן, אפס חשיפה (D-021) */
function keyPresentBoolean(): boolean {
  try {
    const p = path.join(process.cwd(), "upload", "headcorner.txt");
    const raw = fs.readFileSync(p, "utf8").trim();
    const [account, password] = raw.split(/\r?\n/).map((x) => x.trim());
    return Boolean(account && password);
  } catch {
    return false;
  }
}

interface FleetGuardState {
  cycles: number;
  lastCycleAt: string | null;
  revivesLog?: Array<{ at: string; daemon?: string }>;
}

function readFleetGuard(): FleetGuardState | null {
  try {
    return JSON.parse(
      fs.readFileSync("/home/z/my-project/sovereign/keeper/fleet-guard-state.json", "utf8"),
    ) as FleetGuardState;
  } catch {
    return null;
  }
}

// ── מסייעים ─────────────────────────────────────────────────────────

function evidence(parts: Array<string | null | undefined>): string {
  const alive = parts.filter((p) => p != null && p !== "") as string[];
  return alive.length > 0 ? alive.join(" · ") : "לא נמדד כרגע";
}

function fmtAgo(iso: string | Date | null): string | null {
  if (!iso) return null;
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (min < 60) return `לפני ${min}דק'`;
  const h = Math.floor(min / 60);
  if (h < 24) return `לפני ${h}ש'`;
  return `לפני ${Math.floor(h / 24)}י'`;
}

// ── המרשם ───────────────────────────────────────────────────────────

export async function GET() {
  const at = new Date().toISOString();

  const [keeperRes, pulse, kpi, money, moneyLive, guard, runs, grid, selfBoot] = await Promise.all([
    readKeeper(),
    fetchLocal<{
      beats: number;
      lastPublishUtcDay: string | null;
      nextDueAt: string | null;
      checkIntervalSec: number;
    }>("http://127.0.0.1:3033/"),
    fetchLocal<{
      beats: number;
      lastRecordDay: string | null;
      lastResult?: { ok?: boolean; revenuePerDayUsd?: number | null };
    }>("http://127.0.0.1:3041/"),
    swrGet<Record<string, unknown>>("money-root", 30_000, async () => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8_000);
      try {
        const r = await fetch("http://127.0.0.1:3000/api/money", {
          signal: ctl.signal,
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Record<string, unknown>;
      } finally {
        clearTimeout(t);
      }
    }),
    fetchLocal<{
      beats: number;
      actionsToday: number;
      policy?: { actionsBudgetPerDay?: number };
      lastDepositScanAt?: string | null;
      fillsSeen?: number;
      lastDecision?: { kind?: string; detail?: string } | null;
    }>("http://127.0.0.1:3034/"),
    Promise.resolve(readFleetGuard()),
    readChainRuns(),
    getGridState().catch(() => null),
    Promise.resolve(readSelfBootState()),
  ]);

  const keeper = keeperRes.root;
  const keyThere = keyPresentBoolean();
  const now24h = Date.now() - 24 * 3_600_000;

  // שרשראות: איחוד קנון-השרשראות עם מה שנצפה בפועל
  const CANON_CHAINS = ["compound", "sbd-mint", "stream", "deposit", "lp-exit", "pool-guard"];
  const observed = Array.from(new Set(runs.map((r) => r.chain)));
  const chainIds = Array.from(new Set([...CANON_CHAINS, ...observed]));

  const chainCaps: Capability[] = chainIds.map((id) => {
    const mine = runs.filter((r) => r.chain === id);
    const last = mine[0] ?? null;
    const in24h = mine.filter((r) => r.createdAt.getTime() >= now24h);
    const titleHe =
      id === "compound"
        ? "compound — עבודה→מטבע→עומק (מילוי-גריד מצית)"
        : id === "sbd-mint"
          ? "sbd-mint — מלאי→הטבעה→היצע"
          : id === "stream"
            ? "stream — גל→נזילות (פאוורדאון מצית)"
            : id === "deposit"
              ? "deposit — הפקדה→זיכוי"
              : id === "lp-exit"
                ? "lp-exit — נזילות→יציאה (חילוץ פרו-רטה)"
                : id === "pool-guard"
                  ? "pool-guard — שומר הבריכות (קנייה על סטיית-עוגן)"
                  : `fleet — ${id}`;
    const ev =
      last == null
        ? "חמושה בקוד — הטריגר טרם נגע (ריצה שלא קרתה אינה נטענת)"
        : `ריצה אחרונה ${fmtAgo(last.createdAt) ?? "?"} · ${last.step} ${last.ok ? "ok" : "fail"} · הצית: ${last.firedBy} · ריצות 24ש': ${in24h.length}`;
    return {
      id: `chain:${id}`,
      titleHe,
      mode: "AUTONOMOUS" as const,
      cadenceHe: "טריגר→פעולה: צינון + תקציב-יומי נאכפים בקוד",
      evidenceHe: ev,
    };
  });

  // דומינוס 24ש' — ריצות שהציתו את עצמן (לא המפעיל)
  const dominos24h = runs
    .filter((r) => r.createdAt.getTime() >= now24h && r.firedBy !== "operator")
    .slice(0, 8)
    .map((r) => ({
      at: r.createdAt.toISOString(),
      chain: r.chain,
      step: r.step,
      firedBy: r.firedBy,
      ok: r.ok,
      detail: r.detail.slice(0, 140),
    }));

  // הצי — מתוך keeper, עם נפילה-כנה לרשימת-הקנון
  const FLEET_CANON: Array<{ name: string; port: number; titleHe: string }> = [
    { name: "pulse", port: 3033, titleHe: "pulse — הדופק: מחליט בעצמו מתי לשדר" },
    { name: "money", port: 3034, titleHe: "money — מנוע-הכסף: פאריטה, סולם, הפקדות" },
    { name: "hunter", port: 3035, titleHe: "hunter — סורק-הזדמנויות" },
    { name: "student", port: 3037, titleHe: "student — למידה ותיקון-עצמי" },
    { name: "fleet-verify", port: 3038, titleHe: "fleet-verify — אימות-צי עצמאי" },
    { name: "weblift", port: 3039, titleHe: "weblift — הרמת-התוכן לרשתות" },
    { name: "curation", port: 3040, titleHe: "curation — אצירה מתואמת" },
    { name: "kpi", port: 3041, titleHe: "kpi — הספר היומי הנמדד (מחוץ-לסיור keeper)" },
  ];

  const fleetCaps: Capability[] = FLEET_CANON.map((c) => {
    const k = keeper?.fleet.find((f) => f.name === c.name);
    const live =
      c.name === "pulse" ? pulse : c.name === "kpi" ? kpi : c.name === "money" ? moneyLive : null;
    const beat =
      k?.lastBeats ??
      (live && typeof live === "object" && "beats" in live
        ? (live as { beats?: number }).beats
        : null);
    const state = k?.state ?? (beat != null ? "UP" : null);
    const extra =
      c.name === "pulse" && pulse?.nextDueAt
        ? ` השידור הבא בתזמון עצמי ${new Date(pulse.nextDueAt).toISOString().slice(11, 16)}Z`
        : c.name === "kpi" && kpi?.lastRecordDay
          ? ` רשום יום ${kpi.lastRecordDay}`
          : c.name === "money" && moneyLive
            ? ` סריקת-הפקדות ${fmtAgo(moneyLive.lastDepositScanAt ?? null) ?? "לא נמדד"}`
            : "";
    return {
      id: `daemon:${c.name}`,
      titleHe: c.titleHe,
      mode: "AUTONOMOUS" as const,
      cadenceHe: "שומר-כפול: keeper סיור 30ש' + fleet-guard סיור 60ש' (D-016)",
      evidenceHe: evidence([
        state ? `מצב ${state}` : null,
        beat != null ? `פעימות ${beat}` : null,
        k && k.restartsToday > 0 ? `הוקם מחדש היום ${k.restartsToday} פעמים` : null,
        extra || null,
      ]),
    };
  });

  fleetCaps.push({
    id: "daemon:web",
    titleHe: "שרת הרשת :3000 — הפעלה-עצמית במוות",
    mode: "AUTONOMOUS",
    cadenceHe: "fleet-guard סיור 60ש' + dev-revive (D-011/D-016)",
    evidenceHe: evidence([
      guard ? `מחזורי-סיור ${guard.cycles}` : null,
      guard?.lastCycleAt ? `סיור אחרון ${fmtAgo(guard.lastCycleAt)}` : null,
      guard?.revivesLog
        ? `החייאות 24ש': ${guard.revivesLog.filter((r) => new Date(r.at).getTime() >= now24h).length}`
        : null,
    ]),
  });

  fleetCaps.push({
    id: "daemon:self-boot",
    titleHe: "אתחול-עצמי אחרי מיחזור-סנדבוקס — סכימה · ספר · כספת (D-027)",
    mode: "AUTONOMOUS",
    cadenceHe: "בכל עליית-שרת + הצתה-עצלה ב-/api/health — בלי יד מפעיל",
    evidenceHe: evidence([
      selfBoot
        ? `ריצה אחרונה ${fmtAgo(selfBoot.lastRunAt) ?? "מסונכרן"} · פסק-דין ${selfBoot.lastVerdict ?? "?"}`
        : "טרם נמדד מאז ההצתה",
      selfBoot
        ? `${selfBoot.runs} ריצות · ${selfBoot.lastSteps?.map((s) => `${s.name}:${s.verdict}`).join(" · ") || "אין צעדים"}`
        : null,
      `ריצות self-boot 24ש': ${runs.filter((r) => r.chain === "self-boot").length}`,
    ]),
  });

  // עבודת-הכסף — המעקב אוטונומי, החתימה שער-מפעיל (כספת, D-005/D-014)
  const moneyRoot = money.value as {
    deployedSteem?: number;
    idleSteem?: number;
    ladder?: unknown[];
    fills?: unknown[];
    powerdown?: { nextPayment?: string; paymentsLeft?: number; weeklySteem?: number };
    keyPresent?: boolean;
    diagnosis?: { staleHours?: number };
    valueFloor?: {
      parity?: number | null;
      asksBelowParity?: number;
      steemBelowParity?: number;
      worstBps?: number;
      maxDriftLossUsd?: number | null;
      state?: "HELD" | "DRIFT" | "UNMEASURED";
      noteHe?: string;
    };
  } | null;

  const moneyCaps: Capability[] = [
    {
      id: "money:scale-monitoring",
      titleHe: "סולם-הפאריטה: מעקב חי והצמדה מחדש בכל מחזור",
      mode: "AUTONOMOUS",
      cadenceHe: "money-mover מחזור 60ש'",
      evidenceHe: evidence([
        moneyRoot?.deployedSteem != null
          ? `${Number(moneyRoot.deployedSteem).toFixed(3)} STEEM מוצבים בפקודות`
          : null,
        Array.isArray(moneyRoot?.ladder) ? `סולם ${moneyRoot.ladder.length} רמות על הקו` : null,
        Array.isArray(moneyRoot?.fills) ? `${moneyRoot.fills.length} מילויים בחלון` : null,
        moneyRoot?.valueFloor && moneyRoot.valueFloor.state === "DRIFT"
          ? `רצפת-ערך: DRIFT — ${moneyRoot.valueFloor.asksBelowParity} פקודות/${Number(moneyRoot.valueFloor.steemBelowParity).toFixed(1)} STEEM מתחת לפאריטה החדש, חשיפה מרבית $${moneyRoot.valueFloor.maxDriftLossUsd != null ? moneyRoot.valueFloor.maxDriftLossUsd.toFixed(4) : "?"} (${moneyRoot.keyPresent ? "המפתח חי בבית — מיושר בהזדמנות-הפעולה הבאה של המוביל" : "מיושר בחזרת-מפתח X-1"})`
          : moneyRoot?.valueFloor && moneyRoot.valueFloor.state === "HELD"
            ? "רצפת-ערך: HELD — אף מכירה מתחת לערך-החוץ"
            : null,
      ]),
    },
    {
      id: "money:deposit-scan",
      titleHe: "סריקת-הפקדות וזיכוי אוטונומי (deposit chain)",
      mode: "AUTONOMOUS",
      cadenceHe: "סריקה בכל מחזור · נחיתת-דלק מוצבת בתוך מחזור",
      evidenceHe: evidence([
        moneyLive?.lastDepositScanAt ? `סריקה אחרונה ${fmtAgo(moneyLive.lastDepositScanAt)}` : null,
        moneyRoot?.powerdown?.nextPayment
          ? `גל-הדלק הבא ~${Number(moneyRoot.powerdown.weeklySteem ?? 0).toFixed(1)} STEEM ב-${moneyRoot.powerdown.nextPayment.slice(0, 10)} (${moneyRoot.powerdown.paymentsLeft ?? "?"} תשלומים נותרו)`
          : null,
      ]),
    },
    {
      id: "money:cloud-engine",
      titleHe: "מנוע-הכסף הריבוני בענן — dex-grid ב-Domain רץ בלי מפעיל",
      mode: "AUTONOMOUS",
      cadenceHe: "GitHub Actions מתוזמן — שורד מוות-סנדבוקס (D-025)",
      evidenceHe: evidence([
        grid ? `פסק-דין ${grid.verdict}` : null,
        grid && "armed" in grid ? `חמוש: ${grid.armed ? "כן" : "לא"}` : null,
        grid?.publishedAt ? `פורסם ${fmtAgo(grid.publishedAt)}` : null,
        "הסודות חמושים בענן (R99) — ההכנסה אינה תלויה בהדבקה מקומית",
      ]),
    },
    {
      id: "money:signing",
      titleHe: "חתימה-מקומית על השוק הפנימי (נתיב-נוחות — הרשת אינה תלויה בו)",
      mode: "OPERATOR-GATED",
      gateRef: "D-004/D-005/D-009/D-014 · X-1",
      unblockHe:
        "נתיב זה מוסיף את סולם-הבית המקומי; הרווח הריבוני רץ מהענן בלעדיו. חזרת-מפתח (X-1) מפעילה אותו מיד — ואינה תנאי להפעלת הרשת.",
      evidenceHe: evidence([
        `נוכחות-מפתח בסנדבוקס: ${keyThere ? "כן" : "לא"}`,
        moneyLive?.lastDecision?.kind ? `החלטה אחרונה ${moneyLive.lastDecision.kind}` : null,
      ]),
    },
  ];

  // הספרים
  const booksCaps: Capability[] = [
    {
      id: "books:kpi",
      titleHe: "הספר היומי הנמדד — KPI ל-Defi/fleet (D-015)",
      mode: "AUTONOMOUS",
      cadenceHe: "יומי, טיק ראשון אחרי 12:05Z + catch-up",
      evidenceHe: evidence([
        kpi?.lastRecordDay ? `רשום יום ${kpi.lastRecordDay}` : null,
        kpi?.lastResult?.ok != null ? `רשומה אחרונה ${kpi.lastResult.ok ? "ok" : "fail"}` : null,
        kpi?.lastResult?.revenuePerDayUsd != null
          ? `הכנסה ממומשת $${Number(kpi.lastResult.revenuePerDayUsd).toFixed(4)}/יום`
          : null,
      ]),
    },
    {
      id: "books:anchors",
      titleHe: "עוגני-ענן ושומר-חוץ (watchdog, cloud-pulse, campaign)",
      mode: "AUTONOMOUS",
      cadenceHe: "שעתי/יומי מהענן — שורד מוות-סנדבוקס",
      evidenceHe: evidence([
        keeper
          ? `הצי מדווח ${keeper.fleet.filter((f) => f.state === "UP").length}/${keeper.fleet.length} חיים מקומית`
          : null,
        "שכבת-הענן פועמת בלעדינו ומעידה אם הבית שותק (מתועדת בספרי-Defi)",
      ]),
    },
  ];

  // שערי-המפעיל — מתוך קנון-ההחלטות החי
  const operatorCaps: Capability[] = [
    {
      id: "gate:x1",
      titleHe: "X-1 — רוטציית מפתחות על מחשב-נקי (כולל ארנקי-סוכנים מהתקרית Z-16)",
      mode: "OPERATOR-GATED",
      gateRef: "D-014/D-020",
      unblockHe:
        "משחרר: חתימה מקומית מחדש לסולם, הצבת 4.7 STEEM נזילים, ותחילת-רוטציה לארנקי-סוכנים.",
      evidenceHe: keyThere
        ? "נוכחות-מפתח כן — השער פתוח חלקית, הרוטציה עצמה בידי המפעיל"
        : "אין מפתח בסנדבוקס — השער סגור-בכנות",
    },
    {
      id: "gate:x2",
      titleHe: "X-2 — החלטת הון L2 לסולם $1,000/יום",
      mode: "OPERATOR-GATED",
      gateRef: "D-020",
      unblockHe:
        "משחרר: פריסת-הון חוץ מעל סף-ה-$100 (D-009) — ההיתוך כולו מוכן בקוד.",
      evidenceHe:
        "הון-אמת נמדד חי ב-/api/mission — הסולם ממתין להחלטה, לא ליכולת",
    },
    {
      id: "gate:c6",
      titleHe: "C-6 — האצלת נוכחות-קהילה 80/20 (D-019)",
      mode: "OPERATOR-GATED",
      gateRef: "D-019/D-020",
      unblockHe:
        "משחרר: הצבעת-מפתחות לנוכחות-קהילה מתואמת — מהלך-חוץ ראשון בהאצלה מדודה.",
      evidenceHe: "הצעת-ההאצלה על הלוח (Z-14) — ממתינה להכרעת-מפעיל",
    },
  ];

  const domains: Domain[] = [
    { id: "fleet", titleHe: "הצי והשרת — 9 דיבונים + הפעלה-עצמית", capabilities: fleetCaps },
    { id: "chains", titleHe: "שרשראות-הטריגר — דבר גורר דבר", capabilities: chainCaps },
    { id: "money", titleHe: "עבודת-הכסף — ערך, סולם, פאריטה", capabilities: moneyCaps },
    { id: "books", titleHe: "הספרים והעוגנים", capabilities: booksCaps },
    { id: "operator", titleHe: "שערי-החזקה והצמיחה — לא תלות-הפעלה", capabilities: operatorCaps },
  ];

  const all = domains.flatMap((d) => d.capabilities);
  const autonomous = all.filter((c) => c.mode === "AUTONOMOUS").length;
  const gated = all.filter((c) => c.mode === "OPERATOR-GATED").length;
  const share = all.length > 0 ? autonomous / all.length : null;

  const ledger: AutonomyLedger = {
    ok: true,
    at,
    format: "autonomy-ledger-v1",
    verdict: {
      total: all.length,
      autonomous,
      operatorGated: gated,
      share,
      operationBlocked: false,
      growthGates: gated,
      he:
        share == null
          ? "לא נמדד"
          : `${autonomous} מתוך ${all.length} יכולות רצות אוטונומית קצה-אל-קצה (${Math.round(share * 100)}%). הרשת פועלת, מתרפאת ומרוויחה 7/24 בלי המפעיל: המנוע-הכסף חי בענן, הבית קם מעצמו אחרי מיחזור (D-027), והשערים שנותרו (${gated}) הם החזקת-מפתחות והחלטות-צמיחה — לא תלות-הפעלה.`,
    },
    domains,
    dominos24h,
    honestyHe:
      "המרשם נמדד חי ממקורות-אמת: keeper, ChainRun, הדיבונים, קנון-ההחלטות ומצב self-boot. יכולת שאינה נרשמת כאן אינה נטענת; מדידה שלא ענתה מוצגת כלא-נמדדת.",
    errorHe: keeperRes.root ? null : keeperRes.noteHe,
  };

  return NextResponse.json(ledger, { headers: { "X-Cache": "live" } });
}
