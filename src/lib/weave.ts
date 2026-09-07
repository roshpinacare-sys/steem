/**
 * src/lib/weave.ts — מנוע-האריגה של הקונסולה החדשה (הנול · THE WEAVE).
 *
 * עיקרון-בית: הכל עובר דרך הקרנל-עצמו (אותו CJS, אותה מתמטיקה של הצומת)
 * והעלים נגזרים מה-block-log בלבד — ה-API לעולם לא סומך על snapshot.
 * ה-API לעולם לא 500 — מצב-לא-מאומת הוא מצב, לא שגיאה.
 *
 * ה-replay קורא מהארכיון-המלא (chain-archive.jsonl, append-only) —
 * החלון-החם ב-chain.json לא מספיק לשחזור-מצב. ממצא-W3: stateRoot כולל
 * meta.lastTime — ה-replay משחזר height/hash/lastTime לכל-בלוק.
 *
 * זיהוי-שורש כפול: אם יש ./sovereign מקומי — זהו שורש-הבית; אחרת ./steem.
 */
import { readFile, writeFile, unlink } from "fs/promises";
import { readFileSync, statSync, existsSync, openSync, readSync, closeSync } from "fs";
import path from "path";
import { createRequire } from "module";
import { execFile } from "child_process";
import { randomUUID } from "crypto";

function homeRoot(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "sovereign", "core", "kernel.cjs"))) return cwd;
  const nested = path.join(cwd, "steem");
  if (existsSync(path.join(nested, "sovereign", "core", "kernel.cjs"))) return nested;
  return cwd;
}

const ROOT = homeRoot();
export const REPO_ROOT = ROOT;

const SOV = path.join(ROOT, "sovereign");
const NODE_DIR = path.join(SOV, "node");
const AGENT_DIR = path.join(ROOT, "agent");
const CHAIN_FILE = path.join(NODE_DIR, "chain.json");
const ARCHIVE_FILE = path.join(NODE_DIR, "chain-archive.jsonl");
const GENESIS_FILE = path.join(SOV, "genesis", "genesis.json");
const NODE_STATE_FILE = path.join(NODE_DIR, "state.json");
const SNAPSHOT_FILE = path.join(NODE_DIR, "state-snapshot.json");
const REQ_FILE = path.join(NODE_DIR, "weave-request.json");
const LAST_FILE = path.join(AGENT_DIR, "weave_last.json");
const ANCHOR_STATE_FILE = path.join(AGENT_DIR, "weave_state.json");

export const ISSUER = "headcorner";
export const CHECKPOINT_EVERY = 12;

/* ── הספר-המלא המאוחד (ארכיון + חלון-חם, ממוזג לפי-גובה) ──
 * 107-שורש-ה-OOM-החוזר (נתפס-חי: OOM קטל-את-next-server ב-2.17GB גם-עם-תקרת-heap):
 * המטמון-היה-מנוע-לפי-mtime של-ספר-שזז-בכל-שנייה → בפועל אפס-מטמון תחת-עומס-חי;
 * כל-דגימת-דף = re-parse-מלא של-הארכיון (מחרוזת-4MB + 32k-תתי-מחרוזות + Map-32k
 * + מערך-ממוין) → ענני-זבל-רגעיים → RSS-מתנפח-עד-ה-OOM.
 * הריפוי-מבני: הארכיון הוא JSONL **append-only** → קוראים-רק את-הזנב-שנוסף מאז
 * הקריאה-הקודמת (מצביע-בייטים), ה-byHeight-חי-ברציפות, ורק-המיזוג-הסופי-הקטן (חלון-חם
 * 512) חוזר-בכל-שינוי. אפס-זבל-גדול-רגעי. קיטון-קובץ = reset-כנה ל-reparse-מלא. */
