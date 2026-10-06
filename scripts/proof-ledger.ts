#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · PROOF LEDGER CORE (R208P) — ספר-ההוכחות הריבוני
//
// הבעיה שנולדה ממנו (תלונת-המפעיל, trace 1a10e219d0860c0d):
//   "אחרי שאתם מוכיחים — פתאום אחרי זה זה בכלל לא קיים".
//   הוכחות R208/R208R חיו בארטיפקטים בלבד; כל סבב חדש שבנה את
//   האפיסטמולוגיה מאפס ושכח. מרגע זה: כל הוכחה נרשמת פעם-אחת,
//   hash-chained, עם פקודת-שחזור שרצה-חי, ומעודנת בספר-הרשת.
//
// חוקי-הספר:
//   P1 · append-only — אסור לערוך/למחוק רשומה; עדכון-מסקנה = רשומה-חדשה
//        עם אותו claimId ו-verdict חדש (מספרים-עוקבים).
//   P2 · hash-chain — entryHash = sha256(קנון-הרשומה) · prevHash מקשר.
//   P3 · כל רשומה נושאת פקודת-שחזור ניתנת-להרצה ועדויות מהוצללות sha256.
//   P4 · PROVEN אינו נפתח-מחדש לעולם — רק מופרך (ההפרכה נרשמת בעצמה).
//   P5 · OPEN הוא מצב-כנה: חסרת-עדות נרשמת בדיוק, לא-מומצאת.
//   P6 · ראש-הספר נחתם-עדות לספר-הרשת (proof-book-attest) — שכחה
//        מבחוץ דורשת שבירת-שרשרת חתומה 1309+ רשומות.
// ─────────────────────────────────────────────────────────────────────

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const REGISTRY_PATH = path.resolve(
  import.meta.dir,
  "../sovereign/proofs/proof-registry.jsonl",
);
export const GENESIS = crypto
  .createHash("sha256")
  .update("SOVEREIGN-PROOF-REGISTRY-GENESIS · R208P · trace 1a10e219d0860c0d")
  .digest("hex");

export type Verdict =
  | "PROVEN"
  | "OPEN"
  | "REFUTED"
  | "STRENGTHENED"
  | "RESOLVED-BY-DECISION"
  | "UNOBSERVED";

export type Scope = "LAB" | "LIVE" | "STRUCTURAL" | "NETWORK";

export interface ProofEntry {
  seq: number;
  at: string;
  claimId: string;
  claim: string;
  verdict: Verdict;
  scope: Scope;
  round: string;
  law?: string;
  evidence: { path: string; sha256: string }[];
  reproduction?: { cmd: string; expect: string };
  lastRepro?: { at: string; exit: number; note: string };
  prevHash: string;
  entryHash: string;
}

export function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

export function canonicalEntry(e: Omit<ProofEntry, "entryHash">): string {
  // קנון יציב: מפתחות בסדר-הכרזה, JSON בלי רווחים, כולל prevHash — לא entryHash.
  return JSON.stringify(e);
}

export function hashEntry(e: Omit<ProofEntry, "entryHash">): string {
  return crypto.createHash("sha256").update(canonicalEntry(e)).digest("hex");
}

