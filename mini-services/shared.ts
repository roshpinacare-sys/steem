// ─────────────────────────────────────────────────────────────────────
// MINI-SERVICES · SHARED — גרעין-השפה המשותף של הצי (r147-d · D-r147-BLOC)
//
// הוראת-המפעיל (r147): "לא שכבות שכל אחת מדברת בשפה שונה והורגות אחד
// את השני — אנחנו גוף אחד חדשני". נמדד בביקורת-הגוף (one-bloc audit):
// אותן שלוש פונקציות-חוק הועתקו ידנית בכל דיבון — שרשרת-גיבוב sha256
// (4 עותקים), כתיבת-מצב אטומית R107b (14 עותקים), מתג-איש-מת r143-c
// (12 עותקים). מעכשיו: גוף-אחד, שפה-אחת — כל דיבון מייבא מכאן.
//
// גבולות-חוק:
//   · טהור לחלוטין — node:crypto/node:fs בלבד, אפס תלות, אפס I/O רשת,
//     אפס מצב-עולם משלו — כדי שעצמאות-הדיבונים לא תישבר (כל דיבון
//     נשאר תהליך-יחיד נפרד; זהו ספריית-עזר, לא שירות).
//   · אותו קנון-גיבוב של יומן-ההחלטות: sha256 על JSON.stringify של
//     הרשומה פרט ל-entryHash שלה (סדר-שדות-דיסק נשמר) · prevHash של
//     seq=1 הוא "GENESIS". שינוי-קנון כאן = שינוי-קנון לכל הרשת.
//   · מתג-איש-מת: טיק 60ש' · שתיקה מעל stallMs ⇒ שורה כנה ביומן-הדיבון
//     ויציאה exit(1) — fleet-guard מקים תהליך-טרי (r143-c) · משמר-
//     גלובלי חד-פעמי (R80 — טעינה-חמה לא מכפילה שומרים).
//     יוצא-מכלל (חוק-r190): מנוע-הגריד (market-maker, :3049) — סמכות-
//     החייאה-היחידה-עליו היא keeper (:3036), לא fleet-guard; המתג-שלו
//     רק-מודיע-אמת-ויוצא, וה-keeper-מקים (דילוג-מפורש-גם-ב-fleet-guard).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// ── 1) שרשרת-הגיבוב הריבונית — אותה-שיטת-ראיה של יומן-ההחלטות ────────

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

/** הרשומה חתומה על כל-תוכנה פרט ל-entryHash שלה (קנון היומן — נמדד). */
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

// ── 2) כתיבה-אטומית — חוק R107b: .tmp ואז rename ─────────────────────
// רגע-מוות באמצע כתיבה לא משאיר ליורש קובץ חצוי. התיקייה נוצרת במידת-הצורך
// (recursive) — זהה-התנהגות לכל העותקים ההיסטוריים שנמדדו.

export function writeTextAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

export function writeJsonAtomic(file: string, data: unknown, space: number = 2): void {
  writeTextAtomic(file, `${JSON.stringify(data, null, space)}`);
}

// ── 3) מתג-איש-מת — r143-c · טיק 60ש' · שתיקה ⇒ רישום כן + exit(1) ────

// חוק-r190 — סמכות-החייאה היחידה ל-3049 היא keeper — דילוג-מפורש.
// מתג-איש-המת אינו-סמכות-החייאה — הוא-חיישן-אמת: רושם-ומוציא (exit 1).
// לגבי-כל-הדיבונים-מי-שמקים-אחרי-היציאה-הוא-fleet-guard (r143-c) — וכך
// יישאר. לגבי-מנוע-הגריד (market-maker, :3049) ההקמה-אחרי-היציאה-היא
// אחריות-ה-keeper-בלבד (mini-services/keeper · mmGuard/MM-REVIVE) — fleet-guard
// מדלג-עליו-במפורש (חוק-r190 שם). ההתנהגות-עבור-שאר-הדיבונים-ללא-שינוי.
const SOLE_KEEPER_REVIVAL_PORT: Record<string, number> = { "market-maker": 3049 };

export interface DeadManOptions {
  /** מפתח-המשמר הגלובלי (R80) — טעינה-חמה של אותו דיבון מחליפה את הטיימר, לא מכפילה */
  id: string;
  /** חותמת-הפעימה האחרונה ב-ms (מספר-חי או פרס של state.lastBeatAt/bootedAt) */
  lastMs: () => number;
  /** שתיקה מעל זה ⇒ יציאה לתחייה (חוק r143-c: max(3×קצב, 10 דק') לפי הדיבון) */
  stallMs: number;
  /** יומן-הדיבון — שורת-המוות נרשמת בו לפני היציאה */
  logFile: string;
  /** מי מדווח על שתיקה: "beats" (ברירת-מחדל) או "patrol" (השומר) */
  subject?: string;
  /** ברירת-מחדל 60_000 (r143-c) */
  tickMs?: number;
}

export function installDeadManWatch(o: DeadManOptions): ReturnType<typeof setInterval> {
  const G = globalThis as unknown as Record<string, ReturnType<typeof setInterval> | undefined>;
  const key = `__DEADMAN__${o.id}`;
  const prior = G[key];
  if (prior) clearInterval(prior);
  const subject = o.subject ?? "beats";
  const timer = setInterval(() => {
    const lastMs = o.lastMs();
    if (Number.isFinite(lastMs) && Date.now() - lastMs <= o.stallMs) return;
    // חוק-r190 — סמכות-החייאה היחידה ל-3049 היא keeper — הכרזה-כנה-בשורת-המוות
    // (הערה-היסטורית-שגויה-"fleet-guard יקים" אינה-נכונה-עוד-עבור-המנוע)
    const solePort = SOLE_KEEPER_REVIVAL_PORT[o.id];
    const soleNote = solePort ? ` — סמכות-החייאה היחידה ל-${solePort} היא keeper — חוק-r190 (לא fleet-guard)` : "";
    const msg = `dead-man: ${subject} stalled >${Math.round(o.stallMs / 60_000)}min — exiting for revival${soleNote}`;
    try {
      fs.mkdirSync(path.dirname(o.logFile), { recursive: true });
      fs.appendFileSync(o.logFile, `${new Date().toISOString()} ${msg}\n`);
    } catch {}
    console.log(msg);
    process.exit(1);
  }, o.tickMs ?? 60_000);
  G[key] = timer;
  return timer;
}
