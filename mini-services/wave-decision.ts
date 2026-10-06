// ─────────────────────────────────────────────────────────────────────
// WAVE-DECISION — גבול-ההחלטה של גל-הדלק (R208, trace 1a10d7a051e822d1)
//
// חילוץ-טהור של ענף-הגל מ-decide() של המוביל (r103/r111) לפונקציה
// מכונה-ניתנת-לבדיקה בבידוד. זהו גבול-ההחלטה שאליו נצרך מודל-המטרות:
//
//   sensor (measure) → state → objective/resource view → waveDecision → act/refusal
//
// חוקי-הפרדה (R208 §V):
//   · objective → preference  (המודל משפיע על העדפה — רק מדכא, לעולם לא כופה)
//   · authority → permission  (הסמכות נשארת בשער-האוטונומיה + tx-gate בלבד)
//   · אם המודל מציע פעולה שהסמכות אוסרת: BLOCKED_BY_AUTHORITY — ולא AUTHORITY=GRANTED.
//
// כיוון-הכוח חד-כיווני-שמרני (I3): התצוגה יכולה רק לדכא פעולה ל-WAIT —
// היעדר-דיכוי אינו "המודל מעניק אישור" אלא "חוק-הבסיס פועל".
// ─────────────────────────────────────────────────────────────────────

import type { ObjectiveView } from "./objective-consumer";

export interface WaveDecisionInput {
  now: string; // ISO
  today: string; // utcDay
  measCredible: boolean;
  waveDelta: number; // STEEM — עליית-הון-כולל מול המדידה הקודמת
  idleNow: number; // STEEM — נזיל עכשיו
  totalSteemNow: number; // STEEM
  lastStreamDay: string | null;
  waveSteem: number; // POLICY.liquidityStream.waveSteem (200)
  share: number; // POLICY.liquidityStream.share (0.2)
  prefDown: { seq: number; expiresAt: string; evidenceBooks: string[]; confidence: string } | null;
  view: ObjectiveView | null; // תצוגת-המודל (rejection ⇒ null + rejectReason בנפרד)
  viewRejectReason?: string | null;
  fillTag?: "fill-deploy";
}

export type WaveDecision =
  | { kind: "NO-WAVE"; reason: string }
  | { kind: "WAIT-PREFERENCE"; reason: string }
  | { kind: "WAIT-MODEL"; reason: string }
  | { kind: "WAIT-SAFETY"; reason: string }
  | { kind: "BLOCKED_BY_AUTHORITY"; reason: string }
  | { kind: "ACT"; action: "arena-stream"; reason: string; tag?: "fill-deploy"; opportunityCost: OpportunityCostNote };

export interface OpportunityCostNote {
  actionA: string; // הפעולה הנשקלת
  actionB: string; // האלטרנטיבה הטובה-ביותר שנזנחת
  foregone: string; // מה נזנח (עלות-הזדמנות מהמודל — אסמכתא)
  learningValue: string;
  risk: string;
  ordinal: "HIGHER" | "LOWER" | "UNKNOWN"; // העדפה-סדרתית בלבד — אין המצאת-דולר
  source: string; // אסמכתא למודל
}

/**
 * ענף-הגל בלבד. החוזר NO-WAVE פירושו "הגבול לא נחצה" — הקורא (decide)
 * ממשיך לענפים הבאים בדיוק כמו-קודם. כל שאר-הסוגים הם הכרעות-גבול.
 */
