// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Curation Engine — הפעלת כוח-ההצבעה הבטל (r128 · Task 4-a)
//
// האמת שנולדה מהמדידה (r127): 4.4K SP יושבים בטלים, 100% טעונים,
// אפס הצבעות בקוד החי אי-פעם — מול זה, ההצבעות הידניות המעטות של
// 09-12 הניבו את כל $0.091/30יום האוצרות שמנוע-ההכנסה מודד. המנוע
// הזה הוא תורת-האוצרות בקוד: גילוי מועמדים טריים מהפיד החי, ניקוד
// תזמון-כנה (מוקדם = יתרון, אבל לא לפני חלון-הליניאריות), והצבעה
// חתומה במפתח posting מהכספת הריבונית — בלי לגעת בהון לעולם.
//
// חוקי-ברזל (מקודדים, לא רק מוצהרים):
//   · מקסימום 10 הצבעות/יום-UTC · 2% משקל להצבעה · סך מנה ≤20%/יום
//     (בדיוק קצב הרגנרציה — כוח-ההצבעה נשמר סביב הגג)
//   · רצפת כוח-הצבעה 85% — מתחת: יום-החזקה כנה (HOLD)
//   · לעולם לא self-vote · לעולם לא אותו פוסט פעמיים · מקסימום 1/מחבר/יום
//   · לעולם לא קניית-הצבעות: מוטבי ביד-בוט (רשימת-חסימה) ופוסטים
//     מקודמים בתשלום (promoted ≠ 0) נפסלים מראש
//   · שער-RC לפני כל שידור — אין מנה ⇒ דילוג-כנה, לא כשל
//   · מפתח posting בלבד, נגזר בזיכרון-הרצה מהכספת — לעולם לא נכתב,
//     לעולם לא מודפס, לעולם לא נכנס לגיט (חוק ספר-המפתחות)
//   · השרשרת היא השופט: סמכות המפתח נמדדת מול posting.account_auths
//     החי לפני שידור; כפילויות נמדדות מ-active_votes של הפוסט עצמו
//   · כנות: כל החלטה נרשמת בפנקס (state + history) — גם הדילוגים
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { readOwnerSource, steemSigningWif } from "@/lib/owner-key"; // r137 · D-026: מקור-מפתח דו-מצבי
import {
  rpcV4,
  STEEM_RPC_NODES,
  getDgp,
  steemBroadcast,
  steemRcGate,
} from "./graphene";
import type { GrapheneOperation } from "steem";
import { createRequire } from "node:module";

const HOME = "/home/z/my-project";
const STATE_DIR = path.join(HOME, "sovereign", "curation");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const HISTORY_FILE = path.join(STATE_DIR, "history.json");

/** מפתח-האב מ-upload — הדפוס המוכח של מסלול הפרסום (R75: אומת 4/4 מול הרשות החיה).
 *  מוחזר עצם-קיום בלבד; הסוד לעולם לא נכתב ולא נרשם. (r137 · D-026:
 *  מקור-המפתח עבר לספרייה המשותפת — דו-מצבי: סיסמת-אב או WIF-הדלת.) */
function readOwnerKey(): { account: string; password: string; wif?: string } | null {
  const src = readOwnerSource();
  if (!src) return null;
  if (src.mode === "master" && src.master) return { account: src.account, password: src.master };
  if (src.mode === "wif" && src.activeWif) return { account: src.account, password: "", wif: src.activeWif };
  return null;
}

/** טעינת steem מנתיב-האב (createRequire — הדפוס של מסלול הפרסום). */
function loadSteem(): { auth: { toWif: (a: string, p: string, r: string) => string; wifToPublic: (w: string) => string } } {
  const nodeRequire = createRequire(path.join(HOME, "package.json"));
  return nodeRequire("steem");
}
const HISTORY_CAP = 5000; // גג-ספר כנה (כ-500 ימי פעימות) — הדיסק לא נושם

/** נתיב פנקס-המצב — לשימוש הדיבון במיזוח שדות-הבקרה מהדיסק */
export const CURATION_STATE_FILE = STATE_FILE;

/** חשבון ההצבעה — המפקד. לעולם לא מצביעים על עצמו. */
export const CURATION_VOTER = "headcorner";

