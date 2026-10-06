// ─────────────────────────────────────────────────────────────────────
// KPI-SCRIBE — המפקיד היומי של משימת $1,000 · Z-9 · R130 (2026-09-28)
//
// הפער שסגר: MISSION-1000 §6 מבטיח "KPI.json מועדכן יומית" — אבל העדכון
// היה ידני (זריעת יום-0 + B-2). מי שמבטיח מדידה יומית ולא בונה את
// המפקיד — משאיר את הסולם תלוי בזיכרון של סוכנים. מעכשיו השרשרת
// זוכרת בשביל כולם.
//
// מה הוא עושה (טיק יומי, ראשון אחרי 12:05Z + catch-up ליום חסר):
//   1. מדידה (הכל קריאה-בלבד, פסק-זמן 30ש' לכל קריאה):
//        · /api/mission      — הספר היומי, הון, ריצות-שרשראות, חיות-צי
//        · /api/health       — db / rpc / vault / integrity
//        · Console/dex/grid.json (raw) — מנוע-הדלק, טריגרים-נצרכים, מילויים
//        · GitHub Actions (מאומת)      — ריצת trigger-mesh אחרונה
//   2. פסק-דין יומי כן: fleet מלא + רשת-בריאה + grid טרי + CI ירוק
//      (CI שנכשל מכתים את היום; כישלון-חיפוש CI מסומן unknown — לא שקר)
//   3. כתיבה מקומית: sovereign/kpi/history/YYYY-MM-DD.json (kpi-day-v1)
//   4. מיזוג-שימור: fleet/KPI.json — מעדכן רק שדות-מדידה; שדות של
//      סוכנים אחרים (contractTests, agents) נשמרים כמות-שהם (חוק #3)
//   5. דחיפה ל-Defi: KPI-history + KPI.json — דרך Contents API,
//      שער-סודות לפני כל דחיפה, PAT מהכספת המקומית, אף מפתח בגיט
//
// חוקי-ברזל (מהבית):
//   · R107b — כתיבת-מצב אטומית (tmp+rename); היסטוריה לא נשברת בשקט
//   · R112  — כל קריאה נושאת פסק-זמן; טיק תקוע עולה ריצה אחת, לא דיבון
//   · R123  — כישלון נרשם ככישלון; אין "נניח שהצליח"; lastRecordDay
//             מתעדכן רק אחרי ששתי הדחיפות נחתמו אצל השרשרת
//   · תיקון-שיטה מול יום-0: מילויי-גריד הם מצטבר-חיים ולא קצב — רק
//     קצבים (מנוע-הדלק/7 + ספר-ההכנסה) נספרים ב-usdPerDay
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

declare const Bun: {
  serve: (opts: {
    port: number;
    hostname?: string;
    fetch: (req: Request) => Promise<Response> | Response;
  }) => unknown;
  // r176 — משמר-המפקד: ריצת-תהליך-אסינכרונית (לא spawnSync — הטיק של-60ש' לא נחסם)
  spawn: (cmd: string[], opts?: { cwd?: string; stdout?: string; stderr?: string }) => {
    exited: Promise<number>;
    kill: () => void;
  };
};

const HOME = "/home/z/my-project";
const STATE_DIR = `${HOME}/sovereign/kpi`;
const HISTORY_DIR = `${STATE_DIR}/history`;
const STATE_FILE = `${STATE_DIR}/state.json`;
const PAT_FILE = `${HOME}/upload/pat.env`; // הכספת המקומית — מחוץ לגיט (upload/ ב-gitignore)
const PORT = 3041;
const ORG = "roshpinacare-sys";
const REPO = "Defi";
const TICK_SEC = 60;
const RECORD_HOUR_UTC = 12;
const FETCH_TIMEOUT_MS = 30_000;
const RECORD_WEDGE_MS = 5 * 60_000; // R112 — טיק תקוע עולה ריצה אחת
const GRID_FRESH_HOURS = 36;

// r176 — משמר-מפקד-ההכנסות (census-guard):
// המפקד (revenue-census.mjs) היה מחובר-רק-לשער-init.sh (בזמן-אתחול) — אף-
// מתזמן-לא-היה-מריץ-אותו. פער-חי-שנתפס-ב-r176: מדידת-התשלומים-האמיתיים
// (04/10 — הפרעוני-הקיורציה-הראשונים) היתה-תלויה-בזיכרון-סוכנים. מעתה:
// census-עתיק-מ-26ש' (אותו-סף-כשער-init.sh) → ריצה-אוטומטית-אסינכרונית.
const CENSUS_FILE = `${HOME}/sovereign/revenue/census.json`;
const CENSUS_MAX_AGE_MS = 26 * 3_600_000; // טריות-זהה-לשער-init.sh (MAX_AGE_H=26)
const CENSUS_ATTEMPT_COOLDOWN_MS = 60 * 60_000; // בין-ניסיונות — אין-ספירלה (R110)
const CENSUS_TIMEOUT_MS = 5 * 60_000; // R112 — לכל-ריצה פסק-זמן
let censusRunning = false; // מנעול-בזיכרון — אף-שתי-ריצות-במקביל

