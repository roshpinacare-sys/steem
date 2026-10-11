'use strict';
/* campaign-hygiene.cjs — 9-a: שער-היגיינה לפוסטי-מסע-התוכן (twin של agents/content-campaign.mjs ב-Domain).
 *
 * הבעיה שנמדדה (ביקורת 9-a, 2026-10-11): הפוסט החי @headcorner/saos-engineering-20261010
 * הדליף מטא-דאטה תפעולית על-השרשרת — שדות `Slot:`/`Layer:`, קודי-מעקב (C-3, R130),
 * נתיבי-מנוע פנימיים (agents/content-campaign.mjs), דקה-קבועה (13:10 UTC),
 * כותרת-תאריך ("SAOS Open Engineering — 2026-10-10") ו-json_metadata עם
 * app saos/content-campaign/1.0 + source agent-z content campaign (C-3, R130).
 *
 * החוק החדש (founding law — כנות-חתיכה):
 *   · חוסם: דליפות-תפעול (slot/layer/קודי-מעקב/נתיבי-ריפו/דקה-קבועה) בכותרת, בגוף או ב-json_metadata.
 *   · חוסם: כותרת-תאריך וכותרת-מקף (זהה ל-content-v3 — אותן-תבניות).
 *   · דורש: גילוי-נאות של חתימת-מכונה — אסור להסתיר שהתוכן נכתב-בקוד (חוק-מייסד:
 *     מסירים את הפנימי-תפעולי, לעולם לא את הכנות על הכתיבה-האוטונומית).
 *   · טהור לחלוקה: אפס-רשת, אפס-סודות, אפס-I/O. נבדק ב-social-selftest.cjs.
 */

const OPS_PATTERNS = [
  ['ops-slot',      /\bslot\s*:/i],                                                   // "Slot: daily content campaign (C-3), 13:10 UTC"
  ['ops-layer',     /\blayer\s*:/i],                                                  // "Layer: cloud (GitHub Actions, Domain)"
  ['campaign-code', /\bC-\d+\b/],                                                     // C-1/C-3 — קודי-סלוט פנימיים
  ['refresh-code',  /\bR\d{2,3}\b/],                                                  // R130/R294 — קודי-סבב-מעקב
  ['engine-path',   /content-campaign\.mjs|agents\/[a-z0-9-]+\.(mjs|cjs)/i],          // נתיבי-מנוע פנימיים
  ['repo-path',     /\b(Domain|saos-dex|Console|FleetHQ|Sandbox|Zip)\//,],            // נתיבי-ריפו פנימיים ("Domain/mirror.json")
  ['agent-trace',   /\bagent-z\b/i],                                                  // חתימת-סוכן פנימית עם מטא-מעקב
  ['fixed-minute',  /\b\d{1,2}:\d{2}\s*UTC\b/i],                                      // דקה-קבועה בתוך הפוסט
  ['app-meta-leak', /saos\/content-campaign/],                                        // app-tag שחושף את שם-המסע
];

/* גילוי-הנאות המינימלי: הקורא חייב לדעת שהפוסט נכתב ונחתם על-ידי מכונה. */
const AUTHORSHIP_RE = /(autonomous agent|machine-authored|machine-written|written in code|signed by a machine|נכתב בקוד|נכתב-בקוד|סוכן אוטונומי|סוכן-אוטונומי)/i;

function lintCampaignPost({ title, body, jsonMetadata }) {
  const issues = [];
  const t = String(title || '');
  const b = String(body || '');
  let meta = jsonMetadata;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = { raw: String(meta) }; } }
  const metaText = meta ? JSON.stringify(meta) : '';

  /* חוקי-כותרת (זהים ל-content-v3 lintArticle): אין-תאריך, אין-מקף-מנדריני */
  if (!t.trim()) issues.push('title-empty');
  if (/\d{4}-\d{2}-\d{2}/.test(t) || /\b\d{8}\b/.test(t)) issues.push('title-contains-date');
  if (/ — /.test(t)) issues.push('title-em-dash');

  /* דליפות-תפעול בגוף וב-json_metadata */
  for (const [name, re] of OPS_PATTERNS) {
    if (re.test(b)) issues.push('body-' + name);
    if (re.test(metaText)) issues.push('meta-' + name);
  }

  /* חוק-הכנות: חובה גילוי-חתימת-מכונה (מוסרים פנימי-תפעולי — לא את הכתיבה-האוטונומית) */
  if (!AUTHORSHIP_RE.test(b)) issues.push('authorship-disclosure-missing');

  /* שאריות-קוד (content-v3 parity) */
  if (/undefined|NaN(?![a-z])|\$\{|\[object Object\]/.test(b)) issues.push('leaked-code-artifact');
  if (((b.match(/```/g) || []).length) % 2 === 1) issues.push('unclosed-code-fence');

  return issues;
}

module.exports = { OPS_PATTERNS, AUTHORSHIP_RE, lintCampaignPost };
