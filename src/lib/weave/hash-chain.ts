// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Hash-Chain Kernel — גרעין-שרשרת-הגיבוב הריבוני (r147-d)
//
// הוראת-המפעיל (r147): "אנחנו גוף אחד חדשני" — ביקורת-הגוף (one-bloc
// audit) מדדה 4 עותקים של אותו מנגנון (יומן-ההחלטות, פנקס-ה-PnL,
// דיג'סטי-הסייר, מבקר-האוצר). מעכשיו קנון אחד כאן ומקבילו בצד-הדיבונים
// (mini-services/shared.ts — העתק-תאום נדרש כדי לשמור על עצמאותם
// מעץ-src; שני הגרעינים נבדקים ביט-מול-ביט מול אותן שרשרות).
//
// קנון-החתימה (זהה ביט-ביט למה שנכתב עד היום — אסור לשנות):
//   · entryHash = sha256( JSON.stringify(הרשומה פרט ל-entryHash) )
//   · סדר-המפתחות = סדר-הדיסק (JSON.stringify שומר סדר-הכנסה)
//   · prevHash של הרשומה הראשונה = "GENESIS"
// ─────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

export const CHAIN_GENESIS = "GENESIS";

export interface HashChainEntry {
  seq?: number;
  prevHash?: string;
  entryHash?: string;
}

export interface ChainVerdict {
  ok: boolean;
  brokenAt: number | null;
  entries: number;
}

/** הרשומה חתומה על כל-תוכנה פרט ל-entryHash שלה. */
export function hashChainEntry(entry: object): string {
  const { entryHash: _omit, ...rest } = entry as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

/** אימות-שרשרת: כל prevHash תואם את entryHash של קודמו, וכל entryHash תואם את תוכנו. */
export function verifyHashChain(entries: Array<Record<string, unknown>>): ChainVerdict {
  let prev = CHAIN_GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const seq = Number(e.seq ?? i + 1);
    if (i === 0 ? e.prevHash !== CHAIN_GENESIS : e.prevHash !== prev) {
      return { ok: false, brokenAt: seq, entries: entries.length };
    }
    if (hashChainEntry(e) !== e.entryHash) {
      return { ok: false, brokenAt: seq, entries: entries.length };
    }
    prev = String(e.entryHash);
  }
  return { ok: true, brokenAt: null, entries: entries.length };
}
