// ─────────────────────────────────────────────────────────────────────
// CURATION — דיבון האוצרות · הפעלת כוח-ההצבעה הבטל (r128 · Task 4-a)
//
// החוזה: פעימה כל 15 דקות. כל פעימה: מדידת כוח-הצבעה חיה מהשרשרת,
// גילוי מועמדים מהפיד החי (created לפי תגיות), ניקוד-תזמון מתועד,
// ואז — רק אם חמוש, בתקציב, מעל הרצפה ומעל סף הניקוד — הצבעה אחת
// בלבד לכל פעימה (פרישה טבעית). המנוע חי ב-src/lib/weave/curation.ts —
// הדיבון הוא לב-פעימה, אותו שאסיפוס של הדופק והצייד.
//
// חוקי-ברזל:
//   · עולה במצב DISCOVER-ONLY (armed=false) — החימוש החלטת מפעיל בלבד
//     (POST /api/curation {action:"arm"}); עד אז: מגלה, מנקד, מתעד — לא מצביע
//   · מקסימום הצבעה אחת לפעימה · מקסימום 10/יום · 6% להצבעה (r150, היה 2%) · ≤20% מנה/יום
//   · r146-a חוק-הכוח הדו-מדורגי: מתחת ל-70% יום-החזקה כנה; מ-70% ומעלה
//     מצביעים ב-6% (הרצפה-הישנה 85% נשארה גג-המשקל-המלא). המדידה שהביאה
//     לתיקון: רצפת-85% קשה קפאה 48ש'+ אחרי כל ירידה, בזמן שכותב-אחר על
//     אותו חשבון ממשיך לשרוף מנה — ההחזקה לא שימרה כוח ולא הניבה הכנסה.
//   · r146-a צינור-התגמולים: פעם ביום-UTC נמדדות יתרות-התגמול הממתינות
//     (reward_vesting/reward_sbd/reward_steem) ונתבעות לארנק — ה-VESTS
//     מגדילים SP (התחזקות-צירוף של הצבעת-האוצרות), ה-STEEM/SBD נופלים
//     ליתרות-הנזילות שהסולם כבר סוחר מהן. כל-ניסיון — כנות בפנקס וברשומות.
//   · אין self, אין אותו פוסט פעמיים, אין 1/מחבר/יום פעמיים, אין ביד-בוטים
//   · שער-RC לפני כל שידור — דילוג-כנה שנרשם, לא כשל
//   · כל החלטה — גם דילוג — נרשמת בפנקס ובהיסטוריה (כנות מלאה)
//   · הדיבון נצרך מ-localhost בלבד · טיימר-יחיד · שרת-יחיד · כתיבה-אטומית
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה (כמו בדופק/צייד)
declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

import {
  CURATION_POLICY,
  CURATION_STATE_FILE,
  CURATION_VOTER,
  appendCurationHistory,
  discoverCandidates,
  manaBudgetVerdict,
  readCurationState,
  readVotingPower,
  saveCurationState,
  utcDay,
  type CurationState,
  type Decision,
} from "../../src/lib/weave/curation";
// r144-i2 — שכבת-מניעת-שכפול-תוכן חוצת-חשבונות (תוספת נקייה: אפס-נגיעה
// באיש-המת, במכסות ובנתיב-ההצבעה; השער מוסיף זיכרון-תגובות + יומן-דדופ)
import { contentGate, ensureDedupeLog, type DedupeStatus } from "./dedupe";

const PORT = 3040;
const TICK_SEC = 15 * 60; // פעימה כל 15 דק' — פרישה טבעית של ההצבעות
// r143-c — שורש-הבית (ליומן-מתג-איש-המת; המנוע עצמו מגדיר את שלו ב-src/lib)
const HOME = "/home/z/my-project";

