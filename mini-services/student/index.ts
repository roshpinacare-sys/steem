// ─────────────────────────────────────────────────────────────────────
// STUDENT — התלמיד · האוטונומיה המתפתחת (R94).
//
// הוראת המפעיל שיצרה את הדיבון: "אני רוצה אוטונומיה מתפתחת שמייעלת
// את עצמה בוחנת את עצמה ולומדת את עצמה טוב יותר... אם נכסה את הכל
// מבחינת סוכנים וניתן להם יכולות שיפור הבנה התייעלות וכו הם יוכלו
// לשפר הכל כמכלול... אני לא רוצה ריבונות עצלנית אני רוצה הוכחות
// התפתחות הבנה התייעלות".
//
// מה התלמיד עושה בכל מחזור (10 דק'):
//   1. בחינה-עצמית: בודק את המערכות (API מקומיים + צי הדיבונים)
//      ומודד זמינות + זמן-תגובה. כישלון נרשם כ"לא נמדד" — לא מוסתר.
//   2. מפת-כיסוי הרשת: 16 הריפואים — דחיפה אחרונה, סוכנים פעילים,
//      פסק-דין ריצה אחרונה. מי מתקדם בלי עין = פער מתועד.
//   3. למידה מההיסטוריה: קורא את ה-worklog (הספר שלנו), סופר
//      סבבים, באגים-חיים שנתפסו ולקחים — ובונה מדד-התפתחות מדוד.
//      למידה מהישנות: כשל חוזר 3× רצוף מסומן RECURRING עד ריפוי.
//   4. ספר-פוטנציאל: מה צפוי מהרשת, מה נמדד, מה חסום מאחורי שער.
//   5. ריפוי-בטוח (תקציב 3/יום): סנכרון הספר + ריפוי הצ'רטרים —
//      הפעולות האידמפוטנטיות המתועדות בלבד. שום דבר אחר.
//
// חוקי-ברזל:
//   · לעולם לא מזייף מספר — כישלון מדידה = "לא נמדד"
//   · ה-PAT בקריאה בלבד, לעולם לא נכתב לשום מקום
//   · אין פעולת-כסף, אין פעולת-גיט — רק מדידה + ריפוי מתועד
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה (כמו במפעל-האימות)
declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/student/state.json`;
const PORT = 3037;
const CYCLE_SEC = 600;
const COVERAGE_EVERY = 6; // כל 6 מחזורים = שעה — עדינות מול ה-API של GitHub
const WORKLOG = `${HOME}/worklog.md`;
const GH = "https://api.github.com";

// ── הגדרות-כיסוי: הריפואים המוכרים + תפקידם (נמדדו בפתיחת R94) ────

const REPO_ROLES: Record<string, string> = {
  Zip: "בית ריבוני — ספר, סקריפטים, worklog",
  Console: "קונסולה ציבורית — אתר, זרימות, גשר-סוכנים",
  steem: "כלי רשות העוגן",
  "saos-dex": "מנוע הדקס",
  Defi: "ריפו-קנון — דוחות וקבלות",
  Domain: "מראה ציבורית — המכונה (20 זרימות)",
  "saos-sovereign-foundry": "CI חוזים — האמת לפי הריצה האחרונה (לא הזיכרון)",
  Adsmarket: "שמירת-טענות שיווק",
  "anchor-baseline": "שלמות בסיס-קו",
  roshpina: "ביקורת בקרות",
  Sdk: "אימות SDK",
  "saos-jummper": "סוויטת נוטריון",
  "Project-files": "שומר-ארכיון",
  "saos-control-center": "בניית מרכז-בקרה",
  "saos-sovereign-platform": "מנוע-קצה",
  Saosmartwallet: "אימות ארנק",
};

// ── טיפוסים ────────────────────────────────────────────────────────

type Decision = { at: string; kind: string; detail: string };

interface ProbeResult {
  probe: string;
  ok: boolean;
  ms: number | null;
  at: string;
}

interface CoverageEntry {
  repo: string;
  role: string;
  pushedAt: string | null;
  pushAgeH: number | null;
  workflows: number | null;
  lastRun: { name: string; conclusion: string | null; createdAt: string | null } | null;
  verdict: "AGENTED" | "STALE" | "IDLE" | "UNKNOWN";
}

interface Finding {
  id: string;
  title: string;
  detail: string;
  state: "OPEN" | "WORKING" | "GATED" | "DONE" | "DISPROVEN";
  addedAt: string;
  updatedAt: string;
  source: "seeded" | "live";
  verify?: VerifyEvidence;
}

interface HealReceipt {
  at: string;
  action: string;
  ok: boolean;
  detail: string;
}

interface Lessons {
  rounds: number;
  liveBugsCaught: number;
  fixedMentions: number;
  honestyMentions: number;
  parsedAt: string;
  note: string[];
}

// ── כלכלת הרשת (R95): התלמיד לומד להבין את הכסף של עצמו ─────────
// "לומדת את עצמה טוב יותר" — לא רק האם המערכות עונות ל-HTTP, אלא
// מה הרשת מרוויחה בפועל: מילויים, סבבים, משטר, ומרחק הסולם
// מהשוק. מדידה מ-/api/money/pnl (השרשרת היא הסמכות).

interface Economics {
  at: string;
  fillsTotal: number;
  roundTrips: number;
  capturedSbd: number;
  openLongSteem: number;
  regime: string;
  midVsParityBps: number | null;
  ladderVsMidBps: number | null;
  deployedSteem: number | null;
  sbdBalance: number | null;
}

interface EconomicsEvent {
  at: string;
  kind: "FILL" | "REGIME" | "SNAPSHOT";
  detail: string;
}

// ── 6. למידת ראוטר ההחלפות (R96) — הרשת בוחנת את ערוצי ה-DEX בעצמה.
// "לאמת לבחון לאתגר": התלמיד מודד את הראוטר מול עצמו לאורך זמן —
// אילו ערוצים אומתו, אילו אותגרו, מי זול, והאם רשת שלמה נפלה.

interface ExchangeObs {
  at: string;
  channels: number;
  verified: number;
  deviant: number;
  down: number;
  chainsLive: number;
  bestEthDex: string | null;
  worstDevBps: number | null;
  topYield: string | null;
}

interface ExchangeEvent {
  at: string;
  kind: "SNAPSHOT" | "ROUTE-DOWN" | "ROUTE-UP" | "DEVIANT" | "VERDICT-CHANGE";
  detail: string;
}

interface StudentState {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  cycleSec: number;
  alive: boolean;
  examining: boolean;
  lastExamAt: string | null;
  probes: ProbeResult[];
  probeHistory: ProbeResult[]; // חלון מגולגל — 24 שעות בערך
  recurring: Array<{ probe: string; since: string; count: number; resolvedAt: string | null }>;
  coverage: CoverageEntry[];
  coverageAt: string | null;
  findings: Finding[];
  lessons: Lessons | null;
  economics: Economics | null;
  economicsHistory: EconomicsEvent[];
  exchange: ExchangeObs | null;
  exchangeHistory: ExchangeEvent[];
  heal: { receipts: HealReceipt[]; today: number; day: string };
  lastDecision: Decision | null; // R123 — החלטה אחרונה גלויה (חוק הדיבונים)
  history: Decision[];
}

// ── מצב ──────────────────────────────────────────────────────────────

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function seedFindings(): Finding[] {
  const now = new Date().toISOString();
  const mk = (id: string, title: string, detail: string, st: Finding["state"]): Finding => ({
    id, title, detail, state: st, addedAt: now, updatedAt: now, source: "seeded",
  });
  return [
    mk(
      "P1",
      "גריד דו-צדדי על שוק Steem",
      "צד המכירה חמוש וחי (מוביל הכסף R81+). צד הקנייה דורש מלאי SBD — שער-מפעיל בסף 0.15. מנוע המדידה: /api/market/cross (R94)",
      "GATED",
    ),
    mk(
      "P2",
      "סוכני-פיתוח לכל ריפו (לא רק אימות)",
      "16/16 ריפואים מכוסים בסוכני אימות — אף סוכן לא מפתח בעצמו. התלמיד (R94) מודד את הפער; פיתוח אוטונומי אמיתי עבר למספנת הצ'רטרים (R89) עם בונים חיצוניים",
      "WORKING",
    ),
    mk(
      "P3",
      "Foundry CI אדום 0/100",
      "מתועד כסימן-אדום כנה מאז 2026-09-14 (OL-3). תיקון בדיקות החוזה או פיצוי בהערה ציבורית",
      "OPEN",
    ),
    mk(
      "P4",
      "מנוע השוק הבין-רשתי",
      "STEEM/SBD + HIVE/HBD + חיצוניים + סימולציית גריד על היסטוריה אמיתית — נבנה ב-R94, API /api/market/cross",
      "DONE",
    ),
    mk(
      "P5",
      "דיבון התלמיד — בחינה עצמית מתמדת",
      "בחינה עצמית, מפת-כיסוי, למידה מה-worklog וספר-פוטנציאל — נולד בסשן זה (R94)",
      "DONE",
    ),
    mk(
      "P6",
      "עיגון-חוץ לצ'רטרים על שרשרת ציבורית",
      "הושלם ב-R91: שורש Merkle ב-custom_json על Steem, אומת מההיסטוריה",
      "DONE",
    ),
    mk(
      "P7",
      "סחירות BLURT",
      "אין טוקן-דולר/שוק פנימי; צומת RPC לא נענה מהסנדבוקס. דורש בורסה חיצונית = שער-מפעיל",
      "GATED",
    ),
  ];
}

function freshState(): StudentState {
  return {
    service: "student",
    version: "1.5.0",
    bootedAt: new Date().toISOString(),
    beats: 0,
    cycleSec: CYCLE_SEC,
    alive: true,
    examining: false,
    lastExamAt: null,
    probes: [],
    probeHistory: [],
    recurring: [],
    coverage: [],
    coverageAt: null,
    findings: seedFindings(),
    lessons: null,
    economics: null,
    economicsHistory: [],
    exchange: null,
    exchangeHistory: [],
    heal: { receipts: [], today: 0, day: utcDay() },
    lastDecision: null,
    history: [],
  };
}

function readState(): StudentState {
  const base = freshState();
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const sameDay = prev.heal?.day === utcDay();
    return {
      ...base,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      lastExamAt: prev.lastExamAt ?? null,
      probes: Array.isArray(prev.probes) ? prev.probes : [],
      probeHistory: Array.isArray(prev.probeHistory) ? prev.probeHistory.slice(-2000) : [],
      recurring: Array.isArray(prev.recurring) ? prev.recurring : [],
      coverage: Array.isArray(prev.coverage) ? prev.coverage : [],
      coverageAt: prev.coverageAt ?? null,
      // ספר-הפוטנציאל: זרעים חיים רק פעם אחת — אחר-כך המצב נשמר (למידה אמיתית = היסטוריה)
      findings: Array.isArray(prev.findings) && prev.findings.length ? prev.findings : base.findings,
      lessons: prev.lessons ?? null,
      economics: prev.economics ?? null,
      economicsHistory: Array.isArray(prev.economicsHistory) ? prev.economicsHistory.slice(-60) : [],
      exchange: prev.exchange ?? null,
      exchangeHistory: Array.isArray(prev.exchangeHistory) ? prev.exchangeHistory.slice(-60) : [],
      heal: {
        receipts: Array.isArray(prev.heal?.receipts) ? prev.heal.receipts.slice(-40) : [],
        today: sameDay ? (prev.heal?.today ?? 0) : 0,
        day: sameDay ? prev.heal.day : utcDay(),
      },
      history: Array.isArray(prev.history) ? prev.history.slice(-40) : [],
      lastDecision: (prev as { lastDecision?: Decision | null }).lastDecision ?? null,
    };
  } catch (e: any) {
    // כנות (R123): state קיים אך בלתי-קריא אינו נבלע בשקט — האיתחול נרשם
    // בהיסטוריה כשורה גלויה. קובץ שאינו קיים = עלייה ראשונה כנה.
    if (fs.existsSync(STATE_FILE)) {
      const reset = freshState();
      reset.history = [
        {
          at: new Date().toISOString(),
          kind: "STATE-RESET",
          detail: `קובץ-המצב קיים אך לא נקרא (${String(e?.message ?? e).slice(0, 80)}) — אותחל מצב חדש בכנות`,
        },
      ];
      return reset;
    }
    return base;
  }
}

// R124 — ציר-עולם למצב הדיבון (דפוס weblift/fleet-verify): דור-חם יורש את
// אובייקט-המצב החי; קריאה-מדיסק בכל דור חשפה את המצב לשכתוב-מדור-קפוא.
const G_STUDENT = globalThis as unknown as { __STUDENT_STATE__?: StudentState };
let state: StudentState = G_STUDENT.__STUDENT_STATE__ ?? readState();
G_STUDENT.__STUDENT_STATE__ = state;
let coverageTriggered = false;
let coverageNoPatNoted = false; // R123 — דגל חד-פעמי: היעדר-סמכות נרשם פעם, לא כל מחזור

function saveState() {
  fs.mkdirSync(`${HOME}/sovereign/student`, { recursive: true });
  // R107b — חוק הכתיבה-האטומית (כמו בשומר): .tmp ואז rename — התלמיד כותב
  // 111KB+ כל מחזור (probeHistory) — כתיבה חצויה באמצע תשאיר קובץ שבור
  // ליורשים (ה-API והשומר קוראים אותו חי).
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function readPat(): string | null {
  try {
    const t = fs.readFileSync(`${HOME}/upload/pat.env`, "utf8").trim();
    return t.length > 20 ? t : null;
  } catch {
    return null;
  }
}

// ── 1. בחינה-עצמית: בדיקות-מערכות ─────────────────────────────────

const HTTP_PROBES: Array<{ name: string; url: string }> = [
  { name: "app:health", url: "http://127.0.0.1:3000/api/health" },
  { name: "app:money", url: "http://127.0.0.1:3000/api/money" },
  { name: "app:crossmarket", url: "http://127.0.0.1:3000/api/market/cross" },
  { name: "app:exchange-router", url: "http://127.0.0.1:3000/api/exchange/router" },
  { name: "app:charter", url: "http://127.0.0.1:3000/api/charter" },
  { name: "fleet:pulse", url: "http://127.0.0.1:3033/" },
  { name: "fleet:money", url: "http://127.0.0.1:3034/" },
  { name: "fleet:hunter", url: "http://127.0.0.1:3035/" },
  { name: "fleet:keeper", url: "http://127.0.0.1:3036/" },
  { name: "fleet:verify", url: "http://127.0.0.1:3038/" },
  { name: "fleet:weblift", url: "http://127.0.0.1:3039/" },
];

async function probeOne(p: { name: string; url: string }): Promise<ProbeResult> {
  const started = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(p.url, { signal: ctl.signal, cache: "no-store" });
    return { probe: p.name, ok: res.ok, ms: Date.now() - started, at: new Date().toISOString() };
  } catch {
    return { probe: p.name, ok: false, ms: null, at: new Date().toISOString() };
  } finally {
    clearTimeout(t);
  }
}

async function selfExamine(): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  // טורי — בדיקות מהירות, לא מציפות את השרת
  for (const p of HTTP_PROBES) {
    out.push(await probeOne(p));
  }
  return out;
}

// ── 2. למידה מהישנות: RECURRING / RESOLVED ──────────────────────────

function learnRecurrence(probes: ProbeResult[]): string[] {
  const notes: string[] = [];
  for (const pr of probes) {
    const recent = state.probeHistory.filter((h) => h.probe === pr.probe).slice(-3);
    const allFailed = [...recent.map((h) => h.ok), pr.ok].filter((x) => x === false).length;
    const entry = state.recurring.find((r) => r.probe === pr.probe && !r.resolvedAt);
    if (allFailed >= 4 && !entry) {
      state.recurring.push({ probe: pr.probe, since: pr.at, count: allFailed, resolvedAt: null });
      notes.push(`RECURRING: ${pr.probe} נכשל ${allFailed}× רצוף — מסומן ככשל-חוזר עד ריפוי`);
    } else if (entry) {
      entry.count = allFailed;
      if (pr.ok) {
        entry.resolvedAt = pr.at;
        notes.push(`RESOLVED: ${pr.probe} התאושש — ההישנות נסגרה ונלמדה (${pr.at})`);
      }
    }
  }
  state.recurring = state.recurring.slice(-30);
  return notes;
}

// ── 3. מפת-כיסוי הרשת (GitHub, קריאה בלבד) ─────────────────────────

// ── 3ב. מאמת-האמת (R95 — מפקד האמת) ──────────────────────────────
// לקח-המקור: P3 נזרע מזיכרון (OL-3, 2026-09-14) בעוד הריצה האחרונה
// של foundry כבר הייתה ירוקה (2026-09-16, נסגר ב-Task 43). הקנון ידע —
// התלמיד לא, כי הוא זכר במקום למדוד. מעתה: כל טענה שניתנת לאימות
// נמדדת מול המקור החי לפני שהיא נשארת פתוחה. הזיכרון מפגר — המדידה לא.

interface VerifyEvidence {
  at: string;
  claim: string;
  verdict: "DISPROVEN" | "CONFIRMED" | "INCONCLUSIVE";
  evidence: string;
}

async function ghJson(pat: string, path: string): Promise<any | null> {
  try {
    // R112 — law of the bounded wait: no fetch without a deadline
    const res = await fetch(`${GH}${path}`, {
      headers: { Authorization: `token ${pat}`, Accept: "application/vnd.github+json", "User-Agent": "student-daemon" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// מאמת P3: "Foundry CI אדום 0/100" — האמת היא הריצה האחרונה, לא הזיכרון
async function verifyFoundryCiClaim(pat: string): Promise<Omit<VerifyEvidence, "at" | "claim"> | null> {
  const j = await ghJson(pat, "/repos/roshpinacare-sys/saos-sovereign-foundry/actions/runs?per_page=1");
  const last = j?.workflow_runs?.[0];
  if (!last || !last.conclusion) return null; // רץ כרגע / לא-נמדד — טרם ניתן לשיפוט
  const short = `ריצה #${last.run_number} · ${String(last.head_sha ?? "").slice(0, 7)} · ${last.created_at} · ${last.html_url}`;
  if (last.conclusion === "success") {
    return { verdict: "DISPROVEN", evidence: `CI ירוק בריצה האחרונה — ${short}` };
  }
  if (last.conclusion === "failure" || last.conclusion === "timed_out") {
    return { verdict: "CONFIRMED", evidence: `CI אדום בפועל — ${short}` };
  }
  return null;
}

