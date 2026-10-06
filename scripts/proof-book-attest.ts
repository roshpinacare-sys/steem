#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · PROOF-BOOK-ATTEST (R208P) — העדות: ספר-ההוכחות ← ספר-הרשת
//
// זהו הצעד שסוגר את "השכחה" לנצח: כל הוכחה בספר-ההוכחות עולה כאימות
// חתום-EIP-191 אל ספר-הרשת עצמו (1300+ רשומות), וראש-הספר נחתם
// כרשומת PROOF-REGISTRY. מרגע זה:
//   · הלב-הענן (weave-heart) מאמת-מחדש את כל השרשרת שעה-שעה — כולל
//     ההוכחות — ומייצא לריפו הריבוני (גיט) ולקווי-העיגון (Steem/ZERO).
//   · מחיקה/שכחה מקומית = שבירת-שרשרת חתומה שהענן מגלה.
//   · השוואת-ראש בכל שער-פתיחה (proof-gate) מוכיחה שההוכחות שרדו.
//
// זהות-החותם: weave-proof-registrar (DAEMON) — זהות EVM חדשה שנולדת
// פעם-אחת בספר (DEVNET-דיזיין: המפתח אצל הסוכן-בשרת, כמו שאר הדיבונים).
// אימות-אמת: כל רשומה נחתמת והחתימה משוחזרת-מיידית (ecrecover) בעצמה
// של appendAttestation — אין דרך לרשום בלי חתימה תקפה.
// ─────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { generateIdentity } from "@/lib/weave/evm";
import { appendAttestation } from "@/lib/weave/ledger";
import {
  GENESIS,
  headHash,
  latestByClaim,
  readRegistry,
  verifyRegistry,
} from "./proof-ledger";

const REGISTRAR_NAME = "weave-proof-registrar";

async function ensureRegistrar(): Promise<{ id: string; address: string }> {
  const existing = await db.agent.findUnique({
    where: { name: REGISTRAR_NAME },
    select: { id: true, ethAddress: true, status: true, devKeyHex: true },
  });
  if (existing) {
    if (!existing.devKeyHex) {
      // זהות-קיימת בלי מפתח מקומי — מחייב התאמה; לא נולד מחדש באותו שם.
      throw new Error("weave-proof-registrar קיים בלי מפתח — נדרש ניפוי ידני");
    }
    return { id: existing.id, address: existing.ethAddress };
  }
  const identity = generateIdentity();
  const agent = await db.agent.create({
    data: {
      name: REGISTRAR_NAME,
      role: "DAEMON",
      ethAddress: identity.address,
      pubKeyHex: identity.pubKeyHex,
      devKeyHex: identity.devKeyHex,
      status: "ACTIVE",
    },
    select: { id: true, ethAddress: true },
  });
  const result = { id: agent.id, address: agent.ethAddress };
  console.log(`✓ נולד סוכן-רישום: ${REGISTRAR_NAME} · ${result.address.slice(0, 12)}…`);
  return result;
}

async function main() {
  const entries = readRegistry();
  const chain = verifyRegistry(entries);
  if (!chain.ok) {
    console.error(`✗ ספר-ההוכחות שבור (${chain.reason}) — לא מעידים על ספר שבור`);
    process.exit(1);
  }
  const head = headHash(entries);
  const registrar = await ensureRegistrar();

  // מנגנון-כנות: העדות-על-הראש כבר קיימת בספר-הרשת ⇒ אין כפילות.
  const dup = await db.attestation.findFirst({
    where: { claimType: "PROOF-REGISTRY", claim: { contains: head.slice(0, 32) } },
    select: { seq: true },
  });
  if (dup) {
    console.log(`↷ ראש-הספר ${head.slice(0, 20)}… כבר מעודן ברשת (seq ${dup.seq}) — אין פעולה`);
    process.exit(0);
  }

  // 1) הוכחה-אחת-הוכחה-אחת: כל הכרעת-טענה-אחרונה עולה כאימות חתום.
  const latest = [...latestByClaim(entries).values()];
  const claimIds: string[] = [];
  for (const e of latest) {
    const att = await appendAttestation({
      agentId: registrar.id,
      claimType: "PROOF",
      claim: `${e.claimId} · ${e.verdict} · ${e.claim}`,
      evidence: JSON.stringify({
        registrySeq: e.seq,
        registryHead: head,
        claimId: e.claimId,
        verdict: e.verdict,
        scope: e.scope,
        entryHash: e.entryHash,
        evidenceFiles: e.evidence.map((x) => ({ path: x.path, sha256: x.sha256.slice(0, 16) + "…" })),
        reproduction: e.reproduction,
        lastRepro: e.lastRepro,
        genesis: GENESIS.slice(0, 16),
      }),
    });
    claimIds.push(e.claimId);
    console.log(`✓ PROOF #${att.seq} · ${e.claimId} · ${e.verdict} · ${att.entryHash.slice(0, 14)}…`);
  }

  // 2) ראש-הספר נחתם כרשומת PROOF-REGISTRY — מחויבות-הרשת לספר-ההוכחות.
  const headAtt = await appendAttestation({
    agentId: registrar.id,
    claimType: "PROOF-REGISTRY",
    claim: `ראש-ספר-ההוכחות-הריבוני: ${head} · ${entries.length} רשומות · ${latest.length} טענות-אחרונות (${claimIds.filter((c) => !c.startsWith("R208R-INDEPENDENT")).join(", ")}) · GENESIS ${GENESIS.slice(0, 16)} · כל-פקודות-השחזור רצו-חי בסבב R208P (trace 1a10e219d0860c0d)`,
    evidence: JSON.stringify({
      registryHead: head,
      totalEntries: entries.length,
      latestClaims: claimIds,
      gate: "sovereign/proofs/gate-report.json",
      registry: "sovereign/proofs/proof-registry.jsonl",
    }),
  });
  console.log(`✓ PROOF-REGISTRY #${headAtt.seq} · ראש ${head.slice(0, 20)}… · ${headAtt.entryHash.slice(0, 14)}…`);
  console.log(`─── ההוכחות חיות-כעת בספר-הרשת. הלב-הענן יאמת-מחדש ויעגן חוץ. ───`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
