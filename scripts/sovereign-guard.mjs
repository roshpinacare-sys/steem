#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────
// sovereign-guard.mjs — שער-ההרג הריבוני (r153)
// אדפטציה ישירה של הארכיטקטורה של destructive_command_guard (dcg, Dicklesworthstone):
//   1. Whitelist-first    — תבניות-בטוחות נבדקות לפני-החבילות-ההרסניות (לעולם לא חוסם בטוח).
//   2. Default-allow      — פקודה-לא-מוכרת עוברת; רק-ידוע-הרסני נחסם (השער לא שובר זרימות-עבודה).
//   3. Zero-false-negatives — במקרה-ספק: חוסם. עוד אישור-ידני זול; עבודה-שאבדה יקרה.
//   4. Packs מודולריים    — git.history · git.remote · git.race* · git.secrets* · fs.destroy · fleet.life* · db.destroy
//                           (* = חבילות-יחיד שנולדו מתקלות-אמת של הרשת: r150/r151 rebase-race · r151 PAT-near-miss · הצי-חי)
//   5. Context detection  — נתונים (echo/grep/cat) לא נחסמים; ביצוע כן. bash -c/node -e → רקורסיה-לתוך-ה-payload.
//   6. Bounded failure    — שגיאת-השער-עצמו = תוצאה-מפורשת (guard_error ביומן) ולא-שתיקה; בגבול-הגיט: fail-closed (זול-לנסות-שוב).
//   7. Agent-safe streams — JSON-מכונה ב-stdout · פאנל-אנושי ב-stderr · allow = שקט.
//   8. סטייה-מוצהרת מ-dcg — אין graduated-response (WARNING-שעובר מרעיל את חוק-הראיה בעידן D-OP-01): חסימה-בינארית + ראיה-מלאה ב-blocked.jsonl.
//
// שימוש:
//   bun scripts/sovereign-guard.mjs --check "<cmd>"    # ניתוח+רישום-ראיה; exit 1 אם נחסם
//   bun scripts/sovereign-guard.mjs --explain "<cmd>"  # ניתוח-בלבד (אפס-תופעות-לוואי); תמיד exit 0
//   bun scripts/sovereign-guard.mjs --selftest         # טבלת-מקרים מובנית; כותב sovereign/guard/selftest.json
//   bun scripts/sovereign-guard.mjs --install          # מתקין .git/hooks/pre-commit (scan-mode)
//   bun scripts/sovereign-guard.mjs --scan-staged      # מצב-קדם-קומיט: סודות-מדורגים + שורות-.sh-חדשות
// ─────────────────────────────────────────────────────────────────────────────
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const GUARD_DIR = path.join(ROOT, "sovereign", "guard");
const BLOCKED_LOG = path.join(GUARD_DIR, "blocked.jsonl");
const STATS = path.join(GUARD_DIR, "stats.json");
const SELFTEST_OUT = path.join(GUARD_DIR, "selftest.json");

// ── מקורות-אמת של הרשת (מוגנים-מחיקה-כוחנית) ──────────────────────────────
const PROTECTED_FILES = [
  "feature_list.json", "progress.md", "session-handoff.md", "AGENTS.md",
  "worklog.md", "init.sh", "prisma/schema.prisma",
];
const TEMP_PREFIXES = ["/tmp/", "/tmp", "/var/tmp/", "$TMPDIR", "${TMPDIR}"];

const DATA_FIRST_TOKENS = new Set([
  "echo", "printf", "cat", "grep", "rg", "ls", "head", "tail", "wc", "sort",
  "uniq", "which", "type", "man", "history", "date", "pwd", "whoami",
  "hostname", "uname", "jq", "diff", "find", "stat", "env", "printenv",
]);

// פעלי-קריאת-גיט (whitelist תמידי)
const GIT_READ_VERBS = new Set([
  "status", "log", "diff", "show", "branch", "remote", "rev-parse", "fetch",
  "ls-files", "check-ignore", "describe", "reflog", "blame", "shortlog",
  "tag", "worktree", "ls-remote", "count-objects", "verify-commit", "symbolic-ref",
]);