// מאמת P7: "סחירות BLURT — אין טוקן-דולר/שוק פנימי; צומת RPC לא נענה"
// (R106): הזרע הזה הופרך עוד ב-R102/R103 — בריכת WBLURT/USDS חיה בזירה,
// רייל-המשיכה הוכח בשרשרת (txid 06697ae5), ה-XML עונה עם UA. התלמיד לא
// סומך על הטענה — הוא מודד את הזירה בעצמו, בכל בחינה, עד שהספר ישודע.
async function verifyBlurtLiquidityClaim(): Promise<Omit<VerifyEvidence, "at" | "claim"> | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch("http://127.0.0.1:3000/api/exchange", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) return null; // הזירה לא נמדדה — אין שיפוט
    const j: any = await res.json();
    const pool = (j?.pools ?? []).find((p: any) => p.pair === "WBLURT/USDS");
    const tre = (j?.treasury ?? {}) as Record<string, number>;
    const wblurtTreasury = Number(tre.WBLURT ?? 0);
    if (!pool) return null; // אין בריכה — הטענה עדיין עומדת
    const ra = Number(pool.reserveA ?? 0);
    const rb = Number(pool.reserveB ?? 0);
    if (ra > 0 && rb > 0) {
      return {
        verdict: "DISPROVEN",
        evidence: `בריכת WBLURT/USDS חיה: ${ra.toFixed(3)} WBLURT × ${rb.toFixed(6)} USDS (מחיר ${pool.priceLabel ?? pool.price}) · אוצר מחזיק ${wblurtTreasury.toFixed(3)} WBLURT · רייל-יציאה הוכח בשרשרת (R103, txid 06697ae5) — הטענה "אין שוק פנימי" שקרית`,
      };
    }
    return null;
  } catch {
    return null; // שתיקה כנה — לא נמדד
  }
}

