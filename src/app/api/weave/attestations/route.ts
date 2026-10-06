// GET /api/weave/attestations?limit=100 — ספר האימותים (desc לפי seq, עם פרטי הסוכן)
//
// R117 — חוק המקור-היחיד: הספר (sovereign/ledger.json) הוא הקנון, והוא מסונכרן
// עם git בכל fetch. ה-DB המקומי הוא מטמון בלבד — ובסנדבוקס הוא נתגלה מפגר
// (529 מול 543 בספר) כשהעוגנים מתקדמים בענן בין סנכרונים. מעתה: כשהספר חדש
// מה-DB — הוא המשרת, עם תיוג מקור גלוי. ה-DB ממשיך לשרת רק כשהוא חדש יותר
// (פעימה מקומית שעוד לא נדחפה).
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/weave/api";
import { toAttestationDTO } from "@/lib/weave/ledger";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 500;
const LEDGER_PATH = path.join(process.cwd(), "sovereign", "ledger.json");

interface LedgerAgent {
  id: string;
  name: string;
  ethAddress: string;
}

interface LedgerAttestation {
  seq: number;
  agentId: string;
  claim: string;
  claimType: string;
  evidence: string;
  evidenceHash: string;
  status: string;
  prevHash: string;
  entryHash: string;
  sig: string;
  signerAddr: string;
  createdAt: string;
}

function readLedgerBook(): {
  chainCount: number;
  attestations: LedgerAttestation[];
  agents: LedgerAgent[];
  exportedAt: string;
} | null {
  try {
    const raw = fs.readFileSync(LEDGER_PATH, "utf8");
    const j = JSON.parse(raw) as {
      chainCount?: number;
      attestations?: LedgerAttestation[];
      agents?: LedgerAgent[];
      exportedAt?: string;
    };
    if (!Array.isArray(j.attestations)) return null;
    return {
      chainCount: j.chainCount ?? j.attestations.length,
      attestations: j.attestations,
      agents: j.agents ?? [],
      exportedAt: j.exportedAt ?? "",
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const raw = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : 100;

    const [total, rows] = await Promise.all([
      db.attestation.count(),
      db.attestation.findMany({
        orderBy: { seq: "desc" },
        take: limit,
        include: { agent: true },
      }),
    ]);

    // חוק המקור-היחיד: הספר קדימה? הוא המשרת — עם תיוג גלוי
    const book = readLedgerBook();
    if (book && book.chainCount > total) {
      const byAgent = new Map(book.agents.map((a) => [a.id, a]));
      const entries = [...book.attestations]
        .sort((a, b) => b.seq - a.seq)
        .slice(0, limit)
        .map((a) => {
          const ag = byAgent.get(a.agentId);
          return {
            seq: a.seq,
            agentId: a.agentId,
            agentName: ag?.name ?? "—",
            agentAddress: ag?.ethAddress ?? "—",
            claim: a.claim,
            claimType: a.claimType,
            evidence: a.evidence,
            evidenceHash: a.evidenceHash,
            status: a.status,
            prevHash: a.prevHash,
            entryHash: a.entryHash,
            sig: a.sig,
            signerAddr: a.signerAddr,
            createdAt: a.createdAt,
          };
        });
      return NextResponse.json({
        ok: true,
        total: book.chainCount,
        entries,
        // תיוג אמת: מהיכן הוגש, ולמה
        source: "ledger-canon",
        dbCacheBehind: { dbCount: total, ledgerCount: book.chainCount },
        exportedAt: book.exportedAt,
        note: "הספר (sovereign/ledger.json — מסונכרן מ-git) חדש מה-DB המקומי ולכן הוא המשרת",
      });
    }

    return NextResponse.json({
      ok: true,
      total,
      entries: rows.map((row) => toAttestationDTO(row)),
      source: "db",
      ledgerCount: book?.chainCount ?? null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
