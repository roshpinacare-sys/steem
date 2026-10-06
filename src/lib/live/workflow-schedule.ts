// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Workflow schedule — קדנס מה-YAML בפועל, לא מהזיכרון.
//
// חוק הקדנס (r121): כל טענת "מתי זה רץ" נגזרת מקובץ ה-workflow עצמו
// (בלוק ה-on: cron / workflow_dispatch) — או שהיא לא נטענת כלל. שלוש
// שורות-סטטוס שיקרו עד r121 ("כל 6 שעות", "יומי 07:17Z", "כל 6 שעות
// :30") בזמן שה-cron הוסר — המציאות חיה בקבצים עצמם.
//
// r122: המנתח עלה לכאן מ-/api/weave/sovereignty כדי לשרת גם את
// דלת-חימום הגריד — מקור אחד, שני צרכנים. נוספה גם שליפת-ענן:
// workflow של ריפו פרטי נקרא דרך ה-API של גיטהאב (עם האסמכתה
// מ-.git/config). כשל-שליפה = null — בלי טענת-זיכרון.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { getGhToken } from "@/lib/live/cloud";

const ROOT = path.resolve(process.cwd());

/** תיאור בלוק ה-on של YAML של workflow — cron ו-workflow_dispatch כפי שהם. */
export function cronSectionDesc(text: string, twinNote?: string): string | null {
  const onIdx = text.search(/^on:\s*$/m);
  if (onIdx < 0) return "ללא בלוק-on";
  const body = text.slice(onIdx);
  const section = body.split(/^[a-zA-Z_][a-zA-Z0-9_-]*:/m)[0];
  const crons = [...section.matchAll(/cron:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const hasDispatch = /workflow_dispatch\s*:/.test(section);
  const parts: string[] = [];
  if (crons.length > 0) parts.push(`schedule ${crons.map((c) => `‘${c}’`).join(" + ")}`);
  if (hasDispatch) parts.push(crons.length > 0 ? "+ workflow_dispatch" : "workflow_dispatch בלבד");
  if (twinNote) parts.push(twinNote);
  return parts.join(" · ") || null;
}

/** r121 — קדנס מקובץ workflow מקומי בריפו זה (.github/workflows/&lt;file&gt;). */
export function workflowScheduleDesc(file: string, twinNote?: string): string | null {
  const p = path.join(ROOT, ".github", "workflows", file);
  if (!fs.existsSync(p)) return null;
  return cronSectionDesc(fs.readFileSync(p, "utf8"), twinNote);
}

/** r122 — קדנס מריפו בענן: שולף את ה-workflow דרך ה-API של גיטהאב
 *  ומתאר את בלוק ה-on כפי שהוא בפועל שם. כשל/אין-קובץ = null. */
export async function remoteWorkflowScheduleDesc(
  repo: string,
  file: string,
  owner = "roshpinacare-sys",
): Promise<string | null> {
  const token = await getGhToken();
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/.github/workflows/${file}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "the-weave-live/1.0",
        ...(token ? { Authorization: `token ${token}` } : {}),
      },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { content?: string; encoding?: string };
    if (j?.encoding !== "base64" || typeof j.content !== "string") return null;
    const text = Buffer.from(j.content, "base64").toString("utf8");
    return cronSectionDesc(text);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
