// ─────────────────────────────────────────────────────────────────────
// /api/curation — שער התצוגה והבקרה של דיבון האוצרות (r128 · Task 4-a)
//
// GET  — הפנקס + מדידת כוח-הצבעה חיה + סיכום הגילוי האחרון (קריאה בלבד;
//        ?discover=1 מריץ גילוי חי מהפיד ומחזיר מועמדים עם ניקוד).
// POST — {action:"arm"|"pause"|"resume"|"disarm"|"discover", reason} — ערוץ הבקרה.
//        arm/pause/disarm מנותבים קודם לדיבון עצמו (127.0.0.1:3040 —
//        סופר-כתיבה אחת, בלי חלון-מרוץ מול הפעימה); אם הדיבון לא עונה —
//        כתיבת-פנקס ישירה במיזוג-כנות, והדיבון ירים את השינוי בעלייה/בפעימה.
//        arm מחזיר הדה-יושר של כל חוקי ההצבעה — המפעיל מאשר מה שהוא מפעיל.
//
// חוקי-ברזל: אין שער-סשן (מקומי-מפעיל בלבד, כמו שאר נתיבי הצי), אבל
// כל פעולה נרשמת לספר (appendCurationHistory) — כלום לא קורה בשקט.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import {
  CURATION_POLICY,
  CURATION_VOTER,
  appendCurationHistory,
  castVote,
  discoverCandidates,
  readCurationState,
  readVotingPower,
  saveCurationState,
} from "@/lib/weave/curation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAEMON = "http://127.0.0.1:3040/";