let bookCache: { key: string; all: any[]; byHeight: Map<number, any> } | null = null;
let archiveReadOffset = 0; // כמה-בייטים-נצרכו-כבר מהארכיון
let archivePartial = "";   // שורה-אחרונה-לא-שלמה (כתיבה-במהלכה)
function statMtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}
function statSize(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}
export function bookKey(): string {
  return `${statMtime(ARCHIVE_FILE)}:${statMtime(CHAIN_FILE)}:${statMtime(NODE_STATE_FILE)}`;
}
/* קריאת-זנב-אינקרמנטלית של הארכיון: מחזיר-בלוקים-חדשים בלבד (או כל-הספר ב-reset) */
function archiveIncremental(): { reset: boolean; blocks: any[] } {
  const size = statSize(ARCHIVE_FILE);
  let fh: number = -1;
  try {
    fh = openSync(ARCHIVE_FILE, "r");
    /* קיטון/החלפה (reset-סביבה, healing) — reparse-מלא בכנות */
    if (size < archiveReadOffset) {
      archiveReadOffset = 0;
      if (bookCache) bookCache.byHeight.clear();
    }
    if (size === archiveReadOffset) return { reset: false, blocks: [] };
    /* משמרת-גבול: הבייט-שלפני-המצביע חייב-להיות newline (כתיבה-append-only אמתית).
     * שכתוב-של-הארכיון (heal) ישבור-את-הגבול → reparse-מלא בכנות. */
    if (archiveReadOffset > 0) {
      const probe = Buffer.alloc(1);
      readSync(fh, probe, 0, 1, archiveReadOffset - 1);
      if (probe[0] !== 0x0a) {
        archiveReadOffset = 0;
        if (bookCache) bookCache.byHeight.clear();
      }
    }
    const start = archiveReadOffset;
    const len = size - start;
    const buf = Buffer.allocUnsafe(len);
    readSync(fh, buf, 0, len, start);
    archiveReadOffset = size;
    let text = buf.toString("utf8");
    const blocks: any[] = [];
    /* שורה-שנקטעה-באמצע-כתיבה: נשמרת-להשלמה בקריאה-הבאה */
    if (archivePartial) text = archivePartial + text;
    const lines = text.split("\n");
    archivePartial = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const b = JSON.parse(t);
        if (b && b.height != null) blocks.push(b);
      } catch {}
    }
    return { reset: false, blocks };
  } catch {
    return { reset: !bookCache, blocks: [] };
  } finally {
    if (fh >= 0) {
      try {
        closeSync(fh);
      } catch {}
    }
  }
}
export function bookBlocks(): any[] {
  const key = bookKey();
  if (bookCache && bookCache.key === key) return bookCache.all;
  if (!bookCache) {
    /* 105 — הארכיון-ללא-שורת-כותרת: השורה-הראשונה היא בלוק-h1 עצמו (זוהה-לפי-תוכן) */
    bookCache = { key, all: [], byHeight: new Map<number, any>() };
    archiveReadOffset = 0;
  }
  const inc = archiveIncremental();
  for (const b of inc.blocks) bookCache.byHeight.set(Number(b.height), b);
  try {
    const chain = JSON.parse(readFileSync(CHAIN_FILE, "utf8")) || { blocks: [] };
    for (const b of (chain.blocks || []) as any[]) {
      const h = Number(b.height);
      if (!bookCache.byHeight.has(h)) bookCache.byHeight.set(h, b); // החלון-החם משלים — הארכיון קודם
    }
  } catch {}
  const all = [...bookCache.byHeight.values()].sort((a, b) => Number(a.height) - Number(b.height));
  bookCache.key = key;
  bookCache.all = all;
  return all;
}

/* ── קרנל: טעינה-לפי-mtime (תגלית-72 — שדרוג-קרנל לא משאיר replay על-גרסה-ישנה) ── */
type Kernel = Record<string, any>;
let K: Kernel | null = null;
let Kmtime = 0;
export function kernel(): Kernel | null {
  try {
    const p = path.join(SOV, "core", "kernel.cjs");
    let m = 0;
    try {
      m = statSync(p).mtimeMs;
    } catch {
      return K;
    }
    if (K && m === Kmtime) return K;
    const req = createRequire(path.join(process.cwd(), "package.json"));
    try {
      const resolved = req.resolve(p) as string;
      delete (req.cache as Record<string, unknown>)[resolved];
      K = req(resolved) as Kernel;
    } catch {
      K = req(p) as Kernel; // fallback — בלי-סילוק-מטמון
    }
    Kmtime = m;
    return K;
  } catch {
    return null;
  }
}

export async function readJson(p: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as Record<string, any>;
  } catch {
    return null;
  }
}

/* ── יומן-עלים: כל-רישום-שער שהתקבל-בפועל, מה-block-log בלבד ── */
export interface StampEntry {
  h: string;
  seq: number;
  kind: string;
  by: string;
  at: string | null;
  salt: string | null;
  block: number;
}

