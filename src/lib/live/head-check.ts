// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Head-check — בדיקת-HEAD חיה של דף ציבורי.
//
// R122: טענת "LIVE" על דף-ענן אינה זיכרון — הדף עצמו נשאל. משותף
// לצייד (/api/hunter) ולמפרסם (/api/publish) — מקור אחד, שני צרכנים.
// כשל-רשת = live:false כנה, לא השערה.
// ─────────────────────────────────────────────────────────────────────

export async function headOk(
  url: string,
  timeoutMs = 6000,
): Promise<{ live: boolean; httpStatus: number | null }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "HEAD", signal: ctl.signal, cache: "no-store" });
    return { live: res.ok, httpStatus: res.status };
  } catch {
    return { live: false, httpStatus: null };
  } finally {
    clearTimeout(t);
  }
}
