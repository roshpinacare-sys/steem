// ─────────────────────────────────────────────────────────────────────
// /api/kpi — משטח-האמת של הספר-היומי (r147-d · D-r147-BLOC)
//
// הפער שנסגר (נמדד): /api/kpi החזיר HTML 404 — הנתיב לא נכתב מעולם,
// בזמן שכל-שאר-החזיתות חשופות כ-JSON תקני על :3000 (economy/income/
// governance/fleet/treasury). מפקיד-ה-KPI עצמו (mini-services/kpi · :3041)
// חי ומפקיד — sovereign/kpi/history/YYYY-MM-DD.json מתעדכן יומית —
// אבל המשטח התקני שלו בבית היה חסר.
//
// מה הנתיב מחזיר (קריאה-בלבד, אפס מפתחות, אפס כתיבה):
//   · scribe    — בריאות המפקיד חיה מ-:3041 (beats/lastRecordDay/lastResult)
//   · latest    — קובץ-היום האחרון שעל-הדיסק (kpi-day-v1) — אמת-הדיסק
//   · freshness — חוק-הטריות: המפקיד רושם פעם-ביום, טיק-ראשון אחרי 12:05Z
//                 (+ גרירה). fresh = lastRecordDay == היום-הצפוי לפי השעה.
//                 יום-חסר מוכרז stale בכנות — לא "הכל טוב".
//   · history   — רשימת-הימים שנרשמו (מהדיסק, המקור-שאינו-משקר)
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const HOME = "/home/z/my-project";
const KPI_HISTORY_DIR = path.join(HOME, "sovereign", "kpi", "history");
const SCRIBE = "http://127.0.0.1:3041";

// החוק המדוד של המפקיד (mini-services/kpi): טיק-ראשון אחרי 12:05Z + catch-up.
// שער-הטריות: אחרי 14:05Z (שעתיים-גרירה) יום-חסר הוא stale מוכרז.
const RECORD_AFTER_UTC_MIN = 12 * 60 + 5; // 12:05Z
const STALE_GRACE_MIN = 120;

interface ScribeState {
  ok?: boolean;
  beats?: number;
  alive?: boolean;
  lastRecordDay?: string | null;
  lastRecordAt?: string | null;
  lastResult?: {
    ok?: boolean;
    day?: string;
    green?: boolean;
    streak?: number;
    revenuePerDayUsd?: number | null;
    pushes?: { history?: boolean; kpi?: boolean };
  } | null;
  lastCi?: { id?: number; conclusion?: string | null; createdAt?: string | null } | null;
}

interface KpiDayFile {
  ok?: boolean;
  format?: string;
  day?: string;
  last?: {
    at?: string;
    green?: boolean;
    measured?: Record<string, unknown>;
    checks?: Record<string, unknown>;
  } | null;
  streak?: { consecutiveGreenDays?: number; asOf?: string } | null;
}

async function fetchScribe(): Promise<{ up: boolean; state: ScribeState | null; error?: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8_000);
  try {
    const r = await fetch(SCRIBE, { signal: ac.signal, cache: "no-store" });
    if (!r.ok) return { up: false, state: null, error: `HTTP ${r.status}` };
    return { up: true, state: (await r.json()) as ScribeState };
  } catch (e) {
    return { up: false, state: null, error: String((e as Error)?.message ?? e).slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

function expectedRecordDay(now = new Date()): string {
  const minutesUtc = now.getUTCHours() * 60 + now.getUTCMinutes();
  const d = new Date(now.getTime());
  if (minutesUtc < RECORD_AFTER_UTC_MIN + STALE_GRACE_MIN) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function readLatestDayFile(): { file: KpiDayFile | null; days: string[]; error?: string } {
  try {
    const days = fs
      .readdirSync(KPI_HISTORY_DIR)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    if (days.length === 0) return { file: null, days: [] };
    const raw = fs.readFileSync(path.join(KPI_HISTORY_DIR, days[days.length - 1]!), "utf8");
    return { file: JSON.parse(raw) as KpiDayFile, days: days.map((f) => f.replace(/\.json$/, "")) };
  } catch (e) {
    return { file: null, days: [], error: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

export async function GET() {
  const at = new Date().toISOString();

  const [scribe, disk] = await Promise.all([fetchScribe(), Promise.resolve(readLatestDayFile())]);
  const scribeDay = scribe.state?.lastRecordDay ?? null;
  const diskDay = disk.file?.day ?? null;
  const lastRecordDay = scribeDay ?? diskDay; // חי-קודם, דיסק-כהוכחה
  const expectedDay = expectedRecordDay(new Date(at));

  const lastRecordAtMs = scribe.state?.lastRecordAt ? Date.parse(scribe.state.lastRecordAt) : null;
  const ageHours =
    lastRecordAtMs != null && Number.isFinite(lastRecordAtMs)
      ? Math.round(((Date.now() - lastRecordAtMs) / 3_600_000) * 100) / 100
      : null;

  const fresh = lastRecordDay != null && lastRecordDay >= expectedDay;
  const freshNote = fresh
    ? `רשום יום ${lastRecordDay} — בתוך חלון-הטריות (צפוי ≥ ${expectedDay})`
    : lastRecordDay == null
      ? "אין רישום-KPI כלל על-הדיסק ובמפקיד — unmeasured, מוכרז בכנות"
      : `יום-חסר: רשום ${lastRecordDay} אך הצפוי ≥ ${expectedDay} (טיק-ראשון אחרי 12:05Z + גרירה) — STALE מוכרז בכנות`;

  return NextResponse.json(
    {
      ok: true,
      service: "kpi",
      at,
      scribe: {
        up: scribe.up,
        port: 3041,
        ...(scribe.error ? { error: scribe.error } : {}),
        ...(scribe.state
          ? {
              beats: scribe.state.beats ?? null,
              alive: scribe.state.alive ?? null,
              lastRecordDay: scribeDay,
              lastRecordAt: scribe.state.lastRecordAt ?? null,
              lastResult: scribe.state.lastResult ?? null,
              lastCi: scribe.state.lastCi ?? null,
            }
          : {}),
      },
      latest: disk.file
        ? {
            day: diskDay,
            format: disk.file.format ?? null,
            green: disk.file.last?.green ?? null,
            at: disk.file.last?.at ?? null,
            measured: disk.file.last?.measured ?? null,
            streak: disk.file.streak ?? null,
          }
        : { day: null, note: disk.error ?? "אין קובץ-יום על-הדיסק — unmeasured" },
      freshness: {
        lastRecordDay,
        expectedRecordDay: expectedDay,
        cadence: "daily, first tick after 12:05Z (+catch-up)",
        ageHours,
        fresh,
        note: freshNote,
      },
      historyDays: disk.days,
      historyCount: disk.days.length,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
