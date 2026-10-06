// ─────────────────────────────────────────────────────────────────────
// GOVERNANCE-BRAIN · המוח המהלך של לולאת-ההחלטות (r143-d)
//
// השורש שנמדד: הלולאה קראה למוח דרך POST /api/weave/brain (מאגר NIM) —
// והנתיב הזה נעול fail-closed ("מפתח הרשת אינו זמין", db.networkKey חסר
// devKeyHex) ⇒ כל החלטה עד r143 נבחרה ברוטציה דטרמיניסטית (brainUsed=false).
//
// התיקון: קריאת chat-completion ישירה מהשרת דרך z-ai-web-dev-sdk —
// אותו דפוס מדויק של src/lib/agent-browser/zai.ts (סינגלטון ZAI.create,
// thinking disabled, קריאת choices[0].message.content). ה-SDK רץ בצד
// השרת בלבד (nodejs runtime) — מעולם לא בקליינט.
//
// חוקי-ברזל (D-OP-01 · fail-closed):
//   · תשובה שאינה JSON תקין ⇒ null. chosen שאינו תואם בדיוק פעולה-מותרת
//     אחת (השוואה מדויקת; מעבר-שני עם trim בלבד) ⇒ null.
//   · 30 שניות חסם-קשה (Promise.race; ל-SDK אין signal).
//   · כל שגיאה ⇒ null — הרוטציה הדטרמיניסטית מחליטה; הלולאה לא ממתינה.
//   · אפס סודות: כאן לא נרשם דבר על המפתח — מונים וסיבת-כישלון בלבד.
// ─────────────────────────────────────────────────────────────────────

import ZAI from "z-ai-web-dev-sdk";

// ── סינגלטון ZAI — דפוס זהה ל-zai.ts ───────────────────────────────

let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null;

function getZai(): Promise<Awaited<ReturnType<typeof ZAI.create>>> {
  if (!zaiPromise) {
    zaiPromise = ZAI.create();
  }
  return zaiPromise;
}

// ── מוני-אמת (זיכרון-מקומי; איפוס בהפעלה — כמו channelStats ב-zai.ts) ──

export interface GovernanceBrainStats {
  calls: number;
  ok: number;
  parseFail: number;
  outOfList: number;
  timeouts: number;
  errors: number;
  lastError: string | null;
  lastTookMs: number | null;
  lastAt: string | null;
}

const stats: GovernanceBrainStats = {
  calls: 0,
  ok: 0,
  parseFail: 0,
  outOfList: 0,
  timeouts: 0,
  errors: 0,
  lastError: null,
  lastTookMs: null,
  lastAt: null,
};

export function governanceBrainStats(): GovernanceBrainStats {
  return { ...stats };
}

// ── הפרומפט החוקי (נוסח קבוע) ───────────────────────────────────────

const BRAIN_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT =
  "אתה מוח-ההחלטות של רשת ריבונית אוטונומית. המפעיל אישר מראש הכל (D-OP-01). " +
  "החוק: בחר בדיוק פעולה אחת מרשימת-הפעולות-המותרות, לפי המדידות וההקשר. " +
  "אסור לבחור פעולה שאינה ברשימה. אסור להמציא מדידות. " +
  'ענה JSON בלבד: {"chosen": "<פעולה מהרשימה>", "why": "משפט-אחת המבוסס על המדידות"}';

export interface GovernanceBrainInput {
  allowed: string[];
  context: string;
  protocolSummary: string;
}

export interface GovernanceBrainChoice {
  chosen: string;
  why: string;
}

function stripFences(raw: string): string {
  const t = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return (fenced ? fenced[1]! : t).trim();
}

function parseBrainJson(raw: string): { chosen: unknown; why: unknown } | null {
  const text = stripFences(raw);
  try {
    return JSON.parse(text) as { chosen: unknown; why: unknown };
  } catch {}
  const m = /\{[\s\S]*\}/.exec(text); // פרוזה עוטפת-JSON — ניסיון אחרון
  if (m) {
    try {
      return JSON.parse(m[0]) as { chosen: unknown; why: unknown };
    } catch {}
  }
  return null;
}

/**
 * שואל את המוח לבחור פעולה אחת מתוך allowedActions.
 * מחזיר {chosen, why} רק אם chosen תואם בדיוק פעולה-מותרת אחת; אחרת null.
 * אין יוצאים מן הכלל: כישלון כלשהו ⇒ null (הקורא נופל לרוטציה הדטרמיניסטית).
 */
export async function callGovernanceBrain(input: GovernanceBrainInput): Promise<GovernanceBrainChoice | null> {
  if (!input || !Array.isArray(input.allowed) || input.allowed.length === 0) return null;
  const allowed = input.allowed.map((a) => String(a));

  const user =
    `${input.protocolSummary.trim()}\n\n` +
    `פעולות-מותרות (בחר אחת בדיוק — העתק את הנוסח המלא לשדה chosen):\n` +
    `${allowed.map((a, i) => `${i + 1}. ${a}`).join("\n")}\n\n` +
    `מדידות-חיות:\n${input.context.trim()}\n\n` +
    `ענה JSON בלבד, בלי טקסט מסביב.`;

  const t0 = Date.now();
  stats.calls += 1;
  stats.lastAt = new Date().toISOString();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const zai = await getZai();
    const completion = await Promise.race([
      zai.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        thinking: { type: "disabled" },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("governance-brain timeout (30s)")), BRAIN_TIMEOUT_MS);
      }),
    ]);
    const raw: string = completion?.choices?.[0]?.message?.content ?? "";
    const parsed = raw.trim() ? parseBrainJson(raw) : null;
    if (!parsed || typeof parsed.chosen !== "string") {
      stats.parseFail += 1;
      stats.lastError = "parse-fail: תשובת-המוח אינה JSON תקין עם chosen";
      return null;
    }
    const chosenRaw = parsed.chosen;
    // השוואה מדויקת מול הרשימה; מעבר-שני: trim בלבד; כל-שאר ⇒ null
    const exact = allowed.find((a) => a === chosenRaw);
    const trimmed = exact ?? allowed.find((a) => a === chosenRaw.trim());
    if (!trimmed) {
      stats.outOfList += 1;
      stats.lastError = "out-of-list: chosen אינו תואם בדיוק אף פעולה-מותרת";
      return null;
    }
    const why = typeof parsed.why === "string" ? parsed.why.trim().slice(0, 400) : "";
    stats.ok += 1;
    stats.lastError = null;
    stats.lastTookMs = Date.now() - t0;
    return { chosen: trimmed, why: why || "המוח בחר מבלי לספק נימוק" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("timeout")) stats.timeouts += 1;
    else stats.errors += 1;
    stats.lastError = `error: ${msg.slice(0, 200)}`;
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
