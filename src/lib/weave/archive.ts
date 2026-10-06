// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Archive Witness — עד הארכיון: ההיסטוריה הכתובה של הרשת
// נמדדת חיה ומעידה בספר
//
// הדוקטרינה (SOVEREIGNTY §12 — משפחת עוגן-העוגנים): ריפו
// roshpinacare-sys/anchor-baseline מחזיק את ההיסטוריה הכתובה של הרשת
// (דוחות/broadcasts של הצי). הגזירה החד-פעמית (scripts/anchor-baseline.ts,
// att 9) אטמה אותו פעם אחת — ארכיון. כאן אנו נותנים לו חיים חוזרים:
//
//   בכל פעימה (§5.7): tarball חי מהמקור ⇒ sha256(קובץ) ⇒
//   עלה = keccak256("path:sha256") ⇒ שורש מרקל ⇒ דה-דופליקציה לפי
//   שורש (חוצת-סוגי-אימותים — גם ה-AUDIT החד-פעמי נספר) ⇒ אימות
//   CROSSCHAIN חתום ⇒ checkpoint מכסה ⇒ העוגנים (Steem/Hive :20 ·
//   ZERO :30) מעידים עליו החוצה ב-$0.
//
// משמעת המדידה (זהה לשאר קווי הרשת):
//   · fail-closed — אין גישה לריפו ⇒ REFUSED כנה, לא נכתבת עדות
//     (הענן: GITHUB_TOKEN מוגבל לריפו זה בלבד והארכיון פרטי — עד
//     החלטת מפעיל להוסיף WEAVE_ARCHIVE_TOKEN כסוד קריאה-בלבד)
//   · אותו שורש = אותה עדות — דילוג כנה, גם אם העדות הקודמת היתה
//     AUDIT חד-פעמי של weave-auditor
//   · הראייה היא המדידה עצמה (ה-tarball, ההאשים, השורש) — כל צד
//     שלישי יכול לחזור עליה מכל clone של הארכיון
//   · אותו hash-plan קנוני בדיוק כמו הגזירה החד-פעמית — שורש לאותו
//     commit משוחזר זהה (הוכחת נאמנות ההעברה)
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import * as crypto from "crypto";
import { keccak256, toUtf8Bytes } from "ethers";
import { db } from "@/lib/db";
import { appendAttestation } from "./ledger";
import { ensureDaemonAgent } from "./daemons";
import { merkleRoot } from "./merkle";

export const ARCHIVE_REPO = "roshpinacare-sys/anchor-baseline";
const REPO = ARCHIVE_REPO;
const BRANCH = "main";
const ROOT_DIR = process.cwd();
const LEAVES_PATH = path.join(ROOT_DIR, "sovereign", "anchor-baseline.leaves.json");
const DERIVE_CACHE_TTL_MS = 60_000;

export const ARCHIVE_HASH_PLAN = 'sha256(file) → keccak256("path:sha256") → merkle-keccak256';

/** שגיאת ארכיון עם קוד HTTP צפוי — ההודעה בעברית ומיועדת ללקוח */
export class ArchiveError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ArchiveError";
    this.status = status;
  }
}

// ── משמרת הגישה לריפו הפרטי ────────────────────────────────────────
// סדר המועמדים: WEAVE_ARCHIVE_TOKEN (סוד ענן, החלטת מפעיל — קריאה
// בלבד) → GITHUB_TOKEN (ענן, מוגבל לריפו זה) → upload/pat.env
// (ה-runner הראשי בלבד; אף פעם לא מיוצא ולא בגיט).

function tokenCandidates(): Array<{ source: string; token: string }> {
  const out: Array<{ source: string; token: string }> = [];
  const envArchive = process.env.WEAVE_ARCHIVE_TOKEN?.trim();
  if (envArchive) out.push({ source: "WEAVE_ARCHIVE_TOKEN", token: envArchive });
  const envGh = process.env.GITHUB_TOKEN?.trim();
  if (envGh) out.push({ source: "GITHUB_TOKEN", token: envGh });
  try {
    const t = fs.readFileSync(path.join(ROOT_DIR, "upload", "pat.env"), "utf8").trim();
    if (t) out.push({ source: "upload/pat.env", token: t });
  } catch {
    /* ה-runner הראשי בלבד */
  }
  return out;
}

