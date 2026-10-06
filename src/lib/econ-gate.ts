// ─────────────────────────────────────────────────────────────────────
// ECON-GATE · שער-הכלכלה (r148-b)
//
// המשימה: כל פעולת-רשת שעולה משהו (תקציב-פעולות · שידורים · הון) עוברת
// שער-כלכלה מדוד לפני-הביצוע. שני הלקחים החיים שאורגנו כאן לחוק:
//   · clodfarm-governor (r147-biz, חוקי-קיבולת): תקרה-קשה מעל הכל —
//     תקציב-פעולות 12/יום הוא התקרה-הקשה של כל העסקים יחד
//     (sovereign/businesses/protocol.md חוק 4 · registry capacityLawHe).
//   · r147-a פורנזיקה: 7 דחיות NO-FUEL שרפו 7/12 תקציב — דחייה
//     אחרי-השידור היא שריפה; השער יושב לפני-הביצוע, ודחייה לפני-שידור
//     לא שורפת תקציב (D-r147-ECO).
//
// סדר-ההכרעה (מדוד, לא ניחוש):
//   1. תקציב — דטרמיניסטי, אפס LLM: ספירת שידורים-אמת של יום-ה-UTC מהמונים
//      החיים (money/state.json actionsToday · businesses/engine-state.json
//      budget.actionsToday) — לא שורות-יומן-החלטות. תקרית-מדודה 13:16Z:
//      הספירה-הראשונה ספרה 34/12 מ-DECISION_LOG — רובן החלטות-מידה/ראיה
//      (governance:23) שאינן שורפות תקציב — תוקן לספירת-שידורים בלבד.
//      התקרה-הקשה חלה רק על פעולות-הוצאה (spend=true) — מחזורי-מידה
//      וממשל ממשיכים לפעום גם ביום-תקציב-מלא. מעל-התקרה (spend) ⇒ DENY
//      מיידי בלי קריאת-שיפוט (DENY-התקציב גובר על הכל).
//   2. שיפוט-LLM (z-ai-web-dev-sdk · שרת-בלבד): שבעת חוקי-החשיבה
//      (נקראים חי מ-protocol.md, עם גיבוי-מוטמע מאומת) + חוק-הקיבולת
//      (registry capacityLawHe) + הדוקטרינה (registry lawHe). תשובה
//      STRICT JSON; פענוח-כישלון ⇒ REVIEW כן — לא המצאה.
//   3. חגורות-ציון: 70+ ALLOW · 40-69 REVIEW · מתחת-40 DENY.
//
// כל פסק-דין נרשם שורה-קומפקטית אחת ב-sovereign/governance/econ-gate.jsonl.
// אפס סודות כאן: אף מפתח, אף סוד — מספרים ונימוקים בלבד.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import ZAI from "z-ai-web-dev-sdk";

const HOME = "/home/z/my-project";
const GATE_LOG_PATH = path.join(HOME, "sovereign", "governance", "econ-gate.jsonl");
const BUSINESSES_REGISTRY_PATH = path.join(HOME, "sovereign", "businesses", "registry.json");
const BUSINESSES_PROTOCOL_PATH = path.join(HOME, "sovereign", "businesses", "protocol.md");

// התקרה-הקשה הגלובלית — protocol.md חוק-הקיבולת: "תקציב-פעולות 16/יום הוא
// התקרה-הקשה של כל העסקים יחד" (D-r149-BUDGET: הועלתה מ-12 — נמדד 2026-10-02:
// היום האמיתי כבר 13/12 כי מוביל-הכסף לבדו מתקרב לתקרה, והמפעל-החמישי נולד;
// שרשרת-אפס-עמלות, ראש-RC בריא — הקצאה: money 12 · engine 3 · content 2).
// registry budgetCap: "כפוף לתקציב-הפעולות הגלובלי 16/יום". לעולם לא מעל-התקרה.
export const DAILY_ACTION_CAP = 16;

