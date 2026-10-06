// ─────────────────────────────────────────────────────────────────────
// FLEET-GUARD · שומר-הצי בתוך שרת-הרשת (D-016 · הפעלה-עצמית כפולה)
//
// הפער שנסגר כאן: keeper מסייר על הדיבונים ומחייה את השרת, אבל אם
// keeper עצמו מת — אין מי שיקים אותו עד שמפעיל יריץ daemons-revive
// ביד. החוק החדש: השרת עצמו מסייר כל 60ש' ומקים דיבון מת, כולל keeper.
// keeper מחייה את השרת · השרת מחייה את keeper. מוות-שקט אינו אפשרות.
//
// חוקי-ברזל (תואמי keeper, נלמדו בכאב):
//   · צינון 3 דק' בין הקמות לאותו דיבון
//   · חלון-גלילי: 4 הקמות לכל דיבון בכל 6 שעות — ספירלות נאסרו
//   · זמן-חסד 3 דק' לדיבון שהוקם (בוט שעוד לא עלה אינו "מת")
//   · כל הקמה נרשמת ב-ChainRun (chain="fleet", firedBy="fleet-guard")
//   · מצב חי נשמר ל-sovereign/keeper/fleet-guard-state.json
//   · לולאה-יחידה ב-globalThis (לקח R80)
//
// האמת: זהו הגנה-בעומק מאחורי keeper, לא תחליף. keeper נשאר הסמכות
// (סיור 30ש', חוקי-זומבי, קבלות לקנון); fleet-guard נכנס לפעולה רק
// כשמדידת-ה-HTTP שלו מראה מוות — ומתעד כל הכרעה.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { db } from "@/lib/db";

const HOME = "/home/z/my-project";
const LOG_DIR = `${HOME}/sovereign/keeper/logs`;
const STATE_FILE = `${HOME}/sovereign/keeper/fleet-guard-state.json`;
const CYCLE_INTERVAL_MS = 60_000;
const HTTP_TIMEOUT_MS = 2_500;
const COOLDOWN_MS = 3 * 60_000;
const ROLLING_WINDOW_MS = 6 * 3_600_000;
const ROLLING_WINDOW_CAP = 4;
const BOOT_GRACE_MS = 3 * 60_000;

// r143-c — גרסת-השומר: טעינה-חמה של השרת מעריכה את המודול מחדש, אבל הטיימר
// של הדור הקודם ממשיך לרוץ עם הקוד הישן (משמר started ב-globalThis). מעתה:
// דור חם עם גרסה שונה מנקה את הטיימר הישן ומתחמש מחדש — חוק הלולאה-היחידה
// נשמר (טיימר אחד בדיוק, של הדור החי), והקוד החדש באמת נכנס לפעולה.
const GUARD_VERSION = "r190.1"; // r190 — חוק-סמכות-החייאה-היחידה ל-3049: דילוג-מפורש-ב-reviveWithGuards; הגרסה עלתה כדי שדור-חם יתחמש מחדש עם החוק

// חוק-r190 — סמכות-החייאה היחידה ל-3049 היא keeper — דילוג-מפורש.
// מנוע-הגריד (market-maker, :3049) אינו-מוקם-מחדש כאן — לא-במוות-ולא-בזומבי
// (ההתנגשות-שנמדדה ב-r189-c: שלוש-סמכויות-החייאה → zombie-holder-עם-טיימר-מת).
// גם-רישום-עתידי-שלו-ב-DAEMONS/ZOMBIE_WATCH לא-יעקוף-את-החוק — הדילוג
// חי-בנקודת-החנק-האחת (reviveWithGuards) שכל-הקמה-עוברת-דרכה.
// הדיבונים-האחרים-נשארים-באחריות-השומר-הזה-כרגיל — אין-שינוי-התנהגות.
const SOLE_KEEPER_AUTHORITY_NAMES = new Set(["market-maker"]);
const SOLE_KEEPER_AUTHORITY_PORTS = new Set([3049]);

