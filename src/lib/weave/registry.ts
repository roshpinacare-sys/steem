// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Local Registry (שער EVM-2 במצב LOCAL) — מראה של החוזה
//
// מריץ את ה-calldata של anchor(bytes32) בדיוק כפי שצומת EVM היה
// מפרק אותו (ABI-decoding אמיתי דרך ethers Interface), ומנהל
// את mapping ה-roots באותה סמנטיקה של ה-Solidity: latestIndex += 1.
//
// ואז — הוכחת הכללה המלאה של EVM-2, במצב LOCAL:
//   root מהרישום ← בניית Merkle proof ל-entryHash של אימות ←
//   אימות ההוכחה מול ה-root ← חישוב מחדש של העלה מהרשומה עצמה.
//
// תווית אמת: LOCAL — סימולציית חוזה בשרת. שרשרת אמיתית = NOT-YET (EVM-2).
// ─────────────────────────────────────────────────────────────────────

import { Interface } from "ethers";
import type { Checkpoint, LocalAnchor } from "@prisma/client";
import { db } from "@/lib/db";
import { LedgerError } from "./ledger";
import { ANCHOR_REGISTRY_ABI } from "./anchor";
import { hashEntry, recordFromRow } from "./chain";
import { merkleProof, verifyMerkleProof } from "./merkle";

const NETWORK_KEY_ID = "weave-network";

export function toLocalAnchorDTO(row: LocalAnchor) {
  return {
    registryIndex: row.registryIndex,
    root: row.root,
    checkpointIndex: row.checkpointIndex,
    attFrom: row.attFrom,
    attTo: row.attTo,
    calldata: row.calldata,
    anchoredBy: row.anchoredBy,
    anchoredAt: row.anchoredAt.toISOString(),
  };
}

/**
 * "ביצוע" ה-calldata של checkpoint על הרישום המקומי —
 * כמו tx ל-WeaveAnchorRegistry: פענוח ABI → roots[++latestIndex] = root.
 */
export async function anchorCheckpointLocally(
  checkpointIndex: unknown
): Promise<{ anchor: LocalAnchor; checkpoint: Checkpoint }> {
  if (typeof checkpointIndex !== "number" || !Number.isInteger(checkpointIndex)) {
    throw new LedgerError("נדרש index (מספר שלם) של checkpoint", 400);
  }
  const cp = await db.checkpoint.findUnique({ where: { index: checkpointIndex } });
  if (!cp) {
    throw new LedgerError(`checkpoint ${checkpointIndex} לא נמצא`, 404);
  }
  if (cp.anchorStatus === "LOCAL-ANCHORED") {
    throw new LedgerError(`checkpoint ${checkpointIndex} כבר עוגן ברישום המקומי`, 409);
  }
  if (cp.anchorStatus === "ANCHORED") {
    throw new LedgerError("ה-checkpoint עוגן בשרשרת אמיתית — אין לעגן שוב מקומית", 409);
  }
  if (!cp.calldata) {
    throw new LedgerError("ל-checkpoint אין calldata — צור אותו מחדש", 400);
  }

  // פענוח ABI אמיתי — בדיוק כפי שצומת EVM מפרק את ה-tx
  const iface = new Interface(ANCHOR_REGISTRY_ABI);
  const parsed = iface.parseTransaction({ data: cp.calldata });
  if (!parsed || parsed.name !== "anchor" || parsed.args.length !== 1) {
    throw new LedgerError("ה-calldata אינו קריאה תקינה ל-anchor(bytes32)", 400);
  }
  const root = String(parsed.args[0]);
  if (root !== cp.root) {
    throw new LedgerError("ה-root שפוענח מה-calldata אינו תואם את root ה-checkpoint", 400);
  }

  // latestIndex += 1 — אותה סמנטיקה של החוזה
  const last = await db.localAnchor.findFirst({ orderBy: { registryIndex: "desc" } });
  const registryIndex = (last?.registryIndex ?? 0) + 1;

  // msg.sender מדומה — בייצור: כתובת ה-relayer של מפתח הרשת
  const networkKey = await db.networkKey.findUnique({ where: { id: NETWORK_KEY_ID } });
  const anchoredBy = networkKey?.address ?? "unknown-relayer";

  const anchor = await db.localAnchor.create({
    data: {
      registryIndex,
      root,
      checkpointIndex: cp.index,
      attFrom: cp.attFrom,
      attTo: cp.attTo,
      calldata: cp.calldata,
      anchoredBy,
    },
  });
  const checkpoint = await db.checkpoint.update({
    where: { index: cp.index },
    data: { anchorStatus: "LOCAL-ANCHORED", anchorNet: "local-registry" },
  });

  return { anchor, checkpoint };
}