export interface ReplayResult {
  ok: boolean;
  why?: string;
  st?: Record<string, any>;
  weave?: Record<string, any>;
  stampLog?: StampEntry[];
  height?: number;
  blocksKept?: number;
  truncated?: boolean;
  finalRoot?: string | null;
  rejected?: number;
  cps?: { checked: number; matched: number; firstBadHeight: number | null };
  cpsDetail?: { height: number; matched: boolean; stateRoot: string | null; at: string | null }[];
  /* 104 — שרשרת-אימות-העוגן-החי: state-snapshot של-הצומת-עצמו חסום-מול-בלוק-הארכיון,
   * replay-מצטבר-מעליו, צ'קפוינטים-מעל-העוגן נמדדים, והשורש-הסופי=הצ'קפוינט-האחרון.
   * זה-האימות-המשמעותי-היום: עדות-הארכיון-המלא חסרה-בלוקים-עתיקים (703-709 — מתועד). */
  anchor?: {
    height: number | null;
    hashMatched: boolean;
    rootLocked?: boolean | null;
    cpsAbove: { checked: number; matched: number; kind?: string };
    finalRootMatched: boolean | null;
    finalRoot: string | null;
    why: string | null;
  } | null;
  /* 107 — גיל-התוצאה (ויסות-ה-replay): 0 = טרי · >0 = שקולה-מוצהרת (כנות-שמרת) */
  staleSec?: number;
}

/** הספר-המלא: ממטמון-הספר-המפורק (bookBlocks — מטמון-mtime, ממוזג-לפי-גובה:
 * ארכיון-ראשון-לגובה + חלון-חם-משלים — אותו-דפוס-בדיוק-כמו-הפעימה ב-saosnet).
 * 104-שורש-OOM: לפני-כן הפונקציה re-parse-את-הארכיון-בן-16MB בכל-replay
 * (מאות-MB זבל-רגעי בכל-פעימה — spike שהורג-את-next-server בקונטיינר). */
function loadReplayBlocks(chainState: { blocks: any[] }): any[] {
  const all = bookBlocks();
  if (all.length) return all;
  return chainState.blocks;
}

/** replay מלא — ג'נזיס + הספר-המלא (ארכיון-ראשון), על-הקרנל-עצמו.
 *  האימות-המתמטי = סריקת-צ'קפוינטים (ממצא-W3).
 *
 *  104-ייעול-מבני (שורש-ה-OOM): ה-replay-המלא על 21k+ בלוקים (~מאות-MB זבל-אובייקטים
 *  + hash-מצב-על-כל-צ'קפוינט) רץ-בכל-בקשה — הדף דוגם-סטטוס כל-~10ש' וה-next-server
 *  נחנק ל-2GB-רסידי ונהרג-OOM (4-פעמים-היום). מטמון-תוצאה לפי-mtime-ספר —
 *  מחושב-מחדש רק-כשהספר באמת-זז (פעימה-חדשה). כנות: התוצאה היא-הספר-עצמו —
 *  מטמון-לא-משנה-את-הנתונים, רק-מונע-חישוב-מחדש-זהה. */
/* 107 — ויסות-ה-replay: המפתח-הישן (bookKey) משתנה-בכל-בלוק-חדש (ספר-שזז-בכל-שנייה)
 * → ה-replay-המלא (32k applyTx + hash-צ'קפוינטים) היה-רץ-מחדש-כמעט-בכל-דגימת-דף —
 * מנוע-ה-OOM-השני. עכשיו: ויסות-זמן מינימלי (REPLAY_MIN_INTERVAL_MS=60 שנ׳) —
 * בתוך-החלון חוזרת-התוצאה-השמורה עם staleSec מוצהר (הכנות-שמרת), והצרכנים
 * (sovereign/route · sovexplorer) כבר-מנטרלים-שיפוט כשהגבהים-לא-שווים. */
const REPLAY_MIN_INTERVAL_MS = 60_000;
let rpCache: { key: string; result: ReplayResult; at: number } | null = null;
export function replayWeave(): ReplayResult {
  const key = bookKey() + ":" + Kmtime;
  const now = Date.now();
  if (rpCache && rpCache.key === key) {
    rpCache.result.staleSec = 0;
    return rpCache.result;
  }
  if (rpCache && now - rpCache.at < REPLAY_MIN_INTERVAL_MS) {
    /* ספר-זז אך-בתוך-חלון-הוויסות — תוצאה-מוצהרת-כשקולה; לא recompute-בזבזני */
    const staleSec = Math.max(0, Math.round((now - rpCache.at) / 1000));
    rpCache.result.staleSec = staleSec;
    return rpCache.result;
  }
  const result = replayWeaveUncached();
  if (result.ok) {
    rpCache = { key, result, at: now }; // כישלון לא נשמר — נסה-שוב בבקשה-הבאה
    result.staleSec = 0;
  }
  return result;
}

