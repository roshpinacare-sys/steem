// ─────────────────────────────────────────────────────────────────────
// r191 · חוק-ייחוס-פקודות (ORDER ATTRIBUTION LAW) — מוביל-הכסף
//
// הממצא שסגר את החוק (r190, נמדד חי): סוכני-גיט אחים הציבו פקודות על
// אותו חשבון (headcorner · סכמה קטנה <700M, למשל 889901/2/11, פקיעה
// 7-ימים) וגל-הביטול של המוביל טרף אותן — חור-תיאום בין-סוכנים על
// חשבון-משותף. המפעיל אסר החלטות-בעלים → התיקון אוטונומי: ייחוס לפי-
// הוכחה.
//
// החוק (fail-safe): המוביל מבטל רק פקודה שיוכח שהוצבה על-ידיו —
//   (a) orderid רשום ב-sovereign/money/our-orders.jsonl — רישום-הצבה
//       חי (append אטומי, שורת-JSON אחת) שנכתב ברגע ההצבה; או
//   (b) orderid בסכמה-משלנו שכבר מטופלת בקוד: סכמת-היום של המוביל
//       (YYYYMMDD + ספרות — מכירות 01-05 · קניות 91-95 · מלאי 7 ·
//       רגל-HIVE day×100+i). הסכמה היא חתימת-הקוד שלנו מ-r145/r101.
//   כל פקודה חיה שאינה מיוחסת = זרה → דילוג מוחלט, ספירה כ-
//   foreignSkipped. פקודות-הגריד (טווח-שמור r190) נשארות מוגנות כמקודם.
//   ברירת-המחדל הכושלת-בבטחה: לא מבטלים מה שאין הוכחה שאנחנו הצבנו.
//
// זריעה (backfill): בריצה-הראשונה, אם הרישום חסר — נזרע מהקבלות
// השמורות של המוביל (sovereign/money/history.json · מערכי placed בלבד —
// הוכחת-הצבה שנרשמה בזמן-אמת). מערכי cancelled אינם הוכחת-הצבה ואינם
// נזרעים; מה שאינו מוכח — נשאר זר.
//
// הערת-מרחב: היומן משותף לרגלי-STEEM ו-HIVE (אותו חשבון, שתי שרשרות) —
// השדה kind מבדיל ("HIVE-REPRICE" מול "REPRICE"/"ARM-BUY"/…). ערכי-
// orderid עשויים לחפוף בין השרשרות (שתיהן סכמת-יום) — הדבר אינו מזיק
// לייחוס: שתי הסכמות משלנו, והביטול מתבצע על השרשרת שבה נקראה הפקודה.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

export const OUR_ORDERS_FILE = "/home/z/my-project/sovereign/money/our-orders.jsonl";
export const MOVER_HISTORY_FILE = "/home/z/my-project/sovereign/money/history.json";

/** תקרת-רשימת-המזהים הזרים בלוגים/קבלות — מניעת-רעש; המניין תמיד מדויק */
export const FOREIGN_LOG_CAP = 20;

export interface OurOrderEntry {
  orderid: number;
  ts: string;
  txid: string | null;
  kind: string;
  expiry: string | null;
}

