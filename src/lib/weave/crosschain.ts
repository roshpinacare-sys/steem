// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Crosschain — עוגן-עוגנים: הצלבת שרשרת הצי (SAOS-NET)
// כעלה חתום בספר של weave-core
//
// הדוקטרינה (SOVEREIGNTY §4.3 + §11): "עוגן שרק יושב = ארכיון; עוגן
// שנכנס לשרשרת-חתומה = כוח". הפעם ההפוכה: שרשרת-האמת שלנו מעידה על
// שרשרת-הכלכלה של הצי — ה-stateRoot שנמדד ב-replay דטרמיניסטי נכתב כאימות
// CROSSCHAIN חתום בספר ⇒ checkpoint מכסה ⇒ העוגנים מעידים עליו החוצה
// (Steem/Hive ב-:20 · ZERO-EVM ב-:30, ב-$0). שתי שרשראות האמת מעידות זו
// על זו — הצלבה כפי שנמדדה בפעם האחרונה. אמת-גיל (r121): ההצלבה חיה
// רק כשה-pack מתקדם; כשהשורש אינו משתנה (FROZEN-PACK) היא נדלגת
// בכנות (SKIPPED) — עדות על תמונת-מצב קפואה אינה "מצב נוכחי", וכך
// גם תווי הזמן בצד הצרכן.
//
// משמעת המדידה (זהה לקווי העוגנים):
//   · fail-closed — replay שאינו FULLY-VERIFIED לא נכתב לעולם כעדות
//   · דה-דופליקציה לפי stateRoot — אותו שורש = אותה עדות; דילוג כנה
//   · הראיה היא המדידה עצמה (replay/hash/linkage), לעולם לא טענת הלקוח
// ─────────────────────────────────────────────────────────────────────

import * as path from "path";
import { execFile } from "child_process";
import { db } from "@/lib/db";
import { appendAttestation } from "./ledger";
import { ensureDaemonAgent } from "./daemons";

const ROOT = process.cwd();
const RUNNER = path.join(ROOT, "scripts", "saosnet-status.cjs");
const REPLAY_CACHE_TTL_MS = 60_000;

export class CrosschainError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "CrosschainError";
    this.status = status;
  }
}

/** פלט ה-runner של SAOS-NET (scripts/saosnet-status.cjs) — המדידה הגולמית */
export interface SaosnetReplay {
  ok: boolean;
  net: {
    netVersion: string;
    genesisHash: string | null;
    height: number;
    stateRoot: string;
    lastBlockHash?: string | null;
    lastTime: string | null;
    issuer: string | null;
    supply?: number | null;
    snapshotHeight: number;
    blocksInPack: number;
  };
  verify: {
    snapshotSelf: boolean;
    replayed: number;
    hashMatch: string;
    linkage: string;
    rootMatch: boolean;
    heightMatch: boolean;
    verdict: string;
  };
  economy: { soldiers: number; lpHolders: number };
  wallets: { total: number; agents: number };
}

/** מטמון replay קצר — מדידה כבדה יחסית; אותו סנכרון נקודתי */
let replayCache: { at: number; data: SaosnetReplay } | null = null;

