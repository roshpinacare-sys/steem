/**
 * merkle-client — השחזור הדפדפני המדויק של מתמטיקת הקרנל (kernel.cjs + merkle.cjs).
 *
 * חוקי-האריגה קבועים-חוזה, זהים byte-ל-byte לקרנל:
 *   · canon(v)          — JSON קנוני: מפתחות-ממוינים, בלי-רווחים, רקורסיבי
 *   · weaveLeaf(entry)  — sha256(canon({h, seq, kind, by, at, salt})) — salt/at תמיד-נוכחים (null כשאין)
 *   · fold              — sha256(left_hex ‖ right_hex) — שרשור-מחרוזות-golmiyot
 *   · odd level         — העלה-האחרון מוכפל (Bitcoin-style, דטרמיניסטי)
 *   · path step         — pos:'L' → sha256(sib ‖ cur) · pos:'R' → sha256(cur ‖ sib)
 *
 * הכל רץ ב-Web Crypto — האימות קורה במכשיר המשתמש, לא על שרתי-הנול.
 */

export interface LeafEntry {
  h: string;
  seq: number;
  kind: string;
  by: string;
  at: string | null;
  salt: string | null;
}

export interface PathStep {
  pos: "L" | "R";
  h: string;
}

/* ── canon — זהה ל-canon של הקרנל (מפתחות-ממוינים, בלי-רווחים) ── */
export function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) as string;
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") +
    "}"
  );
}

/* ── sha256 מחרוזת → hex (Web Crypto — רץ בדפדפן) ── */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ── weaveLeaf — זהה לקרנל: salt/at תמיד-נוכחים בעצם (null כשאין) ── */
export function canonLeaf(e: LeafEntry): string {
  return canon({ h: e.h, seq: e.seq, kind: e.kind, by: e.by, at: e.at, salt: e.salt });
}

export async function weaveLeafOf(e: LeafEntry): Promise<string> {
  return sha256Hex(canonLeaf(e));
}

/* ── צעד-קיפול אחד: cur ‖ sib לפי pos ── */
export async function foldStep(cur: string, step: PathStep): Promise<string> {
  return step.pos === "L" ? sha256Hex(step.h + cur) : sha256Hex(cur + step.h);
}

/* ── אימות-נתיב מלא — מחזיר את-כל-הצעדים לתצוגה ── */
export interface FoldStepResult {
  step: number;
  pos: "L" | "R";
  sibling: string;
  before: string;
  after: string;
}

export async function foldAll(
  leaf: string,
  path: PathStep[]
): Promise<{ steps: FoldStepResult[]; final: string }> {
  let cur = leaf;
  const steps: FoldStepResult[] = [];
  for (let i = 0; i < path.length; i++) {
    const after = await foldStep(cur, path[i]);
    steps.push({ step: i + 1, pos: path[i].pos, sibling: path[i].h, before: cur, after });
    cur = after;
  }
  return { steps, final: cur };
}

export const HEX64 = /^[0-9a-f]{64}$/;
