// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Rotation (שער EVM-3 + מכניקת R2) — רוטציית מפתח סוכן
//
// המפתח הישן חותם ב-EIP-712 על פעולת ההעברה:
//   AgentKeyRotation { nonce, oldAddress, newAddress } ב-domain של הרשת.
// ה-nonce (המונה ה-monotonic של הסוכן) נצרך בפעולה — replay של
// אותה רוטציה יידחה. אחרי ההחלפה, חתימות של המפתח הישן נדחות
// אוטומטית: הכתובת שתשוחזר לא תתאים עוד לזהות הפעילה.
//
// ⚠ DEVNET: המפתח הישן נשמר בזיכרון המודול בלבד (לא ב-DB!) ורק
// לצורך הדגמת הדחייה. בייצור — המפתח הישן נשלל אצל הסוכן ונגרס.
// ─────────────────────────────────────────────────────────────────────

import { Wallet, TypedDataEncoder, getBytes, recoverAddress, toBeHex } from "ethers";
import type { TypedDataField } from "ethers";
import type { Agent, KeyOp } from "@prisma/client";
import { db } from "@/lib/db";
import { LedgerError } from "./ledger";
import { generateIdentity, recoverFromDigestEip191, WEAVE_DOMAIN } from "./evm";
import { challengeDigest } from "./nonces";
import { evm3Counters } from "./nonces";

/** טיפוסי EIP-712 לפעולת רוטציה — חלק מהפרוטוקול המתועד */
export const ROTATION_TYPES: Record<string, TypedDataField[]> = {
  AgentKeyRotation: [
    { name: "nonce", type: "uint256" },
    { name: "oldAddress", type: "address" },
    { name: "newAddress", type: "address" },
  ],
};

export interface RotationValue {
  nonce: number;
  oldAddress: string;
  newAddress: string;
}

/** ה-digest של פעולת הרוטציה (EIP-712, domain של הרשת) */
export function rotationDigest(value: RotationValue): string {
  return TypedDataEncoder.hash(WEAVE_DOMAIN, ROTATION_TYPES, {
    nonce: toBeHex(BigInt(value.nonce)),
    oldAddress: value.oldAddress,
    newAddress: value.newAddress,
  });
}

/** המפתחות המשוכים שנשמרים בזיכרון בלבד — להדגמת דחייה (DEVNET) */
const revokedKeys = new Map<string, { address: string; devKeyHex: string }>();

export function toKeyOpDTO(op: KeyOp, agentName: string) {
  return {
    id: op.id,
    agentId: op.agentId,
    agentName,
    kind: op.kind,
    nonce: op.nonce,
    oldAddress: op.oldAddress,
    newAddress: op.newAddress,
    digest: op.digest,
    recovered: op.recovered,
    note: op.note,
    createdAt: op.createdAt.toISOString(),
  };
}

/**
 * רוטציית מפתח מלאה:
 *   1. זהות חדשה נוצרת (secp256k1 אמיתי)
 *   2. המפתח הישן חותם EIP-712 על ההעברה (nonce + כתובות)
 *   3. ecrecover מאמת שהחותם הוא אכן הכתובת הישנה
 *   4. טרנזקציה אטומית: זהות חדשה + ניצול nonce + תיעוד KeyOp
 */
