// GET /api/weave/repos — מערך הריפואים המלא (R118: השמשת הגיט)
//
// האמת שנשברה כאן ונתקנה: מ-20/09 עמדו עשרה ריפואים בארגון בקפאה
// — המאמתים רצו מקומית מ-R109, אך פסקי-הדין נשארו בקובץ מקומי
// בלבד. מ-R118 כל פסק-דין חוזר לגיט בזהות <job>[bot] (חוק דחיפת
// פסק-הדין). ה-API הזה מגיש את התמונה המלאה והכנה: כל ריפו בארגון
// עם האמת החיה מ-GitHub (קומיט אחרון, גיל, גודל) ממוזגת עם מצב
// המפעל המקומי (פסק-דין, דחיפה, כיסוי).
//
// מקורות: GitHub REST (קריאה בלבד, טוקן הסמכות מהכספת) + קובץ-האמת
// של הדיבון sovereign/fleet-verify/state.json. מטמון זיכרון 60ש' —
// לא רודפים אחרי הענן בכל בקשת-דף.
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const HOME = "/home/z/my-project";
const ORG = "roshpinacare-sys";
const FV_STATE = `${HOME}/sovereign/fleet-verify/state.json`;
const CACHE_MS = 60_000;

// כל 16 הריפואים של החשבון (r121: הושלם המחסור — Defi, steem ו-saos-dex
// היו חיים-דוחפים אך הוסתרו מ"הארגון המלא"). עשרת המאומתים מוזנים
// ממכונת הריפויים; ששת החיים ישירות מהמערכות עצמן.
const REPOS: Array<{ name: string; roleHe: string; kind: "verified" | "live" }> = [
  { name: "Zip", roleHe: "הבית — שרשרת העדויות, המראה והריבונות", kind: "live" },
  { name: "Console", roleHe: "שער הענן של הקונסולה", kind: "live" },
  { name: "Domain", roleHe: "שער הענן של הדומיין", kind: "live" },
  { name: "saos-dex", roleHe: "הבורסה — שרשרת-הדקס ומנוע ההחלפות", kind: "live" },
  { name: "Defi", roleHe: "זירת ההלוואות והפקדות — דוחות הדיבונים החיים", kind: "live" },
  { name: "steem", roleHe: "מקור שרשרת-העדות החברתית — צומת הצי", kind: "live" },
  { name: "saos-jummper", roleHe: "נוטריון ההוכחות חוצה-השרשרות", kind: "verified" },
  { name: "Sdk", roleHe: "ערכת הכלים והשידורים של הרשת", kind: "verified" },
  { name: "roshpina", roleHe: "בקרת הישות והאימות הפנימי", kind: "verified" },
  { name: "anchor-baseline", roleHe: "קו-הבסיס ההיסטורי — ההיסטוריה לא נמחקת", kind: "verified" },
  { name: "Adsmarket", roleHe: "זירת הפרסום וטענות השוק", kind: "verified" },
  { name: "Saosmartwallet", roleHe: "הארנק — 7 רשתות, כספת מפתחות ריבונית", kind: "verified" },
  { name: "saos-sovereign-platform", roleHe: "מנוע ההשקיה של הפלטפורמה הריבונית", kind: "verified" },
  { name: "saos-control-center", roleHe: "מרכז הבקרה של הרשת", kind: "verified" },
  { name: "saos-sovereign-foundry", roleHe: "בית-היציקה — מקור הכלים והעדויות (המאמת העשירי, R118)", kind: "verified" },
  { name: "Project-files", roleHe: "ארכיון הקבצים וההוכחות ההיסטורי", kind: "verified" },
];

interface FvJobLocal {
  id: string;
  repo: string;
  verdict: string;
  lastRunAt: string | null;
  reason?: string | null;
  push?: { at: string; commit: string | null; verdict: string; detail: string } | null;
}

interface RepoEcosystemDTO {
  name: string;
  roleHe: string;
  kind: "verified" | "live";
  // אמת חיה מהענן
  cloud: {
    ok: boolean;
    pushedAt: string | null;
    ageMinutes: number | null;
    sizeKb: number | null;
    lastCommit: { sha: string; message: string; author: string; date: string } | null;
    error?: string;
  };
  // אמת מקומית מהמפעל
  factory: {
    covered: boolean;
    jobId: string | null;
    verdict: string | null;
    lastRunAt: string | null;
    push: { at: string; commit: string | null; verdict: string; detail: string } | null;
  };
}

// טוקן הסמכות — סדר זהה לחוק הארכיון: env → upload/pat.env (ה-runner הראשי)
function readPat(): string | null {
  const envT = process.env.WEAVE_ARCHIVE_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (envT) return envT;
  try {
    const t = fs.readFileSync(path.join(HOME, "upload", "pat.env"), "utf8").trim();
    if (t.length > 20) return t;
  } catch {
    /* אין כספת מקומית */
  }
  return null;
}