// r143-c — סיור-זומבים (הגנה-בעומק): פורט עונה אך הוכחת-החיים של הדיבון
// עצמו (מונה-הפעימות בקובץ-המצב שהוא כותב) קפואה — זהו זומבי, גם אם ה-HTTP
// חם. נכללים רק דיבונים שקובץ-המצב שלהם הוכחת-טריות אמיתית (מונה נשמר
// לדיסק בכל פעימה/מחזור — נמדד חי). סף-הקפאה לכל דיבון = max(15 דק',
// 3×קצב-כתיבת-הדיסק שלו) כדי שפעימה איטית אחת לעולם לא תהרוג דיבון בריא
// (חוק-הספירלה). הריגה/הקמה דרך אותם חוקי-צינון וחלון-גלילי של כל הקמה.
const ZOMBIE_WATCH: Array<{ name: string; stateFile: string; staleMs: number }> = [
  { name: "pulse", stateFile: `${HOME}/sovereign/pulse/state.json`, staleMs: 900_000 },
  { name: "money", stateFile: `${HOME}/sovereign/money/state.json`, staleMs: 900_000 },
  { name: "hunter", stateFile: `${HOME}/sovereign/hunter/state.json`, staleMs: 1_800_000 },
  { name: "keeper", stateFile: `${HOME}/sovereign/keeper/state.json`, staleMs: 900_000 },
  { name: "student", stateFile: `${HOME}/sovereign/student/state.json`, staleMs: 1_800_000 },
  { name: "weblift", stateFile: `${HOME}/sovereign/weblift/state.json`, staleMs: 900_000 },
  { name: "curation", stateFile: `${HOME}/sovereign/curation/state.json`, staleMs: 2_700_000 },
  { name: "governance", stateFile: `${HOME}/sovereign/governance/daemon-state.json`, staleMs: 1_800_000 },
  // r145-b — מבקר-האוצר: beats כל 5 דק' → סף הקפאה 15 דק' (3×קצב-כתיבה)
  { name: "treasury-audit", stateFile: `${HOME}/sovereign/treasury-audit/state.json`, staleMs: 900_000 },
  // r146-b — סייר-החוץ: סיור כל 6 ש' → סף הקפאה 18 ש' (3×קצב-כתיבה, max(3×period,10min) חוק r143-c)
  { name: "scout-market", stateFile: `${HOME}/sovereign/scout/state.json`, staleMs: 64_800_000 },
  // fleet-verify: state.json נכתב רק בסיום-ריצת-מאמת (נמדד חי: דיסק beats=10
  //   מול חי 288, mtime ישן 5 שעות על דיבון בריא) — אינו הוכחת-טריות.
  // kpi: כתיבת-דיסק רק כל 30 פעימות (~30 דק') — אינו הוכחת-טריות של 15 דק'.
  // שניהם מכוסים במתג-איש-מת פנימי משלהם (r143-c) במקום.
];

const DAEMONS = [
  { name: "pulse", port: 3033, dir: `${HOME}/mini-services/pulse` },
  { name: "money", port: 3034, dir: `${HOME}/mini-services/money` },
  { name: "hunter", port: 3035, dir: `${HOME}/mini-services/hunter` },
  { name: "keeper", port: 3036, dir: `${HOME}/mini-services/keeper` },
  { name: "student", port: 3037, dir: `${HOME}/mini-services/student` },
  { name: "fleet-verify", port: 3038, dir: `${HOME}/mini-services/fleet-verify` },
  { name: "weblift", port: 3039, dir: `${HOME}/mini-services/weblift` },
  { name: "curation", port: 3040, dir: `${HOME}/mini-services/curation` },
  { name: "kpi", port: 3041, dir: `${HOME}/mini-services/kpi` },
  { name: "governance", port: 3042, dir: `${HOME}/mini-services/governance` },
  // r145-b — מבקר-האוצר: הגיוס הראשון של מחלקת-"army" על פורט-בית חדש
  { name: "treasury-audit", port: 3043, dir: `${HOME}/mini-services/treasury-audit` },
  // r146-b — סייר-החוץ: חיפוש-רשת אמיתי (web_search) לשוק/תחרות/פריצה — העיניים שמחוץ לרשת
  { name: "scout-market", port: 3044, dir: `${HOME}/mini-services/scout-market` },
];