export function readRegistry(): ProofEntry[] {
  if (!fs.existsSync(REGISTRY_PATH)) return [];
  const lines = fs
    .readFileSync(REGISTRY_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  return lines.map((l) => JSON.parse(l) as ProofEntry);
}

export function headHash(entries: ProofEntry[]): string {
  return entries.length
    ? entries[entries.length - 1]!.entryHash
    : GENESIS;
}

export function verifyRegistry(entries: ProofEntry[]): {
  ok: boolean;
  brokenAt?: number;
  reason?: string;
} {
  let prev = GENESIS;
  for (const e of entries) {
    const { entryHash, ...rest } = e;
    const rec = rest as Omit<ProofEntry, "entryHash">;
    if (rec.prevHash !== prev)
      return { ok: false, brokenAt: e.seq, reason: "prevHash-לא-תואם-ראש" };
    if (hashEntry(rec) !== entryHash)
      return { ok: false, brokenAt: e.seq, reason: "entryHash-שונה-מהקנון" };
    prev = entryHash;
  }
  return { ok: true };
}

export interface AppendInput {
  claimId: string;
  claim: string;
  verdict: Verdict;
  scope: Scope;
  round: string;
  law?: string;
  evidence: { path: string; sha256?: string }[];
  reproduction?: { cmd: string; expect: string };
  lastRepro?: { at: string; exit: number; note: string };
}

/** רישום-חדש. מגן מפני כפילות claimId זהה-באותו-verdict (חוק P1). */
export function appendProof(input: AppendInput): ProofEntry {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  const entries = readRegistry();
  // כספת-עדויות: כל עדות מועתקת בזמן-הרישום ל-sovereign/proofs/evidence/<seq>/
  // — הראיה נקפאת לעד (הארטיפקט-החי ימשיך לחיות; הרישום מחויב לעותק-הקפוא).
  const seqNext = entries.length + 1;
  const vaultDir = path.join(path.dirname(REGISTRY_PATH), "evidence", String(seqNext));
  const evidence = input.evidence.map((ev) => {
    const src = path.resolve(ev.path);
    fs.mkdirSync(vaultDir, { recursive: true });
    const dest = path.join(vaultDir, path.basename(src));
    try {
      fs.copyFileSync(src, dest);
    } catch (err) {
      // עדות-פקודתית (לא קובץ) — רשאית להיעדר מהדיסק; קובץ-קיים-שנכשל-העתקה = שגיאה
      if (fs.existsSync(src)) throw new Error(`עדות-לא-ניתנת-להעתקה: ${src} · ${String(err).slice(0, 80)}`);
    }
    const frozen = fs.existsSync(dest) ? dest : src;
    return { path: frozen, sha256: ev.sha256 ?? sha256File(frozen) };
  });
  const lastSame = [...entries]
    .reverse()
    .find((e) => e.claimId === input.claimId);
  // P1 — מניעת-כפילות לפי טביעת-אצבע-תוכן (claimId+verdict+תוכן מלא).
  // זהה-לחלוטין ⇒ נדחה; רוויזיה-כנה (פקודת-שחזור/ניסוח/עדות-חדשה) ⇒ רשומה-עוקבת.
  if (lastSame && lastSame.verdict === input.verdict) {
    const fp = (claim: string, evp: string[], rep?: { cmd: string; expect: string }) =>
      crypto.createHash("sha256").update(JSON.stringify([claim, evp, rep?.cmd, rep?.expect])).digest("hex");
    const fpNew = fp(input.claim, evidence.map((e) => e.path), input.reproduction);
    const fpOld = fp(lastSame.claim, lastSame.evidence.map((e) => e.path), lastSame.reproduction);
    if (fpNew === fpOld) {
      throw new Error(
        `P1-מניעת-כפילות: ${input.claimId} כבר רשום עם תוכן-זהה (${input.verdict}) ב-seq ${lastSame.seq} — עדכון מצריך תוכן-חדש או הפרכה`,
      );
    }
  }
  const base: Omit<ProofEntry, "entryHash"> = {
    seq: entries.length + 1,
    at: new Date().toISOString(),
    claimId: input.claimId,
    claim: input.claim,
    verdict: input.verdict,
    scope: input.scope,
    round: input.round,
    law: input.law,
    evidence,
    reproduction: input.reproduction,
    lastRepro: input.lastRepro,
    prevHash: headHash(entries),
  };
  const entry: ProofEntry = { ...base, entryHash: hashEntry(base) };
  fs.appendFileSync(REGISTRY_PATH, JSON.stringify(entry) + "\n");
  return entry;
}

/** רשומה-אחרונה-ל-claimId (המסקנה התקפה כרגע). */
export function latestByClaim(entries: ProofEntry[]): Map<string, ProofEntry> {
  const m = new Map<string, ProofEntry>();
  for (const e of entries) m.set(e.claimId, e); // אחרון גובר (P1)
  return m;
}
