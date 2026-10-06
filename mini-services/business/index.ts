// ─────────────────────────────────────────────────────────────────────
// BUSINESS ENGINE · מנוע-העסקים (r148-a · "המכונה-העסקית" · פורט 3045)
//
// הופך את רישום-החממה (sovereign/businesses/registry.json) ממסמך למכונה
// חיה: טיק כל 10 דק' · שורת-ראיה אחת ליומן בכל טיק · אפס המצאה — כל מספר
// ממקור חי, מקור-נכשל מדווח null ולא "0".
//
//   B-1 דלפק-הדלק  — מודד דלק (/api/money) ותגמולים-ממתינים
//                    (/api/money/claim); תובע בפועל כשיש מה לתבוע
//                    (קבלה >23ש'); מעדכן measuredNow ברישום רק כשנשתנה.
//   B-2 תדריך-השוק — תדריך יומי אחד (שמירת-יום UTC) נבנה מתבנית מקומית
//                    (ללא LLM) מנתונים מדודים בלבד, מפורסם דרך
//                    /api/publish (enqueue+broadcast על מסילה קיימת);
//                    יום אחרי פרסום: מדידת-engagement מהשרשרת.
//   B-3 דלפק-האמת  — מודד בלבד: קבלות-תמיכה/תיקון כלפי-חוץ ב-7 ימים
//                    (comment-memory · קבלות steem-live) מול תקרה 3/שבוע;
//                    המנוע עצמו לא מבצע פעולות-תמיכה.
//   שורות-הרג      — B-1: 2026-10-16 עבר והדלק עדיין 0 ⇒ CAPITAL-GATE;
//                    B-2: 7 תדריכים רצופים בלי הצבעות ⇒ FORMAT-REVIEW.
//   תקציב          — פעולה = שידור בלבד (פרסום/תביעה); גג 3/יום למנוע
//                    (מתחת לגג-הרשת 12/יום); מעל הגג — סירוב כנה.
//
// חוקי-ברזל: טיק-יחיד בטיסה (single-flight) · כל fetch עטוף try/catch עם
// AbortSignal.timeout(15000) — כשל-בית לא מפיל את הדיבון · כתיבת-מצב
// אטומית דרך ../shared · מתג-איש-מת (r143-c): טיק 60ש', שתיקה מעל 30 דק'
// ⇒ יציאה לתחייה · אפס מפתחות כאן — החתימה כולה בצד-הבית.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { installDeadManWatch, writeJsonAtomic, writeTextAtomic } from "../shared";

declare const Bun: {
  serve: (opts: {
    port: number;
    hostname?: string;
    fetch: (req: Request) => Promise<Response> | Response;
  }) => unknown;
};

const PORT = 3045;
const TICK_MS = 10 * 60 * 1000; // קצב: 10 דק'
const HOME_API = "http://127.0.0.1:3000";
const STEEM_RPC = "https://api.steemit.com";
const HOME = "/home/z/my-project";
const BIZ_DIR = path.join(HOME, "sovereign", "businesses");
const REGISTRY = path.join(BIZ_DIR, "registry.json");
const STATE_FILE = path.join(BIZ_DIR, "engine-state.json");
const BIZ_LOG = path.join(BIZ_DIR, "business-log.jsonl");
const FUEL_LOG = path.join(BIZ_DIR, "fuel-log.jsonl");
const BRIEF_LOG = path.join(BIZ_DIR, "brief-log.jsonl");
const HEARTBEAT = path.join(BIZ_DIR, "engine-heartbeat.log");
const OWNER_FILE = path.join(HOME, "upload", "headcorner.txt"); // שורה 1 = שם-החשבון (הסוד לא נקרא)
const AUDIENCE_FILE = path.join(HOME, "sovereign", "audience", "latest-digest.json");
const CURATION_FILE = path.join(HOME, "sovereign", "curation", "state.json");
const COMMENT_MEMORY = path.join(HOME, "sovereign", "curation", "comment-memory.json");

const MAX_ACTIONS_PER_DAY = 3; // גג-תקציב למנוע (פעולה = שידור בלבד)
const CLAIM_MIN_GAP_MS = 23 * 60 * 60 * 1000; // שמירת-תביעה: 23 שעות
const BRIEF_KILL_ZERO_VOTES = 7; // שורת-הרג B-2
const B1_KILL_DAY = "2026-10-16"; // שורת-הרג B-1
const BRIEF_TAGS = ["steem", "saos", "market", "ai-agents", "hebrew"];

