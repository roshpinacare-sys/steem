// ─────────────────────────────────────────────────────────────────────
// CONTENT FACTORY · מפעל-התוכן (r149 · "הייצור" · פורט 3046)
//
// העסק החמישי B-5-content-factory — מכונת-ההכנסה הראשונה של הרשת שאינה
// תלוית-הון: תגמולי-פרסום על Steem מתמחקים באיכות ובתשומת-לב-חוץ, לא
// בסכום-שיושב. המפעל מייצר פוסטים באנגלית לקהילות-השרשרת, מנתונים
// מדודים-חיים בלבד — אפס מספרים מהזיכרון, אפס סלופ.
//
//   מוצר א' "measured-ledger" — משכנתא-הנתונים היומית: שערי-STEEM/SBD,
//           פריסת-ספר-השוק, הספרים-האמתיים שלנו (הכנות היא המותג).
//   מוצר ב' "agents-at-work" — יומן-בניין: מה המכונות בנו/הוכיחו
//           ב-24 שעות — סיפור-הנדסה אמיתי של רשת-סוכנים ריבונית.
//
// משמעת:
//   · תקציב — גג 2 פרסומים/יום (אחד לכל מוצר); כל פרסום עובר שער-כלכלה
//     (/api/econ-gate · spend=true) — REVIEW/DENY ⇒ אין שידור, נרשם כן.
//   · איכות — LLM (z-ai-web-dev-sdk · שרת-בלבד) מקבל רק חבילת-מדידה חיה
//     וההוראה המחייבת: כל מספר מהחבילה בלבד; כישלון-ייצור ⇒ אין פרסום.
//   · שורת-הרג — 7 פוסטי-מפעל רצופים עם 0 הצבעות ⇒ FORMAT-REVIEW
//     נרשם במצב וביומן (אותה משמעת של B-2).
//   · אפס מפתחות כאן — החתימה כולה בצד-הבית (/api/publish).
//
// חוקי-ברזל: טיק-יחיד בטיסה · כל fetch עטוף עם AbortSignal.timeout(15000)
// · כתיבת-מצב אטומית דרך ../shared · מתג-איש-מת (r143-c) · יומן-ראיה
// שורה-קומפקטית לכל אירוע.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import ZAI from "z-ai-web-dev-sdk";
import { installDeadManWatch, writeJsonAtomic } from "../shared";

declare const Bun: {
  serve: (opts: {
    port: number;
    hostname?: string;
    fetch: (req: Request) => Promise<Response> | Response;
  }) => unknown;
};

const PORT = 3046;
const TICK_MS = 6 * 60 * 60 * 1000; // קצב: כל 6 שעות — 4 הזדמנויות-הפקה ליום
const BOOT_DELAY_MS = 90 * 1000; // הטיק-הראשון: 90ש' אחרי-עלייה
const HOME_API = "http://127.0.0.1:3000";
const STEEM_RPC = "https://api.steemit.com";
const HOME = "/home/z/my-project";
const BIZ_DIR = path.join(HOME, "sovereign", "businesses");
const STATE_FILE = path.join(BIZ_DIR, "content-factory-state.json");
const LOG_FILE = path.join(BIZ_DIR, "content-log.jsonl");
const HEARTBEAT = path.join(BIZ_DIR, "content-heartbeat.log");
const AUTHOR = "headcorner";

const MAX_POSTS_PER_DAY = 2; // גג-מפעל: אחד לכל מוצר
const FACTORY_KILL_ZERO_VOTES = 7; // שורת-הרג: 7 פוסטים רצופים בלי הצבעות
const MIN_BODY_CHARS = 2200; // איכות-מינימום: פוסט-רזה לא נתפס בידי-אוצרים
const LLM_TIMEOUT_MS = 90_000;
// חוק r143-c: dead-man = max(3×קצב, 10 דק') — קצב המפעל 6ש' ⇒ סף 18ש'.
// ליקוי r150: היה כאן 45דק' — המתין-המת הרג כל-מופע חי לפני-הטיק-הבא (מוות-מחזורי).
const DEADMAN_STALL_MS = 18 * 60 * 60 * 1000;
const OWNER_FILE = path.join(HOME, "upload", "headcorner.txt");

// ── מצב המפעל ───────────────────────────────────────────────────────────

interface FactoryPost {
  line: "measured-ledger" | "agents-at-work";
  day: string;
  at: string;
  title: string;
  permlink: string;
  txid: string | null;
  url: string | null;
  gateScore: number | null;
  gateVerdict: string | null;
  chars: number;
  engagement?: PostEngagement | null;
}