const SECRET_PATTERNS = [
  { re: /\.git-askpass\.sh\b/, he: "askpass-הבית (PAT)" },
  { re: /\bpat\.env\b/, he: "pat.env (PAT)" },
  { re: /\.env\b(?!\.(example|sample|template))/, he: "קובץ .env (סודות)" },
  { re: /\bid_rsa\b|\bid_ed25519\b/, he: "מפתח-SSH פרטי" },
  { re: /\.pem\b/, he: "תעודה/מפתח .pem" },
  { re: /\bheadcorner\.txt\b/, he: "headcorner.txt (מפתח-הרשת)" },
];

const SQL_CLIENTS = new Set(["sqlite3", "psql", "mysql", "mysqladmin", "mongosh", "mongo", "redis-cli"]);

function tempSafe(p) {
  return TEMP_PREFIXES.some((t) => p === t || p.startsWith(t));
}

function firstToken(cmd) {
  return (cmd.trim().split(/\s+/)[0] || "").toLowerCase();
}

// ביטול-מרכאות בסיסי ל-payload של bash -c "..." / bun -e '...'
function stripQuotes(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
      (t.startsWith("'") && t.endsWith("'") && t.length >= 2)) {
    return t.slice(1, -1);
  }
  return t;
}

// חילוץ-payload מריצה-מקוננת: bash/sh/zsh -c "..." · bun/node -e "..."
function nestedPayload(cmd) {
  const m = cmd.match(/^\s*(?:sudo\s+)?(?:bash|sh|zsh)\s+(?:-[^\s]+\s+)*-c\s+(.+)$/s)
        || cmd.match(/^\s*(?:sudo\s+)?(?:bun|node|deno)\s+(?:[^\s]+\s+)*?(?:-e|--eval)\s+(.+)$/s);
  return m ? stripQuotes(m[1]) : null;
}

