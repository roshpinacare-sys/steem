#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-ecosystem — מודד האקוסיסטם (G6)
//
// דוקטרינה: "שום טענה בלי מדידה". סגירת G6 (איחוד השכפול) דורשת
// מדידת שכפול חוזרת לפני ואחרי — הסף: dup < 0.2.
//
// הגדרה מדידה (מתועדת כאן כדי שהמספר יהיה ניתן לשחזור):
//   קובץ-סטטוס = כל *.md בכל עומק + *.json/*.yml/*.txt בשורש בלבד,
//                 עד 256KB, לא נעילות/חבילות (.github נכלל — רק לצורך תצפית).
//   קבוצת שכפול = קבצים עם sha256 זהה בדיוק, ב-≥2 ריפואים שונים.
//   dup = (עותקים יתרים מעבר לראשון של כל קבוצה) / (סה"כ קבצי-סטטוס שנמדדו).
//
// שימוש:
//   bun scripts/weave-ecosystem.ts --repos        # מלאי הריפואים
//   bun scripts/weave-ecosystem.ts --dup-scan     # מדידת שכפול ← דוח JSON
//   bun scripts/weave-ecosystem.ts --dup-scan --json PATH
// ─────────────────────────────────────────────────────────────────────

import { execSync } from "child_process";
import * as fs from "fs";
import * as crypto from "crypto";
import { db } from "@/lib/db";
import { appendAttestation } from "@/lib/weave/ledger";
import { createCheckpointNow } from "@/lib/weave/beat";

const OWNER = process.env.WEAVE_OWNER || "roshpinacare-sys";

/** ה-PAT מה-remote — אף פעם לא מודפס, רק משמש ל-header */
function pat(): string {
  let url = "";
  try {
    url = execSync("git remote get-url origin", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error("אין remote origin — הרץ מתוך clone של הבית הריבוני");
  }
  const m = url.match(/x-access-token:([^@]+)@/);
  if (!m) throw new Error("אין PAT ב-remote URL");
  return m[1];
}

async function gh<T>(apiPath: string): Promise<{ status: number; json: T | null }> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    headers: {
      Authorization: `Bearer ${pat()}`,
      Accept: "application/vnd.github+json",
    },
    // R112 — law of the bounded wait: no fetch without a deadline
    signal: AbortSignal.timeout(30_000),
  });
  let json: T | null = null;
  try {
    json = (await res.json()) as T;
  } catch {
    /* 204 בלי גוף */
  }
  return { status: res.status, json };
}

interface RepoInfo { name: string; size: number; pushed_at: string; default_branch: string }
interface TreeEntry { path: string; type: string; size?: number; sha: string }

async function listRepos(): Promise<RepoInfo[]> {
  const r = await gh<Array<Record<string, unknown>>>(`/user/repos?per_page=100&affiliation=owner`);
  if (r.status !== 200 || !r.json) throw new Error(`רשימת ריפואים נכשלה: ${r.status}`);
  return r.json.map((x) => ({
    name: String(x.name),
    size: Number(x.size),
    pushed_at: String(x.pushed_at),
    default_branch: String(x.default_branch || "main"),
  }));
}

