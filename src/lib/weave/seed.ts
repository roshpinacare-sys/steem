// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Seed — אתחול idempotent של הרשת (סוכנים + שרשרת אמיתית)
//
// הזרע משחזר את מצב הביקורת של 2026-09: 3 סוכנים, 5 אימותים
// (החמישי — טענה בלי מדידה → UNMEASURED אוטומטית, הדגמה חיה של
// הדוקטרינה "שום טענה בלי מדידה"), 11 ריפוים במלאי ו-11 שלבי תוכנית.
// האימותים עוברים דרך appendAttestation — השרשרת היא השרשרת האמיתית.
// ─────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { generateIdentity } from "./evm";
import { appendAttestation } from "./ledger";

const AGENT_SPECS = [
  { name: "weave-auditor", role: "AUDITOR" },
  { name: "scout-r19", role: "SCOUT" },
  { name: "gitkeeper", role: "DAEMON" },
] as const;

const SEED_ATTESTATIONS = [
  {
    agentName: "weave-auditor",
    claimType: "SELFTEST",
    claim: "Weave core self-test: 11/11 בדיקות קריפטו עברו",
    evidence:
      "bun -e inline suite: secp256k1 identity, EIP-191 sign/recover, EIP-712 sign/recover, hash-chain 3 entries, tamper-detect at exact seq, merkle inclusion+rejection, calldata ABI — 11 passed / 0 failed (ethers@6.17.0)",
  },
  {
    agentName: "weave-auditor",
    claimType: "AUDIT",
    claim: "מלאי אקוסיסטם: 13 ריפוים נמדדו ב-org roshpinacare-sys",
    evidence:
      "steem=243MB מונולית (91 API routes, 38 פאנלים, ~150 סקריפטים חד-פעמיים); Saosmartwallet=4MB SQLite מחויב (239 VaultEntry); Project-files=65MB zips ממוספרים; ~20 קבצי סטטוס משוכפלים ב-~9 ריפוים; 2 ארכיוני vault מוצפנים עדיין ב-main",
  },
  {
    agentName: "scout-r19",
    claimType: "MEASUREMENT",
    claim: "שכפול נמדד: קבצי SAOS-PULSE/BRIEFING/DAILY-REPORT משוכפלים בין ריפוים",
    evidence:
      'דגימה: ה-hash של קובץ סטטוס זהה ב-9 ריפוים; dupScore ממוצע 0.55; סה"כ נפח משוכפל מוערך >60MB',
  },
  {
    agentName: "weave-auditor",
    claimType: "AUDIT",
    claim: "חשיפת Vault: סמיכות passphrase-ciphertext מפרה דוקטרינת שתי השכבות",
    evidence:
      "agent/recovery-meta.json מחזיק keysZipPass/keysBackupPass (len 32) לצד KEYS-ZIP-2026-09-10.zip.enc ב-steem/agent/vault — הצפנה תקפה אבל מפתח וכספת באותו חדר",
  },
  {
    agentName: "gitkeeper",
    claimType: "ROTATION",
    claim: "מפתחות ה-Vault סובבו ונחתמו",
    evidence: "", // ⚠ ריק בכוונה — הפוליסה תסמן אוטומטית UNMEASURED
  },
] as const;

const UNKNOWN_SIZE_NOTE = "גודל לא נמדד בביקורת (0 במלאי) — דורש מלאי מדוד";