async function verifyFindings(): Promise<string[]> {
  const notes: string[] = [];
  const pat = readPat();
  const now = new Date().toISOString();
  const p3 = state.findings.find((f) => f.id === "P3");
  if (p3 && p3.state === "OPEN" && pat) {
    const v = await verifyFoundryCiClaim(pat);
    if (v) {
      p3.verify = { at: now, claim: "Foundry CI אדום 0/100", ...v };
      p3.updatedAt = now;
      p3.source = "live";
      if (v.verdict === "DISPROVEN") {
        p3.state = "DISPROVEN";
        p3.title = "Foundry CI — הטענה הופרכה במדידה";
        p3.detail = `האמונה "אדום 0/100" הופרכה במדידה חיה: ${v.evidence}. האדום ההיסטורי (99 כישלונים) נסגר ב-Task 43; מקור הזרע (OL-3, 2026-09-14) הקדים את התיקון — הזיכרון מפגר אחרי המציאות (TRUTH-AUDIT §15.5).`;
        notes.push("VERIFY: P3 הופרך במדידה חיה — foundry CI ירוק. האמונה השקרית נסגרה בראיה, לא בזיכרון");
      } else {
        notes.push(`VERIFY: P3 אומת כאדום בפועל — ${v.evidence}`);
      }
    }
  }
  // R106 — P7: ספר-הפוטנציאל לא סומך על טענות ישנות. הבחינה מודדת את
  // הזירה החיה; אם הבריכה קיימת עם עומק אמיתי — הזרע מסומן כמופרך.
  const p7 = state.findings.find((f) => f.id === "P7");
  if (p7 && p7.state === "GATED") {
    const v = await verifyBlurtLiquidityClaim();
    if (v) {
      p7.verify = { at: now, claim: "סחירות BLURT — אין שוק פנימי, RPC לא נענה", ...v };
      p7.updatedAt = now;
      p7.source = "live";
      if (v.verdict === "DISPROVEN") {
        p7.state = "DISPROVEN";
        p7.title = "סחירות BLURT — הטענה הופרכה במדידה";
        p7.detail = `הזרע טען "אין טוקן-דולר/שוק פנימי; RPC לא נענה". המציאות הנמדדת: ${v.evidence}. הרגל חיה מקצה לקצה — הפקדה → עטיפה → בריכה → משיכה עם txid.`;
        notes.push("VERIFY: P7 הופרך במדידה חיה — בריכת WBLURT/USDS חיה עם עומק אמיתי. הזרע המיושן נסגר בראיה");
      }
    }
  }
  return notes;
}