function sha256File(p: string): string {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return "0x" + h.digest("hex");
}

interface Leaf {
  path: string;
  sha256: string;
  leaf: string;
  bytes: number;
}

/** הגזירה מה-tarball — אותה תוכנית-האש קנונית של הגזירה החד-פעמית */
function deriveFromDir(srcDir: string): { files: Leaf[]; totalBytes: number; root: string } {
  const files: Leaf[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else if (entry.isFile()) {
        const sha = sha256File(abs);
        const leaf = "0x" + keccak256(toUtf8Bytes(`${relPath}:${sha}`)).slice(2);
        files.push({ path: relPath, sha256: sha, leaf, bytes: fs.statSync(abs).size });
      }
    }
  };
  walk(srcDir, "");
  files.sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
  const root = merkleRoot(files.map((f) => f.leaf));
  return { files, totalBytes, root };
}

export interface ArchiveSnapshot {
  repo: string;
  branch: string;
  commit: string;
  pushedAt: string | null;
  fileCount: number;
  totalBytes: number;
  root: string;
  derivedAt: string;
  tokenSource: string;
}

let deriveCache: { at: number; data: { snapshot: ArchiveSnapshot; leaves: Leaf[] } } | null = null;

/**
 * המדידה החיה: tarball מהמקור ⇒ שורש מרקל.
 * `ref` — ברירת מחדל ראש הענף; אפשר לנעוץ commit (הוכחת שחזור).
 * רק הגזירה של ראש הענף מטומננת — נעיצת commit היא מדידה חד-פעמית.
 */