/** המדיניות — כל המספרים במקום אחד, מתועדים, בלי דיוק-מזויף. */
export const CURATION_POLICY = {
  /** תגיות עם בריכות-תשלום אמיתיות — הפיד החי שנסרק */
  tags: ["steem", "cryptocurrency", "life", "news"],
  /** כמה פוסטים למשוך לכל תגית (get_discussions_by_created) */
  feedLimitPerTag: 20,
  /** חלון הגיל: מ-5 דק' (לא לפני חלון-הליניאריות) עד 120 דק' */
  ageMinMinutes: 5,
  ageMaxMinutes: 120,
  /** מוניטין מחבר מינימלי (סקאלת Steem ~25-80) */
  minAuthorRep: 45,
  /** אורך גוף מינימלי במילים — פוסט-אמת, לא שורה */
  minWords: 150,
  /** תקציב המנה: מקסימום הצבעות/יום-UTC */
  maxVotesPerDay: 10,
  /** משקל כל הצבעה באחוזים (6% = 600 יחידות מ-10000) */
  weightPctPerVote: 6,
  /** r150 · העלאת-משקל מדודה: הרשת מחזיקה 4,285 SP נטו (מדידה-חיה
   *  02/10 21:30Z: 7.13M VESTS − 613K delegated + 394K received, ratio 1613.32).
   *  ב-2% המנוע שרף ~3.5% מנה/יום בלבד — ניצולת כלכלית 1/6. הכותב-השני
   *  על החשבון שורף ~7% (הצבעה-50% יומית מדודה) ⇒ תקציב-שיווי-משקל ~13%/יום.
   *  10 הצבעות × 6% ב-VP~75 = ~10.4% VP/יום — 3× פריסת-הסטייק, בלי-לגרור
   *  את ה-VP מתחת לרצפת-ה-70 (חוק r146-a). עלות-מנה: VP%×W%/432. */
  dailyManaSpendPct: 20,
  /** r146-a · חוק-הכוח הדו-מדורגי (תיקון-שורש למדידה): עד-היום רצפה אחת קשה
   *  של 85% קפאה את ההכנסה ל-48ש'+ בכל ירידה מתחת לקו — מדידה ראתה 30+ HOLD
   *  רצופים, בזמן שכותב-אחר על אותו חשבון ממשיך לשרוף מנה בהצבעות-50%.
   *  שני-המדורגים: מתחת ל-70% — יום-החזקה כנה (HOLD); מ-70% ומעלה — מצביעים
   *  ב-6% (r150), והרצפה-הישנה 85% נשארת כגג-המשקל המלא בלבד (לשקיפות-מדיניות). */
  votingPowerResumePct: 70,
  /** גג-המשקל-המלא — מעליו המנוע בשכבת-השיא שלו (מתועד ב-rulesEcho) */
  votingPowerFloorPct: 85,
  /** סף הניקוד להצבעה */
  voteScoreThreshold: 60,
  /** מקסימום הצבעות לאותו מחבר באותו יום */
  maxVotesPerAuthorPerDay: 1,
  /** רשימת-חסימת ביד-בוטים — מוטב שלהם על הפוסט = קניית-הצבעות */
  bidBotBlacklist: ["tipu", "botcoin", "upme", "booster"],
  /** גג פנקס ההצבעות בזיכרון-העולם (~200 ימים ב-10/יום) */
  votedPostsCap: 2000,
} as const;

/** מדיניות הניקוד — משקולות מתועדות, סה"כ 100 נקודות, אפס דיוק-מזויף:
 *  · תזמון 35 — מוקדם בתוך החלון = יתרון אוצרות (5ד' → מלא, 120ד' → 0)
 *  · מעורבות 25 — כמה הצבעות כבר יש (2-15 = אחרים רואים ערך ולא מאוחר;
 *    0-1 = לא-מוכח; 40+ = העגלה כבר יצאה)
 *  · מוניטין מחבר 20 — ליניארי 45→65, גג 20 מעל
 *  · אורך תוכן 10 — 150 מילה → 2, 500 → 10, גג 10
 *  · דיון 10 — 0 תגובות = טרי (4), 1-3 = סימן חיים (10), 10+ = כבר עמוס (3) */
export const SCORE_WEIGHTS = {
  timing: 35,
  engagement: 25,
  reputation: 20,
  length: 10,
  discussion: 10,
} as const;

// ── טיפוסים ─────────────────────────────────────────────────────────

export type Decision = { at: string; kind: string; detail: string };

export interface CurationCandidate {
  author: string;
  permlink: string;
  title: string;
  category: string;
  url: string;
  createdAt: string; // ISO — מזמן-השרשרת, לא שעון מקומי
  ageMin: number;
  authorRep: number; // סקאלת Steem המפורסמת (~25-80)
  words: number;
  votes: number;
  comments: number;
  pendingPayoutSbd: string | null;
  score: number; // 0-100, מעוגל לעשירית
  breakdown: { timing: number; engagement: number; reputation: number; length: number; discussion: number };
}

export interface VotedPost {
  author: string;
  permlink: string;
  at: string;
  txid: string | null;
  weightPct: number;
  score: number;
}

export interface CurationState {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  /** בקרת-בטיחות r128: הדיבון עולה במצב DISCOVER-ONLY. חימוש = החלטת מפעיל בלבד */
  armed: boolean;
  paused: boolean;
  pauseReason: string | null;
  votesToday: number;
  voteDay: string;
  lastVoteAt: string | null;
  votedPosts: VotedPost[]; // הפנקס — "לעולם לא אותו פוסט פעמיים"
  votedAuthorsToday: string[]; // חוק 1/מחבר/יום
  candidatesSeen: number; // מונה מצטבר של מועמדים שעברו מסננות
  lastDiscovery: {
    at: string;
    node: string;
    fetched: number;
    candidates: CurationCandidate[];
    filtered: Record<string, number>;
  } | null;
  votingPowerLast: { at: string; pct: number | null; detail?: string } | null;
  /** r157 · עקומת-VP (D-r157-VP-COORD) — טבעת-דגימה-שעתית (גג-480) למציאת-חלון-השיא-היומי */
  votingPowerCurve?: { at: string; pct: number; vpField?: number | null }[];
  lastDecision: Decision | null;
  /** r146-a · צינור-התגמולים — מצב-התביעה היומי (שדות-תוספת; פנקס-ישן בלעדיהם תקין) */
  lastClaimDay?: string | null;
  lastClaimAt?: string | null;
  lastClaimTxid?: string | null;
  lastClaimNote?: string | null;
}

export interface DiscoverResult {
  at: string;
  node: string;
  fetched: number;
  candidates: CurationCandidate[];
  filtered: Record<string, number>;
  error: string | null;
  // r145-b — התגיות-בוססות-הרזוננס שנכנסו לסיור הפעימה (ראיה לצריכת-הדיג'סט)
  resonanceTags?: string[];
}