// ── ציר-העולם (R124): דור-חם יורש את אובייקט-המצב החי — קריאת-דיסק בכל
// דור הייתה חושפת את הפנקס לשכתוב-מדור-קפוא. האיתחול היחיד: עלייה ראשונה.
const G_CURATION = globalThis as unknown as { __CURATION_STATE__?: CurationState };
let state: CurationState = G_CURATION.__CURATION_STATE__ ?? readCurationState();
G_CURATION.__CURATION_STATE__ = state;

// חוק שדות-הבקרה: ה-API רשאי לכתוב armed/paused ישירות לדיסק (כשאנחנו
// לא מספיקים לענות). הכתיבה שלנו לעולם לא תדרוס החלטת מפעיל — לכן לפני
// כל שמירה מתמזגים השדות מהדיסק, אלא אם השינוי מקורו בנו (controlDirty).
let controlDirty = false;

function setControl(patch: { armed?: boolean; paused?: boolean; pauseReason?: string | null }): void {
  if (patch.armed !== undefined) state.armed = patch.armed;
  if (patch.paused !== undefined) state.paused = patch.paused;
  if (patch.pauseReason !== undefined) state.pauseReason = patch.pauseReason;
  controlDirty = true;
}

function mergeControlFromDisk(): void {
  // חוק שדות-הבקרה: הדיסק הוא הסמכות ל-armed/paused — ה-API רשאי לכתוב אותם
  // ישירות לפנקס (נפילה-כנות כשלא ענינו בזמן). מיזוג בפתיחת כל פעימה
  // ולפני כל שמירה — החלטת מפעיל לעולם לא תידרס ולא תמתין יותר מפעימה.
  try {
    const disk = JSON.parse(fs.readFileSync(CURATION_STATE_FILE, "utf8")) as Partial<CurationState>;
    state.armed = disk.armed === true;
    state.paused = disk.paused === true;
    state.pauseReason = disk.pauseReason ?? null;
  } catch {
    /* אין קובץ עדיין — הזיכרון הוא האמת */
  }
}

function saveState(): void {
  if (!controlDirty) mergeControlFromDisk();
  controlDirty = false;
  saveCurationState(state);
}

function decide(kind: string, detail: string, toHistory = true): void {
  const d: Decision = { at: new Date().toISOString(), kind, detail };
  state.lastDecision = d;
  if (toHistory) appendCurationHistory(kind, detail);
}

// ── פעימת האוצרות ────────────────────────────────────────────────────
let ticking = false;
// r143-c — חותמת-הפעימה האחרונה — מזינה את מתג-איש-המת בסוף-הקובץ
let lastBeatAt = Date.now();

// ── r146-a · צינור-התגמולים — ניסיון-תביעה יומי ─────────────────────
// אותו דפוס פרימיטיב-המפתח של ההצבעה: הדיבון מחליט ומתעד; השידור דרך
// ה-API (הכספת נפתחת בהקשר Next בלבד). פעם ביום-UTC: מדידה → תביעה או
// רישום-אפס כנה. כישלון-כנה לא שורף את היום — יינסה שוב בפעימה הבאה.
let claiming = false;
async function attemptDailyClaim(day: string): Promise<void> {
  if (claiming) return;
  if (state.lastClaimDay === day) return; // ניסיון אחד ליום-UTC
  claiming = true;
  try {
    const res = (await fetch("http://localhost:3000/api/curation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim-rewards" }),
      signal: AbortSignal.timeout(60_000),
    })
      .then((x) => x.json() as Promise<{ ok?: boolean; claimed?: boolean; txid?: string | null; note?: string; pending?: { steem: string; sbd: string; vests: string } | null }>)
      .catch(() => ({ ok: false, claimed: false, txid: null, note: "שער השידור (ה-API) לא ענה — ננסה בפעימה הבאה" }))) as {
      ok: boolean;
      claimed: boolean;
      txid: string | null;
      note: string;
      pending?: { steem: string; sbd: string; vests: string } | null;
    };
    if (!res.ok && res.note?.includes("לא ענה")) {
      // ה-API לא ענה — לא סוגרים את היום, הניסיון יחזור בפעימה הבאה
      decide("CLAIM-SKIP", `תביעת-התגמולים נדחתה: ${res.note}`, true);
      return;
    }
    state.lastClaimDay = day;
    state.lastClaimAt = new Date().toISOString();
    state.lastClaimTxid = res.txid ?? null;
    state.lastClaimNote = res.note ?? null;
    if (res.ok && res.claimed) {
      const p = res.pending;
      decide("CLAIM", `תגמולים נתבעו (${p ? `steem ${p.steem} · sbd ${p.sbd} · vests ${p.vests}` : res.note}) · txid ${res.txid} · מיחזור: VESTS → SP · STEEM/SBD → נזילות-הסולם`, true);
    } else if (res.ok) {
      decide("CLAIM-ZERO", `אין תגמולים ממתינים — נמדד ורשום (${res.note}) · הצינור חי ומודד יומית`, true);
    } else {
      decide("CLAIM-FAIL", `תביעת-התגמולים נכשלה בכנות: ${res.note} — היום נסגר; המדידה תחזור מחר`, true);
    }
  } finally {
    claiming = false;
  }
}