type CiProof = { id: number | null; conclusion: string; createdAt: string | null };

type ScribeState = {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  alive: boolean;
  recording: boolean;
  recordingSince: string | null;
  lastRecordDay: string | null;
  lastRecordAt: string | null;
  lastResult: Record<string, unknown> | null;
  lastCi: CiProof | null;
  secretsBlockedToday: number;
  secretsBlockDay: string;
  pushes: Array<{ at: string; path: string; ok: boolean; note?: string }>;
  history: Array<{ at: string; kind: string; detail: string }>;
  // r176 — משמר-מפקד-ההכנסות: הוכחה-נמדדת-של-הריצות-האוטומטיות
  censusGuard: {
    lastAttemptAt: string | null;
    lastExitAt: string | null;
    lastExitCode: number | null;
    lastDurationMs: number | null;
    lastStaleHours: number | null;
  };
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function freshState(): ScribeState {
  return {
    service: "kpi-scribe",
    version: "1.0.0",
    bootedAt: new Date().toISOString(),
    beats: 0,
    alive: true,
    recording: false,
    recordingSince: null,
    lastRecordDay: null,
    lastRecordAt: null,
    lastResult: null,
    lastCi: null,
    secretsBlockedToday: 0,
    secretsBlockDay: utcDay(),
    pushes: [],
    history: [],
    censusGuard: {
      lastAttemptAt: null,
      lastExitAt: null,
      lastExitCode: null,
      lastDurationMs: null,
      lastStaleHours: null,
    },
  };
}

function saveState() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.error(`[kpi-scribe] saveState נכשל: ${String((e as Error)?.message ?? e)}`);
  }
}

function logH(kind: string, detail: string) {
  state.history.push({ at: new Date().toISOString(), kind, detail });
  state.history = state.history.slice(-80);
  console.log(`[kpi-scribe] ${kind}: ${detail}`);
}

const state: ScribeState = loadState();

function loadState(): ScribeState {
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<ScribeState>;
    return {
      ...freshState(),
      ...prev,
      alive: true,
      recording: false,
      recordingSince: null,
      // r133 אמת-זהות: bootedAt תמיד העלייה האמיתית של התהליך הקורא — לא מצב שנשמר
      bootedAt: new Date().toISOString(),
    };
  } catch {
    return freshState();
  }
}

// ── שער-סודות: אותו חוק כמו ב-money — שום מפתח לא עובר ────────────
function secretsGate(text: string): { ok: boolean; reason?: string } {
  if (/[5JKLMNPQRSTUVWXYZ123456789]{50,52}/.test(text)) {
    return { ok: false, reason: "base58-wif-shape" };
  }
  if (/gh[pousr]_[A-Za-z0-9]{20,}/.test(text)) {
    return { ok: false, reason: "github-token-shape" };
  }
  if (/(pat|token|wif|password)\s*[:=]\s*\S{16,}/i.test(text)) {
    return { ok: false, reason: "secret-assignment-shape" };
  }
  return { ok: true };
}

function readPat(): string | null {
  try {
    const t = fs.readFileSync(PAT_FILE, "utf8").trim();
    return t.length > 20 ? t : null;
  } catch {
    return null;
  }
}

// ── קריאות — כל אחת נושאת פסק-זמן (R112) ───────────────────────────
async function fetchJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "kpi-scribe", ...headers },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, json: j };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

async function ghApi(p: string): Promise<{ ok: boolean; status: number; json: any }> {
  const pat = readPat();
  const headers: Record<string, string> = {};
  if (pat) headers.Authorization = `token ${pat}`;
  return fetchJson(`https://api.github.com${p}`, headers);
}

// תוכן קובץ מ-origin (מאומת — מחזיר sha לעדכון בטוח)
async function getOriginFile(
  filePath: string,
): Promise<{ sha: string | null; text: string | null }> {
  const r = await ghApi(`/repos/${ORG}/${REPO}/contents/${filePath}`);
  if (r.ok && r.json?.content) {
    try {
      return {
        sha: r.json.sha ?? null,
        text: Buffer.from(r.json.content, "base64").toString("utf8"),
      };
    } catch {
      return { sha: r.json.sha ?? null, text: null };
    }
  }
  // 404 = קובץ חדש לגיטימי; אחרת — כישלון קריאה נרשם בכנות
  if (r.status !== 404) logH("ORIGIN-READ", `fleet/KPI.json — HTTP ${r.status} (ממשיך בלי בסיס-מיזוג)`);
  return { sha: null, text: null };
}

