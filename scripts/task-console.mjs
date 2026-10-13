#!/usr/bin/env bun
/* R253 · task-console — המסוף-הריבוני-למשימות-והחלטות (זיקוק-מ-agentcraft, גל-2+3).
 *
 * חוקי-ברזל:
 *  · done-only-via-verified-push — ה-CLI מחשב-ראיות-אמת מהעץ:
 *      selftest-last-run.json (fail==0 + טריות<24h) + push-custody.json (דחיפה-טרייה-דרך-השער)
 *  · פעולות-מפעיל יוצאות-כהחלטות (decisions) — לא-עוצרות-בשקט
 *  · persist אטומי (temp+rename) לתוך state/ — מסילת-ה-custodian משמרת-אותם-בגיט
 *  · --json = הערוץ-המכונתי-לקונסול-החי
 *
 * RUN:
 *   bun scripts/task-console.mjs tasks|progress|decisions [--json]
 *   bun scripts/task-console.mjs task-add "<title>" [--priority N] [--deps a,b] [--assignee X]
 *   bun scripts/task-console.mjs task-set <id> <status> [--commit SHA] [--reason "..."]
 *   bun scripts/task-console.mjs decision-add <kind> "<question>" "<opt1>" "<opt2>"...
 *   bun scripts/task-console.mjs decision-answer <id> <1|text> [--by name] [--text "..."]
 *   bun scripts/task-console.mjs decision-settle <id> | decision-reopen <id> "<reason>" | decision-cancel <id> "<reason>"
 *   bun scripts/task-console.mjs drill [--seed N] [--json]
 */