/** הדה-יושר של חוקי ההצבעה — מוחזר בכל חימוש. המפעיל מפעיל בדיוק את אלה. */
function rulesEcho(): string[] {
  return [
    `מקסימום ${CURATION_POLICY.maxVotesPerDay} הצבעות ליום-UTC · הצבעה אחת לכל פעימת-דיבון (15 דק')`,
    `משקל קבוע ${CURATION_POLICY.weightPctPerVote}% להצבעה · סך מנה ≤ ${CURATION_POLICY.dailyManaSpendPct}% ביום (= קצב הרגנרציה)`,
    `רצפת כוח-ההצבעה ${CURATION_POLICY.votingPowerFloorPct}% — מתחת: יום-החזקה, אפס הצבעות`,
    `סף ניקוד מועמד ${CURATION_POLICY.voteScoreThreshold}/100 (תזמון 35 · מעורבות 25 · מוניטין 20 · אורך 10 · דיון 10)`,
    `חלון גיל ${CURATION_POLICY.ageMinMinutes}-${CURATION_POLICY.ageMaxMinutes} דק' · מוניטין מחבר > ${CURATION_POLICY.minAuthorRep} · ${CURATION_POLICY.minWords}+ מילים`,
    `לעולם לא self-vote · לעולם לא אותו פוסט פעמיים · מקסימום ${CURATION_POLICY.maxVotesPerAuthorPerDay} הצבעה למחבר ביום`,
    `לעולם לא קניית-הצבעות: מוטבי ביד-בוט (${CURATION_POLICY.bidBotBlacklist.join(", ")}) ופוסטים מקודמים בתשלום נפסלים`,
    `שער-RC לפני כל שידור — אין מנה: דילוג-כנה · מפתח posting בלבד מהכספת, בזיכרון בלבד`,
  ];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const wantDiscover = url.searchParams.get("discover") === "1";
    const state = readCurationState();
    const power = await readVotingPower();
    const base = {
      ok: true,
      state,
      votingPower: { at: new Date().toISOString(), pct: power.pct, detail: power.detail ?? null },
      policy: CURATION_POLICY,
    };
    // דיבון חי? (בדיקה קצרה — לא חוסמת את התצוגה)
    const ping = await fetch(DAEMON, { signal: AbortSignal.timeout(2500), cache: "no-store" }).catch(() => null);
    if (wantDiscover) {
      // גילוי חי על פי דרישה — קריאה בלבד, לא מצביע לעולם
      const disc = await discoverCandidates({
        votedKeys: new Set(state.votedPosts.map((v) => `${v.author}/${v.permlink}`)),
        authorsToday: new Set(state.votedAuthorsToday),
      });
      return NextResponse.json({
        ...base,
        daemonReachable: !!ping?.ok,
        discovery: { ...disc, candidates: disc.candidates.slice(0, 10) },
      });
    }
    return NextResponse.json({ ...base, daemonReachable: !!ping?.ok });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `קריאת מצב האוצרות נכשלה: ${String((e as Error).message).slice(0, 120)}` },
      { status: 503 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      reason?: string;
      author?: string;
      permlink?: string;
      weightPct?: number;
      score?: number;
    };
    const action = String(body.action ?? "");
    const reason = String(body.reason ?? "").slice(0, 200);

    // ── גילוי לפי דרישה: קריאה בלבד — מנותב לדיבון (הפנקס שלו מתעדכן),
    //    ואם אינו עונה — ישירות מהספרייה. אף מסלול לא מצביע.
    if (action === "discover") {
      try {
        const res = await fetch(DAEMON, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "discover" }),
          signal: AbortSignal.timeout(75_000),
          cache: "no-store",
        });
        const j = (await res.json().catch(() => null)) as { ok?: boolean; discovery?: unknown } | null;
        if (res.ok && j?.ok) {
          return NextResponse.json({ ok: true, action, via: "daemon", discovery: j.discovery });
        }
      } catch {
        /* הדיבון לא ענה — נופלים לספרייה בכנות */
      }
      const state = readCurationState();
      const disc = await discoverCandidates({
        votedKeys: new Set(state.votedPosts.map((v) => `${v.author}/${v.permlink}`)),
        authorsToday: new Set(state.votedAuthorsToday),
      });
      return NextResponse.json({
        ok: true,
        action,
        via: "lib",
        discovery: { ...disc, candidates: disc.candidates.slice(0, 10) },
      });
    }

    if (action === "arm" || action === "pause" || action === "resume" || action === "disarm") {
      // ── ניתוב לדיבון — הסמכות החיה (אותה נשימה: זיכרון + פנקס)
      try {
        const res = await fetch(DAEMON, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, reason }),
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
        });
        const j = (await res.json().catch(() => null)) as { ok?: boolean; state?: unknown } | null;
        if (res.ok && j?.ok) {
          appendCurationHistory(
            `API-${action.toUpperCase()}`,
            `הפעולה בוצעה דרך הדיבון החי (127.0.0.1:3040)${reason ? ` — ${reason}` : ""}`
          );
          return NextResponse.json({
            ok: true,
            action,
            via: "daemon",
            ...(action === "arm" ? { rules: rulesEcho() } : {}),
            state: j.state,
            note:
              action === "arm"
                ? "הדיבון חמוש. ההצבעה הראשונה האפשרית: הפעימה הבאה (עד 15 דק'), רק אם מועמד יעבור את סף הניקוד וכל החוקים יעברו."
                : action === "pause"
                  ? "הדיבון מושהה — מגלה ומודד בלבד, אפס הצבעות עד חידוש (resume)."
                : action === "resume"
                  ? "ההשהיה הוסרה — מצב החימוש נשמר כפי שהיה."
                  : "הדיבון נוטרל — חזר לקו-הבסיס: גילוי-בלבד ולא מושהה, עד חימוש חוזר.",
          });
        }
      } catch {
        /* הדיבון לא ענה — כתיבת-פנקס ישירה בכנות */
      }

      // ── נפילה-כנות: כתיבת הפנקס ישירות. הדיבון ירים את השינוי בעלייה
      //    הבאה שלו (readCurationState) או במיזוג שדות-הבקרה בפעימה.
      const state = readCurationState();
      if (action === "arm") {
        state.armed = true;
        state.paused = false;
        state.pauseReason = null;
      } else if (action === "pause") {
        state.paused = true;
        state.pauseReason = reason || "סיבה לא נמסרה";
      } else if (action === "resume") {
        state.paused = false;
        state.pauseReason = null;
      } else {
        state.armed = false;
        state.paused = false;
        state.pauseReason = null;
      }
      saveCurationState(state);
      appendCurationHistory(
        `API-${action.toUpperCase()}-FALLBACK`,
        `הדיבון לא ענה — הפעולה נכתבה ישירות לפנקס; תיכנס לתוקף בעליית הדיבון או במיזוג הפעימה${reason ? ` — ${reason}` : ""}`
      );
      return NextResponse.json({
        ok: true,
        action,
        via: "state-file-fallback",
        ...(action === "arm" ? { rules: rulesEcho() } : {}),
        state,
        note: "הדיבון (127.0.0.1:3040) לא ענה — הפעולה נכתבה לפנקס המצב ותיכנס לתוקף כשהדיבון יענה/יקום. אמת מלאה, לא הצלחה מדומיינת.",
      });
    }

    // ── שידור הצבעה דרך ה-API (חוק פרימיטיב-המפתח r128): הכספת נפתחת
    //    בהקשר Next בלבד — node:sqlite אינו קיים בהקשר Bun של הדיבון.
    //    הדיבון מחליט ומנהל את הפנקס; ה-API הוא ערוץ השידור —
    //    אותו דפוס שמוכח אצל מוביל-הכסף מאז יומו.
    if (action === "cast-vote") {
      const author = String(body.author ?? "").trim().toLowerCase();
      const permlink = String(body.permlink ?? "").trim();
      const weightPct = Number(body.weightPct ?? CURATION_POLICY.weightPctPerVote);
      // קו-הגנה אחרון בצד המשדר: החוקים נבדקים כאן שוב — לא רק אצל הדיבון.
      if (!/^[a-z0-9.\-]{3,16}$/.test(author)) {
        return NextResponse.json({ ok: false, action, error: "BAD-AUTHOR" }, { status: 400 });
      }
      if (author === CURATION_VOTER) {
        return NextResponse.json({ ok: false, action, error: "SELF-VOTE-BLOCKED: החוק נאכף בשער השידור" }, { status: 403 });
      }
      if (!Number.isFinite(weightPct) || weightPct <= 0 || weightPct > CURATION_POLICY.weightPctPerVote) {
        return NextResponse.json({ ok: false, action, error: `WEIGHT-CAP: משקל מעל ${CURATION_POLICY.weightPctPerVote}% אסור בשער` }, { status: 400 });
      }
      const state = readCurationState();
      const key = `${author}/${permlink}`;
      if (state.votedPosts.some((v) => `${v.author}/${v.permlink}` === key)) {
        return NextResponse.json({ ok: false, action, error: "DOUBLE-VOTE-BLOCKED: פוסט זה כבר הוצבע" }, { status: 409 });
      }
      const res = await castVote({ author, permlink, weightPct });
      appendCurationHistory(
        res.ok ? "API-VOTE" : "API-VOTE-FAIL",
        `${res.note} · שודר עבור הדיבון (score ${String(body.score ?? "n/a")})`
      );
      return NextResponse.json({ ok: res.ok, action, txid: res.txid, note: res.note, rcGate: res.rcGate ?? null });
    }

    return NextResponse.json(
      { ok: false, error: `פעולה לא מוכרת: ${action || "(ריק)"} — arm | pause | resume | disarm | discover | cast-vote` },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `פעולת האוצרות נכשלה: ${String((e as Error).message).slice(0, 120)}` },
      { status: 503 },
    );
  }
}
