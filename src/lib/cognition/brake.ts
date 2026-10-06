// ─────────────────────────────────────────────────────────────────────
// BRAKE — הבלם-הריבוני של ערימת-הכסף (R30 · trace 1a10d6f880df9255)
//
// R29 מדד ומצא (הקלטה: cognition/R29-SOVEREIGN-BOUNDARY.md): ערימת-הכסף
// חותמת פעולות-הון בלי לצרוך שום-בלם של האורגניזם (STASIS / lane-guards /
// self-model) — BOUNDARY_ESCAPE=TRUE, הוכח חי שוב 18:41:15-45Z. R30 סוגר
// את-המקור: כל-נתיב-חתימה בערימה זו שואל קודם-הכל את הבלם.
//
// החוזה (זהה לבלם של saos-dex grids/brake.mjs · ef59aeb):
//   · הבלם קורא sovereign/cognition/STASIS.json (SAOS-FATE-DEFENSE-STASIS/1)
//     ו-sovereign/cognition/lane-guards.json (SAOS-LANE-GUARDS/1 — הסורגים
//     שנולדים ב-cognition-beat של steem ומסונכרנים אליו cross-home).
//   · הסורגים יכולים רק לסגור מסילות — לעולם לא לפתוח. שדות open/allow
//     זרים נזנחים-ומדווחים. תפוגה (expiresAt בעבר) = סורג-מת.
//   · fail-closed: קובץ-פגום / פרוטוקול-זר = עצירה-בטוחה, לעולם לא ההפך.
//     קובץ-STASIS חסר = ניטרלי-ומדווח (stasis-absent — הבעלים מחליט מתי
//     ערימת-הכסף נכנסת תחת חוק-ה-STASIS המלא; הסורגים חיים גם-בלעדיו).
//   · אפס-סודות: הבלם קורא קבצי-מדיניות בלבד. הוא לעולם לא נוגע במפתח,
//     בכספת, או במדיניות-ההון עצמה — הוא רק יכול לעצור.
//
// הערת-אמת (R30 §13-14): הבלם חי בקוד-המקור. הפעלתו בזמן-ריצה דורשת
// הצבה/הפעלה-מחדש של הערימה החיה — יכולת של הבעלים בלבד (OWNER-ONLY).
// עד-אז BOUNDARY_ESCAPE נשאר TRUE וה-self-model לא מכריז סגירה.
// ─────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function repoRoot(): string {
  // עץ-הריפו: המודול חי ב-src/lib/cognition → השורש שלושה-מעלה.
  // override-בדיקות: SAOS_COGNITION_DIR (fixtures מבודדים בלבד).
  if (process.env.SAOS_COGNITION_DIR) return process.env.SAOS_COGNITION_DIR;
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      if (existsSync(join(dir, "package.json"))) return dir;
      dir = dirname(dir);
    }
  } catch (_) {
    /* fallthrough */
  }
  return "/home/z/my-project"; // פריסת-המפעל — החוזה של כל-הערימה
}

export const STASIS_PATH = () => join(repoRoot(), "sovereign", "cognition", "STASIS.json");
export const GUARDS_PATH = () => join(repoRoot(), "sovereign", "cognition", "lane-guards.json");

export type BrakeVerdict = {
  halt: boolean;
  lane: string;
  reasons: string[];
  foreignFields: string[];
  stasisAbsent: boolean;
  guardsAbsent: boolean;
};

/** קריאת STASIS — חסר=ניטרלי-מדווח; פגום/פרוטוקול-זר=fail-closed. */
export function stasisState(): { mode: "absent" | "full" | "staged" | "fail-closed"; reason: string; stagedAllow?: string[] } {
  const p = STASIS_PATH();
  if (!existsSync(p)) return { mode: "absent", reason: `stasis file absent at ${p} — neutral-with-flag (owner decision pending)` };
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (j.protocol !== "SAOS-FATE-DEFENSE-STASIS/1") return { mode: "fail-closed", reason: `unknown stasis protocol '${String(j.protocol)}' — fail-closed` };
    if (j.active !== true) return { mode: "absent", reason: `stasis active=${String(j.active)} — neutral (brake law not engaged)` };
    if (j.mode === "staged") {
      const allow = Array.isArray(j.stagedLanes?.allow) ? j.stagedLanes.allow.map((x: unknown) => String(x).toLowerCase()) : [];
      return { mode: "staged", reason: `stasis staged — lanes allow=[${allow.join(",")}]`, stagedAllow: allow };
    }
    return { mode: "full", reason: `stasis active (full) — ${String(j.reason ?? "").slice(0, 120)}` };
  } catch (e) {
    return { mode: "fail-closed", reason: `stasis file unreadable at ${p}: ${String((e as Error)?.message ?? e).slice(0, 80)} — fail-closed` };
  }
}