export async function deriveArchiveSnapshot(
  opts: { ref?: string; force?: boolean } = {}
): Promise<{ snapshot: ArchiveSnapshot; leaves: Leaf[] }> {
  const pinned = opts.ref;
  if (!pinned && !opts.force && deriveCache && Date.now() - deriveCache.at < DERIVE_CACHE_TTL_MS) {
    return deriveCache.data;
  }

  const candidates = tokenCandidates();
  if (candidates.length === 0) {
    throw new ArchiveError(
      "אין מקור גישה לארכיון — נדרש WEAVE_ARCHIVE_TOKEN (ענן) או upload/pat.env (runner ראשי); הריפו פרטי",
      503
    );
  }

  // 1. מטא-דאטה + ה-commit שממנו נגזר השורש — הטוקן הראשון שמצליח
  let meta: { default_branch: string; pushed_at: string | null } | null = null;
  let token = "";
  let tokenSource = "";
  for (const cand of candidates) {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Authorization: `Bearer ${cand.token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 200) {
      const j = (await res.json()) as { default_branch?: string; pushed_at?: string };
      meta = {
        default_branch: j.default_branch ?? BRANCH,
        pushed_at: j.pushed_at ?? null,
      };
      token = cand.token;
      tokenSource = cand.source;
      break;
    }
  }
  if (!meta) {
    throw new ArchiveError(
      "אף מקור גישה לא הצליח לקרוא את הארכיון (401/404 מה-API) — הריפו פרטי והטוקנים שבסביבה אינם מורשים לו; REFUSED כנה",
      503
    );
  }
  const branch = pinned ? BRANCH : meta.default_branch;
  const ref = pinned ?? branch;

  // 2. ה-commit של ה-ref (מזהה המדידה — בלעדיו אין עדות)
  const commitRes = await fetch(`https://api.github.com/repos/${REPO}/commits/${ref}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (commitRes.status !== 200) {
    throw new ArchiveError(`קריאת ה-commit של הארכיון נכשלה (${commitRes.status}) — אין מזהה מדידה`, 503);
  }
  const commitJson = (await commitRes.json()) as { sha?: string };
  const commit = commitJson.sha;
  if (!commit) {
    throw new ArchiveError("ה-API לא החזיר commit sha — אין מזהה מדידה", 503);
  }

  // 3. ה-tarball והחילוץ — לספרייה זמנית נקייה מהגיט
  const tarRes = await fetch(`https://api.github.com/repos/${REPO}/tarball/${ref}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(90_000),
  });
  if (tarRes.status !== 200) {
    throw new ArchiveError(`הורדת ה-tarball של הארכיון נכשלה (${tarRes.status})`, 503);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-archive-"));
  try {
    const tarPath = path.join(tmpDir, "snapshot.tar.gz");
    fs.writeFileSync(tarPath, Buffer.from(await tarRes.arrayBuffer()));
    await new Promise<void>((resolve, reject) => {
      execFile("tar", ["-xzf", tarPath, "-C", tmpDir], { timeout: 60_000 }, (err) =>
        err ? reject(new ArchiveError(`חילוץ ה-tarball נכשל: ${err.message}`)) : resolve()
      );
    });
    const extracted = fs
      .readdirSync(tmpDir)
      .filter((d) => d.startsWith("roshpinacare-sys-anchor-baseline"))
      .map((d) => path.join(tmpDir, d));
    if (extracted.length === 0) {
      throw new ArchiveError("החילוץ לא הניב תיקייה — מבנה ה-tarball אינו צפוי");
    }
    const { files, totalBytes, root } = deriveFromDir(extracted[0]);

    const snapshot: ArchiveSnapshot = {
      repo: REPO,
      branch,
      commit,
      pushedAt: pinned ? null : meta.pushed_at,
      fileCount: files.length,
      totalBytes,
      root,
      derivedAt: new Date().toISOString(),
      tokenSource,
    };
    const data = { snapshot, leaves: files };
    if (!pinned) deriveCache = { at: Date.now(), data };
    return data;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** זהות עד הארכיון — DAEMON נגזר-seal, self-heal כמו כל עדי הרשת */
export async function ensureArchiveWitness(): Promise<{
  id: string;
  name: string;
  ethAddress: string;
}> {
  return ensureDaemonAgent("weave-archive-witness", "DAEMON");
}

export type ArchiveWitnessStatus = "ATTESTED" | "SKIPPED" | "REFUSED";

export interface ArchiveWitnessResult {
  status: ArchiveWitnessStatus;
  reason: string;
  attSeq: number | null;
  snapshot: {
    repo: string;
    commit: string;
    fileCount: number;
    totalBytes: number;
    root: string;
  } | null;
}

/**
 * ההצלבה עצמה — מדידה ⇒ דה-דופליקציה ⇒ אימות CROSSCHAIN חתום.
 *
 * REFUSED  — אין גישה למקור / המדידה נכשלה (fail-closed; לא נכתבת עדות).
 * SKIPPED  — השורש כבר מעיד בספר (גם AUDIT חד-פעמי ותיק נספר) — דילוג כנה.
 * ATTESTED — עדות חדשה נכתבה + חומר ההוכא (עלים) נשמר; ה-checkpoint
 *            והייצוא באחריות הקורא (סולם ההוכחות).
 */
export async function witnessArchive(): Promise<ArchiveWitnessResult> {
  // 1. המדידה — הטרחה הכבדה של הרשת: מדידה חיה מהמקור, לא מהמטמון שלנו
  let measured: { snapshot: ArchiveSnapshot; leaves: Leaf[] };
  try {
    measured = await deriveArchiveSnapshot({ force: true });
  } catch (err) {
    return {
      status: "REFUSED",
      reason: err instanceof Error ? err.message : String(err),
      attSeq: null,
      snapshot: null,
    };
  }
  const { snapshot, leaves } = measured;
  const snapBrief = {
    repo: snapshot.repo,
    commit: snapshot.commit,
    fileCount: snapshot.fileCount,
    totalBytes: snapshot.totalBytes,
    root: snapshot.root,
  };

  // 2. דה-דופליקציה חוצת-סוגים — אותו שורש = אותה עדות, ולו מה-AUDIT הוותיק
  const prior = await db.attestation.findFirst({
    where: { evidence: { contains: snapshot.root } },
    orderBy: { seq: "desc" },
  });
  if (prior) {
    return {
      status: "SKIPPED",
      reason: `שורש זה כבר מעיד בספר (att ${prior.seq}, ${prior.claimType}) — הארכיון לא השתנה מאז; דילוג כנה`,
      attSeq: prior.seq,
      snapshot: snapBrief,
    };
  }

  // 3. העדות — טענה בעברית + ראיה קנונית (הכל ניתן לחישוב-מחדש מהמקור)
  const claim =
    `עד הארכיון: ההיסטוריה הכתובה של הרשת (${REPO}) נמדדה חיה מהמקור — ` +
    `${snapshot.fileCount} קבצים, ${(snapshot.totalBytes / 1024).toFixed(0)}KB — ` +
    `והספר מעיד על שורש …${snapshot.root.slice(-8)}.`;
  const evidence = [
    `archive=${REPO}`,
    `commit=${snapshot.commit}`,
    `branch=${snapshot.branch}`,
    `pushed=${snapshot.pushedAt ?? "null"}`,
    `files=${snapshot.fileCount}`,
    `bytes=${snapshot.totalBytes}`,
    `archiveRoot=${snapshot.root}`,
    `hashPlan: ${ARCHIVE_HASH_PLAN}`,
    `leaves=sovereign/anchor-baseline.leaves.json (חומר הוכחה מלא, נכתב עם העדות)`,
    `measuredBy=weave-archive-witness (live tarball derivation, token source: ${snapshot.tokenSource})`,
    `at=${new Date().toISOString()}`,
  ].join(" · ");

  const witness = await ensureArchiveWitness();
  const att = await appendAttestation({
    agentId: witness.id,
    claim,
    claimType: "CROSSCHAIN",
    evidence,
  });

  // 4. חומר ההוכחה — העלים נשמרים בגיט יחד עם העדות (אותו פורמט v1)
  try {
    fs.mkdirSync(path.dirname(LEAVES_PATH), { recursive: true });
    fs.writeFileSync(
      LEAVES_PATH,
      JSON.stringify(
        {
          format: "weave-anchor-baseline-leaves-v1",
          derivedAt: snapshot.derivedAt,
          source: { repo: REPO, branch: snapshot.branch, commit: snapshot.commit, pushedAt: snapshot.pushedAt },
          hashPlan: {
            fileHash: "sha256",
            leaf: 'keccak256("path:sha256")',
            tree: "merkle-keccak256 (מרקל של הרשת, זוגות ממוינים)",
          },
          fileCount: snapshot.fileCount,
          totalBytes: snapshot.totalBytes,
          root: snapshot.root,
          leaves,
        },
        null,
        2
      ) + "\n"
    );
  } catch {
    // העלים לא נכתבו — העדות כבר בספר; הפעימה הבאה תשלים. לא פטאלי.
  }

  return {
    status: "ATTESTED",
    reason: "העדות נכתבה וחתומה; ה-checkpoint יכסה והעוגנים יעידו (Steem/Hive + ZERO, ב-$0)",
    attSeq: att.seq,
    snapshot: snapBrief,
  };
}

/** אינדקס התצוגה — עדות הארכיון האחרונה של העד המחזר */
export async function lastArchiveWitness(): Promise<{
  attSeq: number;
  root: string | null;
  commit: string | null;
  fileCount: number | null;
  totalBytes: number | null;
  at: string;
} | null> {
  const witness = await db.agent.findUnique({ where: { name: "weave-archive-witness" } });
  if (!witness) return null;
  const last = await db.attestation.findFirst({
    where: { agentId: witness.id },
    orderBy: { seq: "desc" },
  });
  if (!last) return null;
  const field = (key: string): string | null => {
    const m = last.evidence.match(new RegExp(`${key}=([^ ·]+)`));
    return m ? m[1] : null;
  };
  return {
    attSeq: last.seq,
    root: field("archiveRoot"),
    commit: field("commit"),
    fileCount: field("files") ? Number(field("files")) : null,
    totalBytes: field("bytes") ? Number(field("bytes")) : null,
    at: last.createdAt.toISOString(),
  };
}