// ── המנוע: whitelist-first → packs → default-allow ─────────────────────────
function analyze(cmd, depth = 0) {
  cmd = cmd.trim();
  if (!cmd) return { decision: "ALLOW", rule: null, pack: null, reason: null, tip: null };

  // 5. Context detection — רקורסיה לתוך-payload של ריצה-מקוננת
  if (depth < 3) {
    const inner = nestedPayload(cmd);
    if (inner && inner !== cmd) return analyze(inner, depth + 1);
  }

  const tok = firstToken(cmd);
  const isGit = tok === "git" || /^\sgit\s/.test(cmd);

  // ── 1. WHITELIST-FIRST ──────────────────────────────────────────────────
  if (DATA_FIRST_TOKENS.has(tok)) {
    return { decision: "ALLOW", rule: "data-context", pack: "whitelist", reason: "פקודת-נתונים — אינה מבצעת", tip: null };
  }
  if (isGit) {
    const verb = (cmd.trim().split(/\s+/)[1] || "");
    // branch: קריאה רק-אם-אין-דגלי-מחיקה/כוח (ל-D/-C/-M/-f יש חוק-משלו בהמשך)
    if (GIT_READ_VERBS.has(verb) && !(verb === "branch" && /git\s+branch\s+(?:[^\s]*\s+)?-[DCMf]\b/.test(cmd))) {
      return { decision: "ALLOW", rule: "git-read", pack: "whitelist", reason: "פעולת-קריאת-גיט", tip: null };
    }
    // שחזור-מהמקרה-האמיתי (r150/r151 playbook): rebase --quit/--abort/--continue חוקיים
    if (/git\s+rebase\s+(?:[^\s]+\s+)*(--quit|--abort|--continue)\b/.test(cmd)) {
      return { decision: "ALLOW", rule: "git-recovery-rebase", pack: "whitelist", reason: "פעולת-שחזור-מהפלייבוק (r150/r151)", tip: null };
    }
    // ענף-חדש / שחזור-ענף-מהפלייבוק: checkout -B/-b/--orphan
    if (/git\s+checkout\s+(?:[^\s]+\s+)*(-B|-b|--orphan)\s/.test(cmd)) {
      return { decision: "ALLOW", rule: "git-checkout-new", pack: "whitelist", reason: "יצירת/שחזור-ענף", tip: null };
    }
    if (/git\s+restore\s+(?:[^\s]+\s+)*(--staged|-S)\b/.test(cmd)) {
      return { decision: "ALLOW", rule: "git-restore-staged", pack: "whitelist", reason: "ביטול-staging בלבד", tip: null };
    }
    if (/git\s+clean\s+(?:[^\s]*n[^\s]*|--dry-run)/.test(cmd) && !/git\s+clean\s+[^\s]*x?[fd]/.test(cmd)) {
      return { decision: "ALLOW", rule: "git-clean-dry-run", pack: "whitelist", reason: "תצוגה-מקדימה בלבד", tip: null };
    }
    if (/git\s+stash\s+(list|show|pop|apply)\b/.test(cmd)) {
      return { decision: "ALLOW", rule: "git-stash-safe", pack: "whitelist", reason: "stash לא-הורס", tip: null };
    }
    if (/git\s+push\b[^&;|]*--force-with-lease(?![^&;|]*\s--force\b)/.test(cmd) && !/\s-f\b/.test(cmd)) {
      return { decision: "ALLOW", rule: "git-force-with-lease", pack: "whitelist", reason: "דחיפה-מוגנת — מסרבת אם-יש-קומיטים-שלא-נראו", tip: null };
    }
    // משמעת-המרוץ (r150/r151): rebase/‏pull --rebase רק עם --autostash
    if (/git\s+(pull\s+)?rebase\b/.test(cmd) && /--autostash\b/.test(cmd)) {
      return { decision: "ALLOW", rule: "git-rebase-autostash", pack: "whitelist", reason: "rebase-עם-autostash — הצורה-הקנונית מול-מרוץ-הדיבונים", tip: null };
    }
  }
  // rm -rf אך כל-הנתיבים בטמפ — חוק-הגריטה של dcg
  if (/\brm\b/.test(cmd) && flagsOf(cmd).recursive && flagsOf(cmd).force) {
    const paths = rmPaths(cmd);
    if (paths.length > 0 && paths.every(tempSafe)) {
      return { decision: "ALLOW", rule: "rm-temp-only", pack: "whitelist", reason: "גריטה-רקורסיבית-ב-/tmp בלבד", tip: null };
    }
  }

  // ── 2. PACKS (deny) ─────────────────────────────────────────────────────
  // חבילת git.secrets — נולדה מהקרבה-האמיתית (r151: PAT כמעט-נכנס-לקומיט)
  if (/\bgit\s+(add|rm|commit|stash\s+push|mv)\b/.test(cmd)) {
    for (const sp of SECRET_PATTERNS) {
      if (sp.re.test(cmd)) {
        return { decision: "BLOCK", rule: "secrets-stage", pack: "git.secrets", reason: `דירוג-סוד לגיט חסום: ${sp.he}`, tip: "הסוד נשאר מחוץ להיסטוריה. ודא .gitignore ואז commit סלקטיבי לפי-שם-קובץ." };
      }
    }
  }
  // חבילת git.history — הרס-עבודה-שלא-נשמרה
  if (/git\s+reset\s+--hard\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "reset-hard", pack: "git.history", reason: "git reset --hard משמיד שינויים-שלא-נשמרו", tip: "git stash קודם — או git checkout -B main origin/main לשחזור-מבוקר (פלייבוק r150)." };
  }
  if (/git\s+reset\s+--merge\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "reset-merge", pack: "git.history", reason: "git reset --merge משמיד שינויים-שלא-נשמרו", tip: "סיים-או-בטל-את-המיזוג במפורש: git merge --abort." };
  }
  if (/git\s+checkout\s+(?:[^\s]+\s+)*(?:--\s+\S|\.\s*$|\.(?:\s|$))/.test(cmd)) {
    return { decision: "BLOCK", rule: "checkout-discard", pack: "git.history", reason: "git checkout -- <נתיב> משליך שינויים-מקומיים", tip: "git stash push -- <נתיב> שומר-ומנקה בו-זמנית." };
  }
  if (/git\s+restore\b/.test(cmd) && !/git\s+restore\s+(?:[^\s]+\s+)*(--staged|-S)\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "restore-worktree", pack: "git.history", reason: "git restore משליך שינויים-שלא-נשמרו", tip: "git restore --staged <נתיב> רק-מבטל-staging; git stash לשמירה." };
  }
  if (/git\s+clean\b/.test(cmd) && /git\s+clean\s+[^\s]*f/.test(cmd)) {
    return { decision: "BLOCK", rule: "clean-force", pack: "git.history", reason: "git clean -f מוחק-צמיתות קבצים-לא-עוקבים", tip: "git clean -n קודם — תצוגה-מקדימה." };
  }
  if (/git\s+stash\s+(drop|clear)\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "stash-destroy", pack: "git.history", reason: `git stash ${cmd.includes("clear") ? "clear מוחק את כל" : "drop מוחק"} ה-stash-ים`, tip: "stash list קודם; stash pop מחזיר-ומוחק-בבטחה." };
  }
  if (/git\s+branch\s+(?:[^\s]*\s+)?-[DCMf]\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "branch-force-delete", pack: "git.history", reason: "מחיקה/דריסה-כוחנית של ref-ענף", tip: "git branch -d (קטן) מאובטח-על-ידי-גיט עצמו — מיזוג-נבדק." };
  }
  // חבילת git.remote — הרס-היסטוריית-מקור
  if (/git\s+push\b/.test(cmd) && /--force(?!--with-lease)|\s-f\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "push-force", pack: "git.remote", reason: "git push --force דורס קומיטים-על-המקור", tip: "git push --force-with-lease — מסרב אם-יש-קומיטים-שלא-נראו." };
  }
  // חבילת git.race — נולדה מהתבנית-החוזרת r150/r151 (דיבונים-כותבים-state בזמן-rebase → rebase-משובש)
  if (/git\s+rebase\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "rebase-no-autostash", pack: "git.race", reason: "rebase-ללא-autostash — התבנית-ששברה-את-השרשרת פעמיים (r150/r151): הדיבונים כותבים state-קבצים תוך-כדי", tip: "git pull --rebase --autostash — הצורה-הקנונית; שחזור-חירום: git rebase --quit/--abort (מותר-ב-whitelist)." };
  }
  if (/git\s+pull\b/.test(cmd) && /--rebase\b/.test(cmd) && !/--autostash\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "pull-rebase-no-autostash", pack: "git.race", reason: "pull --rebase ללא --autostash על-עץ-לא-נקי = rebase-משובש (r150/r151)", tip: "git pull --rebase --autostash — אוטומטי ובטוח גם-על-עץ-מלוכלך." };
  }
  // חבילת fs.destroy — מחיקה-רקורסיבית-כוחנית מחוץ-לטמפ (חוק-dcg) + קבצי-אמת מוגנים
  if (/\brm\b/.test(cmd)) {
    const f = flagsOf(cmd);
    const paths = rmPaths(cmd);
    if (f.recursive && f.force) {
      const target = paths.length === 0 ? "(ברירת-מחדל: התיקייה-הנוכחית!)" : paths.join(" ");
      return { decision: "BLOCK", rule: "rm-rf-outside-temp", pack: "fs.destroy", reason: `מחיקה-רקורסיבית-כוחנית מחוץ-ל-/tmp: ${target}`, tip: "גריטה → /tmp בלבד · לניקוי-ממוקד: rm בלי -f ואז אישור, או מחיקת-קבצים-מפורשים-יחידים." };
    }
    if (f.force) {
      for (const p of paths) {
        const norm = p.replace(/^\.\//, "").replace(/\/+$/, "");
        if (PROTECTED_FILES.includes(norm) || norm === "." || norm === ".." || p.startsWith("$") || p.includes("*")) {
          return { decision: "BLOCK", rule: "rm-protected", pack: "fs.destroy", reason: `rm-כוחני על מקור-אמת: ${p}`, tip: "קבצי-ה-harness והסודות-הקנוניים מוגנים-מחיקה-כוחנית." };
        }
        for (const dir of ["src", "sovereign", "mini-services", "prisma", "db", "scripts", ".git"]) {
          if (norm === dir || norm.startsWith(dir + "/")) {
            return { decision: "BLOCK", rule: "rm-protected-dir", pack: "fs.destroy", reason: `rm-כוחני על תיקיית-מקור: ${p}`, tip: "מקורות-הרשת מוגנים; גריטה-רקורסיבית → /tmp בלבד." };
          }
        }
      }
    }
  }
  // חבילת fleet.life — הצי-החי (9 פורטים) מוגן מהרג-עיוור
  if (/\bpkill\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "pkill", pack: "fleet.life", reason: "pkill הורג-עיוור לפי-שם — מפיל את הבית (3000) ואת-כל-הצי במכה-אחת", tip: "kill <PID> ספציפי מ-lsof -t -i:<פורט> (בלי צינור-ל-kill)." };
  }
  if (/\bkillall\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "killall", pack: "fleet.life", reason: "killall הורג-עיוור לפי-שם", tip: "kill <PID> ספציפי מ-lsof -t -i:<פורט>." };
  }
  if (/\bfuser\b/.test(cmd) && /\s-k\b|\s--kill\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "fuser-kill", pack: "fleet.life", reason: "fuser -k הורג-כל-תהליך-על-הפורט", tip: "kill <PID> ספציפי מ-lsof -t -i:<פורט>." };
  }
  if (/\b(?:lsof|pgrep|fuser)\b[^&;|]*\|\s*(?:xargs\s+)?kill/.test(cmd)) {
    return { decision: "BLOCK", rule: "pipe-kill", pack: "fleet.life", reason: "צינור lsof/pgrep→kill הוא הרג-עיוור (PID-לא-נראה-לעין)", tip: "הרץ lsof -t -i:<פורט>, קרא את ה-PID, והרוג-אותו-מפורשות." };
  }
  // חבילת db.destroy
  if (/prisma\s+migrate\s+reset\b/.test(cmd)) {
    return { decision: "BLOCK", rule: "prisma-reset", pack: "db.destroy", reason: "prisma migrate reset משמיד את-כל-הנתונים ומריץ-seed", tip: "מיגרציה-קדימה: prisma migrate dev · איפוס-מדוד: מחיקת-db מפורשת-עם-גיבוי." };
  }
  if (SQL_CLIENTS.has(tok) && /\b(DROP\s+(TABLE|DATABASE)|TRUNCATE|FLUSHALL|FLUSHDB)\b/i.test(cmd)) {
    return { decision: "BLOCK", rule: "sql-drop", pack: "db.destroy", reason: "SQL-הרסני (DROP/TRUNCATE/FLUSH) דרך לקוח-שרשרת", tip: "בצע-מדידה-וגיבוי לפני-כל-הרס-נתונים." };
  }

  // ── 3. DEFAULT-ALLOW ────────────────────────────────────────────────────
  return { decision: "ALLOW", rule: null, pack: null, reason: null, tip: null };
}

