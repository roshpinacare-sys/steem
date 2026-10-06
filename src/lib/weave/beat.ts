// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Beat — מחזור הפעימה הריבונית (ספר שמפעיל את עצמו)
//
// זה מנוע הלב של הרשת: בין אם הוא רץ בסנדבוקס (ה-runner הראשי) ובין
// אם הוא רץ ב-GitHub Actions (הענן שלנו) — אותו מחזור בדיוק:
//
//   1. אמת את הספר כולו מחדש (שרשרת + חתימות + evidenceHash) —
//      שרשרת שבורה ⇒ פעימה אדומה, אין הרחבה (לעולם לא כותבים
//      על גבי שקר).
//   2. הוסף אימות MEASUREMENT של הפעימה — הטענה נמדדת: כמה רשומות,
//      כמה חתימות, איזה root, איזה runner. חתום EIP-191 במפתח
//      הענן מה-seal.
//   3. Checkpoint חדש אם יש אימותים טריים — root מרקל חתום EIP-712
//      במפתח הרשת.
//   4. רץ בענן ⇒ סגור את שער SOV-2 באימות הפעימה (הרשת סוגרת
//      לעצמה את השער כשהענף מוכיח שהיא חיה מהענן).
//
// הספר עצמו (ledger.json) חי בגיט; ה-SQLite הוא מטמון מקומי.
// ─────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { appendAttestation } from "./ledger";
import { GENESIS_HASH, hashText, verifyChain } from "./chain";
import {
  checkpointDigest,
  generateIdentity,
  identityFromKey,
  recoverCheckpointSigner,
  recoverFromDigestEip191,
  signCheckpoint,
} from "./evm";
import { anchorCalldata } from "./anchor";
import { merkleRoot } from "./merkle";

export interface BeatVerifyReport {
  valid: boolean;
  checked: number;
  sigOk: number;
  sigFail: number;
  firstBreak: number | null;
  errors: string[];
  recomputedHead: string;
  headHash: string;
}

export interface BeatContext {
  runner: "github-actions" | "local-primary";
  gitHead?: string;
  repoSlug?: string;
  runUrl?: string;
  note?: string;
}

export interface BeatResult {
  at: string;
  runner: BeatContext["runner"];
  verdict: "LEDGER-VALID" | "LEDGER-BROKEN";
  verify: BeatVerifyReport;
  beat: {
    seq: number;
    entryHash: string;
    status: string;
    checkpoint: { index: number; root: string; attFrom: number; attTo: number } | null;
  } | null;
  gatesClosed: Array<{ code: string; attSeq: number }>;
  context: BeatContext;
}

/** אימות מלא: שרשרת + חתימות + hash-ראיה מחדש (חישוב, לא סמיכות) */
export async function verifyLedger(): Promise<BeatVerifyReport> {
  const rows = await db.attestation.findMany({
    orderBy: { seq: "asc" },
    include: { agent: { select: { ethAddress: true } } },
  });

  const chain = verifyChain(
    rows.map((r) => ({
      seq: r.seq,
      agentAddress: r.agent.ethAddress,
      claim: r.claim,
      claimType: r.claimType,
      evidenceHash: r.evidenceHash,
      status: r.status,
      prevHash: r.prevHash,
      entryHash: r.entryHash,
      createdAt: r.createdAt,
    }))
  );

  const errors = [...chain.errors];
  let sigOk = 0;
  let sigFail = 0;
  for (const r of rows) {
    if (r.sig) {
      const recovered = recoverSig(r.entryHash, r.sig);
      if (recovered === r.agent.ethAddress) {
        sigOk++;
      } else {
        sigFail++;
        errors.push(`seq ${r.seq}: חתימה לא תואמת`);
      }
    } else {
      sigFail++;
      errors.push(`seq ${r.seq}: חסרה חתימה`);
    }
    // חישוב-מחדש של hash הראיה — ערעור evidence חייב להיתפס
    if (hashText(r.evidence) !== r.evidenceHash) {
      errors.push(`seq ${r.seq}: evidenceHash לא תואם — הראיה שובשה`);
      if (chain.valid) {
        // השרשרת עצמה תקפה אך הראיה שקרית — דגל אדום מלא
        errors.push("⚠ סתירת ראיה בספר");
      }
    }
  }

  const headHash = rows.length > 0 ? rows[rows.length - 1].entryHash : GENESIS_HASH;

  return {
    valid: chain.valid && sigFail === 0 && !errors.some((e) => e.includes("evidenceHash לא תואם")),
    checked: rows.length,
    sigOk,
    sigFail,
    firstBreak: chain.firstBreak,
    errors,
    recomputedHead: chain.recomputedHead,
    headHash,
  };
}