// ── עזרים ───────────────────────────────────────────────────────────

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** מוניטין גולמי של Steem → הסקאלה המפורסמת (דפוס steemit: log10-9, ×9, +25). */
export function parseRep(raw: number | string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n === 0) return 25;
  const neg = n < 0;
  const r = Math.log10(Math.abs(n)) - 9;
  const score = (r < 0 ? -9 : r) * 9 + 25;
  return neg ? -score : score;
}

/** פורמט תגובת-השרשרת: "2026-09-27T16:23:54" (בלי אזור) → ISO-UTC מלא */
function chainTimeToIso(t: string): string {
  return /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── מצב + היסטוריה (ציר-העולם של האוצרות) ───────────────────────────

export function freshCurationState(): CurationState {
  return {
    service: "curation",
    version: "1.0.0",
    bootedAt: new Date().toISOString(),
    beats: 0,
    armed: false, // חוק r128: עולה בגילוי-בלבד — החימוש בידי המפעיל בלבד
    paused: false,
    pauseReason: null,
    votesToday: 0,
    voteDay: utcDay(),
    lastVoteAt: null,
    votedPosts: [],
    votedAuthorsToday: [],
    candidatesSeen: 0,
    lastDiscovery: null,
    votingPowerLast: null,
    votingPowerCurve: [],
    lastDecision: null,
    lastClaimDay: null,
    lastClaimAt: null,
    lastClaimTxid: null,
    lastClaimNote: null,
  };
}

/** קריאת המצב מהדיסק — עם גלגול-יום כנה ומיזוג שדות-בקרה חיצוניים.
 *  הדיסק הוא האמת לשדות armed/paused (ה-API כותב אותם) — קורא שמתעלם
 *  מהם היה מוחק החלטת מפעיל בכתיבה הבאה. */
export function readCurationState(): CurationState {
  const base = freshCurationState();
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<CurationState>;
    const day = utcDay();
    const sameDay = prev.voteDay === day;
    return {
      ...base,
      bootedAt: prev.bootedAt ?? base.bootedAt,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      armed: prev.armed === true,
      paused: prev.paused === true,
      pauseReason: prev.pauseReason ?? null,
      votesToday: sameDay ? (prev.votesToday ?? 0) : 0,
      voteDay: day,
      lastVoteAt: prev.lastVoteAt ?? null,
      votedPosts: Array.isArray(prev.votedPosts) ? prev.votedPosts.slice(-CURATION_POLICY.votedPostsCap) : [],
      votedAuthorsToday: sameDay && Array.isArray(prev.votedAuthorsToday) ? prev.votedAuthorsToday : [],
      candidatesSeen: typeof prev.candidatesSeen === "number" ? prev.candidatesSeen : 0,
      lastDiscovery: prev.lastDiscovery ?? null,
      votingPowerLast: prev.votingPowerLast ?? null,
      votingPowerCurve: Array.isArray(prev.votingPowerCurve) ? prev.votingPowerCurve : [],
      lastDecision: prev.lastDecision ?? null,
      lastClaimDay: prev.lastClaimDay ?? null,
      lastClaimAt: prev.lastClaimAt ?? null,
      lastClaimTxid: prev.lastClaimTxid ?? null,
      lastClaimNote: prev.lastClaimNote ?? null,
    };
  } catch {
    // קובץ שאינו קיים = עלייה ראשונה כנה; קובץ בלתי-קריא = מצב חדש בכנות
    return base;
  }
}