async function tick(): Promise<void> {
  if (ticking) return; // לולאה-יחידה
  ticking = true;
  try {
    // r145-b — הצריכה החיה של דיג'סט-הקהל (audience-analyst, D-r145-AUD):
    // הדיבון מביא מ-Domain את latest.json (מסלול-פומבי, נטול-מפתחות) במטמון
    // 6 שעות, וכותב אותו ל-sovereign/audience/latest-digest.json — מקור
    // readResonanceTags() בסיור. כשל-הבאה כנה ושקט: הסיור ממשיך מהקובץ הקודם
    // עד שיתיישן (48ש') ואז חוזר לתגיות-הבסיס בלבד.
    await refreshAudienceDigest();

    // מיזוג שדות-הבקרה לפני כל החלטה — פעולת מפעיל שנכתבה לפנקס בין
    // הפעימות נכנסת לתוקף מיד בפעימה זו, בלי החלטה מיושנת אחת חינם
    mergeControlFromDisk();
    state.beats += 1;
    lastBeatAt = Date.now(); // r143-c — הוכחת-החיים נמדדת כאן
    const day = utcDay();

    // גלגול יום-UTC כנה — התקציב מתאפס רק בחצות אמיתי
    if (state.voteDay !== day) {
      const rolled = { day: state.voteDay, votes: state.votesToday };
      state.voteDay = day;
      state.votesToday = 0;
      state.votedAuthorsToday = [];
      decide("DAY-ROLLOVER", `יום-UTC חדש (${day}) — התקציב התאפס (אתמול: ${rolled.votes} הצבעות ב-${rolled.day})`);
    }

    // r146-a — צינור-התגמולים: ניסיון-תביעה יומי (פעם ביום-UTC, לפני ההצבעה)
    await attemptDailyClaim(day);

    // 1) מדידה חיה של כוח-ההצבעה — השרשרת שופטת, לא הזיכרון
    const power = await readVotingPower(CURATION_VOTER);
    state.votingPowerLast = { at: new Date().toISOString(), pct: power.pct, ...(power.ok ? {} : { detail: power.detail }) };
    // r157 — עקומת-VP (אישור-מפעיל D-r157-VP-COORD): טבעת-דגימה-שעתית — מקור-האמת
    // לחלון-השיא-היומי מול-הכותב-החוץ (census V1b). הדגימה-מתבצעת-רק-אם-עברו-45 דק'
    // מהדגימה-הקודמת (פעימות-השירות-צפופות-בהרבה) · גג-480 דגימות (~20 ימים).
    if (power.ok && power.pct != null) {
      const nowMs = Date.now();
      const lastSampleAt = state.votingPowerCurve?.at(-1)?.at;
      if (!lastSampleAt || nowMs - Date.parse(lastSampleAt) >= 45 * 60_000) {
        state.votingPowerCurve = [
          ...(state.votingPowerCurve ?? []),
          // r161 — דגימה-דו-בריכתית: pct=manabar (קונצנזוס, שמרני) · vpField=השדה-הקנוני-מה-UI
          { at: new Date(nowMs).toISOString(), pct: Math.round(power.pct * 100) / 100, vpField: power.vpField != null ? Math.round(power.vpField * 100) / 100 : null },
        ].slice(-480);
      }
    }

    // 2) גילוי — הפיד החי + הפנקס (אותו פוסט פעמיים / מחבר-של-היום)
    const votedKeys = new Set(state.votedPosts.map((v) => `${v.author}/${v.permlink}`));
    const authorsToday = new Set(state.votedAuthorsToday);
    const disc = await discoverCandidates({ votedKeys, authorsToday });
    state.candidatesSeen += disc.candidates.length;
    state.lastDiscovery = {
      at: disc.at,
      node: disc.node,
      fetched: disc.fetched,
      candidates: disc.candidates.slice(0, 10), // עשירייה ראשונה בפנקס — השאר בהיסטוריית הלוג
      filtered: disc.filtered,
    };

    // 2.5) r144-i2 — שער-תוכן חוצת-חשבונות: זיכרון-50-התגובות האחרונות של
    //      כל-החשבונות שלנו, סריקת חפיפה ≥0.6, רישום כנה ב-dedupe-log.json.
    //      כשל-כנה לא נוגע בהצבעה (fail-soft מלא בתוך contentGate).
    //      r145-b retry: הקאסט הישן (`dedupe?: unknown`) היה שגיאת-tsc קיימת-מראש
    //      (unknown אינו מוקצה ל-DedupeStatus) — תוקן ל-DedupeStatus. הקאסט נכון:
    //      contentGate עצמו כותב state.dedupe בסוף-הריצה (שדה-תוספת בפנקס),
    //      ו-CurationState הממשקי אינו מכריז עליו — מבנה-חלש דורש חפיפה.
    await contentGate(state as CurationState & { dedupe?: DedupeStatus });

    // 3) בקרת-בטיחות: השהיה יזומה
    if (state.paused) {
      decide("PAUSED", `מושהה ע"י המפעיל${state.pauseReason ? ` — ${state.pauseReason}` : ""} · הגילוי ממשיך למדוד (${disc.candidates.length} מועמדים, כוח ${power.pct ?? "?"}%) — אפס הצבעות`);
    }
    // 4) בקרת-בטיחות r128: לא חמוש — גילוי-בלבד. זהו סף-ההפעלה עד החלטת המפעיל.
    else if (!state.armed) {
      const top = disc.candidates[0];
      decide(
        "DISCOVER-ONLY",
        `לא חמוש — מגלה ומנקד בלבד${disc.error ? ` · שגיאת גילוי כנה: ${disc.error}` : ""} · ${disc.candidates.length} מועמדים מ-${disc.fetched} פוסטים${top ? ` · המוביל: @${top.author} ${top.score}′ (גיל ${top.ageMin}ד')` : ""} · כושר ${power.pct ?? "?"}%${power.pct != null && power.pct < CURATION_POLICY.votingPowerFloorPct ? " (מתחת לרצפה — גם חימוש לא היה מצביע)" : ""}`
      );
    }
    // 5) תקציב / רצפה — חוקי המנה
    else if (disc.error) {
      decide("DISCOVER-FAIL", `הגילוי נכשל בכנות: ${disc.error} — אין מועמדים להצבעה בפעימה זו`);
    } else {
      const verdict = manaBudgetVerdict(state, power.pct);
      const top = disc.candidates[0];
      if (verdict) {
        decide("HOLD", `${verdict} · הגילוי ממשיך ברקע (${disc.candidates.length} מועמדים נראו)`);
      } else if (!top || top.score < CURATION_POLICY.voteScoreThreshold) {
        decide(
          "WAIT-NO-CANDIDATE",
          `אף מועמד מעל סף ${CURATION_POLICY.voteScoreThreshold}${top ? ` — הטוב ביותר: @${top.author} ${top.score}′ (גיל ${top.ageMin}ד', ${top.votes} הצבעות)` : " — הפיד ריק ממועמדים כרגע"} · כנות: לא מצביעים בלי סיבה`
        );
      } else {
        // 6) ההצבעה — אחת בלבד לפעימה. הדיבון מחליט; ה-API משדר (חוק פרימיטיב-המפתח
        //    r128: node:sqlite של הכספת אינו קיים בהקשר Bun — ערוץ השידור הוא Next,
        //    בדיוק כמו מוביל-הכסף. שער-RC בפנים; כישלון כנה לא שורף תקציב.
        const res = (await fetch("http://localhost:3000/api/curation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "cast-vote",
            author: top.author,
            permlink: top.permlink,
            weightPct: CURATION_POLICY.weightPctPerVote,
            score: top.score,
          }),
          signal: AbortSignal.timeout(60_000),
        })
          .then((x) => x.json() as Promise<{ ok?: boolean; txid?: string | null; note?: string }>)
          .catch(() => ({ ok: false, note: "שער השידור (ה-API) לא ענה — ננסה בפעימה הבאה" }))) as {
          ok: boolean;
          txid: string | null;
          note: string;
        };
        if (res.ok) {
          state.votesToday += 1;
          state.lastVoteAt = new Date().toISOString();
          state.votedPosts = [...state.votedPosts, { author: top.author, permlink: top.permlink, at: state.lastVoteAt, txid: res.txid, weightPct: CURATION_POLICY.weightPctPerVote, score: top.score }].slice(-CURATION_POLICY.votedPostsCap);
          state.votedAuthorsToday = [...state.votedAuthorsToday, top.author];
          decide(
            "VOTE",
            `הוצבע ${CURATION_POLICY.weightPctPerVote}% על @${top.author}/${top.permlink.slice(0, 48)} (ניקוד ${top.score}, גיל ${top.ageMin}ד', כוח לפני ${(power.pct ?? 0).toFixed(1)}%) · txid ${res.txid} · היום ${state.votesToday}/${CURATION_POLICY.maxVotesPerDay}`,
            true
          );
        } else {
          decide("VOTE-SKIP", `ההצבעה על @${top.author} לא בוצעה: ${res.note} — ננסה שוב בפעימה הבאה (התקציב לא נשחק)`, true);
        }
      }
    }

    saveState();
  } catch (e) {
    decide("ERROR", `פעימה נכשלה בכנות: ${String((e as Error).message ?? e).slice(0, 160)}`);
    saveState();
  } finally {
    ticking = false;
  }
}