import {
  createTask, setStatus, ready, progress, validateGraph, deserialize,
  runDrill, STATUSES,
} from "../mini-services/saos-engine/taskgraph.mjs";
import {
  createDecision, answerDecision, settleDecision, reopenDecision, cancelDecision,
  listOpen, deserializeDQ, validateDQ,
} from "../mini-services/saos-engine/decisionqueue.mjs";
import { readFileSync, renameSync, existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync, statSync, readdirSync, fsyncSync, linkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATE = path.join(ROOT, "mini-services", "saos-engine", "state");
const TASKS_FILE = path.join(STATE, "tasks.json");
const DQ_FILE = path.join(STATE, "decisions.json");
const SELFTEST_FILE = path.join(STATE, "selftest-last-run.json");
const PUSH_FILE = path.join(STATE, "push-custody.json");

const args = process.argv.slice(2);
const cmd = args[0] ?? "";
/* R260 · the argv contract is a CLOSED set — measured live: a typo flag (--priorty) was
 * silently ignored (priority defaulted to 0), option labels starting with "--" were
 * swallowed TOGETHER WITH the next token (decision-add "--keep A" "--drop B" → 0 options,
 * silent), and a reason word starting with "--" ate the word after it. Named refusal ≥
 * silent swallowing. */
const KNOWN_FLAGS = new Set(["--json", "--priority", "--deps", "--assignee", "--id", "--commit", "--reason", "--by", "--text", "--seed", "--help"]);
const VALUE_FLAGS = new Set(["--priority", "--deps", "--assignee", "--id", "--commit", "--reason", "--by", "--text", "--seed"]);
const has = (f) => args.includes(f);
const flagVal = (f) => {
  const i = args.indexOf(f);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v === undefined || v.startsWith("--") ? undefined : v; // never swallow a following flag as a value
};
const FRESH_MS = 24 * 60 * 60 * 1000;

/* R264 · חוק-הכתיבה-השלמה: POSIX write() רשאי לחוקית לחזור-חלקי (RLIMIT_FSIZE,
 * ENOSPC-על-סף, אותות) — כתיבה-חלקית-שקטה מוציאה לפועל rename של קובץ-state קרוע
 * עם rc=0. נמדד-חי: state 18.5KB תחת `ulimit -f 1` → JSON-קרוע-בן-512בייט פורסם
 * ב-rename עם יציאה 0 ו-41 משימות נעלמו בשקט (המשפחה שהחוק אוסר). החוק: לולאה
 * עד שכל-בייט נכתב; כתיבה שנעצרת (0 התקדמות) או נכשלת הופכת סירוב-נקוב —
 * tmp-חלקי לעולם לא נחתך ב-rename (חוק-SQLite/Postgres לכתיבה שלמה). */
function writeAll(fd, buf) {
  let at = 0;
  while (at < buf.length) {
    const n = writeSync(fd, buf, at, buf.length - at);
    if (!(n > 0)) throw new Error(`SHORT-WRITE: ${n}-בייט בהיסט-${at} — מסרב לפרסם קובץ קרוע`);
    at += n;
  }
}
/* R259 · fsync לפני-rename: rename אטומי מול-תהליכים אחרים, אבל מול-אובדן-חשמל
 * ה-content עלול לא להספיק-להישטף — fsync סוגר-את-משפחת-הכשל-הזו (כמו-SQLite). */
function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  let fd;
  try {
    /* R260 · "wx" + 0600 (O_EXCL): נמדד — "w" רגיל עוקב אחרי symlink שהוצב-מראש
     * ב-tmp-<pid> והורס את הקורבן שאליו הוא מצביע (CWE-59, הוכח-חי-עם-wrapper באותו-pid:
     * קובץ-מחוץ-ל-state/ נדרס בתוכן-ה-state). O_EXCL מסרב לכל-כניסה-קיימת — symlink או
     * שארית — ו-0600 שומר-את-חצי-הכתיבה-פרטי. */
    fd = openSync(tmp, "wx", 0o600);
  } catch (e) {
    if (e.code === "EEXIST") throw new Error(`TMP-EXISTS: ${path.basename(tmp)} כבר-קיים (symlink-או-שארית) — נדחה-בשם, לא-נעקף; sweepTmp ינקה שארית מעל-60s`);
    throw e;
  }
  try {
    try { writeAll(fd, Buffer.from(content, "utf8")); fsyncSync(fd); } finally { closeSync(fd); }
    /* R263 · seam-בדיקה-בלבד (אדיש-כברירת-מחדל): חלון-הזרקה דטרמיניסטי לווקטור-החטיפה —
     * עיכוב-מותנה-env לפני בדיקת-הבעלות כך שה-hijacker החיצוני מספיק להחליף את
     * המנעול בתוך-הקטע-הקריטי. ללא-ה-env: אפס-השפעה. */
    const injectDelay = Number(process.env.SAOS_TEST_PERSIST_DELAY_MS ?? 0);
    if (injectDelay > 0) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, injectDelay); } catch { /* בלי-חסימה */ } }
  /* R262c · בדיקת-בעלות-אחרונה (האטימות-המלאה): ה-rename חוצה רק אם שם-המנעול
   * עדיין מצביע על ה-inode של התביעה-שלי. שני-כותבים לא יכולים שניהם לעבור —
   * לשם-יש inode אחד ולכל-כותב claim-inode ייחודי משלו; כל-חלון-מירוץ שנותר
   * הופך מאובדן-עדכונים-שקט לסירוב-נקוב (LOCK-LOST-MIDWRITE) — החוק מוחזק. */
  if (ACTIVE_LOCK && ACTIVE_LOCK.file === file) {
    let ino = null;
    try { ino = statSync(`${file}.lock`).ino; } catch { /* המנעול נעלם — סירוב */ }
    if (ino !== ACTIVE_LOCK.ino) throw new Error(`LOCK-LOST-MIDWRITE: ${path.basename(file)} — המנעול השתנה מתחתינו בזמן-הכתיבה; הכתיבה נדחית-בשם (הרץ שוב), לעולם לא אובדן-שקט`);
  }
    renameSync(tmp, file);
  } catch (e) {
    /* R263 · היגיינת-כשל: כותב-שנדחה (LOCK-LOST-MIDWRITE/שגיאת-כתיבה) לא-משאיר
     * tmp-יתום מאחוריו — הכשל נקוב והסנדבוקס נשאר-נקי (נמדד: סירובים השאירו
     * tasks.json.tmp-<pid> והולידו-flake בווקטור-השאריות). */
    try { unlinkSync(tmp); } catch { /* כבר-פונה */ }
    throw e;
  }
  sweepTmp(file);
  /* R264 · dir-fsync: גם-כניסת-ה-rename עצמה חייבת-לשרוד-אובדן-חשמל (חוק-ה-dir-fsync
   * של-SQLite ב-unixSync). best-effort מטבעו: פלטפורמות-שאינן-מאפשרות-פתיחת-fd-של
   * תיקייה שוקעות-בחן-למצב-R259 — עמידות-ה-durability רק-גדלה, לעולם-לא-מייצרת
   * כשל-חדש: כתיבה-שנחתה-כבר-אינה-הופכת-שגיאה בגלל-dir-fsync. */
  try {
    const dfd = openSync(path.dirname(file), "r");
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
  } catch { /* best-effort — fsync-הקובץ כבר-מחזיק */ }
}
/* R259 · היגיינת-שאריות: SIGKILL בין-כתיבה-ל-rename משאיר `.tmp-<pid>` לנצח.
 * בטוח-מבנית: מנעול-הכותב-מסדר-כותבים-לקובץ, אז-כל-`*.tmp-*` מעל-60s שייך-לתהליך-מת (נמדד, SIGKILL×40). */