/** כל ה-roots שירדו לרישום המקומי — כמו קריאת roots() בחוזה */
export async function listLocalAnchors(): Promise<LocalAnchor[]> {
  return db.localAnchor.findMany({ orderBy: { registryIndex: "desc" } });
}

/**
 * הוכחת הכללה המלאה (EVM-2 במצב LOCAL) לאימות seq מול root ברישום:
 *   1. איתור ה-checkpoint שמכסה את seq ואת העוגן שלו ברישום
 *   2. חישוב מחדש של העלה מהרשומה — לא סמיכות על השדה השמור
 *   3. בניית Merkle proof ואימותו מול ה-root שברישום
 */
export async function verifyInclusionAgainstRegistry(
  seq: unknown,
  checkpointIndex?: unknown
): Promise<{
  mode: "LOCAL";
  seq: number;
  entryHash: string;
  leafRecomputedMatch: boolean;
  checkpointIndex: number;
  registryIndex: number;
  root: string;
  rootInRegistry: boolean;
  proof: string[];
  proofValid: boolean;
  verifiedAt: string;
}> {
  if (typeof seq !== "number" || !Number.isInteger(seq)) {
    throw new LedgerError("נדרש seq (מספר שלם) של אימות", 400);
  }
  const att = await db.attestation.findUnique({ where: { seq } });
  if (!att) {
    throw new LedgerError(`אימות seq ${seq} לא נמצא בספר`, 404);
  }

  const cp =
    typeof checkpointIndex === "number" && Number.isInteger(checkpointIndex)
      ? await db.checkpoint.findUnique({ where: { index: checkpointIndex } })
      : await db.checkpoint.findFirst({
          where: { attFrom: { lte: seq }, attTo: { gte: seq } },
          orderBy: { index: "desc" },
        });
  if (!cp) {
    throw new LedgerError(
      `אימות seq ${seq} אינו מכוסה ע"י checkpoint — צור checkpoint שיכסה אותו`,
      400
    );
  }
  if (cp.attFrom > seq || cp.attTo < seq) {
    throw new LedgerError(
      `אימות seq ${seq} אינו בטווח של checkpoint ${cp.index} (${cp.attFrom}–${cp.attTo})`,
      400
    );
  }

  const anchor = await db.localAnchor.findUnique({
    where: { checkpointIndex: cp.index },
  });
  if (!anchor) {
    throw new LedgerError(
      `checkpoint ${cp.index} טרם עוגן ברישום המקומי — עגן אותו תחילה`,
      400
    );
  }

  // חישוב מחדש של העלה מהרשומה עצמה — הרשומה היא הראייה, לא השדה השמור
  const agent = await db.agent.findUnique({ where: { id: att.agentId } });
  if (!agent) {
    throw new LedgerError("סוכן האימות לא נמצא — לא ניתן לחשב את העלה מחדש", 500);
  }
  const leafRecomputed = hashEntry(recordFromRow(att, agent.ethAddress));
  const leafRecomputedMatch = leafRecomputed === att.entryHash;

  const rows = await db.attestation.findMany({
    where: { seq: { gte: cp.attFrom, lte: cp.attTo } },
    orderBy: { seq: "asc" },
    select: { seq: true, entryHash: true },
  });
  const leaves = rows.map((row) => row.entryHash);
  const leafIndex = seq - cp.attFrom;
  const proof = merkleProof(leaves, leafIndex);
  const proofValid = verifyMerkleProof(att.entryHash, proof, cp.root, leafIndex);
  const rootInRegistry = anchor.root === cp.root;

  return {
    mode: "LOCAL",
    seq,
    entryHash: att.entryHash,
    leafRecomputedMatch,
    checkpointIndex: cp.index,
    registryIndex: anchor.registryIndex,
    root: cp.root,
    rootInRegistry,
    proof,
    proofValid,
    verifiedAt: new Date().toISOString(),
  };
}