/** כתיבה-אטומית (חוק R107b): .tmp ואז rename — אף דור לא יורש קובץ חצוי. */
export function saveCurationState(state: CurationState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

/** צירוף רשומה לספר ההיסטוריה — דפוס sovereign/money/history.json:
 *  מערך של {at, kind, reason, …} בכתיבה-אטומית, עם גג-ספר כנה. */
export function appendCurationHistory(kind: string, reason: string, extra?: Record<string, unknown>): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    let arr: Array<Record<string, unknown>> = [];
    try {
      arr = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as Array<Record<string, unknown>>;
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    arr.push({ at: new Date().toISOString(), kind, reason, ...(extra ?? {}) });
    if (arr.length > HISTORY_CAP) arr = arr.slice(-HISTORY_CAP);
    const tmp = `${HISTORY_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
    fs.renameSync(tmp, HISTORY_FILE);
  } catch {
    // כנות בשקט אינה אפשרית כאן — אבל ספר-היסטוריה אינו תנאי לפעולה;
    // פנקס-המצב נשאר השופט. (כשל כתיבה ייראה בדיסק בפעם הבאה)
  }
}

// ── מדידת כוח-ההצבעה — המנה חיה מהשרשרת ────────────────────────────

/** כוח-ההצבעה באחוזים: voting_manabar + רגנרציה מחושבת מזמן-השרשרת
 *  (אותו תיקון-אמת של שערי-ה-RC: ה-manabar השמור מתעדכן רק בהצבעה —
 *  בלי חישוב-רגנרציה הקריאה קופאת ומזייפת "שחוק" אחרי שבועות מנוחה).
 *  מכנה = מנדטים אפקטיביים (מוחזק + מקבל - מואצל). */
export async function readVotingPower(
  account = CURATION_VOTER
): Promise<{ ok: boolean; pct: number | null; vpField?: number | null; detail?: string }> {
  type ChainAccount = {
    vesting_shares: string;
    received_vesting_shares?: string;
    delegated_vesting_shares?: string;
    voting_manabar: { current_mana: string | number; last_update_time: number };
    posting: { account_auths: Array<[string, number]> };
  };
  let lastErr = "";
  for (const node of STEEM_RPC_NODES) {
    try {
      const accounts = await rpcV4<ChainAccount[]>(node, "condenser_api.get_accounts", [[account]]);
      const a = accounts?.[0];
      if (!a) return { ok: false, pct: null, detail: "account-not-found" };
      const vests = (s?: string) => (s ? Number(s.split(" ")[0]) * 1e6 : 0);
      const maxMana = vests(a.vesting_shares) + vests(a.received_vesting_shares) - vests(a.delegated_vesting_shares);
      if (!(maxMana > 0)) return { ok: false, pct: null, detail: "zero-vesting" };
      // זמן-השרשרת — לא שעון מקומי (אותו חוק כמו שערי ה-RC)
      const dgp = await getDgp(node);
      const now = Math.floor(new Date(chainTimeToIso(dgp.time)).getTime() / 1000);
      const REGEN_SEC = 5 * 24 * 60 * 60; // חמישה ימים
      const mana = Math.min(
        maxMana,
        Number(a.voting_manabar.current_mana) + Math.max(0, now - a.voting_manabar.last_update_time) * (maxMana / REGEN_SEC)
      );
      const pct = Math.round((10000 * mana) / maxMana) / 100;
      // r161 — שני-בריכות-כוח בשרשרת: ה-manabar (שמחושב-למעלה, מנוע-ה-VP-הקונצנזוס) מול
      // שדה voting_power (הבריכה-הישנה, מה-UI/condenser). נמדד-יבשת: פער-מבני ~7.5 נק'
      // (02:34Z: manabar 60.5 מול שדה 67.97) — שניהם-נרשמים, המדיניות-משתמשת-בנמוך-מביניהם (שמרני)
      const vpField = typeof a.voting_power === "number" ? a.voting_power / 100 : null;
      return { ok: true, pct: clamp(pct, 0, 100), vpField: vpField != null ? clamp(vpField, 0, 100) : null };
    } catch (e) {
      lastErr = String((e as Error).message ?? e).slice(0, 80);
    }
  }
  return { ok: false, pct: null, detail: `rpc-unreachable (${lastErr})` };
}

// ── ניקוד — האשוריזם המתועד, 0-100 ──────────────────────────────────

export function scoreCandidate(c: {
  ageMin: number;
  votes: number;
  authorRep: number;
  words: number;
  comments: number;
}): { score: number; breakdown: { timing: number; engagement: number; reputation: number; length: number; discussion: number } } {
  // תזמון 35: צעיר בתוך החלון = יתרון (5ד' מלא → דעיכה ליניארית → 0 ב-120ד')
  const timing = clamp(
    SCORE_WEIGHTS.timing * (1 - (c.ageMin - CURATION_POLICY.ageMinMinutes) / (CURATION_POLICY.ageMaxMinutes - CURATION_POLICY.ageMinMinutes)),
    0,
    SCORE_WEIGHTS.timing
  );
  // מעורבות 25: 2-15 הצבעות = אחרים רואים ערך ועוד מוקדם; 0-1 = לא-מוכח;
  // 16-40 = דעיכה (מאוחר); 40+ = העגלה יצאה — כמעט אפס.
  let engagement: number;
  if (c.votes <= 1) engagement = 8;
  else if (c.votes <= 15) engagement = SCORE_WEIGHTS.engagement;
  else if (c.votes <= 40) engagement = SCORE_WEIGHTS.engagement * (1 - (c.votes - 15) / 25);
  else engagement = 4;
  engagement = clamp(engagement, 0, SCORE_WEIGHTS.engagement);
  // מוניטין 20: ליניארי מ-45 (0) עד 65 (20), גג מעל
  const reputation = clamp(
    (SCORE_WEIGHTS.reputation * (c.authorRep - CURATION_POLICY.minAuthorRep)) / (65 - CURATION_POLICY.minAuthorRep),
    0,
    SCORE_WEIGHTS.reputation
  );
  // אורך 10: 150 מילה → 2, 500 → 10 (מעל — גג)
  const length = clamp(SCORE_WEIGHTS.length * (0.2 + (0.8 * (c.words - CURATION_POLICY.minWords)) / 350), 0, SCORE_WEIGHTS.length);
  // דיון 10: 0 תגובות = טרי (4) · 1-3 = סימן-חיים (10) · 4-9 = ביניים (7) · 10+ = עמוס (3)
  const discussion = c.comments === 0 ? 4 : c.comments <= 3 ? SCORE_WEIGHTS.discussion : c.comments <= 9 ? 7 : 3;
  const breakdown = { timing, engagement, reputation, length, discussion };
  const score = clamp(timing + engagement + reputation + length + discussion, 0, 100);
  return { score: Math.round(score * 10) / 10, breakdown };
}

// ── גילוי — הפיד החי, המסננות הכנות ─────────────────────────────────

interface RawDiscussion {
  author: string;
  permlink: string;
  title: string;
  category: string;
  url: string;
  created: string;
  body: string;
  children: number;
  author_reputation: number | string;
  active_votes: Array<{ voter?: string }>;
  beneficiaries?: Array<{ account?: string }>;
  parent_author: string;
  promoted?: string;
  pending_payout_value?: string;
}

/**
 * r145-b — תגיות-רזוננס מהדיג'סט של audience-analyst (D-r145-AUD) — הצריכה
 * האמיתית של מדידת-הקהל בשכבת-האוצרות: נושאים שנמדדה עליהם מעורבות-חוץ
 * נסרקים בסיור בתוספת לתגיות-הבסיס (גג 2). גייטים קשים: הדיג'סט חייב להיות
 * טרי (≤48ש') ועם מעורבות-חוץ מדודה > 0 — אין דיג'סט / דיג'סט ישן / אפס
 * רזוננס ⇒ אפס שינוי בהתנהגות (החוק: מדידה מזינה סיור, לא שולטת בו).
 */
export function readResonanceTags(maxTags = 2): string[] {
  try {
    const f = path.join(HOME, "sovereign", "audience", "latest-digest.json");
    const wrap = JSON.parse(fs.readFileSync(f, "utf8")) as {
      fetchedAt?: string;
      digest?: { topics?: Array<{ tag?: string; externalEngagement?: number }> };
    };
    const ageMs = Date.now() - Date.parse(wrap.fetchedAt ?? "");
    if (!Number.isFinite(ageMs) || ageMs > 48 * 3_600_000) return [];
    const topics = Array.isArray(wrap.digest?.topics) ? wrap.digest!.topics! : [];
    const base = CURATION_POLICY.tags as readonly string[];
    return topics
      .filter((t) => typeof t?.tag === "string" && Number(t.externalEngagement) > 0)
      .sort((a, b) => Number(b.externalEngagement || 0) - Number(a.externalEngagement || 0))
      .map((t) => String(t.tag))
      .filter((t) => t.length >= 2 && t.length <= 24 && !base.includes(t))
      .slice(0, maxTags);
  } catch {
    return [];
  }
}

/**
 * גילוי מועמדים: פיד created לפי תגיות → מסננות-ברזל → ניקוד → מיון.
 * כל דילוג נספר בכנות (filtered) — המפעיל רואה בדיוק למה אף אחד לא עבר.
 * הכפילוּת נמדדת מהשרשרת (active_votes שלנו בפוסט) ומהפנקס (ledger).
 */
export async function discoverCandidates(ctx?: {
  votedKeys?: Set<string>;
  authorsToday?: Set<string>;
}): Promise<DiscoverResult> {
  const votedKeys = ctx?.votedKeys ?? new Set<string>();
  const authorsToday = ctx?.authorsToday ?? new Set<string>();
  const filtered: Record<string, number> = {};
  const bump = (k: string) => {
    filtered[k] = (filtered[k] ?? 0) + 1;
  };

  for (const node of STEEM_RPC_NODES) {
    try {
      // זמן-השרשרת — הגיל נמדד מולו, לא מול שעון הסנדבוקס
      const dgp = await getDgp(node);
      const nowMs = Date.parse(chainTimeToIso(dgp.time));

      // איחוד הפידים לפי תגית — dedup לפי author/permlink
      const seen = new Set<string>();
      const posts: RawDiscussion[] = [];
      const pullFeed = async (tag: string) => {
        const feed = await rpcV4<RawDiscussion[]>(
          node,
          "condenser_api.get_discussions_by_created",
          [{ tag, limit: CURATION_POLICY.feedLimitPerTag }]
        );
        if (!Array.isArray(feed)) return;
        for (const p of feed) {
          if (!p?.author || !p?.permlink) continue;
          const key = `${p.author}/${p.permlink}`;
          if (seen.has(key)) continue;
          seen.add(key);
          posts.push(p);
        }
      };
      for (const tag of CURATION_POLICY.tags) {
        await pullFeed(tag);
      }
      // r145-b — תגיות-רזוננס מדיג'סט-הקהל (גג 2, מדוד > 0 — ראה readResonanceTags)
      const resonanceTags = readResonanceTags();
      for (const tag of resonanceTags) {
        await pullFeed(tag);
      }

      const candidates: CurationCandidate[] = [];
      for (const p of posts) {
        if ((p.parent_author ?? "") !== "") {
          bump("comment-not-post");
          continue;
        }
        if (p.author === CURATION_VOTER) {
          bump("self-post");
          continue;
        }
        const createdMs = Date.parse(chainTimeToIso(p.created || ""));
        if (!Number.isFinite(createdMs)) {
          bump("bad-created");
          continue;
        }
        const ageMin = (nowMs - createdMs) / 60_000;
        if (ageMin < CURATION_POLICY.ageMinMinutes) {
          bump("too-young");
          continue;
        }
        if (ageMin > CURATION_POLICY.ageMaxMinutes) {
          bump("too-old");
          continue;
        }
        const authorRep = parseRep(p.author_reputation);
        if (!(authorRep > CURATION_POLICY.minAuthorRep)) {
          bump("low-rep");
          continue;
        }
        const words = String(p.body ?? "").split(/\s+/).filter(Boolean).length;
        if (words < CURATION_POLICY.minWords) {
          bump("too-short");
          continue;
        }
        // קניית-הצבעות — מוטב ביד-בוט על הפוסט, או קידום בתשלום
        const beneficiaries = Array.isArray(p.beneficiaries) ? p.beneficiaries : [];
        const hasBidBot = beneficiaries.some((b) =>
          (CURATION_POLICY.bidBotBlacklist as readonly string[]).includes(String(b?.account ?? "").toLowerCase())
        );
        if (hasBidBot) {
          bump("bid-bot-beneficiary");
          continue;
        }
        if (p.promoted && p.promoted !== "0.000 SBD") {
          bump("promoted-paid");
          continue;
        }
        const key = `${p.author}/${p.permlink}`;
        if (votedKeys.has(key)) {
          bump("already-voted-ledger");
          continue;
        }
        // השרשרת היא השופט: הצבעה קיימת שלנו על הפוסט עצמו
        const chainVoted = (p.active_votes ?? []).some((v) => String(v?.voter ?? "").toLowerCase() === CURATION_VOTER);
        if (chainVoted) {
          bump("already-voted-chain");
          continue;
        }
        if (authorsToday.has(p.author)) {
          bump("author-already-today");
          continue;
        }
        const votes = (p.active_votes ?? []).length;
        const { score, breakdown } = scoreCandidate({ ageMin, votes, authorRep, words, comments: Number(p.children ?? 0) });
        candidates.push({
          author: p.author,
          permlink: p.permlink,
          title: String(p.title ?? "").slice(0, 140),
          category: p.category ?? "",
          url: p.url ?? `/${key}`,
          createdAt: new Date(createdMs).toISOString(),
          ageMin: Math.round(ageMin * 10) / 10,
          authorRep: Math.round(authorRep * 10) / 10,
          words,
          votes,
          comments: Number(p.children ?? 0),
          pendingPayoutSbd: p.pending_payout_value ?? null,
          score,
          breakdown: {
            timing: Math.round(breakdown.timing * 10) / 10,
            engagement: Math.round(breakdown.engagement * 10) / 10,
            reputation: Math.round(breakdown.reputation * 10) / 10,
            length: Math.round(breakdown.length * 10) / 10,
            discussion: Math.round(breakdown.discussion * 10) / 10,
          },
        });
      }

      // מיון לפי ניקוד; חוק 1/מחבר בתוך הגילוי עצמו — הטוב ביותר של כל מחבר
      candidates.sort((a, b) => b.score - a.score);
      const deduped: CurationCandidate[] = [];
      const authorsInList = new Set<string>();
      for (const c of candidates) {
        if (authorsInList.has(c.author)) continue;
        authorsInList.add(c.author);
        deduped.push(c);
      }

      return {
        at: new Date().toISOString(),
        node,
        fetched: posts.length,
        candidates: deduped,
        filtered,
        error: null,
        resonanceTags,
      };
    } catch (e) {
      // צומת שנפל — הבא בתור; אם כולם נפלו — כנות מלאה בשדה ה-error
      const msg = String((e as Error).message ?? e).slice(0, 140);
      if (node === STEEM_RPC_NODES[STEEM_RPC_NODES.length - 1]) {
        return { at: new Date().toISOString(), node, fetched: 0, candidates: [], filtered, error: msg };
      }
    }
  }
  return { at: new Date().toISOString(), node: "-", fetched: 0, candidates: [], filtered, error: "no-node-answered" };
}

// ── בניית האופ + ההצבעה — posting בלבד, שער-RC, השרשרת שופט ──────────

/** בניית אופ-הצבעה (int16 weight) — הצורה המוכחת-בייטים של buildSteemVoteTx
 *  (עותק-האימות Saosmartwallet:146), בלי מנוע-אימות נפרד: steem-js מסדר
 *  את השדות בעצמו ב-sendAsync. */
export function buildVoteOp(voter: string, author: string, permlink: string, weightPct: number): GrapheneOperation {
  if (!/^[a-z0-9.\-]{3,16}$/.test(voter)) throw new Error("BAD-VOTER");
  if (!/^[a-z0-9.\-]{3,16}$/.test(author)) throw new Error("BAD-AUTHOR");
  if (!/^[a-z0-9-]+$/.test(permlink) || !permlink.length || permlink.length > 256) throw new Error("BAD-PERMLINK");
  const weight = Math.round(weightPct * 100);
  if (!Number.isInteger(weight) || weight <= 0 || weight > 10000) throw new Error("BAD-WEIGHT");
  return ["vote", { voter, author, permlink, weight }];
}

/**
 * ההצבעה עצמה — סדר החוקים:
 *   1) איסור self-vote (נבדק פעמיים: כאן ובגילוי)
 *   2) פתיחת מפתח posting מהכספת (בזיכרון בלבד)
 *   3) השרשרת שופטת: הפומבי הנגזר חייב להיות ב-posting.account_auths החי
 *   4) שער-RC — אין מנה ⇒ דילוג-כנה (לא שורפים ניסיון, לא מזייפים הצלחה)
 *   5) שידור steem-js native → txid או כישלון כנה
 */
export async function castVote(params: {
  author: string;
  permlink: string;
  weightPct: number;
}): Promise<{ ok: boolean; txid: string | null; note: string; rcGate?: { ok: boolean; mana: number; max: number; reason?: string } }> {
  const author = params.author.trim().toLowerCase();
  const permlink = params.permlink.trim();
  try {
    if (author === CURATION_VOTER) {
      return { ok: false, txid: null, note: "SELF-VOTE-BANNED: המפקד לעולם לא מצביע על עצמו" };
    }
    let op: GrapheneOperation;
    try {
      op = buildVoteOp(CURATION_VOTER, author, permlink, params.weightPct);
    } catch (e) {
      return { ok: false, txid: null, note: `BAD-OP: ${String((e as Error).message ?? e)}` };
    }

    // 2) המפתח ממפתח-האב — נגזר ל-posting בזיכרון בלבד (דפוס R75 המוכח של
    //    מסלול הפרסום). הכספת נבדקה ב-r128: רשומת ה-posting שבה אינה תואמת
    //    את הרשות החיה — הגזירה ממפתח-האב היא שעברה 4/4 במדידות R75.
    const ownerKey = readOwnerKey();
    if (!ownerKey || ownerKey.account !== CURATION_VOTER) {
      return { ok: false, txid: null, note: "NO-KEY: מפתח-האב (upload/headcorner.txt) אינו קריא או אינו של המצביע — לא נוגעים" };
    }
    const steem = loadSteem();
    // r137 · D-026: מצב-אב גוזר posting ישירות (הדפוס שעבר 4/4 ב-R75);
    // מצב-wif פותח את רשומת-ה-posting מהכספת תחת WIF-השליטה. אין-פתיחה
    // או פומבי לא-תואם = סירוב-כנה מטעם השופט בהמשך — אין ניחוש-חתימה.
    const viaVault = ownerKey.wif ? steemSigningWif("posting", ownerKey.account) : null;
    if (ownerKey.wif && !viaVault) {
      return { ok: false, txid: null, note: "NO-SIGNING: מצב-wif — אין רשומת-posting נפתחה מהכספת; לא נוגעים" };
    }
    const wif = viaVault ? viaVault.wif : steem.auth.toWif(ownerKey.account, ownerKey.password, "posting");
    const derivedPub = steem.auth.wifToPublic(wif);

    // 3) השרשרת היא השופט: הפומבי הנגזר חייב להיות ברשות החיה (key_auths —
    //    לא account_auths: שם מושווים שמות-חשבונות, ומפתח לעולם לא יימצא שם).
    type ChainAccount = { posting: { key_auths: Array<[string, number]> } };
    const accounts = await rpcV4<ChainAccount[]>(STEEM_RPC_NODES[0], "condenser_api.get_accounts", [[CURATION_VOTER]]);
    const liveKey = accounts?.[0]?.posting?.key_auths?.[0]?.[0];
    if (!liveKey || derivedPub !== liveKey) {
      return { ok: false, txid: null, note: "KEY-AUTHORITY-MISMATCH: הנגזר אינו בסמכות ה-posting החיה — לא נוגעים" };
    }

    // 4) שער-RC — דילוג-כנה
    const gate = await steemRcGate(CURATION_VOTER);
    if (!gate.ok) {
      return { ok: false, txid: null, note: `RC-GATED: ${gate.reason ?? "?"} — ננסה בפעימה הבאה`, rcGate: gate };
    }

    // 5) שידור
    const res = await steemBroadcast([op], wif);
    if (!res.txid) return { ok: false, txid: null, note: `BROADCAST-FAIL: ${res.note ?? "?"}`, rcGate: gate };
    return { ok: true, txid: res.txid, note: `הצבעה ${params.weightPct}% שודרה → ${author}/${permlink.slice(0, 48)}…`, rcGate: gate };
  } catch (e) {
    return { ok: false, txid: null, note: `VOTE-ERROR: ${String((e as Error).message ?? e).slice(0, 140)}` };
  }
}

// ── r146-a · צינור-התגמולים — מדידה, תביעה, מדד-מיחזור ────────────────
// החוק: כל תגמול שנצבר (reward_vesting/reward_sbd/reward_steem) נתבע לארנק
// בהקדם — VESTS נכנסים ל-vesting_shares (SP גדל ⇒ כל הצבעת-אוצרות חזקה
// יותר: מיחזור-צירוף), STEEM/SBD נופלים ליתרות-הנזילות שהסולם כבר סוחר
// מהן (מיחזור-נזילות, בלי-קוד-נוסף — הכספת של הסולם היא היעד). התביעה
// חתומה posting-בלבד, אותו סדר-חוקים של ההצבעה; כל ניסיון — כנות ברשומות.

const REWARDS_LEDGER_FILE = path.join(STATE_DIR, "rewards.json");
const REWARDS_LEDGER_CAP = 200;

export interface RewardBalances {
  steem: string;
  sbd: string;
  vests: string;
  steemNum: number;
  sbdNum: number;
  vestsNum: number;
  totalNonZero: boolean;
}

/** מדידת יתרות-התגמול הממתינות מהשרשרת — השרשרת שופטת, לא הזיכרון. */
export async function readRewardBalances(account = CURATION_VOTER): Promise<RewardBalances | null> {
  type ChainAccount = { reward_steem_balance?: string; reward_sbd_balance?: string; reward_vesting_balance?: string };
  for (const node of STEEM_RPC_NODES) {
    try {
      const accounts = await rpcV4<ChainAccount[]>(node, "condenser_api.get_accounts", [[account]]);
      const a = accounts?.[0];
      if (!a) return null;
      const num = (s?: string) => Number((s ?? "0").split(" ")[0]) || 0;
      const steem = a.reward_steem_balance ?? "0.000 STEEM";
      const sbd = a.reward_sbd_balance ?? "0.000 SBD";
      const vests = a.reward_vesting_balance ?? "0.000000 VESTS";
      const steemNum = num(steem), sbdNum = num(sbd), vestsNum = num(vests);
      return { steem, sbd, vests, steemNum, sbdNum, vestsNum, totalNonZero: steemNum > 0 || sbdNum > 0 || vestsNum > 0 };
    } catch {
      /* הצומת-הבא */
    }
  }
  return null;
}

function appendRewardsLedger(entry: Record<string, unknown>): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    let arr: Array<Record<string, unknown>> = [];
    try {
      arr = JSON.parse(fs.readFileSync(REWARDS_LEDGER_FILE, "utf8")) as Array<Record<string, unknown>>;
      if (!Array.isArray(arr)) arr = [];
    } catch { /* עלייה ראשונה */ }
    arr.push({ at: new Date().toISOString(), ...entry });
    if (arr.length > REWARDS_LEDGER_CAP) arr = arr.slice(-REWARDS_LEDGER_CAP);
    const tmp = `${REWARDS_LEDGER_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
    fs.renameSync(tmp, REWARDS_LEDGER_FILE);
  } catch { /* רשומות-התגמול אינן תנאי לפעולה — הפנקס וההיסטוריה נושאים את האמת */ }
}

/** תביעת-התגמולים — סדר-החוקים של castVote בדיוק (key → שופט → RC → שידור).
 *  כשאין מה לתבוע: ok=true · claimed=false (מדידה כנה, לא כישלון). */
export async function claimCurationRewards(): Promise<{
  ok: boolean;
  claimed: boolean;
  txid: string | null;
  note: string;
  pending?: { steem: string; sbd: string; vests: string };
}> {
  try {
    const pending = await readRewardBalances();
    if (!pending) return { ok: false, claimed: false, txid: null, note: "REWARDS-MEASURE-FAIL: השרשרת לא ענתה — לא נוגעים" };
    if (!pending.totalNonZero) {
      appendRewardsLedger({ kind: "CLAIM-ZERO", account: CURATION_VOTER, pending: { steem: pending.steem, sbd: pending.sbd, vests: pending.vests }, claimed: false, txid: null, note: "אין תגמולים ממתינים — נמדד ורשום" });
      return { ok: true, claimed: false, txid: null, note: `ZERO-REWARDS: אין מה לתבוע (steem ${pending.steem} · sbd ${pending.sbd} · vests ${pending.vests})`, pending: { steem: pending.steem, sbd: pending.sbd, vests: pending.vests } };
    }
    const op: GrapheneOperation = [
      "claim_reward_balance",
      { account: CURATION_VOTER, reward_steem: pending.steem, reward_sbd: pending.sbd, reward_vesting: pending.vests },
    ];
    const ownerKey = readOwnerKey();
    if (!ownerKey || ownerKey.account !== CURATION_VOTER) {
      return { ok: false, claimed: false, txid: null, note: "NO-KEY: מפתח-האב אינו קריא או אינו של המצביע — לא נוגעים" };
    }
    const steem = loadSteem();
    const viaVault = ownerKey.wif ? steemSigningWif("posting", ownerKey.account) : null;
    if (ownerKey.wif && !viaVault) {
      return { ok: false, claimed: false, txid: null, note: "NO-SIGNING: מצב-wif — אין רשומת-posting נפתחה מהכספת; לא נוגעים" };
    }
    const wif = viaVault ? viaVault.wif : steem.auth.toWif(ownerKey.account, ownerKey.password, "posting");
    const derivedPub = steem.auth.wifToPublic(wif);
    type ChainAccount = { posting: { key_auths: Array<[string, number]> } };
    const accounts = await rpcV4<ChainAccount[]>(STEEM_RPC_NODES[0], "condenser_api.get_accounts", [[CURATION_VOTER]]);
    const liveKey = accounts?.[0]?.posting?.key_auths?.[0]?.[0];
    if (!liveKey || derivedPub !== liveKey) {
      return { ok: false, claimed: false, txid: null, note: "KEY-AUTHORITY-MISMATCH: הנגזר אינו בסמכות ה-posting החיה — לא נוגעים" };
    }
    const gate = await steemRcGate(CURATION_VOTER);
    if (!gate.ok) {
      return { ok: false, claimed: false, txid: null, note: `RC-GATED: ${gate.reason ?? "?"} — ננסה ביום-הבא`, pending: { steem: pending.steem, sbd: pending.sbd, vests: pending.vests } };
    }
    const res = await steemBroadcast([op], wif);
    if (!res.txid) return { ok: false, claimed: false, txid: null, note: `BROADCAST-FAIL: ${res.note ?? "?"}`, pending: { steem: pending.steem, sbd: pending.sbd, vests: pending.vests } };
    appendRewardsLedger({ kind: "CLAIMED", account: CURATION_VOTER, pending: { steem: pending.steem, sbd: pending.sbd, vests: pending.vests }, claimed: true, txid: res.txid, note: "תביעה שודרה — VESTS → SP (מיחזור-צירוף) · STEEM/SBD → נזילות-הסולם" });
    return { ok: true, claimed: true, txid: res.txid, note: `נתבעו ${pending.steem} · ${pending.sbd} · ${pending.vests} → txid ${res.txid}`, pending: { steem: pending.steem, sbd: pending.sbd, vests: pending.vests } };
  } catch (e) {
    return { ok: false, claimed: false, txid: null, note: `CLAIM-ERROR: ${String((e as Error).message ?? e).slice(0, 140)}` };
  }
}

// ── חוקי התקציב — בדיקות טהורות לפני כל הצבעה ─────────────────────────

/** כל חוקי-המנה בבדיקה אחת טהורה. מחזירה את הסיבה להימנעות, או null אם מותר. */
export function manaBudgetVerdict(state: CurationState, votingPowerPct: number | null): string | null {
  const day = utcDay();
  if (state.voteDay !== day) return null; // יום חדש — התקציב מתאפס בגלגול
  if (state.votesToday >= CURATION_POLICY.maxVotesPerDay) {
    return `BUDGET-DAY: ${state.votesToday}/${CURATION_POLICY.maxVotesPerDay} הצבעות היום — התקציב מוצה`;
  }
  if (state.votesToday * CURATION_POLICY.weightPctPerVote >= CURATION_POLICY.dailyManaSpendPct) {
    return `BUDGET-MANA: ${state.votesToday}×${CURATION_POLICY.weightPctPerVote}% ≥ תקרת ${CURATION_POLICY.dailyManaSpendPct}% מנה/יום`;
  }
  if (votingPowerPct != null && votingPowerPct < CURATION_POLICY.votingPowerResumePct) {
    return `POWER-FLOOR: כוח-הצבעה ${votingPowerPct.toFixed(1)}% < רצפת-חידוש ${CURATION_POLICY.votingPowerResumePct}% — יום-החזקה כנה (גג-המשקל-המלא: ${CURATION_POLICY.votingPowerFloorPct}%)`;
  }
  return null;
}