async function measureCoverage(): Promise<void> {
  const pat = readPat();
  if (!pat) {
    // R123 — כנות: בלי סמכות אין מדידה — coverageAt אינו מתעדכן (הוא חותמת-
    // מדידה, לא חותמת-ניסיון). הדילוג נרשם כשורה גלויה פעם לעלייה.
    if (!coverageNoPatNoted) {
      coverageNoPatNoted = true;
      state.history.push({
        at: new Date().toISOString(),
        kind: "COVERAGE-NO-PAT",
        detail: "מפת-הכיסוי לא נמדדה — אין סמכות (PAT). התמונה הקודמת נשמרת בכנות",
      });
      state.history = state.history.slice(-40);
    }
    return;
  }
  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "student-daemon",
  };
  const out: CoverageEntry[] = [];
  try {
    // R112 — law of the bounded wait (fleet-wide)
    const res = await fetch(`${GH}/user/repos?per_page=100&affiliation=owner`, { headers, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!res.ok) throw new Error(`repos http ${res.status}`);
    const repos = (await res.json()) as Array<{ name: string; pushed_at: string }>;
    for (const r of repos) {
      const pushedAt = r.pushed_at ?? null;
      const pushAgeH = pushedAt ? Math.max(0, (Date.now() - Date.parse(pushedAt)) / 3_600_000) : null;
      let workflows: number | null = null;
      let lastRun: CoverageEntry["lastRun"] = null;
      try {
        const wfRes = await fetch(`${GH}/repos/roshpinacare-sys/${r.name}/actions/workflows?per_page=100`, { headers, signal: AbortSignal.timeout(30_000), cache: "no-store" });
        if (wfRes.ok) {
          const wf = (await wfRes.json()) as { workflows?: Array<{ state?: string; path?: string }> };
          workflows = (wf.workflows ?? []).filter((w) => w.state === "active" && (w.path ?? "").startsWith(".github/")).length;
        }
        const runRes = await fetch(`${GH}/repos/roshpinacare-sys/${r.name}/actions/runs?per_page=1`, { headers, signal: AbortSignal.timeout(30_000), cache: "no-store" });
        if (runRes.ok) {
          const runs = (await runRes.json()) as { workflow_runs?: Array<{ name: string; conclusion: string | null; created_at: string }> };
          const last = runs.workflow_runs?.[0];
          if (last) lastRun = { name: last.name, conclusion: last.conclusion, createdAt: last.created_at };
        }
      } catch {
        // ריפו בודד — נסומן UNKNOWN בכנות
      }
      // פסק-דין כפול (R94): עם-סוכן ומתקדם · עצור (סוכן יש, דחיפה 3+ ימים)
      // · חסר-סוכן · לא-נמדד. "התקדמות במשך ימים" של המפעיל — נמדדת כאן.
      let verdict: CoverageEntry["verdict"];
      if (workflows == null) verdict = "UNKNOWN";
      else if (workflows === 0) verdict = "IDLE";
      else if (pushAgeH != null && pushAgeH > 72) verdict = "STALE";
      else verdict = "AGENTED";
      out.push({ repo: r.name, role: REPO_ROLES[r.name] ?? "", pushedAt, pushAgeH, workflows, lastRun, verdict });
    }
    out.sort((a, b) => (b.pushAgeH ?? 0) - (a.pushAgeH ?? 0));
  } catch (e: any) {
    // R123 — כנות: כיסוי שלם שנכשל נרשם כשורה גלויה בהיסטוריה — המצב
    // הקודם נשמר, אבל "לא נמדד" לא מתחזה ל"נמדד עכשיו".
    state.history.push({
      at: new Date().toISOString(),
      kind: "COVERAGE-FAIL",
      detail: `מפת-הכיסוי לא נמדדה (${String(e?.message ?? e).slice(0, 100)}) — נשמרת התמונה הקודמת בכנות`,
    });
    state.history = state.history.slice(-40);
    return; // coverageAt לא מתעדכן — הוא חותמת-מדידה, לא חותמת-ניסיון
  }
  if (out.length) state.coverage = out;
  state.coverageAt = new Date().toISOString();
}

