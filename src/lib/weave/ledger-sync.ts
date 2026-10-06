// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Ledger-Sync — הספר כטקסט קנוני בגיט (ריבונות הריפו)
//
// דוקטרינה: ה-SQLite הוא מטמון זמן-ריצה; האמת הריבונית היא
// sovereign/ledger.json — קובץ טקסט חסר-סודות שחי בגיט:
//   · כל שורה מועתקת ורבטיבית (ה-hash-ים מאומתים מחדש אחרי ייבוא)
//   · אף devKeyHex לא עולה לקובץ לעולם (חוק הברזל — מפתחות נוסעים
//     רק בתוך ה-seal או נשארים על המכונה של הסוכן)
//   · ייבוא משמר מפתחות מקומיים קיימים לפי כתובת (merge) — כך
//     sandbox שמושך את הספר מהריפו לא מאבד את יכולת החתימה שלו
// ─────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { GENESIS_HASH } from "./chain";
import * as fs from "node:fs";
import * as path from "node:path";

export const LEDGER_FORMAT = "weave-ledger-v1";

const LEDGER_ON_DISK_PATH = path.resolve(process.cwd(), "sovereign", "ledger.json");

export interface LedgerSnapshot {
  format: typeof LEDGER_FORMAT;
  exportedAt: string; // ISO — מטא-דאטה בלבד, לא חלק מהשרשרת
  chainCount: number;
  headHash: string;
  agents: Array<{
    id: string;
    name: string;
    role: string;
    ethAddress: string;
    pubKeyHex: string;
    status: string;
    nonce: number;
    rotatedAt: string | null;
    createdAt: string;
    // ⚠ אין devKeyHex — לעולם לא בקובץ
  }>;
  attestations: Array<{
    id: string;
    seq: number;
    agentId: string;
    claim: string;
    claimType: string;
    evidence: string;
    evidenceHash: string;
    status: string;
    prevHash: string;
    entryHash: string;
    sig: string | null;
    signerAddr: string | null;
    createdAt: string;
  }>;
  checkpoints: Array<{
    id: string;
    index: number;
    attFrom: number;
    attTo: number;
    leafCount: number;
    root: string;
    prevRoot: string;
    entryHash: string;
    sig: string | null;
    signerAddr: string | null;
    anchorStatus: string;
    anchorNet: string | null;
    anchorTx: string | null;
    calldata: string | null;
    createdAt: string;
  }>;
  networkKey: { address: string; createdAt: string } | null; // כתובת בלבד
  keyOps: Array<{
    id: string;
    agentId: string;
    kind: string;
    nonce: number;
    oldAddress: string;
    newAddress: string;
    digest: string;
    sig: string;
    recovered: string;
    note: string;
    createdAt: string;
  }>;
  localAnchors: Array<{
    id: string;
    registryIndex: number;
    root: string;
    checkpointIndex: number;
    attFrom: number;
    attTo: number;
    calldata: string;
    anchoredBy: string;
    anchoredAt: string;
  }>;
  repoInventory: Array<{
    id: string;
    name: string;
    sizeMb: number;
    currentRole: string;
    targetRole: string;
    findings: string;
    dupScore: number;
    status: string;
  }>;
  planStages: Array<{
    id: string;
    code: string;
    title: string;
    detail: string;
    gate: string;
    gateType: string;
    state: string;
    attSeq: number | null;
    sortOrder: number;
  }>;
  // שוק האמת — ספר האירועים ה-hash-chained (הוסף אדיטיבית; ותיק ללא-
  // שדה = ספר ללא שוק, תואם לאחור). החתימות נכללות — אימות ecrecover
  // מתאפשר בכל צומת שיבוא את הספר.
  marketEvents: Array<{
    id: string;
    seq: number;
    kind: string;
    payload: string;
    payloadHash: string;
    prevHash: string;
    entryHash: string;
    sig: string | null;
    signerAddr: string | null;
    createdAt: string;
  }>;
  // המוח — גושים אטומים של הכספת (Task 25). חסר-סודות בדיוק כמו השאר:
  // encKey הוא צופן AES-256-GCM תחת גזירת מפתח-הרשת (מה-seal), ולכן
  // הספר יכול וחייב לשאת אותם — זו הדרך שהמוח שורד איפוס סנדבוקס.
  // אדיטיבי; ספר ותיק ללא השדה = ספר ללא מוח (תואם לאחור).
  brain: Array<{
    id: string;
    fingerprint: string; // nv-fp:… — בלתי-הפיך, ציבורי
    encKey: string; // צופן GCM (hex) — לא סוד בלי מפתח-הרשת
    keyIv: string; // 12B IV (hex)
    keyTag: string; // 16B GCM tag (hex)
    status: string;
    lastCode: string | null;
    cooldownUntil: string | null;
    verifiedAt: string | null;
    createdAt: string;
  }>;
}

