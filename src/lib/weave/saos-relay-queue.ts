// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · saos-relay-queue (r144-g2) — תור-הריליי הריבוני של
// רישומי-הארנק. קובץ טהור (אפס יבוא מה-weave) כדי שגם הרייל
// (saos-rail) וגם מפרסם-הקיפול (saoslite) יוכלו לקרוא אותו בלי
// מעגל-ייבוא.
//
// החוקה:
//   · רק מעטפות `wallet.create` חתומות-בידי-בעל-הארנק עצמו. הריליי
//     הוא תעבורה בלבד (דוקטרינת saos.live.v1): אין כאן ולא יהיה
//     חומר-מפתח פרטי — החתימה הפנימית היא הסמכות, הקיפול הוא השופט.
//   · append-only: רשומות נוספות או מסומנות-מחדש (status) — לעולם
//     לא נמחקות. רשומות בדיקה נושאות test:true ולעולם לא משודרות.
//   · מה שלא שודר מיידית (שער-RC, אין מפתח-תעבורה בסביבה הזו) נשאר
//     queued ומשוטף בפרסום-הקיפול הבא — בדיוק כמו הג'נזיס: פעולה
//     אחת-בכל-פעימה, השרשרת היא השופט.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";

export const RELAY_QUEUE_REL = "sovereign/saos/relay-queue.json";

export interface SaosRelayEntry {
  /** מזהה-התור = מזהה-המעטפה החתומה (queueId בפנייה לציבור) */
  id: string;
  queuedAt: string;
  /** מטא `signedAt` שהלקוח דיווח — לא חתום, לא חלק מהקנון */
  signedAt?: string;
  source: "relay";
  /** רשומות בדיקה: לעולם לא משודרות, לעולם לא נמחקות */
  test: boolean;
  status: "queued" | "broadcast" | "flushed" | "rejected" | "registered";
  /** המעטפה החתומה המלאה — פומבית לגמרי (pub + sig, אפס חומר-פרטי) */
  env: Record<string, unknown>;
  txid?: string;
  broadcastAt?: string;
  note?: string;
}

export interface SaosRelayQueueFile {
  format: "saos-relay-queue-v1";
  updatedAt: string;
  entries: SaosRelayEntry[];
}

const ID_RE = /^[0-9]{12,14}-[0-9a-f]{8,12}$/;
const ADDR_RE = /^saos1[1-9A-HJ-NP-Za-km-z]{33,35}$/;
const PUB_RE = /^STM[1-9A-HJ-NP-Za-km-z]{50}$/;
const SIG_RE = /^[0-9a-f]{130}$/;

export function relayQueuePath(): string {
  return path.join(process.cwd(), RELAY_QUEUE_REL);
}

export function readRelayQueue(): SaosRelayQueueFile {
  try {
    const raw = JSON.parse(fs.readFileSync(relayQueuePath(), "utf8")) as SaosRelayQueueFile;
    if (raw.format === "saos-relay-queue-v1" && Array.isArray(raw.entries)) return raw;
  } catch {
    /* נולד עכשיו */
  }
  return { format: "saos-relay-queue-v1", updatedAt: new Date(0).toISOString(), entries: [] };
}

function writeRelayQueue(q: SaosRelayQueueFile): void {
  q.updatedAt = new Date().toISOString();
  const p = relayQueuePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
}

/** הוספה בלבד — רשומה עם id קיים לא נדרסת (append-only) */
export function appendRelayQueueEntry(entry: SaosRelayEntry): boolean {
  const q = readRelayQueue();
  if (q.entries.some((e) => e.id === entry.id)) return false;
  q.entries.push(entry);
  writeRelayQueue(q);
  return true;
}

/** סימון-מצב בלבד — הרשומה עצמה (והמעטפה) לעולם לא נמחקות */
export function markRelayQueueEntry(id: string, patch: Partial<Pick<SaosRelayEntry, "status" | "txid" | "broadcastAt" | "note">>): void {
  const q = readRelayQueue();
  const e = q.entries.find((x) => x.id === id);
  if (!e) return;
  if (patch.status !== undefined) e.status = patch.status;
  if (patch.txid !== undefined) e.txid = patch.txid;
  if (patch.broadcastAt !== undefined) e.broadcastAt = patch.broadcastAt;
  if (patch.note !== undefined) e.note = patch.note;
  writeRelayQueue(q);
}

