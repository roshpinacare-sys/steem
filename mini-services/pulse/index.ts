// ─────────────────────────────────────────────────────────────────────
// PULSE — הדופק · שידור יומי לשרשרת (R8x, rebuilt R90)
//
// החוזה: פוסט-אמת אחד לכל יום-UTC (מקסימום 1), מתוך 3 טיוטות מסתובבות
// שנולדות מנתונים חיים ברגע-התיירה. המוח חי ב-/api/publish — הדיבון
// הוא לב-פעימה: מחליט מתי החלון נפתח ומבצע enqueue→broadcast.
//
// חוקי-ברזל:
//   · מקסימום 1 פרסום/יום-UTC · עד 3 ניסיונות/יום (budget אמיתי)
//   · הטיוטה נולדת מנתונים חיים — לא מטקסט מוכן (דוקטרינת המדידה)
//   · כנות: broadcast שנכשל נרשם כניסיון שנשחק, לא כ"נניח שהצליח"
//   · קבלה לקנון אחרי פרסום מוצלח, אחרי שער-סודות
//   · R91 — עוגן-הצ'רטרים: בדיקת סחף כל 5 דק׳; כשנבנה דבר חדש — הוא
//     מעוגן על Steem (דרך /api/charter/anchor) בלי לחכות לאף אחד
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה (כמו במפעל-האימות)
declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/pulse/state.json`;
const PORT = 3033;
const CHECK_INTERVAL_SEC = 30;
const PUBLISH_API = "http://127.0.0.1:3000/api/publish";
const CHARTER_ANCHOR_API = "http://127.0.0.1:3000/api/charter/anchor";

const POLICY = {
  maxPerUtcDay: 1,
  rotation: ["draft-truth-he", "draft-liquidity-he", "draft-truth-en"] as const,
  attemptsBudget: 3,
  truthSource: "api.steemit.com · last_root_post",
  // R91 — עוגן-הצ'רטרים: בדיקת סחף כל 10 פעימות (5 דק׳) · תקציב 4/יום בדיבון
  charterCheckEveryBeats: 10,
  charterAnchorsPerDay: 4,
  incomeAttemptsPerDay: 5, // R127 — מנוע ההכנסה: עד 5 ניסיונות רישום ליום
};

type Decision = { at: string; kind: string; detail: string };

type CharterAnchorState = {
  lastAnchorAt: string | null;
  anchorsToday: number;
  anchorDay: string;
  lastRoot: string | null;
  lastTxid: string | null;
  anchoring: boolean;
  lastDecision: Decision | null; // R91: החלטת הצ'רטר האחרונה — לא נדרסת ע"י ה-WAIT של הפרסום
};

type IncomeDayState = {
  // R127 — מנוע ההכנסה: רישום יומי מדוד לקנון (המשימה: $1,000/יום)
  lastDay: string | null; // היום שנרשם בהצלחה
  attemptsToday: number; // תקציב ניסיונות יומי (הגנה מפני פטישות)
  day: string; // היום שמנוהל כעת (לצורך איפוס יומי של ניסיונות)
  lastResultAt: string | null;
  totalsUsd: { usdToday: number | null; usd7d: number | null; usd30d: number | null } | null;
  lastError: string | null;
};

type PulseState = {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  checkIntervalSec: number;
  policy: typeof POLICY;
  lastPublishUtcDay: string | null;
  nextDueAt: string;
  attemptsToday: number;
  broadcasting: boolean;
  // r137 · D-021-to-voice: חסימת-ערוץ כנה (NO-KEY) לא שורפת ניסיון —
  // רק קורנת-backoff עד הזמן הזה; ההתעוררות מיידית כשהדלת נפתחת.
  laneBlockedUntil: string | null;
  lastDecision: Decision | null;
  canonLast: { at: string; ok: boolean; path: string } | null;
  historyTail: Array<Record<string, unknown>>;
  charter: CharterAnchorState;
  // אמת-שרשרת לחוק היום: זריעת החלון מ-last_root_post של המפקד
  windowSeededFromChain: boolean; // החלון הנוכחי נסגר מהשרשרת, לא מה-state המקומי
  lastSeedAt: string | null;
  seedError: string | null; // כישלון קריאת אמת-השרשרת — נרשם בכנות, לא נבלע
  income: IncomeDayState; // R127 — עבודת ההכנסה היומית
};

function freshCharterState(): CharterAnchorState {
  return { lastAnchorAt: null, anchorsToday: 0, anchorDay: utcDay(), lastRoot: null, lastTxid: null, anchoring: false, lastDecision: null };
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function nextUtcMidnight(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next.toISOString();
}

function readState(): PulseState {
  const base: PulseState = {
    service: "pulse",
    version: "1.2.0",
    bootedAt: new Date().toISOString(),
    beats: 0,
    checkIntervalSec: CHECK_INTERVAL_SEC,
    policy: POLICY,
    lastPublishUtcDay: null,
    nextDueAt: nextUtcMidnight(),
    attemptsToday: 0,
    broadcasting: false,
    laneBlockedUntil: null,
    lastDecision: null,
    canonLast: null,
    historyTail: [],
    charter: freshCharterState(),
    windowSeededFromChain: false,
    lastSeedAt: null,
    seedError: null,
    income: { lastDay: null, attemptsToday: 0, day: utcDay(), lastResultAt: null, totalsUsd: null, lastError: null },
  };
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const sameDay = prev.lastPublishUtcDay === utcDay();
    const pc = prev.charter ?? {};
    const charterSameDay = pc.anchorDay === utcDay();
    return {
      ...base,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      charter: {
        lastAnchorAt: pc.lastAnchorAt ?? null,
        anchorsToday: charterSameDay ? (pc.anchorsToday ?? 0) : 0,
        anchorDay: utcDay(),
        lastRoot: pc.lastRoot ?? null,
        lastTxid: pc.lastTxid ?? null,
        anchoring: false, // הנפשה לעולם לא שורדת אתחול
        lastDecision: pc.lastDecision ?? null,
      },
      lastPublishUtcDay: prev.lastPublishUtcDay ?? null,
      nextDueAt: prev.nextDueAt ?? nextUtcMidnight(),
      attemptsToday: sameDay ? (prev.attemptsToday ?? 0) : 0,
      // r137 · D-021-to-voice: חסימת-ערוץ כנה לא שורפת ניסיון — רק קורנת-backoff
      laneBlockedUntil: (prev as any).laneBlockedUntil ?? null as string | null,
      historyTail: Array.isArray(prev.historyTail) ? prev.historyTail.slice(-20) : [],
      canonLast: prev.canonLast ?? null,
      windowSeededFromChain: prev.windowSeededFromChain ?? false,
      lastSeedAt: prev.lastSeedAt ?? null,
      seedError: prev.seedError ?? null,
      income: (() => {
        const pi = (prev as any).income ?? {};
        const day = utcDay();
        return {
          lastDay: pi.lastDay ?? null,
          attemptsToday: pi.day === day ? (pi.attemptsToday ?? 0) : 0,
          day,
          lastResultAt: pi.lastResultAt ?? null,
          totalsUsd: pi.totalsUsd ?? null,
          lastError: pi.lastError ?? null,
        };
      })(),
    };
  } catch (e: any) {
    // כנות (R123): state קיים אך בלתי-קריא אינו נבלע בשקט — האיתחול נרשם
    // כהחלטה גלויה. קובץ שאינו קיים = עלייה ראשונה כנה. חוק-היום נזרע
    // מהשרשרת בפעימה הראשונה — פרסום כפול אינו אפשרי.
    if (fs.existsSync(STATE_FILE)) {
      return {
        ...base,
        lastDecision: {
          at: new Date().toISOString(),
          kind: "STATE-RESET",
          detail: `קובץ-המצב קיים אך לא נקרא (${String(e?.message ?? e).slice(0, 80)}) — אותחל מצב חדש בכנות; החלון ייזרע מאמת-השרשרת (last_root_post) לפני פתיחה`,
        },
      };
    }
    return base;
  }
}

// R124 — ציר-עולם למצב הדיבון (דפוס weblift/money): דור-חם יורש את אובייקט-
// המצב החי מציר-העולם במקום לקרוא מקובץ שעלול להיות קפוא מדור מוקדם —
// כך חלונות-השידור וההיסטוריה לא נשכתבים בין-דורות (נמדד חי: רשומת
// השידור היומית של 09-25 נעלמה מ-historyTail בדיוק ברילוד).
const G_PULSE = globalThis as unknown as { __PULSE_STATE__?: PulseState };
let state: PulseState = G_PULSE.__PULSE_STATE__ ?? readState();
// R127 — דור-חם שירש מצב חי מקוד קודם (בלי שדה-ההכנסה) מקבל אותו
// מאותחל בכנות, לא קריסה על undefined בפעימה הראשונה.
if (!state.income) {
  state.income = { lastDay: null, attemptsToday: 0, day: utcDay(), lastResultAt: null, totalsUsd: null, lastError: null };
}
G_PULSE.__PULSE_STATE__ = state;

function saveState() {
  fs.mkdirSync(`${HOME}/sovereign/pulse`, { recursive: true });
  // R107b — חוק הכתיבה-האטומית (כמו בשומר): .tmp ואז rename — רגע-מוות
  // באמצע כתיבה לא ישאיר ליורש קובץ-מצב חצוי.
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

// ── שער-סודות לקנון ────────────────────────────────────────────────
function secretsGate(text: string): { ok: boolean; reason?: string } {
  if (/[5JKLMNPQRSTUVWXYZ123456789]{50,52}/.test(text)) return { ok: false, reason: "base58-wif-shape" };
  if (/gh[pousr]_[A-Za-z0-9]{20,}/.test(text)) return { ok: false, reason: "github-token-shape" };
  if (/(pat|token|wif|password)\s*[:=]\s*\S{16,}/i.test(text)) return { ok: false, reason: "secret-assignment-shape" };
  return { ok: true };
}

function readPat(): string | null {
  try {
    const t = fs.readFileSync(`${HOME}/upload/pat.env`, "utf8").trim();
    return t.length > 20 ? t : null;
  } catch {
    return null;
  }
}

async function canonPush(path: string, content: string): Promise<boolean> {
  const gate = secretsGate(content);
  if (!gate.ok) {
    state.canonLast = { at: new Date().toISOString(), ok: false, path: `${path} (BLOCKED: ${gate.reason})` };
    return false;
  }
  const pat = readPat();
  if (!pat) {
    // כנות: כישלון נרשם — לא משאירים canonLast ישן {ok:true} מהצלחה קודמת
    state.canonLast = { at: new Date().toISOString(), ok: false, path: `${path} (NO-PAT)` };
    return false;
  }
  const url = `https://api.github.com/repos/roshpinacare-sys/Defi/contents/${path}`;
  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "pulse-daemon",
  };
  try {
    let sha: string | undefined;
    // R112 — law of the bounded wait: no fetch without a deadline (born from
    // the live money-mover freeze: an un-timeouted canonPush hung the whole
    // tick and the daemon died silently at beats=813 while HTTP kept answering)
    const cur = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (cur.ok) sha = (await cur.json()).sha;
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `pulse: daily truth-report receipt ${new Date().toISOString()}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    state.canonLast = { at: new Date().toISOString(), ok: res.ok, path };
    return res.ok;
  } catch {
    state.canonLast = { at: new Date().toISOString(), ok: false, path };
    return false;
  }
}

// ── אמת-שרשרת לחוק היום ───────────────────────────────────────────
// הבאג (נמדד בביקורת): "מקסימום 1 פרסום/יום-UTC" נשען על state מקומי
// בלבד — איתחול סנדבוקס שמשחזר state.json ישן פתח את החלון מחדש והשרשרת
// ראתה 3 פוסטים ב-2026-09-24 מול "מקסימום 1" מוצהר. ה-truthSource
// (api.steemit.com · last_root_post) הוצהר אך לא נקרא. מעתה הדופק קורא
// אותו (דרך /api/publish) בעלייה ופעם ביום-UTC: אם השרשרת מכירה פרסום
// חדש מה-state — החלון נסגר מהאמת. כישלון הקריאה אינו חוסם את הדיבון
// (fail-safe) — אך הוא נרשם ב-seedError, לא נבלע.
async function seedWindowFromChain(): Promise<void> {
  const day = utcDay();
  state.windowSeededFromChain = false; // מדידה טרייה ליום זה
  try {
    const res = await fetch(PUBLISH_API, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
    const j: any = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? `status ${res.status}`).slice(0, 120));
    state.seedError = null;
    const lrp = j?.earnings?.lastRootPost;
    // last_root_post של Steem מגיע בלי אזור-זמן — מנרמל ל-UTC לפני גזירת היום
    const ts = typeof lrp === "string" ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(lrp) ? lrp : `${lrp}Z`) : NaN;
    if (!Number.isFinite(ts)) return; // אין מדידה — לא מזייפים כיסוי
    const chainDay = new Date(ts).toISOString().slice(0, 10);
    const stateDay = state.lastPublishUtcDay ?? "";
    if (chainDay > stateDay) {
      // השרשרת מכירה פרסום שה-state המקומי לא זוכר — החלון נסגר מהאמת
      state.lastPublishUtcDay = chainDay;
      state.windowSeededFromChain = true;
      state.lastSeedAt = new Date().toISOString();
      if (chainDay === day) state.nextDueAt = nextUtcMidnight();
      state.lastDecision = {
        at: state.lastSeedAt,
        kind: "WINDOW-SEEDED-FROM-CHAIN",
        detail: `איתחול החזיר state ישן — השרשרת אומרת אחרת: פרסום-שורש אחרון של המפקד ${chainDay} (last_root_post). החלון נשאר סגור — כנות, לא פרסום כפול`,
      };
      saveState();
    }
  } catch (e: any) {
    // fail-safe: לא חוסמים את הדיבון על כישלון קריאה — אבל הוא נרשם בכנות
    state.seedError = String(e?.message ?? e).slice(0, 140);
    saveState();
  }
}

let seedDayChecked = ""; // בעלייה (ובכל יום-UTC) — בדיקת אמת אחת לפני פתיחת חלון

// ── הפרסום: enqueue טיוטה חיה → broadcast לשרשרת ───────────────────
async function tryPublish(): Promise<void> {
  const day = utcDay();
  state.broadcasting = true;
  saveState();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120_000);
  try {
    // 1) רענון המפעל — הטיוטות נולדות מנתונים חיים עכשיו
    const refresh = await fetch(PUBLISH_API, { signal: ctl.signal, cache: "no-store" });
    if (!refresh.ok) throw new Error(`refresh ${refresh.status}`);
    const st = await refresh.json();
    const drafts: Array<{ id: string; kind: string; lang: string; title: string; body?: string }> = st?.foundry?.drafts ?? [];
    if (!drafts.length) throw new Error("מפעל הטיוטות ריק — כנות, לא משדרים ריק");

    // 2) בחירת הטיוטה לפי סדר-הרוטציה (יום מודולו 3)
    const wanted = POLICY.rotation[Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000) % POLICY.rotation.length];
    const draft = drafts.find((d) => d.id === wanted) ?? drafts[0];

    // 3) enqueue
    const enq = await fetch(PUBLISH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enqueue", draftId: draft.id }),
      signal: ctl.signal,
    });
    const enqJ: any = await enq.json();
    if (!enq.ok || !enqJ?.ok) throw new Error(String(enqJ?.error ?? `enqueue ${enq.status}`));
    const taskId = enqJ.task?.id as string;

    // 4) broadcast → השרשרת
    const bc = await fetch(PUBLISH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "broadcast", id: taskId }),
      signal: ctl.signal,
    });
    const bcJ: any = await bc.json();
    if (!bc.ok || !bcJ?.ok) {
      // r137 · קוד-החסימה נושא עם-השגיאה — כדי ש-LANE-BLOCKED לא ייחשב
      // ניסיון-פרסום שנשחק (D-021-to-voice).
      const err = new Error(String(bcJ?.error ?? `broadcast ${bc.status}`)) as Error & { code?: string };
      err.code = typeof bcJ?.code === "string" ? bcJ.code : undefined;
      throw err;
    }

    // 5) הצלחה — רישום וקבלה
    const entry = {
      at: new Date().toISOString(),
      utcDay: day,
      draftId: draft.id,
      kind: draft.kind?.toUpperCase() ?? "TRUTH-REPORT",
      title: draft.title,
      permlink: bcJ.receipt?.permlink ?? null,
      txid: bcJ.receipt?.txid ?? null,
      url: bcJ.receipt?.url ?? null,
      attempt: state.attemptsToday + 1,
    };
    state.lastPublishUtcDay = day;
    state.windowSeededFromChain = false; // החלון נסגר עכשיו מהפרסום הנמדד שלנו, לא מזריעה
    state.attemptsToday = 0; // הצלחה מאפסת את מונה הניסיונות של היום
    state.nextDueAt = nextUtcMidnight();
    state.historyTail = [...state.historyTail, entry].slice(-20);
    state.lastDecision = { at: entry.at, kind: "TRUTH-REPORT", detail: `שודר: ${entry.title} → ${entry.url ?? entry.permlink}` };
    saveState();
    const receipt = [
      `# קבלת דופק · ${entry.at}`,
      "",
      `- **טיוטה**: ${entry.draftId} (${entry.kind})`,
      `- **כותרת**: ${entry.title}`,
      `- **שרשרת**: txid \`${entry.txid}\``,
      `- **קישור**: ${entry.url}`,
      "",
      `_מופק אוטונומית על-ידי pulse v${state.version} (R90 rebuild)._`,
    ].join("\n");
    await canonPush(`reports/pulse-${day}.md`, receipt);
  } catch (e: any) {
    // r137 · D-021-to-voice: חסימה-מובטחת אינה ניסיון — NO-KEY/NO-SIGNING
    // לא שורף תקציב-דיבור (השיעור של r133 בכסף, כעת גם בקול). הערוץ קורן
    // backoff 30 דק׳ ומנסה שוב — ההתעוררות מיידית אחרי הדלת.
    const code = typeof e?.code === "string" ? e.code : "";
    if (code === "NO-KEY" || code === "NO-SIGNING" || code === "NO-OWNER-KEY") {
      const until = new Date(Date.now() + 30 * 60_000).toISOString();
      state.laneBlockedUntil = until;
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "LANE-BLOCKED",
        detail: `ערוץ-הקול חסום בכנות (${code}) — אין מקור-מפתח לחתימה. אפס ניסיון-שרוף (${state.attemptsToday}/${POLICY.attemptsBudget} נשמרים) · בדיקה-חוזרת ${until.slice(11, 16)}Z · דלת-ההפעלה פותחת מיד`,
      };
      saveState();
      return;
    }
    state.attemptsToday += 1;
    state.lastDecision = {
      at: new Date().toISOString(),
      kind: "PUBLISH-FAIL",
      detail: `ניסיון ${state.attemptsToday}/${POLICY.attemptsBudget} נכשל בכנות: ${String(e?.message ?? e).slice(0, 140)}`,
    };
    saveState();
  } finally {
    clearTimeout(timer);
    state.broadcasting = false;
    saveState();
  }
}