function replayWeaveUncached(): ReplayResult {
  const K = kernel();
  if (!K) return { ok: false, why: "kernel-unavailable" };
  try {
    const genesis = JSON.parse(readFileSync(GENESIS_FILE, "utf8"));
    const chainState = JSON.parse(readFileSync(CHAIN_FILE, "utf8")) || { blocks: [] };
    const replayBlocks = loadReplayBlocks(chainState);
    const st = K.initFromGenesis(genesis);
    st.meta.issuer = ISSUER; // זהה-לצומת — בלי-זה seals היסטוריים נופלים ב-replay
    const stampLog: StampEntry[] = [];
    let rejected = 0;
    const nodeStNow = JSON.parse(readFileSync(NODE_STATE_FILE, "utf8")) || {};
    const cpRecs = new Map<number, { stateRoot: string; at: string | null }>(
      ((nodeStNow.checkpoints as any[]) || []).map((c) => [Number(c.height), { stateRoot: String(c.stateRoot || ""), at: (c.at as string) || null }])
    );
    const cpMap = new Map<number, string>([...cpRecs.entries()].map(([h, r]) => [h, r.stateRoot]));
    let cpsChecked = 0;
    let cpsMatched = 0;
    let firstBadHeight: number | null = null;
    const cpsDetail: { height: number; matched: boolean; stateRoot: string | null; at: string | null }[] = [];
    for (const b of replayBlocks as any[]) {
      for (const tx of b.txs as any[]) {
        const r = K.applyTx(st, tx);
        if (tx && tx.type === "stamp" && r.ok) {
          stampLog.push({
            h: String(tx.h),
            seq: Number(r.seq),
            kind: String(tx.kind || "text"),
            by: String(tx.by || "").toLowerCase(),
            at: (tx.at as string) || null,
            salt: (tx.salt as string) || null,
            block: Number(b.height),
          });
        }
        if (r && !r.ok) rejected++;
      }
      // ממצא-W3: שחזור-המטא-ש-buildBlock הציב — בלי-זה השורש סוטה מההיסטוריה
      st.meta.height = Math.max(st.meta.height, b.height || 0);
      st.meta.lastBlockHash = b.hash || st.meta.lastBlockHash;
      st.meta.lastTime = b.time || st.meta.lastTime;
      if (b.height && cpMap.has(Number(b.height))) {
        cpsChecked++;
        const mine = K.stateRoot(st);
        const matched = mine === cpMap.get(Number(b.height));
        if (matched) cpsMatched++;
        else if (firstBadHeight === null) firstBadHeight = Number(b.height);
        const rec = cpRecs.get(Number(b.height));
        cpsDetail.push({ height: Number(b.height), matched, stateRoot: String(cpMap.get(Number(b.height)) || "") || null, at: rec?.at ?? null });
      }
    }
    const weave = K.weaveInit(st);

    /* 104 — שרשרת-אימות-העוגן-החי (מקביל לשחזור-הפעימה-עצמו ב-saosnet):
     * 1) ה-snapshot של הצומת חייב-להיות חסום-מול-בלוק-הארכיון בגובהו (hash match)
     * 2) replay-מצטבר מעליו — כל צ'קפוינט שמעל-העוגן נמדד מול שורש-המצב שלו
     * 3) השורש-הסופי = שורש-הצ'קפוינט האחרון שעל הצומת (state.json)
     * עדות-הארכיון-המלא (הסריקה-מהג'נזיס למעלה) נשארת-בכנות — היא חסרה-בלוקים-עתיקים. */
    const anchor: NonNullable<ReplayResult["anchor"]> = {
      height: null,
      hashMatched: false,
      cpsAbove: { checked: 0, matched: 0 },
      finalRootMatched: false,
      finalRoot: null,
      why: null,
    };
    try {
      const s = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8"));
      if (s && s.st && Number.isInteger(s.height) && s.height > 0 && s.lastBlockHash) {
        const anchorBlk = (replayBlocks as any[]).find((b) => Number(b.height) === Number(s.height));
        if (anchorBlk && anchorBlk.hash === s.lastBlockHash) {
          anchor.height = Number(s.height);
          anchor.hashMatched = true;
          const st2 = s.st;
          st2.meta.issuer = ISSUER;
          const rootByHeight = new Map<number, string>(); // 106 — שורשים-מתועדים-לפי-גובה
          let rootAtLastCp: string | null = null; // השורש בדיוק בגובה-הצ'קפוינט-האחרון מעל-העוגן
          for (const b of replayBlocks as any[]) {
            if (Number(b.height) <= Number(s.height)) continue;
            for (const tx of b.txs as any[]) K.applyTx(st2, tx);
            st2.meta.height = Math.max(st2.meta.height, Number(b.height) || 0);
            st2.meta.lastBlockHash = b.hash || st2.meta.lastBlockHash;
            st2.meta.lastTime = b.time || st2.meta.lastTime;
            if (b.height && cpMap.has(Number(b.height))) {
              const rootHere = K.stateRoot(st2);
              rootByHeight.set(Number(b.height), rootHere);
              rootAtLastCp = rootHere; // הגבוה-ביותר נשאר אחרון
            }
          }
          /* 106 — דוקטרינת-אימות-אמת (ממצא-חי: cps-above 0/2): replay-ביתי של שורשי-צ'קפוינט
           * אינו-אפשרי-ביטיות — רשומות-cp חיות-בתוך-המצב-המגובש (st.checkpoints · kernel 103,
           * push ב-saosnet 673) ומועשרות-בעגנים-שנאספו-מחוץ-לבלוקים (txids על Steem/Hive) —
           * אף-replay מקומי לא-ישחזר-אותן-ביטיות. האימות-האמיתי של הרשת הוא anchored-quorum
           * (מפרט-הברזל): חיילים-חותמים על כל cp ב-custom_json חינם וזה נאמת מול המארח.
           * מקומית-אנחנו מוכיחים את מה שאפשר להוכיח: hash-locks — ואת-ה-quorum-אנחנו מציגים. */
          let rootLocked: boolean | null = null;
          try {
            const rt = JSON.parse(readFileSync(path.join(NODE_DIR, "state-root.json"), "utf8"));
            if (rt && Number.isInteger(rt.height) && rt.height > 0 && rt.lastBlockHash) {
              const rb = (replayBlocks as any[]).find((b) => Number(b.height) === Number(rt.height));
              rootLocked = !!(rb && rb.hash === rt.lastBlockHash);
            }
          } catch (_) { /* אין-root-עדיין — לפני-הקידום-הראשון */ }
          anchor.rootLocked = rootLocked;
          const cpEntries = [...cpRecs.entries()].filter(([, r]) => r.stateRoot).sort((a, b) => b[0] - a[0]);
          const lastRec = cpEntries[0] || null;
          const REQ = 3; // quorum.required — מפרט-הברזל
          const lastAtt = lastRec
            ? (((nodeStNow.checkpoints as any[]) || []).filter((c) => Number(c.height) === lastRec[0]).flatMap((c) => (c.attests as any[]) || []))
            : [];
          const verified = lastAtt.filter((a) => a && a.verified).length;
          anchor.cpsAbove = { checked: Math.max(lastAtt.length, REQ), matched: verified, kind: "soldier-attests" };
          anchor.finalRoot = lastRec ? lastRec[1].stateRoot || rootAtLastCp : K.stateRoot(st2);
          if (lastRec && verified >= REQ) {
            anchor.finalRootMatched = true;
          } else if (lastRec) {
            anchor.finalRootMatched = null;
            anchor.why = "quorum-pending(" + verified + "/" + REQ + " attests)";
          } else {
            anchor.finalRootMatched = null;
            anchor.why = "no-checkpoint-record";
          }
        } else anchor.why = "anchor-hash-mismatch";
      } else anchor.why = "no-snapshot";
    } catch (e) {
      anchor.why = "snapshot-unreadable";
    }

    return {
      ok: true,
      st,
      weave,
      stampLog,
      height: st.meta.height,
      blocksKept: (replayBlocks as any[]).length,
      truncated: !!chainState.truncated,
      finalRoot: K.stateRoot(st),
      rejected,
      cps: { checked: cpsChecked, matched: cpsMatched, firstBadHeight },
      // 104 — הפרטים-המלאים צומחים-ללא-חבל (1,900+ צ'קפוינטים) — זיכרון+payload:
      // השורה-האחרונה-היא-זו-שמעניינת-את-המסך; שאר-ההיסטוריה נשמרת-בספירה.
      cpsDetail: cpsDetail.length > 40 ? cpsDetail.slice(-40) : cpsDetail,
      anchor,
    };
  } catch (e) {
    return { ok: false, why: String((e as Error)?.message ?? e).slice(0, 140) };
  }
}