// דחיפה יחידה — Contents API, מוזרקת sha, מוגנת שער-סודות
async function pushFile(filePath: string, content: string, message: string): Promise<boolean> {
  const gate = secretsGate(content);
  if (!gate.ok) {
    if (state.secretsBlockDay !== utcDay()) {
      state.secretsBlockDay = utcDay();
      state.secretsBlockedToday = 0;
    }
    state.secretsBlockedToday += 1;
    state.pushes.push({ at: new Date().toISOString(), path: filePath, ok: false, note: `BLOCKED: ${gate.reason}` });
    logH("SECRETS-BLOCK", `${filePath} — ${gate.reason}`);
    return false;
  }
  const pat = readPat();
  if (!pat) {
    state.pushes.push({ at: new Date().toISOString(), path: filePath, ok: false, note: "NO-PAT" });
    logH("PUSH-FAIL", `${filePath} — אין PAT בכספת המקומית`);
    return false;
  }
  const url = `https://api.github.com/repos/${ORG}/${REPO}/contents/${filePath}`;
  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "kpi-scribe",
    "Content-Type": "application/json",
  };
  try {
    const cur = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    let sha: string | undefined;
    if (cur.ok) sha = (await cur.json())?.sha;
    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    state.pushes.push({ at: new Date().toISOString(), path: filePath, ok: res.ok });
    if (!res.ok) logH("PUSH-FAIL", `${filePath} — HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    state.pushes.push({ at: new Date().toISOString(), path: filePath, ok: false, note: "TIMEOUT/ERR" });
    logH("PUSH-FAIL", `${filePath} — ${String((e as Error)?.message ?? e)}`);
    return false;
  }
}

// ── מדידה ───────────────────────────────────────────────────────────
type Measurement = {
  at: string;
  mission: any;
  health: any;
  grid: any;
  ci: CiProof & { lookupFailed: boolean };
};

async function measure(): Promise<Measurement> {
  const [mission, health, grid, ci] = await Promise.all([
    fetchJson("http://127.0.0.1:3000/api/mission"),
    fetchJson("http://127.0.0.1:3000/api/health"),
    fetchJson(`https://raw.githubusercontent.com/${ORG}/Console/main/dex/grid.json`),
    ghApi(`/repos/${ORG}/Console/actions/runs?per_page=12`),
  ]);

  let ciProof: CiProof & { lookupFailed: boolean } = {
    id: null,
    conclusion: "unknown",
    createdAt: null,
    lookupFailed: true,
  };
  const runs = ci.json?.workflow_runs;
  if (Array.isArray(runs)) {
    const t = runs.find((r: any) => typeof r?.path === "string" && /trigger/i.test(r.path));
    if (t) {
      ciProof = {
        id: t.id ?? null,
        conclusion: String(t.conclusion ?? "unknown"),
        createdAt: t.created_at ?? null,
        lookupFailed: false,
      };
    } else {
      ciProof = { id: null, conclusion: "no-run-found", createdAt: null, lookupFailed: false };
    }
  }
  state.lastCi = { id: ciProof.id, conclusion: ciProof.conclusion, createdAt: ciProof.createdAt };

  return {
    at: new Date().toISOString(),
    mission: mission.json,
    health: health.json,
    grid: grid.json,
    ci: ciProof,
  };
}