// ── עזרי ניתוח ─────────────────────────────────────────────────────────────
function flagsOf(cmd) {
  const m = cmd.match(/\brm\s+(.+)$/);
  if (!m) return { recursive: false, force: false };
  let s = " " + m[1] + " ";
  let recursive = false, force = false;
  s = s.replace(/\s--recursive\b/, " -r ").replace(/\s--force\b/, " -f ");
  const flagTok = s.match(/(?:^|\s)(-[a-zA-Z]+)/g) || [];
  const joined = flagTok.join("");
  recursive = /r|R/.test(joined);
  force = /f/.test(joined);
  return { recursive, force };
}

function rmPaths(cmd) {
  const m = cmd.match(/\brm\s+(.+)$/);
  if (!m) return [];
  const rest = m[1].replace(/\s--\s/, " ").trim();
  return rest.split(/\s+/).filter((t) => t && !t.startsWith("-"));
}

// ── ראיה: יומן-חסימות + מונים ──────────────────────────────────────────────
function logBlock(entry) {
  try {
    fs.mkdirSync(GUARD_DIR, { recursive: true });
    fs.appendFileSync(BLOCKED_LOG, JSON.stringify(entry) + "\n");
    let stats = { blocked: 0, byRule: {}, lastBlockedAt: null };
    try { stats = JSON.parse(fs.readFileSync(STATS, "utf8")); } catch { /* ראשון */ }
    stats.blocked = (stats.blocked || 0) + 1;
    stats.byRule[entry.rule] = (stats.byRule[entry.rule] || 0) + 1;
    stats.lastBlockedAt = entry.at;
    fs.writeFileSync(STATS, JSON.stringify(stats, null, 2) + "\n");
  } catch (e) {
    // bounded failure: רישום-הראיה לא יפיל את-השער — אבל החסימה-עצמה נשארת
    process.stderr.write(`[guard] log-write-failed (חסימה-נשמרת): ${e.message}\n`);
  }
}