// ── שרת-בריאות + שער-בקרה ────────────────────────────────────────────
// R124 — שרת-היחיד חוצה-דורות: ה-handler מגיש את המצב החי מציר-העולם.
// POST / — ערוץ הבקרה של ה-API (חימוש/השהיה/גילוי) — כותב את הסמכות
// באותה נשימה לפנקס, בלי חלון-מרוץ מול הפעימה.
const G_CURATION_SRV = globalThis as unknown as { __CURATION_SERVER__?: unknown };
if (G_CURATION_SRV.__CURATION_SERVER__) {
  // שרת חי מדור קודם — ממשיך להגיש.
} else {
  G_CURATION_SRV.__CURATION_SERVER__ = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1", // R123 — הדיבון נצרך מ-localhost בלבד (API/שומר/מפעיל מקומי)
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/" && req.method === "GET") {
        return Response.json({ ...state, ok: true, alive: true, now: new Date().toISOString() });
      }
      if (url.pathname === "/" && req.method === "POST") {
        // שער-בקרה — מקומי בלבד (127.0.0.1), ה-API הוא הפונה היחיד
        return (async () => {
          try {
            const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
            const action = String(body.action ?? "");
            const reason = String(body.reason ?? "").slice(0, 200);
            if (action === "arm") {
              setControl({ armed: true, paused: false, pauseReason: null });
              saveState();
              appendCurationHistory("ARMED", `הדיבון חומש ע"י המפעיל${reason ? ` — ${reason}` : ""}`);
              decide("ARMED", `חומש — החוקים בתוקף: מקס ${CURATION_POLICY.maxVotesPerDay}/יום · ${CURATION_POLICY.weightPctPerVote}% להצבעה · רצפת כוח ${CURATION_POLICY.votingPowerFloorPct}% · סף ניקוד ${CURATION_POLICY.voteScoreThreshold}`, false);
              saveState();
              return Response.json({ ok: true, action: "arm", state });
            }
            if (action === "pause") {
              setControl({ paused: true, pauseReason: reason || "סיבה לא נמסרה" });
              saveState();
              appendCurationHistory("PAUSED", `הושהה ע"י המפעיל — ${reason || "סיבה לא נמסרה"}`);
              return Response.json({ ok: true, action: "pause", state });
            }
            if (action === "resume") {
              // חידוש לאחר השהיה — מנקה את ה-pause בלבד, בלי לגעת בחימוש
              setControl({ paused: false, pauseReason: null });
              saveState();
              appendCurationHistory("RESUMED", `ההשהיה הוסרה${reason ? ` — ${reason}` : ""} · מצב החימוש נשמר כפי שהיה`);
              return Response.json({ ok: true, action: "resume", state });
            }
            if (action === "disarm") {
              // ניטול — חזרה מלאה לקו-הבסיס: גילוי-בלבד, לא מושהה
              setControl({ armed: false, paused: false, pauseReason: null });
              saveState();
              appendCurationHistory("DISARMED", `נוטרל ע"י המפעיל — חזרה לקו-הבסיס (גילוי-בלבד, השהיה מוסרת)${reason ? ` — ${reason}` : ""}`);
              return Response.json({ ok: true, action: "disarm", state });
            }
            if (action === "discover") {
              // גילוי לפי דרישה — קריאה בלבד, לא מצביע לעולם
              const votedKeys = new Set(state.votedPosts.map((v) => `${v.author}/${v.permlink}`));
              const disc = await discoverCandidates({ votedKeys, authorsToday: new Set(state.votedAuthorsToday) });
              state.candidatesSeen += disc.candidates.length;
              state.lastDiscovery = { at: disc.at, node: disc.node, fetched: disc.fetched, candidates: disc.candidates.slice(0, 10), filtered: disc.filtered };
              saveState();
              return Response.json({ ok: true, action: "discover", discovery: { ...disc, candidates: disc.candidates.slice(0, 10) }, armed: state.armed, votesToday: state.votesToday });
            }
            return Response.json({ ok: false, error: `פעולה לא מוכרת: ${action || "(ריק)"} — arm | pause | resume | disarm | discover` }, { status: 400 });
          } catch (e) {
            return Response.json({ ok: false, error: String((e as Error).message ?? e).slice(0, 120) }, { status: 500 });
          }
        })();
      }
      return new Response("not found", { status: 404 });
    },
  });
}

