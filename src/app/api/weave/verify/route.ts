// POST /api/weave/verify — אימות מלא בחישוב מחדש (לא סמיכות):
//   1. verifyChain על כל השורות (entryHash / prevHash / רצף seq)
//   2. שחזור חתימה (ecrecover) לכל שורה מול כתובת הסוכן
//   3. חישוב מחדש של evidenceHash מול הראיה השמורה
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, readJsonBody } from "@/lib/weave/api";
import { GENESIS_HASH, hashText, verifyChain } from "@/lib/weave/chain";
import { recoverFromDigestEip191 } from "@/lib/weave/evm";
import type { VerifyReportDTO } from "@/lib/weave/types";

export async function POST(request: Request) {
  try {
    await readJsonBody(request); // body לא נדרש — מנוקז בכוונה

    const rows = await db.attestation.findMany({
      orderBy: { seq: "asc" },
      include: { agent: true },
    });

    // ── 1. שלמות השרשרת (חישוב מחדש של entryHash לכל רשומה) ──
    const chain = verifyChain(
      rows.map((row) => ({
        seq: row.seq,
        agentAddress: row.agent.ethAddress,
        claim: row.claim,
        claimType: row.claimType,
        evidenceHash: row.evidenceHash,
        status: row.status,
        prevHash: row.prevHash,
        entryHash: row.entryHash,
        createdAt: row.createdAt,
      }))
    );

    const errors: string[] = [...chain.errors];
    let firstBreak: number | null = chain.firstBreak;

    // ── 2. חתימות: ecrecover מול כתובת הסוכן של כל שורה ──
    let sigOk = 0;
    let sigFail = 0;
    for (const row of rows) {
      if (!row.sig) {
        sigFail += 1;
        errors.push(`seq ${row.seq}: חסרה חתימה`);
        if (firstBreak === null) firstBreak = row.seq;
        continue;
      }
      let recovered: string | null = null;
      try {
        recovered = recoverFromDigestEip191(row.entryHash, row.sig);
      } catch {
        recovered = null; // חתימה משובשת — נספרת ככישלון, לא כקריסה
      }
      if (recovered !== null && recovered === row.agent.ethAddress) {
        sigOk += 1;
      } else {
        sigFail += 1;
        errors.push(`seq ${row.seq}: חתימה לא תואמת`);
        if (firstBreak === null) firstBreak = row.seq;
      }
    }

    // ── 3. ראיות: hashText(evidence) מול evidenceHash השמור ──
    for (const row of rows) {
      if (hashText(row.evidence) !== row.evidenceHash) {
        errors.push(`seq ${row.seq}: evidenceHash לא תואם לראיה — הראיה שונתה`);
        if (firstBreak === null) firstBreak = row.seq;
      }
    }

    const report: VerifyReportDTO = {
      valid: errors.length === 0,
      checked: rows.length,
      firstBreak,
      errors,
      sigOk,
      sigFail,
      headHash: rows.length > 0 ? rows[rows.length - 1].entryHash : GENESIS_HASH,
      verifiedAt: new Date().toISOString(),
      recomputedHead: chain.recomputedHead,
    };

    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return jsonError(error);
  }
}
