// ─────────────────────────────────────────────────────────────────────
// FEED-METRICS — מוני-שימוש אמת של הפיד הציבורי (r148-d · B-4 דלפק-הפיד)
//
// חוקי הקובץ:
//   · כנות-מדידה: מונה = בקשה שנכנסה בפועל, לא הצהרה. אפס זיוף.
//   · fail-soft קשוח: כל תקלה (דיסק, JSON, הרשאות) → no-op. המונים
//     לעולם לא שוברים את ה-API שהם מודדים.
//   · persistence מדוחס: כתיבה בפעם-הראשונה ואז לכל-היותר אחת ל-60ש',
//     כתיבה-אטומית (.tmp → rename, אותו-חוק R107b של mini-services/
//     shared.ts writeJsonAtomic — משוכפל כאן מקומית עבור src/lib).
//   · המצב חי על globalThis (חוק R80) — hot-reload לא מאפס ספרים,
//     ואיתחול משחזר מהדיסק (sovereign/businesses/feed-metrics.json)
//     כדי שהספירה תמשיך את-עצמה כנה.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

const FILE = "/home/z/my-project/sovereign/businesses/feed-metrics.json";
const WRITE_EVERY_MS = 60_000;

export type EndpointStat = { endpoint: string; requests: number; lastAt: string };
export type FeedSnapshot = { endpoints: EndpointStat[]; since: string };
export type EndpointUsage = { endpoint: string; requests: number; since: string };

type FeedState = {
  since: string;
  endpoints: Map<string, EndpointStat>;
  wrote: boolean;
  lastWriteAt: number;
};

/** כתיבה-אטומית מקומית — אותו-דפוס של writeJsonAtomic (mini-services/shared.ts). */
function writeJsonAtomic(file: string, data: unknown, space: number = 2): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, space), "utf8");
  fs.renameSync(tmp, file);
}

function sorted(st: FeedState): EndpointStat[] {
  return [...st.endpoints.values()].sort((a, b) => (a.endpoint < b.endpoint ? -1 : a.endpoint > b.endpoint ? 1 : 0));
}

function snapshotObject(st: FeedState): FeedSnapshot {
  return { endpoints: sorted(st), since: st.since };
}

function state(): FeedState {
  const G = globalThis as unknown as { __FEED_METRICS_STATE__?: FeedState };
  const existing = G.__FEED_METRICS_STATE__;
  if (existing) return existing;
  const st: FeedState = { since: new Date().toISOString(), endpoints: new Map(), wrote: false, lastWriteAt: 0 };
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as {
      since?: string;
      endpoints?: Array<{ endpoint?: unknown; requests?: unknown; lastAt?: unknown }>;
    };
    if (typeof raw.since === "string" && raw.since.length > 0) st.since = raw.since;
    for (const e of Array.isArray(raw.endpoints) ? raw.endpoints : []) {
      if (typeof e?.endpoint === "string" && typeof e?.requests === "number" && Number.isFinite(e.requests)) {
        st.endpoints.set(e.endpoint, {
          endpoint: e.endpoint,
          requests: e.requests,
          lastAt: typeof e.lastAt === "string" ? e.lastAt : "",
        });
      }
    }
  } catch {
    // אין קובץ על-הדיסק עדיין — התחלה כנה מאפס (ה"since" שלנו מציין זאת)
  }
  G.__FEED_METRICS_STATE__ = st;
  return st;
}

function persist(st: FeedState, now: number): void {
  try {
    writeJsonAtomic(FILE, snapshotObject(st));
    st.lastWriteAt = now;
    st.wrote = true;
  } catch {
    // fail-soft: הדיסק לא ישבור מדידה
  }
}

/** רישום בקשה אחת. fail-soft מלא — לעולם לא זורק. */
export function bump(endpoint: string): void {
  try {
    const st = state();
    const prev = st.endpoints.get(endpoint);
    st.endpoints.set(endpoint, {
      endpoint,
      requests: (prev?.requests ?? 0) + 1,
      lastAt: new Date().toISOString(),
    });
    const now = Date.now();
    if (!st.wrote || now - st.lastWriteAt >= WRITE_EVERY_MS) persist(st, now);
  } catch {
    // מונים אינם מפילים API
  }
}

/** תמונת-מצב מלאה של כל הנתיבים המוספרים. */
export function snapshot(): FeedSnapshot {
  try {
    return snapshotObject(state());
  } catch {
    return { endpoints: [], since: new Date().toISOString() };
  }
}

/** שימוש של נתיב יחיד — השדה האדיטיבי "usage" של הראוטים הציבוריים. */
export function usageOf(endpoint: string): EndpointUsage {
  try {
    const st = state();
    return { endpoint, requests: st.endpoints.get(endpoint)?.requests ?? 0, since: st.since };
  } catch {
    return { endpoint, requests: 0, since: new Date().toISOString() };
  }
}