// ── R91: עוגן-הצ'רטרים — רק כשיש סחף אמיתי ─────────────────────────
async function tryCharterAnchor(): Promise<void> {
  state.charter.anchoring = true;
  saveState();
  const ctl = new AbortController();
  // R92 (שיעור משידור חי): זרימת העיגון של השרת — שידור + אימות מההיסטוריה
  // המדופדפת — אורכת עד ~6 דקות; 180ש׳ גזרו "כשל" על עיגון שהצליח.
  const timer = setTimeout(() => ctl.abort(), 600_000);
  const setCharterDecision = (kind: string, detail: string) => {
    state.charter.lastDecision = { at: new Date().toISOString(), kind, detail };
  };
  try {
    // 1) מצב-אמת חי מהשרת — הסחף נמדד שם, לא כאן
    const st = await fetch(CHARTER_ANCHOR_API, { signal: ctl.signal, cache: "no-store" });
    const stJ: any = await st.json();
    if (!st.ok || !stJ?.ok) throw new Error(String(stJ?.error ?? `status ${st.status}`).slice(0, 120));
    const drift = stJ?.anchor?.drift ?? {};
    const newCount = Number(drift.newProjects ?? 0) + Number(drift.newEvents ?? 0);
    if (newCount === 0) {
      setCharterDecision("CHARTER-COVERED", `המרשם מכוסה — אין סחף מאז העיגון האחרון (שורש …${String(stJ?.anchor?.root ?? "?").slice(-8)})`);
      saveState();
      return;
    }

    // 2) תקציב הדיבון (השרת מאכף 8/יום; הדופק שומר 4/יום — שולי בטחון)
    if (state.charter.anchorsToday >= POLICY.charterAnchorsPerDay) {
      setCharterDecision("CHARTER-WAIT-BUDGET", `תקציב העיגון של הדופק מוצה (${state.charter.anchorsToday}/${POLICY.charterAnchorsPerDay}) — הסחף (${newCount}) יכוסה מחר או ידנית`);
      saveState();
      return;
    }

    // 3) העיגון עצמו — השרת שופט (דה-דופ · צינון · posting · היסטוריה)
    const res = await fetch(CHARTER_ANCHOR_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "anchor" }),
      signal: ctl.signal,
    });
    const j: any = await res.json();
    if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? `anchor ${res.status}`).slice(0, 140));

    const r = j.result ?? {};
    state.charter.lastAnchorAt = new Date().toISOString();
    state.charter.lastRoot = r.root ?? null;
    state.charter.lastTxid = r.txid ?? null;
    if (r.status === "ATTESTED") {
      state.charter.anchorsToday += 1;
      setCharterDecision("CHARTER-ANCHORED", `עוגן חוץ: …${String(r.root ?? "?").slice(-8)} על ${r.projects} פרויקטים · txid ${r.txid} · att ${r.attSeq}`);
    } else {
      setCharterDecision("CHARTER-" + String(r.status ?? "SKIPPED"), String(r.reason ?? "דילוג כנה").slice(0, 140));
    }
    saveState();
  } catch (e: any) {
    // R92: timeout אינו כישלון — השידור יצא; השרת ממשיך לאמת מההיסטוריה
    // והבדיקה הבאה תראה את האמת (שורש מעוגן ⇒ COVERED). לקח R87 בשכבת הדיבון.
    if (e?.name === "AbortError") {
      setCharterDecision(
        "CHARTER-ANCHOR-WAIT",
        "העיגון יצא לדרך אך האישור מההיסטוריה חרג מהחלון — הבדיקה הבאה (5 דק׳) תגלה אם השורש מעוגן",
      );
    } else {
      setCharterDecision("CHARTER-ANCHOR-FAIL", `עיגון הצ'רטרים נכשל בכנות: ${String(e?.message ?? e).slice(0, 120)}`);
    }
    saveState();
  } finally {
    clearTimeout(timer);
    state.charter.anchoring = false;
    saveState();
  }
}