interface FactoryState {
  service: "content-factory";
  format: "content-factory-state-v1";
  bootedAt: string;
  ticks: number;
  lastTickAt: string | null;
  cadence: "6h";
  posts: FactoryPost[];
  budget: { postsToday: number; postDay: string };
  linesDoneToday: { measuredLedgerDay: string | null; agentsAtWorkDay: string | null };
  zeroVoteStreak: number;
  killLineTripped: boolean;
  lastEngagementAt: string | null;
  lastError: string | null;
}

function freshState(): FactoryState {
  return {
    service: "content-factory",
    format: "content-factory-state-v1",
    bootedAt: new Date().toISOString(),
    ticks: 0,
    lastTickAt: null,
    cadence: "6h",
    posts: [],
    budget: { postsToday: 0, postDay: utcDay() },
    linesDoneToday: { measuredLedgerDay: null, agentsAtWorkDay: null },
    zeroVoteStreak: 0,
    killLineTripped: false,
    lastEngagementAt: null,
    lastError: null,
  };
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function readState(): FactoryState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as FactoryState;
    if (raw && raw.service === "content-factory" && raw.format === "content-factory-state-v1") {
      // אימוץ-תחייה (r150): מצב-ישן ממופע-מת לא יהרוג מופע-חדש —
      // lastTickAt ישן-מעל-הסף מתאפס, הבסיס-של-המת נולד מ-bootedAt.
      const stale = raw.lastTickAt ? Date.now() - Date.parse(raw.lastTickAt) : Infinity;
      if (stale > DEADMAN_STALL_MS) raw.lastTickAt = null;
      // יום-חדש UTC ⇒ איפוס-מונים יומיים (שמירת-יום, לא מחיקת-היסטוריה)
      const today = utcDay();
      if (raw.budget.postDay !== today) {
        raw.budget = { postsToday: 0, postDay: today };
        raw.linesDoneToday = { measuredLedgerDay: null, agentsAtWorkDay: null };
      }
      return raw;
    }
  } catch {
    /* ריצה ראשונה */
  }
  return freshState();
}

const G = globalThis as unknown as { __CF_STATE__?: FactoryState };
const state: FactoryState = G.__CF_STATE__ ?? readState();
G.__CF_STATE__ = state;

function saveState(): void {
  writeJsonAtomic(STATE_FILE, state);
}

function logEvent(kind: string, detail: string): void {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), kind, detail: detail.slice(0, 240) });
    fs.appendFileSync(LOG_FILE, `${line}\n`, "utf8");
  } catch {}
}

// ── עזרי-רשת — fail-soft: null הוא null, לא 0 ───────────────────────────

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function postJson<T>(url: string, payload: unknown): Promise<{ status: number; body: T | null } | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    let body: T | null = null;
    try {
      body = (await res.json()) as T;
    } catch {}
    return { status: res.status, body };
  } catch {
    return null;
  }
}

// ── חבילת-המדידה — כל מספר ממקור-חי עם שמו ──────────────────────────────

interface MeasureBundle {
  measuredAt: string;
  prices: { steemUsd: number | null; sbdUsd: number | null; parity: number | null };
  balances: { steem: number | null; sbd: number | null };
  orders: { steemInOrders: number | null; capitalUsd: number | null; steemTotal: number | null; sbdTotal: number | null };
  market: { bestBid: number | null; bestAsk: number | null; spreadPct: number | null };
  pnl: { realizedSbd: number | null; trips: number | null; fills: number | null };
  income: { usdPerDay7d: number | null; daysRecorded: number | null };
  claim: { rewardSteem: number | null; rewardSbd: number | null; rewardVests: number | null; claimable: boolean | null };
  pulse: { chainsTotal: number | null; chainOk: number | null; totalRuns24h: number | null; okRuns24h: number | null; businesses: number | null; businessesRequests: number | null };
  curation: { votesToday: number | null };
  engine: { ticks: number | null; lastBriefDay: string | null; briefVotes: number | null };
  audience: { externalVotes7d: number | null; externalRepliers: number | null; externalComments: number | null };
}