// מטמון זיכרון — הענן לא נרדף בכל בקשה (חוק 60 השניות)
const G = globalThis as { __WEAVE_REPOS_CACHE__?: { at: number; data: object } };
function cacheGet(): object | null {
  const c = G.__WEAVE_REPOS_CACHE__;
  if (c && Date.now() - c.at < CACHE_MS) return c.data;
  return null;
}
function cacheSet(data: object): void {
  G.__WEAVE_REPOS_CACHE__ = { at: Date.now(), data };
}

async function ghJson(pat: string, apiPath: string): Promise<unknown | null> {
  try {
    const r = await fetch(`https://api.github.com${apiPath}`, {
      headers: { Authorization: `token ${pat}`, Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

async function buildEcosystem(pat: string | null): Promise<RepoEcosystemDTO[]> {
  // קובץ-האמת המקומי של המפעל — פסקי-דין ודחיפות
  let fvJobs: FvJobLocal[] = [];
  try {
    const st = JSON.parse(fs.readFileSync(FV_STATE, "utf8"));
    fvJobs = Array.isArray(st.jobs) ? (st.jobs as FvJobLocal[]) : [];
  } catch {
    /* המפעל טרם כתב — כיסוי ללא פסק-דין */
  }

  return Promise.all(
    REPOS.map(async (repo): Promise<RepoEcosystemDTO> => {
      const job = fvJobs.find((j) => j.repo === repo.name) ?? null;
      const dto: RepoEcosystemDTO = {
        name: repo.name,
        roleHe: repo.roleHe,
        kind: repo.kind,
        cloud: { ok: false, pushedAt: null, ageMinutes: null, sizeKb: null, lastCommit: null },
        factory: {
          covered: Boolean(job),
          jobId: job?.id ?? null,
          verdict: job?.verdict ?? null,
          lastRunAt: job?.lastRunAt ?? null,
          push: job?.push ?? null,
        },
      };
      if (!pat) {
        dto.cloud.error = "אין סמכות (PAT) — אמת הענן לא נקראת";
        return dto;
      }
      const meta = (await ghJson(pat, `/repos/${ORG}/${repo.name}`)) as Record<string, unknown> | null;
      if (!meta) {
        dto.cloud.error = "הענן לא ענה לריפו זה";
        return dto;
      }
      dto.cloud.ok = true;
      dto.cloud.sizeKb = typeof meta.size === "number" ? meta.size : null;
      const pushedAt = str(meta.pushed_at) || null;
      dto.cloud.pushedAt = pushedAt;
      if (pushedAt) {
        dto.cloud.ageMinutes = Math.max(0, Math.round((Date.now() - Date.parse(pushedAt)) / 60_000));
      }
      // קומיט אחרון על הענף ברירת-המחדל — שם, הודעה וזהות כותב
      const branch = str(meta.default_branch) || "main";
      const br = (await ghJson(pat, `/repos/${ORG}/${repo.name}/commits/${branch}`)) as Record<string, unknown> | null;
      if (br && typeof br.sha === "string") {
        const c = (br.commit ?? {}) as Record<string, unknown>;
        const a = (c.author ?? {}) as Record<string, unknown>;
        dto.cloud.lastCommit = {
          sha: br.sha.slice(0, 9),
          message: str(c.message).split("\n")[0].slice(0, 90),
          author: str(a.name),
          date: str(a.date),
        };
      }
      return dto;
    }),
  );
}

export async function GET() {
  const cached = cacheGet();
  if (cached) return NextResponse.json({ ok: true, cached: true, ...cached });
  try {
    const pat = readPat();
    const repos = await buildEcosystem(pat);
    const frozenOver24h = repos.filter((r) => r.cloud.ageMinutes != null && r.cloud.ageMinutes > 24 * 60).length;
    const pushedByFactory = repos.filter(
      (r) => r.factory.push && (r.factory.push.verdict === "PASS" || r.factory.push.verdict === "FAIL"),
    ).length;
    const payload = {
      org: ORG,
      generatedAt: new Date().toISOString(),
      source: "GitHub REST + sovereign/fleet-verify/state.json",
      summary: {
        total: repos.length,
        covered: repos.filter((r) => r.factory.covered).length,
        pushedByFactory,
        frozenOver24h,
        patAvailable: Boolean(pat),
      },
      repos,
    };
    cacheSet(payload);
    return NextResponse.json({ ok: true, cached: false, ...payload });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `מערך הריפואים לא נבנה: ${String(e).slice(0, 160)}` },
      { status: 503 },
    );
  }
}
