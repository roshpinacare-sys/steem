// ─────────────────────────────────────────────────────────────────────
// MONEY · INTENTS (R208P) — ספר-כוונות write-ahead לפעולות-כסף
//
// הכרעת חלון-הכפילות intent-last (ממצא-כנה של R208R §XVIII, K7):
// מוות בין-שידור-חוץ לשמירת-תוצאה השאיר את תוצאת-החוץ בלתי-ידועה,
// והיורש יכול היה לירות שוב (K7: actions=2 — הודגם-חי).
//
// ההכרעה (trace 1a10e219d0860c0d): **write-ahead intent** —
//   1. כל פעולה רושמת כוונה חתומת-hash לספר לפני השידור-החוץ.
//   2. התוצאה סוגרת את הכוונה (CLOSE) אחרי-העובדה.
//   3. עלייה-חדשה שמוצאת כוונה-פתוחה: סוגרת אותה כ-UNRESOLVED-AT-BOOT
//      (תוצאת-חוץ = UNKNOWN לעולם לא מומצאת) ודוחה ירי-חוזר של
//      אותה (action,target) עד שקט-עולם (30 דק' = הצינון-החוקי R93).
//   4. אפס-נגיעה בסמנטיקת ספר-ההיסטוריה הקיים — ספר-נפרד, תוספת-בלבד.
//
// חוק: כוונה-פתוחה היא עדות חיה; היא נסגרת רק בתוצאה אמיתית או
// בהכרזת-UNKNOWN כנה. אסור לסגור-שקט, אסור לשכוח, אסור לירות-עליה.
// ─────────────────────────────────────────────────────────────────────

import * as crypto from "node:crypto";
import * as fs from "node:fs";

const HOME = "/home/z/my-project";
// INTENT_BOOK — הפניית-מעבדה בלבד (R208P intent-lab): בחי המשתנה אינו נקבע
// והספר הוא תמיד ספר-הכוונות החי. מעבדות מנתבות ספר-משלהן בלי לגעת בחי.
const BOOK = process.env.INTENT_BOOK ?? `${HOME}/sovereign/money/intents.jsonl`;
const GENESIS = crypto
  .createHash("sha256")
  .update("MONEY-INTENTS-GENESIS · R208P · intent-first · trace 1a10e219d0860c0d")
  .digest("hex");
const SUPPRESS_MIN = 30; // דקות — הצינון-החוקי (R93) כמשך-השתקת-ירי

export interface IntentRecord {
  seq: number;
  at: string;
  kind: "INTENT" | "CLOSE";
  intentId?: string;
  action?: string;
  target?: string;
  tag?: string | null;
  reason?: string;
  closeKind?: string;
  ok?: boolean;
  suppressUntil?: string | null;
  prevHash: string;
  entryHash: string;
}

function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function readBook(): IntentRecord[] {
  if (!fs.existsSync(BOOK)) return [];
  return fs
    .readFileSync(BOOK, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as IntentRecord);
}

function appendRecord(rec: Omit<IntentRecord, "seq" | "prevHash" | "entryHash">): IntentRecord {
  fs.mkdirSync(`${HOME}/sovereign/money`, { recursive: true });
  const book = readBook();
  const prevHash = book.length ? book[book.length - 1].entryHash : GENESIS;
  const seq = book.length + 1;
  const base = { ...rec, seq, prevHash };
  const entry: IntentRecord = { ...base, entryHash: sha(JSON.stringify(base)) };
  fs.appendFileSync(BOOK, JSON.stringify(entry) + "\n");
  return entry;
}

/** כוונה-חדשה — נרשמת לפני השידור-החוץ. מחזיר intentId. */
export function appendIntent(spec: { action: string; target: string; tag?: string | null; reason: string }): string {
  const intentId = `I${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  appendRecord({
    at: new Date().toISOString(),
    kind: "INTENT",
    intentId,
    action: spec.action,
    target: spec.target,
    tag: spec.tag ?? null,
    reason: String(spec.reason).slice(0, 160),
  });
  return intentId;
}

/** סגירת-כוונה בתוצאה אמיתית. */
export function closeIntent(intentId: string, closeKind: string, ok: boolean): void {
  appendRecord({
    at: new Date().toISOString(),
    kind: "CLOSE",
    intentId,
    closeKind,
    ok,
    suppressUntil: null,
  });
}

/** כוונות-פתוחות כרגע (INTENT ללא CLOSE-עוקב). */
export function openIntents(): IntentRecord[] {
  const book = readBook();
  const closed = new Set<string>();
  const opened: IntentRecord[] = [];
  for (const r of book) {
    if (r.kind === "INTENT" && r.intentId) opened.push(r);
    if (r.kind === "CLOSE" && r.intentId) closed.add(r.intentId);
  }
  return opened.filter((r) => !closed.has(r.intentId!));
}

/** יישוב-עלייה: כל כוונה-פתוחה נסגרת כ-UNKNOWN כנה + השתקת-ירי-חוזר. */
export function bootReconcileIntents(): { closed: number; suppressed: string[] } {
  const open = openIntents();
  const suppressed: string[] = [];
  for (const o of open) {
    const until = new Date(Date.now() + SUPPRESS_MIN * 60_000).toISOString();
    appendRecord({
      at: new Date().toISOString(),
      kind: "CLOSE",
      intentId: o.intentId,
      closeKind: "UNRESOLVED-AT-BOOT",
      ok: false,
      suppressUntil: until,
    });
    suppressed.push(`${o.action}/${o.target}`);
  }
  return { closed: open.length, suppressed };
}

/** האם (action,target) מושתק מירי — כוונה-בלתי-פתורה טרייה. */
export function isSuppressed(action: string, target: string): boolean {
  const now = Date.now();
  const book = readBook();
  for (const r of book) {
    if (r.kind !== "CLOSE" || r.closeKind !== "UNRESOLVED-AT-BOOT" || !r.intentId || !r.suppressUntil) continue;
    if (new Date(r.suppressUntil).getTime() <= now) continue;
    // הכוונה המקורית של intentId זה
    const orig = book.find((x) => x.kind === "INTENT" && x.intentId === r.intentId);
    if (orig && orig.action === action && orig.target === target) return true;
  }
  return false;
}

/** שרשרת-הספר תקינה (לשער-ההוכחות). */
export function verifyIntentsBook(): boolean {
  let prev = GENESIS;
  for (const r of readBook()) {
    const { entryHash, ...rest } = r;
    if (rest.prevHash !== prev) return false;
    if (sha(JSON.stringify(rest)) !== entryHash) return false;
    prev = entryHash;
  }
  return true;
}
