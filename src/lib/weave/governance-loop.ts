// ─────────────────────────────────────────────────────────────────────
// GOVERNANCE-LOOP · מחזור-ההחלטות הריבוני (r142 · D-OP-01)
//
// הפער שנסגר כאן: הדיבונים מקציבים מכונות (פעימות, עוגנים, שמירה),
// אבל מי שבוחר "מה עכשיו" — זה היה סשן-בינה שהמפעיל פותח ביד.
// החוק החדש (אישור-עומד D-OP-01, 2026-09-30): הרשת בוחרת לבד מתוך
// גבולות-הפרוטוקול, מבצעת, מודדת, רושמת ראיה חתומה-גיבוב, ומתקדמת.
//
// הפרוטוקול שאומץ מפרויקט-העבר (unified-platform v33.56):
//   · NEXT_ACTION אחת עם allowed/forbidden/exitCriteria
//   · OPEN_DECISIONS עם המלצות וסטטוס
//   · PROGRAM_STATE עם גבולות-ביצוע מפורשים
//   · יומן-החלטות append-only hash-chained
//
// חוקי-ברזל: לולאה-יחידה ב-globalThis (R80) · בחירה מתוך allowed בלבד
// · כל מחזור = החלטה אחת חתומה (chosen+why+evidence) · קידום-מדינה רק
// כשכל תנאי-היציאה נמדדו מלאים · אפס סודות ביומן.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import net from "node:net";
import {
  appendDecision,
  chooseAction,
  readDecisionLog,
  readNextAction,
  readOpenDecisions,
  readProgramState,
  sealUnsealedEntries,
  verifyDecisionLog,
  writeNextAction,
  type BrainChoice,
  type DecisionEntry,
  type NextAction,
} from "./sovereign-decisions";
import { callGovernanceBrain, governanceBrainStats } from "./governance-brain";
// r147-d · גוף-אחד: כתיבה-אטומית מהגרעין-המשותף (R107b)
import { writeJsonAtomic } from "./atomic";

const HOME = "/home/z/my-project";
const CYCLE_STATE_PATH = `${HOME}/sovereign/governance/cycle-state.json`;
// r143-a — התמדת-מצב-הלולאה לדיסק: ב-dev, טעינת-מודול מחדש מאפסת את
// ה-globalThis וה-API הציג אפסים בזמן שהאמת חיה בתהליך אחר. מעתה כל
// מחזור שהושלם נכתב אטומית ל-loop-state.json, ומופע-מודול טרי קורא
// אותו לפני שהוא נופל לברירות-המחדל — ה-UI צורך אמת-חיה, לא אפסים.
const LOOP_STATE_PATH = `${HOME}/sovereign/governance/loop-state.json`;
const FLEET_GUARD_STATE_PATH = `${HOME}/sovereign/keeper/fleet-guard-state.json`;
const CYCLE_INTERVAL_MS = 10 * 60_000; // מחזור כל 10 דק'
const FIRST_CYCLE_DELAY_MS = 15_000; // מחזור ראשון אחרי עליית-השרת
// r144-f — חוק-כותב-יחיד: הבאג שנמדד (seq 60 @21:14:24.734Z ו-seq 61 @21:14:38.913Z,
// אותה החלטה פעמיים) היה TOCTOU — שני כותבים (לולאת-האינסטרומנטציה + דיבון-הממשל
// 3042) עברו את קירור-90ש' של הנתב לפני שאף אחד סיים, שניהם הריצו מחזור מלא,
// שניהם צירפו ליומן. מעתה שלוש שכבות-הגנה: נעילת-עיצוב + קצב-פנימי + אידמפוטנציית-סף
// ב-appendDecision. lastCycleAt מתעדכן רק אחרי-הצירוף — החלון-בין-הבדיקה-לעדכון
// הוא כל-משך-המחזור, ולכן הבדיקה-החוזרת חייבת לשבת בתוך-נעילה.
const MIN_INTERNAL_GAP_MS = 9 * 60_000; // כותב-שני בתוך אותו קצב של 10 דק' נדחה (force פוטר)
const HOME_BASE = "http://127.0.0.1:3000";
// r148-b — טביעת-הדור של המודול (מתעדכנת בכל גל שנוגע בלולאה)
const LOOP_GEN = "r148-b";

const DAEMON_PORTS: Array<{ name: string; port: number }> = [
  { name: "pulse", port: 3033 },
  { name: "money", port: 3034 },
  { name: "hunter", port: 3035 },
  { name: "keeper", port: 3036 },
  { name: "student", port: 3037 },
  { name: "fleet-verify", port: 3038 },
  { name: "weblift", port: 3039 },
  { name: "curation", port: 3040 },
  { name: "kpi", port: 3041 },
];

export interface CycleState {
  service: "governance-loop";
  format: "governance-cycle-state-v1";
  bootedAt: string;
  cycles: number;
  lastCycleAt: string | null;
  lastDecisionId: string | null;
  lastChosen: string | null;
  lastVerdict: "DECIDED" | "ADVANCED" | "DEGRADED" | null;
  lastDetail: string | null;
  brainUsed: boolean;
  // r148-b — שער-הכלכלה: פסק-הדין האחרון של השער לפני-ביצוע (אדיטיבי — אף שדה
  // קיים לא שונה; חסר/null = המחזור קדם לשער). "gate-unreachable" = כשל-פתוח
  // כן: הלולאה המשיכה לפעום והכישלון נרשם, לא הוסתר.
  lastGate?: LoopGateRecord | null;
}

