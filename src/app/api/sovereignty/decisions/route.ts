// ─────────────────────────────────────────────────────────────────────
// /api/sovereignty/decisions — החלטת הריבונות, העדה החיה (D-018).
//
// קורא את הקנון מהגיט (sovereign/sovereignty/decisions.json) ומחזיר
// אותו עם טביעת-אצבע של המסמך הקריא (sha256 של SOVEREIGNTY-DECISIONS.md)
// — כך כל קורא יכול לאמת שהתצוגה תואמת את הקנון החתום בגיט, באותו
// עיקרון של הספר: אימות הוא חישוב-מחדש, לא אמון.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Decision {
  id: string;
  date: string;
  titleHe: string;
  lawHe: string;
  evidence: string;
  status: string; // ACTIVE | OPEN-OPERATOR | SUPERSEDED
}

interface DecisionsDoc {
  format: string;
  doc: string;
  updatedAt: string;
  noteHe: string;
  decisions: Decision[];
}

export async function GET() {
  const jsonPath = path.join(process.cwd(), "sovereign", "sovereignty", "decisions.json");
  const mdPath = path.join(process.cwd(), "SOVEREIGNTY-DECISIONS.md");

  let doc: DecisionsDoc | null = null;
  let errorHe: string | null = null;
  try {
    doc = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as DecisionsDoc;
  } catch {
    errorHe = "רישום ההחלטות לא נמדד (הקובץ חסר או פגום) — זו מדידה, לא כישלון מוסתר.";
  }

  let docHash: string | null = null;
  let docBytes: number | null = null;
  try {
    const buf = fs.readFileSync(mdPath);
    docBytes = buf.length;
    docHash = crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    // המסמך הקריא לא נמדד — כנות בשדות, לא המצאה
  }

  const decisions = doc?.decisions ?? [];
  const byStatus: Record<string, number> = {};
  for (const d of decisions) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;

  return NextResponse.json(
    {
      ok: doc != null,
      at: new Date().toISOString(),
      format: doc?.format ?? null,
      updatedAt: doc?.updatedAt ?? null,
      noteHe: doc?.noteHe ?? null,
      errorHe,
      count: decisions.length,
      byStatus,
      doc: {
        name: "SOVEREIGNTY-DECISIONS.md",
        sha256: docHash,
        bytes: docBytes,
      },
      decisions,
      doctrine: [
        "כל החלטה נושאת מקור מדידה או קבלה. החלטה בלי מקור אינה נכנסת.",
        "החלטות חדשות נוספות בסוף בלבד; שום החלטה לא נערכת לאחור.",
        "החלטה שנפסלת מסומנת SUPERSEDED בכנות, לא נמחקת.",
      ],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