function panel(verdict, cmd) {
  const lines = [
    "══════════════════════════════════════════════════════════════",
    verdict.decision === "BLOCK" ? "BLOCKED  sovereign-guard" : "EXPLAIN  sovereign-guard",
    "──────────────────────────────────────────────────────────────",
    `Reason:  ${verdict.reason}`,
    `Rule:    ${verdict.pack}:${verdict.rule}`,
    `Command: ${cmd}`,
  ];
  if (verdict.tip) lines.push(`Tip:     ${verdict.tip}`);
  lines.push("══════════════════════════════════════════════════════════════");
  return lines.join("\n");
}

// ── מצבי-ריצה ──────────────────────────────────────────────────────────────
function runCheck(cmd, mode) {
  let verdict;
  try {
    verdict = analyze(cmd);
  } catch (e) {
    // bounded failure: שגיאת-השער-עצמו = תוצאה-מפורשת, לא-שתיקה
    verdict = { decision: "ALLOW", rule: "guard-error", pack: "internal", reason: e.message, tip: "שגיאת-השער-עצמו — דווח ורשום" };
    logBlock({ at: new Date().toISOString(), mode: mode ?? "check", command: cmd, rule: "guard-error", pack: "internal", reason: e.message, outcome: "guard_error" });
    process.stdout.write(JSON.stringify({ ...verdict, outcome: "guard_error" }) + "\n");
    process.exitCode = 0;
    return;
  }
  if (verdict.decision === "BLOCK") {
    if (mode !== "explain") {
      logBlock({ at: new Date().toISOString(), mode: mode ?? "check", command: cmd, rule: verdict.rule, pack: verdict.pack, reason: verdict.reason, outcome: "blocked" });
    }
    process.stdout.write(JSON.stringify({ ...verdict, command: cmd, mode: mode ?? "check" }) + "\n");
    process.stderr.write(panel(verdict, cmd) + "\n");
    process.exitCode = 1;
  } else if (mode === "explain") {
    process.stdout.write(JSON.stringify({ ...verdict, command: cmd, mode }) + "\n");
    process.stderr.write(`[guard] מותר — ${verdict.rule ?? "default-allow"}${verdict.reason ? " · " + verdict.reason : ""}\n`);
  }
  // allow במצב check: שקט, exit 0
}

