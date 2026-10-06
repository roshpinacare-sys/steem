// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Atomic FS — כתיבה-אטומית (חוק R107b) · r147-d
//
// ביקורת-הגוף (one-bloc audit) מדדה ~12 עותקים של אותן 3 שורות
// (mkdir → write ל-.tmp → rename) פזורים ברחבי src/lib. מעכשיו: מימוש
// אחד כאן. עץ-התיקייה נוצר במידת-הצורך; רגע-מוות באמצע כתיבה לא
// משאיר ליורש קובץ חצוי. (מקביל בצד-הדיבונים: mini-services/shared.ts)
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

export function writeTextAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

export function writeJsonAtomic(file: string, data: unknown, space: number = 2): void {
  writeTextAtomic(file, JSON.stringify(data, null, space));
}

export function writeBytesAtomic(file: string, bytes: Buffer | Uint8Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
}