// ── מצב המנוע ───────────────────────────────────────────────────────────

interface EngineState {
  service: "business-engine";
  format: "business-engine-state-v1";
  bootedAt: string;
  ticks: number;
  lastTickAt: string | null;
  cadence: "10min";
  lastActions: string[];
  budget: { actionsToday: number; actionDay: string };
  lastBriefDay: string | null;
  lastBriefAt: string | null;
  lastBriefPermlink: string | null;
  lastBriefMeasuredDay: string | null;
  zeroVoteBriefsStreak: number;
  lastClaimAt: string | null;
  lastError: string | null;
}

function freshState(): EngineState {
  return {
    service: "business-engine",
    format: "business-engine-state-v1",
    bootedAt: new Date().toISOString(),
    ticks: 0,
    lastTickAt: null,
    cadence: "10min",
    lastActions: [],
    budget: { actionsToday: 0, actionDay: utcDay() },
    lastBriefDay: null,
    lastBriefAt: null,
    lastBriefPermlink: null,
    lastBriefMeasuredDay: null,
    zeroVoteBriefsStreak: 0,
    lastClaimAt: null,
    lastError: null,
  };
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function readState(): EngineState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as EngineState;
    if (raw && raw.service === "business-engine" && raw.format === "business-engine-state-v1") return raw;
  } catch {
    /* ריצה ראשונה */
  }
  return freshState();
}

const G = globalThis as unknown as { __BIZ_STATE__?: EngineState };
const state: EngineState = G.__BIZ_STATE__ ?? readState();
G.__BIZ_STATE__ = state;

function saveState(): void {
  writeJsonAtomic(STATE_FILE, state);
}

// ── עזרים — רשת בלי-המצאה, קבצים, יומנים ────────────────────────────────

/** GET עם timeout — null על כל כישלון (fail-soft; null הוא null, לא 0) */
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** POST עם timeout — מחזיר {status, body} גם על סירוב-כן (הסירוב הוא נתון) */
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
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return null;
  }
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function appendLine(file: string, line: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    /* יומן שלא נכתב לא מזויף מדידה — המצב נושא את האמת */
  }
}

/** שורת-ראיה ליומן-העסקים — ≤200 תווים, מספרים כנים או כישלון מפורש */
function appendEvidence(obj: Record<string, unknown>): void {
  const at = new Date().toISOString();
  let line = JSON.stringify({ at, ...obj });
  if (line.length > 200) line = JSON.stringify({ at, tick: obj.tick, ev: obj.ev, err: obj.err ?? "evidence-truncated" });
  if (line.length <= 200) appendLine(BIZ_LOG, line);
}

/** עדכון-רישום כירורגי: רק השדה שהשתנה; כל-השאר ביט-מול-ביט; כתיבה אטומית */
function updateRegistry(businessId: string, mutate: (b: Record<string, unknown>) => void): boolean {
  const raw = fs.readFileSync(REGISTRY, "utf8");
  const reg = JSON.parse(raw) as { businesses?: Array<Record<string, unknown>> };
  const b = reg.businesses?.find((x) => x.id === businessId);
  if (!b) return false;
  const before = JSON.stringify(b);
  mutate(b);
  if (JSON.stringify(b) === before) return false; // אין שינוי — אין כתיבה
  writeTextAtomic(REGISTRY, `${JSON.stringify(reg, null, 2)}\n`);
  return true;
}

function businessField(businessId: string, getter: (b: Record<string, unknown>) => unknown): unknown {
  const reg = readJsonFile<{ businesses?: Array<Record<string, unknown>> }>(REGISTRY);
  const b = reg?.businesses?.find((x) => x.id === businessId);
  return b ? getter(b) : undefined;
}

function getStage(businessId: string): string | null {
  const s = businessField(businessId, (b) => b.stage);
  return typeof s === "string" ? s : null;
}

function setBudgetActionDay(): void {
  const today = utcDay();
  if (state.budget.actionDay !== today) state.budget = { actionsToday: 0, actionDay: today };
}

function budgetLeft(): number {
  setBudgetActionDay();
  return Math.max(0, MAX_ACTIONS_PER_DAY - state.budget.actionsToday);
}

function countAction(): void {
  setBudgetActionDay();
  state.budget.actionsToday += 1;
}