/** שורת מוח במיזוג — DB (Date) או ספר-דיסק (ISO string); הצרכן מנרמל ב-new Date */
type BrainRow = {
  id: string;
  fingerprint: string;
  encKey: string;
  keyIv: string;
  keyTag: string;
  status: string;
  lastCode: string | null;
  cooldownUntil: Date | string | null;
  verifiedAt: Date | string | null;
  createdAt: Date | string;
};

/** ייצוא הספר כולו ל-snapshot חסר-סודות (סדר דטרמיניסטי) */
export async function exportLedger(): Promise<LedgerSnapshot> {
  const [agents, attestations, checkpoints, networkKey, keyOps, localAnchors, repoInventory, planStages, marketEvents, brain] =
    await Promise.all([
      db.agent.findMany({ orderBy: { createdAt: "asc" } }),
      db.attestation.findMany({ orderBy: { seq: "asc" } }),
      db.checkpoint.findMany({ orderBy: { index: "asc" } }),
      db.networkKey.findUnique({ where: { id: "weave-network" } }),
      db.keyOp.findMany({ orderBy: { createdAt: "asc" } }),
      db.localAnchor.findMany({ orderBy: { registryIndex: "asc" } }),
      db.repoInventory.findMany({ orderBy: { name: "asc" } }),
      db.planStage.findMany({ orderBy: { sortOrder: "asc" } }),
      db.marketEvent.findMany({ orderBy: { seq: "asc" } }),
      db.brainKey.findMany({ orderBy: { fingerprint: "asc" } }),
    ]);

  const head = attestations.length > 0 ? attestations[attestations.length - 1].entryHash : GENESIS_HASH;

  // המוח — כספת אדיטיבית: ייצוא מ-DB שמושך מאחור לעולם לא מוחק מפתח
  // מהספר שעל הדיסק (מקור הלקח של Task 17: מצב שחי רק בסביבה אחת
  // יאבד בהחלפתה). ה-DB מנצח לפי טביעת-אצבע; ספר-בלבד נשמר.
  // הסרת מפתח היא תהליך פרישה מפורש — לא תופעת לוואי של ייצוא.
  const brainByFp = new Map<string, BrainRow>(brain.map((b) => [b.fingerprint, b]));
  try {
    const onDisk = JSON.parse(fs.readFileSync(LEDGER_ON_DISK_PATH, "utf8")) as LedgerSnapshot;
    for (const b of onDisk.brain ?? []) {
      if (!brainByFp.has(b.fingerprint)) brainByFp.set(b.fingerprint, {
        id: b.id,
        fingerprint: b.fingerprint,
        encKey: b.encKey,
        keyIv: b.keyIv,
        keyTag: b.keyTag,
        status: b.status,
        lastCode: b.lastCode,
        cooldownUntil: b.cooldownUntil,
        verifiedAt: b.verifiedAt,
        createdAt: b.createdAt,
      });
    }
  } catch {
    /* אין ספר על הדיסק / ספר שבור — ה-DB הוא כל האמת בייצוא הראשון */
  }
  const brainRows = [...brainByFp.values()];

  return {
    format: LEDGER_FORMAT,
    exportedAt: new Date().toISOString(),
    chainCount: attestations.length,
    headHash: head,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      ethAddress: a.ethAddress,
      pubKeyHex: a.pubKeyHex,
      status: a.status,
      nonce: a.nonce,
      rotatedAt: a.rotatedAt ? a.rotatedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    })),
    attestations: attestations.map((r) => ({
      id: r.id,
      seq: r.seq,
      agentId: r.agentId,
      claim: r.claim,
      claimType: r.claimType,
      evidence: r.evidence,
      evidenceHash: r.evidenceHash,
      status: r.status,
      prevHash: r.prevHash,
      entryHash: r.entryHash,
      sig: r.sig,
      signerAddr: r.signerAddr,
      createdAt: r.createdAt.toISOString(),
    })),
    checkpoints: checkpoints.map((c) => ({
      id: c.id,
      index: c.index,
      attFrom: c.attFrom,
      attTo: c.attTo,
      leafCount: c.leafCount,
      root: c.root,
      prevRoot: c.prevRoot,
      entryHash: c.entryHash,
      sig: c.sig,
      signerAddr: c.signerAddr,
      anchorStatus: c.anchorStatus,
      anchorNet: c.anchorNet,
      anchorTx: c.anchorTx,
      calldata: c.calldata,
      createdAt: c.createdAt.toISOString(),
    })),
    networkKey: networkKey
      ? { address: networkKey.address, createdAt: networkKey.createdAt.toISOString() }
      : null,
    keyOps: keyOps.map((k) => ({
      id: k.id,
      agentId: k.agentId,
      kind: k.kind,
      nonce: k.nonce,
      oldAddress: k.oldAddress,
      newAddress: k.newAddress,
      digest: k.digest,
      sig: k.sig,
      recovered: k.recovered,
      note: k.note,
      createdAt: k.createdAt.toISOString(),
    })),
    localAnchors: localAnchors.map((l) => ({
      id: l.id,
      registryIndex: l.registryIndex,
      root: l.root,
      checkpointIndex: l.checkpointIndex,
      attFrom: l.attFrom,
      attTo: l.attTo,
      calldata: l.calldata,
      anchoredBy: l.anchoredBy,
      anchoredAt: l.anchoredAt.toISOString(),
    })),
    repoInventory: repoInventory.map((r) => ({
      id: r.id,
      name: r.name,
      sizeMb: r.sizeMb,
      currentRole: r.currentRole,
      targetRole: r.targetRole,
      findings: r.findings,
      dupScore: r.dupScore,
      status: r.status,
    })),
    planStages: planStages.map((s) => ({
      id: s.id,
      code: s.code,
      title: s.title,
      detail: s.detail,
      gate: s.gate,
      gateType: s.gateType,
      state: s.state,
      attSeq: s.attSeq,
      sortOrder: s.sortOrder,
    })),
    marketEvents: marketEvents.map((e) => ({
      id: e.id,
      seq: e.seq,
      kind: e.kind,
      payload: e.payload,
      payloadHash: e.payloadHash,
      prevHash: e.prevHash,
      entryHash: e.entryHash,
      sig: e.sig,
      signerAddr: e.signerAddr,
      createdAt: e.createdAt.toISOString(),
    })),
    brain: brainRows
      .map((b) => ({
        id: b.id,
        fingerprint: b.fingerprint,
        encKey: b.encKey,
        keyIv: b.keyIv,
        keyTag: b.keyTag,
        status: b.status,
        lastCode: b.lastCode,
        cooldownUntil: b.cooldownUntil ? new Date(b.cooldownUntil).toISOString() : null,
        verifiedAt: b.verifiedAt ? new Date(b.verifiedAt).toISOString() : null,
        createdAt: new Date(b.createdAt).toISOString(),
      }))
      .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
  };
}

