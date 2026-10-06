// ─────────────────────────────────────────────────────────────────────
// /api/businesses — משטח-האמת של חממת-העסקים (D-r147-BIZ · r147-biz)
//
// מה הנתיב מחזיר (קריאה-בלבד, אפס מפתחות, אפס כתיבה, אפס זיוף):
//   · registry  — רישום-העסקים מהדיסק (sovereign/businesses/registry.json)
//   · metrics   — מדידה-חיה לכל עסק מהמקורות שהרישום מצהיר, fail-soft:
//       B-1 דלפק-הדלק   → GET /api/money → fuel.{state,totalFuel,arenaClaimWsteem}
//       B-2 תדריך-השוק  → דיג'סט-הקהל (rshares-חוץ/תגובות של הנושא-המוביל)
//       B-3 דלפק-האמת   → ביקורת-השכפול האחרונה (זוגות-כמעט-שכפול על הדיסק)
//       B-5 מפעל-התוכן  → קובץ-מצב המפעל (ticks · פוסטים · הפוסט-האחרון)
//   · מקור-נכשל מדווח null בכנות — לעולם לא "0 שנראה כמו מדידה".
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import { bump, usageOf } from "@/lib/feed-metrics";

export const dynamic = "force-dynamic";

const HOME = "/home/z/my-project";
const REGISTRY = `${HOME}/sovereign/businesses/registry.json`;
const AUDIENCE = `${HOME}/sovereign/audience/latest-digest.json`;
const DUP_AUDIT_DIR = `${HOME}/sovereign/curation`;

function readJson(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function fetchJson(url: string, timeoutMs = 6000): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function latestDupAudit(): { file: string | null; at: string | null; nearDuplicatePairs: number | null } {
  try {
    const files = fs
      .readdirSync(DUP_AUDIT_DIR)
      .filter((f) => f.startsWith("duplication-audit-") && f.endsWith(".json"))
      .sort();
    const last = files[files.length - 1];
    if (!last) return { file: null, at: null, nearDuplicatePairs: null };
    const j = readJson(`${DUP_AUDIT_DIR}/${last}`) as { at?: string; nearDuplicatePairs?: unknown } | null;
    const near = Array.isArray(j?.nearDuplicatePairs) ? (j!.nearDuplicatePairs as unknown[]).length : null;
    return { file: last, at: j?.at ?? null, nearDuplicatePairs: near };
  } catch {
    return { file: null, at: null, nearDuplicatePairs: null };
  }
}

// B-5 מפעל-התוכן (r149) — מדידה-חיה מקובץ-המצב של המפעל (פורט 3046 כותב,
// כאן קריאה-בלבד). מקור-נכשל ⇒ null בכנות, לעולם לא "0 שנראה כמו מדידה".
function readFactoryMetrics(): Record<string, unknown> {
  const EMPTY: Record<string, unknown> = {
    measuredAt: new Date().toISOString(),
    source: "sovereign/businesses/content-factory-state.json",
    ticks: null,
    postsTotal: null,
    postsToday: null,
    capPerDay: 2,
    lastPost: null,
    lastError: null,
    noteHe: "קובץ-מצב המפעל לא נקרא — null בכנות",
  };
  try {
    const raw = readJson(`${HOME}/sovereign/businesses/content-factory-state.json`) as
      | {
          ticks?: unknown;
          budget?: { postsToday?: unknown };
          posts?: Array<Record<string, unknown>>;
          lastError?: unknown;
        }
      | null;
    if (!raw) return EMPTY;
    const posts = Array.isArray(raw.posts) ? raw.posts : [];
    const last = posts.length > 0 ? posts[posts.length - 1] : null;
    return {
      measuredAt: new Date().toISOString(),
      source: "sovereign/businesses/content-factory-state.json",
      ticks: typeof raw.ticks === "number" ? raw.ticks : null,
      postsTotal: posts.length,
      postsToday: typeof raw.budget?.postsToday === "number" ? raw.budget.postsToday : null,
      capPerDay: 2,
      lastPost: last ? { title: last.title ?? null, permlink: last.permlink ?? null, url: last.url ?? null, at: last.at ?? null } : null,
      lastError: typeof raw.lastError === "string" ? raw.lastError : null,
      noteHe:
        posts.length === 0
          ? "המפעל חי אך טרם פרסם — הטיק הפיק טיוטה ראשונה על שער-הכלכלה"
          : `פוסטי-מפעל מצטברים: ${posts.length} · האחרון: ${String(last?.title ?? "?").slice(0, 60)}`,
    };
  } catch {
    return EMPTY;
  }
}

export async function GET() {
  bump("businesses");
  const registry = readJson(REGISTRY) as Record<string, unknown> | null;
  if (!registry) {
    return NextResponse.json(
      { ok: false, usage: usageOf("businesses"), noteHe: "רישום-העסקים לא נקרא מהדיסק — המשטח מדווח כנות, לא ממציא" },
      { status: 200 },
    );
  }

  const audience = readJson(AUDIENCE) as
    | { digest?: { topics?: Array<{ tag?: string; externalVotes?: number; externalRshares?: number; replies?: number }> }; fetchedAt?: string }
    | null;
  const top = audience?.digest?.topics?.[0] ?? null;

  const money = (await fetchJson("http://127.0.0.1:3000/api/money")) as
    | { fuel?: { state?: string; totalFuel?: number | null; arenaClaimWsteem?: number | null } }
    | null;

  const dup = latestDupAudit();

  const metrics: Record<string, Record<string, unknown>> = {
    "B-1-fuel-desk": {
      measuredAt: new Date().toISOString(),
      source: "GET /api/money → fuel",
      fuelState: money?.fuel?.state ?? null,
      totalFuelSteem: money?.fuel?.totalFuel ?? null,
      arenaClaimWsteem: money?.fuel?.arenaClaimWsteem ?? null,
      noteHe:
        money?.fuel?.state == null
          ? "מקור-הדלק לא נענה — מדווח null, לא אפס"
          : money.fuel.state === "SELL-FROZEN"
            ? "הדלק למכירה אפס מעל תביעת-העטיפה — ערוץ-ההכנסה הוא נתיב-הערך (שורת-ההרג: 2026-10-16)"
            : null,
    },
    "B-2-market-brief": {
      measuredAt: new Date().toISOString(),
      source: "sovereign/audience/latest-digest.json → digest.topics[0]",
      fetchedAt: audience?.fetchedAt ?? null,
      topTopic: top?.tag ?? null,
      externalVotes: top?.externalVotes ?? null,
      externalRshares: top?.externalRshares ?? null,
      replies: top?.replies ?? null,
      noteHe: top ? `הנושא-הרזוננטי "${top.tag}" — הבסיס-המדוד לתדריך` : "דיג'סט-הקהל לא נקרא — null בכנות",
    },
    "B-3-truth-desk": {
      measuredAt: new Date().toISOString(),
      source: "sovereign/curation/duplication-audit-*.json (האחרון על הדיסק)",
      auditFile: dup.file,
      auditAt: dup.at,
      nearDuplicatePairs: dup.nearDuplicatePairs,
      noteHe:
        dup.nearDuplicatePairs == null
          ? "ביקורת-השכפול לא נקראה — null בכנות"
          : `${dup.nearDuplicatePairs} זוגות-כמעט-שכפול בביקורת האחרונה`,
    },
    "B-5-content-factory": readFactoryMetrics(),
  };

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    usage: usageOf("businesses"),
    law: "read-only, no secrets, no fabrication: a failed source is reported as null, never re-invented",
    registry,
    metrics,
  });
}