// r148-b — רשומת-שער-הכלכלה במצב-הלולאה
export interface LoopGateRecord {
  at: string;
  verdict: "ALLOW" | "REVIEW" | "DENY" | "gate-unreachable";
  score: number | null;
  reasonsHe: string[];
  actionsToday: number | null;
  cap: number | null;
  actionId: string | null;
}

interface LoopGlobal {
  // r148-b — gen: טביעת-דור-מודול; אחרי HMR הדור-החדש פורש את טיימר-הדור-הישן
  // (R80 — לולאה-יחידה) כדי שאף מחזור לא ירוץ בלי שער-הכלכלה.
  __weaveGovernanceLoop?: { timer: ReturnType<typeof setInterval> | null; started: boolean; state: CycleState; gen?: string };
  // r144-f — נעילת-עיצוב למחזור-ההחלטות: כותב-יחיד בכל רגע נתון (שכבה 1).
  __govCycleInFlight__?: boolean;
}

const g = globalThis as typeof globalThis & LoopGlobal;

function utcIso(): string {
  return new Date().toISOString();
}

function readCycleState(): CycleState {
  try {
    const raw = JSON.parse(fs.readFileSync(CYCLE_STATE_PATH, "utf8")) as CycleState;
    if (raw && raw.service === "governance-loop") return raw;
  } catch {}
  return {
    service: "governance-loop",
    format: "governance-cycle-state-v1",
    bootedAt: utcIso(),
    cycles: 0,
    lastCycleAt: null,
    lastDecisionId: null,
    lastChosen: null,
    lastVerdict: null,
    lastDetail: null,
    brainUsed: false,
  };
}

function writeCycleState(s: CycleState): void {
  try {
    // r147-d: כתיבה-אטומית מהגרעין-המשותף (src/lib/weave/atomic.ts — R107b)
    writeJsonAtomic(CYCLE_STATE_PATH, s);
  } catch {}
}

// r143-a — קריאת מצב-הלולאה מהדיסק (מופע-מודול טרי); null אם אין/פגום
function readLoopState(): CycleState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(LOOP_STATE_PATH, "utf8")) as CycleState;
    if (raw && raw.service === "governance-loop") return raw;
  } catch {}
  return null;
}

// r143-a — כתיבה אטומית (tmp+rename) של מצב-הלולאה אחרי כל מחזור שהושלם
function writeLoopState(s: CycleState): void {
  try {
    // r147-d: כתיבה-אטומית מהגרעין-המשותף (src/lib/weave/atomic.ts — R107b)
    writeJsonAtomic(LOOP_STATE_PATH, s);
  } catch {}
}

// r143-a — סנכרון המצב-החי ב-globalThis (R80): מופע-המודול שרץ מחזיק אמת
function syncLoopGlobal(s: CycleState): void {
  const live = g.__weaveGovernanceLoop;
  if (live) live.state = s;
}

// ─── r148-b · שער-הכלכלה לפני-ביצוע (FAIL-OPEN) ─────────────────────
// הלקח: 7 דחיות NO-FUEL שרפו 7/12 תקציב (r147-a) — דחייה אחרי-השידור היא
// שריפה. מעתה, לפני כל ביצוע-פעולה נבחרת: POST לשער (תקציב-יומי 12/יום
// דטרמיניסטי + שיפוט-LLM לפי שבעת-החוקים). חוקי-החיווט:
//   · כשל-שער כלשהו (חסם-20ש' / תשובה לא תקינה) ⇒ כשל-פתוח: ממשיכים
//     והכישלון נרשם בכנות ב-lastGate — הלולאה לעולם לא נחסמת בכישלון-שער.
//   · DENY ⇒ מדלגים על הביצוע במחזור הזה (אין ביצוע, אין חתימה) והלולאה
//     ממשיכה לפעום — מצב-הלולאה נושא את פסק-הדין והסיבות בעברית.
//   · ALLOW/REVIEW ⇒ מבצעים כרגיל.
async function callEconGate(actionId: string, kind: string, description: string): Promise<LoopGateRecord> {
  const at = utcIso();
  try {
    const res = await fetch(`${HOME_BASE}/api/econ-gate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId, kind, description, source: "governance-loop", spend: false }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      verdict?: { verdict?: string; score?: number; reasonsHe?: unknown; budget?: { actionsToday?: number; cap?: number } };
    } | null;
    const v = data?.verdict;
    if (res.ok && data?.ok && v && (v.verdict === "ALLOW" || v.verdict === "REVIEW" || v.verdict === "DENY")) {
      return {
        at,
        verdict: v.verdict,
        score: typeof v.score === "number" ? v.score : null,
        reasonsHe: Array.isArray(v.reasonsHe)
          ? v.reasonsHe.filter((r): r is string => typeof r === "string").slice(0, 4)
          : [],
        actionsToday: typeof v.budget?.actionsToday === "number" ? v.budget.actionsToday : null,
        cap: typeof v.budget?.cap === "number" ? v.budget.cap : null,
        actionId,
      };
    }
    return {
      at,
      verdict: "gate-unreachable",
      score: null,
      reasonsHe: [`תשובת-שער לא תקינה (HTTP ${res.status}) — כשל-פתוח: הלולאה המשיכה`],
      actionsToday: null,
      cap: null,
      actionId,
    };
  } catch (e) {
    return {
      at,
      verdict: "gate-unreachable",
      score: null,
      reasonsHe: [`השער לא נענה: ${(e instanceof Error ? e.message : "שגיאה").slice(0, 140)} — כשל-פתוח: הלולאה המשיכה`],
      actionsToday: null,
      cap: null,
      actionId,
    };
  }
}

// r148-b — פרישת-דור: אחרי HMR של המודול, טיימר-דור-ישן (נטען לפני שער-
// הכלכלה) עלול להמשיך להריץ מחזורים בלי שער. המחזור-הראשון של הדור-החדש
// פורש את הטיימר-הישן — לולאה-יחידה (R80) עם השער בתוכה. מופע-טרי-אחרי-
// איתחול-שרת נושא gen עדכני והפונקציה אינה עושה דבר.
function retireStaleLoopTimer(): void {
  const live = g.__weaveGovernanceLoop;
  if (live?.started && live.gen !== LOOP_GEN) {
    if (live.timer) {
      try {
        clearInterval(live.timer);
      } catch {}
    }
    live.gen = LOOP_GEN;
    try {
      fs.appendFileSync(
        `${HOME}/sovereign/keeper/logs/governance-loop.log`,
        `${utcIso()} r148-b: טיימר-דור-ישן פרש (HMR) — לולאה-יחידה עם שער-הכלכלה\n`,
      );
    } catch {}
  }
}

// ─── מדידות-חיות (הראיות של כל החלטה) ───

async function fetchJson(pathname: string, timeoutMs = 6_000): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${HOME_BASE}${pathname}`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function tcpAlive(port: number, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, "127.0.0.1");
  });
}