// שחזור EIP-191 עמיד — חתימה פגומה נחשבת ככישלון, לא כהפלת התהליך
function recoverSig(digest: string, sig: string): string {
  try {
    return recoverFromDigestEip191(digest, sig);
  } catch {
    return "0xinvalid";
  }
}

/** הקפאת זהות הענן: סוכן RELAYER ייעודי שמפתחו חי רק ב-seal */
export const CLOUD_AGENT_NAME = "weave-cloud-heart";

export async function ensureCloudAgent(cloudKeyHex: string): Promise<{ id: string; ethAddress: string }> {
  const identity = identityFromKey(cloudKeyHex);

  const existing = await db.agent.findUnique({ where: { name: CLOUD_AGENT_NAME } });
  if (existing) {
    if (existing.ethAddress !== identity.address) {
      throw new Error(
        "זהות הענן ב-seal אינה תואמת את הסוכן בספר — ה-seal והספר סותרים"
      );
    }
    // השלמת מפתח מקומי מה-seal (ה-DB הוא מטמון; המפתח לא בגיט)
    if (!existing.devKeyHex) {
      await db.agent.update({ where: { id: existing.id }, data: { devKeyHex: cloudKeyHex } });
    }
    return { id: existing.id, ethAddress: existing.ethAddress };
  }

  const created = await db.agent.create({
    data: {
      name: CLOUD_AGENT_NAME,
      role: "RELAYER",
      ethAddress: identity.address,
      pubKeyHex: identity.pubKeyHex,
      devKeyHex: cloudKeyHex, // מטמון מקומי בלבד — לעולם לא מיוצא ל-ledger.json
      status: "ACTIVE",
    },
  });
  return { id: created.id, ethAddress: created.ethAddress };
}

/** השלמת מפתח הרשת מה-seal — הכתובת חייבת להתאים לרשומה בספר */
export async function ensureNetworkKeyFromSeal(
  networkKeyHex: string
): Promise<{ address: string; devKeyHex: string }> {
  const identity = identityFromKey(networkKeyHex);
  const existing = await db.networkKey.findUnique({ where: { id: "weave-network" } });

  if (!existing) {
    await db.networkKey.create({
      data: { id: "weave-network", address: identity.address, devKeyHex: networkKeyHex },
    });
    return { address: identity.address, devKeyHex: networkKeyHex };
  }
  if (existing.address !== identity.address) {
    throw new Error("מפתח הרשת ב-seal אינו תואם את כתובת הרשת בספר — סתירה");
  }
  if (!existing.devKeyHex) {
    await db.networkKey.update({
      where: { id: "weave-network" },
      data: { devKeyHex: networkKeyHex },
    });
  }
  return { address: existing.address, devKeyHex: existing.devKeyHex || networkKeyHex };
}