ensureDedupeLog(); // r144-i2 — יומן-הדדופ חי מהעלייה הראשונה (גם ריק+כותרת)

// ── r145-b · הבאת דיג'סט-הקהל (audience-analyst → Domain → בית) ─────────
// מטמון 6 שעות על הקובץ עצמו (mtime) — הדיג'סט עצמו יומי; אפס-לחץ על
// הרשת, והצריכה נשארת קריאה-בלבד ממסלול-פומבי. אפס סודות כאן.
const AUDIENCE_FILE = "/home/z/my-project/sovereign/audience/latest-digest.json";
const AUDIENCE_SRC = "https://raw.githubusercontent.com/roshpinacare-sys/Domain/main/audience/latest.json";
const AUDIENCE_CACHE_MS = 6 * 3_600_000;
let audienceFetching: Promise<void> | null = null;
async function refreshAudienceDigest(): Promise<void> {
  if (audienceFetching) return audienceFetching;
  audienceFetching = (async () => {
    try {
      const st = fs.existsSync(AUDIENCE_FILE) ? fs.statSync(AUDIENCE_FILE) : null;
      if (st && Date.now() - st.mtimeMs < AUDIENCE_CACHE_MS) return; // מטמון חי — אפס קריאה
      const res = await fetch(AUDIENCE_SRC, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (!res.ok) return; // כשל-הבאה שקט — הדיג'סט הקודם ממשיך עד יעוד 48ש'
      const digest = (await res.json()) as unknown;
      fs.mkdirSync("/home/z/my-project/sovereign/audience", { recursive: true });
      const tmp = `${AUDIENCE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: new Date().toISOString(), source: "Domain/audience/latest.json", digest }, null, 2), "utf8");
      fs.renameSync(tmp, AUDIENCE_FILE);
      appendCurationHistory("AUDIENCE-DIGEST", `דיג'סט-קהל חי הובא מ-Domain (r145-b) — מזין תגיות-רזוננס בסיור`);
    } catch {
      // כשל-הבאה כנה — אפס שינוי; readResonanceTags ידלג כשהקובץ יתיישן
    } finally {
      audienceFetching = null;
    }
  })();
  return audienceFetching;
}
void refreshAudienceDigest(); // הבאה ראשונה בעלייה — לפני הפעימה הראשונה

saveState();
console.log(`[curation] חי על פורט ${PORT} · beats=${state.beats} · ${state.armed ? "חמוש" : "גילוי-בלבד (לא חמוש — חימוש בידי המפעיל)"} · הצבעות היום ${state.votesToday}/${CURATION_POLICY.maxVotesPerDay}`);
tick();
// R112 — law of the single timer: bun --hot לא מנקה את האינטרוול הישן —
// כל עריכה-חיה הייתה מכפילה את הפעימה. השומר תופס ומנקה את הקודם.
const G = globalThis as unknown as { __CURATION_TIMER__?: ReturnType<typeof setInterval> };
if (G.__CURATION_TIMER__) clearInterval(G.__CURATION_TIMER__);
G.__CURATION_TIMER__ = setInterval(tick, TICK_SEC * 1000);

// ── r143-c · מתג-איש-מת ─────────────────────────────────────
// זומבי חי שנמדד (keeper, r143): HTTP עונה בזמן שהפעימות קפואות.
// כל 60ש' נמדדת התקדמות-הלולאה; שתיקה מעל 45 דק' (3×קצב-הפעימה של 15 דק')
// ⇒ שורה כנה ביומן-הדיבון ויציאה (exit 1) — fleet-guard יקים תהליך-טרי.
// פעימה איטית אחת לעולם לא הורגת דיבון בריא. הטיימר במשמר-גלובלי
// (חוק הטיימר-היחיד) — טעינה-חמה לא מכפילה שומרים.
const DEAD_MAN_TICK_MS = 60_000;
const DEAD_MAN_STALL_MS = 45 * 60_000; // 3×TICK_SEC (900ש') · > קצב×2
const DEAD_MAN_LOG = `${HOME}/sovereign/keeper/logs/curation-daemon.log`;
const G_DM = globalThis as unknown as { __CURATION_DEADMAN__?: ReturnType<typeof setInterval> };
if (G_DM.__CURATION_DEADMAN__) clearInterval(G_DM.__CURATION_DEADMAN__);
G_DM.__CURATION_DEADMAN__ = setInterval(() => {
  if (Date.now() - lastBeatAt <= DEAD_MAN_STALL_MS) return;
  const msg = "dead-man: beats stalled >45min — exiting for revival";
  try {
    fs.mkdirSync(`${HOME}/sovereign/keeper/logs`, { recursive: true });
    fs.appendFileSync(DEAD_MAN_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log(msg);
  clearInterval(G_DM.__CURATION_DEADMAN__);
  process.exit(1);
}, DEAD_MAN_TICK_MS);