async function measureFleet(): Promise<{ alive: string[]; dead: string[] }> {
  const alive: string[] = [];
  const dead: string[] = [];
  for (const d of DAEMON_PORTS) (await tcpAlive(d.port) ? alive : dead).push(d.name);
  return { alive, dead };
}

async function measureEvidenceFreshness(): Promise<Array<{ file: string; ageMinutes: number }>> {
  const files = [
    `${HOME}/sovereign/ops-log.json`,
    `${HOME}/sovereign/beat-report.json`,
    `${HOME}/sovereign/kpi/state.json`,
    `${HOME}/sovereign/keeper/fleet-guard-state.json`,
    // r144-c — ראיות-הכלכלה נמדדות עם הבית: פנקס-ה-PnL (תמונות hash-chained)
    // ומילויי-השרשרת (צ'קפוינט fill_order) — החלטה בלי אמת-כלכלית אינה עוד
    // החלטה-עיוורת (D-SCALE: PnL מכריע את הצעד הבא).
    `${HOME}/sovereign/economy/pnl-snapshots.json`,
    `${HOME}/sovereign/money/pnl-scan.json`,
    // r145-b — ראיות-הצבא: דיג'סט-הקהל (audience-analyst · D-r145-AUD) וביקורת-
    // האוצר (treasury-audit · D-r145-TRS) נכללות במדידת-הטריות של הלולאה
    `${HOME}/sovereign/audience/latest-digest.json`,
    `${HOME}/sovereign/treasury-audit/last-audit.json`,
    // r146-b — ראיית-הסייר: דיג'סט-החוץ של scout-market (D-r146-SCOUT) —
    // שוק/תחרות/מועמד-פריצה מהרשת הפתוחה; החלטה שלא רואה את-העולם = החלטה-עיוורת
    `${HOME}/sovereign/scout/latest-digest.json`,
    // r147-biz — ראיית-החממה: רישום-העסקים + פרוטוקול-החשיבה (D-r147-BIZ) —
    // החלטה שלא רואה את עסקי-הרשת, שורות-ההרג שלהם וחוקי-הקיבולת = החלטה עיוורת-כלכלית
    `${HOME}/sovereign/businesses/registry.json`,
    `${HOME}/sovereign/businesses/protocol.md`,
  ];
  const out: Array<{ file: string; ageMinutes: number }> = [];
  const now = Date.now();
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      out.push({ file: f.split("/").slice(-2).join("/"), ageMinutes: Math.round((now - st.mtimeMs) / 60_000) });
    } catch {}
  }
  return out;
}

async function measureGitAhead(): Promise<number> {
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("git", ["rev-list", "--count", "origin/main..HEAD"], {
      cwd: HOME,
      timeout: 20_000,
      encoding: "utf8",
    });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return -1;
  }
}

// ─── קריאת-מוח (r143-d · תיקון-שורש) ───
// הנתיב הקודם — POST ל-/api/weave/brain (מאגר NIM) — נמדד כעומד-נעול:
// netKeyHexOrFail זורק "מפתח הרשת אינו זמין" (db.networkKey חסר devKeyHex)
// ⇒ כל החלטה עד r143 נבחרה ברוטציה דטרמיניסטית (brainUsed=false תמיד).
// מעתה: callGovernanceBrain ישירות בשרת (z-ai-web-dev-sdk · nodejs runtime),
// fail-closed עם חסם-30ש' ואימות chosen מול allowed בהשוואה מדויקת;
// כישלון כלשהו ⇒ chooseAction עם מוח-אפס ⇒ רוטציה דטרמיניסטית —
// בדיוק אותו התנהגות-ברירת-מחדל כמקודם, בייט-בייט.
const deterministicFallbackBrain = async (): Promise<null> => null;

