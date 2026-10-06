// ─────────────────────────────────────────────────────────────────────
// SCOUT-MARKET · דיבון-הסייר-החוץ (r146-b · D-r146-SCOUT · מחלקת "army")
//
// הפער שנסגר כאן (הנחיית-המפעיל r146): "עוד קבוצות של בדיקות, חיפושים
// והבנות בצורה חכמה — אני לא רוצה להסתמך רק על דברים שאני מציע".
// עד היום איש לא חיפש את-העולם-בחוץ: הצייד (:3036) מחפש הזדמנויות
// פנימיות-מערכתיות בלבד. הסייר הזה יוצא החוצה — חיפוש-רשת אמיתי
// (z-ai-web-dev-sdk · web_search · שרת-בלבד) — ומביא:
//   (a) חדשות-שוק Steem/STEEM + הקשר-מחיר מדוד
//   (b) נוף-תחרות: פרויקטי AI-agent-verification/רשת ציבוריים —
//       עם מבדילים-כנים (מה קיים, מה חסר)
//   (c) מועמד-פריצה שבועי — טכניקה אמיתית אחת שהרשת יכולה לאמץ,
//       ברוטציה-חכמה בין משפחות-טכניקה (לא רק מה שהמפעיל מציע)
//
// פלט: דיג'סט חתום (שרשרת-גיבוב sha256 — אותה-שיטת-ראיה של יומן-
// ההחלטות) עם מקורות/URL/טיימסטמפים — sovereign/scout/.
//
// חוקי-ברזל:
//   · אפס מפתחות, אפס כתיבה למערכות-כסף — חיפוש-רשת ציבורי בלבד
//   · אפס המצאה: כל ממצא נושא URL + ציטוט; אפס-ממצאים = מדידה לגיטימית
//     שנרשמת zero-findings; שגיאת-חיפוש נרשמת error — לא "הכל טוב"
//   · טיימר-יחיד · שרת-יחיד · כתיבת-מצב אטומית · מתג-איש-מת (r143-c)
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import ZAI from "z-ai-web-dev-sdk";

declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const PORT = 3044;
const BEAT_SEC = 6 * 60 * 60; // סיור חוץ כל 6 שעות (≈4 סיורים-מלאים ליממה)
const HOME = "/home/z/my-project";
const SCOUT_DIR = path.join(HOME, "sovereign", "scout");
const STATE_FILE = path.join(SCOUT_DIR, "state.json");
const CHAIN_FILE = path.join(SCOUT_DIR, "digests.json");
const LATEST_FILE = path.join(SCOUT_DIR, "latest-digest.json");
const LATEST_MD = path.join(SCOUT_DIR, "latest-digest.md");
const LOG_FILE = path.join(HOME, "sovereign", "keeper", "logs", "scout-market-daemon.log");
const COINGECKO = "https://api.coingecko.com/api/v3/simple/price?ids=steem&vs_currencies=usd";

// ── רוטציית-שאילתות חכמה: כל פעימה מרחיבה כיסוי, לא חוזרת על עצמה ──
const COMPETITIVE_QUERIES = [
  "AI agent verification network protocol",
  "decentralized AI agent identity reputation project",
  "proof of personhood for AI agents",
  "on-chain AI agent economy protocol",
];
const BREAKTHROUGH_FAMILIES = [
  "content provenance cryptographic signing technique",
  "sybil resistance mechanism design",
  "decentralized reputation system design",
  "verifiable credentials AI agents standard",
  "multi-agent protocol interoperability standard",
];

interface SearchSource {
  url: string;
  name: string;
  snippet: string;
  date: string;
  host: string;
  query: string;
}

interface QueryMeasurement {
  query: string;
  resultCount: number;
  error: string | null;
  recencyDays: number | null;
}

interface TrackResult {
  id: "steem-market" | "competitive-landscape" | "breakthrough-candidate";
  status: "measured" | "zero-findings" | "error";
  queries: QueryMeasurement[];
  sources: SearchSource[];
  note: string;
}

interface Insight {
  id: string;
  text: string;
  sourceUrls: string[];
  numbers: Record<string, number | string | boolean | null>;
}

interface DigestEntry {
  format: "scout-market-digest-v1";
  seq: number;
  at: string;
  week: string;
  durationMs: number;
  tracks: TrackResult[];
  priceContext: { measured: boolean; usd: number | null; source: string; note: string };
  insights: Insight[];
  prevHash: string;
  entryHash: string;
}