function runSaosnetRunner(): Promise<SaosnetReplay> {
  return new Promise((resolve, reject) => {
    execFile(
      "node",
      [RUNNER],
      { cwd: ROOT, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new CrosschainError(`הרצת ה-runner של SAOS-NET נכשלה: ${error.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as SaosnetReplay);
        } catch {
          reject(new CrosschainError("פלט ה-runner של SAOS-NET אינו JSON תקין"));
        }
      }
    );
  });
}

/** ה-replay הדטרמיניסטי — מטומן 60 שניות (אותו TTL של נתיב הסטטוס) */
export async function runSaosnetReplay(force = false): Promise<SaosnetReplay> {
  if (!force && replayCache && Date.now() - replayCache.at < REPLAY_CACHE_TTL_MS) {
    return replayCache.data;
  }
  const data = await runSaosnetRunner();
  replayCache = { at: Date.now(), data };
  return data;
}

/** זהות עד ההצלבה — DAEMON נגזר ממפתח הרשת שב-seal: אותה כתובת
 *  בכל סביבה (סנדבוקס/ענן/clone); ייבוא הספר משאיר בלי מפתח וה-ensure
 *  משלים מהגזירה — self-heal כמו מפתח הרשת עצמו */
export async function ensureSaosnetWitness(): Promise<{
  id: string;
  name: string;
  ethAddress: string;
}> {
  return ensureDaemonAgent("weave-saosnet-witness", "DAEMON");
}

export type CrossAnchorStatus = "ATTESTED" | "SKIPPED" | "REFUSED";

export interface CrossAnchorResult {
  status: CrossAnchorStatus;
  reason: string;
  attSeq: number | null;
  net: {
    netVersion: string;
    height: number;
    stateRoot: string;
  };
}

function isFullyVerified(replay: SaosnetReplay): boolean {
  return (
    replay.ok &&
    replay.verify.snapshotSelf &&
    replay.verify.rootMatch &&
    replay.verify.heightMatch &&
    String(replay.verify.verdict).startsWith("FULLY-VERIFIED")
  );
}

/**
 * ההצלבה עצמה — מדידה ⇒ דה-דופליקציה ⇒ אימות CROSSCHAIN חתום.
 *
 * REFUSED  — ה-pack לא מאומת מתמטית (fail-closed; לא נכתבת עדות).
 * SKIPPED  — אותו stateRoot כבר מעיד בספר (דילוג כנה, המצב לא השתנה).
 * ATTESTED — עדות חדשה נכתבה; ה-checkpoint/הייצוא באחריות הקורא (סולם ההוכחות).
 */
export async function crossAnchorSaosnet(): Promise<CrossAnchorResult> {
  // 0. זהות העד קודם לדה-דופליקציה — משפחות ה-CROSSCHAIN נבדלות לפי
  //    העד (SAOS-NET · ארכיון): חיפוש "ה-CROSSCHAIN האחרון" חסר-היקף
  //    נשבר ברגע שעד שני נוסף (Task 19) והחזיר שכפול של אותה עדות.
  const witness = await ensureSaosnetWitness();

  // 1. המדידה — replay דטרמיניסטי מלא (הראייה, לא טענה)
  const replay = await runSaosnetReplay(true);
  const { net, verify, economy, wallets } = replay;

  if (!isFullyVerified(replay)) {
    return {
      status: "REFUSED",
      reason: `ה-pack אינו מאומת מתמטית (${verify.verdict}) — לא נכתבת עדות על מצב בלתי-מאומת (fail-closed)`,
      attSeq: null,
      net: { netVersion: net.netVersion, height: net.height, stateRoot: net.stateRoot },
    };
  }

  // 2. דה-דופליקציה לפי stateRoot — אותו שורש = אותה עדות.
  //    ממוקד-עד: רק עדויות SAOS-NET של העד הזה (לא כל CROSSCHAIN —
  //    עד הארכיון וד אחר, וראיתו על שורש אחר).
  const needle = `stateRoot=${net.stateRoot}`;
  const lastCross = await db.attestation.findFirst({
    where: { claimType: "CROSSCHAIN", agentId: witness.id },
    orderBy: { seq: "desc" },
  });
  if (lastCross && lastCross.evidence.includes(needle)) {
    return {
      status: "SKIPPED",
      reason: `stateRoot זה כבר מעיד בספר (att ${lastCross.seq}) — המצב לא השתנה מאז; דילוג כנה`,
      attSeq: lastCross.seq,
      net: { netVersion: net.netVersion, height: net.height, stateRoot: net.stateRoot },
    };
  }

  // 3. העדות — טענה בעברית + ראיה קנונית (הכל ניתן לחישוב-מחדש מה-pack)
  const claim =
    `עוגן-עוגנים: שרשרת הכלכלה של הצי (${net.netVersion}) נמדדה ב-replay דטרמיניסטי — ` +
    `stateRoot=…${net.stateRoot.slice(-8)} בגובה ${net.height.toLocaleString("en-US")} — ` +
    `ו שתי שרשראות האמת מעידות זו על זו.`;
  const evidence = [
    `net=${net.netVersion}`,
    `stateRoot=${net.stateRoot}`,
    `genesisHash=${net.genesisHash ?? "null"}`,
    `height=${net.height}`,
    `lastBlockHash=${net.lastBlockHash ?? "null"}`,
    `snapshotHeight=${net.snapshotHeight}`,
    `blocksInPack=${net.blocksInPack}`,
    `replay: hash=${verify.hashMatch} linkage=${verify.linkage} snapshotSelf=${verify.snapshotSelf}`,
    `rootMatch=${verify.rootMatch} heightMatch=${verify.heightMatch}`,
    `soldiers=${economy.soldiers} lpHolders=${economy.lpHolders} walletAgents=${wallets.agents}`,
    `issuer=${net.issuer ?? "null"}`,
    `measuredBy=saosnet-status.cjs (deterministic replay)`,
    `at=${new Date().toISOString()}`,
  ].join(" · ");

  const att = await appendAttestation({
    agentId: witness.id,
    claim,
    claimType: "CROSSCHAIN",
    evidence,
  });

  return {
    status: "ATTESTED",
    reason: "העדות נכתבה בספר וחתומה; ה-checkpoint יכסה והעוגנים יעידו (Steem/Hive + ZERO, ב-$0)",
    attSeq: att.seq,
    net: { netVersion: net.netVersion, height: net.height, stateRoot: net.stateRoot },
  };
}

/** אינדקס ההצלבה לתצוגה — אימות ה-CROSSCHAIN האחרון של עד SAOS-NET
 *  (ממוקד-עד: משפחות ה-CROSSCHAIN נבדלות לפי העד) + ניתוח שדות הראיה */
export async function lastSaosnetCrossAnchor(): Promise<{
  attSeq: number;
  stateRoot: string | null;
  height: number | null;
  netVersion: string | null;
  at: string;
} | null> {
  const witness = await db.agent.findUnique({ where: { name: "weave-saosnet-witness" } });
  if (!witness) return null;
  const last = await db.attestation.findFirst({
    where: { claimType: "CROSSCHAIN", agentId: witness.id },
    orderBy: { seq: "desc" },
  });
  if (!last) return null;
  const field = (key: string): string | null => {
    const m = last.evidence.match(new RegExp(`${key}=([^ ·]+)`));
    return m ? m[1] : null;
  };
  return {
    attSeq: last.seq,
    stateRoot: field("stateRoot"),
    height: field("height") ? Number(field("height")) : null,
    netVersion: field("net"),
    at: last.createdAt.toISOString(),
  };
}
