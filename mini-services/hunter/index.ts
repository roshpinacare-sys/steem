// ─────────────────────────────────────────────────────────────────────
// HUNTER — הצייד · סריקת הזדמנויות + קנרית שער-הדקות (R82, rebuilt R90)
//
// החוזה: סריקה כל 10 דק' (מוביל + אוצר) עם דוח-כנות, וקנרית אוטונומית
// כל 6 שעות שמנסה להעיר את שער-הדקות של הריפואים הפרטיים (dispatch
// canary.yml ב-Defi). כשהקנרית מצייצת — השער נפתח חזרה.
//
// חוקי-ברזל:
//   · סריקה שנכשלה נרשמת כ"לא נמדד" — אף פעם לא מזייפים מספר
//   · הקנרית לעולם לא שוכחת את המועד הבא (6ש' קדימה מהניסיון האחרון)
//   · הקנרית לא מפציצה: מקסימום 4 dispatch/יום (כל 6ש')
//   · קבלת הקנרית לקנון אחרי שער-סודות
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה (כמו במפעל-האימות)
declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/hunter/state.json`;
const PORT = 3035;
const SCAN_INTERVAL_SEC = 600;
const CANARY_EVERY_MS = 6 * 60 * 60 * 1000;
const CANARY_REPO = "roshpinacare-sys/Defi";
const CANARY_WORKFLOW = "canary.yml";
const GH = "https://api.github.com";

type Decision = { at: string; kind: string; detail: string };

type HunterState = {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  scanIntervalSec: number;
  alive: boolean;
  scanning: boolean;
  lastScanAt: string | null;
  canary: {
    repo: string;
    workflow: string;
    lastDispatchAt: string | null;
    lastRun: Record<string, unknown> | null;
    lastSuccessAt: string | null;
    nextDueAt: string;
    dispatchesToday: number;
    day: string;
    gate: "OPEN" | "QUOTA-DEAD"; // R106 — השער עצמו נמדח, לא רק הריצה
    deadStreak: number; // רצף dispatch-ים שהסתיימו בכשל-ריצה (הרץ מעולם לא התחיל)
    deadSince: string | null; // מתי זוהה מוות-התקציב בפעם הראשונה
    lastRunReadError?: string | null; // R123 — כישלון קריאת מצב-הריצה — נרשם, לא נבלע
  };
  lastDecision: Decision | null;
  history: Array<Decision>;
  canonLast: { at: string; ok: boolean; path: string } | null;
  scansToday: number;
  scanDay: string;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function readState(): HunterState {
  const base: HunterState = {
    service: "hunter",
    version: "1.3.0",
    bootedAt: new Date().toISOString(),
    beats: 0,
    scanIntervalSec: SCAN_INTERVAL_SEC,
    alive: true,
    scanning: false,
    lastScanAt: null,
    canary: {
      repo: CANARY_REPO,
      workflow: CANARY_WORKFLOW,
      lastDispatchAt: null,
      lastRun: null,
      lastSuccessAt: null,
      nextDueAt: new Date().toISOString(),
      dispatchesToday: 0,
      day: utcDay(),
      gate: "OPEN",
      deadStreak: 0,
      deadSince: null,
    },
    lastDecision: null,
    history: [],
    canonLast: null,
    scansToday: 0,
    scanDay: utcDay(),
  };
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const sameDay = prev.canary?.day === utcDay();
    return {
      ...base,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      lastScanAt: prev.lastScanAt ?? null,
      canary: {
        ...base.canary,
        ...prev.canary,
        // המשכיות: nextDueAt תמיד נשמר — הקנרית הבאה בדיוק 6ש' אחרי האחרונה
        nextDueAt: prev.canary?.nextDueAt ?? new Date().toISOString(),
        dispatchesToday: sameDay ? (prev.canary?.dispatchesToday ?? 0) : 0,
        day: sameDay ? prev.canary.day : utcDay(),
        gate: prev.canary?.gate === "QUOTA-DEAD" ? "QUOTA-DEAD" : "OPEN",
        deadStreak: typeof prev.canary?.deadStreak === "number" ? prev.canary.deadStreak : 0,
        deadSince: prev.canary?.deadSince ?? null,
      },
      lastDecision: prev.lastDecision ?? null,
      history: Array.isArray(prev.history) ? prev.history.slice(-40) : [],
      canonLast: prev.canonLast ?? null,
      scansToday: prev.scanDay === utcDay() ? (prev.scansToday ?? 0) : 0,
      scanDay: prev.scanDay === utcDay() ? prev.scanDay : utcDay(),
    };
  } catch (e: any) {
    // כנות (R123): state קיים אך בלתי-קריא אינו נבלע בשקט — האיתחול נרשם
    // כהחלטה גלויה. קובץ שאינו קיים = עלייה ראשונה כנה.
    if (fs.existsSync(STATE_FILE)) {
      return {
        ...base,
        lastDecision: {
          at: new Date().toISOString(),
          kind: "STATE-RESET",
          detail: `קובץ-המצב קיים אך לא נקרא (${String(e?.message ?? e).slice(0, 80)}) — אותחל מצב חדש בכנות`,
        },
      };
    }
    return base;
  }
}

// R124 — ציר-עולם למצב הדיבון (דפוס weblift/fleet-verify): דור-חם יורש את
// אובייקט-המצב החי; קריאה-מדיסק בכל דור חשפה את המצב לשכתוב-מדור-קפוא.
const G_HUNTER = globalThis as unknown as { __HUNTER_STATE__?: HunterState };
let state: HunterState = G_HUNTER.__HUNTER_STATE__ ?? readState();
G_HUNTER.__HUNTER_STATE__ = state;

function saveState() {
  fs.mkdirSync(`${HOME}/sovereign/hunter`, { recursive: true });
  // R107b — חוק הכתיבה-האטומית (כמו בשומר): .tmp ואז rename — רגע-מוות
  // באמצע כתיבה לא משאיר ליורש קובץ-מצב חצוי.
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function readPat(): string | null {
  try {
    const t = fs.readFileSync(`${HOME}/upload/pat.env`, "utf8").trim();
    return t.length > 20 ? t : null;
  } catch {
    return null;
  }
}

// ── קנרית: הערת שער-הדקות ─────────────────────────────────────────
// R106 — חוק מוות-התקציב: כשמדידת-הריצה מראה שהרץ מעולם לא התחיל (כשל
// מיידי, 0 צעדים) שוב ושוב — זו חנקת-Actions של הארגון, לא שער שנפתח
// בניסיון הבא. הצייד מפסיק להפציץ שער מת (באסה לגשאוש יומי בלבד),
// מתעד את מצב-השער בכנות, וממשיך לחזור — כי המכסה יכולה לחזור בכל רגע
// שהמפעיל מחליט. עד אז: הצי המקומי הוא המכונה, הענן גיבוי בלבד.
let canaryNoPatNoted = false; // R123 — דגל חד-פעמי: היעדר-סמכות נרשם פעם, לא כל פעימה
async function canaryTick(): Promise<void> {
  const pat = readPat();
  if (!pat) {
    // R123 — כנות: בלי סמכות הקנרית לא נשלחת — זה נרשם בכנות פעם אחת
    // לכל עלייה (לא כל פעימה — שההיסטוריה לא תוצף), ולא נשאר שקט.
    if (!canaryNoPatNoted) {
      canaryNoPatNoted = true;
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "CANARY-NO-PAT",
        detail: "אין סמכות (PAT) — הקנרית של שער-הדקות לא נשלחת. הצי המקומי הוא המכונה, הענן גיבוי",
      };
      state.history = [...state.history, state.lastDecision].slice(-40);
      saveState();
    }
    return;
  }
  canaryNoPatNoted = false; // הסמכות חזרה — הדגל מתאפס
  const now = Date.now();
  if (now < Date.parse(state.canary.nextDueAt)) return;
  if (state.canary.dispatchesToday >= 4) return; // תקציב יומי כנה

  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "hunter-daemon",
  };
  const dispatchedAt = new Date().toISOString();
  let dispatchOk = false;
  let dispatchError: string | null = null;
  // dispatch
  try {
    // R112 — law of the bounded wait: no fetch without a deadline
    const res = await fetch(`${GH}/repos/${CANARY_REPO}/actions/workflows/${CANARY_WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 204 || res.ok) {
      dispatchOk = true;
      state.canary.lastDispatchAt = dispatchedAt;
      state.canary.dispatchesToday += 1;
    } else {
      dispatchError = `HTTP ${res.status}`;
    }
  } catch (e: any) {
    dispatchError = String(e?.message ?? e).slice(0, 120);
  }
  // כנות: dispatch שנכשל נרשם ככישלון גלוי — לא נבלע ולא נדחה בשקט
  if (!dispatchOk) {
    state.lastDecision = {
      at: new Date().toISOString(),
      kind: "CANARY-DISPATCH-FAIL",
      detail: `שליחת הקנרית נכשלה בכנות: ${dispatchError ?? "לא ידוע"} — ניסיון חוזר בעוד 15 דק'`,
    };
    state.history = [...state.history, state.lastDecision].slice(-40);
  }
  // קריאת הריצה האחרונה (גם אם dispatch נכשל — עדיין מודדים את האמת)
  let runFailedAfterDispatch = false;
  let runSucceeded = false;
  state.canary.lastRunReadError = null; // מדידה טרייה — שגיאה ישנה לא שורדת הצלחה
  try {
    const runs = await fetch(`${GH}/repos/${CANARY_REPO}/actions/workflows/${CANARY_WORKFLOW}/runs?per_page=1`, { headers, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (runs.ok) {
      const j = await runs.json();
      const run = j?.workflow_runs?.[0];
      if (run) {
        state.canary.lastRun = {
          id: run.id,
          status: run.status,
          conclusion: run.conclusion,
          createdAt: run.created_at,
          url: run.html_url,
        };
        if (run.conclusion === "success") {
          state.canary.lastSuccessAt = run.created_at;
          runSucceeded = true;
        } else if (
          dispatchOk &&
          run.conclusion === "failure" &&
          Date.parse(run.created_at) >= Date.parse(dispatchedAt) - 60_000
        ) {
          // הריצה שיצרנו כרגע נכשלה מיידית — הרץ מעולם לא התחיל
          runFailedAfterDispatch = true;
        }
      }
    } else {
      // R123 — כנות: HTTP שאינו 2xx נרשם, לא נבלע
      state.canary.lastRunReadError = `HTTP ${runs.status}`;
    }
  } catch (e: any) {
    // R123 — כנות: קריאת אמת-הריצה נכשלה — נרשמת בכנות במצב, לא נבלעת
    state.canary.lastRunReadError = String(e?.message ?? e).slice(0, 100);
  }
  // חוק מוות-התקציב: ספירת-רצף, זיהוי, ובאסה כנה
  if (runSucceeded) {
    state.canary.deadStreak = 0;
    state.canary.gate = "OPEN";
    state.canary.deadSince = null;
  } else if (runFailedAfterDispatch) {
    state.canary.deadStreak += 1;
    if (state.canary.deadStreak >= 3 && state.canary.gate !== "QUOTA-DEAD") {
      state.canary.gate = "QUOTA-DEAD";
      state.canary.deadSince = new Date().toISOString();
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "GATE-QUOTA-DEAD",
        detail: `שער-הדקות של הריפואים הפרטיים נמדח: ${state.canary.deadStreak} dispatch-ים רצופים נכשלו מיידית (הרץ מעולם לא התחיל — חנקת-Actions של הארגון). הצייד עובר לבאסה יומית עד שהמכסה תחזור. המכונה החיה: הצי המקומי + התאומים הציבוריים ב-Domain`,
      };
      state.history = [...state.history, state.lastDecision].slice(-40);
    }
  }
  // המועד הבא: הצלחה — שער פתוח 6ש' / שער מת — גשאוש יומי (באסה כנה, לא ויתור).
  // כישלון שליחה — ניסיון חוזר קצר (15 דק') במקום דילוג-שקט של 6ש'.
  const cadenceMs = !dispatchOk
    ? 15 * 60 * 1000
    : state.canary.gate === "QUOTA-DEAD"
      ? 24 * 60 * 60 * 1000
      : CANARY_EVERY_MS;
  state.canary.nextDueAt = new Date(now + cadenceMs).toISOString();
  state.canary.day = utcDay();
  saveState();
}