interface ScoutState {
  service: "scout-market";
  format: "scout-market-daemon-state-v1";
  bootedAt: string;
  beats: number;
  lastBeatAt: string | null;
  lastOk: boolean | null;
  failStreak: number;
  verdict: "SCOUTING" | "SEARCH-DOWN" | "BOOTING";
  digestsCount: number;
  lastDigestAt: string | null;
  lastBreakthroughWeek: string | null;
  lastError: string | null;
}

function isoWeek(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function readState(): ScoutState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as ScoutState;
    if (raw && raw.service === "scout-market") return raw;
  } catch {}
  return {
    service: "scout-market",
    format: "scout-market-daemon-state-v1",
    bootedAt: new Date().toISOString(),
    beats: 0,
    lastBeatAt: null,
    lastOk: null,
    failStreak: 0,
    verdict: "BOOTING",
    digestsCount: 0,
    lastDigestAt: null,
    lastBreakthroughWeek: null,
    lastError: null,
  };
}

const G = globalThis as unknown as { __SCOUT_STATE__?: ScoutState };
const state: ScoutState = G.__SCOUT_STATE__ ?? readState();
G.__SCOUT_STATE__ = state;

function saveState(): void {
  try {
    fs.mkdirSync(SCOUT_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, STATE_FILE);
  } catch {}
}

function appendLog(line: string): void {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// ── SDK סינגלטון (שרת-בלבד) + חיפוש-משוחרר-זמן ──────────────────────
let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null;
function getZai() {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

const SEARCH_TIMEOUT_MS = 60_000;
const SEARCH_GAP_MS = 4_000; // r146-b מדוד: חיפושים-מקבילים ספגו 429 Too-many-requests — מעתה סדרתי עם רווח

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** חיפוש אחד + ניסיון-חוזר יחיד על 429 (אחרי 10ש') — כנות: השגיאה האמיתית נרשמת אם נשארת */
async function webSearchRobust(query: string, num: number, recencyDays: number | null): Promise<{ items: SearchSource[]; error: string | null }> {
  const first = await webSearch(query, num, recencyDays);
  if (first.error == null || !/429|too many/i.test(first.error)) return first;
  await sleep(10_000);
  const second = await webSearch(query, num, recencyDays);
  return second.items.length > 0 ? second : { items: [], error: `${first.error} (retried: ${second.error ?? "0 results"})` };
}

async function webSearch(query: string, num: number, recencyDays: number | null): Promise<{ items: SearchSource[]; error: string | null }> {
  try {
    const zai = await getZai();
    const args = { query, num, ...(recencyDays != null ? { recency_days: recencyDays } : {}) };
    const raced = await Promise.race([
      zai.functions.invoke("web_search", args),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("search-timeout")), SEARCH_TIMEOUT_MS)),
    ]);
    const arr = Array.isArray(raced) ? raced : [];
    const items: SearchSource[] = arr.map((r: unknown) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        url: String(o.url ?? ""),
        name: String(o.name ?? ""),
        snippet: String(o.snippet ?? "").slice(0, 400),
        date: String(o.date ?? ""),
        host: String(o.host_name ?? ""),
        query,
      };
    });
    return { items: items.filter((s) => /^https?:\/\//.test(s.url)), error: null };
  } catch (e) {
    return { items: [], error: String((e as Error)?.message ?? e).slice(0, 140) };
  }
}

// ── מדידת-מחיר חיה מ-CoinGecko (ציבורי, ללא מפתח, fail-soft כנה) ────
async function measureSteemPrice(): Promise<{ measured: boolean; usd: number | null; source: string; note: string }> {
  try {
    const res = await fetch(COINGECKO, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!res.ok) return { measured: false, usd: null, source: "coingecko", note: `HTTP ${res.status} — unmeasured` };
    const j = (await res.json()) as { steem?: { usd?: number } };
    const usd = j.steem?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd)) {
      return { measured: false, usd: null, source: "coingecko", note: "no usd field — unmeasured" };
    }
    return { measured: true, usd, source: "coingecko", note: `STEEM=${usd} USD (live API)` };
  } catch (e) {
    return { measured: false, usd: null, source: "coingecko", note: `unreachable: ${String((e as Error)?.message ?? e).slice(0, 80)}` };
  }
}