function buildProtocolSummary(
  ps: NonNullable<ReturnType<typeof readProgramState>>,
  na: NextAction,
  od: ReturnType<typeof readOpenDecisions>,
  log: DecisionEntry[],
): string {
  const open = (od?.decisions ?? [])
    .filter((d) => d.status === "open" || d.status === "provisional")
    .map((d) => `${d.id}(${d.status}${d.recommendation ? ` · המלצה: ${d.recommendation.slice(0, 80)}` : ""})`)
    .join(", ");
  const recent = log
    .slice(-3)
    .reverse()
    .map((d) => `${d.decisionId}: ${d.chosen.slice(0, 80)} — נימוק: ${d.why.slice(0, 140)}`)
    .join(" | ");
  return (
    `פאזה: ${ps.phase}\n` +
    `פעולה-באה: ${na.actionId} (v${na.version} · יעד-הסמכה ${na.qualificationTargetVersion}) — ${na.title}\n` +
    `תנאי-יציאה:\n${na.exitCriteria.map((c) => `- ${c}`).join("\n")}\n` +
    `החלטות-פתוחות: ${open || "אין"}\n` +
    `החלטות-אחרונות (חדש-ראשון): ${recent || "אין"}`
  );
}

// ─── הרצאות-פעולה חסומות (בתוך allowed בלבד) ───

async function execFleetTriage(): Promise<string> {
  const fleet = await measureFleet();
  const detail =
    fleet.dead.length === 0
      ? `צי מלא חי: ${fleet.alive.length}/${DAEMON_PORTS.length} דיבונים עונים`
      : `חיים ${fleet.alive.length} · מתים ${fleet.dead.length} (${fleet.dead.join(",")}) — fleet-guard יטפל ע"פ חוקיו`;
  return detail;
}

async function execEvidenceRefresh(): Promise<string> {
  const [treasury, freshness] = await Promise.all([fetchJson("/api/treasury"), measureEvidenceFreshness()]);
  const stalest = freshness.sort((a, b) => b.ageMinutes - a.ageMinutes)[0];
  const key = treasury && typeof treasury === "object" ? ("keyPresent" in treasury ? `keyPresent=${String((treasury as { keyPresent?: unknown }).keyPresent)}` : "house-state") : "treasury-unreachable";
  // r144-c — ראיית-כלכלה חיה בתוך ההחלטה: פנקס-ה-PnL (realized/unrealized,
  // שרשרת-גיבוב) + מילויי-השרשרת. כישלון-קריאה = "unmeasured" בכנות.
  const economy = measureEconomyEvidence();
  return `מדידת-בית: ${key} · ראיה-כי-ישנה ביותר: ${stalest ? `${stalest.file} בת ${stalest.ageMinutes} דק'` : "אין"} · כלכלה: ${economy}`;
}

// r144-c — מדידת-אמת-כלכלית לראיית-החלטה: פנקס-ה-PnL + מילויי-השרשרת.
// קריאה מקומית בלבד (אפס רשת, אפס מפתחות) — fail-closed ל-"unmeasured".
function measureEconomyEvidence(): string {
  const parts: string[] = [];
  try {
    const j = JSON.parse(fs.readFileSync(`${HOME}/sovereign/economy/pnl-snapshots.json`, "utf8")) as {
      entries?: Array<{ at?: string; realized?: { capturedSbd?: number | null; trips?: number | null }; unrealized?: { ladderPremiumSbd?: number | null; ordersOpen?: number | null } }>;
    };
    const entries = Array.isArray(j.entries) ? j.entries : [];
    const last = entries[entries.length - 1];
    if (last) {
      const ageMin = last.at ? Math.round((Date.now() - Date.parse(last.at)) / 60_000) : null;
      parts.push(
        `pnl-snapshots seq=${entries.length} (realizedSbd=${last.realized?.capturedSbd ?? "unmeasured"} · trips=${last.realized?.trips ?? "unmeasured"} · unrealizedPremiumSbd=${last.unrealized?.ladderPremiumSbd ?? "unmeasured"} · orders=${last.unrealized?.ordersOpen ?? "unmeasured"}${ageMin != null ? ` · בת ${ageMin} דק'` : ""})`,
      );
    } else {
      parts.push("pnl-snapshots ריק (unmeasured)");
    }
  } catch {
    parts.push("pnl-snapshots unmeasured");
  }
  try {
    const s = JSON.parse(fs.readFileSync(`${HOME}/sovereign/money/pnl-scan.json`, "utf8")) as { fills?: unknown[]; maxIndex?: number; savedAt?: string };
    const fills = Array.isArray(s.fills) ? s.fills.length : null;
    parts.push(`מילויי-שרשרת ${fills ?? "unmeasured"} (maxIndex=${s.maxIndex ?? "?"})`);
  } catch {
    parts.push("מילויי-שרשרת unmeasured");
  }
  return parts.join(" · ");
}