// חסם-קשה לקריאת-השיפוט (ל-SDK אין signal — דפוס Promise.race זהה
// ל-governance-brain.ts). 15ש' — כדי שקורא-חוץ עם חסם-20ש' (הלולאה)
// תמיד יקבל תשובה לפני שהוא מוותר.
const GATE_LLM_TIMEOUT_MS = 15_000;

// ─── טיפוסי-השער (החוזה הציבורי) ─────────────────────────────────────

export interface EconGateInput {
  actionId: string;
  businessId?: string;
  kind: string;
  description: string;
  estimatedCost?: string;
  expectedValue?: string;
  killLineAware?: boolean;
  reversible?: boolean;
  source: string;
  // r148-b תיקון-תקרית-34: spend=true ⇒ התקרה-הקשה חלה (שידור/הוצאה).
  // spend=false/חסר ⇒ פעולת-מידה/ממשל/ראיה — השיפוט רץ, התקרה לא חוסמת.
  spend?: boolean;
}

export interface EconGateVerdict {
  verdict: "ALLOW" | "REVIEW" | "DENY";
  reasonsHe: string[];
  score: number; // 0-100
  budget: { actionDay: string; actionsToday: number; cap: number };
  measuredAt: string;
  latencyMs: number;
  model: string;
}

// ─── החוקים: קריאה-חיה עם גיבוי-מוטמע מאומת ──────────────────────────
// הגיבוי להלן הוא נוסח-מילולי מהקבצים עצמם (protocol.md סעיף "שבעת
// החוקים" · registry.json) — נלקח בעת-הכתיבה כדי שכשל-קריאה לא ישתיק
// את החוק אלא יפול לנוסח הידוע, בכנות.

const LAWS_FALLBACK_HE: string[] = [
  "1. חוק-הראיה-הכלכלית — אין עסק בלי מספרי-ביקוש מדודים לפני השקה. טענת-ביקוש בלי מספר = נדחית בשער, כמו כל ראיה בבית.",
  "2. חוק-העלות-השולית — העסק הראשון של ישות צעירה רץ על מה שכבר מיוצר. עסק שדורש הון/תשתית-חדשה לפני שהעלות-השולית הוכחה = נדחה עד שהזול הוכח.",
  "3. חוק-שורת-ההרג — לכל עסק killLine מדוד מראש, כתוב ברישום, נקרא על-ידי המוח בכל מחזור. עסק-שנהרג בכבוד הוא ניצחון-מידע.",
  "4. חוק-הקיבולת — הפרד קשה-מול-רך: תקרה-קשה (overage=אף-פעם), קצב-רך שמתפרש על-הזמן, ורצפת-מינימום. תקציב-פעולות 16/יום הוא התקרה-הקשה של כל העסקים יחד; דחייה לפני-שידור לא שורפת.",
  "5. חוק-גינה-מול-ברז — תנועה שכורה היא ברז: נסגר, והעסק מת. גינה מניבה בכל עונה. עסק נבנה על גינה; ברז מותר רק כזרז נמדד וחד-פעמי.",
  "6. חוק-הזיכרון-בין-העסקים — כל ניסיון (הצלחה וכישלון) נרשם. אף מחזור לא מתחיל מאפס.",
  "7. חוק-הגבול-החתום — כסף אמיתי זז רק בתוך D-OP-01 ושערי-המפעיל. ריבונות אינה אנרכיה: גבולות שנחתמו, ואף סוכן לא חוצה אותם בשתיקה.",
];

const CAPACITY_FALLBACK_HE =
  "חוק-הקיבולת (מהלקח מ-governor של clodfarm): הפסקות-קשות מול קצב-רך · אף עסק לא חורג מתקציב-הפעולות הגלובלי · איבוד-מודע לא שורף תקציב (D-r147-ECO) · לעולם לא מעל-התקרה.";

const DOCTRINE_FALLBACK_HE =
  "אין עסק בלי ראיה, אין ראיה בלי מספרים, אין עסק בלי שורת-הרג מדודה מראש. עלות-שולית קודמת להון. גינה קודמת לברז.";

interface LawTexts {
  lawsHe: string[];
  capacityLawHe: string;
  doctrineHe: string;
  lawsSourceLive: boolean;
}