// ── פסק-דין ירוק — כנות: CI שנכשל מכתים; כישלון-חיפוש לא ───────────
function evaluate(meas: Measurement): {
  green: boolean;
  checks: Record<string, unknown>;
  notes: string[];
} {
  const notes: string[] = [];
  const missionOk = !!meas.mission?.ok;
  const healthOk =
    !!meas.health?.ok && !!meas.health?.checks?.db?.ok && !!meas.health?.checks?.rpc?.ok;
  const fleet = meas.mission?.fleet;
  const fleetUp = typeof fleet?.up === "number" ? fleet.up : null;
  const fleetTotal = typeof fleet?.total === "number" ? fleet.total : null;
  const fleetFull = fleetUp !== null && fleetTotal !== null && fleetUp === fleetTotal;

  const pubAt = meas.grid?.publishedAt ? new Date(meas.grid.publishedAt) : null;
  const gridAgeH =
    pubAt && !isNaN(pubAt.getTime()) ? (Date.now() - pubAt.getTime()) / 3_600_000 : null;
  const gridFresh = gridAgeH !== null && gridAgeH <= GRID_FRESH_HOURS;

  const ciFailed =
    !meas.ci.lookupFailed &&
    ["failure", "startup_failure", "timed_out"].includes(meas.ci.conclusion);
  if (meas.ci.lookupFailed)
    notes.push("CI-LOOKUP-FAILED — נרשם unknown; היום לא נכתם אדום בגלל חיפוש, אבל זה מתועד");

  const secretsBlocked = state.secretsBlockDay === utcDay() ? state.secretsBlockedToday : 0;
  if (secretsBlocked > 0)
    notes.push(`SECRETS-BLOCKED-TODAY=${secretsBlocked} — ניסיון-דליפה נחסם; יום לא ירוק`);

  const green = missionOk && healthOk && fleetFull && gridFresh && !ciFailed && secretsBlocked === 0;

  return {
    green,
    checks: {
      missionOk,
      healthOk,
      fleetUp: fleetUp !== null ? `${fleetUp}/${fleetTotal}` : "unknown",
      fleetFull,
      gridFresh,
      gridAgeHours: gridAgeH !== null ? Math.round(gridAgeH * 10) / 10 : null,
      ci: {
        id: meas.ci.id,
        conclusion: meas.ci.conclusion,
        createdAt: meas.ci.createdAt,
        lookupFailed: meas.ci.lookupFailed,
      },
      secretsBlockedToday: secretsBlocked,
    },
    notes,
  };
}

// ── רצף ימים ירוקים — נספר מקבצי-ההיסטוריה המקומיים (עותק של השרשרת) ─
function computeStreak(day: string): number {
  let n = 0;
  let cursor = new Date(`${day}T00:00:00Z`);
  for (let i = 0; i < 60; i++) {
    const d = cursor.toISOString().slice(0, 10);
    const f = `${HISTORY_DIR}/${d}.json`;
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      if (j?.green === true) n++;
      else break;
    } catch {
      break;
    }
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return n;
}