/** שם-החשבון בלבד — שורת-החשבון של הבעלים (הסוד לא נקרא, לא נוגעים בו) */
function readAccount(): string | null {
  try {
    const first = fs.readFileSync(OWNER_FILE, "utf8").split(/\r?\n/)[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

// ── מבני-נתונים של המקורות (fail-soft — הכל יכול להיות null) ────────────

interface MoneySense {
  marks?: { steemUsd?: number | null; sbdUsd?: number | null; parity?: number | null; parityInternal?: number | null; sources?: Record<string, string> };
  fuel?: { totalFuel?: number | null; state?: string; arenaClaimWsteem?: number | null; liquidSteem?: number; inOrdersSteem?: number };
  powerdown?: { active?: boolean | null; weeklySteem?: number | null };
  balances?: { steem?: number; sbd?: number };
}
interface ClaimSense {
  ok?: boolean;
  claimable?: boolean;
  rewardSteem?: number | null;
  rewardSbd?: number | null;
  rewardVests?: number | null;
  spEquivalent?: number | null;
  claimThresholdSp?: number;
  source?: string | null;
  error?: string | null;
}
interface AudienceSense {
  fetchedAt?: string;
  digest?: {
    runAt?: string;
    day?: string;
    totals?: { postsMeasured?: number; postsWithExternalVotes?: number; externalVotesTotal?: number; externalRsharesTotal?: number; repliesTotal?: number };
    topics?: Array<{ tag?: string; externalVotes?: number; externalRshares?: number; replies?: number }>;
  };
}
interface CurationSense {
  votesToday?: number;
  voteDay?: string;
  armed?: boolean;
}
interface PulseSense {
  pnl?: { realizedSbd?: number | null; realizedUsd?: number | null; trips?: number | null; fillsTotal?: number | null; lastFillAt?: string | null; ordersOpen?: number | null };
  mission?: { usdPerDay7dAvg?: number | null; daysRecorded?: number | null };
  governance?: { chainOk?: boolean | null; entries?: number | null };
}
interface PublishEnqueueRes {
  ok?: boolean;
  task?: { id?: string; title?: string; status?: string };
  he?: string;
}
interface PublishBroadcastRes {
  ok?: boolean;
  receipt?: { permlink?: string; txid?: string | null; url?: string | null };
  he?: string;
}
interface SteemContent {
  net_votes?: number;
  children?: number;
  net_rshares?: string | number;
  pending_payout_value?: string;
  author?: string;
}
interface FuelLogEntry {
  at?: string;
  txid?: string | null;
}

// ── B-1 — דלפק-הדלק: מדידה + תביעה כשיש מה לתבוע ────────────────────────

function lastSuccessfulClaimAt(): number | null {
  let last: number | null = null;
  try {
    const raw = fs.readFileSync(FUEL_LOG, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const e = JSON.parse(t) as FuelLogEntry;
        if (!e.txid || !e.at) continue;
        const ts = Date.parse(e.at);
        if (Number.isFinite(ts) && (last == null || ts > last)) last = ts;
      } catch {
        /* שורה לא קריאה — לא ראיה */
      }
    }
  } catch {
    /* אין יומן — אין תביעה קודמת */
  }
  return last;
}

async function b1Tick(actions: string[], notes: string[]): Promise<{ totalFuel: number | null; fuelState: string | null; claimed: boolean }> {
  const money = await getJson<MoneySense>(`${HOME_API}/api/money`);
  const fuel = money?.fuel ?? null;
  const totalFuel = fuel?.totalFuel ?? null;

  // מדידת-תגמולים + תביעה אמת (ה-POST מודד שוב בתוכו — הרשות החיה שופטת)
  let claimed = false;
  const claim = await getJson<ClaimSense>(`${HOME_API}/api/money/claim`);
  if (claim?.claimable) {
    const lastOk = lastSuccessfulClaimAt();
    if (lastOk != null && Date.now() - lastOk < CLAIM_MIN_GAP_MS) {
      notes.push("claim-guard-23h");
    } else if (budgetLeft() <= 0) {
      notes.push("claim-budget-refused");
      appendEvidence({ tick: state.ticks + 1, ev: "budget-refuse", act: "claim", left: 0 });
    } else {
      const res = await postJson<{ ok?: boolean; code?: string; he?: string; receipt?: FuelLogEntry }>(`${HOME_API}/api/money/claim`, {});
      if (res?.body?.ok) {
        claimed = true;
        state.lastClaimAt = new Date().toISOString();
        countAction();
        actions.push("claim");
        appendEvidence({ tick: state.ticks + 1, ev: "claim-ok", tx: String(res.body.receipt?.txid ?? "").slice(0, 10) });
      } else {
        notes.push(`claim-refused:${res?.body?.code ?? res?.status ?? "no-res"}`);
        appendEvidence({ tick: state.ticks + 1, ev: "claim-refuse", code: String(res?.body?.code ?? "no-res").slice(0, 24) });
      }
    }
  } else {
    notes.push(
      claim
        ? `claim-no:${(claim.rewardVests ?? 0).toFixed(6)}v/${(claim.rewardSteem ?? 0).toFixed(3)}s/${(claim.rewardSbd ?? 0).toFixed(3)}d`
        : "claim-unmeasured",
    );
  }

  // עדכון-רישום B-1: measuredNow = דלק-אמת — רק אם נשתנה; מדידה-כושלת לא מוחקת מספר
  if (typeof totalFuel === "number") {
    const current = businessField("B-1-fuel-desk", (b) => (b.unitEconomics as Record<string, unknown> | undefined)?.measuredNow);
    if (current !== totalFuel) {
      const wrote = updateRegistry("B-1-fuel-desk", (b) => {
        const ue = (b.unitEconomics as Record<string, unknown> | undefined) ?? {};
        ue.measuredNow = totalFuel;
        b.unitEconomics = ue;
      });
      if (wrote) notes.push(`b1-measured:${totalFuel}`);
    }
  }
  return { totalFuel, fuelState: fuel?.state ?? null, claimed };
}

// ── B-2 — תדריך-השוק: הרכבה מתוך-מדידות + פרסום + מדידת-הד ──────────────

function fmt(n: number | null | undefined, digits = 3): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function line(label: string, value: string, source: string): string {
  return `- **${label}:** ${value} (מקור: ${source})`;
}

function composeBrief(inputs: {
  money: MoneySense | null;
  claim: ClaimSense | null;
  audience: AudienceSense | null;
  curation: CurationSense | null;
  pulse: PulseSense | null;
  day: string;
}): { title: string; body: string } {
  const { day } = inputs;
  const m = inputs.money;
  const marks = m?.marks ?? null;
  const fuel = m?.fuel ?? null;
  const pd = m?.powerdown ?? null;
  const cl = inputs.claim;
  const au = inputs.audience?.digest ?? null;
  const totals = au?.totals ?? null;
  const top = au?.topics?.[0] ?? null;
  const cu = inputs.curation;
  const pu = inputs.pulse;

  const marketHe = [
    line("STEEM", marks?.steemUsd != null ? `$${marks.steemUsd}` : "— לא נמדד", marks?.steemUsd != null ? `${marks.sources?.steem ?? "binance"} דרך /api/money` : "מקור-השוק לא ענה — null כנה"),
    line("SBD", marks?.sbdUsd != null ? `$${marks.sbdUsd}` : "— לא נמדד", marks?.sbdUsd != null ? `${marks.sources?.sbd ?? "coingecko"} דרך /api/money` : "מקור-השוק לא ענה — null כנה"),
    line("פאריטה פנימית SBD→STEEM", marks?.parityInternal != null ? String(marks.parityInternal) : "—", marks?.parityInternal != null ? "אורקל /api/money" : "לא נמדד"),
  ];

  const fuelHe = [
    line("מצב-דלק", fuel?.state ? `${fuel.state} · דלק-מכירה ${fmt(fuel.totalFuel)} STEEM` : "— לא נמדד", fuel?.state ? "GET /api/money → fuel" : "הבית לא ענה — null כנה"),
    line("תביעת-עטיפה (WSTEEM)", fuel?.arenaClaimWsteem != null ? fmt(fuel.arenaClaimWsteem) : "—", fuel?.arenaClaimWsteem != null ? "/api/money → fuel" : "לא נמדד"),
    line(
      "תגמולים-ממתינים בשרשרת",
      cl?.ok
        ? `${fmt(cl.rewardSteem)} STEEM · ${fmt(cl.rewardSbd)} SBD · ${fmt(cl.rewardVests, 6)} VESTS (≈${fmt(cl.spEquivalent, 6)} SP)`
        : "— לא נמדד",
      cl?.ok ? `GET /api/money/claim · ${cl.source ?? "api.steemit.com"}` : "מקור-השרשרת לא ענה — null כנה",
    ),
    line("powerdown שבועי", pd?.weeklySteem != null ? `${fmt(pd.weeklySteem)} STEEM${pd.active === false ? " (לא פעיל)" : ""}` : "—", pd?.weeklySteem != null ? "/api/money → powerdown" : "לא נמדד"),
  ];

  const audienceHe = totals
    ? [
        line("הצבעות-חוץ ב-48ש'", `${totals.externalVotesTotal ?? "—"} על ${totals.postsMeasured ?? "—"} פוסטים · rshares-חוץ ${totals.externalRsharesTotal != null ? totals.externalRsharesTotal.toLocaleString("en-US") : "—"}`, `audience digest ${au?.day ?? ""}`),
        line("נושא-רזוננט", top?.tag ? `${top.tag} · ${top.externalVotes ?? 0} הצבעות-חוץ · ${top.replies ?? 0} תגובות` : "—", "audience digest → topics[0]"),
        line("הצבעות-קיור", cu?.votesToday != null ? `${cu.votesToday} (יום ${cu.voteDay ?? "—"})` : "—", "sovereign/curation/state.json"),
      ]
    : [line("קהל", "— לא נמדד", "sovereign/audience/latest-digest.json לא נקרא — null כנה")];

  const pulseHe =
    pu?.pnl || pu?.governance
      ? [
          line("PnL ממומש", `${fmt(pu.pnl?.realizedSbd)} SBD (${fmt(pu.pnl?.realizedUsd, 2)} USD) על ${pu.pnl?.trips ?? "—"} טריפים · ${pu.pnl?.fillsTotal ?? "—"} מילויים`, "פולס-ציבורי /api/public/pulse → /api/economy/pnl"),
          line("ממוצע-הכנסה 7 ימים", pu.mission?.usdPerDay7dAvg != null ? `$${pu.mission.usdPerDay7dAvg}/יום` : "—", "פולס → /api/mission"),
          line("שרשרת-ההחלטות", `${pu.governance?.entries ?? "—"} רשומות · ok=${pu.governance?.chainOk ?? "—"}`, "פולס → /api/governance"),
        ]
      : [line("מה-נמדד", "— הפולס הציבורי לא ענה", "/api/public/pulse — null כנה")];

  const body = [
    `# THE WEAVE · תדריך-שוק מדוד — ${day}`,
    ``,
    `תדריך יומי שנבנה כולו ממדידות חיות בזמן-אמת — כל מספר עם המקור שלו. אין תחזיות, אין הבטחות: מה שנמדד — מה שכתוב. נוצר על-ידי מנוע-העסקים (B-2 תדריך-השוק) מתבנית קבועה, ללא LLM.`,
    ``,
    `## שוק`,
    ``,
    ...marketHe,
    ``,
    `## דלק`,
    ``,
    ...fuelHe,
    ``,
    `## קהל`,
    ``,
    ...audienceHe,
    ``,
    `## מה נמדד היום`,
    ``,
    ...pulseHe,
    ``,
    `## EN summary`,
    ``,
    `Measured daily brief, no forecasts: STEEM ${marks?.steemUsd != null ? `$${marks.steemUsd}` : "unmeasured"} (${marks?.sources?.steem ?? "binance"}), SBD ${marks?.sbdUsd != null ? `$${marks.sbdUsd}` : "unmeasured"} (${marks?.sources?.sbd ?? "coingecko"}); sell-side fuel ${fmt(fuel?.totalFuel)} STEEM above the ${fmt(fuel?.arenaClaimWsteem)} WSTEEM wrap-claim, state ${fuel?.state ?? "unmeasured"} (home /api/money); on-chain pending rewards ${cl?.ok ? `${fmt(cl.rewardSteem)} STEEM / ${fmt(cl.rewardSbd)} SBD / ${fmt(cl.rewardVests, 6)} VESTS ≈ ${fmt(cl.spEquivalent, 6)} SP` : "unmeasured"} (api.steemit.com); audience: ${totals?.externalVotesTotal ?? "—"} external votes on ${totals?.postsMeasured ?? "—"} posts in 48h, top topic ${top?.tag ?? "—"} (audience digest); curation votes today ${cu?.votesToday ?? "—"} (curation state); realized PnL ${fmt(pu?.pnl?.realizedSbd)} SBD over ${pu?.pnl?.trips ?? "—"} trips (public pulse). Every number carries its source; a failed source is reported as unmeasured, never invented.`,
    ``,
    `---`,
    `*נוצר ושודר על-ידי מנוע-העסקים של THE WEAVE · יום-UTC ${day} · תבנית מקומית על נתונים מדודים · רישום-העסקים: sovereign/businesses/registry.json*`,
  ].join("\n");

  const title = `THE WEAVE · תדריך-שוק מדוד — Measured Market Brief (${day})`;
  return { title, body };
}

async function publishBrief(title: string, body: string, day: string): Promise<{ ok: boolean; permlink?: string; txid?: string | null; error?: string }> {
  // חוק-התקציב: פרסום הוא פעולה (שידור) — מעל הגג: סירוב כנה
  if (budgetLeft() <= 0) {
    appendEvidence({ tick: state.ticks + 1, ev: "budget-refuse", act: "brief", left: 0 });
    return { ok: false, error: "budget-cap-reached" };
  }
  // ניסיון אחד + חוזר יחיד לכל היותר (חוק-הדד-הפרסום)
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const enq = await postJson<PublishEnqueueRes>(`${HOME_API}/api/publish`, {
      action: "enqueue",
      kind: "MARKET-BRIEF",
      lang: "HE",
      title,
      body,
      tags: BRIEF_TAGS,
    });
    const id = enq?.body?.task?.id;
    if (!id) {
      lastError = `enqueue-failed:${enq?.status ?? "no-res"}`;
      continue; // ניסיון-חוזר יחיד
    }
    const bc = await postJson<PublishBroadcastRes>(`${HOME_API}/api/publish`, { action: "broadcast", id });
    if (bc?.body?.ok && bc.body.receipt?.permlink) {
      countAction();
      return { ok: true, permlink: bc.body.receipt.permlink, txid: bc.body.receipt.txid ?? null };
    }
    lastError = `broadcast-failed:${bc?.body?.he?.slice(0, 40) ?? bc?.status ?? "no-res"}`;
  }
  return { ok: false, error: lastError };
}

async function b2Tick(actions: string[], notes: string[]): Promise<void> {
  const today = utcDay();

  // פרסום — פעם ביום UTC בלבד (שמירת-יום על מצב-המנוע)
  if (state.lastBriefDay !== today) {
    const [money, claim, pulse] = await Promise.all([
      getJson<MoneySense>(`${HOME_API}/api/money`),
      getJson<ClaimSense>(`${HOME_API}/api/money/claim`),
      getJson<PulseSense>(`${HOME_API}/api/public/pulse`),
    ]);
    const audience = readJsonFile<AudienceSense>(AUDIENCE_FILE);
    const curation = readJsonFile<CurationSense>(CURATION_FILE);
    const { title, body } = composeBrief({ money, claim, audience, curation, pulse, day: today });
    if (body.trim().length < 80) {
      notes.push("brief-body-too-short");
    } else {
      const res = await publishBrief(title, body, today);
      if (res.ok && res.permlink) {
        state.lastBriefDay = today;
        state.lastBriefAt = new Date().toISOString();
        state.lastBriefPermlink = res.permlink;
        state.lastBriefMeasuredDay = null; // יימדד מחר
        actions.push("brief");
        appendLine(
          BRIEF_LOG,
          JSON.stringify({ at: state.lastBriefAt, event: "brief-published", businessId: "B-2-market-brief", day: today, permlink: res.permlink, txid: res.txid ?? null, title }),
        );
        appendEvidence({ tick: state.ticks + 1, ev: "brief-ok", pm: res.permlink.slice(0, 28) });
      } else {
        // כישלון פרסום — נרשם בכנות; מחר ינסה שוב (שמירת-היום לא ננעלה)
        appendEvidence({ tick: state.ticks + 1, ev: "brief-fail", err: String(res.error ?? "").slice(0, 60) });
        state.lastError = `brief: ${res.error ?? "unknown"}`;
      }
    }
  }

  // מדידת-הד — יום אחרי פרסום, פעם אחת לכל תדריך
  const briefDay = state.lastBriefAt ? utcDay(new Date(state.lastBriefAt)) : null;
  if (state.lastBriefPermlink && briefDay && briefDay < today && state.lastBriefMeasuredDay !== today) {
    const author = readAccount();
    let content: SteemContent | null = null;
    if (author) {
      try {
        const res = await fetch(STEEM_RPC, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_content", params: [author, state.lastBriefPermlink], id: 1 }),
          signal: AbortSignal.timeout(15_000),
        });
        const j = (await res.json()) as { result?: SteemContent };
        content = j?.result ?? null;
      } catch {
        content = null;
      }
    }
    if (content && typeof content.net_votes === "number") {
      const netRshares = Number(content.net_rshares ?? 0) || 0;
      const children = typeof content.children === "number" ? content.children : 0;
      const measuredNow = netRshares + children; // נוסחת-הרישום: rshares + תגובות
      const changed = updateRegistry("B-2-market-brief", (b) => {
        const ue = (b.unitEconomics as Record<string, unknown> | undefined) ?? {};
        ue.measuredNow = measuredNow;
        b.unitEconomics = ue;
      });
      state.lastBriefMeasuredDay = today;
      state.zeroVoteBriefsStreak = content.net_votes === 0 ? state.zeroVoteBriefsStreak + 1 : 0;
      appendLine(
        BRIEF_LOG,
        JSON.stringify({
          at: new Date().toISOString(),
          event: "engagement-measured",
          businessId: "B-2-market-brief",
          permlink: state.lastBriefPermlink,
          netVotes: content.net_votes,
          children,
          netRshares,
          pendingPayout: content.pending_payout_value ?? null,
          measuredNow,
          registryUpdated: changed,
        }),
      );
      appendEvidence({ tick: state.ticks + 1, ev: "engage", nv: content.net_votes, st: state.zeroVoteBriefsStreak });
    } else {
      notes.push("engage-unmeasured");
    }
  }
}