interface FleetGuardState {
  service: "fleet-guard";
  bootedAt: string;
  cycles: number;
  lastCycleAt: string | null;
  lastVerdict: string | null;
  revivesLog: Array<{ at: string; name: string; ok: boolean; detail: string }>;
  // r143-c — בסיס-מדידה לזומבים: מונה-הפעימות שנקרא מקובץ-המצב + מתי נראה
  // לראשונה. מונה שאינו מתקדם מעל סף-הדיבון בזמן שהפורט חי = זומבי.
  zombieSnapshots: Record<string, { beats: number; since: string }>;
}

// שומר-מצב גלובלי — חוק הלולאה-היחידה (R80)
interface GuardGlobal {
  __weaveFleetGuard?: {
    timer: ReturnType<typeof setInterval> | null;
    state: FleetGuardState;
    started: boolean;
    version: string;
  };
}

const g = globalThis as typeof globalThis & GuardGlobal;

function utcIso(): string {
  return new Date().toISOString();
}

function readState(): FleetGuardState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as FleetGuardState;
    if (raw && raw.service === "fleet-guard") {
      // קובץ-מצב מהדור שלפני r143-c — ברירת-מחדל לשדה החדש, לא דריסה
      raw.zombieSnapshots = raw.zombieSnapshots ?? {};
      return raw;
    }
  } catch {}
  return {
    service: "fleet-guard",
    bootedAt: utcIso(),
    cycles: 0,
    lastCycleAt: null,
    lastVerdict: null,
    revivesLog: [],
    zombieSnapshots: {},
  };
}

function writeState(s: FleetGuardState): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch {}
}

function appendLog(line: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(`${LOG_DIR}/fleet-guard.log`, `${utcIso()} ${line}\n`);
  } catch {}
}

async function httpOk(port: number): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: ctl.signal, cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// r143-c — קריאת הוכחת-החיים מקובץ-המצב של הדיבון (קריאת-fs מקומית — סיור מהיר).
// קובץ חסר/שבור/בלי מונה-מספרי = אין הוכחה — null (הדילוג שקט, חוק המשימה).
// mtime הוא זמן-הכתיבה האמיתי של המונה — ממנו נמדדת הטריות (כך מצב שכבר
// קפוא זמן-רב לפני הסיור הראשון מתגלה מיד, לא רק 15 דק' אחריו).
function readDaemonBeats(stateFile: string): { beats: number; mtimeMs: number } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, "utf8")) as { beats?: unknown };
    const beats = raw?.beats;
    if (typeof beats !== "number" || !Number.isFinite(beats)) return null;
    return { beats, mtimeMs: fs.statSync(stateFile).mtimeMs };
  } catch {
    return null;
  }
}

function pidsOnPort(port: number): number[] {
  try {
    const out = spawnSync("ss", ["-tlnp", `sport = :${port}`], { encoding: "utf8" });
    return [
      ...new Set([...(out.stdout ?? "").matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]))),
    ].filter((p) => Number.isFinite(p) && p > 0);
  } catch {
    return [];
  }
}

async function clearPort(port: number): Promise<void> {
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 1_200));
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 400));
}

function resolveBun(): string {
  const candidates = ["/usr/local/bin/bun", "/usr/bin/bun", "/home/z/.bun/bin/bun"];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return "bun";
}

