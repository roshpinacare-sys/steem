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
import { readFileSync, renameSync, existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync, statSync, readdirSync, fsyncSync } from "node:fs";
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
const has = (f) => args.includes(f);
const flagVal = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const FRESH_MS = 24 * 60 * 60 * 1000;

/* R259 · fsync לפני-rename: rename אטומי מול-תהליכים אחרים, אבל מול-אובדן-חשמל
 * ה-content עלול לא להספיק-להישטף — fsync סוגר-את-משפחת-הכשל-הזו (כמו-SQLite). */
function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = openSync(tmp, "w");
  try { writeSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
  sweepTmp(file);
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

/* פוזיציונליים-בלבד: מדלג-על --flag וגם-על-ערכו (הצולע-שגרם ל-D-VIS-בעלת-3-אפשרויות) */
function positional(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith("--")) { i++; continue; }
    out.push(list[i]);
  }
  return out;
}

/* R258 · מנעול-כותב: rename-אטומי מונע-קורום אבל לא אובדן-עדכונים — נמדד-חי:
 * 20-task-add-מקבילים → 11-שורדים (read-modify-write אינו טרנזקציה בין-תהליכים).
 * O_EXCL-יוצר-מנעול-אטומית; מנעול-מת (>30s) = רכוש-תהליך-מת ומועבר-הצדה;
 * המתנה-קצרה ואז סירוב-שקוב LOCK-BUSY (לעולם לא שתיקה). */
const LOCK_STALE_MS = 30_000, LOCK_WAIT_MS = 2000;
function withLock(file, fn) {
  mkdirSync(path.dirname(file), { recursive: true }); // סדר-הפעולות-חשוב: התיקייה-לפני-המנעול (למדנו-ב-R258-מהריצה-החוזרת)
  const lockFile = `${file}.lock`;
  const t0 = Date.now();
  let fd = null;
  while (fd === null) {
    try {
      fd = openSync(lockFile, "wx");
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        // R259 · חיות-הבעלים: SIGKILL באמצע-כתיבה משאיר-מנעול-יתום-שחוסם-כתיבה-עד-30s (נמדד).
        // probe signal-0 — בעלים-מת (ESRCH) = גניבה-מיידית גם-אם-המנעול-טרי; סף-הגיל נשאר-גיבוי לבעלים-חי-שנתקע.
        let dead = false;
        try {
          const ownerPid = Number(readFileSync(lockFile, "utf8").trim().split(/\s+/)[0]);
          const age = Date.now() - statSync(lockFile).mtimeMs;
          if (Number.isInteger(ownerPid) && ownerPid > 0) {
            try { process.kill(ownerPid, 0); } catch (pe) { dead = pe.code === "ESRCH"; }
          } else {
            // בעלים-לא-קריא (ריק/זבל): תהליך-שנהרג-בין-יצירת-המנעול-לכתיבת-ה-pid (נמדד ב-SIGKILL-storm).
            // חסד-250ms מכסה-את-חלון-הµs-של-כותב-חי-שטרם-כתב-את-ה-pid; אחר-כך-זה-יתום.
            dead = age > 250;
          }
          if (age > LOCK_STALE_MS) dead = true; // חוק-הגיל-נשאר-גיבוי לבעלים-חי-שנתקע
        } catch { /* קריאה-נכשלה/המנעול-נעלם — נסה-שוב */ }
        if (dead) {
          try { renameSync(lockFile, `${lockFile}.stale-${Date.now()}`); } catch { /* כבר-איננו */ } // העברה-אטומית — רק-כותב-אחד-מנצח
        }
      } catch { /* כבר-איננו — נסה-שוב */ }
      if (Date.now() - t0 > LOCK_WAIT_MS) throw new Error(`LOCK-BUSY: ${path.basename(lockFile)} מוחזק-בידי-כותב-אחר`);
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); } catch { /* בלי-חסימה — המשך */ }
    }
  }
  try { writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`); } catch { /* אינפורמטיבי-בלבד */ }
  try {
    return fn();
  } finally {
    try { closeSync(fd); } catch { /* כבר-סגור */ }
    try { unlinkSync(lockFile); } catch { /* כבר-פונה */ }
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
      withLock(DQ_FILE, () => {
        const dq = deserializeDQ(loadJson(DQ_FILE, { decisions: [] }));
        const d = reopenDecision(dq, args[1], positional(args.slice(2)).join(" "));
        persistValidated(DQ_FILE, dq, validateDQ);
        console.log(`reopened: ${d.id} — חוזר-ל-open עם-הסיבה-בהיסטוריה`);
      });
      break;
    }
    case "decision-cancel": {
      withLock(DQ_FILE, () => {
        const dq = deserializeDQ(loadJson(DQ_FILE, { decisions: [] }));
        const d = cancelDecision(dq, args[1], positional(args.slice(2)).join(" "));
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