function sweepTmp(file) {
  try {
    const dir = path.dirname(file);
    for (const e of readdirSync(dir)) {
      if (!e.startsWith(`${path.basename(file)}.tmp-`)) continue;
      const p = path.join(dir, e);
      try { if (Date.now() - statSync(p).mtimeMs > 60_000) unlinkSync(p); } catch { /* מירוץ — הסריקה-הבאה */ }
    }
  } catch { /* התיקייה-נעלמה — אין-מה-לסרוק */ }
}
function loadJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    // הסגר-בסגנון-המקור: לא crash-loop — קובץ-קורום מועבר-לצד-ומתחיל-נקי
    if (!existsSync(file)) return fallback; // R259: קורא-אחר-כבר-הסגיר-אותו (מירוץ-קוראים — לא-קריסת-ENOENT)
    const quarantine = `${file}.corrupt-${Date.now()}-${process.pid}`; // סיומת-pid: מזהה-עמיד-להתנגשות (לקח-R258)
    try { renameSync(file, quarantine); } catch { return fallback; } // נעלם-באמצע — מתחילים-נקי
    console.error(`[task-console] קובץ-קורום-הועבר-להסגר: ${path.basename(quarantine)}`);
    return fallback;
  }
}

/* פוזיציונליים: מדלגים רק על value-flags מוכרים (+ערכם) — R260: כל-מה-שהגיע-לכאן עבר
 * את-שער-ה-UNKNOWN-FLAG, ולכן מה-שנשאר הוא תוכן או value-flag מוכר. בלי בליעה שקטה. */
function positional(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (VALUE_FLAGS.has(list[i])) { i++; continue; }
    out.push(list[i]);
  }
  return out;
}

