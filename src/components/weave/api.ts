// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Frontend API layer - fetch יחסי בלבד, שגיאות בעברית
// כל התשובות מהשרת: { ok: true, ... } או { ok: false, error }
// ─────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// ── מנקה טקסט נראה: אפס אימוג׳י, אפס סממני AI (מקף ארוך, חצים, וי/איקס) ──
// מדיניות המפעיל: הדף נקי מגליפים. כל טקסט שמגיע מהשרת (נתוני ענן,
// אימותים, הודעות) עובר כאן בכניסה - נקודת חנק אחת לכל הדינמי.

const GLYPH_MAP: Record<string, string> = {
  "\u2014": " - ", // em-dash
  "\u2013": "-", // en-dash
  "\u2015": "-", // horizontal bar
  "\u2212": "-", // minus sign
  "\u2192": "->", // rightwards arrow
  "\u21D2": "=>", // double rightwards arrow
  "\u2190": "<-", // leftwards arrow
  "\u21D0": "<=", // double leftwards arrow
  "\u2194": "-", // left-right arrow
  "\u21D4": "-", // left-right double arrow
  "\u21B3": "->", // downwards arrow with tip rightwards
  "\u2197": "", // north east arrow
  "\u2198": "", // south east arrow
};

const GLYPH_STRIP =
  /[\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D\u20E3\u2190-\u21FF\u2014\u2013\u2015\u{1F000}-\u{1FAFF}]/gu;

export function cleanGlyphs(input: string): string {
  if (!input) return input;
  let out = input;
  for (const [glyph, replacement] of Object.entries(GLYPH_MAP)) {
    out = out.split(glyph).join(replacement);
  }
  out = out.replace(GLYPH_STRIP, "");
  // ניקוי ריווח כפול שנותר אחרי החלפות/מחיקות בלבד
  out = out.replace(/[ \t]{2,}/g, " ");
  return out.trim();
}

function sanitizeDeep<T>(value: T): T {
  if (typeof value === "string") return cleanGlyphs(value) as unknown as T;
  if (Array.isArray(value)) return value.map(sanitizeDeep) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeDeep(v);
    }
    return out as T;
  }
  return value;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("לא ניתן להתחבר לשרת - בדוק את החיבור ונסה שוב", 0);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const body = payload as { ok?: boolean; error?: string } | null;
  if (!response.ok || !body || body.ok !== true) {
    const rawError =
      body?.error && body.error.trim().length > 0
        ? cleanGlyphs(body.error)
        : `שגיאת שרת (${response.status})`;
    throw new ApiError(rawError, response.status);
  }
  return sanitizeDeep(payload as T);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "אירעה שגיאה לא צפויה";
}
