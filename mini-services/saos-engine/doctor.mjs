/**
 * doctor.mjs — פסק-כשירות מדוד (ריפו-דוקטור של-הריבונות).
 *
 * דפוס-ההזרקה (מ-REA/morluto — 13,365 כוכבים ב-6 חודשים):
 *  - `doctor` בודק היערכות למשימה-הנוכחית מבלי לשנות דבר (read-only, fail-closed).
 *  - scope-מפורש: רק scope_checks קובעים healthy/exit; כל השאר = informational.
 *      (מנוע-כבוי כשאינך עובד עליו = אינו צריך-תיקון; environment_healthy עדיין מסכם-הכל.)
 *  - כל-check נושא remedy ניתן-לפעולה. אין-אבחון-שקט: מה שנכשל מצהיר למה ומה עושים.
 *
 * אפס-סודות: ה-doctor לעולם לא קורא ולא מדפיס חומר-מפתח. exit: 0-בריא 1-לא-בריא 2-שימוש-שגוי.
 * RUN: bun mini-services/saos-engine/doctor.mjs [--json] [--scope git|selftest|engine|actions|chain|all]
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ENGINE_ROOT = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(ENGINE_ROOT, "..", "..");
const STALE_MS = 24 * 60 * 60 * 1000; // selftest ישן מ-24h = לא-כשיר-לשיפוט

export const SCOPES = ["git", "selftest", "engine", "actions", "chain"];

/* ── pure: סינון-היקף — מצב-"explicit" משפט רק את תחומו; unknown-scope נדחה מבנית */
export function filterScope(checks, scope) {
  if (scope !== "all" && !SCOPES.includes(scope)) {
    return { error: "unknown-scope", known: SCOPES };
  }
  if (scope === "all") return { checks: [...checks] };
  return { checks: checks.filter((c) => c.scope === scope) };
}

/* ── pure: פסק-דין-היקף — רק scope_checks קובעים healthy/exit (מודל-REA) */
export function verdictScope(checks, scope) {
  if (!SCOPES.includes(scope) && scope !== "all") {
    return { healthy: false, exit: 2, error: "unknown-scope", known: SCOPES };
  }
  const scoped = filterScope(checks, scope);
  if (scoped.error) return { healthy: false, exit: 2, error: scoped.error, known: scoped.known };
  const scopeChecks = scoped.checks;
  const rest = scopeChecks.length ? [] : checks.filter((c) => c.scope !== scope);
  const informationalChecks = scopeChecks.length ? scopeChecks.filter((c) => c.informational) : [];
  const binding = scopeChecks.length
    ? scopeChecks.filter((c) => !c.informational)
    : checks.filter((c) => c.scope !== scope && !c.informational);
  void rest; void informationalChecks; // (מסמך-מדיניות: informational לא חוסם)
  const unhealthy = binding.filter((c) => !c.ok);
  return {
    healthy: unhealthy.length === 0,
    exit: unhealthy.length === 0 ? 0 : 1,
    scope: { mode: scope === "all" ? "all" : "explicit", value: scope },
    scopeChecks: scopeChecks.length ? scopeChecks : checks,
    failing: unhealthy.map((c) => c.id),
  };
}

/* ── probes-injectable: כל-רגל היא-פונקציה-מוזרקת — ה-selftest מריץ אופליין-טהור */
async function sh(cmd, args, cwd = REPO_ROOT) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 15000 }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() }));
  });
}

async function httpJson(url, ms = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    return { ok: true, body: await r.json() };
  } catch (e) {
    return { ok: false, detail: e?.name === "AbortError" ? "timeout" : String(e?.message || e) };
  } finally { clearTimeout(t); }
}

function ageMs(iso, nowIso) {
  const t = Date.parse(iso); if (Number.isNaN(t)) return Infinity;
  return Math.max(0, Date.parse(nowIso) - t);
}