// ─── קידום-מדינה (r143-b · תיקון-שורש) ───
// השורש שנמדד: הלולאה בחרה "Advance NEXT_ACTION..." חמש פעמים (seq 2-6
// ביומן) ומדדה תנאי-יציאה — אבל writeNextAction היה קוד-מת: אין נתיב
// ביצוע שכותב את הפעולה-הבאה, והפרוטוקול נשאר r142 לנצח. מעתה: מדידה
// 1:1 מול נוסח-הקריטריונים בקובץ, וכשהכל נמדד מלא — הלולאה עצמה כותבת
// את הפעולה-הבאה (הקבצים בבעלות-הפרוטוקול: אף יד לא עורכת אותם ישירות).

interface ExitCheck {
  name: string;
  ok: boolean;
  measured: string;
}

function readFleetGuardCycles(): number | null {
  try {
    const raw = JSON.parse(fs.readFileSync(FLEET_GUARD_STATE_PATH, "utf8")) as { cycles?: number };
    return typeof raw.cycles === "number" ? raw.cycles : null;
  } catch {
    return null;
  }
}

// ראיה-מצביעה: שדה evidence, או מצביע-ראיה בתוך טקסט הגבול (רשומת-האימוץ
// seq 1 נכתבה לפני-הלולאה והראיה שלה חיה בתוך ה-boundary — זו מדידה, לא היתמות).
function hasEvidencePointer(d: DecisionEntry): boolean {
  return Boolean(d.evidence?.trim()) || /evidence\s*:/i.test(d.boundary ?? "");
}

async function measureExitCriteria(na: NextAction): Promise<ExitCheck[]> {
  const [gov, gitAhead] = await Promise.all([fetchJson("/api/governance"), measureGitAhead()]);
  const log = readDecisionLog();
  const chain = verifyDecisionLog();
  const govOk = gov?.ok === true;
  const checks: ExitCheck[] = [];

  for (const crit of na.exitCriteria) {
    const c = crit.toLowerCase();
    let matched = false;

    // "governance daemon alive on port N and measured by fleet-guard"
    const portM = /daemon alive on port (\d+)/.exec(c);
    if (portM) {
      const alive = await tcpAlive(Number(portM[1]) || 0);
      const guardCycles = readFleetGuardCycles();
      const guardMeasured = guardCycles != null && guardCycles > 0;
      checks.push({
        name: "daemon-alive+guard",
        ok: alive && guardMeasured,
        measured: `${alive ? "חי" : "מת"} · fleet-guard ${guardCycles != null ? `cycles=${guardCycles}` : "לא נמדד"}`,
      });
      matched = true;
    }

    // "at least N ... with distinct decisionIds" (אופציונלי: "after this action was set")
    if (/distinct decisionids/.test(c)) {
      const since = /after this action/.test(c) ? Date.parse(na.updatedAt) || 0 : 0;
      const need = Number(/at least (\d+)/.exec(c)?.[1] ?? 3);
      const distinct = new Set(log.filter((d) => Date.parse(d.at) >= since).map((d) => d.decisionId)).size;
      checks.push({ name: "distinct-decisions", ok: distinct >= need, measured: `${distinct}/${need}` });
      matched = true;
    }

    // "each logged decision carries: chosen action, why, boundary class, evidence pointer"
    if (/chosen action, why, boundary/.test(c)) {
      const missing = log
        .filter((d) => !(d.chosen?.trim() && d.why?.trim() && d.boundary?.trim()) || !hasEvidencePointer(d))
        .map((d) => d.seq);
      checks.push({
        name: "entries-complete",
        ok: missing.length === 0,
        measured: missing.length === 0 ? `${log.length} רשומות מלאות` : `חסר ב-seq ${missing.join(",")}`,
      });
      matched = true;
    }

    // "DECISION_LOG.jsonl ... append-only hash-chained"
    if (/hash-chained|append-only/.test(c)) {
      checks.push({ name: "log-chain-valid", ok: chain.ok, measured: chain.ok ? `${chain.entries} רשומות תקינות` : `שבור ב-${chain.brokenAt}` });
      matched = true;
    }

    // "governance API (/api/governance) returns live state consumed by the UI"
    if (/api\/governance/.test(c)) {
      checks.push({ name: "governance-api-live", ok: govOk, measured: govOk ? "200" : "no-response" });
      matched = true;
    }

    // "git advanced: ... committed and pushed by the fleet itself"
    if (/git advanced/.test(c)) {
      checks.push({
        name: "git-advanced",
        ok: gitAhead === 0,
        measured: gitAhead < 0 ? "git-unreachable" : gitAhead === 0 ? "הכל ב-origin" : `${gitAhead} קומיטים מקומיים`,
      });
      matched = true;
    }

    // fail-closed: קריטריון שאין לו מדידה קשורה — לא מתקדמים בעיוורון
    if (!matched) {
      checks.push({ name: "unmatched-criterion", ok: false, measured: `אין מדידה קשורה: ${crit.slice(0, 80)}` });
    }
  }
  return checks;
}