async function measureBundle(): Promise<MeasureBundle> {
  const [money, pnl, claim, pulse, mission] = await Promise.all([
    getJson<Record<string, unknown>>(`${HOME_API}/api/money`),
    getJson<Record<string, unknown>>(`${HOME_API}/api/economy/pnl`),
    getJson<Record<string, unknown>>(`${HOME_API}/api/money/claim`),
    getJson<Record<string, unknown>>(`${HOME_API}/api/public/pulse`),
    getJson<Record<string, unknown>>(`${HOME_API}/api/mission`),
  ]);
  const curation = getJsonSync(path.join(HOME, "sovereign", "curation", "state.json"));
  const engine = getJsonSync(path.join(HOME, "sovereign", "businesses", "engine-state.json"));
  const audience = getJsonSync(path.join(HOME, "sovereign", "audience", "latest-digest.json"));

  const marks = (money?.marks ?? {}) as Record<string, number>;
  const balances = (money?.balances ?? {}) as Record<string, number>;
  const book = (money?.book ?? {}) as { bids?: Array<{ price: number }>; asks?: Array<{ price: number }> };
  // ההון-המלא מ-/api/mission (נזילי + מוצב בפקודות — התמונה-המלאה, לא רק הנזיל)
  const mCapital = (mission?.capital ?? {}) as Record<string, number>;
  const mMeasured = (mission?.measured ?? {}) as Record<string, number>;
  const capital = (pnl?.capital ?? {}) as Record<string, number>;
  const realized = (pnl?.realized ?? {}) as Record<string, number>;
  const house = (pnl?.house ?? {}) as Record<string, number>;
  const chains = Array.isArray(pulse?.chains) ? (pulse?.chains as Array<Record<string, number>>) : [];
  const chainSum = chains.reduce(
    (a, c) => ({ runs: a.runs + (c.runs24h ?? 0), ok: a.ok + (c.ok24h ?? 0) }),
    { runs: 0, ok: 0 },
  );
  const pulsePnl = (pulse?.pnl ?? {}) as Record<string, number>;
  const usage = (pulse?.usage ?? (pulse?.businessesUsage ?? {})) as Record<string, number>;
  const claimBody = (claim?.claim ?? claim) as Record<string, number>;
  const businessesList: unknown[] = Array.isArray(pulse?.businesses)
    ? (pulse?.businesses as unknown[])
    : Array.isArray((pulse?.registry as { businesses?: unknown[] } | undefined)?.businesses)
      ? ((pulse?.registry as { businesses?: unknown[] }).businesses as unknown[])
      : [];

  let bestBid: number | null = Array.isArray(book.bids) && book.bids[0] ? Number(book.bids[0].price) : null;
  let bestAsk: number | null = Array.isArray(book.asks) && book.asks[0] ? Number(book.asks[0].price) : null;
  const spreadPct =
    bestBid != null && bestAsk != null && bestBid > 0 ? Number((((bestAsk - bestBid) / bestBid) * 100).toFixed(3)) : null;

  return {
    measuredAt: new Date().toISOString(),
    prices: {
      steemUsd: num(marks.steemUsd),
      sbdUsd: num(marks.sbdUsd),
      parity: num(marks.parity),
    },
    balances: { steem: num(balances.steem), sbd: num(balances.sbd) },
    orders: {
      steemInOrders: num(mCapital.steemInOrders) ?? num(capital.steemInOrders),
      capitalUsd: num(mCapital.capitalUsd) ?? num(capital.capitalUsd),
      steemTotal: num(mCapital.steemTotal),
      sbdTotal: num(mCapital.sbdTotal),
    },
    market: { bestBid, bestAsk, spreadPct },
    pnl: {
      realizedSbd: num(realized.capturedSbd ?? pulsePnl.realizedSbd),
      trips: num(realized.trips ?? pulsePnl.trips),
      fills: num(realized.fillsTotal ?? pulsePnl.fillsTotal ?? house.fillsTotal),
    },
    income: {
      usdPerDay7d: num(mMeasured.usdPerDay7dAvg) ?? num(pulsePnl.usdPerDay7dAvg),
      daysRecorded: num(mMeasured.daysRecorded) ?? num(pulsePnl.daysRecorded),
    },
    claim: {
      rewardSteem: num(claimBody.rewardSteem),
      rewardSbd: num(claimBody.rewardSbd),
      rewardVests: num(claimBody.rewardVests),
      claimable: typeof claimBody.claimable === "boolean" ? claimBody.claimable : null,
    },
    pulse: {
      chainsTotal: num(pulse?.chainsTotal),
      chainOk: num(pulse?.chainOk),
      totalRuns24h: chainSum.runs || num(pulse?.totalRuns24h),
      okRuns24h: chainSum.ok || num(pulse?.okRuns24h),
      businesses: businessesList.length || null,
      businessesRequests: num(usage.requests ?? usage.businesses),
    },
    curation: { votesToday: num(curation?.votesToday) },
    engine: {
      ticks: num(engine?.ticks),
      lastBriefDay: typeof engine?.lastBriefDay === "string" ? engine.lastBriefDay : null,
      briefVotes: num(engine?.lastBriefVotes),
    },
    audience: {
      externalVotes7d: num(audience?.externalVotes7d),
      externalRepliers: num(audience?.externalRepliers7d ?? audience?.externalRepliers),
      externalComments: num(audience?.externalComments7d ?? audience?.externalComments),
    },
  };
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function getJsonSync(p: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── ה-LLM — ייצור-תוכן מחבילה-מדודה בלבד ────────────────────────────────

let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null;
function getZai(): Promise<Awaited<ReturnType<typeof ZAI.create>>> {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

interface Draft {
  title: string;
  body: string;
}

function bundleBlock(b: MeasureBundle): string {
  return JSON.stringify(b, null, 1);
}

// r152 — טעינת-תפקיד-מומחה מהספרייה (fail-soft)
const ROLE_LIBRARY_PATH = path.join(HOME, "sovereign", "agents", "role-library.json");
let roleLibraryCache: { at: number; roles: Record<string, string> } | null = null;

// r157 — דוקטרינת-כתיבה מהספרייה המאווזרת (claude-skills · MIT · commit 19392f7a) — fail-soft,
// באותו דפוס של שכבת-r152: כשל-קריאה = ריצה-בלי-שכבה, אף-פעם-לא-חוסם-ייצור.
// מטרה-מדידה: איכות-כתיבה ↔ הצבעות ↔ תגמולי-פרסום (הטריז היחידה שבשליטתנו מלאה).
const WRITING_DOCTRINE_PATH = path.join(HOME, "sovereign", "knowledge", "writing-doctrine.json");
let writingDoctrineCache: { at: number; text: string | null } | null = null;
function loadWritingDoctrine(): string | null {
  try {
    if (!writingDoctrineCache || Date.now() - writingDoctrineCache.at > 600_000) {
      const doc = JSON.parse(fs.readFileSync(WRITING_DOCTRINE_PATH, "utf8")) as {
        status?: string;
        adapted_en?: string;
      };
      writingDoctrineCache = {
        at: Date.now(),
        text: doc.status === "wired" && doc.adapted_en ? doc.adapted_en : null,
      };
    }
    return writingDoctrineCache.text;
  } catch {
    return null;
  }
}
function loadExpertRole(roleId: string): string | null {
  try {
    if (!roleLibraryCache || Date.now() - roleLibraryCache.at > 600_000) {
      const lib = JSON.parse(fs.readFileSync(ROLE_LIBRARY_PATH, "utf8")) as {
        roles?: Array<{ id?: string; adapted_en?: string; status?: string }>;
      };
      const map: Record<string, string> = {};
      for (const r of lib.roles ?? []) {
        if (r.id && r.adapted_en && r.status === "wired") map[r.id] = r.adapted_en;
      }
      roleLibraryCache = { at: Date.now(), roles: map };
    }
    return roleLibraryCache.roles[roleId] ?? null;
  } catch {
    return null;
  }
}

function systemPrompt(line: "measured-ledger" | "agents-at-work"): string {
  const role =
    line === "measured-ledger"
      ? `You write "The Measured Ledger" — a daily, honest, English-language market-and-books brief published on Steem by an autonomous AI-agent network.
The hook that makes it worth reading: the network publishes its REAL books — tiny income, real losses, real machines — and every number is measured live at publish time from the network's own public APIs. Radical transparency is the brand.`
      : `You write "Agents at Work" — an English engineering build-log published on Steem by an autonomous AI-agent network that runs itself: economic gates, kill-lines, evidence chains, git sovereignty.
The hook: real machines doing real work with receipts (txids, measurements, honest failures) — not a demo, not vaporware. The reader should feel what it is like to operate a self-verifying agent economy.`;

  // r152 — שכבת-דיסציפלינת-מומחה מספריית-התפקידים (prompts.chat · sovereign/agents/role-library.json).
  // מקור-האמת של התפקידים הוא קובץ-הספרייה; כשל-קריאה = ריצה-בלי-שכבה (fail-soft, אף-פעם-לא-חוסם-ייצור).
  const roleId = line === "measured-ledger" ? "R1-financial-analyst" : "R2-journalist";
  const roleLayer = loadExpertRole(roleId);
  const roleBlock = roleLayer
    ? `\nEXPERT ROLE DISCIPLINE (craft layer — subordinate to the HARD RULES below; the role shapes HOW you write, the rules govern WHAT you may claim):\n${roleLayer}\n`
    : "";

  // r157 — שכבת-דוקטרינת-כתיבה (claude-skills · MIT): כללי-איכות מזוקקים — hook, ספציפיות,
  // תועלת-על-תכונה, רעיון-אחד-לסעיף, שפה-פשוטה, שכנוע-כן-בלבד. fail-soft כמו שכבת-r152.
  const doctrineLayer = loadWritingDoctrine();
  const doctrineBlock = doctrineLayer ? `\n${doctrineLayer}\n` : "";

  return `${role}${roleBlock}${doctrineBlock}

HARD RULES (violating any makes the draft invalid):
1. Use ONLY the numbers from the MEASURED BUNDLE given in the user message. Never invent, round-beyond-display, or guess any figure. If a field is null, either omit it or say it was not reported this run.
2. Every number you mention must appear in the bundle (you may reformat: percentages, 2-decimal displays).
3. English, markdown. The body MUST be at least 2200 characters (roughly 350–550 words) — a thin post is rejected. Structure it: a lead paragraph, a markdown data table, a section on the network's real books, a section on what the machines did in the last 24h, and a closing insight paragraph. Short paragraphs, concrete language.
4. Tone: precise, dry, engineering-honest, no hype, no emoji spam, no crypto-shilling. It is fine — and on-brand — to state the income is currently tiny; the value is the honesty and the working machinery.
5. Do not ask readers for money or votes. No calls-to-farm. End with a one-line footer: "*Every number above was measured live from the network's public APIs at publish time — sources: /api/money · /api/economy/pnl · /api/money/claim · /api/public/pulse. Published autonomously by THE WEAVE's content factory.*"
6. Output STRICT JSON only: {"title": "<5-200 chars>", "body": "<markdown>"}`;
}

function userPrompt(line: "measured-ledger" | "agents-at-work", b: MeasureBundle, expandFrom?: number): string {
  const today = utcDay();
  const expand = expandFrom
    ? `\n\nIMPORTANT: Your previous draft was only ${expandFrom} characters — far below the 2200-character minimum. Write the FULL post now, expanded: develop each section with specific observations drawn from the bundle numbers (what each number implies, compare figures to each other), while keeping every factual statement anchored to the bundle.`
    : "";
  if (line === "measured-ledger") {
    return `Today is ${today} (UTC). MEASURED BUNDLE (the only allowed numbers):
${bundleBlock(b)}

Write today's "The Measured Ledger" post: prices, the internal SBD:STEEM spread, the network's real books (capital, realized PnL, daily income), pending rewards state, and what the machines did in the last 24h (runs, votes, posts). One honest insight paragraph: what the numbers say about where income comes from at this scale (hint: attention-based author rewards scale with quality, capital-based income is tiny — say it plainly, with the actual numbers).${expand}`;
  }
  return `Today is ${today} (UTC). MEASURED BUNDLE (the only allowed numbers):
${bundleBlock(b)}

Write today's "Agents at Work" build-log: what the fleet did in the last 24h (self-boot/fleet/pool-guard/compound/deposit chain runs, the daily brief, curation votes, the businesses desk with its businesses and public API usage counters, the econ gate budget). Tell it as an engineering story with the real numbers as receipts. One honest paragraph on the discipline system (hard caps, kill-lines, evidence per tick) and why an agent economy needs gates before it needs growth.${expand}`;
}

function stripFences(raw: string): string {
  const t = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return (fenced ? fenced[1]! : t).trim();
}

async function draftPost(line: "measured-ledger" | "agents-at-work", b: MeasureBundle): Promise<Draft | null> {
  const first = await draftOnce(line, b);
  if (!first) return null;
  // איכות-מינימום: טיוטה-רזה ⇒ ניסיון-הרחבה אחד עם משוב-האורך (בלי המצאה)
  if (first.body.length < MIN_BODY_CHARS) {
    logEvent("draft-thin", `${line}: ${first.body.length} chars < ${MIN_BODY_CHARS} — expansion pass`);
    const second = await draftOnce(line, b, first.body.length);
    if (second && second.body.length >= MIN_BODY_CHARS) return second;
    return null;
  }
  return first;
}

async function draftOnce(
  line: "measured-ledger" | "agents-at-work",
  b: MeasureBundle,
  expandFrom?: number,
): Promise<Draft | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const zai = await getZai();
    const completion = await Promise.race([
      zai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt(line) },
          { role: "user", content: userPrompt(line, b, expandFrom) },
        ],
        thinking: { type: "disabled" },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("llm-timeout-90s")), LLM_TIMEOUT_MS);
      }),
    ]);
    const raw: string = completion?.choices?.[0]?.message?.content ?? "";
    const parsed = raw.trim() ? safeParse(stripFences(raw)) : null;
    if (!parsed) return null;
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (title.length < 5 || title.length > 200) return null;
    if (body.length < 400 || body.length > 55_000) return null;
    return { title, body };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeParse(t: string): Record<string, unknown> | null {
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    const m = /\{[\s\S]*\}/.exec(t);
    if (m) {
      try {
        return JSON.parse(m[0]) as Record<string, unknown>;
      } catch {}
    }
    return null;
  }
}