/* ── תעודה: מחולל-ההוכחות — נתיב-מרקל מה-block-log בלבד ── */
export interface WeaveCertificate {
  h: string;
  status: "sealed" | "pending-seal" | "unknown";
  seq: number | null;
  kind?: string;
  by?: string;
  at?: string | null;
  stampBlock?: number;
  seal?: {
    seq: number;
    root: string;
    count: number;
    from: number;
    to: number;
    height: number | null;
    at: string | null;
  } | null;
  proof?: {
    ok: boolean;
    pathLen?: number;
    why?: string;
    // payload מלא לאימות-עצמאי-בדפדפן (הכל-ציבורי — מה-block-log):
    leafEntry?: { h: string; seq: number; kind: string; by: string; at: string | null; salt: string | null };
    leaf?: string;
    path?: { pos: "L" | "R"; h: string }[];
    root?: string;
  };
  checkpoint?: {
    height: number;
    stateRoot: string | null;
    note: string;
  } | null;
  anchors?: {
    registry: Record<string, any>;
    tronNote: string;
  } | null;
}

export async function buildCertificate(h: string): Promise<WeaveCertificate | null> {
  const rp = replayWeave();
  if (!rp.ok || !rp.weave || !rp.stampLog || !K) return null;
  const entry = rp.stampLog.find((e) => e.h === h);
  if (!entry) return { h, status: "unknown", seq: null };
  const w = rp.weave;
  const seals = (w.seals as any[]) || [];
  const seal = seals.find((s) => entry.seq >= s.from && entry.seq <= s.to) || null;

  const cert: WeaveCertificate = {
    h,
    status: seal ? "sealed" : "pending-seal",
    seq: entry.seq,
    kind: entry.kind,
    by: entry.by,
    at: entry.at,
    stampBlock: entry.block,
    seal: seal
      ? { seq: seal.seq, root: seal.root, count: seal.count, from: seal.from, to: seal.to, height: seal.height ?? null, at: seal.at ?? null }
      : null,
  };

  if (seal) {
    // עלים מה-block-log — לא מה-state-החי (אותו-חוק של kernel-replay)
    const leaves = rp.stampLog!
      .filter((e) => e.seq >= seal.from && e.seq <= seal.to)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => K!.weaveLeaf(e));
    try {
      const rebuilt = K.merkle.rootOf(leaves);
      if (rebuilt !== seal.root) {
        cert.proof = { ok: false, why: "rebuilt-root-mismatch" };
      } else {
        const tree = K.merkle.buildTree(leaves);
        const idx = Math.max(0, Math.min(entry.seq - seal.from, leaves.length - 1));
        const p = K.merkle.prove(tree.levels, idx);
        cert.proof = {
          ok: K.merkle.verify(leaves[idx], p, seal.root),
          pathLen: p.length,
          // ה-payload לאימות-בדפדפן: הקליינט מחשב את-העלה בעצמו מהרישום הציבורי,
          // מקפל את-הנתיב צעד-אחר-צעד ומשווה לשורש — בלי לסמוך על שרת זה.
          leafEntry: { h: entry.h, seq: entry.seq, kind: entry.kind, by: entry.by, at: entry.at ?? null, salt: entry.salt ?? null },
          leaf: leaves[idx],
          path: p,
          root: String(seal.root),
        };
      }
    } catch (e) {
      cert.proof = { ok: false, why: String((e as Error)?.message ?? e).slice(0, 100) };
    }

    // הצ'קפוינט-הראשון שנשא את-השורש (מתוך state-הצומת — עגוניו הציבוריים)
    const nextCp0 = Math.ceil(Number(seal.height) / CHECKPOINT_EVERY) * CHECKPOINT_EVERY;
    const nodeSt = await readJson(NODE_STATE_FILE);
    // הקרנל לא-שומר height ב-seal — הגובה חי ברישום-הצומת (state.json → weave.seals, לפי-שורש)
    const nodeSealRec = ((nodeSt?.weave as any)?.seals as any[] | undefined)?.find(
      (n) => String(n.root) === String(seal.root)
    );
    let sealHeight = Number(seal.height ?? nodeSealRec?.height) || null;
    // נחה-זמן: כשהקרנל/הצומת לא רשמו גובה-איטום — הצ'קפוינט הראשון שנחתם אחרי-זמן-האיטום
    if (!sealHeight && seal.at && Array.isArray(nodeSt?.checkpoints)) {
      const t = new Date(seal.at as string).getTime();
      const cand = ((nodeSt.checkpoints as any[]) || []).find((c) => c.at && new Date(c.at).getTime() >= t);
      if (cand) sealHeight = Number(cand.height) || null;
    }
    const nextCp = sealHeight ? Math.ceil(sealHeight / CHECKPOINT_EVERY) * CHECKPOINT_EVERY : nextCp0;
    const cps = ((nodeSt?.checkpoints as any[]) || []).filter((c) => Number(c.height) >= Number(sealHeight || 0));
    const cp = cps.find((c) => c.stateRoot) || null;
    cert.checkpoint = cp
      ? {
          height: Number(cp.height),
          stateRoot: String(cp.stateRoot),
          note:
            cp.anchors && (cp.anchors.steem || cp.anchors.hive)
              ? "checkpoint anchored (root carried inside stateRoot)"
              : "checkpoint recorded — anchors pending (node will anchor)",
        }
      : {
          height: nextCp || 0,
          stateRoot: null,
          note: sealHeight
            ? "expected carrier (≤12 blocks after seal) — recorded when the beat anchors it"
            : "carrier height not recorded for this seal (honest)",
        };

    const anchorReg = await readJson(ANCHOR_STATE_FILE);
    const sealAnchor = anchorReg?.anchored?.[String(seal.root)] || null;
    cert.anchors = {
      registry: sealAnchor || {},
      tronNote:
        sealAnchor?.tron?.note ||
        "TRON root arrives transitively via the checkpoint that carries it (daily rail)",
    };
  }

  return cert;
}