/** Checkpoint עכשיו — מראה של הלוגיקה ב-route (אותם חוקים בדיוק) */
export async function createCheckpointNow(): Promise<{
  index: number;
  root: string;
  attFrom: number;
  attTo: number;
} | null> {
  const lastCp = await db.checkpoint.findFirst({ orderBy: { index: "desc" } });
  const from = lastCp ? lastCp.attTo + 1 : 1;
  const rows = await db.attestation.findMany({
    where: { seq: { gte: from } },
    orderBy: { seq: "asc" },
    select: { seq: true, entryHash: true },
  });
  if (rows.length === 0) return null;

  const leaves = rows.map((r) => r.entryHash);
  const root = merkleRoot(leaves);
  const attTo = rows[rows.length - 1].seq;
  const index = lastCp ? lastCp.index + 1 : 1;
  const prevRoot = lastCp ? lastCp.root : GENESIS_HASH;

  const cp = { index, attFrom: from, attTo, root, prevRoot };
  const entryHash = checkpointDigest(cp);

  const networkKey = await ensureNetworkKeyRow();
  const sig = await signCheckpoint(networkKey.devKeyHex, cp);
  const signerAddr = recoverCheckpointSigner(cp, sig);
  if (signerAddr !== networkKey.address) {
    throw new Error("signature mismatch — כתובת החותם אינה תואמת את מפתח הרשת");
  }

  await db.checkpoint.create({
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
      calldata: anchorCalldata(root),
    },
  });

  return { index, root, attFrom: from, attTo };
}

async function ensureNetworkKeyRow(): Promise<{ address: string; devKeyHex: string }> {
  const existing = await db.networkKey.findUnique({ where: { id: "weave-network" } });
  if (existing && existing.devKeyHex) {
    return { address: existing.address, devKeyHex: existing.devKeyHex };
  }
  // אין מפתח מקומי ואין seal בהקשר — נוצר חדש (מצב פתוח-ראשון בלבד)
  const identity = generateIdentity();
  if (existing) {
    if (existing.address !== identity.address) {
      throw new Error("לרשת יש כתובת בספר אך אין מפתח — נדרש seal תואם");
    }
    await db.networkKey.update({
      where: { id: "weave-network" },
      data: { devKeyHex: identity.devKeyHex },
    });
    return { address: existing.address, devKeyHex: identity.devKeyHex };
  }
  await db.networkKey.create({
    data: { id: "weave-network", address: identity.address, devKeyHex: identity.devKeyHex },
  });
  return { address: identity.address, devKeyHex: identity.devKeyHex };
}