/** מלאי בלבד */
async function reposMode(): Promise<void> {
  const repos = await listRepos();
  console.log(`אקוסיסטם ${OWNER}: ${repos.length} ריפואים`);
  for (const r of repos.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${r.name.padEnd(30)} ${(r.size / 1024).toFixed(1).padStart(8)}MB  ${r.pushed_at.slice(0, 10)}  [${r.default_branch}]`);
  }
}

const LOCK_OR_BOILER = /^(package\.json|package-lock\.json|bun\.lock|bun\.lockb|yarn\.lock|pnpm-lock\.yaml|tsconfig\.*)$/i;

/** האם קובץ עץ הוא מועמד ל"קובץ-סטטוס" לפי ההגדרה שלמעלה */
function isStatusCandidate(path: string, size: number | undefined): boolean {
  if (size === undefined || size > 262_144) return false;
  if (path.startsWith("node_modules/") || path.includes("/node_modules/")) return false;
  const base = path.split("/").pop() || "";
  if (LOCK_OR_BOILER.test(base)) return false;
  const depth = path.split("/").length - 1;
  if (/\.md$/i.test(path)) return true;
  if (depth === 0 && /\.(json|yml|yaml|txt)$/i.test(path)) return true;
  return false;
}

interface ScanFile { repo: string; path: string; size: number; sha: string; hash: string }

async function dupScanMode(jsonOut: string): Promise<void> {
  const repos = await listRepos();
  console.log(`מודד שכפול על ${repos.length} ריפואים…`);

  // 1) עצים
  const perRepo = new Map<string, { files: TreeEntry[]; truncated: boolean }>();
  for (const r of repos) {
    const t = await gh<{ tree: TreeEntry[]; truncated: boolean }>(
      `/repos/${OWNER}/${r.name}/git/trees/${r.default_branch}?recursive=1`,
    );
    if (t.status !== 200 || !t.json) {
      console.warn(`  ⚠ ${r.name}: עץ לא נקרא (${t.status}) — דילוג`);
      perRepo.set(r.name, { files: [], truncated: true });
      continue;
    }
    perRepo.set(r.name, {
      files: (t.json.tree || []).filter((e) => e.type === "blob"),
      truncated: !!t.json.truncated,
    });
    if (t.json.truncated) console.warn(`  ⚠ ${r.name}: עץ נחתך (truncated) — מדידה חלקית`);
  }

  // 2) מועמדים + מסנן (בסיס-שם+גודל ב-≥2 ריפואים, או נתיב זהה ב-≥2)
  const byBasename = new Map<string, number>();
  const byPath = new Map<string, number>();
  const candidates: Array<{ repo: string; path: string; size: number; sha: string }> = [];
  for (const [repo, { files }] of perRepo) {
    for (const f of files) {
      if (!isStatusCandidate(f.path, f.size)) continue;
      candidates.push({ repo, path: f.path, size: f.size!, sha: f.sha });
      const base = f.path.split("/").pop() || "";
      byBasename.set(base, (byBasename.get(base) || 0) + 1);
      byPath.set(f.path, (byPath.get(f.path) || 0) + 1);
    }
  }
  const fetchList = candidates.filter((c) => {
    const base = c.path.split("/").pop() || "";
    return (byBasename.get(base) || 0) > 1 || (byPath.get(c.path) || 0) > 1;
  });
  console.log(`קבצי-סטטוס בסך הכל: ${candidates.length}; נמשכים לבדיקת תוכן: ${fetchList.length}`);

  // 3) משיכת blobs + sha256 — במקביל (10 עובדים) + ספירת כשלים וניסיונות חוזרים.
  //    מדידה שמדלגת בשקט על דגימות היא לא מדידה — דוח נכתב רק אם הושלם במלואו.
  const scanned: ScanFile[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let pending = [...fetchList];
  let attempt = 0;
  for (;;) {
    attempt++;
    const queue = [...pending];
    pending = [];
    let done = 0;
    await Promise.all(Array.from({ length: 10 }, () =>
      (async () => {
        for (;;) {
          const c = queue.shift();
          if (!c) return;
          const b = await gh<{ content?: string; encoding?: string }>(
            `/repos/${OWNER}/${c.repo}/git/blobs/${c.sha}`,
          );
          if (b.status === 200 && b.json?.content) {
            const buf = Buffer.from(b.json.content, "base64");
            scanned.push({ ...c, hash: crypto.createHash("sha256").update(buf).digest("hex") });
          } else {
            pending.push(c); // כשל — ינוסה שוב
          }
          done++;
          if (done % 200 === 0) console.error(`  … ${done}/${fetchList.length} (מעבר ${attempt})`);
        }
      })(),
    ));
    if (pending.length === 0) break;
    console.warn(`  ⚠ ${pending.length} קריאות נכשלו (מעבר ${attempt}) — המתנה 15 שניות וניסיון חוזר`);
    if (attempt >= 4) {
      throw new Error(`מדידה לא שלמה: ${pending.length}/${fetchList.length} קבצים לא נקראו אחרי ${attempt} מעברים — הדוח לא ייכתב (דוגמאות: ${pending.slice(0, 3).map((p) => p.repo + ":" + p.path).join(", ")})`);
    }
    await sleep(15_000);
  }

  // 4) קבוצות שכפול (אותו hash ב-≥2 ריפואים)
  const byHash = new Map<string, ScanFile[]>();
  for (const f of scanned) {
    const list = byHash.get(f.hash) || [];
    list.push(f);
    byHash.set(f.hash, list);
  }
  const dupGroups: Array<{ hash: string; files: ScanFile[] }> = [];
  for (const [hash, files] of byHash) {
    const reposSet = new Set(files.map((f) => f.repo));
    if (reposSet.size >= 2) dupGroups.push({ hash, files: files.sort((a, b) => a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path)) });
  }
  dupGroups.sort((a, b) => b.files.length - a.files.length);

  // 5) סטייה — אותו נתיב ב-≥2 ריפואים אבל תוכן שונה (עותקים שהתפצלו)
  const drift = new Map<string, string[]>();
  const pathRepoHash = new Map<string, Map<string, string>>();
  for (const f of scanned) {
    if (!pathRepoHash.has(f.path)) pathRepoHash.set(f.path, new Map());
    pathRepoHash.get(f.path)!.set(f.repo, f.hash);
  }
  for (const [path, m] of pathRepoHash) {
    const hashes = new Set(m.values());
    if (m.size >= 2 && hashes.size >= 2) drift.set(path, [...m.entries()].map(([r, h]) => `${r}:${h.slice(0, 10)}`));
  }

  const totalFiles = scanned.length;
  const dupInstances = dupGroups.reduce((s, g) => s + g.files.length, 0);
  const redundant = dupInstances - dupGroups.length;
  const dup = totalFiles > 0 ? redundant / totalFiles : 0;

  const report = {
    measuredAt: new Date().toISOString(),
    owner: OWNER,
    definition: "status-file: any *.md (any depth) + root *.json/*.yml/*.txt, <=256KB, no locks/boilerplate; dup-group: identical sha256 in >=2 repos; dup = redundant copies / total measured",
    repos: repos.map((r) => ({ name: r.name, kb: r.size, pushed_at: r.pushed_at, truncated: perRepo.get(r.name)?.truncated || false })),
    totals: { statusCandidates: candidates.length, measured: totalFiles, dupGroups: dupGroups.length, dupInstances, redundantCopies: redundant, dupRatio: Number(dup.toFixed(4)) },
    dupGroups: dupGroups.map((g) => ({ hash: g.hash, size: g.files[0].size, files: g.files.map((f) => `${f.repo}:${f.path}`) })),
    driftedSamePath: Object.fromEntries([...drift.entries()].map(([p, v]) => [p, v])),
  };
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));

  console.log(`\n━━━ מדידת שכפול ━━━`);
  console.log(`נמדדו: ${totalFiles} קבצי-סטטוס · קבוצות שכפול: ${dupGroups.length} · עותקים יתרים: ${redundant}`);
  console.log(`dup = ${redundant}/${totalFiles} = ${dup.toFixed(4)}  (יעד: < 0.2)`);
  console.log(`עותקים סוטים (אותו נתיב, תוכן שונה): ${drift.size}`);
  console.log(`\nקבוצות השכפול הגדולות:`);
  for (const g of dupGroups.slice(0, 15)) {
    console.log(`  · [${g.files.length} עותקים, ${g.files[0].size}B]`);
    for (const f of g.files) console.log(`      ${f.repo}:${f.path}`);
  }
  console.log(`\nדוח מלא: ${jsonOut}`);
}

// ─── G6: תוכנית איחוד ───────────────────────────────────────────────
// קנון (דטרמיניסטי, מתועד): 
//   עדיפות ריפו: anchor-baseline (הארכיון) > steem (הצי החי) > אחרים (ASCII)
//   עדיפות נתיב: docs/reports/ > docs/ > broadcasts/ > שורש > אחר
//   קבצים פונקציונליים (components.json/tsconfig.json/download/README.md) — לא נוגעים (בוילרפלייט)
//   steem+Zip — לא נדחסים במעבר זה (steem = ריפו חי עם לב-ענן פעיל; Zip = הבית)
//   התוכן לעולם לא נמחק: הקנוני נשאר + ההיסטוריה בגיט של כל ריפו — רק מוחלף במצביע.

const FUNCTIONAL_EXCLUDE = new Set(["components.json", "tsconfig.json", "download/README.md"]);
const SKIP_REPOS = new Set(["steem", "Zip"]);
// מעבר שני (Task 26): דגל --include-steem פותח את ריפו הצי לאיחוד — הפעם
// המצבתות בכיוון ההפוך (anchor-baseline נשאר הקנון, steem מצביע אליו).
// הצי חי עם לב-ענן משלו — הכלי כבר עמיד לתחרויות (3 ניסיונות + ref טרי).
if (process.argv.includes("--include-steem")) SKIP_REPOS.delete("steem");

function repoPref(repo: string): number {
  if (repo === "anchor-baseline") return 0;
  if (repo === "steem") return 1;
  return 2;
}
function pathPref(p: string): number {
  if (p.startsWith("docs/reports/")) return 0;
  if (p.startsWith("docs/")) return 1;
  if (p.startsWith("broadcasts/")) return 2;
  if (!p.includes("/")) return 3;
  return 4;
}
/** שם "מלוכלך" = ארטיפקט הורדה כפולה (‎-2.md / ‎(2).zip) — הקנון תמיד השם הנקי */
function dirtyName(p: string): boolean {
  return /-(\d+)\.(md|json|yml|yaml|txt)$/i.test(p) || /\(\d+\)\.[a-z0-9]+$/i.test(p);
}

interface GroupFile { repo: string; path: string; size: number; hash: string }
// תוצר-הפלנר בפועל נושא את שדות ה-GroupFile (hash/size) + השדות הקנוניים;
// origHash/origSize אופציונליים — קיימים בתוכניות היסטוריות בלבד (תאימות לאחור בקריאה).
interface PlanChange extends GroupFile {
  canonicalRepo: string; canonicalPath: string; groupIdx: number;
  origHash?: string; origSize?: number;
}

function tombstoneContent(c: PlanChange, groupsTotal: number, before: { measured: number; redundant: number; dupRatio: number }): string {
  return `# אוחד לבית הקנוני — G6

קובץ זה היה עותק-שידור משוכפל (קבוצת שכפול ${c.groupIdx}/${groupsTotal} במדידת האקוסיסטם של 2026-09-14:
${before.measured} קבצי-סטטוס נמדדו, ${before.redundant} עותקים יתרים, dup=${before.dupRatio} — יעד <0.2).
התוכן אוחד לבית הקנוני. אין לשחזר את התוכן לכאן — עדכנו את הקנוני וקשרו אליו.

| שדה | ערך |
|---|---|
| העותק הקנוני | ${OWNER}/${c.canonicalRepo} · ${c.canonicalPath} |
| sha256 העותק שהיה כאן | ${c.origHash} |
| גודל העותק שהיה כאן | ${c.origSize} bytes |
| מיקום העותק שהיה כאן | ${OWNER}/${c.repo} · ${c.path} |
| אוחד | 2026-09-14 · THE WEAVE · weave-ecosystem G6 |

התוכן המלא נשמר בשני מקומות: (א) העותק הקנוני שלעיל; (ב) היסטוריית הגיט של הריפו הזה —
\`git log --oneline -- ${c.path}\` ואז \`git show <commit>:${c.path}\`.

Consolidated by THE WEAVE ecosystem dedup (G6). This pointer is intentional — do not copy content back.
`;
}

async function dupPlanMode(beforePath: string, planPath: string): Promise<void> {
  const report = JSON.parse(fs.readFileSync(beforePath, "utf8")) as {
    totals: { measured: number; redundantCopies: number; dupRatio: number };
    dupGroups: Array<{ hash: string; size: number; files: string[] }>;
  };
  const groups: Array<{ files: GroupFile[] }> = report.dupGroups.map((g) => ({
    files: g.files.map((f) => {
      const i = f.indexOf(":");
      return { repo: f.slice(0, i), path: f.slice(i + 1), size: g.size, hash: g.hash };
    }),
  }));

  const reposNeedingBranch = new Set<string>();
  for (const g of groups) for (const f of g.files) reposNeedingBranch.add(f.repo);

  const branches: Record<string, string> = {};
  for (const repo of reposNeedingBranch) {
    const r = await gh<Record<string, unknown>>(`/repos/${OWNER}/${repo}`);
    branches[repo] = (r.status === 200 && r.json && r.json.default_branch) ? String(r.json.default_branch) : "main";
  }

  const changes: PlanChange[] = [];
  let excludedGroups = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const files = groups[gi].files;
    const bases = new Set(files.map((f) => f.path.split("/").pop() || ""));
    if ([...bases].some((b) => FUNCTIONAL_EXCLUDE.has(b) || FUNCTIONAL_EXCLUDE.has(files[0].path))) { excludedGroups++; continue; }
    // קנון
    const canonical = [...files].sort((a, b) =>
      repoPref(a.repo) - repoPref(b.repo) ||
      pathPref(a.path) - pathPref(b.path) ||
      Number(dirtyName(a.path)) - Number(dirtyName(b.path)) ||
      (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0) ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    )[0];
    for (const f of files) {
      if (f.repo === canonical.repo && f.path === canonical.path) continue;
      if (SKIP_REPOS.has(f.repo)) continue; // steem/Zip — לא נדחסים במעבר זה
      changes.push({ ...f, canonicalRepo: canonical.repo, canonicalPath: canonical.path, groupIdx: gi + 1 });
    }
  }

  const byRepo: Record<string, PlanChange[]> = {};
  for (const c of changes) (byRepo[c.repo] = byRepo[c.repo] || []).push(c);

  const plan = {
    generatedAt: new Date().toISOString(),
    before: report.totals,
    groupsTotal: report.dupGroups.length,
    canonicalRule: "repoPref: anchor-baseline(0) > steem(1) > ASCII(2); pathPref: docs/reports(0) > docs(1) > broadcasts(2) > root(3) > other(4)",
    skippedRepos: [...SKIP_REPOS],
    functionalExcluded: [...FUNCTIONAL_EXCLUDE],
    excludedFunctionalGroups: excludedGroups,
    tombstonesTotal: changes.length,
    repos: Object.fromEntries(
      Object.entries(byRepo).map(([repo, list]) => [repo, { branch: branches[repo], changes: list }]),
    ),
  };
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log(`תוכנית איחוד: ${changes.length} מצבתות ב-${Object.keys(byRepo).length} ריפואים (דולג: ${[...SKIP_REPOS].join(", ")}; ${excludedGroups} קבוצות פונקציונליות לא נוגעות)`);
  for (const [repo, list] of Object.entries(byRepo).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${repo.padEnd(24)} ${list.length} מצבתות [${branches[repo]}]`);
  }
  console.log(`תוכנית: ${planPath}`);
}

// ─── G6: ביצוע (Git Data API — commit אחד לריפו, fast-forward בלבד) ───

async function ghSend(method: string, apiPath: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${pat()}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  let json: Record<string, unknown> | null = null;
  try { json = (await res.json()) as Record<string, unknown>; } catch { /* 204 */ }
  return { status: res.status, json };
}

/** שער-הסודות לפני דחיפה — סריקת התוכן החדש שנכנס לריפו זר */
function secretScan(contents: string[]): void {
  const pats: Array<[string, RegExp]> = [
    ["PEM", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["PAT-in-URL", /x-access-token:/i],
    ["gh-token", /gh[pousr]_[A-Za-z0-9]{20,}/],
    ["WIF", /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/],
    ["mnemonic", /\b(apple|zoo|climate)\b.{20,}\b(monkey|vault|zebra)\b/i],
  ];
  for (const c of contents) for (const [name, re] of pats) if (re.test(c)) throw new Error(`שער-הסודות: תבנית ${name} נתגלתה — דחיפה נחסמת`);
}

async function pushRepoTombstones(repo: string, branch: string, changes: PlanChange[], before: { measured: number; redundant: number; dupRatio: number }, groupsTotal: number): Promise<string> {
  const message = [
    "G6 · איחוד שכפול אקוסיסטם: " + changes.length + " עותקי-שידור הוסבו למצביעים",
    "",
    "מדידת 2026-09-14: " + before.measured + " קבצי-סטטוס · " + before.redundant + " עותקים יתרים · dup=" + before.dupRatio + " (יעד <0.2).",
    "התוכן לא נמחק: העותק הקנוני חי (ראו מצביע) + ההיסטוריה המלאה בגיט של הריפו הזה.",
    "דוח ותוכנית: " + OWNER + "/Zip · SOVEREIGNTY.md (G6) · scripts/weave-ecosystem.ts",
    "",
    "Consolidated by THE WEAVE · weave-ecosystem.ts --dup-fix",
  ].join("\n");

  for (let attempt = 1; attempt <= 3; attempt++) {
    const ref = await gh<Record<string, unknown>>(`/repos/${OWNER}/${repo}/git/ref/heads/${branch}`);
    if (ref.status !== 200 || !ref.json) throw new Error(`${repo}: ref לא נקרא (${ref.status})`);
    const headSha = String((ref.json.object as Record<string, unknown>).sha);
    const headCommit = await gh<Record<string, unknown>>(`/repos/${OWNER}/${repo}/git/commits/${headSha}`);
    if (headCommit.status !== 200 || !headCommit.json) throw new Error(`${repo}: commit ראש לא נקרא`);
    const baseTree = String((headCommit.json.tree as Record<string, unknown>).sha);

    // יצירת blobs במקביל
    const queue = [...changes];
    const treeItems: Array<Record<string, string>> = [];
    await Promise.all(Array.from({ length: 8 }, () => (async () => {
      for (;;) {
        const c = queue.shift();
        if (!c) return;
        const content = tombstoneContent(c, groupsTotal, before);
        const blob = await ghSend("POST", `/repos/${OWNER}/${repo}/git/blobs`, { content, encoding: "utf-8" });
        if (blob.status !== 201) throw new Error(`${repo}: blob לא נוצר (${blob.status}) — ${c.path}`);
        treeItems.push({ path: c.path, mode: "100644", type: "blob", sha: String(blob.json!.sha) });
      }
    })()));

    const tree = await ghSend("POST", `/repos/${OWNER}/${repo}/git/trees`, { base_tree: baseTree, tree: treeItems });
    if (tree.status !== 201) throw new Error(`${repo}: tree לא נוצר (${tree.status})`);
    const commit = await ghSend("POST", `/repos/${OWNER}/${repo}/git/commits`, {
      message,
      tree: String(tree.json!.sha),
      parents: [headSha],
      author: { name: "THE WEAVE · ecosystem", email: "weave-heart@users.noreply.github.com", date: new Date().toISOString() },
    });
    if (commit.status !== 201) throw new Error(`${repo}: commit לא נוצר (${commit.status})`);
    const patch = await ghSend("PATCH", `/repos/${OWNER}/${repo}/git/refs/heads/${branch}`, { sha: String(commit.json!.sha), force: false });
    if (patch.status === 200) return String(commit.json!.sha);
    console.warn(`  ⚠ ${repo}: תחרות בדחיפה (${patch.status}) — ניסיון ${attempt}/3`);
  }
  throw new Error(`${repo}: דחיפה נכשלה לאחר 3 ניסיונות (תחרות)`);
}

async function dupFixMode(planPath: string, dry: boolean): Promise<void> {
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8")) as {
    before: { measured: number; redundantCopies: number; dupRatio: number };
    groupsTotal: number;
    tombstonesTotal: number;
    repos: Record<string, { branch: string; changes: PlanChange[] }>;
  };
  const groupsTotal = plan.groupsTotal;
  const before = { measured: plan.before.measured, redundant: plan.before.redundantCopies, dupRatio: plan.before.dupRatio };

  // שער-הסודות על כל התוכן החדש לפני כל דחיפה
  const allContents: string[] = [];
  for (const [, r] of Object.entries(plan.repos)) for (const c of r.changes) allContents.push(tombstoneContent(c, groupsTotal, before));
  secretScan(allContents);
  console.log(`שער-הסודות: ${allContents.length} תכנים נסרקו — נקי`);

  // סדר: anchor-baseline קודם (הבית הקנוני מתייצב), אח"כ לפי ASCII
  const order = Object.entries(plan.repos).sort(([a], [b]) => (a === "anchor-baseline" ? -1 : b === "anchor-baseline" ? 1 : a < b ? -1 : 1));
  const results: Array<{ repo: string; commit: string | null; changes: number }> = [];
  for (const [repo, r] of order) {
    if (dry) { console.log(`  [dry] ${repo}: ${r.changes.length} מצבתות — לא בוצע`); results.push({ repo, commit: null, changes: r.changes.length }); continue; }
    const sha = await pushRepoTombstones(repo, r.branch, r.changes, before, groupsTotal);
    console.log(`  ✓ ${repo}: ${r.changes.length} מצבתות ← commit ${sha.slice(0, 10)}`);
    results.push({ repo, commit: sha, changes: r.changes.length });
  }
  if (!dry) {
    fs.writeFileSync("tool-results/ecosystem-dup-fix.json", JSON.stringify({ executedAt: new Date().toISOString(), results }, null, 2));
    console.log(`דוח ביצוע: tool-results/ecosystem-dup-fix.json`);
  }
}

// ─── G6: אימות בספר (אחרי מדידה חוזרת) ───────────────────────────────

async function attestG6Mode(beforePath: string, afterPath: string): Promise<void> {
  const before = JSON.parse(fs.readFileSync(beforePath, "utf8")) as { totals: Record<string, number> };
  const after = JSON.parse(fs.readFileSync(afterPath, "utf8")) as { totals: Record<string, number> };
  const fix = fs.existsSync("tool-results/ecosystem-dup-fix.json")
    ? JSON.parse(fs.readFileSync("tool-results/ecosystem-dup-fix.json", "utf8"))
    : null;
  if (after.totals.dupRatio >= 0.2) throw new Error(`היעד לא הושג: dup=${after.totals.dupRatio} ≥ 0.2 — אין לאשר`);

  const auditor = await db.agent.findUnique({ where: { name: "weave-auditor" } });
  if (!auditor || !auditor.devKeyHex) throw new Error("weave-auditor חסר מפתח מקומי — הרץ בסנדבוקס הראשי");

  const tB = before.totals, tA = after.totals;
  const claim = `איחוד האקוסיסטם (G6) נמדד ונסגר: dup ${tB.dupRatio}→${tA.dupRatio} (יעד <0.2) — ${tB.redundantCopies - tA.redundantCopies} עותקי-שידור הוסבו למצביעים`;
  const evidence = [
    `before: measured=${tB.measured} groups=${tB.dupGroups} redundant=${tB.redundantCopies} dup=${tB.dupRatio}`,
    `after: measured=${tA.measured} groups=${tA.dupGroups} redundant=${tA.redundantCopies} dup=${tA.dupRatio}`,
    `method: מצביעים (tombstones) — התוכן לא נמחק: הקנוני ב-anchor-baseline/steem + ההיסטוריה בגיט של כל ריפו`,
    `canonical: anchor-baseline(ארכיון) > steem(צי חי) > ASCII; נתיב: docs/reports > docs > broadcasts > root`,
    `skipped: steem (ריפו חי עם לב-ענן פעיל — מעבר נפרד), Zip (הבית)`,
    `functional excluded: components.json/tsconfig.json/download/README.md (בוילרפלייט)`,
    fix ? `commits: ${fix.results.filter((r: { commit: string | null }) => r.commit).map((r: { repo: string; commit: string | null; changes: number }) => `${r.repo}@${r.commit!.slice(0, 10)}(${r.changes})`).join(" ")}` : "commits: (לא נמצא דוח ביצוע)",
    `reports: tool-results/ecosystem-dup-before.json · ecosystem-dup-after.json · ecosystem-dup-fix.json`,
    `drifted (אותו נתיב, תוכן שונה): לא נוגע — אמת מפוצלת דורשת שיפוט אנושי, לא מכני`,
  ].join(" · ");

  const appended = await appendAttestation({ agentId: auditor.id, claim, claimType: "AUDIT", evidence });
  console.log(`[G6] אימות seq=${appended.seq} · entry=${appended.entryHash.slice(0, 18)}…`);
  const cp = await createCheckpointNow();
  if (cp) console.log(`[G6] checkpoint #${cp.index} · root=${cp.root.slice(0, 18)}…`);
  else console.log("[G6] אין אימותים טריים ל-checkpoint");
}

// ─── CLI ───
const args = process.argv.slice(2);
const jsonIdx = args.indexOf("--json");
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : "tool-results/ecosystem-dup.json";

function run(): void {
  const p = (err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); };
  if (args.includes("--repos")) { reposMode().catch(p); }
  else if (args.includes("--dup-scan")) { fs.mkdirSync("tool-results", { recursive: true }); dupScanMode(jsonOut).catch(p); }
  else if (args.includes("--dup-plan")) {
    const planOut = args.includes("--plan") ? args[args.indexOf("--plan") + 1] : "tool-results/ecosystem-dup-plan.json";
    dupPlanMode(jsonOut, planOut).catch(p);
  }
  else if (args.includes("--dup-fix")) {
    const planIn = args.includes("--plan") ? args[args.indexOf("--plan") + 1] : "tool-results/ecosystem-dup-plan.json";
    dupFixMode(planIn, args.includes("--dry")).catch(p);
  }
  else if (args.includes("--attest-g6")) {
    const beforePath = args.includes("--before") ? args[args.indexOf("--before") + 1] : "tool-results/ecosystem-dup-before.json";
    const afterPath = args.includes("--after") ? args[args.indexOf("--after") + 1] : "tool-results/ecosystem-dup-after.json";
    attestG6Mode(beforePath, afterPath).catch(p);
  }
  else {
    console.log("שימוש: --repos | --dup-scan [--json PATH] | --dup-plan --json BEFORE [--plan OUT] | --dup-fix [--plan PATH] [--dry] | --attest-g6 [--before PATH] [--after PATH]");
  }
}
run();