// ── ראיית-ענן: grid.json הציבורי כגיבוי כשה-RPC מהסנדבוקס נחסם ───────
// (לא מקור לפעולה — מקור לאמת-נראות בלבד. הפעולה דורשת מדידה ישירה טרייה.)
async function cloudEye(): Promise<string | null> {
  const pat = readPat();
  if (!pat) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch(
      "https://api.github.com/repos/roshpinacare-sys/Console/contents/dex/grid.json",
      { headers: { Authorization: `token ${pat}`, Accept: "application/vnd.github+json", "User-Agent": "hunter-daemon" }, signal: ctl.signal },
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    const d = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
    if (!d?.ok) return null;
    const ageH = Math.max(0, (Date.now() - Date.parse(d.publishedAt)) / 3_600_000);
    return `ראיית-ענן אחרונה: ${d.openOrdersNow} פקודות פתוחות · ${d.verdict} · גיל ${Math.floor(ageH)}ש' (מדידת-Actions, לא-מקור-לפעולה)`;
  } catch {
    return null;
  }
}

// ── סריקת ההזדמנויות ──────────────────────────────────────────────
async function scan(): Promise<void> {
  state.scanning = true;
  saveState();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 25_000);
    const [moneyRes, treasuryRes] = await Promise.all([
      fetch("http://127.0.0.1:3000/api/money", { signal: ctl.signal, cache: "no-store" }).catch(() => null),
      fetch("http://127.0.0.1:3000/api/treasury", { signal: ctl.signal, cache: "no-store" }).catch(() => null),
    ]);
    clearTimeout(t);
    const money = moneyRes?.ok ? await moneyRes.json().catch(() => null) : null;
    const treasury = treasuryRes?.ok ? await treasuryRes.json().catch(() => null) : null;

    // שער שלמות-מדידה (R90): balances.steem === null → ה-RPC נכשל — "לא נמדד", לא "0"
    const moverMeasured = money?.balances?.steem != null;
    const deployed = moverMeasured ? Number(money?.deployedSteem ?? 0) : null;
    const idle = moverMeasured ? Number(money?.idleSteem ?? 0) : null;
    const orders = moverMeasured && Array.isArray(money?.orders) ? money.orders : [];
    // גיל פקודה — נגזר רק מתאריכים נקראים; created חסר/שבור לא מייצר "NaNש'" (R123)
    const agesH = orders
      .map((o: any) => (Date.now() - Date.parse(String(o?.created ?? ""))) / 3_600_000)
      .filter((x: number) => Number.isFinite(x) && x >= 0);
    const ageH = agesH.length ? Math.max(...agesH) : 0;
    const totalUsd = Number(treasury?.usd?.total ?? 0);
    const liquidUsd = Number(treasury?.usd?.liquid ?? 0);
    let moverPart: string;
    if (moverMeasured) {
      moverPart = `מוביל: דלק ${deployed!.toFixed(3)} STEEM בסולם · נזיל ${idle!.toFixed(3)} · גיל פקודה ${Math.floor(ageH)}ש'`;
    } else {
      const eye = await cloudEye();
      moverPart = `מוביל: לא נמדד (כנות — RPC חסום מהסנדבוקס)${eye ? " · " + eye : ""}`;
    }
    const treasuryPart = totalUsd > 0 ? `אוצר: $${totalUsd.toFixed(0)} (${liquidUsd.toFixed(2)} נזיל)` : "אוצר: לא נמדד (כנות)";

    // אמת-מדידה ל"דופק: חי": הטענה נכתבת רק מבדיקה חיה של הדופק עצמו
    // (בדיקת 2ש' זמן-מוגבל) — דיבון שלא עונה נרשם כלא-נענה, לא כחי.
    const pulseRes = await fetch("http://127.0.0.1:3033/", {
      signal: AbortSignal.timeout(2_000),
      cache: "no-store",
    }).catch(() => null);
    const pulsePart = pulseRes?.ok ? "דופק: חי" : "דופק: לא-נענה";

    const detail = `${moverPart} · ${treasuryPart} · ${pulsePart} · הבא ${state.canary.nextDueAt}`;
    state.lastDecision = { at: new Date().toISOString(), kind: "SCAN", detail };
    state.history = [...state.history, state.lastDecision].slice(-40);
    state.lastScanAt = new Date().toISOString();
    state.scansToday += 1;
    state.scanDay = utcDay();
  } finally {
    state.scanning = false;
    saveState();
  }
}

