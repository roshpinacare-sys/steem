// POST /api/weave/checkpoint — נקודת עוגן חדשה:
//   טווח האימותים מאז ה-checkpoint האחרון → root=Merkle → digest EIP-712 →
//   חתימת מפתח הרשת (get-or-create, לעולם לא חוזר ב-response) →
//   calldata אמיתי ל-AnchorRegistry → anchorStatus=LOCAL.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, readJsonBody, toCheckpointDTO } from "@/lib/weave/api";
import { GENESIS_HASH } from "@/lib/weave/chain";
import {
  checkpointDigest,
  identityFromKey,
  recoverCheckpointSigner,
  signCheckpoint,
} from "@/lib/weave/evm";
import { anchorCalldata } from "@/lib/weave/anchor";
import { merkleRoot } from "@/lib/weave/merkle";

const NETWORK_KEY_ID = "weave-network";
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** get-or-create של מפתח הרשת — המפתח עצמו לעולם לא חוזר החוצה */
async function getOrCreateNetworkKey(): Promise<{ address: string; devKeyHex: string }> {
  const existing = await db.networkKey.findUnique({ where: { id: NETWORK_KEY_ID } });
  if (existing) {
    return { address: existing.address, devKeyHex: existing.devKeyHex };
  }

  const envKey = process.env.WEAVE_NETWORK_KEY;
  if (envKey && PRIVATE_KEY_PATTERN.test(envKey)) {
    const identity = identityFromKey(envKey);
    await db.networkKey.create({
      data: { id: NETWORK_KEY_ID, address: identity.address, devKeyHex: identity.devKeyHex },
    });
    return { address: identity.address, devKeyHex: identity.devKeyHex };
  }
  if (envKey) {
    // פורמט שגוי — לא מדליף את הערך, רק הודעה כללית
    console.warn("[weave/checkpoint] WEAVE_NETWORK_KEY בפורמט שגוי — נוצר מפתח רשת חדש");
  }

  // r121 · חוק fail-closed: אין מפתח רשת בסביבה ואין כזה ב-DB — לא
  // ממציאים זהות-מקרית שתחתום על עוגן שהקנון לא מכיר. המפעיל נדרש:
  // WEAVE_NETWORK_KEY בסביבה או שחזור ה-seal (bun scripts/weave-seal.ts
  // / --recover). עוגן על שרשרת שקרית גרוע מאין עוגן בכלל.
  throw new Error(
    "מפתח הרשת חסר — checkpoint נדחה בכנות (fail-closed). הגדר WEAVE_NETWORK_KEY או שחזר מה-seal; לא נחתום בזהות שנולדה מקרית."
  );
}

export async function POST(request: Request) {
  try {
    await readJsonBody(request); // body לא נדרש — מנוקז בכוונה

    const lastCp = await db.checkpoint.findFirst({ orderBy: { index: "desc" } });
    const from = lastCp ? lastCp.attTo + 1 : 1;

    const rows = await db.attestation.findMany({
      where: { seq: { gte: from } },
      orderBy: { seq: "asc" },
      select: { seq: true, entryHash: true },
    });
    if (rows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "אין אימותים חדשים מאז ה-checkpoint האחרון — אין מה לעגן",
        },
        { status: 400 }
      );
    }

    const leaves = rows.map((row) => row.entryHash);
    const root = merkleRoot(leaves);
    const attTo = rows[rows.length - 1].seq;
    const index = lastCp ? lastCp.index + 1 : 1;
    const prevRoot = lastCp ? lastCp.root : GENESIS_HASH;

    const cp = { index, attFrom: from, attTo, root, prevRoot };
    const entryHash = checkpointDigest(cp);

    const networkKey = await getOrCreateNetworkKey();
    const sig = await signCheckpoint(networkKey.devKeyHex, cp);
    const signerAddr = recoverCheckpointSigner(cp, sig);
    if (signerAddr !== networkKey.address) {
      return NextResponse.json(
        {
          ok: false,
          error: "signature mismatch — כתובת החותם אינה תואמת את מפתח הרשת",
        },
        { status: 500 }
      );
    }

    const calldata = anchorCalldata(root);

    const created = await db.checkpoint.create({
      data: {
        index,
        attFrom: from,
        attTo,
        leafCount: leaves.length,
        root,
        prevRoot,
        entryHash,
        sig,
        signerAddr,
        anchorStatus: "LOCAL",
        calldata,
      },
    });

    return NextResponse.json(
      { ok: true, checkpoint: toCheckpointDTO(created) },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