function dedupeSources(items: SearchSource[]): SearchSource[] {
  const seen = new Set<string>();
  return items.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

// ── גילוי-תובנות: חילוץ תוכנתי כן מהתוצאות — מספרים וציטוטים בלבד ──
function extractInsights(tracks: TrackResult[], price: DigestEntry["priceContext"], seq: number): Insight[] {
  const out: Insight[] = [];

  // (a) שוק: טווח-מחיר חוצה-מקורות מתוך הציטוטים + מחיר-API חי
  const market = tracks.find((t) => t.id === "steem-market");
  if (market) {
    const prices: number[] = [];
    for (const s of market.sources) {
      for (const m of s.snippet.matchAll(/\$(\d+\.\d+)\b/g)) {
        const v = Number(m[1]);
        if (Number.isFinite(v) && v > 0.001 && v < 100) prices.push(v);
      }
    }
    if (price.measured || prices.length > 0) {
      const min = prices.length ? Math.min(...prices) : null;
      const max = prices.length ? Math.max(...prices) : null;
      out.push({
        id: `INS-${seq}-MKT`,
        text:
          `הקשר-מחיר STEEM: API חי ${price.measured ? `$${price.usd}` : "unmeasured"}` +
          (min != null && max != null ? ` · טווח-ציטוטים חוצה-מקורות $${min}..$${max} (${prices.length} אזכורי-מחיר ב-${market.sources.length} מקורות)` : ` · אזכורי-מחיר בציטוטים: ${prices.length}`),
        sourceUrls: market.sources.slice(0, 4).map((s) => s.url),
        numbers: { apiUsd: price.usd, quoteMin: min, quoteMax: max, quoteMentions: prices.length, sources: market.sources.length },
      });
    }
  }

  // (b) תחרות: מה הנוף הציבורי באמת מראה — מארחים נבדלים + פרויקטים מצוטטים
  const comp = tracks.find((t) => t.id === "competitive-landscape");
  if (comp && comp.sources.length > 0) {
    const hosts = [...new Set(comp.sources.map((s) => s.host))];
    out.push({
      id: `INS-${seq}-COMP`,
      text: `נוף-תחרות: ${comp.sources.length} תוצאות על ${hosts.length} מארחים נבדלים · מצוטטים-ראשונים: ${comp.sources.slice(0, 3).map((s) => s.name.slice(0, 60)).join(" | ")}`,
      sourceUrls: comp.sources.slice(0, 4).map((s) => s.url),
      numbers: { results: comp.sources.length, distinctHosts: hosts.length, queries: comp.queries.length },
    });
  }

  // (c) מועמד-פריצה: התוצאה-הראשונה של משפחת-הטכניקה השבועית — מועמד-הערכה, לא אימוץ
  const bt = tracks.find((t) => t.id === "breakthrough-candidate");
  if (bt && bt.sources.length > 0) {
    const c = bt.sources[0]!;
    out.push({
      id: `INS-${seq}-BT`,
      text: `מועמד-פריצה (שבוע ${isoWeek()}): "${c.name.slice(0, 90)}" — ${c.snippet.slice(0, 160)} · מועמד-הערכה בלבד, לא אומץ`,
      sourceUrls: [c.url, ...bt.sources.slice(1, 3).map((s) => s.url)],
      numbers: { candidateResults: bt.sources.length, week: isoWeek() },
    });
  }

  return out;
}

// ── שרשרת-גיבוב: הרשומה חתומה על כל-תוכנה פרט ל-entryHash שלה ──────
function hashEntry(e: Omit<DigestEntry, "entryHash">): string {
  const { entryHash: _omit, ...rest } = e as unknown as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

function readChain(): { entries: DigestEntry[] } {
  try {
    const raw = JSON.parse(fs.readFileSync(CHAIN_FILE, "utf8")) as { entries?: DigestEntry[] };
    if (raw && Array.isArray(raw.entries)) return { entries: raw.entries };
  } catch {}
  return { entries: [] };
}

function toMarkdown(d: DigestEntry): string {
  const L: string[] = [];
  L.push(`# דיג'סט-סייר-השוק · seq ${d.seq} · ${d.at}`);
  L.push("");
  L.push(`שבוע: ${d.week} · משך-סיור: ${Math.round(d.durationMs / 1000)}s · שרשרת: ${d.prevHash.slice(0, 10)}… → ${d.entryHash.slice(0, 10)}…`);
  L.push("");
  L.push(`## הקשר-מחיר STEEM`);
  L.push(d.priceContext.measured ? `- API חי: **$${d.priceContext.usd}** (${d.priceContext.source})` : `- ${d.priceContext.note} (unmeasured — נרשם בכנות)`);
  for (const t of d.tracks) {
    L.push("");
    L.push(`## ${t.id} — ${t.status}`);
    for (const q of t.queries) L.push(`- שאילתא: "${q.query}" → ${q.resultCount} תוצאות${q.error ? ` · שגיאה: ${q.error}` : ""}${q.recencyDays != null ? ` (חלון ${q.recencyDays} ימים)` : ""}`);
    for (const s of t.sources.slice(0, 6)) {
      L.push(`- [${s.name.slice(0, 90)}](${s.url}) — ${s.host}${s.date ? ` · ${s.date}` : ""}`);
      if (s.snippet) L.push(`  > ${s.snippet.slice(0, 180)}`);
    }
  }
  if (d.insights.length) {
    L.push("");
    L.push(`## תובנות חתומות`);
    for (const i of d.insights) {
      L.push(`- **${i.id}**: ${i.text}`);
      for (const u of i.sourceUrls) L.push(`  - מקור: ${u}`);
    }
  }
  L.push("");
  return L.join("\n");
}

function writeDigest(d: DigestEntry): void {
  try {
    fs.mkdirSync(SCOUT_DIR, { recursive: true });
    const day = d.at.slice(0, 10);
    const pretty = JSON.stringify(d, null, 2);
    const writeAtomic = (p: string, content: string) => {
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, content, "utf8");
      fs.renameSync(tmp, p);
    };
    writeAtomic(LATEST_FILE, pretty);
    writeAtomic(path.join(SCOUT_DIR, `digest-${day}.json`), pretty);
    writeAtomic(LATEST_MD, toMarkdown(d));
    writeAtomic(path.join(SCOUT_DIR, `digest-${day}.md`), toMarkdown(d));
    const chain = readChain();
    chain.entries.push(d);
    writeAtomic(CHAIN_FILE, JSON.stringify(chain, null, 2));
  } catch (e) {
    appendLog(`write-digest-failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
}

// ── הסיור עצמו ──────────────────────────────────────────────────────
async function runScout(): Promise<DigestEntry> {
  const started = Date.now();
  const week = isoWeek();
  const weeklyDue = state.lastBreakthroughWeek !== week; // ריצה-ראשונה כוללת — מדידה מלאה מהיום-הראשון

  const beatIdx = state.beats;
  const compQuery = COMPETITIVE_QUERIES[beatIdx % COMPETITIVE_QUERIES.length]!;
  const btQuery = BREAKTHROUGH_FAMILIES[(Number(week.replace(/\D/g, "")) + beatIdx) % BREAKTHROUGH_FAMILIES.length]!;

  // r146-b מדוד: סדרתי עם רווח-4ש' (מקביליות ספגה 429); מדידת-המחיר על מארח אחר — פרללית
  const pricePromise = measureSteemPrice();
  const mkt1 = await webSearchRobust("STEEM price", 6, 7);
  await sleep(SEARCH_GAP_MS);
  const mkt2 = await webSearchRobust("Steem blockchain news", 6, 7);
  await sleep(SEARCH_GAP_MS);
  const comp = await webSearchRobust(compQuery, 8, null);
  let bt: { items: SearchSource[]; error: string | null } | null = null;
  if (weeklyDue) {
    await sleep(SEARCH_GAP_MS);
    bt = await webSearchRobust(btQuery, 8, 90);
  }
  const price = await pricePromise;

  const mkTrack = (
    id: TrackResult["id"],
    results: Array<{ items: SearchSource[]; error: string | null }>,
    queries: Array<{ query: string; recencyDays: number | null }>,
    note: string,
  ): TrackResult => {
    const qm: QueryMeasurement[] = results.map((r, i) => ({
      query: queries[i]!.query,
      resultCount: r.items.length,
      error: r.error,
      recencyDays: queries[i]!.recencyDays,
    }));
    const all = dedupeSources(results.flatMap((r) => r.items));
    const anyError = results.some((r) => r.error != null);
    const status: TrackResult["status"] = all.length > 0 ? "measured" : anyError ? "error" : "zero-findings";
    return { id, status, queries: qm, sources: all, note };
  };

  const tracks: TrackResult[] = [
    mkTrack("steem-market", [mkt1, mkt2], [
      { query: "STEEM price", recencyDays: 7 },
      { query: "Steem blockchain news", recencyDays: 7 },
    ], "חדשות-שוק והקשר-מחיר מהרשת הפתוחה"),
    mkTrack("competitive-landscape", [comp], [{ query: compQuery, recencyDays: null }], "רוטציית-כיסוי: שאילתת-תחרות אחרת בכל פעימה"),
  ];
  if (weeklyDue && bt) {
    tracks.push(mkTrack("breakthrough-candidate", [bt], [{ query: btQuery, recencyDays: 90 }], `רוטציית-משפחות-טכניקה (שבוע ${week})`));
  }

  const prev = readChain();
  const last = prev.entries[prev.entries.length - 1];
  const seq = (last?.seq ?? 0) + 1;

  const withoutHash: Omit<DigestEntry, "entryHash"> = {
    format: "scout-market-digest-v1",
    seq,
    at: new Date().toISOString(),
    week,
    durationMs: Date.now() - started,
    tracks,
    priceContext: price,
    insights: [],
    prevHash: last?.entryHash ?? "GENESIS",
  };
  const withInsights: Omit<DigestEntry, "entryHash"> = { ...withoutHash, insights: extractInsights(tracks, price, seq) };
  const sealed: DigestEntry = { ...withInsights, entryHash: hashEntry(withInsights) };

  if (weeklyDue) state.lastBreakthroughWeek = week;
  state.digestsCount = seq;
  state.lastDigestAt = sealed.at;
  return sealed;
}

async function beat(): Promise<void> {
  state.beats += 1;
  state.lastBeatAt = new Date().toISOString();
  try {
    const digest = await runScout();
    writeDigest(digest);
    state.lastOk = true;
    state.failStreak = 0;
    state.verdict = "SCOUTING";
    state.lastError = null;
    appendLog(`scout-beat seq=${digest.seq} tracks=${digest.tracks.map((t) => `${t.id}:${t.status}`).join(",")} insights=${digest.insights.length}`);
  } catch (e) {
    state.lastOk = false;
    state.failStreak += 1;
    state.lastError = String((e as Error)?.message ?? e).slice(0, 160);
    if (state.failStreak >= 3) state.verdict = "SEARCH-DOWN";
    appendLog(`beat-failed: ${state.lastError}`);
  }
  saveState();
}

function verifyChainOnDisk(): { ok: boolean; brokenAt: number | null; entries: number } {
  const entries = readChain().entries;
  let prevHash = "GENESIS";
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (i === 0 ? e.prevHash !== "GENESIS" : e.prevHash !== prevHash) return { ok: false, brokenAt: e.seq, entries: entries.length };
    const { entryHash: _omit, ...rest } = e as unknown as Record<string, unknown>;
    if (hashEntry(rest as Omit<DigestEntry, "entryHash">) !== e.entryHash) return { ok: false, brokenAt: e.seq, entries: entries.length };
    prevHash = e.entryHash;
  }
  return { ok: true, brokenAt: null, entries: entries.length };
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: state.verdict !== "SEARCH-DOWN", ...state });
    }
    if (url.pathname === "/beat" && req.method === "POST") {
      await beat();
      return json({ ok: state.lastOk === true, ...state });
    }
    if (url.pathname === "/digest") {
      try {
        return json(JSON.parse(fs.readFileSync(LATEST_FILE, "utf8")));
      } catch (e) {
        return json({ ok: false, error: `no digest yet (${String((e as Error)?.message ?? e).slice(0, 60)})` }, 502);
      }
    }
    if (url.pathname === "/chain") {
      return json({ ...verifyChainOnDisk() });
    }
    return json({ ok: false, error: "not-found", hint: "/ · /health · POST /beat · /digest · /chain" }, 404);
  },
});

// פעימה ראשונה אחרי 15ש' — הסיור הראשון נמדד מיד אחרי העלייה
setTimeout(beat, 15_000);
setInterval(beat, BEAT_SEC * 1000);

// ── r143-c · מתג-איש-מת: טיק 60ש' · שתיקה מעל max(3×קצב, 10 דק') ⇒ יציאה ──
const DEAD_MAN_TICK_MS = 60_000;
const DEAD_MAN_STALL_MS = Math.max(3 * BEAT_SEC * 1000, 10 * 60 * 1000);
const DEAD_MAN_LOG = LOG_FILE;
setInterval(() => {
  const lastMs = state.lastBeatAt ? Date.parse(state.lastBeatAt) : Date.parse(state.bootedAt);
  if (Number.isFinite(lastMs) && Date.now() - lastMs <= DEAD_MAN_STALL_MS) return;
  const msg = `dead-man: beats stalled >${Math.round(DEAD_MAN_STALL_MS / 60_000)}min — exiting for revival`;
  try {
    fs.mkdirSync(path.dirname(DEAD_MAN_LOG), { recursive: true });
    fs.appendFileSync(DEAD_MAN_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log(msg);
  process.exit(1);
}, DEAD_MAN_TICK_MS);

try {
  appendLog(`scout-market daemon up on ${PORT} (scout every ${BEAT_SEC}s, dead-man ${Math.round(DEAD_MAN_STALL_MS / 60_000)}min)`);
} catch {}
