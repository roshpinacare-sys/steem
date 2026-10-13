/**
 * R270 · THE OPERATOR'S-WINDOW DASH LAW (operator order, verbatim intent):
 * "אני לא אוהב ולא מרשה שימוש ב — ... לא בכותרת לא בתוכן עצמו".
 * Every string the cockpit renders must be free of em/en dashes, including
 * strings that ORIGINATE in engine state files (role descriptions, lessons,
 * verdicts) written before this law existed. This normalizer is applied at
 * the API response boundary so the operator never sees one, and future
 * engine writes cannot leak through the window either.
 *
 * Replacements (Hebrew-safe, meaning-preserving):
 *   " — " / " – "  → ": "   (the clause-introducing dash reads as a colon)
 *   "—" / "–"      → "-"    (any residual decorative dash becomes a plain hyphen)
 */
export function cleanDashText(s: string): string {
  return String(s).replace(/[ \t]*[—–][ \t]*/g, (m) => (m.includes(" ") || m.includes("\t") ? ": " : "-"));
}

export function deDashDeep<T>(v: T): T {
  if (typeof v === "string") return cleanDashText(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => deDashDeep(x)) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = deDashDeep(val);
    return out as unknown as T;
  }
  return v;
}
