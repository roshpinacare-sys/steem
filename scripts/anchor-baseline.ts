#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · anchor-baseline — גזירה מהעוגנים: הארכיון המת נארג
//
// המשתמש שאל: "האם העוגנים יכולים לתרום ומה הם נותנים, ואפשר להסיק
// מהם יותר?" — התשובה המהונדסת: ריפו anchor-baseline מחזיק את ההיסטוריה
// הכתובה של הרשת (90 קבצי דוחות/broadcasts) אבל הוא "מת" — אף חוק
// לא מוכיח את שלמותו. כאן אנו נותנים לו חיים נצחיים:
//
//   כל קובץ ⇒ sha256 · עלה = keccak256("path:sha256") · שורש מרקל אחד
//   ⇒ נרשם בספר כאימות AUDIT חתום ⇒ checkpoint חדש נושא את השורש
//   ⇒ העלים נשמרים ב-sovereign/anchor-baseline.leaves.json (חומר הוכחה)
//
// מרגע זה: כל שינוי של בית בארכיון ניתן לאיתור ע"י חישוב-מחדש —
// הארכיון עטוף בשרשרת האמת.
// ─────────────────────────────────────────────────────────────────────

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ethers } from "ethers";
import { db } from "@/lib/db";
import { appendAttestation } from "@/lib/weave/ledger";
import { createCheckpointNow } from "@/lib/weave/beat";
import { merkleRoot } from "@/lib/weave/merkle";

const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "sovereign", "anchor-baseline.leaves.json");
const REPO = "roshpinacare-sys/anchor-baseline";
const TMP = path.join(ROOT, "sovereign-net", "anchor-baseline-snapshot");

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function token(): string {
  // מקומי בלבד: upload/pat.env (אף פעם לא מיוצא). בענן: GITHUB_TOKEN.
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const p = path.join(ROOT, "upload", "pat.env");
  return fs.readFileSync(p, "utf8").trim();
}

function sha256File(p: string): string {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return "0x" + h.digest("hex");
}

async function main(): Promise<void> {
  const t = token();
  const api = (url: string) =>
    JSON.parse(execSync(`curl -s -H "Authorization: Bearer ${t}" "${url}"`, { encoding: "utf8", timeout: 60_000 }).toString());

  // 1. מטא-דאטה של הריפו + ה-commit שממנו נגזר השורש
  const repoMeta = api(`https://api.github.com/repos/${REPO}`);
  const branch = repoMeta.default_branch ?? "main";
  const commit = api(`https://api.github.com/repos/${REPO}/commits/${branch}`);
  const commitSha = commit.sha as string;
  console.log(`[anchor-baseline] מקור: ${REPO}@${commitSha.slice(0, 10)} (branch ${branch})`);

  // 2. הורדת ה-tarball וחילוץ
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const tarPath = path.join(TMP, "snapshot.tar.gz");
  execSync(
    `curl -sL -H "Authorization: Bearer ${t}" "https://api.github.com/repos/${REPO}/tarball/${branch}" -o "${tarPath}"`,
    { timeout: 180_000 }
  );
  execSync(`tar -xzf "${tarPath}" -C "${TMP}"`, { timeout: 60_000 });
  const extracted = fs
    .readdirSync(TMP)
    .filter((d) => d.startsWith("roshpinacare-sys-anchor-baseline"))
    .map((d) => path.join(TMP, d));
  if (extracted.length === 0) throw new Error("החילוץ לא הניב תיקייה");
  const srcDir = extracted[0];

  // 3. כל הקבצים ⇒ sha256 ⇒ עלה קנוני keccak256("path:sha256")
  const files: Array<{ path: string; sha256: string; leaf: string; bytes: number }> = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else if (entry.isFile()) {
        const sha = sha256File(abs);
        const leaf = "0x" + ethers.keccak256(ethers.toUtf8Bytes(`${relPath}:${sha}`)).slice(2);
        files.push({ path: relPath, sha256: sha, leaf, bytes: fs.statSync(abs).size });
      }
    }
  };
  walk(srcDir, "");
  files.sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
  const root = merkleRoot(files.map((f) => f.leaf));
  console.log(`[anchor-baseline] ${files.length} קבצים · ${totalBytes} בייטים · root=${root}`);

  // 4. שמירת חומר ההוכחה (עלים + מקור)
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        format: "weave-anchor-baseline-leaves-v1",
        derivedAt: new Date().toISOString(),
        source: { repo: REPO, branch, commit: commitSha, pushedAt: repoMeta.pushed_at },
        hashPlan: {
          fileHash: "sha256",
          leaf: 'keccak256("path:sha256")',
          tree: "merkle-keccak256 (מרקל של הרשת, זוגות ממוינים)",
        },
        fileCount: files.length,
        totalBytes,
        root,
        leaves: files,
      },
      null,
      2
    ) + "\n"
  );

  // 5. רישום בספר — AUDIT חתום ע"י weave-auditor
  const auditor = await db.agent.findUnique({ where: { name: "weave-auditor" } });
  if (!auditor || !auditor.devKeyHex) {
    throw new Error("weave-auditor חסר מפתח מקומי — הרץ בסנדבוקס הראשי");
  }
  const claim =
    `ארכיון anchor-baseline נגרר לשורש מרקל: ${files.length} קבצים, ` +
    `${(totalBytes / 1024).toFixed(0)}KB — ההיסטוריה הכתובה של הרשת נאטמה בספר`;
  const evidence = [
    `source=${REPO}@${commitSha.slice(0, 10)} (branch ${branch}, pushed ${repoMeta.pushed_at})`,
    `files=${files.length}`,
    `bytes=${totalBytes}`,
    `merkleRoot=${root}`,
    `hashPlan: sha256(file) → keccak256("path:sha256") → merkle-keccak256`,
    `leaves=sovereign/anchor-baseline.leaves.json (${files.length} עלים, חומר הוכחה מלא)`,
    `sample: ${files[0].path} sha256=${files[0].sha256.slice(0, 18)}…`,
    `verification: חישוב-מחדש של כל עלה והשורש משחזר ${root} בדיוק`,
  ].join(" · ");

  const appended = await appendAttestation({
    agentId: auditor.id,
    claim,
    claimType: "AUDIT",
    evidence,
  });
  console.log(`[anchor-baseline] אימות seq=${appended.seq} · entry=${appended.entryHash.slice(0, 18)}…`);

  // 6. Checkpoint נושא את השורש (יחד עם אימותים טריים אחרים אם יש)
  const cp = await createCheckpointNow();
  if (cp) {
    console.log(`[anchor-baseline] checkpoint #${cp.index} · root=${cp.root.slice(0, 18)}…`);
  } else {
    console.log("[anchor-baseline] אין אימותים טריים ל-checkpoint — כבר כוסה");
  }

  // 7. ניקוי ה-tarball הזמני (העלים נשמרו; המקור חי בריפו שלו)
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("[anchor-baseline] הושלם — הארכיון נארג לספר");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ANCHOR-BASELINE-ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