// ── 4. למידה מה-worklog — ספר-הדורות שלנו ──────────────────────────

function learnFromWorklog(): Lessons {
  try {
    const text = fs.readFileSync(WORKLOG, "utf8");
    const rounds = [...text.matchAll(/^Task ID:\s*(\S+)/gm)].map((m) => m[1]);
    const liveBugsCaught = (text.match(/באג חי|באגים חיים/g) ?? []).length;
    const fixedMentions = (text.match(/תוקן|תיקון/g) ?? []).length;
    const honestyMentions = (text.match(/כנות|בכנות/g) ?? []).length;
    return {
      rounds: rounds.length,
      liveBugsCaught,
      fixedMentions,
      honestyMentions,
      parsedAt: new Date().toISOString(),
      note: [
        `${rounds.length} סבבי-עבודה תועדו מאז הפתיחה — כל אחד בנוי על קודמו`,
        `${liveBugsCaught} אזכורי "באג חי" — באגים שנתפסו בשידור חי ותוקנו בשורש, לא טואטאו`,
        "לקח-הדורות (נלמד מהספר): ההיסטוריה מפגרת אחרי השרשרת — אימות שידור דורש חלון + דה-דופ (R87/R91)",
        "לקח-הדורות: bun --hot מקפיא טיימרים — בריאות דיבון נמדדת לפי טריות פעימות, לא פורט פתוח (R91)",
        "לקח-מפקד-האמת (R95): מסמך של ריפו יכול לשקר על הריפו — מפת הדרכים של foundry סימנה 5 סעיפים פתוחים כש-4 כבר נסגרו; אמת נמדדת מהקוד והריצות, לא מהזיכרון",
      ],
    };
  } catch {
    return {
      rounds: 0,
      liveBugsCaught: 0,
      fixedMentions: 0,
      honestyMentions: 0,
      parsedAt: new Date().toISOString(),
      note: ["ה-worklog לא נקרא במחזור זה — לא נמדד"],
    };
  }
}