function runScanStaged() {
  const blocked = [];
  try {
    const files = execSync("git diff --cached --name-only", { cwd: ROOT, encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
    // 1) סודות-מדורגים — הגבול-האוטומטי (r151 near-miss)
    for (const f of files) {
      for (const sp of SECRET_PATTERNS) {
        if (sp.re.test(f)) blocked.push({ command: f, rule: "staged-secret", pack: "git.secrets", reason: `קובץ-סוד מדורג לקומיט: ${sp.he}` });
      }
    }
    // 2) scan-mode על שורות-חדשות ב-.sh (פקודות-שרץ אחר-כך) — שקילת-dcg ל-CI
    for (const f of files.filter((x) => x.endsWith(".sh"))) {
      const diff = execSync(`git diff --cached -U0 -- "${f}"`, { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
      for (const line of diff.split("\n")) {
        if (!line.startsWith("+") || line.startsWith("+++")) continue;
        const code = line.slice(1);
        if (!code.trim() || code.trim().startsWith("#")) continue;
        const v = analyze(code);
        if (v.decision === "BLOCK") blocked.push({ command: `${f}: ${code.trim()}`, rule: v.rule, pack: v.pack, reason: v.reason });
      }
    }
  } catch (e) {
    // בגבול-הגיט: fail-closed (זול-לנסות-שוב) — סטייה-מתועדת מה-check-החי
    process.stderr.write(`[guard] scan-error (fail-closed בגבול-הגיט): ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (blocked.length > 0) {
    for (const b of blocked) {
      logBlock({ at: new Date().toISOString(), mode: "pre-commit", command: b.command, rule: b.rule, pack: b.pack, reason: b.reason, outcome: "blocked" });
      process.stderr.write(panel({ ...b, decision: "BLOCK", tip: null }, b.command) + "\n");
    }
    process.stdout.write(JSON.stringify({ decision: "BLOCK", mode: "pre-commit", count: blocked.length, blocked }) + "\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify({ decision: "ALLOW", mode: "pre-commit", count: 0 }) + "\n");
  }
}

// ── selftest — טבלת-האמת של השער (ראיה: sovereign/guard/selftest.json) ─────
const MUST_BLOCK = [
  "git reset --hard HEAD~5", "git reset --hard", "git push --force origin main",
  "git push -f", "git clean -fd", "git stash drop", "git stash clear",
  "rm -rf src", "rm -rf ./sovereign", "rm -rf /", "rm -rf *", "rm -rf $DIR",
  "rm -rf", "rm -f feature_list.json", "rm -f progress.md",
  "pkill -f node", "killall bun", "fuser -k 3000/tcp", "lsof -t -i:3000 | xargs kill",
  "git add .git-askpass.sh", "git add upload/pat.env", "git add .env", "git add .env.local",
  "prisma migrate reset", 'sqlite3 db/custom.db "DROP TABLE users;"',
  "git rebase main", "git pull --rebase origin main", 'bash -c "git reset --hard"',
  "git checkout -- src/app/page.tsx", "git checkout .", "git branch -D main",
  "git restore src/app/page.tsx",
];
const MUST_ALLOW = [
  "git status", "git log --oneline -5", "git diff", "git show HEAD",
  "git pull --rebase --autostash", "git rebase --quit", "git rebase --abort",
  "git rebase --continue", "git checkout -B main origin/main", "git checkout -b feature/x",
  "git restore --staged file.ts", "git clean -n", "git stash list", "git stash pop",
  "git push --force-with-lease origin main", "git branch -d old-feature",
  "rm -rf /tmp/dguard-study", "rm -rf $TMPDIR/cache", "rm -f /tmp/x.json",
  'grep "rm -rf" README.md', 'echo "git reset --hard"', "ls sovereign/money",
  "bun run dev", "curl -s http://localhost:3000/api/money", "git add .env.example",
  "kill 12345", "git add src/app/page.tsx", "rm build.log",
];

function runSelftest() {
  const failed = [];
  for (const c of MUST_BLOCK) {
    const v = analyze(c);
    if (v.decision !== "BLOCK") failed.push({ want: "BLOCK", got: v.decision + (v.rule ? `:${v.rule}` : ""), case: c });
  }
  for (const c of MUST_ALLOW) {
    const v = analyze(c);
    if (v.decision !== "ALLOW") failed.push({ want: "ALLOW", got: v.decision + (v.rule ? `:${v.rule}` : ""), case: c });
  }
  const result = {
    at: new Date().toISOString(),
    pass: failed.length === 0,
    cases: MUST_BLOCK.length + MUST_ALLOW.length,
    failed,
  };
  try {
    fs.mkdirSync(GUARD_DIR, { recursive: true });
    fs.writeFileSync(SELFTEST_OUT, JSON.stringify(result, null, 2) + "\n");
  } catch { /* הראיה מודפסת בכל-מקרה */ }
  process.stdout.write(JSON.stringify(result) + "\n");
  if (failed.length > 0) {
    for (const f of failed) process.stderr.write(`  ✘ want=${f.want} got=${f.got} · ${f.case}\n`);
    process.exitCode = 1;
  }
}

function runInstall() {
  const hook = path.join(ROOT, ".git", "hooks", "pre-commit");
  const body = `#!/bin/sh
# sovereign-guard pre-commit (scan-mode) — הותקן על-ידי scripts/sovereign-guard.mjs --install (r153)
# חסימה: סודות-מדורגים + שורות-.sh-הרסניות-חדשות. ביטול: מחק קובץ-זה.
cd "$(git rev-parse --show-toplevel)" || exit 1
if command -v bun >/dev/null 2>&1; then
  bun scripts/sovereign-guard.mjs --scan-staged
else
  node scripts/sovereign-guard.mjs --scan-staged
fi
`;
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, body, { mode: 0o755 });
  process.stdout.write(JSON.stringify({ installed: hook }) + "\n");
  process.stderr.write(`[guard] pre-commit מותקן: ${hook}\n`);
}

// ── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = args[0];
const target = args.slice(1).join(" ").trim();
if (flag === "--check" && target) runCheck(target, "check");
else if (flag === "--explain" && target) runCheck(target, "explain");
else if (flag === "--selftest") runSelftest();
else if (flag === "--install") runInstall();
else if (flag === "--scan-staged") runScanStaged();
else {
  process.stderr.write("שימוש: --check \"<cmd>\" | --explain \"<cmd>\" | --selftest | --install | --scan-staged\n");
  process.exitCode = 2;
}