export interface RelayShapeResult {
  ok: boolean;
  detail: string;
  /** המעטפה הקנונית — רק השדות החתומים (מטא מנותק) */
  env?: Record<string, unknown>;
  signedAt?: string;
}

/** אימות-צורה אכזרי לפני כל דבר — אותם כללי צורה שהקיפול דורש,
 *  ורק `wallet.create`: הריליי מעביר זהות, לא כסף. מטא `at`
 *  מנותק מהמעטפה (הקיפול סובל אותו אך הוא לא חתום ולא נשלח). */
export function validateRelayWalletCreateShape(input: unknown): RelayShapeResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, detail: "BODY: envelope חייב להיות אובייקט" };
  }
  const raw = input as Record<string, unknown>;
  const signedAt = typeof raw.signedAt === "string" && raw.signedAt.length <= 40 ? raw.signedAt : undefined;

  // צורה שטוחה (תאימות): {address, pubKey, label?, signature, id} — אותו קנון בדיוק
  let env: Record<string, unknown> = raw;
  if (!raw.k && (raw.address || raw.pubKey || raw.signature)) {
    if (typeof raw.address !== "string" || typeof raw.pubKey !== "string" || typeof raw.signature !== "string" || typeof raw.id !== "string") {
      return { ok: false, detail: "FLAT: צריך address + pubKey + signature + id (ה-id חלק מהקנון החתום — אסור להמציא אותו)" };
    }
    env = { v: 1, k: "wallet.create", id: raw.id, by: raw.address, pub: raw.pubKey, sig: raw.signature };
    if (typeof raw.label === "string" && raw.label.length) env.nick = raw.label;
  }

  if (env.v !== 1) return { ok: false, detail: "VERSION: env.v חייב להיות 1" };
  if (env.k !== "wallet.create") {
    return { ok: false, detail: "KIND: הריליי משדר רישום-ארנק בלבד (wallet.create) — פעולות כסף נחתמות ונשפטות על השרשרת עצמה" };
  }
  if (typeof env.id !== "string" || !ID_RE.test(env.id)) return { ok: false, detail: "BAD-ID: המזהה חייב להיות <millis>-<hex> (כמו ש-buildOp מייצר)" };
  if (typeof env.by !== "string" || !ADDR_RE.test(env.by)) return { ok: false, detail: "BAD-ADDR: כתובת saos1… שגויה" };
  if (typeof env.pub !== "string" || !PUB_RE.test(env.pub)) return { ok: false, detail: "BAD-PUB: הפומבי חייב להיות STM… (50 תווים)" };
  if (typeof env.sig !== "string" || !SIG_RE.test(env.sig)) return { ok: false, detail: "BAD-SIG: החתימה חייבת להיות 130 hex" };
  if (env.nick !== undefined) {
    if (typeof env.nick !== "string" || env.nick.length < 1 || env.nick.length > 24 || !/^[\u0590-\u05FFa-zA-Z0-9 ._-]+$/.test(env.nick)) {
      return { ok: false, detail: "BAD-NICK: 1-24 תווים (עברית/לטיני/ספרות/רווח/._-)" };
    }
  }
  // הקנון הוא החוזה: שדה-זר אחד = דחייה (כמו הקיפול, בדיוק)
  const allowed = new Set(["v", "id", "k", "by", "pub", "sig", "nick"]);
  for (const key of Object.keys(env)) {
    if (!allowed.has(key)) return { ok: false, detail: `UNEXPECTED-FIELD: ${key} אינו חלק מהחוזה` };
  }
  const clean: Record<string, unknown> = { v: 1, id: env.id as string, k: "wallet.create", by: env.by as string, pub: env.pub as string, sig: env.sig as string };
  if (env.nick !== undefined) clean.nick = env.nick as string;
  return { ok: true, detail: "ok", env: clean, signedAt };
}