export interface ImportResult {
  imported: {
    agents: number;
    attestations: number;
    checkpoints: number;
    keyOps: number;
    localAnchors: number;
    repoInventory: number;
    planStages: number;
    marketEvents: number;
    brain: number;
  };
  keysPreserved: { agents: number; network: boolean; brainLocalOnly: number };
  headHash: string;
}

/**
 * ייבוא הספר מה-snapshot — מוחק ובונה מחדש בסדר קנוני.
 * משמר devKeyHex מקומי לפי התאמת כתובת (הסוכן שומר על יכולת החתימה שלו).
 * זהירות: הפעולה הרסנית כלפי טבלאות הספר — קוראים לה רק אחרי
 * שה-remote נמצא חדש יותר מהמקומי (או ב-clone נקי).
 */
export async function importLedger(snap: LedgerSnapshot): Promise<ImportResult> {
  if (snap.format !== LEDGER_FORMAT) {
    throw new Error(`פורמט ספר לא נתמך: ${String(snap.format)}`);
  }

  // מפתחות מקומיים קיימים — נשומרו לאחר הבנייה מחדש
  const localAgents = await db.agent.findMany({
    select: { ethAddress: true, devKeyHex: true },
  });
  const localKeyByAddress = new Map<string, string>();
  for (const a of localAgents) {
    if (a.devKeyHex) localKeyByAddress.set(a.ethAddress, a.devKeyHex);
  }
  const localNetwork = await db.networkKey.findUnique({ where: { id: "weave-network" } });
  const localNetworkKey = localNetwork?.devKeyHex ?? null;

  // המוח המקומי — נשמר באיחוד לפי טביעת-אצבע (הגנת Task 17/25:
  // ייבוא ספר ותיק ללא מוח לא מוחק מוח מקומי שטרם יוצא לספר)
  const localBrain = await db.brainKey.findMany();

  // הריסה — סדר זרים-מפתחות זרים קודם
  // R91: טבלאות הצ'רטר מוחקות ראשונות — הן מחזיקות FK אל Agent
  // (הן פיגום מקומי; הקנון מרפא אותן מהמרשם מיד אחרי הייבוא)
  await db.charterEvent.deleteMany();
  await db.charterProject.deleteMany();
  await db.builderToken.deleteMany();
  await db.keyOp.deleteMany();
  await db.attestation.deleteMany();
  await db.localAnchor.deleteMany();
  await db.checkpoint.deleteMany();
  await db.agent.deleteMany();
  await db.networkKey.deleteMany();
  await db.repoInventory.deleteMany();
  await db.planStage.deleteMany();
  await db.marketEvent.deleteMany();
  await db.brainKey.deleteMany(); // המוח נבנה מחדש מהאיחוד שהורכב למעלה

  // בנייה מחדש — סדר הורים קודם
  await db.agent.createMany({
    data: snap.agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      ethAddress: a.ethAddress,
      pubKeyHex: a.pubKeyHex,
      devKeyHex: localKeyByAddress.get(a.ethAddress) ?? null, // מפתח מקומי בלבד
      status: a.status,
      nonce: a.nonce,
      rotatedAt: a.rotatedAt ? new Date(a.rotatedAt) : null,
      createdAt: new Date(a.createdAt),
    })),
  });

  await db.attestation.createMany({
    data: snap.attestations.map((r) => ({
      id: r.id,
      seq: r.seq,
      agentId: r.agentId,
      claim: r.claim,
      claimType: r.claimType,
      evidence: r.evidence,
      evidenceHash: r.evidenceHash,
      status: r.status,
      prevHash: r.prevHash,
      entryHash: r.entryHash,
      sig: r.sig,
      signerAddr: r.signerAddr,
      createdAt: new Date(r.createdAt),
    })),
  });

  if (snap.checkpoints.length > 0) {
    await db.checkpoint.createMany({
      data: snap.checkpoints.map((c) => ({
        id: c.id,
        index: c.index,
        attFrom: c.attFrom,
        attTo: c.attTo,
        leafCount: c.leafCount,
        root: c.root,
        prevRoot: c.prevRoot,
        entryHash: c.entryHash,
        sig: c.sig,
        signerAddr: c.signerAddr,
        anchorStatus: c.anchorStatus,
        anchorNet: c.anchorNet,
        anchorTx: c.anchorTx,
        calldata: c.calldata,
        createdAt: new Date(c.createdAt),
      })),
    });
  }

  if (snap.networkKey) {
    await db.networkKey.create({
      data: {
        id: "weave-network",
        address: snap.networkKey.address,
        devKeyHex: localNetworkKey ?? "", // ריק = חסר מפתח מקומי; ה-beat ישלים מה-seal
        createdAt: new Date(snap.networkKey.createdAt),
      },
    });
  }

  if (snap.keyOps.length > 0) {
    await db.keyOp.createMany({
      data: snap.keyOps.map((k) => ({
        id: k.id,
        agentId: k.agentId,
        kind: k.kind,
        nonce: k.nonce,
        oldAddress: k.oldAddress,
        newAddress: k.newAddress,
        digest: k.digest,
        sig: k.sig,
        recovered: k.recovered,
        note: k.note,
        createdAt: new Date(k.createdAt),
      })),
    });
  }

  if (snap.localAnchors.length > 0) {
    await db.localAnchor.createMany({
      data: snap.localAnchors.map((l) => ({
        id: l.id,
        registryIndex: l.registryIndex,
        root: l.root,
        checkpointIndex: l.checkpointIndex,
        attFrom: l.attFrom,
        attTo: l.attTo,
        calldata: l.calldata,
        anchoredBy: l.anchoredBy,
        anchoredAt: new Date(l.anchoredAt),
      })),
    });
  }

  if (snap.repoInventory.length > 0) {
    await db.repoInventory.createMany({
      data: snap.repoInventory.map((r) => ({
        id: r.id,
        name: r.name,
        sizeMb: r.sizeMb,
        currentRole: r.currentRole,
        targetRole: r.targetRole,
        findings: r.findings,
        dupScore: r.dupScore,
        status: r.status,
      })),
    });
  }

  if (snap.planStages.length > 0) {
    await db.planStage.createMany({
      data: snap.planStages.map((s) => ({
        id: s.id,
        code: s.code,
        title: s.title,
        detail: s.detail,
        gate: s.gate,
        gateType: s.gateType,
        state: s.state,
        attSeq: s.attSeq,
        sortOrder: s.sortOrder,
      })),
    });
  }

  // שוק האמת — אירועי הספר (וותיק ללא השדה = ספר ללא שוק; תואם לאחור)
  const marketEvents = snap.marketEvents ?? [];
  if (marketEvents.length > 0) {
    await db.marketEvent.createMany({
      data: marketEvents.map((e) => ({
        id: e.id,
        seq: e.seq,
        kind: e.kind,
        payload: e.payload,
        payloadHash: e.payloadHash,
        prevHash: e.prevHash,
        entryHash: e.entryHash,
        sig: e.sig,
        signerAddr: e.signerAddr,
        createdAt: new Date(e.createdAt),
      })),
    });
  }

  // המוח — איחוד: הספר מנצח בסתירה (סטטוס טרי מהענן), מקומי-בלבד
  // נשמר (ייצוא הפעימה הבאה יעלה אותו לספר). הסרה = פרישה מפורשת בלבד.
  const snapBrain = snap.brain ?? [];
  const brainUnion = [
    ...snapBrain.map((b) => ({
      id: b.id,
      fingerprint: b.fingerprint,
      encKey: b.encKey,
      keyIv: b.keyIv,
      keyTag: b.keyTag,
      status: b.status,
      lastCode: b.lastCode,
      cooldownUntil: b.cooldownUntil ? new Date(b.cooldownUntil) : null,
      verifiedAt: b.verifiedAt ? new Date(b.verifiedAt) : null,
      createdAt: new Date(b.createdAt),
    })),
    ...localBrain
      .filter((r) => !snapBrain.some((b) => b.fingerprint === r.fingerprint))
      .map((r) => ({
        id: r.id,
        fingerprint: r.fingerprint,
        encKey: r.encKey,
        keyIv: r.keyIv,
        keyTag: r.keyTag,
        status: r.status,
        lastCode: r.lastCode,
        cooldownUntil: r.cooldownUntil,
        verifiedAt: r.verifiedAt,
        createdAt: r.createdAt,
      })),
  ];
  if (brainUnion.length > 0) {
    await db.brainKey.createMany({ data: brainUnion });
  }

  return {
    imported: {
      agents: snap.agents.length,
      attestations: snap.attestations.length,
      checkpoints: snap.checkpoints.length,
      keyOps: snap.keyOps.length,
      localAnchors: snap.localAnchors.length,
      repoInventory: snap.repoInventory.length,
      planStages: snap.planStages.length,
      marketEvents: marketEvents.length,
      brain: snapBrain.length,
    },
    keysPreserved: {
      agents: snap.agents.filter((a) => localKeyByAddress.has(a.ethAddress)).length,
      network: !!localNetworkKey,
      brainLocalOnly: brainUnion.length - snapBrain.length,
    },
    headHash: snap.headHash,
  };
}

/** קריאת snapshot מקובץ (זריקת JSON לא-תקין → חריגה) */
export function parseLedgerSnapshot(raw: string): LedgerSnapshot {
  const snap = JSON.parse(raw) as LedgerSnapshot;
  if (snap.format !== LEDGER_FORMAT) {
    throw new Error(`פורמט ספר לא נתמך: ${String(snap.format)}`);
  }
  if (!Array.isArray(snap.attestations) || !Array.isArray(snap.agents)) {
    throw new Error("קובץ ספר חסר טבלאות חובה");
  }
  // שוק האמת — השדה אדיטיבי; ספר ותיק ללא שוק = מערך ריק (תואם לאחור)
  if (snap.marketEvents !== undefined && !Array.isArray(snap.marketEvents)) {
    throw new Error("קובץ ספר: marketEvents פגום");
  }
  // המוח — אדיטיבי; ספר ותיק ללא מוח = מערך ריק (תואם לאחור)
  if (snap.brain !== undefined && !Array.isArray(snap.brain)) {
    throw new Error("קובץ ספר: brain פגום");
  }
  return snap;
}