let ticking = false;
// r143-c — חותמת-הפעימה האחרונה — מזינה את מתג-איש-המת בסוף-הקובץ
let lastBeatAt = Date.now();
async function tick() {
  if (ticking || state.scanning) return;
  ticking = true;
  try {
    state.beats += 1;
    lastBeatAt = Date.now(); // r143-c — הוכחת-החיים נמדדת כאן
    await canaryTick();
    await scan();
  } catch (e: any) {
    state.lastDecision = { at: new Date().toISOString(), kind: "ERROR", detail: String(e?.message ?? e).slice(0, 160) };
    saveState();
  } finally {
    ticking = false;
  }
}

// ── שרת-בריאות ─────────────────────────────────────────────────────
// R124 — שרת-היחיד חוצה-דורות (חוק weblift): ה-handler הישן ממשיך להגיש
// את המצב החי מציר-העולם.
const G_HUNTER_SRV = globalThis as unknown as { __HUNTER_SERVER__?: unknown };
if (G_HUNTER_SRV.__HUNTER_SERVER__) {
  // שרת חי מדור קודם — ממשיך להגיש.
} else {
  G_HUNTER_SRV.__HUNTER_SERVER__ = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // R123 — הדיבון נצרך מ-localhost בלבד (שומר/API/מפעיל מקומי)
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return Response.json({ ...state, ok: true, alive: true, now: new Date().toISOString() });
    }
    return new Response("not found", { status: 404 });
  },
  });
}