function extractSevenLaws(md: string): string[] {
  const start = md.indexOf("## שבעת החוקים");
  if (start < 0) return [];
  const rest = md.slice(start);
  const next = rest.indexOf("\n## ", 1);
  const section = next > 0 ? rest.slice(0, next) : rest;
  return section
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s/.test(l));
}

function readLaws(): LawTexts {
  let lawsHe: string[] = [];
  let lawsSourceLive = false;
  try {
    lawsHe = extractSevenLaws(fs.readFileSync(BUSINESSES_PROTOCOL_PATH, "utf8"));
    lawsSourceLive = lawsHe.length === 7;
  } catch {}
  let capacityLawHe = "";
  let doctrineHe = "";
  try {
    const j = JSON.parse(fs.readFileSync(BUSINESSES_REGISTRY_PATH, "utf8")) as {
      capacityLawHe?: unknown;
      lawHe?: unknown;
    };
    if (typeof j.capacityLawHe === "string" && j.capacityLawHe.trim()) capacityLawHe = j.capacityLawHe.trim();
    if (typeof j.lawHe === "string" && j.lawHe.trim()) doctrineHe = j.lawHe.trim();
  } catch {}
  return {
    lawsHe: lawsSourceLive ? lawsHe : LAWS_FALLBACK_HE,
    capacityLawHe: capacityLawHe || CAPACITY_FALLBACK_HE,
    doctrineHe: doctrineHe || DOCTRINE_FALLBACK_HE,
    lawsSourceLive,
  };
}

// חוק-הבית בשורה-אחת (ל-API ה-GET) — מהרישום-החי; null אם אין (fail-soft, בלי המצאה)
export function readRegistryLawHe(): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(BUSINESSES_REGISTRY_PATH, "utf8")) as { lawHe?: unknown };
    return typeof j.lawHe === "string" && j.lawHe.trim() ? j.lawHe.trim() : null;
  } catch {
    return null;
  }
}

// ─── מדידת-התקציב (דטרמיניסטית, אפס LLM) ────────────────────────────

export interface BudgetState {
  actionDay: string;
  actionsToday: number;
  cap: number;
  // פירוק-מקורות לשקיפות מלאה — מונה-שידורים חי מכל שירות (null = לא נענה)
  sources: { money: number | null; business: number | null };
}

// ספירת-שידורים-אמת: המונים החיים של השירותים המשדרים (לא שורות-יומן-
// החלטות — ראה כותרת המודול: תקרית-34/12 תוקנה). מונה-שירות נספר רק אם
// actionDay שלו הוא אכן היום (מונה-אתמול אינו חוב-היום).
function readSpendCounter(filePath: string, moneyStyle: boolean): number | null {
  try {
    const j = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (moneyStyle) {
      const day = j.actionDay;
      const n = j.actionsToday;
      return typeof n === "number" && typeof day === "string" ? n : null;
    }
    const b = j.budget as { actionsToday?: unknown; actionDay?: unknown } | undefined;
    return b && typeof b.actionsToday === "number" && typeof b.actionDay === "string" ? b.actionsToday : null;
  } catch {
    return null;
  }
}

export function measureBudget(now: Date = new Date()): BudgetState {
  const actionDay = now.toISOString().slice(0, 10);
  const moneyRaw = readSpendCounter(path.join(HOME, "sovereign", "money", "state.json"), true);
  const businessRaw = readSpendCounter(path.join(HOME, "sovereign", "businesses", "engine-state.json"), false);
  const moneyDay = readCounterDay(path.join(HOME, "sovereign", "money", "state.json"), true);
  const businessDay = readCounterDay(path.join(HOME, "sovereign", "businesses", "engine-state.json"), false);
  const money = moneyDay === actionDay ? moneyRaw : null;
  const business = businessDay === actionDay ? businessRaw : null;
  const actionsToday = (money ?? 0) + (business ?? 0);
  return { actionDay, actionsToday, cap: DAILY_ACTION_CAP, sources: { money, business } };
}