let ticking = false;
// ── עבודת ההכנסה היומית (R127): מדידה חיה + רישום לקנון ──
// r143-c — חותמת-הפעימה האחרונה של הלולאה — מזינה את מתג-איש-המת בסוף-הקובץ
let lastBeatAt = Date.now();
// ליבת המשימה של הרשת: לייצר $1,000 ליום שניתנים להמרה. המדידה
// היומית הזאת היא הזיכרון של המשימה — בלעדיה הצי מודד בריאות ולא
// תוצאה (לקח המפעיל: "כל הבדיקות האלה פעם בדקה לא מועילות לכלום").
// תקציב ניסיונות יומי מגן מפטישות; כישלון נרשם בכנות ב-lastError.
async function tryIncomeRecord(day: string): Promise<void> {
  // איפוס יומי של התקציב בהחלפת היום (חוק גלגול-היום של r125-c)
  if (state.income.day !== day) {
    state.income = { ...state.income, day, attemptsToday: 0 };
  }
  if (state.income.lastDay === day) return; // נרשם כבר היום
  if (state.income.attemptsToday >= POLICY.incomeAttemptsPerDay) return;
  state.income.attemptsToday += 1;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 150_000);
  try {
    const res = await fetch("http://127.0.0.1:3000/api/income", {
      method: "POST",
      signal: ctl.signal,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.ok) {
      state.income.lastDay = day;
      state.income.lastResultAt = new Date().toISOString();
      state.income.totalsUsd = j.totals ?? null;
      state.income.lastError = null;
    } else {
      state.income.lastError = String(j?.error ?? `http ${res.status}`).slice(0, 140);
    }
  } catch (e: any) {
    state.income.lastError = String(e?.message ?? e).slice(0, 140);
  } finally {
    clearTimeout(t);
  }
}