/* R258 · מנעול-כותב: rename-אטומי מונע-קורום אבל לא אובדן-עדכונים — נמדד-חי:
 * 20-task-add-מקבילים → 11-שורדים (read-modify-write אינו טרנזקציה בין-תהליכים).
 * R259 · O_EXCL + חיות-בעלים.
 * R262 · **מנעולים-נולדים-שלמים** (התיקון-המדוד של סבב-ההפתעה): ה-R259 יצר-מנעול
 * *ריק* (O_EXCL) וכתב-את-ה-pid *אחרי* הרכישה ("אינפורמטיבי-בלבד") — חלון-µs
 * שהפך-אמיתי בעומס-קר של 20-כותבים: מתחרה-קרא בעלים-ריק, הזדקן-אותו >250ms,
 * **גנב מנעול מכותב-חי**, שני-כותבים-בתוך-הקטע-הקריטי → אובדן-עדכונים-שקט
 * עם rc=0 לכולם (נמדד: 20-כותבים → 16-18-משימות, אפס-יציאות-שגיאה).
 * התיקון: ה-pid נכתב-קודם לקובץ-תביעה-פרטי, ו-`link()` מקדם-אותו לשם-המנעול
 * אטומית — מנעול **לא-יכול-להיווצר בלי ה-pid של הבעלים בתוכו** (גניבת-בעלים-ריק
 * הוסרה; חוק-הגיל-30s נשאר-גיבוי לזבל-זר). השחרור מאמת-בעלות לפני unlink —
 * מנעול-גנוב-תיאורטית אינו-שלנו-למחוק. */
