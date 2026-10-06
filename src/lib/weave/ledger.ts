// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Ledger — הנספח המשותף לשרשרת (משמש גם את ה-seed וגם את ה-API)
//
// appendAttestation מיישם את מכניקת השרשרת המדויקת:
//   seq = max+1 · prevHash = entryHash של הראש (או GENESIS) ·
//   entryHash = keccak256(רשומה קנונית) · חתימת EIP-191 + שחזור ecrecover.
// פוליסת המאמת: השרת קובע את הסטטוס — לעולם לא הלקוח.
// ─────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import type { Agent, Attestation } from "@prisma/client";
import {
  GENESIS_HASH,
  canonicalAttestation,
  hashEntry,
  hashText,
} from "./chain";
import { recoverFromDigestEip191, signDigestEip191 } from "./evm";
import type { AttestationDTO } from "./types";

/** שורה מהספר עם הסוכן המצורף (לצורך DTO) */
export type AttestationRow = Attestation & { agent: Agent };

/** שגיאת ספר עם קוד HTTP צפוי — ההודעה בעברית ומיועדת ללקוח */
export class LedgerError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LedgerError";
    this.status = status;
  }
}

export interface AppendAttestationInput {
  agentId: string;
  claim: string;
  claimType: string;
  evidence: string;
}

/**
 * הוספת אימות לספר — חתום, מקושר ומאומת-חתימה בזמן הכתיבה.
 * הסטטוס נקבע כאן (פוליסת המאמת): ראיה ריקה → UNMEASURED —
 * "טענה בלי מדידה לעולם לא תסומן VERIFIED" (claimType MEASUREMENT בלי
 * מדידה הוא המקרה הקנוני, אך הדוקטרינה חלה על כל סוג טענה).
 */
export async function appendAttestation(
  input: AppendAttestationInput
): Promise<AttestationRow> {
  const agent = await db.agent.findUnique({ where: { id: input.agentId } });
  if (!agent) {
    throw new LedgerError("הסוכן לא נמצא ברשת — נדרש agentId של סוכן רשום", 400);
  }
  if (agent.status !== "ACTIVE") {
    throw new LedgerError("הסוכן אינו פעיל (status !== ACTIVE) — אין לו הרשאת חתימה", 400);
  }
  if (!agent.devKeyHex) {
    throw new LedgerError("לסוכן אין מפתח חתימה בשרת (DEVNET) — לא ניתן לחתום", 500);
  }

  const claim = input.claim;
  const evidence = input.evidence ?? "";

  // ── פוליסת המאמת: השרת קובע, body.status לעולם לא מתקבל ──
  const status: string = evidence.trim().length > 0 ? "VERIFIED" : "UNMEASURED";

  // ── מכניקת השרשרת ──
  const last = await db.attestation.findFirst({ orderBy: { seq: "desc" } });
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.entryHash ?? GENESIS_HASH;
  const createdAt = new Date(); // נתפס פעם אחת — אותו Date משמש גם לקנון וגם ל-DB
  const evidenceHash = hashText(evidence);

  const record = canonicalAttestation({
    seq,
    agentAddress: agent.ethAddress,
    claim,
    claimType: input.claimType,
    evidenceHash,
    status,
    prevHash,
    createdAt,
  });
  const entryHash = hashEntry(record);

  // חתימת EIP-191 של מפתח הסוכן על entryHash + שחזור מיידי (ecrecover)
  const sig = await signDigestEip191(agent.devKeyHex, entryHash);
  const signerAddr = recoverFromDigestEip191(entryHash, sig);
  if (signerAddr !== agent.ethAddress) {
    throw new LedgerError("signature mismatch — כתובת החותם אינה תואמת את זהות הסוכן", 500);
  }

  return await db.attestation.create({
    data: {
      seq,
      agentId: agent.id,
      claim,
      claimType: input.claimType,
      evidence,
      evidenceHash,
      status,
      prevHash,
      entryHash,
      sig,
      signerAddr,
      createdAt,
    },
    include: { agent: true },
  });
}

/** מיפוי שורה+סוכן → DTO ללקוח (createdAt → ISO string) */
export function toAttestationDTO(row: AttestationRow): AttestationDTO {
  return {
    seq: row.seq,
    agentId: row.agentId,
    agentName: row.agent.name,
    agentAddress: row.agent.ethAddress,
    claim: row.claim,
    claimType: row.claimType,
    evidence: row.evidence,
    evidenceHash: row.evidenceHash,
    status: row.status,
    prevHash: row.prevHash,
    entryHash: row.entryHash,
    sig: row.sig,
    signerAddr: row.signerAddr,
    createdAt: row.createdAt.toISOString(),
  };
}