async function tick() {
  if (ticking || state.broadcasting || state.charter.anchoring) return; // לולאה-יחידה
  ticking = true;
  try {
    state.beats += 1;
    lastBeatAt = Date.now(); // r143-c — הוכחת-החיים נמדדת כאן
    const day = utcDay();

    // R91: בדיקת סחף-צ'רטרים כל 10 פעימות (5 דק׳) — לפני לוגיקת הפרסום.
    // ההחלטה נשמרת ב-charter.lastDecision — לא נדרסת ע"י ה-WAIT שלהלן.
    if (state.beats % POLICY.charterCheckEveryBeats === 0) {
      await tryCharterAnchor();
    }

    // אמת-שרשרת לחוק היום — בעלייה ופעם ביום, לפני בדיקת החלון:
    // state מקומי שהוחזר מהגיט/סנדבוקס לא יכול לפתוח חלון שהשרשרת סגרה.
    if (seedDayChecked !== day) {
      seedDayChecked = day;
      await seedWindowFromChain();
    }

    const windowOpen = state.lastPublishUtcDay !== day;
    const laneBlocked = state.laneBlockedUntil != null && new Date(state.laneBlockedUntil).getTime() > Date.now();
    if (windowOpen && state.attemptsToday < POLICY.attemptsBudget && !laneBlocked) {
      await tryPublish();
    } else if (windowOpen && laneBlocked) {
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "LANE-BLOCKED",
        detail: `ערוץ-הקול חסום בכנות — חוזרים לבדוק ${String(state.laneBlockedUntil).slice(11, 16)}Z · תקציב נשמר (${state.attemptsToday}/${POLICY.attemptsBudget})`,
      };
    } else if (windowOpen) {
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "WAIT-BUDGET",
        detail: `3/3 ניסיונות נשחקו היום — החלון ייפתח מחר (כנות, לא מתיירים)`,
      };
    } else {
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "WAIT",
        detail: `ממתין לחלון הבא (${state.nextDueAt.slice(0, 10)}) · ניסיונות היום ${state.attemptsToday}/${POLICY.attemptsBudget} · עיגוני צ'רטר ${state.charter.anchorsToday}/${POLICY.charterAnchorsPerDay}${state.windowSeededFromChain ? " · החלון נסגר מאמת-השרשרת (last_root_post)" : ""}${state.seedError ? ` · בדיקת-שרשרת נכשלה: ${state.seedError.slice(0, 60)}` : ""}`,
      };
    }

    // R127 — מנוע ההכנסה: פעם ביום-UTC, אחרי החלון — מודד ורושם לקנון.
    // זו עבודת המשימה של הרשת ($1,000/יום), לא עוד בדיקת בריאות.
    await tryIncomeRecord(day);

    saveState();
  } catch (e: any) {
    state.lastDecision = { at: new Date().toISOString(), kind: "ERROR", detail: String(e?.message ?? e).slice(0, 160) };
    saveState();
  } finally {
    ticking = false;
  }
}