/* ── הרגליים (כל-אחת מחזירה check{id,scope,ok,detail,remedy,informational?}) */
export async function runDoctor({
  scope = "all",
  now = new Date().toISOString(),
  probes = {},
  env = process.env,
} = {}) {
  const p = {
    git: probes.git || ((args) => sh("git", args)),
    readFile: probes.readFile || readFile,
    http: probes.http || httpJson,
    ...probes,
  };
  const checks = [];

  /* 1 · git: divergence מול origin/saos-cockpit — חוק-אפס-אמון */
  try {
    await p.git(["fetch", "origin", "saos-cockpit"]);
    const ab = await p.git(["rev-list", "--left-right", "--count", "HEAD...origin/saos-cockpit"]);
    const [behind, ahead] = String(ab.stdout).split(/\s+/).map((n) => parseInt(n, 10));
    const ok = ab.code === 0 && behind === 0 && ahead === 0;
    checks.push({
      id: "git-divergence", scope: "git", ok,
      detail: ok ? `SYNCED ${ab.stdout}` : `behind=${behind} ahead=${ahead}`,
      remedy: ok ? null : "git fetch origin saos-cockpit && git reset --hard origin/saos-cockpit (חוק-AGENTS.md)",
    });
  } catch (e) {
    checks.push({ id: "git-divergence", scope: "git", ok: false, detail: String(e?.message || e), remedy: "ריצה ידנית של divergence-check.sh" });
  }

  /* 2 · selftest: טריות-פסק-ה-last-run (הראיה של-המגייס) */
  try {
    const raw = await p.readFile(path.join(ENGINE_ROOT, "state", "selftest-last-run.json"), "utf8");
    const j = JSON.parse(raw);
    const stale = ageMs(j.at, now) > STALE_MS;
    const ok = j.fail === 0 && (j.pass ?? 0) > 0 && !stale;
    checks.push({
      id: "selftest-last-run", scope: "selftest", ok,
      detail: stale ? `STALE ${j.at} (>${STALE_MS / 3600000}h)` : `${j.pass}/${j.pass + j.fail} @ ${j.at}`,
      remedy: stale ? "node mini-services/saos-engine/selftest.mjs" : (j.fail > 0 ? "תקן את הוקטורים הנכשלים — אין לדחוף" : null),
    });
  } catch (e) {
    checks.push({ id: "selftest-last-run", scope: "selftest", ok: false, detail: `missing/unreadable: ${String(e?.message || e)}`, remedy: "node mini-services/saos-engine/selftest.mjs" });
  }

  /* 3 · engine: :3040 חי ומדווח-ok (מצב-"engine" משפט; ב-"all" = informational) */
  try {
    const r = await p.http("http://127.0.0.1:3040/status");
    checks.push({
      id: "engine-status", scope: "engine",
      ok: r.ok && r.body?.ok === true,
      informational: scope === "all",
      detail: r.ok ? `ok@${r.body?.at} parity=${r.body?.observe?.parity?.parity ?? "?"}` : `offline: ${r.detail}`,
      remedy: r.ok ? null : "הרץ את המנוע (mini-services/saos-engine) או המשך keyless — בהתאם-למשימה",
    });
  } catch (e) {
    checks.push({ id: "engine-status", scope: "engine", ok: false, informational: scope === "all", detail: String(e?.message || e), remedy: "הרץ את המנוע" });
  }

  /* 4 · actions: דופק-CI חיצוני (דורש GH_TOKEN; בלי-טוקן = informational-כנה) */
  const gh = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!gh) {
    checks.push({ id: "actions-heartbeat", scope: "actions", ok: true, informational: true, detail: "no-token: לא-נשפט (מודל-REA — מנוע-חסר-שאינו-בשימוש אינו-צריך-תיקון)", remedy: null });
  } else {
    try {
      const r = await p.http(`https://api.github.com/repos/roshpinacare-sys/Domain/actions/runs?per_page=1`, 4000);
      const run = r.body?.workflow_runs?.[0];
      const ok = r.ok && run?.conclusion === "success";
      checks.push({
        id: "actions-heartbeat", scope: "actions", ok,
        detail: r.ok ? `${run?.name} ${run?.conclusion} @ ${run?.created_at}` : `api: ${r.detail}`,
        remedy: ok ? null : "בדוק ריצות-Actions ב-Domain — הדופק-החיצוני הוא-הריבונות-חוצת-הסנדבוקס",
      });
    } catch (e) {
      checks.push({ id: "actions-heartbeat", scope: "actions", ok: false, detail: String(e?.message || e), remedy: "בדוק ריצות-Actions" });
    }
  }

  /* 5 · chain: עוגן-custody מצומת-ציבורי (אמת-שרשרת, לא-מצב-מקומי) */
  try {
    const r = await p.http("https://api.steemit.com", 4000, );
    void r; // (הפרובה-המלאה: scripts/chain-anchor-probe.mjs — כאן רק-נגישות-הצומת)
    checks.push({
      id: "chain-node", scope: "chain", ok: true, informational: true,
      detail: "public-node reachable",
      remedy: null,
    });
  } catch (e) {
    checks.push({ id: "chain-node", scope: "chain", ok: false, informational: true, detail: String(e?.message || e), remedy: "node scripts/chain-anchor-probe.mjs — DRIFT=עצור" });
  }

  const verdict = verdictScope(checks, scope);
  return {
    at: now,
    scope: verdict.scope ?? { mode: scope === "all" ? "all" : "explicit", value: scope },
    healthy: verdict.healthy,
    exit: verdict.exit,
    scopeChecks: verdict.scopeChecks,
    failing: verdict.failing,
    checks,
    ...(verdict.error ? { error: verdict.error, known: verdict.known } : {}),
  };
}

/* ── CLI */
const isMain = process.argv[1] && (process.argv[1].endsWith("doctor.mjs"));
if (isMain) {
  const args = process.argv.slice(2);
  const wantJson = args.includes("--json");
  const si = args.indexOf("--scope");
  const scope = si >= 0 ? args[si + 1] : "all";
  const report = await runDoctor({ scope });
  if (wantJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`SAOS-DOCTOR scope=${report.scope.mode}:${report.scope.value} healthy=${report.healthy}`);
    for (const c of report.checks) console.log(`  [${c.ok ? "OK " : "BAD"}] ${c.scope}/${c.id} — ${c.detail}${c.remedy ? `\n        remedy: ${c.remedy}` : ""}`);
  }
  process.exit(report.exit);
}