// ── שער-הכלכלה — לפני כל שידור ──────────────────────────────────────────

interface GateVerdict {
  verdict?: string;
  score?: number;
  reasonsHe?: string[];
  budget?: { actionsToday?: number; cap?: number };
}

async function gateAsk(line: string, title: string, chars: number): Promise<GateVerdict | null> {
  const res = await postJson<{ ok: boolean; verdict?: GateVerdict; error?: string }>(`${HOME_API}/api/econ-gate`, {
    actionId: `cf-${line}-${Date.now().toString(36)}`,
    businessId: "B-5-content-factory",
    kind: "publish-content-steem",
    description: `Publish a factory post (${line}) to Steem as author content — "${title}" (${chars} chars, English, community tags). Marginal cost ≈ 0: content is generated from already-measured live data over existing publish rails; the only scarce resource is 1 of the daily broadcast budget slots.`,
    estimatedCost: "1 broadcast slot of the daily cap; chain op is zero-fee; RC headroom measured healthy",
    expectedValue:
      "author-rewards path (B-5): the only income lever that scales with quality not capital — measured baseline author income 0.451 STEEM/732 VESTS per 30d from 5 events; each post that catches external curators earns STEEM+SBD after 7 days; audience exists (external replies measured in 7d window)",
    killLineAware: true,
    reversible: false,
    spend: true,
    source: "mini-services/content-factory (B-5)",
  });
  return res?.body?.verdict ?? null;
}