// ── 5. כלכלת הרשת — למידה מה-P&L החי (R95) ──────────────────────────

async function learnEconomics(): Promise<string[]> {
  const notes: string[] = [];
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45_000);
  try {
    const res = await fetch("http://127.0.0.1:3000/api/money/pnl", { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return notes;
    const j = await res.json();
    if (!j?.ok || j?.stats?.fillsTotal == null) return notes; // לא נמדד — לא מומצא
    const econ: Economics = {
      at: new Date().toISOString(),
      fillsTotal: Number(j.stats.fillsTotal),
      roundTrips: Number(j.stats.roundTrips ?? 0),
      capturedSbd: Number(j.stats.capturedSbd ?? 0),
      openLongSteem: Number(j.stats.openLongSteem ?? 0),
      regime: String(j.regime?.verdict ?? "UNKNOWN"),
      midVsParityBps: j.market?.midVsParityBps ?? null,
      ladderVsMidBps: j.ladder?.lowestAskVsMidBps ?? null,
      deployedSteem: j.ladder?.deployedSteem ?? null,
      sbdBalance: j.balances?.sbd ?? null,
    };
    const prev = state.economics;
    // זיהוי שינויים — הלמידה האמיתית: מה השתנה מאז המדידה הקודמת
    if (prev) {
      if (econ.fillsTotal > prev.fillsTotal) {
        notes.push(
          `FILL: מילוי חדש בגריד! ${prev.fillsTotal}→${econ.fillsTotal} מילויים · סבבים ${prev.roundTrips}→${econ.roundTrips} · נלכד ${prev.capturedSbd.toFixed(4)}→${econ.capturedSbd.toFixed(4)} SBD`,
        );
        state.economicsHistory.push({ at: econ.at, kind: "FILL", detail: notes[notes.length - 1] });
      }
      if (econ.regime !== prev.regime) {
        const d = `REGIME: המשטר הכלכלי השתנה ${prev.regime} → ${econ.regime}`;
        notes.push(d);
        state.economicsHistory.push({ at: econ.at, kind: "REGIME", detail: d });
      }
    } else {
      const d = `SNAPSHOT: בסיס הכלכלה נמדד — ${econ.fillsTotal} מילויים · ${econ.roundTrips} סבבים · נלכד ${econ.capturedSbd.toFixed(4)} SBD · משטר ${econ.regime}`;
      notes.push(d);
      state.economicsHistory.push({ at: econ.at, kind: "SNAPSHOT", detail: d });
    }
    state.economics = econ;
    state.economicsHistory = state.economicsHistory.slice(-60);
  } catch (e) {
    // R123 — כנות (אותו חוק שנחקק ב-learnExchange ב-R96): כשל למידה נראה
    // ביומן, לא נעלם בשקט. המצב הקודם נשמר — בכנות.
    console.error("[student] learnEconomics failed:", String(e));
  } finally {
    clearTimeout(t);
  }
  return notes;
}

// ── 5.5 למידת ראוטר ההחלפות (R96) — בחינת ערוצי ה-DEX לאורך זמן ────

async function learnExchange(): Promise<string[]> {
  const notes: string[] = [];
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45_000);
  try {
    const res = await fetch("http://127.0.0.1:3000/api/exchange/router", { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return notes;
    const j = await res.json();
    if (!j?.ok || !Array.isArray(j?.channels)) return notes; // לא נמדד — לא מומצא
    const prev = state.exchange;
    const obs: ExchangeObs = {
      at: new Date().toISOString(),
      channels: j.channels.length,
      verified: Number(j.challenge?.verified ?? 0),
      deviant: Number(j.challenge?.deviant ?? 0),
      down: Number(j.challenge?.down ?? 0),
      chainsLive: (j.chains ?? []).filter((c: any) => c?.ok).length,
      bestEthDex:
        (j.channels ?? [])
          .filter((c: any) => c?.pair === "ETH/USD" && typeof c?.execPrice === "number")
          .sort((a: any, b: any) => b.execPrice - a.execPrice)[0]?.dex ?? null,
      worstDevBps:
        (j.channels ?? [])
          .filter((c: any) => typeof c?.devBps === "number")
          .reduce((m: number | null, c: any) => (m == null || Math.abs(c.devBps) > Math.abs(m) ? c.devBps : m), null) ?? null,
      topYield: j.yields?.pools?.[0]
        ? `${j.yields.pools[0].project} ${j.yields.pools[0].apy?.toFixed?.(2) ?? "?"}%`
        : null,
    };
    if (prev) {
      // שינויים — הלמידה האמיתית: רשת שנפלה, ראוטר שהתאושש, אתגר חדש
      if (obs.chainsLive < prev.chainsLive) {
        const d = `ROUTE-DOWN: רשת-DEX נפלה — ${prev.chainsLive}→${obs.chainsLive} רשתות חיות`;
        notes.push(d);
        state.exchangeHistory.push({ at: obs.at, kind: "ROUTE-DOWN", detail: d });
      } else if (obs.chainsLive > prev.chainsLive) {
        const d = `ROUTE-UP: רשת-DEX התאוששה — ${prev.chainsLive}→${obs.chainsLive} רשתות חיות`;
        notes.push(d);
        state.exchangeHistory.push({ at: obs.at, kind: "ROUTE-UP", detail: d });
      }
      if (obs.down > prev.down) {
        const d = `ROUTE-DOWN: ${prev.down}→${obs.down} ערוצי ציטוט נפלו — נבדק שוב במחזור הבא`;
        notes.push(d);
        state.exchangeHistory.push({ at: obs.at, kind: "ROUTE-DOWN", detail: d });
      }
      if (obs.deviant !== prev.deviant) {
        const d = `VERDICT-CHANGE: ערוצים אותגרו ${prev.deviant}→${obs.deviant} · אומתו ${prev.verified}→${obs.verified}`;
        notes.push(d);
        state.exchangeHistory.push({ at: obs.at, kind: "VERDICT-CHANGE", detail: d });
      }
    } else {
      const d = `SNAPSHOT: בסיס ראוטר ההחלפות נמדד — ${obs.verified}/${obs.channels} ערוצים אומתו ב-${obs.chainsLive} רשתות · ה-ETH הטוב: ${obs.bestEthDex ?? "—"} · תשואת-חוץ מובילה: ${obs.topYield ?? "—"}`;
      notes.push(d);
      state.exchangeHistory.push({ at: obs.at, kind: "SNAPSHOT", detail: d });
    }
    state.exchange = obs;
    state.exchangeHistory = state.exchangeHistory.slice(-60);
  } catch (e) {
    // לקח-באג-חי (R96): catch שקט בלע ReferenceError — מעתה כל כשל למידה
    // נראה ביומן, לא נעלם בשקט. המצב הקודם נשמר — בכנות.
    console.error("[student] learnExchange failed:", String(e));
  } finally {
    clearTimeout(t);
  }
  return notes;
}

// ── 7. ריפוי-בטוח (אידמפוטנטי, מתועד, בתקציב) ────────────────────────

async function safeHeal(): Promise<string[]> {
  const notes: string[] = [];
  // תקציב יומי: 3 ריפויים — לא מפציצים
  if (state.heal.today >= 3) return notes;
  const doHeal = async (action: string, run: () => Promise<{ ok: boolean; detail: string }>) => {
    if (state.heal.today >= 3) return;
    try {
      const r = await run();
      state.heal.today += 1;
      state.heal.receipts.push({ at: new Date().toISOString(), action, ok: r.ok, detail: r.detail });
      state.heal.receipts = state.heal.receipts.slice(-40);
      notes.push(`${action}: ${r.ok ? "ok" : "נכשל"} — ${r.detail}`);
    } catch (e: any) {
      state.heal.today += 1;
      state.heal.receipts.push({ at: new Date().toISOString(), action, ok: false, detail: String(e?.message ?? e).slice(0, 100) });
      notes.push(`${action}: חריגה — תועדה בכנות`);
    }
  };
  // ריפוי הצ'רטרים — קריאה מאושרת אידמפוטנטית (R92: selfHeal)
  await doHeal("charter-selfheal", async () => {
    const res = await fetch("http://127.0.0.1:3000/api/charter/projects", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const j = res.ok ? await res.json().catch(() => null) : null;
    return { ok: !!(j?.ok), detail: j?.count != null ? `${j.count} פרויקטים · אירועים ${j?.healed?.eventsImported ?? 0}` : `http ${res.status}` };
  });
  // סנכרון הספר — פעולת-פרוטוקול הסשן (R93: ה-POST האידמפוטנטי המתועד)
  await doHeal("book-sync", async () => {
    const res = await fetch("http://127.0.0.1:3000/api/weave/sovereignty/sync", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const j = res.ok ? await res.json().catch(() => null) : null;
    return { ok: !!(j?.ok), detail: j?.imported?.attestations != null ? `${j.imported.attestations} אימותים` : `http ${res.status}` };
  });
  return notes;
}

// ── מחזור ────────────────────────────────────────────────────────────

let ticking = false;
// r143-c — חותמת-הפעימה האחרונה — מזינה את מתג-איש-המת בסוף-הקובץ
let lastBeatAt = Date.now();
async function tick() {
  if (ticking || state.examining) return;
  ticking = true;
  state.examining = true;
  try {
    state.beats += 1;
    lastBeatAt = Date.now(); // r143-c — הוכחת-החיים נמדדת כאן

    // בחינה-עצמית
    const probes = await selfExamine();
    state.probes = probes;
    state.probeHistory = [...state.probeHistory, ...probes].slice(-2000);
    const learnNotes = learnRecurrence(probes);

    // כיסוי — כל שעה (עדינות מול GitHub), ומיד אחריו מאמת-האמת:
    // כל טענה פתוחה שאפשר למדוד — נמדדת מול המקור החי (R95).
    if (state.beats % COVERAGE_EVERY === 1) {
      await measureCoverage();
      const verifyNotes = await verifyFindings();
      state.history = [
        ...state.history,
        ...verifyNotes.map((n) => ({ at: new Date().toISOString(), kind: "VERIFY", detail: n })),
      ].slice(-40);
    }

    // למידה מה-worklog — פעם בשעה
    if (state.beats % COVERAGE_EVERY === 2) {
      state.lessons = learnFromWorklog();
    }

    // למידת כלכלה — כל שני מחזורים (20 דק'): ה-SWR של ה-P&L מטמון 10 דק',
    // והסריקה העמוקה מצ'קפוינטת — העלות נמוכה, ההבנה גבוהה (R95).
    if (state.beats % 2 === 0) {
      const econNotes = await learnEconomics();
      if (econNotes.length) {
        state.history = [
          ...state.history,
          ...econNotes.map((n) => ({ at: new Date().toISOString(), kind: "ECONOMY", detail: n })),
        ].slice(-40);
      }
    }

    // למידת ראוטר ההחלפות — כל שלושה מחזורים (30 דק'), ובראשונה מיד:
    // מדידה שעוד לא נעשתה לא ממתינה לקצב (שיעור הבאג החי של R96).
    if (state.beats % 3 === 0 || !state.exchange) {
      const exNotes = await learnExchange();
      if (exNotes.length) {
        state.history = [
          ...state.history,
          ...exNotes.map((n) => ({ at: new Date().toISOString(), kind: "EXCHANGE", detail: n })),
        ].slice(-40);
      }
    }

    // ריפוי-בטוח — פעם בשעה (פרוטוקול הסשן, אידמפוטנטי)
    const healNotes = state.beats % COVERAGE_EVERY === 3 ? await safeHeal() : [];

    // סיכום-החלטה
    const okCount = probes.filter((p) => p.ok).length;
    const coverageOk = state.coverage.filter((c) => c.verdict === "AGENTED").length;
    const staleCount = state.coverage.filter((c) => c.verdict === "STALE").length;
    const detail =
      `בחינה: ${okCount}/${probes.length} מערכות תקינות` +
      (state.coverage.length
        ? ` · כיסוי רשת: ${coverageOk}/${state.coverage.length} מתקדמים עם סוכן${staleCount ? ` · ${staleCount} עצורים 3+ ימים (פער מתועד)` : ""}`
        : "") +
      (state.recurring.some((r) => !r.resolvedAt) ? ` · כשלים חוזרים פתוחים` : "") +
      (healNotes.length ? ` · ריפוי: ${healNotes.length}` : "");
    state.lastDecision = { at: new Date().toISOString(), kind: "EXAMINE", detail };
    state.history = [
      ...state.history,
      state.lastDecision,
      ...learnNotes.map((n) => ({ at: new Date().toISOString(), kind: "LEARN", detail: n })),
      ...healNotes.map((n) => ({ at: new Date().toISOString(), kind: "HEAL", detail: n })),
    ].slice(-40);
    state.lastExamAt = new Date().toISOString();
  } catch (e: any) {
    state.history = [
      ...state.history,
      { at: new Date().toISOString(), kind: "ERROR", detail: String(e?.message ?? e).slice(0, 160) },
    ].slice(-40);
  } finally {
    state.examining = false;
    ticking = false;
    saveState();
  }
}

// ── שרת-בריאות ─────────────────────────────────────────────────────
// R124 — שרת-היחיד חוצה-דורות (חוק weblift): ה-handler הישן ממשיך להגיש
// את המצב החי מציר-העולם.
const G_STUDENT_SRV = globalThis as unknown as { __STUDENT_SERVER__?: unknown };
if (G_STUDENT_SRV.__STUDENT_SERVER__) {
  // שרת חי מדור קודם — ממשיך להגיש.
} else {
  G_STUDENT_SRV.__STUDENT_SERVER__ = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // R123 — הדיבון נצרך מ-localhost בלבד (API/שומר/מפעיל מקומי)
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      // מדד-זמינות נגזר (מדידה, לא המצאה): אחוז הבדיקות שעברו בחלון
      const win = state.probeHistory.slice(-8 * HTTP_PROBES.length);
      const uptime = win.length ? Math.round((win.filter((h) => h.ok).length / win.length) * 100) : null;
      return Response.json({
        ...state,
        ok: true,
        alive: true,
        uptimePct: uptime,
        now: new Date().toISOString(),
      });
    }
    // טריגר-מפעיל: מדידת-כיסוי חדשה — מיד ברקע (קריאה בלבד — בטוח).
    // התשובה חוזרת מיד (מדידת-המקור אורכת עשרות שניות — Bun.serve חותך
    // חיבורים סרקניים אחרי 10ש'); התוצאה נקראת מ-/ כשהיא מוכנה (coverageAt).
    if (url.pathname === "/coverage") {
      if (!coverageTriggered) {
        coverageTriggered = true;
        void measureCoverage()
          .then(() => verifyFindings())
          .catch(() => {})
          .finally(() => {
            coverageTriggered = false;
            saveState();
          });
      }
      return Response.json({ ok: true, triggered: true, coverageAt: state.coverageAt });
    }
    return new Response("not found", { status: 404 });
  },
  });
}