// יום-המונה החי (האם המונה של השירות שייך ליום הנוכחי)
function readCounterDay(filePath: string, moneyStyle: boolean): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (moneyStyle) return typeof j.actionDay === "string" ? j.actionDay : null;
    const b = j.budget as { actionDay?: unknown } | undefined;
    return b && typeof b.actionDay === "string" ? b.actionDay : null;
  } catch {
    return null;
  }
}

// ─── שיפוט-LLM (z-ai-web-dev-sdk · שרת-בלבד · סינגלטון כמו governance-brain) ──

let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null;

function getZai(): Promise<Awaited<ReturnType<typeof ZAI.create>>> {
  if (!zaiPromise) {
    zaiPromise = ZAI.create();
  }
  return zaiPromise;
}

function buildSystemPrompt(laws: LawTexts): string {
  return [
    "אתה שער-הכלכלה של רשת ריבונית אוטונומית (r148-b). לפניך פעולה שדורשת הקצאה (תקציב-פעולות/שידורים/הון).",
    "תפקידך: להכריע אם הפעולה עוברת את שער-הכלכלה — לפי המספרים בקלט בלבד. אסור להמציא מדידות.",
    "",
    "שבעת חוקי-החשיבה הכלכלית (sovereign/businesses/protocol.md):",
    ...laws.lawsHe.map((l) => `- ${l}`),
    "",
    `חוק-הקיבולת של הרישום (registry capacityLawHe): ${laws.capacityLawHe}`,
    `הדוקטרינה (registry lawHe): ${laws.doctrineHe}`,
    "",
    "הערות-שיפוט:",
    "· פעולה בלי מספרי-עלות/ערך מדודים אינה נהנית מהספק — 'לא דווח' הוא נימוק להחמיר, לא להקל.",
    "· פעולה על-גבי מה שכבר רץ (עלות-שולית ≈0) וקיימת-לה — מתקרבת ל-ALLOW.",
    "· פעולה חדשה הדורשת הון/תשתית בלי ראיית-ביקוש מדודה — מתקרבת ל-DENY.",
    "· מעל-תקרת-התקציב השער דוחה דטרמיניסטית ולא מגיע אליך — אל תכלול זאת בשיפוט.",
    "",
    'ענה STRICT JSON בלבד, בלי טקסט מסביב: {"score": <מספר שלם 0-100>, "verdict": "ALLOW"|"REVIEW"|"DENY", "reasonsHe": ["<נימוק בעברית מבוסס-מספרים>", ...]}',
    "חגורות-הציון: 70+ ALLOW · 40-69 REVIEW · מתחת-40 DENY. נימוק אחד לפחות ועד ארבעה; כל נימוק חייב להישען על מספר/עלות/ערך מהקלט — נימוק בלי מספרים פסול.",
  ].join("\n");
}

function buildUserPrompt(input: EconGateInput, budget: BudgetState): string {
  return [
    `actionId: ${input.actionId}`,
    `kind: ${input.kind}`,
    input.businessId ? `businessId: ${input.businessId}` : "businessId: (לא שויך לעסק)",
    `description: ${input.description}`,
    `estimatedCost: ${input.estimatedCost ?? "לא דווח"}`,
    `expectedValue: ${input.expectedValue ?? "לא דווח"}`,
    `killLineAware: ${input.killLineAware === true ? "true" : "לא דווח"}`,
    `reversible: ${input.reversible === true ? "true" : input.reversible === false ? "false" : "לא דווח"}`,
    `spend: ${input.spend === true ? "true (שידור/הוצאה אמת)" : "false (מידה/ממשל/ראיה — אינה שורפת תקציב)"}`,
    `source: ${input.source}`,
    `תקציב-שידורים-היום: ${budget.actionsToday}/${budget.cap} (actionDay ${budget.actionDay}; money=${budget.sources.money ?? "לא נענה"} · business=${budget.sources.business ?? "לא נענה"})`,
  ].join("\n");
}

function stripFences(raw: string): string {
  const t = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return (fenced ? fenced[1]! : t).trim();
}