// ── הרכבת KPI.json — מיזוג-שימור: רק שדות-מדידה, אף שדה של סוכן אחר ──
function mergeKpi(
  prevText: string | null,
  meas: Measurement,
  green: boolean,
  streak: number,
  day: string,
): string {
  let prev: any = {};
  if (prevText) {
    try {
      prev = JSON.parse(prevText);
    } catch {
      prev = {};
      logH("MERGE", "KPI.json ב-origin לא נפרס — מתחיל מבסיס חדש (העתק קיים נשמר בגיט-היסטוריה)");
    }
  }

  const fuel = meas.grid?.fuel ?? null;
  const fuelActive = fuel?.powerdownActive === true && typeof fuel?.weeklyUsd === "number";
  const fuelEngineUsdPerDay = fuelActive
    ? Math.round(((fuel.weeklyUsd as number) / 7) * 10000) / 10000
    : 0;
  const book = meas.mission?.measured ?? null;
  const missionBookUsdPerDay =
    typeof book?.usdPerDay7dAvg === "number" && (book?.daysRecorded ?? 0) > 0
      ? book.usdPerDay7dAvg
      : 0;
  const fillsLifetime = typeof meas.grid?.externalFlowUsd === "number" ? meas.grid.externalFlowUsd : 0;
  // r132 · תיקון-D-012: revenuePerDayUsd = הכנסה ממומשת מהספר בלבד.
  // fuelEngine (פאוורדאון SP→נוזלי) היא המרת-הון ולא הכנסה — ספר-ההכנסה
  // עצמו קובע "הון שנכנס אינו הכנסה", והיא נגמרת כשה-SP נגמר (remainingWeeks).
  const revenueUsd = Math.round(missionBookUsdPerDay * 10000) / 10000;

  const merged: any = { ...prev };
  merged.ok = true;
  merged.version = 1;
  merged.updatedAt = new Date().toISOString();
  merged.updatedBy = "kpi-scribe v1.0.0 (measured — Z-9)";
  merged.mission = "MISSION-1000";

  merged.revenuePerDayReal = {
    usd: revenueUsd,
    method:
      "mission book usdPerDay7dAvg (/api/mission → sovereign/income/daily-*.json) — הכנסה ממומשת בלבד (תיקון D-012 · r132)",
    breakdown: {
      missionBookUsdPerDay,
      fuelEngineUsdPerDay,
      gridExternalFillsLifetimeUsd: fillsLifetime,
      note:
        "תיקון-D-012 (r132): fuelEngine (פאוורדאון SP→נוזלי) אינו נספר עוד ב-revenuePerDayUsd — הוא שריפת-הון, לא הכנסה; נמדד ומוצג בנפרד ב-fuelBurn. Z-9 תיקון-שיטה מול יום-0: מילויי-גריד הם מצטבר-חיים ולא קצב.",
    },
    fuelBurn: fuelActive
      ? {
          usdPerDay: fuelEngineUsdPerDay,
          weeklySp: fuel?.weeklySp ?? null,
          remainingSp: fuel?.remainingSp ?? null,
          remainingWeeks: fuel?.remainingWeeks ?? null,
          nextPayout: fuel?.nextPayout ?? null,
          lawHe:
            "המרת SP לנוזלי — הון שנשרף לתדלוק, לא הכנסה (D-012 · r132). נגמרת עם ה-SP; נמדדת כ-capitalInflow בספר-ההכנסה.",
        }
      : null,
    sources: [
      "/api/mission → measured.usdPerDay7dAvg (sovereign/income/daily-*.json)",
      "/api/mission → capital (מוביל-הכסף)",
      "Console/dex/grid.json#fuel (raw, נמדד בזמן-ריצה — fuelBurn בלבד)",
      "Console/dex/grid.json#externalFlowUsd (מצטבר-חיים)",
    ],
    caveat:
      "פנימי-בלבד: עמלות USDS ו-APY הן סימולציה — לא נספרות כהכנסה. fuelBurn = פאוורדאון SP חוץ אמיתי — קצב שריפת-הון עם תאריך-סיום, לעולם לא קצב הכנסה.",
  };

  merged.triggers = {
    ...(prev?.triggers ?? {}),
    engine: prev?.triggers?.engine ?? "Console/triggers trigger-mesh v1.0.0",
    rules: prev?.triggers?.rules ?? 7,
    chainRuns24h: meas.mission?.triggers?.totalRuns24h ?? null,
    chainOk24h: meas.mission?.triggers?.okRuns24h ?? null,
    gridConsumedCount: Array.isArray(meas.grid?.triggers?.consumed)
      ? meas.grid.triggers.consumed.length
      : null,
    gridBookPublishedAt: meas.grid?.triggers?.bookPublishedAt ?? null,
    lastCi: { id: meas.ci.id, conclusion: meas.ci.conclusion, createdAt: meas.ci.createdAt },
    note:
      Array.isArray(meas.grid?.triggers?.consumed) && meas.grid.triggers.consumed.length > 0
        ? "טריגרים נצרכו במחזור האחרון של grid-pulse — הלולאה חיה"
        : "אין טריגרים נצרכים במחזור האחרון — תוצאה כנה, לא תקלה",
    loopWiring: prev?.triggers?.loopWiring,
  };

  merged.ladder = {
    current: "L0",
    next: "L1",
    targetPerDay: 0,
    proven: false,
    consecutiveGreenDays: streak,
    asOfDay: day,
    noteHe:
      "L0 = הוכחת-מנוע: צי מלא + רשת בריאה + grid טרי + CI ירוק, 7 ימים רצופים (MISSION-1000 §1). הרצף נספר מקבצי KPI-history — יום חסר שובר את הרצף בכנות.",
  };

  merged.compliance = {
    ...(prev?.compliance ?? {}),
    secretsInCommits: 0,
    unmeasuredClaims: 0,
    secretsBlockedToday: state.secretsBlockDay === utcDay() ? state.secretsBlockedToday : 0,
  };

  merged.dailyRecord = {
    day,
    green,
    streak,
    historyPath: `fleet/KPI-history/${day}.json`,
    measuredAt: meas.at,
  };

  return JSON.stringify(merged, null, 1) + "\n";
}

// ── הריצה היומית ────────────────────────────────────────────────────
let recording = false;

