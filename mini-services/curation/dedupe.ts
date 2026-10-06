// ─────────────────────────────────────────────────────────────────────
// CURATION · content-dedupe layer (r144-i2 · army-content-i2)
//
// מה-זה: שכבת-מניעת-שכפול-תוכן חוצת-חשבונות. הרקע הנמדד
// (sovereign/curation/duplication-audit-2026-10-01.json): 11 חשבונות-קהילה
// מפרסמים תגובות דרך שכבת-התוכן של Domain — תבנית-אחת משותפת (פתיח זהה
// + 5 משפטי-סיום קבועים) ושתי זוגות-תגובות כמעט-זהות נמדדו (4.1% מזוגות
// חוצת-חשבונות, 7.7% מהתגובות). השכבה הזאת:
//   1) פרופילי-קול פר-חשבון — רוטציה דטרמיניסטית של טון/מבנה/פתיחים
//      (voiceProfileFor) — כל חשבון חייב קול מובחן משלו
//   2) זיכרון-דדופ לפני-שידור — 50 התגובות האחרונות של כל-החשבונות שלנו
//      (מההיסטוריה + המצב + רענון-חי מהשרשרת), השוואת חפיפת-אסימונים
//      מנורמלת (סף 0.6) — כמעט-זהה ⇒ SKIP + רישום כנה ב-dedupe-log.json
//   3) אפס שינוי-היגיון-עסקי מעבר לשער הזה: איש-מת, מכסות, ספי-כוח —
//      לא נגענו. ההצבעה זורמת כמו קודם; השער מוסיף מדידה וזיכרון בלבד.
//
// כנות-מדידה: הדיבון הזה מצביע (החוזה שלו); תגובות נשלחות כרגע משכבת
// הענן של Domain (fleet-social.cjs). gateCast כאן הוא נקודת-השער
// היחידה — כל-שכבת-שידור-תגובות תחויב לעבור דרכו, ובינתיים השער מנטר
// את הזיכרון החי ומרשים כל-זוג כמעט-זהה שנמדד בשרשרת עצמה.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

const HOME = "/home/z/my-project";
const STATE_DIR = path.join(HOME, "sovereign", "curation");
const MEMORY_FILE = path.join(STATE_DIR, "comment-memory.json");
const DEDUPE_LOG_FILE = path.join(STATE_DIR, "dedupe-log.json");
const HISTORY_FILE = path.join(STATE_DIR, "history.json");

export const NEAR_DUP_THRESHOLD = 0.6; // סף-חפיפה — מעליו: כמעט-זהה
export const MEMORY_WINDOW = 50; // N=50 — חלון-הזיכרון חוצת-החשבונות
const REFRESH_MS = 90 * 60_000; // רענון-חי כל 6 פעימות (פעימה=15 דק')

// הצי החי — הרשימה נמדדה ממנגנון-השידור בפועל (Domain/agents/self-audience.cjs
// FLEET = 11, fleet-social.cjs ROTATION 10 + headcorner). אין רשימה בפנקס-הצבעה.
export const FLEET_ACCOUNTS = [
  "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic", "wog", "woq", "headcorner",
] as const;

// ── 1) פרופילי-קול — טבלת-וריאציה דטרמיניסטית קטנה ────────────────────
// תוכן באנגלית בלבד (Z-25 — נמדד: 42/52 תגובות אחרונות אנגלית, השאר עברית
// של תבנית-ישנה). פתיחים/סיומים פר-חשבון — אף משפט לא משותף בין שני חשבונות.
export interface VoiceProfile {
  account: string;
  tone: string;
  structure: string;
  openers: string[];
  closers: string[];
}