export function waveDecision(inp: WaveDecisionInput): WaveDecision {
  // 1) סף-הגל (R111 — חתימת-הון-כולל): בלי גל אמיתי אין הכרעה בגבול זה.
  if (
    !inp.measCredible ||
    inp.waveDelta < inp.waveSteem ||
    inp.idleNow < inp.waveSteem ||
    inp.lastStreamDay === inp.today
  ) {
    return { kind: "NO-WAVE", reason: "אין גל-דלק מדיד (הגבול לא נחצה)" };
  }

  // 2) סמכות נבדקת בנפרד מהעדפה (§V): אם מפת-הסמכות אוסרת על תחום-ההזרמה —
  //    ההכרעה BLOCKED_BY_AUTHORITY. העדפה לא יכולה להתגבר על סמכות, וסמכות
  //    לא נובעת מהמודל — היא נקראת ממנו בלבד (המודל מתאר, השער אוכף).
  if (inp.view?.authorityStatus?.forbidden === true) {
    return {
      kind: "BLOCKED_BY_AUTHORITY",
      reason: `WAIT-BLOCKED-AUTHORITY · BLOCKED_BY_AUTHORITY · גל-דלק נמדד אך מפת-הסמכות (${inp.view.authorityStatus.domain}) אוסרת: ${inp.view.authorityStatus.basis} · ההעדפה אינה יכולה להעניק היתר (§V)`,
    };
  }

  // 3) דיכוי-עדיפות נלמד (r207 · I3): העדפה הפוכה רק מצמצמת — WAIT.
  if (inp.prefDown) {
    return {
      kind: "WAIT-PREFERENCE",
      reason: `WAIT-PREFERENCE · גל-דלק נמדד אך הזרעה-לבריכות דכויה בהעדפה-נלמדת grid-pool-seed DOWN (seq ${inp.prefDown.seq} · ראיות: ${inp.prefDown.evidenceBooks.join(", ")}) · פוגה ${inp.prefDown.expiresAt} · הדלק נשאר נזיל`,
    };
  }

  // 4) דיכוי-מודל (r208 — צריכה-חוזית של מודל-המטרות עצמו): כשהמודל
  //    תקף-ואומת ופסק-הדין-הסדרתי שלו לזריעה הוא NOT-QUALIFIED-NOW
  //    (צד-SBD בלתי-ממומן — אסמכתא: options.json#unitErrorCorrection),
  //    המודל עצמו מדכא — בלי תלות בדגל-העדפה. זו הצריכה-הקוגניטיבית:
  //    שינוי-המודל (משאב נעשה זמין) משנה את ההחלטה.
  if (inp.view && inp.view.priority.verdictForSeed === "NOT-QUALIFIED-NOW") {
    return {
      kind: "WAIT-MODEL",
      reason: `WAIT-MODEL · גל-דלק נמדד אך מודל-המטרות (${inp.view.objectiveId} · epistemic=${inp.view.epistemicStatus}) פוסק NOT-QUALIFIED-NOW: ${inp.view.resourceRequirement.status} — ${inp.view.resourceRequirement.why} · עלות-הזדמנות: ${inp.view.opportunityCost.foregone}`,
    };
  }

  // 5) סתירה לא-פתורה (§XIII): כשהתצוגה נדחית (מודל פגום/ישן/טמפר) ואין
  //    עדפה — אין להמציא סדר-עדיפויות; ברירת-המחדל-הבטוחה היא דיכוי
  //    (I3: חד-כיווני-שמרני). זה ABSTAIN-מקומי: לא פועלים על גבול
  //    מוסדר-מודל בלי מודל-תקף.
  if (inp.viewRejectReason) {
    return {
      kind: "WAIT-SAFETY",
      reason: `WAIT-SAFETY · גל-דלק נמדד אך תצוגת-המודל נדחית (${inp.viewRejectReason}) ואין העדפה-פעילה — ברירת-מחדל-בטוחה: אין זריעה על גבול-מודל בלי מודל-תקף (§XIII: אין ממציאים עדיפות)`,
    };
  }

  // 6) חוק-הבסיס (r103): גל אמיתי + אין דיכוי → הזרמה. המודל "לא דיכא"
  //    אינו "המודל העניק" — ההיתר מגיע מהשער (gateFleetAction/tx-gate).
  return {
    kind: "ACT",
    action: "arena-stream",
    reason: `גל דלק אמיתי: ההון-הכולל עלה ${inp.waveDelta.toFixed(3)} STEEM מעל המדידה הקודמת (${inp.totalSteemNow.toFixed(3)} סך · נזיל ${inp.idleNow.toFixed(0)}) — ${Math.round(inp.share * 100)}% הופכים לעומק בבריכות הזירה לפני פריסת הסולם${inp.view ? ` · תצוגת-מודל: ${inp.view.objectiveId} epistemic=${inp.view.epistemicStatus} seedVerdict=${inp.view.priority.verdictForSeed}` : ""}`,
    tag: inp.fillTag,
    opportunityCost: inp.view?.opportunityCost ?? {
      actionA: "זריעת 20% מהגל לעומק-בריכות (חוק r103)",
      actionB: "החזקת-רזרבה עד 11/10 והכרעה-במידע-מלא (options.json#B)",
      foregone: "UNKNOWN — אין תצוגת-מודל לעלות-הזדמנות",
      learningValue: "UNKNOWN",
      risk: "UNKNOWN",
      ordinal: "UNKNOWN",
      source: "אין-אסמכתא (חוק-בסיס בלבד)",
    },
  };
}