saveState();
console.log(`[student] התלמיד חי על פורט ${PORT} · beats=${state.beats} · מחזור ${CYCLE_SEC}s`);
tick();
// R112 — law of the single timer (R109/R111 lesson, applied to student)
const G = globalThis as unknown as { __STUDENT_TIMER__?: ReturnType<typeof setInterval> };
if (G.__STUDENT_TIMER__) clearInterval(G.__STUDENT_TIMER__);
G.__STUDENT_TIMER__ = setInterval(tick, CYCLE_SEC * 1000);

// ── r143-c · מתג-איש-מת ─────────────────────────────────────
// זומבי חי שנמדד (keeper, r143): HTTP עונה בזמן שהפעימות קפואות.
// כל 60ש' נמדדת התקדמות-הלולאה; שתיקה מעל 30 דק' (3×קצב-המחזור של 10 דק')
// ⇒ שורה כנה ביומן-הדיבון ויציאה (exit 1) — fleet-guard יקים תהליך-טרי.
// פעימה איטית אחת לעולם לא הורגת דיבון בריא. הטיימר במשמר-גלובלי
// (חוק הטיימר-היחיד) — טעינה-חמה לא מכפילה שומרים.
const DEAD_MAN_TICK_MS = 60_000;
const DEAD_MAN_STALL_MS = 30 * 60_000;
const DEAD_MAN_LOG = `${HOME}/sovereign/keeper/logs/student-daemon.log`;
const G_DM = globalThis as unknown as { __STUDENT_DEADMAN__?: ReturnType<typeof setInterval> };
if (G_DM.__STUDENT_DEADMAN__) clearInterval(G_DM.__STUDENT_DEADMAN__);
G_DM.__STUDENT_DEADMAN__ = setInterval(() => {
  if (Date.now() - lastBeatAt <= DEAD_MAN_STALL_MS) return;
  const msg = "dead-man: beats stalled >30min — exiting for revival";
  try {
    fs.mkdirSync(`${HOME}/sovereign/keeper/logs`, { recursive: true });
    fs.appendFileSync(DEAD_MAN_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log(msg);
  clearInterval(G_DM.__STUDENT_DEADMAN__);
  process.exit(1);
}, DEAD_MAN_TICK_MS);
