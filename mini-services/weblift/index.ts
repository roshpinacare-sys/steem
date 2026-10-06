// ─────────────────────────────────────────────────────────────────────
// WEBLIFT — מעלה התוכן (R120).
//
// הרקע (חוק הסנדבוקס-הנופל, שכבה 5): רשת-האחסון הריבונית אבדה מהדיסק
// בנפילת סשן; שוחזרה מהיסטוריית הגיט — אבל הבטחת "התוכן על השרשרת"
// לא התקיימה מעולם (0 צ׳אנקים). שורש הכשל נתפס ותוקן (R120: באג
// עטיפת-הצ׳אנק באומדן ה-RC שמנע פרסום גם במנה מלאה), והצ׳אנק הראשון
// עלה בפועל. ההגירה נמשכת בקצב ה-RC האמיתי (כ-470M/יום).
//
// הדיבון הזה הוא לב-הפעימה של ההמשכיות: כל 45 דקות הוא מזניק את
// הראנר (כספת → שופט-שרשרת → סוכן web-publish). הסוכן עצמו
// idempotent ו-RC-gated — כשאין מנה הוא מדלג בכנות. כשהדואר ריק
// והכול שלם — הדיבון נח בשקט. אפס סודות כאן: ה-WIF חי בזיכרון
// תהליך-הבן של הראנר בלבד.
//
// חוקי-ברזל:
//   · הרצה אחת בכל פעם — אין מקביליות (הסוכן כבר נאמן, אבל סדר הוא סדר)
//   · תוצאה נרשמת בכנות — גם דילוג-RC הוא תוצאה לגיטימית, לא שגיאה
//   · פסק-זמן קשיח 6 דקות — תהליך-בן תקוע נהרג ומתועד
// ─────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import * as fs from "node:fs";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה (כמו במפעל-האימות)
declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/weblift/state.json`;
const RUNNER = `${HOME}/scripts/weblift-run.ts`;
const PORT = 3039;

const POLICY = {
  liftIntervalSec: 45 * 60,
  runTimeoutMs: 6 * 60_000,
  historyTailLen: 40,
  truthSource: "scripts/weblift-run.ts → vault → chain-judge → web-publish (Steem)",
};

type Decision = { at: string; kind: string; detail: string };

type LastRun = {
  at: string;
  exitCode: number | null;
  killedByTimeout: boolean;
  summary: string | null;
  tail: string[];
};

type WebliftState = {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  intervalSec: number;
  alive: boolean;
  lifting: boolean;
  lastLiftAt: string | null;
  nextDueAt: string;
  lastRun: LastRun | null;
  lastDecision: Decision | null;
  historyTail: Array<Record<string, unknown>>;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function freshState(): WebliftState {
  const now = new Date();
  return {
    service: "weblift",
    version: "1.0.0",
    bootedAt: now.toISOString(),
    beats: 0,
    intervalSec: POLICY.liftIntervalSec,
    alive: true,
    lifting: false,
    lastLiftAt: null,
    nextDueAt: new Date(now.getTime() + 60_000).toISOString(),
    lastRun: null,
    lastDecision: null,
    historyTail: [],
  };
}

function loadState(): WebliftState {
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as WebliftState;
    if (prev && prev.service === "weblift") {
      // R123 — המשכיות קצב על פני טעינה-חמה: בלי שימור nextDueAt, כל רילוד
      // מקצר את המחזור ל-60ש' ההמראה הקבועה של freshState — והחוק "הרמה
      // אחת בכל פעם" נשבר כשהמודול הישן עוד מרים ברקע. כעת: המועד
      // שורד; ואם הקודם היה באמצע הרמה (lifting שרד לדיסק) — מדלגים
      // מחזור בכנות כדי ששני ראנרים לעולם לא ירוצו במקביל.
      const prevDue = typeof prev.nextDueAt === "string" ? Date.parse(prev.nextDueAt) : NaN;
      const wasLifting = prev.lifting === true;
      const next: WebliftState = {
        ...freshState(),
        bootedAt: prev.bootedAt,
        beats: prev.beats ?? 0,
        lastLiftAt: prev.lastLiftAt ?? null,
        lastRun: prev.lastRun ?? null,
        lastDecision: prev.lastDecision ?? null,
        historyTail: Array.isArray(prev.historyTail) ? prev.historyTail : [],
        nextDueAt: Number.isFinite(prevDue)
          ? new Date(Math.max(prevDue, Date.now() + 60_000)).toISOString()
          : new Date(Date.now() + 60_000).toISOString(),
      };
      if (wasLifting) {
        next.lastDecision = {
          at: new Date().toISOString(),
          kind: "LIFT-ORPHANED",
          detail: "טעינה-חמה באמצע הרמה — ההרמה שהתחילה קודם עשויה להיות עדיין בדרך; מדלגים מחזור אחד בכנות כדי לשמור על חוק ההרמה-היחידה (הראנר עצמו אידמפוטנטי ו-RC-gated)",
        };
        next.nextDueAt = new Date(Date.now() + POLICY.liftIntervalSec * 1000).toISOString();
      }
      return next;
    }
  } catch (e) {
    // כנות: state קיים אך בלתי-קריא — לא נבלע בשקט; נרשם כהחלטה גלויה
    if (fs.existsSync(STATE_FILE)) {
      const fresh = freshState();
      fresh.lastDecision = {
        at: new Date().toISOString(),
        kind: "STATE-RESET",
        detail: `קובץ-המצב קיים אך לא נקרא (${String((e as Error)?.message ?? e).slice(0, 80)}) — אותחל מצב חדש בכנות`,
      };
      return fresh;
    }
    /* קובץ חסר — עלייה ראשונה כנה */
  }
  return freshState();
}

let state: WebliftState = loadState();

function saveState(): void {
  try {
    fs.mkdirSync(`${HOME}/sovereign/weblift`, { recursive: true });
    // R107b — כתיבה-אטומית: .tmp ואז rename (כמו בשומר ובמפעל האימות).
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    // אי-כתיבה אינה קטלנית לפעימה — אבל היא חייבת להיות נראית ביומן
    // הדיבון (כנות: כשל-דיסק נרשם, לא נבלע בשקט).
    console.error(`[weblift] saveState נכשל — מצב לא נשמר לדיסק: ${String((e as Error)?.message ?? e)}`);
  }
}

function decide(kind: string, detail: string): void {
  state.lastDecision = { at: new Date().toISOString(), kind, detail };
}

/** מפיק שורת-סיכום מפלט הסוכן — השורה החיה של מצב השרשרת */
function summarize(lines: string[]): string | null {
  // צבירה-כנה: כל חבילה מדפיסה שורת-התקדמות משלה — הסיכום מחבר את
  // כולן (מספר חבילות · תווים שהועלו/סך-הכל), לא מציג רק את האחרונה.
  const progress = lines
    .map((ln) => /רצף \d+ צ׳אנקים · תווים (\d+)\/(\d+)/.exec(ln))
    .filter((m): m is RegExpExecArray => m !== null);
  if (progress.length) {
    const done = progress.reduce((s, m) => s + Number(m[1]), 0);
    const total = progress.reduce((s, m) => s + Number(m[2]), 0);
    return progress.length === 1
      ? `רצף קונטיגואלי · תווים ${done}/${total} על השרשרת`
      : `${progress.length} חבילות · תווים ${done}/${total} על השרשרת`;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/אפס משימות ממתינות/.test(lines[i])) return "אפס משימות — ההגירה שלמה";
    if (/אין דואר נכנס/.test(lines[i])) return "אין דואר נכנס";
  }
  return null;
}

async function runLift(): Promise<void> {
  if (state.lifting) return;
  state.lifting = true;
  const tail: string[] = [];
  decide("LIFT", "מזניק את הראנר (כספת → שופט → סוכן)");
  saveState();
  try {
    const child = spawn("node", [RUNNER], {
      cwd: HOME,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let killedByTimeout = false;
    const killer = setTimeout(() => {
      killedByTimeout = true;
      child.kill("SIGKILL");
    }, POLICY.runTimeoutMs);
    const onLine = (buf: Buffer) => {
      for (const ln of buf.toString("utf8").split(/\r?\n/)) {
        if (!ln.trim()) continue;
        tail.push(ln.replace(/[A-Za-z0-9]{50,}/g, (h) => h.slice(0, 16) + "…"));
        if (tail.length > 120) tail.shift();
      }
    };
    child.stdout?.on("data", onLine);
    child.stderr?.on("data", onLine);
    const exitCode: number | null = await new Promise((resolve) => {
      child.on("close", (c) => resolve(c));
      child.on("error", () => resolve(1));
    });
    clearTimeout(killer);
    const run: LastRun = {
      at: new Date().toISOString(),
      exitCode,
      killedByTimeout,
      summary: summarize(tail),
      tail: tail.slice(-25),
    };
    state.lastRun = run;
    state.lastLiftAt = run.at;
    state.historyTail.push(run);
    if (state.historyTail.length > POLICY.historyTailLen) state.historyTail.shift();
    decide(
      exitCode === 0 ? "LIFT-DONE" : "LIFT-FAIL",
      run.summary ?? `יציאה ${exitCode}${killedByTimeout ? " (פסק-זמן)" : ""}`
    );
  } catch (e) {
    decide("LIFT-ERROR", String((e as Error).message ?? e).slice(0, 160));
  } finally {
    state.lifting = false;
    state.nextDueAt = new Date(Date.now() + POLICY.liftIntervalSec * 1000).toISOString();
    saveState();
  }
}

// R123 — שרת-היחיד חוצה-דורות (דפוס מפעל-האימות): bun --hot מעריך את
// המודול מחדש בכל עריכה, ו-Bun.serve שנקרא שוב נתקל ב-EADDRINUSE מול
// השרת של הדור הקודם — וההערכה נעצרת לפני שהטיימר חומש (נצפה חי:
// פעימות קפואות מעל שרת-HTTP חי). החוק: שרת אחד לכל החיים של התהליך;
// ה-handler קורא את המצב מציר-עולם שמתעדכן בכל דור — כך ה-HTTP מגיש תמיד
// את המצב החי, גם כשהערכת-המודול התחלפה מתחתיו.
const G_WL = globalThis as unknown as {
  __WEBLIFT_STATE__?: WebliftState;
  __WEBLIFT_SERVER__?: unknown;
  __WEBLIFT_TIMER__?: ReturnType<typeof setInterval>;
  __WEBLIFT_LIFT__?: () => Promise<void>;
};
G_WL.__WEBLIFT_STATE__ = state;
G_WL.__WEBLIFT_LIFT__ = runLift; // הדור החי — ה-handler הישן מפנה אליו תמיד

function serve(): void {
  if (G_WL.__WEBLIFT_SERVER__) return; // שרת חי מדור קודם — ממשיך להגיש
  try {
    G_WL.__WEBLIFT_SERVER__ = Bun.serve({
      port: PORT,
      hostname: "127.0.0.1", // R123 — הדיבון נצרך מ-localhost בלבד (שומר/API/מפעיל מקומי)
      async fetch(req) {
        const st = G_WL.__WEBLIFT_STATE__;
        const url = new URL(req.url);
        if (req.method === "POST" && (url.pathname === "/lift" || url.pathname === "/")) {
          if (st?.lifting) {
            return Response.json({ ok: false, error: "הרמה כבר רצה" }, { status: 409 });
          }
          void G_WL.__WEBLIFT_LIFT__?.();
          return Response.json({ ok: true, detail: "הרמה הוזנקה" });
        }
        return Response.json({ ok: true, ...(st ?? {}), policy: POLICY, day: utcDay() });
      },
    });
  } catch (e) {
    // כישלון הקשיבה אינו הורג את הדור: הטיימר ייחמש, המצב ייכתב לדיסק,
    // והשומר (חוק הזומבי) יראה את האמת דרך השרת הקודם ויחייה במועדו.
    // רק אחרי restart של התהליך ייקשר שרת טרי עם ה-handler החדש.
    console.error(`[weblift] serve נדחה (הפורט בידי הדור הקודם?) — הפעימה ממשיכה: ${String((e as Error)?.message ?? e)}`);
  }
}

// r143-c — חותמת-הפעימה האחרונה — מזינה את מתג-איש-המת בסוף-הקובץ
let lastBeatAt = Date.now();
function beat(): void {
  state.beats++;
  lastBeatAt = Date.now(); // r143-c — הוכחת-החיים נמדדת כאן
  const due = !state.lifting && new Date(state.nextDueAt).getTime() <= Date.now();
  if (due) void runLift();
  saveState();
}

serve();
// R112 — חוק הטיימר-היחיד, שהיה חסר כאן (נצפה בביקורת r123-c): bun --hot
// מעריך את המודול מחדש אך לא מנקה את האינטרוול הישן — כל עריכה-חיה
// הכפילה את הפעימה (beats תפח, saveState נכתב פעמיים, וההרמה נבדקה
// פעמיים בכל מחזור). השומר הגלובלי מנקה את הקודם לפני החדש.
if (G_WL.__WEBLIFT_TIMER__) clearInterval(G_WL.__WEBLIFT_TIMER__);
G_WL.__WEBLIFT_TIMER__ = setInterval(beat, 30_000);
state.bootedAt = state.bootedAt || new Date().toISOString();
saveState();
console.log(`[weblift] חי על ${PORT} · קצב ${POLICY.liftIntervalSec / 60} דקות · הראנר: scripts/weblift-run.ts`);

// ── r143-c · מתג-איש-מת ─────────────────────────────────────
// זומבי חי שנמדד (keeper, r143): HTTP עונה בזמן שהפעימות קפואות.
// כל 60ש' נמדדת התקדמות-הלולאה; שתיקה מעל 10 דק' ⇒ שורה כנה ביומן
// ויציאה (exit 1) — fleet-guard יקים תהליך-טרי. הסף רחב מריצת-ראנר
// חוקית (6 דק' — הפעימה ממשיכה לפעום גם בזמן הרמה), כך שהרמה אחת
// לעולם לא הורגת דיבון בריא. הטיימר במשמר-גלובלי (חוק הטיימר-היחיד)
// — טעינה-חמה לא מכפילה שומרים.
const DEAD_MAN_TICK_MS = 60_000;
const DEAD_MAN_STALL_MS = 10 * 60_000;
const DEAD_MAN_LOG = `${HOME}/sovereign/keeper/logs/weblift-daemon.log`;
const G_DM = globalThis as unknown as { __WEBLIFT_DEADMAN__?: ReturnType<typeof setInterval> };
if (G_DM.__WEBLIFT_DEADMAN__) clearInterval(G_DM.__WEBLIFT_DEADMAN__);
G_DM.__WEBLIFT_DEADMAN__ = setInterval(() => {
  if (Date.now() - lastBeatAt <= DEAD_MAN_STALL_MS) return;
  const msg = "dead-man: beats stalled >10min — exiting for revival";
  try {
    fs.mkdirSync(`${HOME}/sovereign/keeper/logs`, { recursive: true });
    fs.appendFileSync(DEAD_MAN_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log(msg);
  clearInterval(G_DM.__WEBLIFT_DEADMAN__);
  process.exit(1);
}, DEAD_MAN_TICK_MS);