// R122 · תמונת-מצב של ביקורת 2026-09 (הזרע רץ על סנדבוקס טרי בלבד —
// idempotent). תיקוני-אמת: (א) שתי הרשומות הבדיוניות unmapped-repo-A/B
// הוסרו — אין ממציאים ריפוים; (ב) Zip אינו "ריפו ריק למחיקה" — הוא
// הריפו הקנוני הראשי של הרשת (הספר, האימותים ולב-הענן weave-heart חיים בו).
const SEED_REPOS = [
  {
    name: "steem",
    sizeMb: 243,
    currentRole: "monolith",
    targetRole: "SPLIT → weave-core+archive",
    dupScore: 0.9,
    findings: "מונולית 243MB: 91 API routes, 38 פאנלים, ~150 סקריפטים חד-פעמיים; 2 ארכיוני vault מוצפנים עדיין ב-main",
  },
  {
    name: "Saosmartwallet",
    sizeMb: 4,
    currentRole: "wallet+db",
    targetRole: "PURGE-DB → vault-of-record",
    dupScore: 0.4,
    findings: "custom.db מחויב: 239 שורות כולל 4 mnemonics",
  },
  {
    name: "Project-files",
    sizeMb: 65,
    currentRole: "zips",
    targetRole: "ארכיון קר",
    dupScore: 0.2,
    findings: "65MB zips ממוספרים — ארכיון קר, ללא שינוי חי",
  },
  {
    name: "saos-dex",
    sizeMb: 0,
    currentRole: "ריפו פעיל — לא נמדד",
    targetRole: "מיזוג → saos-ops",
    dupScore: 0.6,
    findings: UNKNOWN_SIZE_NOTE,
  },
  {
    name: "roshpina",
    sizeMb: 0,
    currentRole: "ארגון/בסיס — לא נמדד",
    targetRole: "ארכיון קר",
    dupScore: 0.5,
    findings: UNKNOWN_SIZE_NOTE,
  },
  {
    name: "saos-sovereign-foundry",
    sizeMb: 0,
    currentRole: "פיתוח — לא נמדד",
    targetRole: "מיזוג → weave-core",
    dupScore: 0.55,
    findings: UNKNOWN_SIZE_NOTE,
  },
  {
    name: "saos-jummper",
    sizeMb: 0,
    currentRole: "כלי עזר — לא נמדד",
    targetRole: "מיזוג → saos-ops",
    dupScore: 0.5,
    findings: UNKNOWN_SIZE_NOTE,
  },
  {
    name: "saos-control-center",
    sizeMb: 0,
    currentRole: "פאנל בקרה — לא נמדד",
    targetRole: "מיזוג → saos-ops",
    dupScore: 0.6,
    findings: UNKNOWN_SIZE_NOTE,
  },
  {
    name: "saos-sovereign-platform",
    sizeMb: 0,
    currentRole: "עותק קנוני עצמאי — לא נמדד",
    targetRole: "מיזוג (עותק קנוני עצמאי)",
    dupScore: 0.7,
    findings: UNKNOWN_SIZE_NOTE,
  },
  {
    name: "anchor-baseline",
    sizeMb: 0,
    currentRole: "עותק בסיס — לא נמדד",
    targetRole: "ארכיון",
    dupScore: 0.8,
    findings: UNKNOWN_SIZE_NOTE,
  },
  {
    name: "Zip",
    sizeMb: 0,
    currentRole: "הריפו הקנוני הראשי — THE WEAVE",
    targetRole: "קנון חי (לב-הענן weave-heart חמוש בו)",
    dupScore: 0.0,
    findings: "צומת-האמת של הרשת: הספר, האימותים ולב-הענן חיים כאן. תיקון R122 לסטטוס המיושן מביקורת 2026-09, שראה את הריפו כריק/404 — ההפך הגמור ממועמד למחיקה.",
  },
] as const;