saveState();
console.log(`[hunter] חי על פורט ${PORT} · beats=${state.beats} · קנרית הבאה ${state.canary.nextDueAt}`);
tick();
// R112 — law of the single timer (R109/R111 lesson, applied to hunter)
const G = globalThis as unknown as { __HUNTER_TIMER__?: ReturnType<typeof setInterval> };
if (G.__HUNTER_TIMER__) clearInterval(G.__HUNTER_TIMER__);
G.__HUNTER_TIMER__ = setInterval(tick, SCAN_INTERVAL_SEC * 1000);

// ── r143-c · מתג-איש-מת ─────────────────────────────────────
// זומבי חי שנמדד (keeper, r143): HTTP עונה בזמן שהפעימות קפואות.
// כל 60ש' נמדדת התקדמות-הלולאה; שתיקה מעל 30 דק' (3×קצב-הסריקה של 10 דק')
// ⇒ שורה כנה ביומן-הדיבון ויציאה (exit 1) — fleet-guard יקים תהליך-טרי.
// פעימה איטית אחת לעולם לא הורגת דיבון בריא. הטיימר במשמר-גלובלי
// (חוק הטיימר-היחיד) — טעינה-חמה לא מכפילה שומרים.
const DEAD_MAN_TICK_MS = 60_000;
const DEAD_MAN_STALL_MS = 30 * 60_000;
const DEAD_MAN_LOG = `${HOME}/sovereign/keeper/logs/hunter-daemon.log`;
const G_DM = globalThis as unknown as { __HUNTER_DEADMAN__?: ReturnType<typeof setInterval> };
if (G_DM.__HUNTER_DEADMAN__) clearInterval(G_DM.__HUNTER_DEADMAN__);
G_DM.__HUNTER_DEADMAN__ = setInterval(() => {
  if (Date.now() - lastBeatAt <= DEAD_MAN_STALL_MS) return;
  const msg = "dead-man: beats stalled >30min — exiting for revival";
  try {
    fs.mkdirSync(`${HOME}/sovereign/keeper/logs`, { recursive: true });
    fs.appendFileSync(DEAD_MAN_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log(msg);
  clearInterval(G_DM.__HUNTER_DEADMAN__);
  process.exit(1);
}, DEAD_MAN_TICK_MS);

// R106-seed: gate-state law active — quota-dead measured 16x, daily probe until quota returns