async function runRecord(force: boolean): Promise<Record<string, unknown>> {
  if (recording) return { ok: false, reason: "RECORD-IN-PROGRESS" };
  const startedAt = Date.now();
  recording = true;
  state.recording = true;
  state.recordingSince = new Date().toISOString();
  saveState();

  const day = utcDay();
  const notes: string[] = [];
  try {
    if (force) {
      notes.push("RECORD-FORCED — נדרש ידנית (POST /record)");
      notes.push(
        "D-012-SEMANTICS-FIX (r132): revenuePerDayUsd = הכנסה ממומשת בלבד; פאוורדאון SP נמדד כ-fuelBurn (המרת-הון), לא כהכנסה",
      );
    }
    if (!state.lastRecordDay) notes.push("FIRST-RECORD-EVER — המפקיד נולד היום; רצף הירוק מתחיל מכאן");

    const meas = await measure();
    const ev = evaluate(meas);
    notes.push(...ev.notes);

    const streak = computeStreak(day); // ימים קודמים; היום נכתב מיד למטה
    const record = {
      at: meas.at,
      green: ev.green,
      checks: ev.checks,
      measured: {
        // r132 · D-012: revenuePerDayUsd = ספר ממומש בלבד; fuelEngine = שריפת-הון (לא נספרת)
        revenuePerDayUsd: Math.round((meas.mission?.measured?.usdPerDay7dAvg ?? 0) * 10000) / 10000,
        fuelBurnRemainingWeeks:
          meas.grid?.fuel?.powerdownActive ? (meas.grid?.fuel?.remainingWeeks ?? null) : null,
        fuelEngineUsdPerDay:
          meas.grid?.fuel?.powerdownActive && typeof meas.grid?.fuel?.weeklyUsd === "number"
            ? Math.round(((meas.grid.fuel.weeklyUsd as number) / 7) * 10000) / 10000
            : 0,
        missionBookUsdPerDay: meas.mission?.measured?.usdPerDay7dAvg ?? null,
        daysRecorded: meas.mission?.measured?.daysRecorded ?? null,
        gridExternalFillsLifetimeUsd: meas.grid?.externalFlowUsd ?? null,
        capitalUsd: meas.mission?.capital?.capitalUsd ?? null,
        // r133: ההון = נוזלי + מוצב בפקודות פתוחות (אמת-הון מלאה, עקבי-D-012)
        capitalSteemInOrders: meas.mission?.capital?.steemInOrders ?? null,
        capitalSteemTotal: meas.mission?.capital?.steemTotal ?? null,
        steemUsd: meas.mission?.capital?.steemUsd ?? null,
        triggers: {
          chainRuns24h: meas.mission?.triggers?.totalRuns24h ?? null,
          chainOk24h: meas.mission?.triggers?.okRuns24h ?? null,
          gridConsumedCount: Array.isArray(meas.grid?.triggers?.consumed)
            ? meas.grid.triggers.consumed.length
            : null,
        },
      },
      streak: { consecutiveGreenDays: ev.green ? streak + 1 : 0, asOf: day },
      sources: [
        "http://127.0.0.1:3000/api/mission",
        "http://127.0.0.1:3000/api/health",
        "https://raw.githubusercontent.com/roshpinacare-sys/Console/main/dex/grid.json",
        "https://api.github.com/repos/roshpinacare-sys/Console/actions/runs",
      ],
      notes,
    };

    // 1) רשומה יומית מקומית (אטומית; ריצה-על-אותו-יום מצטברת ל-runs)
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const histLocal = `${HISTORY_DIR}/${day}.json`;
    let prevRuns: any[] = [];
    try {
      const p = JSON.parse(fs.readFileSync(histLocal, "utf8"));
      if (Array.isArray(p?.runs)) prevRuns = p.runs;
      else if (p?.at) prevRuns = [p];
    } catch {}
    const dayDoc = {
      ok: true,
      format: "kpi-day-v1",
      day,
      last: record,
      runs: [...prevRuns, record].slice(-12),
    };
    const tmp = `${histLocal}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dayDoc, null, 1));
    fs.renameSync(tmp, histLocal);

    // 2) דחיפות לשרשרת — lastRecordDay מתעדכן רק אחרי שתיהן נחתמו (R123)
    const pushHist = await pushFile(
      `fleet/KPI-history/${day}.json`,
      JSON.stringify(dayDoc, null, 1),
      `kpi-scribe: daily KPI ${day} — green=${ev.green} streak=${ev.green ? streak + 1 : 0} (measured ${meas.at})`,
    );

    const origin = await getOriginFile("fleet/KPI.json");
    const kpiJson = mergeKpi(origin.text, meas, ev.green, ev.green ? streak + 1 : 0, day);
    const pushKpi = await pushFile(
      "fleet/KPI.json",
      kpiJson,
      `kpi-scribe: KPI.json update ${day} — realized $${record.measured.revenuePerDayUsd}/day + fuel-burn $${record.measured.fuelEngineUsdPerDay}/day (D-012 fix r132, measured)`,
    );

    const allPushed = pushHist && pushKpi;
    if (allPushed) {
      state.lastRecordDay = day;
      state.lastRecordAt = new Date().toISOString();
    } else {
      notes.push("PUSH-INCOMPLETE — lastRecordDay לא התעדכן; יינסה שוב בטיק הבא");
    }

    const result = {
      ok: allPushed,
      day,
      green: ev.green,
      streak: ev.green ? streak + 1 : 0,
      revenuePerDayUsd: record.measured.revenuePerDayUsd,
      pushes: { history: pushHist, kpi: pushKpi },
      notes,
      durationMs: Date.now() - startedAt,
    };
    state.lastResult = result;
    logH("RECORD", `day=${day} green=${ev.green} pushed=${allPushed} ($${record.measured.revenuePerDayUsd}/day)`);
    return result;
  } catch (e) {
    const result = { ok: false, day, error: String((e as Error)?.message ?? e), notes };
    state.lastResult = result;
    logH("RECORD-FAIL", `${day}: ${String((e as Error)?.message ?? e)}`);
    return result;
  } finally {
    recording = false;
    state.recording = false;
    state.recordingSince = null;
    saveState();
  }
}

// ── טיק — תזמון + חוק המשמרת-התקועה (R112) ─────────────────────────
function dueNow(): { due: boolean; why: string } {
  const now = new Date();
  const today = utcDay(now);
  if (state.lastRecordDay === today) return { due: false, why: "already-recorded-today" };
  if (now.getUTCHours() >= RECORD_HOUR_UTC) return { due: true, why: `hour>=${RECORD_HOUR_UTC}Z` };
  // catch-up: יום נמדד חסר — מקליטים עכשיו (ההערה נכתבת בתוך הרשומה)
  const yesterday = utcDay(new Date(now.getTime() - 86_400_000));
  if (state.lastRecordDay && state.lastRecordDay < yesterday)
    return { due: true, why: "catch-up — יום נמדד חסר" };
  return { due: false, why: "wait-for-window" };
}

// r176 — משמר-המפקד: census-עתיק → ריצה-אוטומטית (אסינכרוני, לא-חוסם-טיק)
function censusGuard() {
  if (censusRunning) return;
  const now = Date.now();
  if (state.censusGuard.lastAttemptAt && now - Date.parse(state.censusGuard.lastAttemptAt) < CENSUS_ATTEMPT_COOLDOWN_MS)
    return;
  let ageMs = Number.POSITIVE_INFINITY; // חסר/שבור = הכי-עתיק-שיש
  try {
    const at = JSON.parse(fs.readFileSync(CENSUS_FILE, "utf8"))?.at;
    if (typeof at === "string") ageMs = now - Date.parse(at);
  } catch {}
  if (!(ageMs >= CENSUS_MAX_AGE_MS)) return; // טרי (או NaN-מוזר) — לא נוגעים
  censusRunning = true;
  const startedAt = Date.now();
  const staleH = Math.round((ageMs / 3_600_000) * 10) / 10;
  state.censusGuard = { ...state.censusGuard, lastAttemptAt: new Date().toISOString(), lastStaleHours: staleH };
  logH("CENSUS-GUARD", `census-עתיק (${staleH}ש') — מריץ-מפקד-ההכנסות`);
  try {
    const proc = Bun.spawn(["bun", "scripts/revenue-census.mjs"], { cwd: HOME, stdout: "pipe", stderr: "pipe" });
    const killer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
    }, CENSUS_TIMEOUT_MS);
    proc.exited
      .then((code) => {
        clearTimeout(killer);
        censusRunning = false;
        state.censusGuard = {
          ...state.censusGuard,
          lastExitAt: new Date().toISOString(),
          lastExitCode: code ?? -1,
          lastDurationMs: Date.now() - startedAt,
        };
        logH("CENSUS-DONE", `exit=${code} · ${Math.round((Date.now() - startedAt) / 1000)}ש'`);
        saveState();
      })
      .catch(() => {
        clearTimeout(killer);
        censusRunning = false;
        logH("CENSUS-FAIL", "ריצת-המפקד-נכשלה-בהפעלה — נוסה-שוב-אחרי-צינון");
        saveState();
      });
  } catch {
    censusRunning = false;
    logH("CENSUS-FAIL", "spawn-נכשל — נוסה-שוב-אחרי-צינון");
  }
}