export async function rotateAgentKey(
  agentId: unknown,
  note: unknown
): Promise<{ op: KeyOp; agent: Agent }> {
  if (typeof agentId !== "string" || !agentId.trim()) {
    throw new LedgerError("נדרש agentId של סוכן רשום", 400);
  }
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) {
    throw new LedgerError("הסוכן לא נמצא ברשת — נדרש agentId של סוכן רשום", 400);
  }
  if (agent.status !== "ACTIVE") {
    throw new LedgerError("הסוכן אינו פעיל — לא ניתן לסובב מפתח", 400);
  }
  if (!agent.devKeyHex) {
    throw new LedgerError("אין מפתח חתימה בשרת (DEVNET) — לא ניתן לבצע רוטציה", 500);
  }
  // דוקטרינה: הכתובת בזמן החתימה קפואה בתוך entryHash של כל אימות.
  // סיבוב זהות עם היסטוריה חתומה היה שובר את אימות השרשרת (היסטוריה אין לשכתב).
  // v2 יתמוך ב"כתובת קפואה לכל רשומה"; עד אז — רק זהויות ללא אימותים.
  const attCount = await db.attestation.count({ where: { agentId: agent.id } });
  if (attCount > 0) {
    throw new LedgerError(
      `לסוכן ${attCount} אימותים חתומים תחת הזהות הנוכחית — סיבוב היה שובר את אימות ההיסטוריה. רוטציה ב-v1 לסוכנים ללא אימותים בלבד (הכתובת בזמן החתימה קפואה ב-entryHash).`,
      400
    );
  }
  const safeNote = typeof note === "string" ? note.trim().slice(0, 300) : "";

  const oldAddress = agent.ethAddress;
  const oldKeyHex = agent.devKeyHex;
  const identity = generateIdentity(); // הזהות החדשה — אקראית, אמיתית
  const nonce = agent.nonce + 1;

  // המפתח הישן מסמיך את ההעברה — חתימת EIP-712
  const value: RotationValue = { nonce, oldAddress, newAddress: identity.address };
  const digest = rotationDigest(value);
  const oldWallet = new Wallet(oldKeyHex);
  const sig = await oldWallet.signTypedData(WEAVE_DOMAIN, ROTATION_TYPES, {
    nonce: toBeHex(BigInt(nonce)),
    oldAddress,
    newAddress: identity.address,
  });
  const recovered = recoverAddress(getBytes(digest), sig);
  if (recovered !== oldAddress) {
    throw new LedgerError(
      "signature mismatch — פעולת ההעברה לא נחתמה בידי המפתח הישן",
      500
    );
  }

  // החלפה אטומית: זהות + ניצול nonce + תיעוד הפעולה
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.agent.update({
      where: { id: agent.id },
      data: {
        ethAddress: identity.address,
        pubKeyHex: identity.pubKeyHex,
        devKeyHex: identity.devKeyHex,
        nonce, // ה-nonce נצרך — replay של הרוטציה יידחה
        rotatedAt: new Date(),
      },
    });
    const op = await tx.keyOp.create({
      data: {
        agentId: agent.id,
        kind: "ROTATION",
        nonce,
        oldAddress,
        newAddress: identity.address,
        digest,
        sig,
        recovered,
        note: safeNote,
      },
    });
    return { op, agent: updated };
  });

  // DEVNET בלבד: המפתח הישן בזיכרון — להדגמת הדחייה. לא ב-DB.
  revokedKeys.set(agent.id, { address: oldAddress, devKeyHex: oldKeyHex });

  return result;
}

/**
 * הדגמה חיה של שלילה: ניסיון לחתום אתגר טרי במפתח המשוך.
 * החתימה תקפה קריפטוגרפית — אבל הכתובת שתשוחזר היא הישנה,
 * ולכן היא לא תואמת את הזהות הפעילה. זו בדיוק הבדיקה שהרשת עושה.
 */
export async function attemptRevokedKeySignature(
  agentId: unknown
): Promise<{
  agentId: string;
  agentName: string;
  activeAddress: string;
  attemptedAddress: string;
  rejected: true;
  reason: string;
}> {
  if (typeof agentId !== "string" || !agentId.trim()) {
    throw new LedgerError("נדרש agentId של סוכן רשום", 400);
  }
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) {
    throw new LedgerError("הסוכן לא נמצא ברשת — נדרש agentId של סוכן רשום", 400);
  }
  const old = revokedKeys.get(agent.id);
  if (!old) {
    throw new LedgerError(
      "אין מפתח משוך בזיכרון לסוכן זה — בצע רוטציה תחילה (ההדגמה זמינה מיד אחרי רוטציה, עד הפעלה מחדש של השרת)",
      409
    );
  }

  // אתגר טרי על הזהות הפעילה — התוקף חותם אותו במפתח הישן
  const digest = challengeDigest(agent.ethAddress, agent.nonce + 1);
  const oldWallet = new Wallet(old.devKeyHex);
  const sig = await oldWallet.signMessage(getBytes(digest)); // EIP-191
  const attempted = recoverFromDigestEip191(digest, sig);

  evm3Counters.replaysBlocked += 1;

  const rejected = attempted.toLowerCase() !== agent.ethAddress.toLowerCase();
  if (!rejected) {
    // לא אמור לקרות — אם כן, משהו בסדר הרוטציה שבור
    throw new LedgerError("שגיאת שלמות: מפתח משוך עדיין עובר אימות?! דרושה חקירה", 500);
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    activeAddress: agent.ethAddress,
    attemptedAddress: attempted,
    rejected: true,
    reason:
      "מפתח משוך — הכתובת ששוחזרה מהחתימה (ecrecover) אינה זהות הסוכן הפעיל. החתימה נדחית.",
  };
}

/** סטטיסטיקות EVM-3 — רוטציות מה-DB, מוני זיכרון מתויגים ככאלה */
export async function evm3Stats(): Promise<{
  rotations: number;
  challengesVerified: number;
  replaysBlocked: number;
  counterScope: string;
}> {
  const rotations = await db.keyOp.count();
  return {
    rotations,
    challengesVerified: evm3Counters.challengesVerified,
    replaysBlocked: evm3Counters.replaysBlocked,
    counterScope:
      "מוני זיכרון מאז הפעלת השרת — לא נתוני קבע; רוטציות נספרות מה-DB",
  };
}