interface JudgeRaw {
  score: unknown;
  verdict: unknown;
  reasonsHe: unknown;
}

function parseJudgeJson(raw: string): JudgeRaw | null {
  const text = stripFences(raw);
  try {
    return JSON.parse(text) as JudgeRaw;
  } catch {}
  const m = /\{[\s\S]*\}/.exec(text); // פרוזה עוטפת-JSON — ניסיון אחרון
  if (m) {
    try {
      return JSON.parse(m[0]) as JudgeRaw;
    } catch {}
  }
  return null;
}

function clampScore(score: unknown): number | null {
  const n = typeof score === "number" ? score : typeof score === "string" ? Number(score) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function bandFromScore(score: number): EconGateVerdict["verdict"] {
  if (score >= 70) return "ALLOW";
  if (score >= 40) return "REVIEW";
  return "DENY";
}

function normalizeReasons(reasonsHe: unknown, fallbackHe: string): string[] {
  if (Array.isArray(reasonsHe)) {
    const out = reasonsHe
      .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      .map((r) => r.trim().slice(0, 240))
      .slice(0, 4);
    if (out.length > 0) return out;
  }
  return [fallbackHe];
}

// ─── יומן-השער (שורה-קומפקטית לכל פסק-דין; כישלון-יומן לא מפיל שער) ──

function appendGateLog(input: EconGateInput, verdict: EconGateVerdict): void {
  try {
    const line = JSON.stringify({
      at: verdict.measuredAt,
      actionId: input.actionId,
      businessId: input.businessId ?? null,
      kind: input.kind,
      source: input.source,
      verdict: verdict.verdict,
      score: verdict.score,
      reasonsHe: verdict.reasonsHe,
      budget: verdict.budget,
      model: verdict.model,
      latencyMs: verdict.latencyMs,
    });
    fs.mkdirSync(path.dirname(GATE_LOG_PATH), { recursive: true });
    fs.appendFileSync(GATE_LOG_PATH, `${line}\n`, "utf8");
  } catch {}
}

export function readGateLog(limit = 50): Array<Record<string, unknown>> {
  try {
    const raw = fs.readFileSync(GATE_LOG_PATH, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const out: Array<Record<string, unknown>> = [];
    for (const l of lines.slice(-limit).reverse()) {
      try {
        out.push(JSON.parse(l) as Record<string, unknown>);
      } catch {
        continue; // שורה פגומה נדילגת — היומן אינו שרשרת-אמת
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ─── השער עצמו ──────────────────────────────────────────────────────

// שכבה 2 — שיפוט-LLM לפי שבעת-החוקים + חוק-הקיבולת + הדוקטרינה.
// מופרדת משכבת-התקציב בכוונה: כך ניתן למדוד את ערוץ-השיפוט בנפרד
// (probe) מבלי לעקוף את התקרה-הקשה — הפונקציה הזו אינה בודקת תקציב,
// אינה מבצעת דבר ואינה כותבת ליומן-השער; היא שופטת בלבד.
export async function judgeActionWithLlm(
  input: EconGateInput,
  budget: BudgetState,
  measuredAt: string,
  t0: number,
): Promise<EconGateVerdict> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const laws = readLaws();
    const zai = await getZai();
    const completion = await Promise.race([
      zai.chat.completions.create({
        messages: [
          { role: "system", content: buildSystemPrompt(laws) },
          { role: "user", content: buildUserPrompt(input, budget) },
        ],
        thinking: { type: "disabled" },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("שער-הכלכלה: שיפוט-חריגה מ-15ש'")), GATE_LLM_TIMEOUT_MS);
      }),
    ]);
    const raw: string = completion?.choices?.[0]?.message?.content ?? "";
    const model =
      typeof completion?.model === "string" && completion.model ? completion.model : "z-ai-web-dev-sdk/chat-default";

    const parsed = raw.trim() ? parseJudgeJson(raw) : null;
    if (!parsed) {
      // פענוח-כישלון ⇒ REVIEW כן — לא המצאה, לא דחייה-סמויה
      const verdict: EconGateVerdict = {
        verdict: "REVIEW",
        reasonsHe: ["פענוח-השיפוט נכשל — נדרשת עין אנושית/סוכנית"],
        score: 50,
        budget: { actionDay: budget.actionDay, actionsToday: budget.actionsToday, cap: budget.cap },
        measuredAt,
        latencyMs: Date.now() - t0,
        model,
      };
      return verdict;
    }

    const score = clampScore(parsed.score) ?? 50; // ציון-חסר/פסול ⇒ אמצע-חגורת-REVIEW, כנה
    const verdict = bandFromScore(score);
    const reasonsHe = normalizeReasons(parsed.reasonsHe, "השופט לא סיפק נימוקים — נדרשת עין אנושית/סוכנית");
    // כנות: החגורה הדטרמיניסטית קובעת; אם השופט הציע אחרת — הפער נרשם, לא נבלע
    if (typeof parsed.verdict === "string" && parsed.verdict.trim() && parsed.verdict.trim() !== verdict) {
      reasonsHe.push(
        `חוסר-התאמה נרשם: השופט הציע ${parsed.verdict.trim()} אך חגורת-הציון (${score}) קובעת ${verdict}`,
      );
    }

    const out: EconGateVerdict = {
      verdict,
      reasonsHe,
      score,
      budget: { actionDay: budget.actionDay, actionsToday: budget.actionsToday, cap: budget.cap },
      measuredAt,
      latencyMs: Date.now() - t0,
      model,
    };
    return out;
  } catch (e) {
    // כישלון-שיפוט (פסק-זמן/שגיאה) ⇒ REVIEW כן — השער לא מאשר בשתיקה
    const verdict: EconGateVerdict = {
      verdict: "REVIEW",
      reasonsHe: [
        `השיפוט לא ענה: ${(e instanceof Error ? e.message : "שגיאת-שיפוט").slice(0, 200)} — נדרשת עין אנושית/סוכנית`,
      ],
      score: 50,
      budget: { actionDay: budget.actionDay, actionsToday: budget.actionsToday, cap: budget.cap },
      measuredAt,
      latencyMs: Date.now() - t0,
      model: "unreached-judge",
    };
    return verdict;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// השער המלא: תקציב (דטרמיניסטי, גובר-על-הכל) → שיפוט-LLM → יומן-שער.
export async function runEconGate(input: EconGateInput): Promise<EconGateVerdict> {
  const t0 = Date.now();
  const budget = measureBudget();
  const measuredAt = new Date().toISOString();

  // שכבה 1 — התקרה-הקשה: דטרמיניסטית, אפס LLM, גוברת על הכל — אך רק על
  // פעולות-הוצאה אמת (spend=true). מחזורי-מידה/ממשל (spend≠true) אינם
  // שורפים תקציב ולכן אינם נחסמים בו — הלולאה ממשיכה לפעום ביום-מלא.
  // דחייה לפני-שידור לא שורפת תקציב ולא שורפת קריאת-שיפוט (D-r147-ECO).
  if (input.spend === true && budget.actionsToday >= budget.cap) {
    const verdict: EconGateVerdict = {
      verdict: "DENY",
      reasonsHe: [
        `תקציב-יומי מוקצה: ${budget.actionsToday}/${budget.cap} (actionDay ${budget.actionDay}) — התקרה-הקשה של כל העסקים יחד; הפעולה לא בוצעת והדחייה לא שורפת תקציב`,
      ],
      score: 0,
      budget: { actionDay: budget.actionDay, actionsToday: budget.actionsToday, cap: budget.cap },
      measuredAt,
      latencyMs: Date.now() - t0,
      model: "deterministic-budget-cap",
    };
    appendGateLog(input, verdict);
    return verdict;
  }

  // שכבה 2 — שיפוט-LLM, ואז רישום פסק-הדין ביומן-השער (שורה-אחת, קומפקטית)
  const out = await judgeActionWithLlm(input, budget, measuredAt, t0);
  appendGateLog(input, out);
  return out;
}