// (b) סכמת-היום של המוביל: YYYYMMDD + 1–2 ספרות (9–10 ספרות, תחילית שנה 2026+,
// חודש/יום תקינים). זו החתימה הקיימת בקוד המוביל וברגל-HIVE — ייחוס-סכמה, לא
// ייחוס-הוכחה: היא נשארת תקפה רק לפקודות שהקוד שלנו יוצר (אין סוכן-אח ידוע
// שמשתמש בה).
export function isMoverDateSchema(orderid: number): boolean {
  const s = String(orderid);
  if (!/^\d{9,10}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (y < 2026 || y > 2100) return false;
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return false;
  return true;
}

// (a) קריאת הרישום — סלחנית בכנות: שורה פגומה מדולגת, קובץ חסר = מפה ריקה
// (ואז רק סעיף (b) והוכחות-סכמה מייחסות). המופע האחרון ל-orderid גובר.
export function readOurOrders(): Map<number, OurOrderEntry> {
  const out = new Map<number, OurOrderEntry>();
  try {
    const raw = fs.readFileSync(OUR_ORDERS_FILE, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const e = JSON.parse(t) as OurOrderEntry;
        const id = Number(e?.orderid);
        if (Number.isFinite(id) && id > 0) out.set(id, { ...e, orderid: id });
      } catch {
        /* שורה פגומה — דילוג כנה, לא קריסה */
      }
    }
  } catch {
    /* קובץ חסר — עדיין אין רישום */
  }
  return out;
}

// רישום-הצבה — append אטומי (O_APPEND · שורת-JSON אחת < 4KB). כתיבה
// נכשלת אינה מפילה הצבה שכבר חיה על השרשרת — אך חייבת להיות נראית:
// הקורא מחזיר false והמוביל רושם שגיאה לקבלה (כנות r125a).
export function appendOurOrder(entry: OurOrderEntry): boolean {
  try {
    const line = JSON.stringify(entry) + "\n";
    const fd = fs.openSync(OUR_ORDERS_FILE, "a");
    try {
      fs.writeSync(fd, line);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

// זריעה/השלמה: בריצה-הראשונה, אם היומן חסר — נזרע מהקבלות השמורות
// (history.json · מערכי placed בלבד — הוכחת-הצבה). כתיבה אטומית (tmp+rename).
// קריאה חוזרת על קובץ-קיים = no-op. כישלון-זריעה אינו זרק — היומן נשאר חסר
// והייחוס נופל לסעיף (b) בלבד (fail-safe).
export function ensureOurOrdersSeeded(): { seeded: number; source: string } {
  try {
    if (fs.existsSync(OUR_ORDERS_FILE)) return { seeded: 0, source: "exists" };
    let seeded = 0;
    const lines: string[] = [];
    try {
      const hist = JSON.parse(fs.readFileSync(MOVER_HISTORY_FILE, "utf8")) as Array<Record<string, unknown>>;
      for (const r of Array.isArray(hist) ? hist : []) {
        const kind = String(r?.kind ?? "UNKNOWN");
        const at = String(r?.at ?? new Date().toISOString());
        const placed = Array.isArray(r?.placed) ? (r.placed as Array<Record<string, unknown>>) : [];
        for (const p of placed) {
          const id = Number(p?.orderid);
          if (!Number.isFinite(id) || id <= 0) continue; // ספירות (מספר) אינן הוכחה
          lines.push(
            JSON.stringify({
              orderid: id,
              ts: at,
              txid: typeof p?.txid === "string" ? (p.txid as string) : null,
              kind,
              expiry: null,
            } satisfies OurOrderEntry),
          );
          seeded += 1;
        }
      }
    } catch {
      /* אין היסטוריה קריאה — זריעה ריקה אך הקובץ נוצר (היומן חי מעתה) */
    }
    const tmp = OUR_ORDERS_FILE + ".tmp";
    fs.writeFileSync(tmp, lines.length ? lines.join("\n") + "\n" : "", { mode: 0o644 });
    fs.renameSync(tmp, OUR_ORDERS_FILE);
    return { seeded, source: "backfill-history" };
  } catch {
    return { seeded: 0, source: "backfill-failed" };
  }
}

// עוזר-ההכרעה האחד לכל נתיבי-הביטול: (a) רישום-חי או (b) סכמה-משלנו.
// פקודה שאינה מיוחסת כאן = זרה — לעולם לא נבטל.
export function isAttributedToMover(orderid: number, ours: Map<number, OurOrderEntry>): boolean {
  return ours.has(Number(orderid)) || isMoverDateSchema(orderid);
}
