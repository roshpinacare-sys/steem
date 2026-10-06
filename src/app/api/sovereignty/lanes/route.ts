// ─────────────────────────────────────────────────────────────────────
// /api/sovereignty/lanes — דוח-הערוצים החוצה (r135) · lanes-report-v1.
//
// הלקח החי של 2026-09-29: הרשת רצה, מדידה ורושמת — אבל כל ערוצי-החוצה
// יצאו מאוורע לשער אחד סגור אחרי השני, והמפעיל ראה "אין התקדמות" בלי
// שום מקום שמסביר את השתיקה. החוק מעתה (D-023): **ערוץ שנחסם חייב
// לדווח על עצמו** — מצב, מדידה-אחרונה-טובה, סיבה, ונתיב-השחרור.
// ערוץ שלא נרשם כאן אינו נחשב; מדידה שלא ענתה = null כנה.
//
// ערוצים (כולם קריאה-בלבד, אפס סודות):
//   · push    — דחיפת הבית (Zip) ל-origin: קדימה-מקומית + תקציב keeper
//   · anchors — העוגנים-בענן: anchor-report.json + zero-line.json
//   · voice   — הקול-הציבורי: pulse (הפרסום היומי על השרשרת)
//   · custody — הסמכות: NetworkKey ב-DB (הדלת: POST /api/arm/seal)
//   · canon   — קבלות-הקנון ל-Defi: flushCanon של keeper
//
// פסק-דין: OK / SOFT-MUTE (ערוץ אחד חסום) / MUTE (שני ערוצים ומעלה).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "child_process";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROOT = path.resolve(process.cwd());
const STALE_HOURS_ANCHOR = 4; // העוגנים רצים כל ~15-45 דק' — 4ש' = אמת-ענן מתה
const STALE_DAYS_VOICE = 2; // הדופק מפרסם פעם ביום UTC — יומיים = קול נעלם

type LaneState = "OPEN" | "GATED" | "STALE" | "UNMEASURED";

interface Lane {
  id: string;
  titleHe: string;
  state: LaneState;
  lastGoodAt: string | null;
  evidenceHe: string;
  unlockHe: string;
}

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