// הפעולה-הבאה נכתבת על-ידי הלולאה עצמה (לעולם לא ביד) — תוכן-ההמשך נגזר
// מהפעולה-הנוכחית: אותם איסורים, תחום-הפעולות המותרות של מצב-שגרה,
// וקריטריוני-יציאה שהמדידה שלעיל יודעת למדוד 1:1.
function buildNextAction(prev: NextAction): NextAction {
  const version =
    prev.qualificationTargetVersion ||
    `r${(Number(/r(\d+)/.exec(prev.version)?.[1] ?? 0) || 0) + 1}`;
  const nextNum = (Number(/r(\d+)/.exec(version)?.[1] ?? 0) || 0) + 1;
  const updatedAt = utcIso();
  return {
    format: prev.format,
    schemaVersion: prev.schemaVersion,
    version,
    updatedAt,
    actionId: `NA-${version}-STEADY-DECISION-LOOP`,
    title:
      "Steady state: one signed decision per cycle — decide within boundaries, measure truth, record evidence, close open decisions, advance when criteria are measured met",
    allowedActions: [
      "Run the decision cycle: read state, choose one pre-approved action, execute within boundary, append evidence to DECISION_LOG.jsonl",
      "Advance NEXT_ACTION when exit criteria are measured met",
      "Close provisional open decisions whose measured evidence exists (mark resolved with evidence pointer)",
      "Refresh stale evidence behind any page claim (measure, then update truth)",
      "Triage degraded fleet agents: classify quota-strangled / operator-gate / code-bug, dispatch revival where pre-approved",
    ],
    forbiddenActions: [...prev.forbiddenActions],
    exitCriteria: [
      "governance daemon alive on port 3042 and measured by fleet-guard",
      `at least 3 signed decisions recorded after this action was set (${updatedAt}) with distinct decisionIds`,
      "every logged decision carries: chosen action, why, boundary class, evidence pointer",
      "governance API (/api/governance) returns live state consumed by the UI",
      "git advanced: protocol files + daemon + evidence committed and pushed by the fleet itself",
    ],
    qualificationTargetVersion: `r${nextNum}`,
  };
}

async function execAdvanceCheck(na: NextAction): Promise<{ detail: string; advanced: boolean }> {
  const checks = await measureExitCriteria(na);
  const fmt = (allOk: boolean): string =>
    checks.map((c) => `${c.name}=${allOk && c.ok ? c.measured : c.ok ? "PASS" : `FAIL(${c.measured})`}`).join(" · ");

  if (!checks.every((c) => c.ok)) {
    return { detail: `תנאי-יציאה: ${fmt(false)}`, advanced: false };
  }

  // CAS כנה: אם מופע-אחר התקדם במקביל — אין כתיבה כפולה
  const current = readNextAction();
  if (!current || current.version !== na.version) {
    return {
      detail: `התקדמות כבר בוצעה במקביל (version=${current?.version ?? "?"}) — אין כתיבה כפולה`,
      advanced: false,
    };
  }
  if (!na.qualificationTargetVersion) {
    return {
      detail: `כל תנאי-היציאה נמדדו מלאים (${fmt(true)}) אך אין qualificationTargetVersion — לא מתקדמים בעיוורון`,
      advanced: false,
    };
  }

  const next = buildNextAction(na);
  writeNextAction(next);
  return {
    detail: `כל תנאי-היציאה של ${na.actionId} נמדדו מלאים: ${fmt(true)} · הפרוטוקול התקדם: ${next.actionId} (version ${next.version})`,
    advanced: true,
  };
}

// ─── המחזור עצמו ───

// r144-f — תוצאת-מחזור: מצב-הלולאה + שדות-דחייה כנים כשהמחזור לא רץ (כותב-שני).
export interface GovernanceCycleResult extends CycleState {
  skipped?: boolean;
  reason?: string;
}

// r144-f — חוק-כותב-יחיד: השער-הכניסה לכל מחזור. שני הכותבים (לולאת-האינסטרומנטציה
// שקוראת ישירות · דיבון-3042 שעובר דרך הנתב) נכנסים דרך כאן — באותו תהליך-שרת,
// ולכן נעילת-ה-globalThis חוסמת את שניהם. בדיקת-הנעילה והצבתה סינכרוניות
// (בלי await ביניהן) — אטומיות בלולאת-האירועים. try/finally משחרר תמיד.
export async function runGovernanceCycle(options: { force?: boolean } = {}): Promise<GovernanceCycleResult> {
  retireStaleLoopTimer(); // r148-b — אם טיימר-דור-ישן (טרם-השער) חי — הוא פורש עכשיו
  // שכבה 1 — נעילת-עיצוב: מחזור כבש רץ עכשיו ⇒ דחייה מיידית בכנות, בלי ביצוע.
  if (g.__govCycleInFlight__) {
    return {
      ...governanceLoopState(),
      skipped: true,
      reason: "מחזור כבש בעיצומו — נדחה (מנע-כתיבה-כפולה)",
    };
  }
  g.__govCycleInFlight__ = true;
  try {
    // שכבה 2 — קצב-פנימי בתוך-הנעילה: כותב-שני שמגיע בתוך אותו קצב של 10 דק'
    // (המחזור-המוצלח האחרון טרי מ-<9 דק') נדחה בכנות. lastCycleAt מתעדכן רק
    // אחרי-הצירוף — לכן הבדיקה חייבת לשבת בתוך-הנעילה, אחרת זה אותו TOCTOU.
    // force פוטר (יד-אנושית מכוונת); קירור-90ש' של הנתב נשאר מעליו כרגיל.
    if (!options.force) {
      const live = governanceLoopState();
      const lastAt = live.lastCycleAt ? Date.parse(live.lastCycleAt) : 0;
      if (Number.isFinite(lastAt) && lastAt > 0) {
        const sinceMs = Date.now() - lastAt;
        if (sinceMs >= 0 && sinceMs < MIN_INTERNAL_GAP_MS) {
          return {
            ...live,
            skipped: true,
            reason: `מחזור טרי נמדד לפני ${(sinceMs / 60_000).toFixed(1)}דק' — אנטי-כפילות`,
          };
        }
      }
    }
    return await runGovernanceCycleLocked();
  } finally {
    g.__govCycleInFlight__ = false;
  }
}