// ── פרסום — מסילת-הבית (enqueue → broadcast → קבלה) ────────────────────

const TAGS: Record<"measured-ledger" | "agents-at-work", string[]> = {
  "measured-ledger": ["steem", "cryptocurrency", "marketreport", "ai-agents", "blockchain"],
  "agents-at-work": ["ai", "technology", "ai-agents", "blog", "blockchain"],
};

async function publishDraft(line: "measured-ledger" | "agents-at-work", draft: Draft): Promise<FactoryPost | null> {
  const enq = await postJson<{ ok: boolean; task?: { id: string } }>(`${HOME_API}/api/publish`, {
    action: "enqueue",
    kind: "CONTENT",
    lang: "EN",
    title: draft.title,
    body: draft.body,
    tags: TAGS[line],
  });
  const id = enq?.body?.task?.id;
  if (!id) {
    logEvent("enqueue-failed", `${line}: status=${enq?.status ?? "no-res"}`);
    return null;
  }
  let bc = await postJson<{ ok: boolean; receipt?: { permlink: string; txid: string | null; url: string }; he?: string }>(
    `${HOME_API}/api/publish`,
    { action: "broadcast", id },
  );
  const receipt = bc?.body?.receipt;

  // לקח-שרשרת (נמדד 2026-10-02T14:11Z): STEEM_MIN_ROOT_POST_INTERVAL = 5 דק'
  // בין פוסטי-שורש. השידור-השני בטיק נדחה על-ידי השרשרת עצמה. התיקון:
  // אם השרשרת סירבה מסיבת-מרווח — מחכים את היתרה + חיץ ומשדרים שוב (אותו
  // מזהה-תור: FAILED מותר-שידור-מחדש במסילת-הבית). ניסיון-חוזר אחד בלבד.
  if (!receipt && isMinRootPostRefusal(bc)) {
    const waitMs = msSinceLastPost() < 0 ? 0 : Math.max(0, ROOT_POST_GAP_MS - msSinceLastPost()) + 20_000;
    logEvent("min-root-post-wait", `${line}: chain-enforced gap — waiting ${Math.round(waitMs / 1000)}s then retrying once`);
    await sleep(waitMs);
    bc = await postJson<{ ok: boolean; receipt?: { permlink: string; txid: string | null; url: string }; he?: string }>(
      `${HOME_API}/api/publish`,
      { action: "broadcast", id },
    );
  }

  const finalReceipt = bc?.body?.receipt;
  if (!finalReceipt) {
    logEvent("broadcast-failed", `${line}: status=${bc?.status ?? "no-res"} he=${String(bc?.body?.he ?? "").slice(0, 80)}`);
    return null;
  }
  return {
    line,
    day: utcDay(),
    at: new Date().toISOString(),
    title: draft.title,
    permlink: finalReceipt.permlink,
    txid: finalReceipt.txid,
    url: finalReceipt.url,
    gateScore: null,
    gateVerdict: "ALLOWED-BEFORE-POST",
    chars: draft.body.length,
  };
}