/** מחזור הפעימה המלא — verify → attest → checkpoint → gates */
export async function runBeat(
  context: BeatContext,
  cloudKeyHex: string | null
): Promise<BeatResult> {
  const verify = await verifyLedger();
  const at = new Date().toISOString();

  if (!verify.valid) {
    // שרשרת שבורה ⇒ פעימה אדומה בלבד. לעולם לא מרחיבים ספר שקרי.
    return {
      at,
      runner: context.runner,
      verdict: "LEDGER-BROKEN",
      verify,
      beat: null,
      gatesClosed: [],
      context,
    };
  }

  if (!cloudKeyHex) {
    throw new Error("חסר מפתח ענן — הפעימה חייבת seal פתוח");
  }
  const cloudAgent = await ensureCloudAgent(cloudKeyHex);

  // ── SOV-3 איחול-עצמי (BUILD) ──
  // פעימת ענן = הפלטפורמה קמה מ-clone נקי ב-runner של GitHub Actions:
  // checkout → bun install → prisma → ייבוא הספר → פתיחת seal → הפעימה הזו.
  // אימות BUILD נרשם רק כשהשער פתוח, ורק בנתיב שממשיך לדחיפה —
  // כך ההוכחה תמיד מגיעה ל-origin/main ולא נשארת ב-runner ארעי.
  let sov3Att: { seq: number; entryHash: string } | null = null;
  if (context.runner === "github-actions") {
    const sov3 = await db.planStage.findUnique({ where: { code: "SOV-3" } });
    if (sov3 && sov3.state !== "DONE") {
      const buildClaim =
        `איחול-עצמי: הפלטפורמה קמה מ-clone נקי ב-runner ענן — ` +
        `install+prisma+ייבוא הספר+פתיחת seal ופעימה, בלי הסנדבוקס שלנו.`;
      const buildEvidence = [
        `runner=${context.runner}`,
        `gitHead=${context.gitHead ?? "unknown"}`,
        `repo=${context.repoSlug ?? "roshpinacare-sys/weave-core"}`,
        context.runUrl ? `run=${context.runUrl}` : null,
        `bun=${process.versions.bun ?? "?"} node=${process.versions.node ?? "?"}`,
        `sealCustody=${process.env.WEAVE_SEAL_PASSPHRASE ? "github-secret" : "repo-meta-legacy"}`,
        `verify: checked=${verify.checked} sigOk=${verify.sigOk} sigFail=${verify.sigFail}`,
        `headHash=${verify.headHash}`,
        `at=${at}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const buildAtt = await appendAttestation({
        agentId: cloudAgent.id,
        claim: buildClaim,
        claimType: "BUILD",
        evidence: buildEvidence,
      });
      sov3Att = { seq: buildAtt.seq, entryHash: buildAtt.entryHash };
    }
  }

  const claim =
    `פעימת לב ריבונית: הספר אומת מחדש — ${verify.checked} רשומות, ` +
    `חתימות ${verify.sigOk}/${verify.checked}, head תואם. הרץ: ${
      context.runner === "github-actions" ? "GitHub Actions (הענן שלנו)" : "ה-runner הראשי (סנדבוקס/מקומי)"
    }.`;

  const evidenceParts = [
    `runner=${context.runner}`,
    `gitHead=${context.gitHead ?? "unknown"}`,
    `repo=${context.repoSlug ?? "roshpinacare-sys/weave-core"}`,
    context.runUrl ? `run=${context.runUrl}` : null,
    `verify: valid=${verify.valid} checked=${verify.checked} sigOk=${verify.sigOk} sigFail=${verify.sigFail} firstBreak=${verify.firstBreak ?? "null"}`,
    `recomputedHead=${verify.recomputedHead}`,
    `headHash=${verify.headHash}`,
    `at=${at}`,
    context.note ?? null,
  ].filter(Boolean);

  const appended = await appendAttestation({
    agentId: cloudAgent.id,
    claim,
    claimType: "MEASUREMENT",
    evidence: evidenceParts.join(" · "),
  });

  const checkpoint = await createCheckpointNow();

  // סגירת שערים על בסיס מי מדבר:
  //   local-primary ⇒ SOV-1 (הבית הריבוני הוכח בפעימה מקומית מה-clone החי)
  //   github-actions ⇒ SOV-2 (הענן הוכיח שהרשת חיה מ-GitHub Actions עצמו)
  const gatesClosed: Array<{ code: string; attSeq: number }> = [];
  if (context.runner === "github-actions") {
    const closed = await closeStageWithAttestation("SOV-2", appended.seq);
    if (closed) gatesClosed.push(closed);
  } else {
    const closed = await closeStageWithAttestation("SOV-1", appended.seq);
    if (closed) gatesClosed.push(closed);
  }
  // SOV-3 — נסגר על אימות ה-BUILD שנכתב באותה פעימת ענן (לפני אימות הפעימה)
  if (sov3Att) {
    const closed = await closeStageWithAttestation("SOV-3", sov3Att.seq);
    if (closed) gatesClosed.push(closed);
  }

  return {
    at,
    runner: context.runner,
    verdict: "LEDGER-VALID",
    verify,
    beat: {
      seq: appended.seq,
      entryHash: appended.entryHash,
      status: appended.status,
      checkpoint,
    },
    gatesClosed,
    context,
  };
}

/** סגירת שער באימות VERIFIED בלבד — מראה של הלוגיקה ב-plan/close */
export async function closeStageWithAttestation(
  code: string,
  attestationSeq: number
): Promise<{ code: string; attSeq: number } | null> {
  const stage = await db.planStage.findUnique({ where: { code } });
  if (!stage || stage.state === "DONE") return null;

  const att = await db.attestation.findUnique({ where: { seq: attestationSeq } });
  if (!att) return null;
  if (att.status !== "VERIFIED" || att.claimType !== stage.gateType) return null;

  await db.planStage.update({
    where: { code },
    data: { state: "DONE", attSeq: attestationSeq },
  });
  return { code, attSeq: attestationSeq };
}