async function runGovernanceCycleLocked(): Promise<CycleState> {
  const state = readCycleState();

  // r143-a — תיקון-עצמי בפתיחת-המחזור: אימות-השרשרת; שבורה ⇒ חתימת-פער.
  // החתימה נוגעת רק בשדות-הקריפטו; תוכן-ההחלטות נשאר בייט-בייט (D-OP-01).
  const chainAtStart = verifyDecisionLog();
  const seal = chainAtStart.ok ? null : sealUnsealedEntries();
  // רישום פעולת-החתימה כהחלטה חתומה משלה — פעם-אחת לכל אירוע-חתימה באמת
  // (רק כשנחתם/שורשר משהו במחזור הזה; מחזור-בא אינו חוזר על הרישום).
  const recordSealDecision = (): void => {
    if (!seal || (seal.sealed === 0 && seal.rechained === 0)) return;
    try {
      const sealedEntry = appendDecision({
        decisionId: `D-r143-SEAL-${Date.now()}`,
        class: "governance",
        chosen: "seal-bootstrap-wedge",
        why:
          `the genesis entry (D-r142-01) was written with entryHash placeholder "TO_BE_SEALED_BY_DAEMON" before the first daemon cycle ever ran, leaving the hash chain broken at seq 1; sealing recomputed ONLY the cryptographic fields (prevHash/entryHash) — decision content untouched byte-for-byte (sealed=${seal.sealed} rechained=${seal.rechained})`,
        boundary:
          "auto: evidence integrity repair under D-OP-01 — append-only law preserved (no decision content edited)",
        evidence: `sovereign/governance/DECISION_LOG.jsonl · sealed=${seal.sealed} · rechained=${seal.rechained} · chainOkAfter=${seal.ok}`,
      });
      state.lastDecisionId = sealedEntry.decisionId;
      state.lastChosen = sealedEntry.chosen;
      state.lastDetail = `seal-bootstrap-wedge: sealed=${seal.sealed} rechained=${seal.rechained} ok=${seal.ok}`.slice(0, 300);
    } catch {}
  };

  try {
    const ps = readProgramState();
    const na = readNextAction();
    const od = readOpenDecisions();
    const log = readDecisionLog();
    const last = log[log.length - 1] ?? null;

    if (!ps || !na) {
      state.lastVerdict = "DEGRADED";
      state.lastDetail = "פרוטוקול חסר (PROGRAM_STATE/NEXT_ACTION) — לא מחליטים בתוך-עיוורון";
      recordSealDecision(); // החתימה שהתרחשה חייבת רישום גם במחזור שנכשל
      writeCycleState(state);
      writeLoopState(state);
      syncLoopGlobal(state);
      return state;
    }

    // מדידות-חיות לפני הבחירה
    const [fleet, freshness, gitAhead] = await Promise.all([
      measureFleet(),
      measureEvidenceFreshness(),
      measureGitAhead(),
    ]);
    const fleetSummary = `דיבונים ${fleet.alive.length}/${DAEMON_PORTS.length} חיים${fleet.dead.length ? ` · מתים: ${fleet.dead.join(",")}` : ""} · ראיה-ישנה: ${freshness.sort((a, b) => b.ageMinutes - a.ageMinutes)[0]?.ageMinutes ?? "?"} דק'`;

    // המוח בוחר מתוך allowedActions בלבד; כישלון-מוח ⇒ רוטציה דטרמיניסטית
    const brain = await callGovernanceBrain({
      allowed: na.allowedActions,
      protocolSummary: buildProtocolSummary(ps, na, od, log),
      context: `${fleetSummary} · chain.ok=${chainAtStart.ok} · gitAhead=${gitAhead} · cycles=${state.cycles}`,
    });
    const brainIdx = brain ? na.allowedActions.indexOf(brain.chosen) : -1;
    const choice: BrainChoice =
      brain && brainIdx >= 0
        ? { index: brainIdx, why: brain.why, raw: JSON.stringify({ chosen: brain.chosen, why: brain.why }) }
        : await chooseAction(
            na.allowedActions,
            { phase: ps.phase, openDecisions: od?.decisions ?? [], lastDecision: last, fleetSummary },
            deterministicFallbackBrain,
          );
    const chosen = choice.index !== null ? (na.allowedActions[choice.index] ?? "") : "";

    // r148-b — שער-הכלכלה לפני-ביצוע (FAIL-OPEN): הפעולה-הנבחרת עומדת לרדת
    // מהמסילה — קודם תקציב-יומי דטרמיניסטי (12/יום) + שיפוט-שבעת-החוקים.
    // spend=false (תיקון-תקרית-34, מדוד ממאגר allowedActions): פעולות-הלולאה
    // כולן מידה/ממשל/ראיה — אינן שורפות תקציב-שידורים; השיפוט רץ, התקרה לא
    // חוסמת. שידורים-אמת נמדדים ונאכפים בשער עם spend=true (ובשירותים עצמם).
    // ה-actionId הוא ה-decisionId שהמחזור הזה יחתום אם יעבור את השער.
    const prospectiveDecisionId = `D-${na.version}-${String(state.cycles + 1).padStart(3, "0")}`;
    const gate = await callEconGate(prospectiveDecisionId, "governance-cycle", chosen || "measure-truth");
    state.lastGate = gate;
    // סמנטיקת-השער (r148-b תיקון-שני, מדוד חי): פסק-דין DENY חוסם רק
    // פעולות-הוצאה (spend=true). הקריאה-מהלולאה היא spend=false — פעולות
    // מידה/ממשל שאינן שורפות תקציב-שידורים — ולכן השיפוט כאן **עצה נרשמת**:
    // חי ב-lastGate + ביומן-השער, מעצב בנראות ובממשל — לא מנעול. (מדוד
    // 13:4xZ: השופט מציין DENY על "לא דווח" בקלטי-מידה טקסטואליים — חסימת
    // מחזור-מידה על זה הייתה מקפיאה את משטח-האמת של הרשת, המחלה היא גרועה
    // מהתרופה. חסימת-הוצאה אמת נשארת קשה: השירותים המשדרים קוראים spend=true.)
    // מדוד (13:4xZ ממאגר allowedActions): אין במאגר פעולות-שידור — כל
    // הפעולות מידה/ממשל. כשתירכש פעולת-שידור, המסווג כאן יסמן spend=true
    // וה-DENY יחסום. עכשיו: השיפוט עצה בלבד — הרישום הוא האכיפה.
    const chosenIsSpendAction = false;
    if (gate.verdict === "DENY" && chosenIsSpendAction) {
      recordSealDecision();
      writeCycleState(state);
      writeLoopState(state);
      syncLoopGlobal(state);
      return state;
    }

    // הרצאה חסומה לפי מה שנבחר
    let detail = "";
    let advanced = false;
    if (/טריאז'|triage|degraded/i.test(chosen)) detail = await execFleetTriage();
    else if (/Refresh stale evidence|רענון|evidence/i.test(chosen)) detail = await execEvidenceRefresh();
    else if (/Advance NEXT_ACTION|התקדמות|advance/i.test(chosen)) {
      const adv = await execAdvanceCheck(na);
      detail = adv.detail;
      advanced = adv.advanced;
    } else detail = await execEvidenceRefresh(); // ברירת-מחדל חסומה: מדידת-אמת

    // רישום ההחלטה — חתומה גיבוב, עם הראיה שנמדדה
    const sealed = appendDecision({
      decisionId: `D-${na.version}-${String(state.cycles + 1).padStart(3, "0")}`,
      class: "governance",
      chosen: chosen || "measure-truth",
      why: choice.why,
      boundary: "AUTO (D-OP-01 אישור-עומד) · בתוך allowedActions של " + na.actionId,
      evidence: detail,
    });

    state.cycles += 1;
    state.lastCycleAt = utcIso();
    state.lastDecisionId = sealed.decisionId;
    state.lastChosen = sealed.chosen;
    state.brainUsed = choice.index !== null && Boolean(choice.raw);
    state.lastVerdict = advanced ? "ADVANCED" : "DECIDED";
    state.lastDetail = detail.slice(0, 300);
    recordSealDecision(); // r143-a — אחרי הזרימה הרגילה: החלטת-החתימה נרשמת אחרונה
    writeCycleState(state);
    writeLoopState(state); // r143-a — התמדה אטומית של מצב-הלולאה אחרי כל מחזור
    syncLoopGlobal(state);
    return state;
  } catch (e) {
    state.lastVerdict = "DEGRADED";
    state.lastDetail = (e instanceof Error ? e.message : "שגיאת מחזור").slice(0, 300);
    recordSealDecision();
    writeCycleState(state);
    writeLoopState(state);
    syncLoopGlobal(state);
    return state;
  }
}

// ─── לולאה-יחידה (R80) ───

export function startGovernanceLoop(): void {
  if (g.__weaveGovernanceLoop?.started) return;
  const state = readLoopState() ?? readCycleState(); // r143-a — מופע-טרי יורש את האמת מהדיסק
  state.bootedAt = state.bootedAt || utcIso();
  g.__weaveGovernanceLoop = { timer: null, started: true, state, gen: LOOP_GEN };

  const tick = async () => {
    try {
      await runGovernanceCycle();
    } catch {}
  };

  setTimeout(tick, FIRST_CYCLE_DELAY_MS);
  g.__weaveGovernanceLoop.timer = setInterval(tick, CYCLE_INTERVAL_MS);

  try {
    fs.mkdirSync(`${HOME}/sovereign/keeper/logs`, { recursive: true });
    fs.appendFileSync(
      `${HOME}/sovereign/keeper/logs/governance-loop.log`,
      `${utcIso()} governance-loop started (interval=${CYCLE_INTERVAL_MS / 1000}s)\n`,
    );
  } catch {}
}

export function governanceLoopState(): CycleState {
  // r143-a — המצב-החי בתהליך גובר תמיד; מופע-מודול טרי קורא loop-state.json
  // לפני שהוא נופל לברירות-המחדל — אפסים כוזבים אינם עוד תשובה אפשרית.
  return g.__weaveGovernanceLoop?.state ?? readLoopState() ?? readCycleState();
}