// ── B-3 — דלפק-האמת: מדידה בלבד (הפעולות באחריות מנועי-הקיור הקיימים) ────

async function b3Tick(notes: string[]): Promise<void> {
  const mem = readJsonFile<{ entries?: Array<{ created?: string; source?: string; permlink?: string }> }>(COMMENT_MEMORY);
  const since = Date.now() - 7 * 86_400_000;
  const entries = mem?.entries ?? [];
  // קבלות-חיות בלבד (source=steem-live) ב-7 הימים האחרונים
  const live = entries.filter((e) => e.source === "steem-live" && Date.parse(e.created ?? "") >= since);
  // שיחות-תמיכה/תיקון עם מגיב-חוץ = תגובה-על-תגובה (re-re-) — אלו קבלות-התמיכה של דלפק-האמת;
  // שאר התגובות-החיות הן שיחות-שולחן-קהל (לא בתקציב-האמת) — נמדדות ומדווחות כהקשר בלבד.
  const support = live.filter((e) => String(e.permlink ?? "").startsWith("re-re-")).length;
  const capOk = support <= 14; // r150: תקרה 14/שבוע (2/יום) — הרשת מחזיקה קהל חי (1120 צמדים, תגובות-חוץ זורמות) והתקרה-הישנה 3/שבוע הייתה משתקת את מנוע-הקהל היחיד; כל-שיחה עדיין עוברת שער-כלכלה וקבלה-live
  const measured = `תמיכות/תיקוני-חוץ ב-7 ימים: ${support} שיחות-תמיכה (re-re- אל מגיבי-חוץ) מתוך ${live.length} תגובות-חוץ-חיות · קבלות steem-live מ-comment-memory · תקרה 14/שבוע (r150): ${capOk ? "ok" : "exceeded"}`;
  const current = businessField("B-3-truth-desk", (b) => b.unitEconomics && (b.unitEconomics as Record<string, unknown>).measuredNow);
  if (current !== measured) {
    const wrote = updateRegistry("B-3-truth-desk", (b) => {
      const ue = (b.unitEconomics as Record<string, unknown> | undefined) ?? {};
      ue.measuredNow = measured;
      b.unitEconomics = ue;
    });
    if (wrote) {
      notes.push(`b3:${support}in7d`);
      appendEvidence({ tick: state.ticks + 1, ev: "b3-measure", n: support, cap: capOk ? "ok" : "exceeded" });
    }
  }
}