/** קריאת הסורגים — חסר=רגיל; פגום/פרוטוקול-זר=fail-closed לכל-המסילות. */
export function readGuards(): { missing: boolean; unreadable?: boolean; reason?: string; guards: Array<{ id: string; lane: string; reason: string }>; foreignFields: string[] } {
  const p = GUARDS_PATH();
  if (!existsSync(p)) return { missing: true, guards: [], foreignFields: [] };
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (j.protocol !== "SAOS-LANE-GUARDS/1") return { missing: false, unreadable: true, reason: `unknown guards protocol '${String(j.protocol)}' — fail-closed`, guards: [], foreignFields: [] };
    const all = Array.isArray(j.guards) ? j.guards : [];
    const foreignFields = all.filter((g: any) => g && (g.closed === false || "open" in g || "allow" in g)).map((g: any) => String(g?.id ?? "?"));
    const now = Date.now();
    const active = all
      .filter((g: any) => g && g.closed === true && (!g.expiresAt || new Date(g.expiresAt).getTime() > now))
      .map((g: any) => ({ id: String(g.id ?? "?"), lane: String(g.lane ?? "").toLowerCase(), reason: String(g.reason ?? "").slice(0, 160) }));
    return { missing: false, guards: active, foreignFields };
  } catch (_) {
    return { missing: false, unreadable: true, reason: "guards file unreadable — fail-closed", guards: [], foreignFields: [] };
  }
}

/** מסילת-הכלי — laneOf(tool): money-mover/hive-grid/market-maker=grid · claim=claims · זר=general (fail-closed). */
export function laneOf(tool: string): "grid" | "claims" | "general" {
  const t = String(tool ?? "").trim().toLowerCase();
  if (t === "money-mover" || t === "money-hive" || t === "market-maker") return "grid";
  if (t === "money-claim") return "claims";
  return "general";
}

/**
 * evaluateBrake(tool|lane) — השאלה היחידה: האם נתיב-החתימה רשאי להמשיך?
 * מוחזר verdict כנה; הקורא חייב לסרב (אפס-שידור) כש-halt=true.
 */
export function evaluateBrake(toolOrLane: string): BrakeVerdict {
  const lane = ["grid", "claims", "general"].includes(String(toolOrLane).toLowerCase())
    ? String(toolOrLane).toLowerCase()
    : laneOf(toolOrLane);
  const reasons: string[] = [];
  const foreignAll: string[] = [];
  let halt = false;

  const st = stasisState();
  if (st.mode === "fail-closed") { halt = true; reasons.push(`STASIS-BRAKE: ${st.reason}`); }
  else if (st.mode === "full") { halt = true; reasons.push(`STASIS-BRAKE: ${st.reason}`); }
  else if (st.mode === "staged") {
    if (!st.stagedAllow!.includes(lane)) { halt = true; reasons.push(`STASIS-STAGED-HALT lane '${lane}' not in allow=[${st.stagedAllow!.join(",")}]`); }
  }
  const stasisAbsent = st.mode === "absent";
  if (stasisAbsent) reasons.push(`note: ${st.reason}`);

  const g = readGuards();
  if (g.unreadable) { halt = true; reasons.push(`LANE-GUARD-HALT: ${g.reason}`); }
  else {
    foreignAll.push(...g.foreignFields);
    const hit = g.guards.find((x) => x.lane === lane);
    if (hit) { halt = true; reasons.push(`LANE-GUARD-HALT ${lane} · guard=${hit.id} · reason: ${hit.reason}`); }
  }
  if (g.missing) reasons.push("note: lane-guards file absent — no guard state synced yet");

  return { halt, lane, reasons, foreignFields: foreignAll, stasisAbsent, guardsAbsent: g.missing };
}

/** הצהרה-כנה ליומן — כל-קריאה משאירה שורה (גם-ALLOW). */
export function brakeLogLine(v: BrakeVerdict): string {
  return `[CAPITAL-BRAKE] ${v.halt ? "HALT" : "ALLOW"} lane=${v.lane} · ${v.reasons.join(" · ")}`;
}
