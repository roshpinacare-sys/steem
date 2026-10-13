import { NextRequest, NextResponse } from "next/server";
import { OP_COOKIE, readSession } from "@/lib/operator-auth";
import { deDashDeep } from "@/lib/clean-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ראיית הרשת החיה (מאובטחת) — תשובת-הנגד לתחושת השקט.
 * מדידה חיצונית בלבד, אפס סודות:
 *  · מפת-העורקים הציבורית (Domain status.json — מיוצרת בידי הדופק החיצוני saos-runtime)
 *  · מצב המשרד החי (FleetHQ office-state)
 * הטענה כאן אחת — הרשת חיה מחוץ לסנדבוקס, והמספרים מוכיחים עם חותמת-זמן.
 */

const STATUS_URL = "https://roshpinacare-sys.github.io/Domain/status.json";
const OFFICE_URL =
  "https://raw.githubusercontent.com/roshpinacare-sys/FleetHQ/main/office/state/office-state.json";

/* סדר-העדיפות לתצוגה — מה שהמפעיל חייב לראות קודם */
const PRIORITY_REPOS = [
  "steem",
  "Domain",
  "saos-runtime",
  "FleetHQ",
  "Console",
  "sovereign-runner-kit",
  "Autonomy",
];

type Artery = { p?: string; v?: string; last?: number };
type RepoRow = { repo?: string; vis?: string; verdict?: string; arteries?: Artery[] };

function minutesSince(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

function pulseTone(min: number | null): "ok" | "warn" | "bad" {
  if (min == null) return "bad";
  if (min <= 90) return "ok";
  if (min <= 360) return "warn";
  return "bad";
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(OP_COOKIE)?.value ?? null;
  if (!readSession(token).valid) {
    return NextResponse.json({ ok: false, error: "דורש אימות" }, { status: 401 });
  }

  const [status, office] = await Promise.all([fetchJson(STATUS_URL), fetchJson(OFFICE_URL)]);

  const generatedAt = status ? (status.generatedAt as string | undefined) ?? null : null;
  const pulseAgeMin = minutesSince(generatedAt);
  const summary = status && typeof status.summary === "object" ? (status.summary as Record<string, number>) : null;

  const repos = (status && Array.isArray(status.repos) ? (status.repos as RepoRow[]) : []) ?? [];

  /* דגימת תצוגה — רפות קודם, אחר כך עדיפויות, ואז שאר החיים; תקרה 10 שורות */
  const rank = (r: RepoRow) => {
    const stale = r.verdict === "STALE" || r.verdict === "IDLE" ? 0 : 1;
    const prio = PRIORITY_REPOS.indexOf(String(r.repo ?? ""));
    return [stale, prio === -1 ? 9 : prio, String(r.repo ?? "")];
  };
  const view = [...repos]
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] === rb[0]
        ? ra[1] === rb[1]
          ? String(ra[2]).localeCompare(String(rb[2]))
          : Number(ra[1]) - Number(rb[1])
        : Number(ra[0]) - Number(rb[0]);
    })
    .slice(0, 10)
    .map((r) => ({
      repo: r.repo ?? "?",
      verdict: r.verdict ?? "?",
      arteries: Array.isArray(r.arteries) ? r.arteries.length : 0,
      lastArteryMin: Array.isArray(r.arteries)
        ? r.arteries.reduce<number | null>(
            (acc, a) => (typeof a?.last === "number" ? (acc == null ? a.last : Math.min(acc, a.last)) : acc),
            null
          )
        : null,
    }));

  const officeAt = office ? (office.capturedAt as string | undefined) ?? null : null;
  const officeAgeMin = minutesSince(officeAt);
  const officeConnected = office ? office.connected === true : false;

  const verdict =
    status == null
      ? "לא נמדד — מפת העורקים אינה נגישה"
      : pulseTone(pulseAgeMin) === "ok"
        ? "הרשת החיצונית חיה — הדופק מדווח בזמן"
        : pulseTone(pulseAgeMin) === "warn"
          ? "הדופק החיצוני מאחר — נמדד ומוצג, לא מוסתר"
          : "שקט חיצוני מדיד — הדופק נעדר מעבר לסף";

  return NextResponse.json(
    deDashDeep({
      ok: true,
      asof: new Date().toISOString(),
      verdict,
      pulse: {
        generatedAt,
        ageMin: pulseAgeMin,
        tone: pulseTone(pulseAgeMin),
        summary: summary ?? null,
        totalRepos: repos.length,
      },
      repos: view,
      office: {
        capturedAt: officeAt,
        ageMin: officeAgeMin,
        connected: officeConnected,
        tone: officeConnected && officeAgeMin != null && officeAgeMin <= 240 ? "ok" : "warn",
      },
      sources: { arteryMap: STATUS_URL, office: OFFICE_URL },
    })
  );
}