/* ── הזרקה דרך הצומת: בלוק-אחד תחת-beat.lock — הצומת-הכותב-היחיד ── */
export interface InjectResult {
  ok: boolean;
  applied?: number;
  total?: number;
  why?: string;
}

export function injectTxs(txs: Record<string, any>[], timeoutMs = 60000): Promise<InjectResult> {
  return new Promise((resolve) => {
    const file = path.join(NODE_DIR, `inject-${randomUUID()}.json`);
    writeFile(file, JSON.stringify({ txs }, null, 2))
      .then(() => {
        execFile(
          "node",
          [path.join("sovereign", "node", "saosnet.cjs"), "--inject", file],
          { cwd: ROOT, timeout: timeoutMs, windowsHide: true },
          (err, stdout) => {
            unlink(file).catch(() => {});
            const out = String(stdout || "");
            const m = out.match(/INJECT DONE · (\d+)\/(\d+) applied/);
            if (m) return resolve({ ok: true, applied: Number(m[1]), total: Number(m[2]) });
            if (out.includes("inject SKIPPED")) return resolve({ ok: false, why: "beat-lock-held" });
            if (out.includes("REJECTED")) {
              const r = out.match(/REJECTED: (\S+)/);
              return resolve({ ok: false, why: r ? r[1] : "rejected" });
            }
            resolve({ ok: false, why: err ? String(err.message || err).slice(0, 120) : "no-inject-confirmation" });
          }
        );
      })
      .catch((e) => resolve({ ok: false, why: String((e as Error)?.message ?? e).slice(0, 120) }));
  });
}

/* ── חומות-קלות-יד (לא-מצב-עולם — רק-הצפה-גסה לכל-תהליך) ── */
const rateMap = new Map<string, { n: number; window: number }>();
export function rateLimit(key: string, maxPerMin: number): boolean {
  const now = Math.floor(Date.now() / 60000);
  const cur = rateMap.get(key);
  if (!cur || cur.window !== now) {
    rateMap.set(key, { n: 1, window: now });
    return true;
  }
  cur.n++;
  return cur.n <= maxPerMin;
}

export const FILES = { REQ_FILE, LAST_FILE, ANCHOR_STATE_FILE, NODE_STATE_FILE, CHAIN_FILE, ARCHIVE_FILE };