const SEED_STAGES = [
  {
    code: "L0",
    title: "AUDIT",
    detail: "מלאי האקוסיסטם: 13 ריפוים נמדדו ותועדו בספר האימותים — נעשה בפועל בביקורת 2026-09.",
    gate: "מלאי אקוסיסטם מלא תועד באימות AUDIT",
    gateType: "AUDIT",
    state: "DONE",
    attSeq: 2,
    sortOrder: 0,
  },
  {
    code: "L1",
    title: "GOLDEN-REPLAY",
    detail: "בנייה מקלון ריק ושחזור bit-ל-bit מול העותק הקנוני — הוכחת יכולת שחזור מלאה לפני כל שינוי מבני.",
    gate: "בנייה נקייה מקלון ריק משוחזרת bit-ל-bit",
    gateType: "BUILD",
    state: "PLANNED",
    attSeq: null,
    sortOrder: 1,
  },
  {
    code: "L2",
    title: "CANARY",
    detail: "פעולת ערך תחום אחת בהיקף $1 תחת פיקוח מלא — הקנרית הראשונה אחרי ההסמכה.",
    gate: "פעולת ערך תחום $1 תחת פיקוח",
    gateType: "MEASUREMENT",
    state: "PLANNED",
    attSeq: null,
    sortOrder: 2,
  },
  {
    code: "L3",
    title: "SUPERVISED-72H",
    detail: "72 שעות רצופות של פעולה מפוקחת ללא שגיאה — הארכת אמון הדרגתית.",
    gate: "72 שעות רצופות ללא שגיאה",
    gateType: "MEASUREMENT",
    state: "PLANNED",
    attSeq: null,
    sortOrder: 3,
  },
  {
    code: "L4",
    title: "BOUNDED-7D",
    detail: "7 ימים מגודרים של אוטונומיה חלקית ללא אירוע חורג.",
    gate: "7 ימים מגודרים ללא אירוע",
    gateType: "MEASUREMENT",
    state: "PLANNED",
    attSeq: null,
    sortOrder: 4,
  },
  {
    code: "R1",
    title: "CONSOLIDATION",
    detail: "מיזוג הריפוים ל-weave-core / saos-ops וצמצום השכפול המדוד.",
    gate: "מלאי חוזר: שכפול ממוצע < 0.2",
    gateType: "MEASUREMENT",
    state: "PLANNED",
    attSeq: null,
    sortOrder: 5,
  },
  {
    code: "R2",
    title: "VAULT-SEAL",
    detail: "אטימת הכספת: רוטציית מפתחות ושלילה מדודה של המפתחות הישנים — סגירת ממצא הסמיכות.",
    gate: "רוטציה בוצעה + מפתחות ישנים נשללו (מדידה: revocation נבדק)",
    gateType: "ROTATION",
    state: "PLANNED",
    attSeq: null,
    sortOrder: 6,
  },
  {
    code: "R3",
    title: "PURGE",
    detail: "מחיקה מגודרת: ריפוים ריקים, סקריפטים חד-פעמיים ו-custom.db מחויב — ניקוי הפסולת אחרי המיזוג.",
    gate: "מלאי חוזר: 0 ריפוים ריקים ו-0 סקריפטים חד-פעמיים חיים; custom.db הוסר מהיפוך גיט",
    gateType: "MEASUREMENT",
    state: "PLANNED",
    attSeq: null,
    sortOrder: 7,
  },
  {
    code: "EVM-1",
    title: "ANCHOR-DEPLOY",
    detail: "פריסת WeaveAnchorRegistry ב-testnet ותיעוד הכתובת — פותח את שער העיגון האמיתי (חותם ממומן).",
    gate: "WeaveAnchorRegistry נפרס ב-testnet, כתובת תועדה",
    gateType: "ANCHOR",
    state: "PLANNED",
    attSeq: null,
    sortOrder: 8,
  },
  {
    code: "EVM-2",
    title: "PROOF-ONCHAIN",
    detail: "הוכחת Merkle של אימות אקראי מאומתת מול root השמור בשרשרת — הלולאה נסגרת.",
    gate: "הוכחת Merkle של אימות אקראי אומתה מול root בשרשרת",
    gateType: "ANCHOR",
    state: "PLANNED",
    attSeq: null,
    sortOrder: 9,
  },
  {
    code: "EVM-3",
    title: "AGENT-NONCES",
    detail: "הגנת replay (nonce) לזהויות סוכנים בשכבת החתימה — חתימה חוזרת נדחית.",
    gate: "replay-protection (nonce) לזהויות סוכנים",
    gateType: "BUILD",
    state: "PLANNED",
    attSeq: null,
    sortOrder: 10,
  },
] as const;

let seedInflight: Promise<void> | null = null;

async function runSeed(): Promise<void> {
  // שומר idempotent — אם יש סוכנים ב-DB, הזרע כבר רץ
  if ((await db.agent.count()) > 0) return;

  // ── 3 סוכנים: זהות EVM נוצרת ונשמרת ב-DB (devKeyHex ב-DB בלבד!) ──
  const idByName = new Map<string, string>();
  for (const spec of AGENT_SPECS) {
    const identity = generateIdentity();
    const agent = await db.agent.create({
      data: {
        name: spec.name,
        role: spec.role,
        ethAddress: identity.address,
        pubKeyHex: identity.pubKeyHex,
        devKeyHex: identity.devKeyHex,
        status: "ACTIVE",
      },
    });
    idByName.set(spec.name, agent.id);
  }

  // ── 5 אימותים בסדר — דרך appendAttestation, שרשרת אמיתית ──
  for (const att of SEED_ATTESTATIONS) {
    const agentId = idByName.get(att.agentName);
    if (!agentId) throw new Error(`seed: חסר סוכן ${att.agentName}`);
    await appendAttestation({
      agentId,
      claim: att.claim,
      claimType: att.claimType,
      evidence: att.evidence,
    });
  }

  // ── מלאי 11 ריפוים (תמונת-ביקורת 2026-09, מתוקנת R122) ──
  await db.repoInventory.createMany({ data: [...SEED_REPOS] });

  // ── 11 שלבי תוכנית (L0 סגור על אימות המלאי seq=2; השאר PLANNED) ──
  await db.planStage.createMany({ data: [...SEED_STAGES] });
}

/**
 * ensureSeed — idempotent: בודק את ה-DB בכל קריאה (0 סוכנים → מזריע),
 * ומגן מקריאות מקבילות באמצעות promise משותף לזריעה שממש רצה.
 */
export function ensureSeed(): Promise<void> {
  if (seedInflight) return seedInflight;
  seedInflight = runSeed().finally(() => {
    seedInflight = null; // נפתח בסיום — קריאה הבאה תבדוק את ה-DB שוב
  });
  return seedInflight;
}