const ROOT_POST_GAP_MS = 5 * 60 * 1000 + 15_000; // STEEM_MIN_ROOT_POST_INTERVAL + חיץ

function isMinRootPostRefusal(bc: { status?: number; body?: { he?: string } | null } | null): boolean {
  const he = String(bc?.body?.he ?? "");
  return (bc?.status === 502 || bc?.status === 400) && he.includes("STEEM_MIN_RO");
}

function msSinceLastPost(): number {
  const last = state.posts.at(-1);
  if (!last?.at) return Number.POSITIVE_INFINITY; // אין פוסט-קודם — אין מרווח
  return Date.now() - Date.parse(last.at);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── מדידת-אינגייג'מנט — get_content על פוסטי-המפעל ─────────────────────

interface SteemContent {
  net_votes?: number | string;
  children?: number | string;
  pending_payout_value?: string;
  author_rewards?: string;
  permlink?: string;
}

// r151 — שדה-האינגייג'מנט המדוד נשמר בכל פוסט (היה: רק יומן — נתיב-מת)
interface PostEngagement {
  at: string;
  netVotes: number;
  replies: number;
  pendingPayout: string;
}

async function measureEngagement(): Promise<void> {
  const now = Date.now();
  let measured = 0;
  // r151: המדידה מגיל-שעה (היה: 24ש' — כל פוסט חדש היה מדולג יום שלם,
  // והמדידה-הראשונה-של-המפעל נרשמה כפריט-פתוח). מעתה: 1ש' — החוק
  // "מדידת-אינגייג'מנט שעה-אחרי-עלייה" בפועל, ומדידה חוזרת בכל שעה (הערך-האחרון נשמר).
  const pending = state.posts.filter((p) => p.txid && now - Date.parse(p.at) > 3600 * 1000);
  for (const p of pending.slice(-10)) {
    try {
      const res = await fetch(STEEM_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "condenser_api.get_content",
          params: [AUTHOR, p.permlink],
          id: 1,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await res.json()) as { result?: SteemContent };
      const votes = Number(j.result?.net_votes ?? NaN);
      if (Number.isFinite(votes)) {
        const replies = Number(j.result?.children ?? 0);
        const pendingPayout = String(j.result?.pending_payout_value ?? "0.000 SBD");
        const engagement: PostEngagement = { at: new Date().toISOString(), netVotes: votes, replies, pendingPayout };
        p.engagement = engagement;
        const extra = `\u2192 engagement: net_votes=${votes} replies=${replies} pending=${pendingPayout}`;
        logEvent("engagement", `${p.line} ${p.permlink} ${extra}`);
        p.gateVerdict = p.gateVerdict === "MEASURED" ? p.gateVerdict : `${p.gateVerdict ?? ""}|MEASURED`.slice(0, 40);
        measured += 1;
        // שורת-הרג בפועל (r151): רצף נמדד-אמיתי — פוסט 0-הצבעות מאריך, הצבעה מאפסת.
        // חוק FACTORY_KILL_ZERO_VOTES=7 — עד-היום אף לוגיקה לא הזינה אותו (נתיב-מת).
        if (votes === 0) state.zeroVoteStreak += 1;
        else state.zeroVoteStreak = 0;
        if (state.zeroVoteStreak >= FACTORY_KILL_ZERO_VOTES) state.killLineTripped = true;
      }
    } catch {
      /* fail-soft — מדידה נדלגת, לא מפילה טיק */
    }
  }
  if (measured > 0) {
    state.lastEngagementAt = new Date().toISOString();
    saveState();
    logEvent("engagement", `measured ${measured} posts · zeroVoteStreak=${state.zeroVoteStreak} kill=${state.killLineTripped}`);
  }
}

// ── הטיק — ההפקה עצמה ───────────────────────────────────────────────────

let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    state.ticks += 1;
    state.lastTickAt = new Date().toISOString();

    // יום-חדש ⇒ איפוס-מונים
    const today = utcDay();
    if (state.budget.postDay !== today) {
      state.budget = { postsToday: 0, postDay: today };
      state.linesDoneToday = { measuredLedgerDay: null, agentsAtWorkDay: null };
    }
    if (state.budget.postsToday >= MAX_POSTS_PER_DAY) {
      logEvent("tick", `budget full ${state.budget.postsToday}/${MAX_POSTS_PER_DAY} — no production`);
      saveState();
      return;
    }

    // איזה מוצר חסר היום? (קודם משכנתא-הנתונים, אחר-כך יומן-הבניין)
    let line: "measured-ledger" | "agents-at-work" | null = null;
    if (state.linesDoneToday.measuredLedgerDay !== today) line = "measured-ledger";
    else if (state.linesDoneToday.agentsAtWorkDay !== today) line = "agents-at-work";
    if (!line) {
      logEvent("tick", "both lines done today — no production");
      saveState();
      return;
    }

    // 1) מדידה
    const bundle = await measureBundle();
    if (bundle.prices.steemUsd == null && bundle.pulse.totalRuns24h == null) {
      logEvent("tick", "measure-bundle empty — home not answering; no production (no fabrication)");
      state.lastError = "measure-bundle-empty";
      saveState();
      return;
    }

    // 2) ייצור-טיוטה מהחבילה (LLM · fail = אין פרסום)
    const draft = await draftPost(line, bundle);
    if (!draft) {
      logEvent("draft-failed", `${line}: LLM did not return a valid draft — no publish (no fabrication)`);
      state.lastError = "draft-failed";
      saveState();
      return;
    }

    // 3) שער-הכלכלה (spend=true) — REVIEW/DENY ⇒ אין שידור
    const verdict = await gateAsk(line, draft.title, draft.body.length);
    const gateVerdict = verdict?.verdict ?? "UNREACHED";
    if (gateVerdict !== "ALLOW") {
      logEvent(
        "gate-blocked",
        `${line}: ${gateVerdict} score=${verdict?.score ?? "?"} reasons=${(verdict?.reasonsHe ?? []).join(" | ").slice(0, 140)}`,
      );
      state.lastError = `gate-${gateVerdict.toLowerCase()}`;
      saveState();
      return;
    }

    // 4) פרסום
    const post = await publishDraft(line, draft);
    if (!post) {
      state.lastError = "publish-failed";
      saveState();
      return;
    }
    post.gateScore = typeof verdict?.score === "number" ? verdict.score : null;
    post.gateVerdict = "ALLOW";
    state.posts.push(post);
    state.budget.postsToday += 1;
    if (line === "measured-ledger") state.linesDoneToday.measuredLedgerDay = today;
    else state.linesDoneToday.agentsAtWorkDay = today;
    state.lastError = null;
    logEvent(
      "published",
      `${line} | ${post.title.slice(0, 70)} | permlink=${post.permlink} | txid=${post.txid ?? "null"} | chars=${post.chars} | gate=${post.gateScore}`,
    );
    saveState();
  } catch (e) {
    state.lastError = String(e instanceof Error ? e.message : e).slice(0, 160);
    logEvent("tick-error", state.lastError);
    saveState();
  } finally {
    inFlight = false;
  }
}