// ── שרת-בריאות ─────────────────────────────────────────────────────
// R124 — שרת-היחיד חוצה-דורות (חוק weblift/money): שרת אחד לכל חיי התהליך;
// ה-handler הישן ממשיך להגיש את המצב החי מציר-העולם (אותו אובייקט).
const G_PULSE_SRV = globalThis as unknown as { __PULSE_SERVER__?: unknown };
if (G_PULSE_SRV.__PULSE_SERVER__) {
  // שרת חי מדור קודם — ממשיך להגיש.
} else {
  G_PULSE_SRV.__PULSE_SERVER__ = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // R123 — הדיבון נצרך מ-localhost בלבד (API/שומר/מפעיל מקומי)
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
console.log(`[pulse] חי על פורט ${PORT} · beats=${state.beats} · פורסם לאחרונה: ${state.lastPublishUtcDay ?? "מעולם"}`);
tick();
// R112 — law of the single timer (R109/R111 lesson, applied to pulse):
// bun --hot re-evaluates the module but does NOT clear the old interval —
// every live edit would multiply the tick. The guard captures the previous
// timer and clears it.
const G = globalThis as unknown as { __PULSE_TIMER__?: ReturnType<typeof setInterval> };
if (G.__PULSE_TIMER__) clearInterval(G.__PULSE_TIMER__);
G.__PULSE_TIMER__ = setInterval(tick, CHECK_INTERVAL_SEC * 1000);

// ── r143-c · מתג-איש-מת ─────────────────────────────────────
// זומבי חי שנמדד (keeper, r143): HTTP עונה בזמן שהפעימות קפואות —
// fleet-guard רואה פורט-חי ולא מקים. החוק: כל 60ש' נמדדת התקדמות-הלולאה;
// שתיקה מעל 15 דק' ⇒ שורה כנה ביומן-הדיבון ויציאה (exit 1) — fleet-guard
// יקים תהליך-טרי. הסף 15 דק' ולא 10: עיגון-הצ'רטרים מותר להתארך עד 10 דק'
// (R92 — חלון-האישור מההיסטוריה) ובזמנו הפעימות נעצרות בכנות (עוגן
// יחיד) — פעימה איטית אחת לעולם לא הורגת דיבון בריא. הטיימר חי
// במשמר-גלובלי (חוק הטיימר-היחיד) — טעינה-חמה לא מכפילה שומרים.
const DEAD_MAN_TICK_MS = 60_000;
const DEAD_MAN_STALL_MS = 15 * 60_000;
const DEAD_MAN_LOG = `${HOME}/sovereign/keeper/logs/pulse-daemon.log`;
const G_DM = globalThis as unknown as { __PULSE_DEADMAN__?: ReturnType<typeof setInterval> };
if (G_DM.__PULSE_DEADMAN__) clearInterval(G_DM.__PULSE_DEADMAN__);
G_DM.__PULSE_DEADMAN__ = setInterval(() => {
  if (Date.now() - lastBeatAt <= DEAD_MAN_STALL_MS) return;
  const msg = "dead-man: beats stalled >15min — exiting for revival";
  try {
    fs.mkdirSync(`${HOME}/sovereign/keeper/logs`, { recursive: true });
    fs.appendFileSync(DEAD_MAN_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log(msg);
  clearInterval(G_DM.__PULSE_DEADMAN__);
  process.exit(1);
}, DEAD_MAN_TICK_MS);