function tick() {
  state.beats += 1;
  lastBeatAt = Date.now(); // r143-c — הוכחת-החיים נמדדת כאן (הטיק סינכרוני — מתקדם בכל 60ש')

  // משמרת-תקועה: ריצה שתקועה יותר מ-RECORD_WEDGE_MS משוחררת בכנות
  if (state.recording && state.recordingSince) {
    const heldMs = Date.now() - new Date(state.recordingSince).getTime();
    if (heldMs > RECORD_WEDGE_MS) {
      state.recording = false;
      state.recordingSince = null;
      recording = false;
      logH("WEDGE-RELEASE", `ריצה תקועה ${Math.round(heldMs / 1000)}ש' — שוחררה; הדיבון חי`);
    }
  }

  const { due, why } = dueNow();
  if (due) {
    logH("SCHEDULE", `ריצה יומית (${why})`);
    runRecord(false).catch(() => {});
  }

  // r176 — משמר-המפקד: אחרי-שכל-השאר-הוגדר — census-עתיק-מתחדש-בעצמו
  censusGuard();

  if (state.beats % 30 === 0) saveState();
}

// ── שרת — הפנים של הדיבון (כך השומר והמשימה רואים אותו) ───────────
Bun.serve({
  port: PORT,
  // 2026-09-29 audit fix (HIGH · R123/2-b residual): loopback-only, כמו heart-service —
  // אין שום סיבה לחשוף את הספר היומי מחוץ-למכונה.
  // TODO(auth): POST /record חשוף ללא אימות — loopback ממתן, לא סוגר; נדרוש token כשיהיה שער-משותף.
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/record") {
      const r = await runRecord(true);
      return new Response(JSON.stringify(r), {
        status: r.ok ? 200 : 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/history") {
      try {
        const days = fs.readdirSync(HISTORY_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
        return new Response(JSON.stringify({ ok: true, days }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        return new Response(JSON.stringify({ ok: true, days: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response(
      JSON.stringify({
        // 2026-09-29 (r139): `ok:true` — השורש של לופ-הקריסה. הסיור של keeper
        // משפט חיים לפי `j?.ok` (keeper/index.ts probe()); התשובה הזו לא נשאה
        // את השדה — כל סיור נכשל → 3 פסילות → הקמה-מחדש → שוב. 192 הקמות
        // ביום על דיבון בריא לחלוטין. השדה חוזר — הסיור שופט אמת.
        ok: true,
        service: "kpi-scribe",
        version: state.version,
        bootedAt: state.bootedAt,
        beats: state.beats,
        alive: true,
        role: "המפקיד היומי של משימת $1,000 — Z-9 · fleet/KPI.json + fleet/KPI-history/ ל-Defi",
        schedule: `daily first tick after ${RECORD_HOUR_UTC}:05Z + catch-up`,
        lastRecordDay: state.lastRecordDay,
        lastRecordAt: state.lastRecordAt,
        lastResult: state.lastResult,
        recording: state.recording,
        secretsBlockedToday: state.secretsBlockDay === utcDay() ? state.secretsBlockedToday : 0,
        censusGuard: state.censusGuard, // r176 — השמר-גלוי-לסיור
        recentPushes: state.pushes.slice(-6),
        recentHistory: state.history.slice(-6),
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
});

console.log(`[kpi-scribe] קם על :${PORT} — המפקיד היומי של MISSION-1000 (Z-9)`);

// r143-c — חותמת-הפעימה האחרונה — מזינה את מתג-איש-המת למטה
let lastBeatAt = Date.now();

// טיק ראשון מיידי + מחזור
tick();
setInterval(tick, TICK_SEC * 1000);

// ── r143-c · מתג-איש-מת ─────────────────────────────────────
// זומבי חי שנמדד (keeper, r143): HTTP עונה בזמן שהפעימות קפואות.
// כל 60ש' נמדדת התקדמות-הלולאה; שתיקה מעל 10 דק' ⇒ שורה כנה ביומן
// ויציאה (exit 1) — fleet-guard יקים תהליך-טרי. הטיק עצמו סינכרוני
// (הרישום היומי רץ async ולא חוסם פעימות; משמרת-הנעילה R112 היא 5 דק')
// — כך שריצה ארוכה אחת לעולם לא הורגת דיבון בריא. הטיימר במשמר-גלובלי
// (חוק הטיימר-היחיד) — טעינה-חמה לא מכפילה שומרים.
const DEAD_MAN_TICK_MS = 60_000;
const DEAD_MAN_STALL_MS = 10 * 60_000; // > 2×קצב (60ש') · > RECORD_WEDGE_MS (5 דק')
const DEAD_MAN_LOG = `${HOME}/sovereign/keeper/logs/kpi-daemon.log`;
const G_DM = globalThis as unknown as { __KPI_DEADMAN__?: ReturnType<typeof setInterval> };
if (G_DM.__KPI_DEADMAN__) clearInterval(G_DM.__KPI_DEADMAN__);
G_DM.__KPI_DEADMAN__ = setInterval(() => {
  if (Date.now() - lastBeatAt <= DEAD_MAN_STALL_MS) return;
  const msg = "dead-man: beats stalled >10min — exiting for revival";
  try {
    fs.mkdirSync(`${HOME}/sovereign/keeper/logs`, { recursive: true });
    fs.appendFileSync(DEAD_MAN_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log(msg);
  clearInterval(G_DM.__KPI_DEADMAN__);
  process.exit(1);
}, DEAD_MAN_TICK_MS);
