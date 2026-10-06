// ─────────────────────────────────────────────────────────────────────
// SWR — מטמון stale-while-revalidate עם single-flight לשרת הריבוני.
//
// לקח-השורש מ-R52 (נמדד חי ביומן ה-dev): מטמוני-TTL רגילים נראים
// תקינים בקוד אבל מחטיאים כמעט כל קריאת-דפדפן בפועל — כי קצב
// ה-polling של ה-UI (60–90 שניות) ארוך מה-TTL, ולכן כל poll אוכל
// את הנתיב האיטי (1.1–1.9 שניות נמדדו ביומן, שוב ושוב).
//
// הריפוי הארכיטקטוני — שלושה חוקים:
//   1. טרי (גיל < TTL)    → מוגש מיד מהזיכרון, cached:true, stale:false.
//   2. בשל (גיל ≥ TTL)     → העותק הישן מוגש מיד (cached:true, stale:true)
//                            ורענון-רקע מופעל — פעם אחת (single-flight),
//                            כך שריצות מקבילות לא מכפילות fetch.
//   3. קור (אין עותק)      → ה-fetcher חייב לרוץ (אין ברירה), אבל קריאות
//                            מקבילות מתאחדות ל-promise אחד.
//
// כנות מלאה בכל תשובה: cached / stale / cacheAgeSec / refreshing —
// הצרכן תמיד יודע מה גיל הנתון. כישלון רענון-רקע משאיר את העותק
// הישן בשירות (stale=true כנה) — עדיף אמת מעופשת מאשר 502 מזייף.
// ─────────────────────────────────────────────────────────────────────

export interface SwrMeta {
  /** true = הוגש מהזיכרון (לא חושב עכשיו) */
  cached: boolean;
  /** true = העותק חצה את ה-TTL ורענון-רקע בדרך */
  stale: boolean;
  /** גיל העותק בשניות */
  cacheAgeSec: number;
  /** true = רענון-רקע רץ ברגע זה (single-flight) */
  refreshing: boolean;
}

export interface SwrResult<T> {
  value: T;
  meta: SwrMeta;
}

interface Entry {
  at: number;
  value: unknown;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** גיל עותק בשניות — שלם, לא שקר-דיוק */
function ageSec(at: number): number {
  return Math.max(0, Math.round((Date.now() - at) / 1000));
}

/**
 * מבצע fetch אחד בלבד לכל מפתח (single-flight) — מי שמגיע בזמן שהריצה
 * חיה מצטרף לאותו promise במקום להתחיל עוד אחד.
 */
function refresh<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fetcher()
    .then((value) => {
      store.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/**
 * קריאת-SWR: טרי → מיד · בשל → מיד + רענון-רקע · קור → ממתין ל-fetcher
 * (מאוחד). רענון-רקע שנכשל נבלע בכוונה — העותק הישן ממשיך לשרת בכנות.
 */
export function swrGet<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<SwrResult<T>> {
  const now = Date.now();
  const hit = store.get(key);

  // ① טרי — תשובה מיידית מהזיכרון
  if (hit && now - hit.at < ttlMs) {
    return Promise.resolve({
      value: hit.value as T,
      meta: { cached: true, stale: false, cacheAgeSec: ageSec(hit.at), refreshing: inflight.has(key) },
    });
  }

  // ② בשל — הישן מוגש מיד, רענון-רקע מופעל פעם אחת
  if (hit) {
    if (!inflight.has(key)) {
      // ניקוי-בטיחות: promise שנכשל ברקע לא יפיל את התהליך
      void refresh(key, fetcher).catch(() => {
        /* העותק הישן ממשיך לשרת — stale:true אומר את האמת */
      });
    }
    return Promise.resolve({
      value: hit.value as T,
      meta: { cached: true, stale: true, cacheAgeSec: ageSec(hit.at), refreshing: true },
    });
  }

  // ③ קור — אין ברירה: חישוב חי (מאוחד לקריאות מקבילות)
  return refresh(key, fetcher).then((value) => ({
    value,
    meta: { cached: false, stale: false, cacheAgeSec: 0, refreshing: false },
  }));
}

/**
 * אינוולידציה יזומה: מוחקת את העותק השמור של מפתח. הקריאה הבאה
 * ל-swrGet תיאלץ לחשב מחדש (קור). נועדה ל-mutations — כשהעולם
 * השתנה ביוזמתנו (enqueue/broadcast) וה-UI צריך לראות את זה עכשיו,
 * לא בעוד TTL.
 */
export function swrInvalidate(key: string): void {
  store.delete(key);
}

/** ערך-עזר ל-header X-SAOS-Cache — ניתן למדידה גולמית ב-curl -sD */
export function cacheHeader(meta: SwrMeta): string {
  if (!meta.cached) return "miss";
  return meta.stale ? "hit-stale" : "hit";
}