// ── שורות-הרג — נאכפות מתוך מספרים מדודים בלבד ──────────────────────────

function enforceKillLines(totalFuel: number | null, notes: string[]): void {
  const today = utcDay();
  // B-1: 2026-10-16 עבר והדלק עדיין 0 (מדוד) ⇒ CAPITAL-GATE (שער-הון, לא כישלון-תפעול)
  if (today > B1_KILL_DAY && totalFuel != null && totalFuel <= 0 && getStage("B-1-fuel-desk") !== "CAPITAL-GATE") {
    const from = getStage("B-1-fuel-desk");
    const wrote = updateRegistry("B-1-fuel-desk", (b) => {
      b.stage = "CAPITAL-GATE";
    });
    if (wrote) {
      appendLine(
        BIZ_LOG,
        JSON.stringify({ at: new Date().toISOString(), businessId: "B-1-fuel-desk", event: "stage-change", from, to: "CAPITAL-GATE", evidence: `totalFuel=0 measured · ${B1_KILL_DAY} passed` }),
      );
      notes.push("b1-capital-gate");
    }
  }
  // B-2: 7 תדריכים רצופים בלי הצבעות-חוץ ⇒ FORMAT-REVIEW
  if (state.zeroVoteBriefsStreak >= BRIEF_KILL_ZERO_VOTES && getStage("B-2-market-brief") !== "FORMAT-REVIEW") {
    const from = getStage("B-2-market-brief");
    const wrote = updateRegistry("B-2-market-brief", (b) => {
      b.stage = "FORMAT-REVIEW";
    });
    if (wrote) {
      appendLine(
        BIZ_LOG,
        JSON.stringify({ at: new Date().toISOString(), businessId: "B-2-market-brief", event: "stage-change", from, to: "FORMAT-REVIEW", evidence: `${state.zeroVoteBriefsStreak} consecutive briefs with 0 external votes` }),
      );
      notes.push("b2-format-review");
    }
  }
}