function spawnDaemon(d: (typeof DAEMONS)[number]): number | null {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const fd = fs.openSync(`${LOG_DIR}/${d.name}-fleet-guard.log`, "a");
    const child = spawn(resolveBun(), ["--hot", "index.ts"], {
      cwd: d.dir,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

async function recordChainRun(step: string, ok: boolean, detail: string): Promise<void> {
  try {
    await db.chainRun.create({
      data: { chain: "fleet", step, firedBy: "fleet-guard", ok, detail },
    });
  } catch (e) {
    appendLog(`chainRun-write-failed step=${step} err=${e instanceof Error ? e.message : "?"}`);
  }
}

// r143-c — מסלול-הקמה מאוחד (מוות או זומבי): אותם חוקי-ברזל בדיוק — צינון
// 3 דק' בין הקמות לאותו דיבון, חלון-גלילי 4/6ש', חסד-עלייה 3 דק'. זומבי
// נהרג באותו מנגנון (pidsOnPort → clearPort) ומוקם באותו spawnDaemon.
async function reviveWithGuards(d: (typeof DAEMONS)[number]): Promise<void> {
  const st = g.__weaveFleetGuard;
  if (!st) return;
  // חוק-r190 — סמכות-החייאה היחידה ל-3049 היא keeper — דילוג-מפורש:
  // מנוע-הגריד לא-יוקם-מחדש כאן (לא-במוות-ממסלול-ה-DEAD-ולא-בזומבי-מסיור-ה-ZOMBIE_WATCH);
  // ההקמה-שלו-היא-אחריות-ה-keeper-בלבד (mini-services/keeper · חוקי-MM-REVIVE שם).
  if (SOLE_KEEPER_AUTHORITY_NAMES.has(d.name) || SOLE_KEEPER_AUTHORITY_PORTS.has(d.port)) {
    appendLog(`skip ${d.name} (:${d.port}) — סמכות-החייאה היחידה ל-3049 היא keeper — חוק-r190`);
    return;
  }
  const now = Date.now();

  const lastRevive = [...st.state.revivesLog].reverse().find((r) => r.name === d.name);
  if (lastRevive && now - new Date(lastRevive.at).getTime() < COOLDOWN_MS) {
    appendLog(`skip ${d.name} cooldown (${Math.round((now - new Date(lastRevive.at).getTime()) / 1000)}s)`);
    return;
  }
  const window = st.state.revivesLog.filter(
    (r) => r.name === d.name && now - new Date(r.at).getTime() < ROLLING_WINDOW_MS,
  );
  if (window.length >= ROLLING_WINDOW_CAP) {
    appendLog(`skip ${d.name} rolling-window full (${window.length}/${ROLLING_WINDOW_CAP} in 6h)`);
    return;
  }

  // חסד-עלייה: דיבון שהוקם לאחרונה — לא נוגעים בו (גם לא זומבי)
  const graceOk = lastRevive && now - new Date(lastRevive.at).getTime() < BOOT_GRACE_MS;
  if (graceOk) return;

  // פורט תפוס (מת בלי מענה או זומבי עם מענה) → ניקוי לפני הקמה
  const pids = pidsOnPort(d.port);
  if (pids.length > 0) await clearPort(d.port);
  const pid = spawnDaemon(d);
  const ok = pid != null;
  const detail = ok
    ? `fleet-guard הקים את ${d.name} (:${d.port}) pid=${pid}`
    : `fleet-guard נכשל בהקמת ${d.name}`;
  appendLog(ok ? `revive ${d.name} pid=${pid}` : `revive-failed ${d.name}`);
  st.state.revivesLog.push({ at: utcIso(), name: d.name, ok, detail });
  await recordChainRun(`auto-revive:${d.name}`, ok, detail);
}

async function cycle(): Promise<void> {
  const st = g.__weaveFleetGuard;
  if (!st) return;
  st.state.cycles += 1;
  st.state.lastCycleAt = utcIso();

  const now = Date.now();
  const dead: string[] = [];
  const up: Array<(typeof DAEMONS)[number]> = [];
  for (const d of DAEMONS) {
    if (await httpOk(d.port)) up.push(d);
    else dead.push(`${d.name}:${d.port}`);
  }

  // ── r143-c · סיור-זומבים: פורט חי, מצב קפוא ─────────────────────
  // הקפאה חיה שנמדדה (keeper :3036, 20:03Z): HTTP ענה והפעימות קפואות
  // רבע-שעה — המתג-הפנימי של הדיבון לא ירה. כאן ההגנה-בעומק: אם מונה-
  // הפעימות בקובץ-המצב של הדיבון לא זז מעל סף-הקפאה שלו בזמן שהפורט עונה
  // — הריגה והקמה טרייה, באותם חוקי-צינון. אין קובץ-מצב אמין → דילוג שקט.
  for (const w of ZOMBIE_WATCH) {
    const d = up.find((x) => x.name === w.name);
    if (!d) {
      delete st.state.zombieSnapshots[w.name]; // פורט מת — מסלול-המוות מטפל
      continue;
    }
    const proof = readDaemonBeats(w.stateFile);
    if (proof == null) {
      delete st.state.zombieSnapshots[w.name]; // אין הוכחת-טריות — דילוג שקט
      continue;
    }
    const snap = st.state.zombieSnapshots[w.name];
    if (!snap || snap.beats !== proof.beats) {
      // בסיס-מדידה חדש — since הוא זמן-הכתיבה האמיתי של המונה (mtime),
      // לא זמן-הסיור: מצב שכבר קפוא זמן-רב מתגלה בסיור הראשון.
      st.state.zombieSnapshots[w.name] = { beats: proof.beats, since: new Date(proof.mtimeMs).toISOString() };
      continue;
    }
    const staleMs = now - new Date(snap.since).getTime();
    if (staleMs >= w.staleMs) {
      appendLog(`zombie-revive ${w.name} (port up, state stale ${Math.round(staleMs / 60_000)}m)`);
      delete st.state.zombieSnapshots[w.name];
      await reviveWithGuards(d);
    }
  }

  if (dead.length === 0) {
    st.state.lastVerdict = "FLEET-INTACT";
    writeState(st.state);
    return;
  }

  st.state.lastVerdict = `DEAD:${dead.join(",")}`;
  appendLog(`patrol dead=[${dead.join(" ")}]`);

  for (const key of dead) {
    const name = key.split(":")[0];
    const d = DAEMONS.find((x) => x.name === name);
    if (!d) continue;
    await reviveWithGuards(d);
  }

  writeState(st.state);
}

export function startFleetGuard(): void {
  if (g.__weaveFleetGuard?.started) {
    // r143-c — טעינה-חמה: הטיימר של הדור הקודם רץ עם הקוד הישן. דור עם
    // גרסה חדשה מנקה אותו ומתחמש מחדש (לולאה-יחידה — טיימר אחד בדיוק).
    if (g.__weaveFleetGuard.version === GUARD_VERSION) return;
    if (g.__weaveFleetGuard.timer) clearInterval(g.__weaveFleetGuard.timer);
    g.__weaveFleetGuard.started = false;
  }
  const state = readState();
  // שרת חדש = מופע חדש של שומר-השרת; bootedAt מרענן, ההיסטוריה נשמרת
  state.bootedAt = utcIso();
  g.__weaveFleetGuard = { timer: null, state, started: true, version: GUARD_VERSION };
  appendLog(`fleet-guard started (daemon-revival authority in-server)`);
  // הסיור הראשון אחרי 45ש' — נותן לשרת להתייצב, ולא נכנס בין עליות של dev-revive
  setTimeout(() => {
    void cycle();
    g.__weaveFleetGuard!.timer = setInterval(() => void cycle(), CYCLE_INTERVAL_MS);
  }, 45_000);
}