export const VOICE_PROFILES: VoiceProfile[] = [
  { account: "cashmachine", tone: "ledger-dry", structure: "number first, then the lesson", openers: ["The ledger line reads:", "Ran the numbers again:"], closers: ["The arithmetic holds either way.", "Small positions, honest math."] },
  { account: "israelnews", tone: "plain-report", structure: "what happened, what is verified", openers: ["Checked the story:", "Two sources later:"], closers: ["Still waiting on the second source.", "Facts first, the rest follows."] },
  { account: "haran", tone: "patient-narrative", structure: "old road, modern lesson", openers: ["Old roads repeat themselves:", "A map from long ago:"], closers: ["Routes change, trade does not.", "The map keeps teaching."] },
  { account: "macrame", tone: "maker-practical", structure: "cost in cents, then the craft", openers: ["Counted the materials first:", "Worked this with my hands:"], closers: ["Cents add up the same way knots do.", "Measure twice, cut once."] },
  { account: "wic", tone: "quiet-hours", structure: "early-morning observation", openers: ["Before the day gets loud:", "From the quiet hours:"], closers: ["The morning kept its promise.", "Routines outlast motivation."] },
  { account: "wog", tone: "text-minded", structure: "quote, then what the words carried", openers: ["The old words say:", "Read it again today:"], closers: ["Old words, new weather.", "Translation is interpretation."] },
  { account: "woq", tone: "question-first", structure: "a question, then a test for the reader", openers: ["A question worth holding:", "Instead of an answer:"], closers: ["Try it and report back.", "What would you test first?"] },
  { account: "siq", tone: "field-note", structure: "short, unadorned observation", openers: ["Field note:", "Small thing noticed:"], closers: ["Noted without decoration.", "That was the whole thing."] },
  { account: "lsa", tone: "editor-precise", structure: "one precise sentence, then one more", openers: ["One sentence at a time:", "From the archive shelf:"], closers: ["Fewer words, same weight.", "The sentence survives editing."] },
  { account: "tov", tone: "constructive-roundup", structure: "what worked, then why", openers: ["Things that worked this week:", "One thing that held:"], closers: ["No cheerleading, just receipts.", "It worked; the numbers agree."] },
  { account: "headcorner", tone: "operations-receipt", structure: "cadence, fuel, logistics", openers: ["Operations log:", "Cadence check:"], closers: ["The beat continues.", "Fuel measured, course held."] },
];

/** רוטציה דטרמיניסטית: (אינדקס-יום + משבצת) מול מאגרי-הפתיח/סיום של אותו חשבון */
export function voiceProfileFor(account: string, slot: number): VoiceProfile | null {
  const p = VOICE_PROFILES.find((v) => v.account === account);
  if (!p) return null;
  const dayIdx = Math.floor(Date.now() / 86_400_000);
  const pick = (arr: string[]): string => arr.length ? arr[(dayIdx + slot) % arr.length] : "";
  return {
    ...p,
    tone: p.tone,
    structure: p.structure,
    openers: [pick(p.openers)],
    closers: [pick(p.closers)],
  };
}