// ── הטיק — שורת-ראיה אחת לכל טיק, single-flight ─────────────────────────

let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  const actions: string[] = [];
  const notes: string[] = [];
  try {
    setBudgetActionDay();
    const b1 = await b1Tick(actions, notes);
    await b2Tick(actions, notes);
    await b3Tick(notes);
    enforceKillLines(b1.totalFuel, notes);
    state.lastActions = actions;
    state.lastError = null;
    appendEvidence({
      tick: state.ticks + 1,
      ev: "tick",
      a: actions.length ? actions.join("+") : "none",
      fuel: b1.fuelState == null ? "null" : `${b1.fuelState}/${fmt(b1.totalFuel)}`,
      note: notes.slice(0, 2).join(" · "),
    });
  } catch (e) {
    state.lastError = String((e as Error)?.message ?? e).slice(0, 160);
    appendEvidence({ tick: state.ticks + 1, ev: "tick-error", err: state.lastError.slice(0, 60) });
  } finally {
    state.ticks += 1;
    state.lastTickAt = new Date().toISOString();
    saveState();
    ticking = false;
  }
}

// ── שרת-בריאות (3045) + מתג-איש-מת + אתחול ─────────────────────────────

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonRes({
        ok: true,
        service: "business-engine",
        port: PORT,
        ticks: state.ticks,
        lastTickAt: state.lastTickAt,
        cadence: state.cadence,
        budget: state.budget,
        lastBriefDay: state.lastBriefDay,
        lastBriefPermlink: state.lastBriefPermlink,
        lastBriefMeasuredDay: state.lastBriefMeasuredDay,
        lastClaimAt: state.lastClaimAt,
        zeroVoteBriefsStreak: state.zeroVoteBriefsStreak,
        lastError: state.lastError,
        bootedAt: state.bootedAt,
        uptimeSec: Math.round((Date.now() - Date.parse(state.bootedAt)) / 1000),
      });
    }
    if (url.pathname === "/state") return jsonRes(state);
    return jsonRes({ ok: false, error: "not-found", hint: "/ · /health · /state" }, 404);
  },
});

// מתג-איש-מת (r143-c): קצב 10 דק' ⇒ שתיקה מעל max(3×קצב, 10 דק') = 30 דק' ⇒ יציאה לתחייה
installDeadManWatch({
  id: "business-engine",
  lastMs: () => Date.parse(state.lastTickAt ?? state.bootedAt),
  stallMs: 30 * 60 * 1000,
  logFile: HEARTBEAT,
  subject: "ticks",
});

saveState();
console.log(`business-engine: חי על ${PORT} · קצב ${TICK_MS / 60_000} דק' · מצב ${STATE_FILE}`);
void tick();
setInterval(() => void tick(), TICK_MS);
