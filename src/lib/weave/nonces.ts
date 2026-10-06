// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Nonces (שער EVM-3) — replay protection לזהויות סוכנים
//
// פרוטוקול challenge-response עם מונה monotonic לכל סוכן:
//   1. אתגר:  digest = keccak256("WEAVE-CHALLENGE-v1|<address>|<nonce>")
//   2. הסוכן חותם את ה-digest ב-EIP-191 (ב-DEVNET — סימולציית סוכן בשרת)
//   3. הרשת משחזרת ב-ecrecover ומאמתת: כתובת ✓ וגם nonce === המונה+1
//   4. רק אז ה-nonce נצרך (מונה++). שידור חוזר של חתימה ישנה → דחייה.
//
// תווית אמת: הקריפטו REAL (keccak/secp256k1/EIP-191/ecrecover);
// החזקת המפתח אצל השרת — DEVNET בלבד (מסומן בכל מקום).
// ─────────────────────────────────────────────────────────────────────

import { keccak256, toUtf8Bytes } from "ethers";
import type { Agent } from "@prisma/client";
import { db } from "@/lib/db";
import { LedgerError } from "./ledger";
import { recoverFromDigestEip191, signDigestEip191 } from "./evm";

/** מונים בזיכרון — מאז הפעלת השרת (מתאפסים ב-restart, מתועדים כך) */
export const evm3Counters = {
  challengesVerified: 0,
  replaysBlocked: 0,
};

export const EVM3_COUNTER_SCOPE =
  "מוני זיכרון מאז הפעלת השרת — לא נתוני קבע; רוטציות נספרות מה-DB";

const CHALLENGE_PREFIX = "WEAVE-CHALLENGE-v1";

/** ה-digest הדטרמיניסטי של אתגר — זהה לסוכן ולרשת, בלי מצב משותף */
export function challengeDigest(agentAddress: string, nonce: number): string {
  return keccak256(
    toUtf8Bytes(`${CHALLENGE_PREFIX}|${agentAddress}|${nonce}`)
  );
}

/** טעינת סוכן פעיל — משותף לכל נקודות הקצה של הפרוטוקול */
export async function requireActiveAgent(agentId: unknown): Promise<Agent> {
  if (typeof agentId !== "string" || !agentId.trim()) {
    throw new LedgerError("נדרש agentId של סוכן רשום", 400);
  }
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) {
    throw new LedgerError("הסוכן לא נמצא ברשת — נדרש agentId של סוכן רשום", 400);
  }
  if (agent.status !== "ACTIVE") {
    throw new LedgerError("הסוכן אינו פעיל (status !== ACTIVE) — אין לו הרשאת חתימה", 400);
  }
  return agent;
}

/** יצירת אתגר — ה-nonce הבא שטרם נוצל */
export function nextChallenge(agent: Agent): { nonce: number; digest: string } {
  const nonce = agent.nonce + 1;
  return { nonce, digest: challengeDigest(agent.ethAddress, nonce) };
}

/**
 * סימולציית סוכן (DEVNET): השרת חותם את ה-digest של (כתובת פעילה, nonce)
 * במפתח שברשותו. בייצור — הסוכן חותם אצלו ומגיש רק את החתימה.
 * החתימה עצמה פומבית; אין בתשובה שום חומר מפתח.
 */
export async function simulateAgentSign(
  agent: Agent,
  nonce: number
): Promise<{ digest: string; signature: string }> {
  if (!agent.devKeyHex) {
    throw new LedgerError("לסוכן אין מפתח חתימה בשרת (DEVNET) — לא ניתן לדמות חתימה", 500);
  }
  const digest = challengeDigest(agent.ethAddress, nonce);
  const signature = await signDigestEip191(agent.devKeyHex, digest);
  return { digest, signature };
}

/**
 * אימות אתגר — לב ה-replay protection:
 *   כתובת ששוחזרה חייבת להתאים לזהות הפעילה, וה-nonce חייב להיות
 *   בדיוק המונה+1. הצלחה → המונה נצרך. כישלון → המונה לא זז.
 */
export async function verifyAndConsumeChallenge(
  agentId: unknown,
  nonce: unknown,
  signature: unknown
): Promise<{ agent: Agent; consumedNonce: number; recovered: string }> {
  const agent = await requireActiveAgent(agentId);
  if (typeof nonce !== "number" || !Number.isInteger(nonce)) {
    throw new LedgerError("נדרש nonce (מספר שלם)", 400);
  }
  if (typeof signature !== "string" || !signature.trim()) {
    throw new LedgerError("נדרשת חתימה (signature) של הסוכן על ה-digest", 400);
  }

  const digest = challengeDigest(agent.ethAddress, nonce);
  const recovered = recoverFromDigestEip191(digest, signature);
  if (recovered.toLowerCase() !== agent.ethAddress.toLowerCase()) {
    throw new LedgerError(
      "חתימה לא תואמת — הכתובת ששוחזרה אינה זהות הסוכן הפעיל",
      400
    );
  }

  if (nonce <= agent.nonce) {
    evm3Counters.replaysBlocked += 1;
    throw new LedgerError(
      `replay — ה-nonce ${nonce} כבר נוצל (המונה עומד על ${agent.nonce}). חתימה חוזרת נדחית.`,
      409
    );
  }
  if (nonce !== agent.nonce + 1) {
    throw new LedgerError(
      `פער nonce — ציפינו ל-${agent.nonce + 1} וקיבלנו ${nonce}`,
      400
    );
  }

  const updated = await db.agent.update({
    where: { id: agent.id },
    data: { nonce },
  });
  evm3Counters.challengesVerified += 1;

  return { agent: updated, consumedNonce: nonce, recovered };
}