function readJson(p: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function gitAhead(): number | null {
  try {
    const out = execSync("git rev-list --count origin/main..HEAD", { cwd: ROOT, encoding: "utf8", timeout: 8000 });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return null;
  }
}

async function laneCustody(): Promise<Lane> {
  try {
    const nk = await db.networkKey.findUnique({ where: { id: "weave-network" } });
    if (nk?.devKeyHex) {
      return {
        id: "custody",
        titleHe: "הסמכות — מפתח-הרשת שממנו נגזרות כל הזהויות",
        state: "OPEN",
        lastGoodAt: new Date().toISOString(),
        evidenceHe: `מפתח-הרשת חי ב-DB (כתובת ${nk.address.slice(0, 8)}…) — הזהויות נגזרות לבד`,
        unlockHe: "פתוח — אין צעד-מפעיל",
      };
    }
  } catch {
    /* DB לא עונה — כנות */
  }
  const meta = readJson(path.join(ROOT, "sovereign", "weave-seal.meta.json"));
  const addr = typeof meta?.networkAddress === "string" ? meta.networkAddress : "?";
  return {
    id: "custody",
    titleHe: "הסמכות — מפתח-הרשת שממנו נגזרות כל הזהויות",
    state: "GATED",
    lastGoodAt: null,
    evidenceHe: `מפתח-הרשת אינו ב-DB (נעלם עם מיחזור-הסנדבוקס) — ערוצים חתומים fail-closed: pulse/שוק/מוח. הכתובת הקבועה: ${addr.slice(0, 8)}…`,
    unlockHe: "צעד-אחד: POST /api/arm/seal {passphrase} — הסיסמה שבמשמרת המפוצלת (GitHub Secret / הכספת האישית). GCM מאמת, הזהויות חוזרות לבד",
  };
}

function lanePush(): Lane {
  const ahead = gitAhead();
  if (ahead === null) {
    return {
      id: "push",
      titleHe: "דחיפת-הבית — קומיטים מקומיים ל-origin/main (Zip)",
      state: "UNMEASURED",
      lastGoodAt: null,
      evidenceHe: "git מקומי לא ענה (null כנה, לא הצלחה שנטענת)",
      unlockHe: "בדיקה-ידנית: git status בבית",
    };
  }
  const keeper = readJson(path.join(ROOT, "sovereign", "keeper", "state.json"));
  const pushState = keeper?.push as { lastPushAt?: string | null; lastResult?: { ok: boolean; detail: string } | null } | undefined;
  if (ahead > 0) {
    return {
      id: "push",
      titleHe: "דחיפת-הבית — קומיטים מקומיים ל-origin/main (Zip)",
      state: "GATED",
      lastGoodAt: pushState?.lastPushAt ?? null,
      evidenceHe: `${ahead} קומיטים מקומיים ממתינים לדחיפה${pushState?.lastResult ? ` · ניסיון אחרון: ${pushState.lastResult.detail}` : ""}`,
      unlockHe: "ערוץ-הדחיפה של keeper ינקה לבד (fetch → rebase → push, תקציב 12/יום) — אין צעד-מפעיל",
    };
  }
  return {
    id: "push",
    titleHe: "דחיפת-הבית — קומיטים מקומיים ל-origin/main (Zip)",
    state: "OPEN",
    lastGoodAt: pushState?.lastPushAt ?? null,
    evidenceHe: `אפס קומיטים תקועים — הבית מסונכרן עם origin${pushState?.lastPushAt ? ` · דחיפה אחרונה: ${pushState.lastPushAt}` : ""}`,
    unlockHe: "פתוח — אין צעד-מפעיל",
  };
}

function laneAnchors(): Lane {
  const report = readJson(path.join(ROOT, "sovereign", "anchor-report.json")) as { at?: string; checkpoint?: { index?: number }; attestations?: number } | null;
  const zero = readJson(path.join(ROOT, "sovereign", "zero-line.json")) as { anchors?: Array<{ at?: string; checkpoint?: number }> } | null;
  const lastAt = report?.at ?? zero?.anchors?.[zero.anchors.length - 1]?.at ?? null;
  const h = hoursSince(lastAt);
  const cp = report?.checkpoint?.index ?? null;
  const att = report?.attestations ?? null;
  const evidence = lastAt
    ? `עוגן-אחרון: cp#${cp ?? "?"} · att ${att ?? "?"} · לפני ${h !== null ? h.toFixed(1) : "?"}ש' (runner: github-actions)`
    : "אין עוגן בדוחות המקומיים (null כנה)";
  return {
    id: "anchors",
    titleHe: "העוגנים-בענן — checkpoints על Steem + Z Chain (GitHub Actions)",
    state: h === null ? "UNMEASURED" : h <= STALE_HOURS_ANCHOR ? "OPEN" : "STALE",
    lastGoodAt: lastAt,
    evidenceHe: evidence,
    unlockHe:
      h !== null && h > STALE_HOURS_ANCHOR
        ? "Actions ב-GitHub: פועלות מחדש לבד בקרון הבא (~15-45 דק') — אם לא: בדיקת ריצות-Actions בריפו"
        : "פתוח — אין צעד-מפעיל",
  };
}

function laneVoice(): Lane {
  const pulse = readJson(path.join(ROOT, "sovereign", "pulse", "state.json")) as {
    lastPublishUtcDay?: string;
    attemptsToday?: number;
    broadcasting?: boolean;
  } | null;
  if (!pulse?.lastPublishUtcDay) {
    return {
      id: "voice",
      titleHe: "הקול-הציבורי — הדופק (pulse) על השרשרת",
      state: "UNMEASURED",
      lastGoodAt: null,
      evidenceHe: "אין מדידת-קול במצב pulse (null כנה)",
      unlockHe: "בדיקת pulse :3033",
    };
  }
  const dayIso = `${pulse.lastPublishUtcDay}T00:00:00Z`;
  const days = (Date.now() - Date.parse(dayIso)) / 86_400_000;
  const publishedToday = pulse.lastPublishUtcDay === new Date().toISOString().slice(0, 10);
  const attemptsExhausted = (pulse.attemptsToday ?? 0) >= 3;
  // כנות: פרסום של אתמול + תקציב-ניסיונות שנשחק היום = הפוסט של היום לא ירד
  const stale = days > STALE_DAYS_VOICE || (!publishedToday && attemptsExhausted);
  return {
    id: "voice",
    titleHe: "הקול-הציבורי — הדופק (pulse) על השרשרת",
    state: stale ? "STALE" : "OPEN",
    lastGoodAt: dayIso,
    evidenceHe: stale
      ? `הפרסום האחרון: ${pulse.lastPublishUtcDay} (לפני ${Math.floor(days)} ימים) · ניסיונות היום: ${pulse.attemptsToday ?? 0}${!publishedToday && attemptsExhausted ? " — תקציב היום נשחק בלי פרסום (ערוץ חתום fail-closed בהיעדר מפתח-רשת)" : ""}`
      : `הפרסום האחרון: ${pulse.lastPublishUtcDay} · ניסיונות היום: ${pulse.attemptsToday ?? 0} · שידור: ${pulse.broadcasting ? "כן" : "לא"}`,
    unlockHe: stale
      ? "נגזרת של הסמכות: POST /api/arm/seal מחזיר את מפתח-הרשת — pulse נפתח מעצמו במחזור הבא (תקציב-הניסיונות מתאפס מחר 00:00 UTC)"
      : "פתוח — אין צעד-מפעיל",
  };
}

function laneCanon(): Lane {
  const keeper = readJson(path.join(ROOT, "sovereign", "keeper", "state.json")) as {
    canonLast?: { at: string; ok: boolean; path: string } | null;
  } | null;
  const last = keeper?.canonLast ?? null;
  const h = hoursSince(last?.at);
  return {
    id: "canon",
    titleHe: "קבלות-הקנון — השומר דוחף קבלות ל-Defi/fleet",
    state: !last ? "UNMEASURED" : last.ok ? "OPEN" : "GATED",
    lastGoodAt: last?.at ?? null,
    evidenceHe: last
      ? `${last.ok ? "הצלחה" : "חסימה"} אחרונה: ${last.path} (${h !== null ? h.toFixed(1) : "?"}ש')`
      : "אין ניסיון-קנון רשום (null כנה)",
    unlockHe: last && !last.ok ? "נגזרת של ה-PAT ב-upload/ — keeper ינסה שוב בסיור הבא (backoff)" : "פתוח — אין צעד-מפעיל",
  };
}

export async function GET() {
  const at = new Date().toISOString();
  const lanes: Lane[] = [];
  lanes.push(await laneCustody());
  lanes.push(lanePush());
  lanes.push(laneAnchors());
  lanes.push(laneVoice());
  lanes.push(laneCanon());

  const blocked = lanes.filter((l) => l.state !== "OPEN" && l.state !== "UNMEASURED");
  const verdict = blocked.length === 0 ? "OK" : blocked.length === 1 ? "SOFT-MUTE" : "MUTE";

  return NextResponse.json({
    ok: true,
    at,
    format: "lanes-report-v1",
    verdict,
    verdictHe:
      verdict === "OK"
        ? "כל ערוצי-החוצה פתוחים — הרשת מדברת"
        : verdict === "SOFT-MUTE"
          ? `ערוץ אחד חסום: ${blocked[0].id} — הנתיב לשחרור רשום`
          : `הרשת אילמת חלקית (${blocked.length} ערוצים): ${blocked.map((b) => b.id).join(", ")} — לכל אחד נתיב-שחרור רשום`,
    lanes,
    doctrine: "D-023 — ערוץ חסום חייב לדווח על עצמו: מצב, ראיה, ונתיב-שחרור. אף ערוץ לא ישתוק בשקט שוב.",
  });
}