const LOCK_STALE_MS = 30_000, LOCK_WAIT_MS = 2000;
/* R262c · ה-inode של המנעול-הפעיל שלי (CLI חד-חוטי — מנעול אחד בכל-רגע) */
let ACTIVE_LOCK = null;
function lockOwnerPid(lockFile) {
  try {
    const pid = Number(readFileSync(lockFile, "utf8").trim().split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null; // null = זבל-זר (לא-בפורמט-שלנו)
  } catch { return undefined; } // נעלם-בין-הקריאות — נסה-שוב
}
/* R262b · מוטקס-גניבה (נמדד-חי): גניבה=קריאה→probe→rename היא check-then-act —
 * במדידה: 7ms בין-קריאת-הבעלים-המת ל-rename, ובתוכן נכנס-יורש-חי (link מצליח
 * רק-אחרי-שהשם-מתפנה) → ה-rename הרג מנעול-חי → שני-מחזיקים → אובדן-שקט.
 * המוטקס (O_EXCL על שם-קבוע + TTL-גיל) מסדר-גנבים-בטור; בתוכו שם-המנעול עדיין
 * תפוס-על-ידי-inode-המת (אף-יורש לא יכול להיקשר) → החלון קורס לאפס. יתום-מוטקס
 * (SIGKILL בתוך-הגניבה) מנוקה-לפי-גיל ומעכב-רק-גניבות — לעולם לא כותבים-רגילים. */
function stealIfDead(file, lockFile) {
  const stealMtx = `${file}.steal`;
  let mtx = null;
  try { mtx = openSync(stealMtx, "wx", 0o600); } catch (e) {
    if (e.code !== "EEXIST") throw e;
    try { if (Date.now() - statSync(stealMtx).mtimeMs > LOCK_STALE_MS) renameSync(stealMtx, `${stealMtx}.stale-${Date.now()}`); } catch { /* מתחרה-זז */ }
    return; // גנב-אחר-פעיל — נסה-שוב-בסיבוב-הבא
  }
  try {
    const owner = lockOwnerPid(lockFile);
    if (owner === undefined) return; // המנעול נעלם מעצמו
    let ownerIno = null;
    let dead = false;
    if (owner === null) {
      try { ownerIno = statSync(lockFile).ino; dead = Date.now() - statSync(lockFile).mtimeMs > LOCK_STALE_MS; } catch { return; }
    } else {
      try { ownerIno = statSync(lockFile).ino; } catch { return; }
      try { process.kill(owner, 0); } catch (pe) { dead = pe.code === "ESRCH"; }
      if (!dead) { try { dead = Date.now() - statSync(lockFile).mtimeMs > LOCK_STALE_MS; } catch { return; } } // גיבוי לחי-שנתקע
    }
    if (dead) {
      /* R262b · אימות-inode מיד-לפני-ה-rename: ההחלטה התקבלה מקריאה-קודמת —
       * אם השם כבר-מצביע על inode-אחר (יורש-חי נכנס בין-לבין) הגניבה מבוטלת. */
      try {
        const inoNow = statSync(lockFile).ino;
        if (inoNow === ownerIno) renameSync(lockFile, `${lockFile}.stale-${Date.now()}`);
      } catch { /* המנעול נעלם מעצמו — אין-מה-לגנוב */ }
    }
  } finally {
    try { closeSync(mtx); } catch { /* כבר-סגור */ }
    try { unlinkSync(stealMtx); } catch { /* כבר-פונה */ }
  }
}
function withLock(file, fn) {
  mkdirSync(path.dirname(file), { recursive: true }); // סדר-הפעולות-חשוב: התיקייה-לפני-המנעול (למדנו-ב-R258-מהריצה-החוזרת)
  const lockFile = `${file}.lock`;
  const t0 = Date.now();
  for (;;) {
    let claimed = false;
    let ino = null;
    const claimFile = `${lockFile}.claim-${process.pid}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      const cfd = openSync(claimFile, "wx", 0o600); // התביעה-נולדת-שלמה: pid-בתוכה *לפני* ששם-המנעול-קיים
      /* R264 · גם-התביעה נכתבת בחוק-הכתיבה-השלמה — מנעול-שנולד-קרוע הוא-מנעול-שקרי. */
      try { writeAll(cfd, Buffer.from(`${process.pid} ${new Date().toISOString()}\n`, "utf8")); } finally { closeSync(cfd); }
      try {
        linkSync(claimFile, lockFile); claimed = true; // אטומי: EEXIST = מישהו-מחזיק; המנעול-מעולם-לא-נולד-קרוע
        try { ino = statSync(claimFile).ino; } catch { /* לא-יקרה: זה עתה קישרנו; ה-inode-חי-דרך-שם-המנעול */ }
      } finally { try { unlinkSync(claimFile); } catch { /* כבר-פונה */ } }
    } catch (e) {
      try { unlinkSync(claimFile); } catch { /* כבר-פונה */ }
      if (e.code !== "EEXIST") throw e; // שאריות-תביעה-הן-שלנו; EEXIST-ב-link = התנגשות-לגיטימית
    }
    if (claimed) {
      ACTIVE_LOCK = { file, ino }; // claim-inode == lock-inode (hardlink) — נלכד *לפני* מחיקת-ה-claim
      try {
        return fn();
      } finally {
        ACTIVE_LOCK = null;
        try { if (lockOwnerPid(lockFile) === process.pid) unlinkSync(lockFile); } catch { /* כבר-פונה */ } // אימות-בעלות: לעולם לא מוחקים מנעול-של-זר
      }
    }
    if (Date.now() - t0 > LOCK_WAIT_MS) throw new Error(`LOCK-BUSY: ${path.basename(lockFile)} מוחזק-בידי-כותב-אחר`);
    stealIfDead(file, lockFile);
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); } catch { /* בלי-חסימה — המשך */ }
  }
}

/* מזהה-עמיד-להתנגשות: Date.now()-לבדו התנגש-בין-שני-תהליכים-באותו-מילישנייה (נמדד-ב-R258) */
/* R259 · crypto-מזהה: Math.random().toString(36).slice(2,6) יכול-להתקצר-מתחת-4-תווים-בזנב-ההסתברות — randomUUID-חותך-את-הזנב-כולו */
const newId = (p) => `${p}-${Date.now().toString(36).toUpperCase()}${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;

/* R259 · validate-before-persist: deserialize מסרב-לגרף-לא-חוקי-בקריאה, אבל-כלום-לא-מנע
 * **התמדה**-של-מצב-לא-חוקי (נמדד-חי: task-add-עם-dep-רפאים/עם-id-כפול → הרעלה-קבועה — כל-הפקודות
 * REFUSED-עד-ניתוח-ידני). נקודת-חנק-אחת: שום-דבר-לא-נוחת-בדיסק-בלי-לעבור-את-המודול-עצמו. */
function persistValidated(file, doc, validate) {
  const v = validate(doc);
  if (!v.ok) throw new Error(`INVALID-STATE: ${v.errors.join(" · ")} — לא-נשמר (validate-before-persist, R259)`);
  atomicWrite(file, JSON.stringify(doc, null, 2));
}

/* קשירת-commit-לראיית-הדחיפה: ה-commit-חייב-להיות-קיים-ולהיות-ה-push-עצמו-או-אב-קדמון-שלו */
function commitPushBound(commit) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
    const pc = JSON.parse(readFileSync(PUSH_FILE, "utf8"));
    if (!pc.lastPushedSha) return false;
    if (pc.lastPushedSha === commit) return true;
    execFileSync("git", ["merge-base", "--is-ancestor", commit, pc.lastPushedSha], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/* ── ראיות-אמת מהעץ (החלק-היחיד-שנוגע-בקבצים-אמיתיים) ── */
function computeEvidence(commit) {
  const now = Date.now();
  const ev = { selftestGreen: false, selftestFresh: false, pushRecorded: false, pushShas: [] };
  try {
    const st = JSON.parse(readFileSync(SELFTEST_FILE, "utf8"));
    ev.selftestGreen = Number(st.fail) === 0 && Number(st.pass) > 0;
    ev.selftestFresh = Number.isFinite(Date.parse(st.at)) && now - Date.parse(st.at) < FRESH_MS;
    ev.selftestInfo = `${st.pass}/${st.pass + st.fail} @ ${st.at}`;
  } catch { /* honest-fail: נשאר false */ }
  try {
    const pc = JSON.parse(readFileSync(PUSH_FILE, "utf8"));
    if (pc.lastPushedSha && pc.pushedAt) {
      const fresh = now - Date.parse(pc.pushedAt) < FRESH_MS;
      const bound = fresh && commit ? commitPushBound(commit) : false;
      ev.pushRecorded = fresh && Boolean(pc.branch === "saos-cockpit" || pc.method);
      // ראיית-הדחיפה-נספרת-רק-אם-היא-קשורה-ל-commit-של-המשימה-עצמה — דחיפה-של-סוכן-אחר
      // על-תוכן-אחר לא סותרת-עבודה-שמעולם-לא-יצאה-מהעץ (החור-שהבקרה-השלילית-חשפה)
      ev.pushShas = fresh && commit && bound ? [pc.lastPushedSha] : [];
      ev.pushInfo = `${String(pc.lastPushedSha).slice(0, 7)} @ ${pc.pushedAt}${bound ? "" : " (לא-קשור-ל-commit-זה)"}`;
    }
  } catch { /* honest-fail */ }
  return ev;
}

function printHelp() {
  console.log("commands: tasks · task-add · task-set · progress · drill · decisions · decision-add · decision-answer · decision-settle · decision-reopen · decision-cancel (+ --json)");
}

try {
  for (const t of args.slice(1)) {
    if (t.startsWith("--") && !KNOWN_FLAGS.has(t)) {
      throw new Error(`UNKNOWN-FLAG: ${t} — argv-הוא-חוזה-סגור; מפריט-לא-מוכר-אינו-תוכן (חוקיים: ${[...KNOWN_FLAGS].join(" ")})`);
    }
  }
  switch (cmd) {
    case "tasks":
    case "progress": {
      // R259 · דרך-loadJson בלבד: קריאה-גולמית הייתה מתה-ENOENT ב-fresh-clone ובלי-הסגר-על-קובץ-קורום (התקנון-R256 — סטייה-דו-כיוונית-שנתפסה)
      const g = deserialize(loadJson(TASKS_FILE, { tasks: [] }));
      const p = progress(g);
      if (has("--json")) {
        console.log(JSON.stringify({ at: new Date().toISOString(), progress: p, tasks: g.tasks, ready: ready(g).map((t) => t.id) }, null, 2));
      } else {
        console.log(`tasks: ${g.tasks.length} · progress=${p} · ready=[${ready(g).map((t) => t.id).join(",")}]`);
        for (const t of g.tasks) {
          console.log(`  [${t.status.padEnd(9)}] ${t.id} (P${t.priority}${t.deps.length ? `, deps:${t.deps.join("+")}` : ""}) ${t.title}`);
        }
      }
      break;
    }
    case "task-add": {
      const title = args[1];
      // R259 · שומר-הכותרת: "task-add --id X title" שמר-בשקט-כותרת "--id" (נמדד) — כותרת-קודמת-לדגלים, נדחה-בגלוי
      if (!title || title.startsWith("--")) throw new Error('שימוש: task-add "<title>" [--priority N] [--deps a,b] — הכותרת-חייבת-לבוא-לפני-הדגלים');
      withLock(TASKS_FILE, () => {
        const g = deserialize(loadJson(TASKS_FILE, { tasks: [] }));
        const t = createTask({
          id: flagVal("--id") ?? newId("T"),
          title,
          priority: flagVal("--priority") ?? 0,
          deps: (flagVal("--deps") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
          assignee: flagVal("--assignee") ?? null,
        });
        g.tasks.push(t);
        persistValidated(TASKS_FILE, g, validateGraph);
        console.log(`added: ${t.id} (todo) ${t.title}`);
      });
      break;
    }
    case "task-set": {
      const [, id, to] = args;
      if (!id || !to) throw new Error("שימוש: task-set <id> <status>");
      if (!STATUSES.includes(to)) throw new Error(`סטטוס-לא-מוכר: ${to} (חוקי: ${STATUSES.join(",")})`);
      withLock(TASKS_FILE, () => {
        const g = deserialize(loadJson(TASKS_FILE, { tasks: [] }));
        let evidence;
        let commit;
        if (to === "done") {
          commit = flagVal("--commit");
          if (!commit) {
            throw new Error("DONE-GATE-REFUSED: done דורש --commit <sha> שנדחף-דרך-השער (done-only-via-verified-push — אין-עקיפה)");
          }
          evidence = computeEvidence(commit);
          console.log(`evidence: selftest=${evidence.selftestGreen && evidence.selftestFresh ? "GREEN-FRESH" : "UNFIT"} (${evidence.selftestInfo ?? "missing"}) · push=${evidence.pushRecorded ? "RECORDED" : "MISSING"} (${evidence.pushInfo ?? "missing"})`);
          if (!evidence.pushShas.length) {
            throw new Error(`DONE-GATE-REFUSED: ה-commit ${commit.slice(0, 7)} לא-מאומת-כדחוף-דרך-השער — דחפו-אותו-קודם (sovereign-push) ואז-נסו-שוב`);
          }
        }
        setStatus(g, id, to, { evidence, reason: flagVal("--reason"), commit });
        persistValidated(TASKS_FILE, g, validateGraph);
        console.log(`${id} → ${to}${to === "done" ? " ✓ (עבר-את-שער-הדחיפה-המאומתת)" : ""}`);
      });
      break;
    }
    case "drill": {
      const r = runDrill(Number(flagVal("--seed") ?? 252));
      if (has("--json")) {
        console.log(JSON.stringify({ ok: r.ok, steps: r.steps, validation: r.validation, tasks: r.g.tasks }, null, 2));
      } else {
        for (const s of r.steps) console.log(s);
        console.log(`DRILL ${r.ok ? "PASS" : "FAIL"} (seed=${r.g.seed})`);
      }
      if (!r.ok) process.exit(1);
      break;
    }
    case "decisions": {
      const dq = deserializeDQ(loadJson(DQ_FILE, { decisions: [] }));
      const open = listOpen(dq);
      if (has("--json")) {
        console.log(JSON.stringify({ at: new Date().toISOString(), openCount: open.length, decisions: dq.decisions }, null, 2));
      } else {
        console.log(`decisions: ${dq.decisions.length} total · ${open.length} open`);
        for (const d of dq.decisions) {
          console.log(`  [${d.status.padEnd(9)}] ${d.id} (${d.kind}) ${d.question}`);
          d.options.forEach((o, i) => console.log(`      ${i + 1}. ${o.label}${o.recommended ? " ← מומלץ" : ""}`));
          if (d.answer) console.log(`      תשובה: ${JSON.stringify(d.answer)}`);
        }
      }
      break;
    }
    case "decision-add": {
      const [, kind, question] = args;
      if (!kind || !question) throw new Error("שימוש: decision-add <question|permission|merge> \"<question>\" \"<opt1>\" \"<opt2>\"...");
      withLock(DQ_FILE, () => {
        const dq = deserializeDQ(loadJson(DQ_FILE, { decisions: [] }));
        const d = createDecision({ id: flagVal("--id") ?? newId("D"), kind, question, options: positional(args.slice(3)) });
        dq.decisions.push(d);
        persistValidated(DQ_FILE, dq, validateDQ);
        console.log(`decision-open: ${d.id} (${d.kind}) — ${d.options.length} אפשרויות, מומלץ: ${d.options[0]?.label ?? "—"}`);
      });
      break;
    }
    case "decision-answer": {
      const [, id, input] = args;
      withLock(DQ_FILE, () => {
        const dq = deserializeDQ(loadJson(DQ_FILE, { decisions: [] }));
        const d = answerDecision(dq, id, { by: flagVal("--by") ?? "operator", optionText: input, text: flagVal("--text") });
        persistValidated(DQ_FILE, dq, validateDQ);
        console.log(`answered: ${d.id} → ${d.answer.option ?? "(טקסט-חופשי)"}${d.answer.text ? ` · "${d.answer.text}"` : ""} — settle-רק-אחרי-האפקט-בפועל`);
      });
      break;
    }
    case "decision-settle": {
      withLock(DQ_FILE, () => {
        const dq = deserializeDQ(loadJson(DQ_FILE, { decisions: [] }));
        const d = settleDecision(dq, args[1]);
        persistValidated(DQ_FILE, dq, validateDQ);
        console.log(`settled: ${d.id}`);
      });
      break;
    }
    case "decision-reopen": {
      const reason = positional(args.slice(2)).join(" ");
      if (!reason) throw new Error('שימוש: decision-reopen <id> "<סיבה>" — הסיבה-חובה (היא-נשמרת-בהיסטוריה)');
      withLock(DQ_FILE, () => {
        const dq = deserializeDQ(loadJson(DQ_FILE, { decisions: [] }));
        const d = reopenDecision(dq, args[1], reason);
        persistValidated(DQ_FILE, dq, validateDQ);
        console.log(`reopened: ${d.id} — חוזר-ל-open עם-הסיבה-בהיסטוריה`);
      });
      break;
    }
    case "decision-cancel": {
      const reason = positional(args.slice(2)).join(" ");
      if (!reason) throw new Error('שימוש: decision-cancel <id> "<סיבה>" — הסיבה-חובה');
      withLock(DQ_FILE, () => {
        const dq = deserializeDQ(loadJson(DQ_FILE, { decisions: [] }));
        const d = cancelDecision(dq, args[1], reason);
        persistValidated(DQ_FILE, dq, validateDQ);
        console.log(`cancelled: ${d.id}`);
      });
      break;
    }
    default:
      printHelp();
      process.exit(cmd ? 2 : 0);
  }
} catch (e) {
  console.error(`REFUSED: ${e.message}`);
  process.exit(1);
}