// ── 2) נרמול וחפיפת-אסימונים (אותה-מתמטיקה כמו ביקורת-2026-10-01) ───────
const STOP = new Set(("the a an and or but if then than that this these those of to in on for with as at by from is are was were be been being it its it's their his her our your my not no so such which who whom what when where why how all any both each few more most other some only own same too very can will just should now do does did done has have had having i we you he she they them us also there here about into over under again once").split(" "));
const stripMd = (s: string): string => String(s).replace(/https?:\/\/\S+/g, " ").replace(/[*_#>`~|[\]()]/g, " ");
export function contentTokens(text: string): string[] {
  return stripMd(text).toLowerCase().replace(/[^a-z0-9\u0590-\u05FF]+/g, " ").split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
}
export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter(x => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 0;
}
export function containment(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter(x => B.has(x)).length;
  const mn = Math.min(A.size, B.size);
  return mn ? inter / mn : 0;
}

// ── 3) זיכרון-התגובות — היסטוריה + מצב + רענון-חי מהשרשרת ───────────────
export interface MemoryEntry { author: string; permlink: string; created: string; body: string; source: string }

function readHistoryCommentEntries(): MemoryEntry[] {
  // כנות: ההיסטוריה מחזיקה החלטות-הצבעה (נמדד). רשומות-תגובה עתידיות
  // (kind COMMENT-*) ייקלטו כאן אוטומטית — השער רואה את כל הערוצים.
  try {
    const arr = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as Array<Record<string, unknown>>;
    return arr.filter(e => String(e.kind ?? "").startsWith("COMMENT")).map(e => ({
      author: "headcorner",
      permlink: String(e.kind ?? "comment") + "-" + String(e.at ?? ""),
      created: String(e.at ?? ""),
      body: String(e.detail ?? ""),
      source: "history.json",
    }));
  } catch { return []; }
}

function readStateCommentEntries(): MemoryEntry[] {
  // כנות: פנקס-המצב מחזיק הצבעות, לא תגובות (נמדד). שדה-תגובות עתידי ייקלט.
  try {
    const s = JSON.parse(fs.readFileSync(path.join(STATE_DIR, "state.json"), "utf8")) as Record<string, unknown>;
    const arr = s.comments;
    if (!Array.isArray(arr)) return [];
    return arr.map((c) => {
      const o = c as Record<string, unknown>;
      return {
        author: String(o.author ?? "headcorner"),
        permlink: String(o.permlink ?? ""),
        created: String(o.at ?? ""),
        body: String(o.body ?? ""),
        source: "state.json",
      };
    });
  } catch { return []; }
}

async function fetchLiveComments(): Promise<MemoryEntry[]> {
  const out: MemoryEntry[] = [];
  for (const acc of FLEET_ACCOUNTS) {
    try {
      // condenser_api.get_discussions_by_comments מת ("Invalid parameters" נמדד)
      // — bridge.get_account_posts הוא הנתיב-החי המוכח.
      const r = await fetch("https://api.steemit.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "bridge.get_account_posts", params: { sort: "comments", account: acc, limit: 5 }, id: 1 }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = (await r.json()) as { result?: Array<Record<string, unknown>> };
      for (const p of j.result ?? []) {
        out.push({ author: String(p.author ?? acc), permlink: String(p.permlink ?? ""), created: String(p.created ?? ""), body: String(p.body ?? ""), source: "steem-live" });
      }
    } catch { /* fail-soft — הזיכרון שעל-הדיסק הוא האמת עד הרענון הבא */ }
  }
  return out;
}

export interface CommentMemory { entries: MemoryEntry[]; lastLiveRefreshAt: string | null; lastError?: string }

export function readMemoryCache(): CommentMemory {
  try {
    const m = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")) as CommentMemory;
    if (Array.isArray(m.entries)) return m;
  } catch { /* אין קובץ עדיין */ }
  return { entries: [], lastLiveRefreshAt: null };
}

function writeMemoryCache(m: CommentMemory): void {
  const tmp = `${MEMORY_FILE}.tmp`;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(m, null, 1) + "\n");
  fs.renameSync(tmp, MEMORY_FILE);
}

export function mergeMemory(base: CommentMemory, additions: MemoryEntry[]): CommentMemory {
  const seen = new Set(base.entries.map(e => `${e.author}/${e.permlink}`));
  const entries = [...base.entries];
  for (const e of additions) {
    const k = `${e.author}/${e.permlink}`;
    if (seen.has(k)) continue;
    seen.add(k);
    entries.push(e);
  }
  entries.sort((a, b) => (a.created < b.created ? 1 : -1));
  return { ...base, entries: entries.slice(0, MEMORY_WINDOW) };
}

export async function refreshMemoryIfNeeded(prev: CommentMemory, force = false): Promise<CommentMemory> {
  const fresh = !force && prev.lastLiveRefreshAt && (Date.now() - Date.parse(prev.lastLiveRefreshAt) < REFRESH_MS);
  if (fresh) return prev;
  const live = await fetchLiveComments();
  const merged = mergeMemory({ ...prev, lastLiveRefreshAt: new Date().toISOString() }, live);
  writeMemoryCache(merged);
  return merged;
}

// ── 4) השער — gateCast: נקודת-המעבר היחידה לפני כל שידור-תוכן ───────────
export interface GateVerdict { verdict: "PASS" | "SKIP"; reason: string; bestSim: number; partner: { author: string; permlink: string } | null; profile: { tone: string; structure: string; opener: string; closer: string } | null }

export function gateCast(account: string, text: string, memory: MemoryEntry[], slot = 0): GateVerdict {
  const prof = voiceProfileFor(account, slot);
  if (!prof) return { verdict: "SKIP", reason: "no-voice-profile", bestSim: 0, partner: null, profile: null };
  const mine = contentTokens(text);
  let bestSim = 0, partner: { author: string; permlink: string } | null = null;
  for (const e of memory) {
    if (e.author === account) continue; // חוצת-חשבונות — השוואה מול כל-השאר
    const sim = jaccard(mine, contentTokens(e.body));
    if (sim > bestSim) { bestSim = sim; partner = { author: e.author, permlink: e.permlink }; }
  }
  if (bestSim >= NEAR_DUP_THRESHOLD) {
    return { verdict: "SKIP", reason: `near-duplicate ${bestSim.toFixed(3)} >= ${NEAR_DUP_THRESHOLD} vs @${partner?.author}/${partner?.permlink.slice(0, 40)}`, bestSim, partner, profile: { tone: prof.tone, structure: prof.structure, opener: prof.openers[0] ?? "", closer: prof.closers[0] ?? "" } };
  }
  return { verdict: "PASS", reason: `max cross-account sim ${bestSim.toFixed(3)} < ${NEAR_DUP_THRESHOLD}`, bestSim, partner, profile: { tone: prof.tone, structure: prof.structure, opener: prof.openers[0] ?? "", closer: prof.closers[0] ?? "" } };
}

// ── 5) יומן-הדדופ — append-only, כנות ──────────────────────────────────
interface DedupeLog { header: Record<string, unknown>; entries: Array<Record<string, unknown>> }

export function ensureDedupeLog(): DedupeLog {
  try {
    const l = JSON.parse(fs.readFileSync(DEDUPE_LOG_FILE, "utf8")) as DedupeLog;
    if (l && Array.isArray(l.entries)) return l;
  } catch { /* ייווצר עכשיו */ }
  const fresh: DedupeLog = {
    header: {
      what: "content-dedupe log — append-only, honest (r144-i2)",
      threshold: NEAR_DUP_THRESHOLD,
      similarity: "content-Jaccard, normalized tokens (markdown-stripped, stopwords removed, len>=3)",
      window: MEMORY_WINDOW,
      accounts: FLEET_ACCOUNTS,
      note: "an entry = a measured near-duplicate (would-SKIP under the pre-cast gate); no natural duplicates = only this header",
    },
    entries: [],
  };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(DEDUPE_LOG_FILE, JSON.stringify(fresh, null, 1) + "\n");
  return fresh;
}

function appendDedupeLog(entries: Array<Record<string, unknown>>): number {
  if (!entries.length) return 0;
  const log = ensureDedupeLog();
  const seen = new Set(log.entries.map(e => String(e.key ?? "")));
  const fresh = entries.filter(e => !seen.has(String(e.key ?? "")));
  if (!fresh.length) return 0;
  log.entries = [...log.entries, ...fresh];
  const tmp = `${DEDUPE_LOG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(log, null, 1) + "\n");
  fs.renameSync(tmp, DEDUPE_LOG_FILE);
  return fresh.length;
}

/** סריקת-זיכרון חוצת-חשבונות — כל-זוג ≥ סף הוא רשומת-יומן */
export function scanMemoryForNearDups(memory: MemoryEntry[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const tok = new Map(memory.map(e => [e, contentTokens(e.body)]));
  for (let i = 0; i < memory.length; i++) {
    for (let j = i + 1; j < memory.length; j++) {
      const a = memory[i], b = memory[j];
      if (a.author === b.author || !a.body || !b.body) continue;
      const sim = jaccard(tok.get(a) ?? [], tok.get(b) ?? []);
      if (sim >= NEAR_DUP_THRESHOLD) {
        out.push({
          key: `${a.author}/${a.permlink}~${b.author}/${b.permlink}`,
          at: new Date().toISOString(),
          a: { author: a.author, permlink: a.permlink, source: a.source },
          b: { author: b.author, permlink: b.permlink, source: b.source },
          sim: Number(sim.toFixed(3)),
          verdict: "would-SKIP under pre-cast gate",
        });
      }
    }
  }
  return out;
}

// ── 6) מהלך-השער בפעימה — תוספת נקייה, אפס-נגיעה בנתיב-ההצבעה ───────────
export interface DedupeStatus { at: string; memory: number; liveRefreshedAt: string | null; scanned: boolean; crossPairs: number; nearDups: number; logged: number; voiceDiversity: number; lastError: string | null }

export function dedupeStatusEmpty(): DedupeStatus {
  return { at: new Date().toISOString(), memory: 0, liveRefreshedAt: null, scanned: false, crossPairs: 0, nearDups: 0, logged: 0, voiceDiversity: 0, lastError: null };
}

export async function contentGate(state: { dedupe?: DedupeStatus }): Promise<DedupeStatus> {
  const st: DedupeStatus = { ...dedupeStatusEmpty(), ...(state.dedupe ?? {}) };
  try {
    ensureDedupeLog(); // הקובץ חי מהפעימה הראשונה — גם אם אין כפילויות טבעיות
    const base = readMemoryCache();
    st.memory = base.entries.length;
    let mem = base;
    if (!base.lastLiveRefreshAt || Date.now() - Date.parse(base.lastLiveRefreshAt) >= REFRESH_MS || base.entries.length < 10) {
      mem = await refreshMemoryIfNeeded(base, !base.lastLiveRefreshAt);
      st.memory = mem.entries.length;
      st.liveRefreshedAt = mem.lastLiveRefreshAt;
    } else {
      mem = mergeMemory(mergeMemory(base, readHistoryCommentEntries()), readStateCommentEntries());
      st.memory = mem.entries.length;
    }
    const near = scanMemoryForNearDups(mem.entries);
    st.scanned = true;
    st.nearDups = near.length;
    // מניין-זוגות-חוצת-חשבונות לטובת אחוז-הכפילות הנמדד
    let cross = 0;
    const n = mem.entries.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (mem.entries[i].author !== mem.entries[j].author) cross++;
    st.crossPairs = cross;
    st.logged = appendDedupeLog(near);
    // אינווריאנט קול: 11 פרופילים מובחנים (טון+מבנה ייחודיים פר-חשבון), נמדד כל פעימה
    const sigs = new Set(VOICE_PROFILES.map(p => `${p.tone}|${p.structure}`));
    st.voiceDiversity = sigs.size;
    st.at = new Date().toISOString();
    st.lastError = null;
  } catch (e) {
    st.lastError = String((e as Error).message ?? e).slice(0, 160); // fail-soft — אף הצבעה לא נפגעת
    st.at = new Date().toISOString();
  }
  state.dedupe = st; // שדה-תוספת בלבד — נשמר עם הפנקס ומוצג ב-GET /
  return st;
}
