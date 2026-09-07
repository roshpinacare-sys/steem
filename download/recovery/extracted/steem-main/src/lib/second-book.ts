/**
 * second-book — 107: הספר-השני-חי (אימוץ-מושכל מהסוכן-השני, שהפוך: הוא מראה אותנו,
 * אנחנו מראים אותו — קריאה-בלבד בשני-הכיוונים).
 * ────────────────────────────────────────────────────────────────────────────
 * המפעיל שאל: "בהשוואה לסוכן-השני — למה אתה מציג כמות-טרנזקציות שונה? האם
 * אנחנו על אותה רשת?" — התשובה חייבת להיות נגזרת-חי-על-הדף, לא תשובה-טקסטואלית.
 *
 * איך: מראה-קריאה-בלבד ב-.steem-engeiner-live (gitignored, בתוך-הפרויקט — אותו
 * לקח-מדוד שלו: /tmp בלתי-נראה-בין-מרחבי-שמות) — שיבוט-רדוד-דליל (--depth 1
 * --filter=blob:none --sparse) שמוריד רק את state.json שלו מה-HEAD של הריפו
 * dudududi144-source/steem-engeiner. רענון-מטמון 90 שנ׳ · כל-כשל → null בכנות.
 *
 * חוק-הברזל: אף-בית-לא-נכתב-אצלו — git fetch על-המראה-המקומית-שלנו-בלבד.
 */

import { execFile, execFileSync } from "child_process";
import fs from "fs";
import path from "path";

export interface SecondBookLive {
  ok: boolean;
  via: "git-mirror" | "none";
  commit: string | null;
  commitAt: string | null;
  fetchedAt: string;
  /** 107: גיל-הצילום-שאנחנו-מציגים — להצגה-כנה-במסך (שקר-טריות אסור) */
  snapshotAgeSec: number | null;
  state: {
    height: number | null;
    stateRoot: string | null;
    lastBlockHash: string | null;
    genesisHash: string | null;
    netVersion: string | null;
    updatedAt: string | null;
  } | null;
  error?: string;
}

const MIRROR = path.join(process.cwd(), ".steem-engeiner-live");
/* 90 שנ׳ — הלקח-המדוד שלו (W19): TTL ארוך = סתירה-בין-פאנלים בלתי-נראית */
const TTL_MS = 90 * 1000;
const RETRY_MS = 90 * 1000;

let cache: { at: number; data: SecondBookLive } | null = null;
let lastFail: { at: number } | null = null;
let inFlight: Promise<SecondBookLive> | null = null;

function sh(file: string, args: string[], timeoutMs: number, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout ?? ""));
    });
  });
}

/** כתובת-הריפו-שלו: מה-remote שלנו נגזרת הכתובת-הבסיסית, ואז שם-הריפו-שלו */
function hisCloneUrl(): string {
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      timeout: 10_000,
      encoding: "utf8",
    }).trim();
    const m = url.match(/^(https:\/\/[^@]+@github\.com\/)dudududi144-source\/steem(\.git)?$/);
    if (m) return `${m[1]}dudududi144-source/steem-engeiner.git`;
  } catch {
    /* fallback below */
  }
  // fallback — אותו-token: קוראים-את-ה-token מה-remote ומרכיבים-ידנית
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      timeout: 10_000,
      encoding: "utf8",
    }).trim();
    const m = url.match(/^(https:\/\/x-access-token:[^@]+@github\.com\/)/);
    if (m) return `${m[1]}dudududi144-source/steem-engeiner.git`;
  } catch {
    /* אין-remote — כנות */
  }
  return "";
}

async function ensureMirror(): Promise<{ ok: boolean; error?: string }> {
  const gitDir = path.join(MIRROR, ".git");
  if (!fs.existsSync(gitDir)) {
    try {
      fs.rmSync(MIRROR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    const url = hisCloneUrl();
    if (!url) return { ok: false, error: "cannot-resolve-his-clone-url" };
    try {
      await sh("git", ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", url, MIRROR], 60_000);
      await sh(
        "git",
        ["sparse-checkout", "set", "--no-cone", "/sovereign/node/state.json"],
        30_000,
        MIRROR
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 140) };
    }
  }
  try {
    await sh("git", ["fetch", "--quiet", "origin"], 30_000, MIRROR);
    await sh("git", ["reset", "--quiet", "--hard", "origin/HEAD"], 15_000, MIRROR);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 140) };
  }
}

function headOf(mirrorPath: string): { commit: string | null; commitAt: string | null } {
  try {
    const gitDir = path.join(mirrorPath, ".git");
    const headFile = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const refMatch = headFile.match(/^ref: (.+)$/);
    const ref = refMatch ? refMatch[1] : null;
    const commit = ref
      ? fs.readFileSync(path.join(gitDir, ref), "utf8").trim()
      : headFile;
    let commitAt: string | null = null;
    try {
      const raw = execFileSync("git", ["log", "-1", "--format=%cI"], {
        cwd: mirrorPath,
        timeout: 10_000,
        encoding: "utf8",
      }).trim();
      commitAt = raw || null;
    } catch {
      commitAt = null;
    }
    return { commit: commit || null, commitAt };
  } catch {
    return { commit: null, commitAt: null };
  }
}

function readMirrorState(): SecondBookLive["state"] {
  try {
    const raw = fs.readFileSync(path.join(MIRROR, "sovereign", "node", "state.json"), "utf8");
    const st = JSON.parse(raw) as Record<string, any>;
    return {
      height: Number.isFinite(Number(st.height)) ? Number(st.height) : null,
      stateRoot: typeof st.stateRoot === "string" ? st.stateRoot : null,
      lastBlockHash: typeof st.lastBlockHash === "string" ? st.lastBlockHash : null,
      genesisHash: typeof st.genesisHash === "string" ? st.genesisHash : null,
      netVersion: typeof st.netVersion === "string" ? st.netVersion : null,
      updatedAt: typeof st.updatedAt === "string" ? st.updatedAt : null,
    };
  } catch {
    return null;
  }
}

export async function getSecondBook(): Promise<SecondBookLive> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.data;
  if (lastFail && now - lastFail.at < RETRY_MS) {
    return { ok: false, via: "none", commit: null, commitAt: null, fetchedAt: new Date(lastFail.at).toISOString(), snapshotAgeSec: null, state: null };
  }
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<SecondBookLive> => {
    const mirror = await ensureMirror();
    if (!mirror.ok) {
      lastFail = { at: Date.now() };
      return {
        ok: false,
        via: "none",
        commit: null,
        commitAt: null,
        fetchedAt: new Date().toISOString(),
        snapshotAgeSec: null,
        state: null,
        error: mirror.error,
      };
    }
    const { commit, commitAt } = headOf(MIRROR);
    const state = readMirrorState();
    const data: SecondBookLive = {
      ok: !!state,
      via: "git-mirror",
      commit,
      commitAt,
      fetchedAt: new Date().toISOString(),
      snapshotAgeSec: null,
      state,
    };
    cache = { at: Date.now(), data };
    lastFail = null;
    return data;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** גיל-הצילום בשניות (מ-fetchedAt) — נגזר-חי-לכל-קריאה */
export function withSnapshotAge(book: SecondBookLive): SecondBookLive {
  try {
    const at = new Date(book.fetchedAt).getTime();
    if (Number.isFinite(at)) return { ...book, snapshotAgeSec: Math.max(0, Math.round((Date.now() - at) / 1000)) };
  } catch {
    /* כנות */
  }
  return book;
}