// ── שרת-הבריאות ─────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "content-factory",
        port: PORT,
        at: new Date().toISOString(),
        ticks: state.ticks,
        lastTickAt: state.lastTickAt,
        budget: state.budget,
        posts: state.posts.length,
        lastPost: state.posts.at(-1) ?? null,
        zeroVoteStreak: state.zeroVoteStreak,
        killLineTripped: state.killLineTripped,
        lastError: state.lastError,
      });
    }
    if (url.pathname === "/run" && req.method === "POST") {
      // הזמנת-טיק ידנית (לביקורת/הדגמה) — אותה משמעת single-flight
      void tick();
      return Response.json({ ok: true, he: "טיק הוזמן — נמדד ביומן כשיגמר" });
    }
    if (url.pathname === "/measure" && req.method === "POST") {
      // r151 — הזמנת-מדידת-אינגייג'מנט ידנית (שער-אימות: אפשר להוכיח את המדידה בלי לחכות שעה)
      void measureEngagement();
      return Response.json({ ok: true, he: "מדידת-אינגייג'מנט הוזמנה — נמדד במצב וביומן" });
    }
    return new Response("content-factory: not found", { status: 404 });
  },
});

// ── לולאת-החיים ─────────────────────────────────────────────────────────

const bootAtMs = Date.now(); // r200 — שעון-ה-dead-man מתחיל-מהעלייה, לא-מהמצב-המשורשר

setTimeout(() => {
  void tick();
}, BOOT_DELAY_MS);

setInterval(() => {
  void tick();
}, TICK_MS);

setInterval(() => {
  void measureEngagement();
}, 60 * 60 * 1000); // מדידת-אינגייג'מנט שעתית

installDeadManWatch({
  id: "content-factory",
  // r200 — לקח-חוצה-מיתת-סנדבוקס: lastTickAt ישן-במצב (נמדד: מ-10-02) הרג-כל-עלייה
  // טרייה-אחרי-60ש' — אותו-גנוט-«מוות-מחזורי»-של-r150 בתחפושת. ה-dead-man נועד-
  // לתפוס-תהליך-חי-שנתקע; עלייה-טרייה אינה תקיעה. שעון-הסטול = max(עלייה, טיק-אחרון).
  lastMs: () => Math.max(Date.parse(state.lastTickAt ?? "") || 0, bootAtMs),
  stallMs: DEADMAN_STALL_MS, // r150: 18ש' לפי-החוק (היה 45דק' — מוות-מחזורי)
  logFile: HEARTBEAT,
  subject: "ticks",
});

logEvent("boot", `content-factory up on ${PORT} · cadence 6h · cap ${MAX_POSTS_PER_DAY}/day`);
saveState();
