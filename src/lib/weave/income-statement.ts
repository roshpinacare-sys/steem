// ─────────────────────────────────────────────────────────────────────
// INCOME-STATEMENT — דוח-ההכנסה של המערכת הריבונית (r191-1-d).
//
// ההוראה שיצרה את הדוח: "עוד לא הרווחנו דולר... בוא תראה איך את מוכיח
// את עצמך" — והחוק המחייב: מספר שלא נגזר מנתון-אמת הוא null עם סיבה,
// לעולם לא ניחוש. הלוח הזה הוא פנקס-ההוכחה של המפעיל.
//
// שלוש שכבות:
//   1. מנוע-הגריד (מנוע-מכירה של הקופסה): קריאת-fs של
//      sovereign/market-maker/state.json (השדות שמוסיף v1.2.0-r191:
//      realizedPnlSbd FIFO אמיתי · unrealizedPnlSbd · basisBlendedSbd ·
//      lotsCount) + זנב ledger.jsonl (5 המילויים האחרונים). כל שדה
//      אפשרי-היעדר — הקובץ עשוי להיות חסר, פגום, או בגרסה ישנה.
//      מטמון-זיכרון של 60ש' לקריאות-ה-fs הזולות (הערך משתנה פעימתית).
//   2. קיורציה (מדידת 04/10): שאילתת שרשרת חסרת-מפתחות —
//      condenser_api.get_accounts (pending claimable + curation_rewards
//      לכל-החיים) וסריקת curation_reward בחלון 7 ימים מתוך
//      get_account_history, עם צ'קפוינט אטומי — סריקה מלאה פעם אחת,
//      אחר-כך רק החדש; תקציב-עמודים לכל הרצה כדי שהתשובה תמיד חיה
//      בזמן סביר (סריקה חלקית מוצהרת בכנות כחלקית).
//   3. הצהרה: fundingRequests="none" · selfFunded=true — דגלי-אמת
//      סטטיים שה-UI חייב להציג כמו שהם.
//
// חוקי-כנות:
//   · null = "לא נגזר מנתון-אמת" — לא 0, לא ניחוש, לא השלמה.
//   · 0 מדידה אמיתית הוא 0 — מוצג כ-0 (מדידה), לא כ-null.
//   · המרות VESTS→STEEM→USD נעשות בשערים של היום בלבד ומוצהרות ככאלה.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

const HOME = "/home/z/my-project";
const MM_STATE_FILE = path.join(HOME, "sovereign/market-maker/state.json");
const MM_LEDGER_FILE = path.join(HOME, "sovereign/market-maker/ledger.jsonl");
const CURATION_SCAN_FILE = path.join(HOME, "sovereign/money/curation-scan.json");
const STEEM_RPC = "https://api.steemit.com";
const ACCOUNT = "headcorner";
/** חלון-המדידה של קיורציה — 7 ימים אחרונים */
const CURATION_WINDOW_DAYS = 7;
/** תקציב-עמודים (של 100 רשומות) לכל הרצה — התשובה חיה תמיד, ההמשך ברענון-הבא */
const CURATION_PAGE_BUDGET = 50;
/** מטמון-ה-fs הזול — המנוע פועם כל דקה, יותר מזה לא משנה */
const FS_MEMO_MS = 60_000;

// ── טיפוסים (חוזה BE↔FE) ─────────────────────────────────────────────

export interface LedgerFillRow {
  at: string | null;
  side: string | null;
  price: number | null;
  amount: number | null;
  total: number | null;
  /** השורה הגולמית (ראיה) — קטועה ל-160 תווים */
  raw: string;
}

export interface MarketMakingStatement {
  /** state.json נקרא ופוענח */
  present: boolean;
  /** סיבה כנה כשהמצב לא נקרא */
  reason: string | null;
  stateFileMtimeMs: number | null;
  /** FIFO ממומש (SBD) — מנוע v1.2.0-r191; ישן-מדי/חסר ⇒ null */
  realizedPnlSbd: number | null;
  /** ממומש-24ש׳ (SBD) — dailyPnlSbd של המנוע; חסר ⇒ null */
  dailyPnlSbd: number | null;
  /** עמדה-פתוחה לא-ממומשת (SBD) — לא רווח עד סגירה */
  unrealizedPnlSbd: number | null;
  /** בסיס-עלות ממוצע-משוקלע (SBD ל-STEEM) — עשוי null גם במנוע עצמו */
  basisBlendedSbd: number | null;
  /** מספר-הלוטות הפתוחות (סבבי FIFO חיים) */
  lotsCount: number | null;
  fills24h: number | null;
  volume24hSteem: number | null;
  volume24hSbd: number | null;
  engineVersion: string | null;
  /** "live" | "dry" | אחר — מוצג כמו שהמנוע מדווח */
  engineMode: string | null;
  lastTick: string | null;
  /** 5 המילויים האחרונים מזנב ספר-המנוע (ריק = אין ספר או אין מילויים) */
  ledgerFills: LedgerFillRow[];
  /** סיבה כנה כשזנב-הספר לא נקרא / שורות דולגו */
  ledgerReason: string | null;
}

export interface CurationOp {
  idx: number;
  ts: string;
  vests: number;
  author: string | null;
  permlink: string | null;
}

export interface CurationStatement {
  /** השרשרת ענתה לפחות על החשבון */
  ok: boolean;
  reason: string | null;
  account: string;
  /** זכאי-לתביעה כרגע (reward balances) — null כשהשרשרת לא ענתה */
  pending: {
    /** reward_hive_balance (או reward_steem_balance בפורמט סטים) */
    hive: number | null;
    /** reward_hbd_balance (או reward_sbd_balance) */
    hbd: number | null;
    /** reward_vesting_balance */
    vests: number | null;
  };
  /** curation_rewards — VESTS לכל-החיים */
  lifetimeVests: number | null;
  last7d: {
    windowDays: number;
    /** מספר פריעות-קיורציה בחלון — 0 מדידה אמיתית היא 0, לא null */
    ops: number | null;
    vests: number | null;
    steem: number | null;
    /** אומדן-דולר בשער-היום בלבד — מוצהר */
    usd: number | null;
    /** שער ההמרה ששימש (VESTS ל-STEEM) — כנות-מקור */
    vestsPerSteem: number | null;
    /** true = הסריקה טרם הגיעה לתחילת-החלון (תקציב-עמודים) */
    partial: boolean;
    walkedEntries: number;
    scannedFromIdx: number | null;
    scannedToIdx: number | null;
    lastOpAt: string | null;
    note: string | null;
  };
}

export interface IncomeStatement {
  at: string;
  marketMaking: MarketMakingStatement;
  curation: CurationStatement;
  declaration: { fundingRequests: "none"; selfFunded: true };
}

// ── רשת בסיסית (אותו דפוס של grid-pnl — חסר-מפתחות) ──────────────────

async function jpost<T>(method: string, params: unknown[], timeoutMs = 12_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(STEEM_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const j = (await res.json()) as { result?: T; error?: { message?: string } };
    if (j.error) throw new Error(String(j.error.message ?? "rpc-error"));
    return j.result as T;
  } finally {
    clearTimeout(t);
  }
}

async function jget(url: string, timeoutMs = 9_000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "the-weave-income-statement/1.0" },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function parseAmount(s: string | undefined | null): { n: number; asset: string } {
  const m = String(s ?? "").trim().match(/^([\d.]+)\s+(\S+)$/);
  if (!m) return { n: 0, asset: "" };
  return { n: parseFloat(m[1]) || 0, asset: m[2] };
}

/** "0.000 SBD" → 0 (מדידה אמיתית) · גם "5 HBD" → 5 · קלט לא-מפוענח → null */
function amountOrNull(s: string | undefined | null): number | null {
  const p = parseAmount(s);
  return p.asset ? p.n : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function iso(ts: string): number {
  const withZ = ts.endsWith("Z") ? ts : `${ts}Z`;
  const ms = Date.parse(withZ);
  return Number.isFinite(ms) ? ms : NaN;
}

// ── שכבה 1: מנוע-הגריד מהקבצים (fs זול · מטמון 60ש') ──────────────────

function readEngineState(): { present: boolean; reason: string | null; mtimeMs: number | null; raw: Record<string, unknown> } {
  try {
    const st = fs.statSync(MM_STATE_FILE);
    const j = JSON.parse(fs.readFileSync(MM_STATE_FILE, "utf8")) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) {
      return { present: false, reason: "state.json קיים אך אינו אובייקט — לא מפוענח", mtimeMs: st.mtimeMs, raw: {} };
    }
    return { present: true, reason: null, mtimeMs: st.mtimeMs, raw: j as Record<string, unknown> };
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException)?.code === "ENOENT";
    return {
      present: false,
      reason: missing
        ? "state.json טרם נוצר — למנוע-הגריד אין מצב שמור עדיין"
        : `state.json לא נקרא: ${String((e as Error)?.message ?? e).slice(0, 80)}`,
      mtimeMs: null,
      raw: {},
    };
  }
}

function readLedgerTail(): { rows: LedgerFillRow[]; reason: string | null } {
  try {
    const fd = fs.openSync(MM_LEDGER_FILE, "r");
    try {
      const size = fs.fstatSync(fd).size;
      // זנב של 8KB מספיק ל-5 המילויים האחרונים בכל פורמט סביר
      const len = Math.min(size, 8192);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf
        .toString("utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      // אם קראנו חלון חלקי, השורה הראשונה עלולה להיות חצויה — דולגת
      const slice = size > len && lines.length > 0 ? lines.slice(1) : lines;
      const rows: LedgerFillRow[] = [];
      let corrupt = 0;
      for (let i = slice.length - 1; i >= 0 && rows.length < 5; i -= 1) {
        try {
          const j = JSON.parse(slice[i]) as Record<string, unknown>;
          rows.push({
            at: str(j.at ?? j.ts ?? j.time ?? j.timestamp),
            side: str(j.side ?? j.kind),
            price: num(j.price),
            amount: num(j.amount ?? j.size ?? j.steem ?? j.qty),
            total: num(j.total ?? j.sbd ?? j.receive),
            raw: slice[i].slice(0, 160),
          });
        } catch {
          corrupt += 1;
        }
      }
      rows.reverse();
      return {
        rows,
        reason:
          corrupt > 0
            ? `${corrupt} שורות פגומות דולגו מזנב-הספר — כנות מלאה`
            : rows.length === 0
              ? "הספר קיים אך ריק ממילויים"
              : null,
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException)?.code === "ENOENT";
    return {
      rows: [],
      reason: missing
        ? "ledger.jsonl טרם נוצר — למנוע אין ספר-מילויים בסשן זה (הספר הקודם אבד עם הנפילה, מתועד ב-r190)"
        : `זנב ספר-המנוע לא נקרא: ${String((e as Error)?.message ?? e).slice(0, 80)}`,
    };
  }
}

let fsMemo: { at: number; value: MarketMakingStatement } | null = null;

/** קריאת מצב-המנוע + זנב-הספר — fs זול עם מטמון-זיכרון של 60ש' */
export function composeMarketMaking(): MarketMakingStatement {
  if (fsMemo && Date.now() - fsMemo.at < FS_MEMO_MS) return fsMemo.value;
  const st = readEngineState();
  const led = readLedgerTail();
  const r = st.raw;
  const out: MarketMakingStatement = {
    present: st.present,
    reason: st.reason,
    stateFileMtimeMs: st.mtimeMs,
    realizedPnlSbd: num(r.realizedPnlSbd),
    dailyPnlSbd: num(r.dailyPnlSbd),
    unrealizedPnlSbd: num(r.unrealizedPnlSbd),
    basisBlendedSbd: num(r.basisBlendedSbd),
    lotsCount: num(r.lotsCount),
    fills24h: num(r.fills24h),
    volume24hSteem: num(r.volume24hSteem),
    volume24hSbd: num(r.volume24hSbd),
    engineVersion: str(r.version),
    engineMode: str(r.mode),
    lastTick: str(r.lastTick),
    ledgerFills: led.rows,
    ledgerReason: led.reason,
  };
  fsMemo = { at: Date.now(), value: out };
  return out;
}

// ── שכבה 2: קיורציה מהשרשרת (מדידת 04/10) ─────────────────────────────

interface CurHistoryEntry {
  timestamp?: string;
  op: [string, Record<string, unknown>];
}

interface CurCheckpoint {
  savedAt: string;
  floorIso: string;
  ops: CurationOp[];
  headIdx: number;
  walkedToIdx: number | null;
  crossedFloor: boolean;
}

function loadCurCheckpoint(): CurCheckpoint | null {
  try {
    const j = JSON.parse(fs.readFileSync(CURATION_SCAN_FILE, "utf8"));
    if (typeof j?.headIdx === "number" && Array.isArray(j?.ops)) return j as CurCheckpoint;
    return null;
  } catch {
    return null;
  }
}

function saveCurCheckpoint(cp: CurCheckpoint): void {
  try {
    fs.mkdirSync(path.dirname(CURATION_SCAN_FILE), { recursive: true });
    // חוק הכתיבה-האטומית (r146-d): קוראים מקבילים לא יקראו קובץ חצוי
    const tmp = `${CURATION_SCAN_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cp));
    fs.renameSync(tmp, CURATION_SCAN_FILE);
  } catch {
    /* כתיבת-צ'קפוינט נכשלה — הסריקה הבאה תעשה עבודה חוזרת */
  }
}

async function scanCurationRewards(down: string[]): Promise<CurationStatement["last7d"]> {
  const floorMs = Date.now() - CURATION_WINDOW_DAYS * 86_400_000;
  const floorIso = new Date(floorMs).toISOString();
  const cp = loadCurCheckpoint();
  const ops = new Map<number, CurationOp>();
  if (cp) {
    for (const o of cp.ops) {
      const ms = iso(o.ts);
      if (Number.isFinite(ms) && ms >= floorMs) ops.set(o.idx, o);
    }
  }

  // המשך-מהיכן שנעצרנו: סריקה-שלמה → רק החדשים מראש-ההיסטוריה;
  // סריקה-חלקית → ממשיכים מהנקודה הנמוכה שאליה הגענו
  let start: number = cp?.crossedFloor ? cp.headIdx : cp?.walkedToIdx ?? -1;
  let headIdx = cp?.headIdx ?? 0;
  let walked = 0;
  let pages = 0;
  let crossed = cp?.crossedFloor ?? false;
  let scannedTo = cp?.crossedFloor ? cp.headIdx : cp?.walkedToIdx ?? null;
  let lastOpAt: string | null = null;
  let oldestTs = "";

  while (pages < CURATION_PAGE_BUDGET) {
    const hist = await jpost<Array<[number, CurHistoryEntry]>>(
      "condenser_api.get_account_history",
      [ACCOUNT, start, 100],
    ).catch((e) => {
      down.push(`curation-scan: ${String((e as Error)?.message ?? e).slice(0, 50)}`);
      return null;
    });
    if (!hist || !hist.length) break;
    let minIdx = Infinity;
    for (const [idx, rec] of hist) {
      if (idx < minIdx) minIdx = idx;
      if (idx > headIdx) headIdx = idx;
      const ts = String(rec.timestamp ?? "");
      if (ts && (!oldestTs || ts < oldestTs)) oldestTs = ts;
      if (rec.op?.[0] !== "curation_reward") continue;
      const d = rec.op[1] as Record<string, unknown>;
      const vests = parseAmount(str(d.reward)).n;
      if (vests <= 0) continue;
      const tsIso = ts && !ts.endsWith("Z") ? `${ts}Z` : ts;
      if (!lastOpAt || (tsIso && tsIso > lastOpAt)) lastOpAt = tsIso;
      ops.set(idx, {
        idx,
        ts: tsIso,
        vests,
        author: str(d.comment_author),
        permlink: str(d.comment_permlink),
      });
    }
    walked += hist.length;
    pages += 1;
    if (Number.isFinite(minIdx)) scannedTo = Math.min(scannedTo ?? minIdx, minIdx);
    // תנאי-עצירה: חצינו את תחילת-החלון · או הגענו לתחילת ההיסטוריה
    if (oldestTs && Number.isFinite(iso(oldestTs)) && iso(oldestTs) < floorMs) {
      crossed = true;
      break;
    }
    if (hist.length < 100 || minIdx <= 0) {
      crossed = true;
      break;
    }
    start = minIdx - 1;
  }

  const list = [...ops.values()]
    .filter((o) => {
      const ms = iso(o.ts);
      return Number.isFinite(ms) && ms >= floorMs;
    })
    .sort((a, b) => a.idx - b.idx);
  const vests7d = list.reduce((s, o) => s + o.vests, 0);

  saveCurCheckpoint({
    savedAt: new Date().toISOString(),
    floorIso,
    ops: list,
    headIdx,
    walkedToIdx: crossed ? null : typeof scannedTo === "number" ? scannedTo : null,
    crossedFloor: crossed,
  });

  // חוק-הכנות: סריקה חלקית = הסכום של החלון עדיין לא נגזר — null, לא 0.
  // 0 מדידה מוצהר רק כשהחלון נסרק כולו ולא נמצאה ולו פריעה אחת.
  const measured = crossed;
  return {
    windowDays: CURATION_WINDOW_DAYS,
    ops: measured ? list.length : null,
    vests: measured ? Math.round(vests7d * 1e6) / 1e6 : null,
    steem: null,
    usd: null,
    vestsPerSteem: null,
    partial: !crossed,
    walkedEntries: walked,
    scannedFromIdx: crossed ? null : typeof scannedTo === "number" ? scannedTo : null,
    scannedToIdx: headIdx || null,
    lastOpAt,
    note: crossed
      ? null
      : `סריקה חלקית — תקציב ${CURATION_PAGE_BUDGET} עמודים להרצה; המשך ברענון הבא (נסרקו ${walked} רשומות, עדיין מעל תחילת-החלון)`,
  };
}

async function composeCuration(down: string[]): Promise<CurationStatement> {
  const acctP = jpost<Array<Record<string, unknown>>>("condenser_api.get_accounts", [[ACCOUNT]]).catch((e) => {
    down.push(`curation-account: ${String((e as Error)?.message ?? e).slice(0, 50)}`);
    return null;
  });
  const scanP = scanCurationRewards(down);
  // שער ההמרה VESTS→STEEM מהשרשרת עצמה + דולר של STEEM מביננס (שער-היום, מוצהר)
  const propsP = jpost<Record<string, unknown>>("condenser_api.get_dynamic_global_properties", []).catch((e) => {
    down.push(`curation-props: ${String((e as Error)?.message ?? e).slice(0, 50)}`);
    return null;
  });
  const binanceP = jget("https://api.binance.com/api/v3/ticker/price?symbol=STEEMUSDT", 8000)
    .then((j) => (typeof j?.price === "string" || typeof j?.price === "number" ? Number(j.price) : null))
    .catch(() => null);

  const [acct, last7d, props, steemUsd] = await Promise.all([acctP, scanP, propsP, binanceP]);
  const a = acct?.[0] ?? null;

  // pending claimable — שמות-שדות סטים והייב כאחד (condenser משתנה בין גרסאות).
  // כנות: "0.000 SBD" שהשרשרת ענתה היא מדידה אמיתית של אפס — נשארת 0, לא null
  const pending = {
    hive: amountOrNull(str(a?.reward_hive_balance ?? a?.reward_steem_balance)),
    hbd: amountOrNull(str(a?.reward_hbd_balance ?? a?.reward_sbd_balance)),
    vests: amountOrNull(str(a?.reward_vesting_balance)),
  };
  // curation_rewards לכל-החיים — מגיע לפעמים מספר ולפעמים "N VESTS"
  const lifeRaw = a?.curation_rewards;
  const lifetimeVests =
    typeof lifeRaw === "number" && Number.isFinite(lifeRaw)
      ? lifeRaw
      : parseAmount(str(lifeRaw)).n || null;

  // המרה כנה: בלי שני המוני-השרשרת אין VESTS→STEEM — נשארים null
  const tvf = parseAmount(str(props?.total_vesting_fund_steem)).n;
  const tvs = parseAmount(str(props?.total_vesting_shares)).n;
  const vestsPerSteem = tvf > 0 && tvs > 0 ? tvf / tvs : null;
  const steem = vestsPerSteem != null && last7d.vests != null ? last7d.vests * vestsPerSteem : null;
  const usd = steem != null && steemUsd != null ? steem * steemUsd : null;

  return {
    ok: a != null,
    reason: a == null ? "השרשרת לא ענתה על פרטי-החשבון — אין מדידה" : null,
    account: ACCOUNT,
    pending,
    lifetimeVests,
    last7d: {
      ...last7d,
      steem: steem != null ? Math.round(steem * 1e6) / 1e6 : null,
      usd: usd != null ? Math.round(usd * 1e4) / 1e4 : null,
      vestsPerSteem: vestsPerSteem != null ? Math.round(vestsPerSteem * 1e9) / 1e9 : null,
      note:
        last7d.note ??
        (usd != null ? `אומדן-דולר בשער-היום (STEEM=$${steemUsd?.toFixed(4) ?? "?"}) — מוצהר, לא היסטורי` : null),
    },
  };
}

// ── תשובת-חירום כנה (כל-השדות null + סיבה) ────────────────────────────

export function emptyIncomeStatement(reason: string): IncomeStatement {
  const blank: MarketMakingStatement = {
    present: false,
    reason,
    stateFileMtimeMs: null,
    realizedPnlSbd: null,
    dailyPnlSbd: null,
    unrealizedPnlSbd: null,
    basisBlendedSbd: null,
    lotsCount: null,
    fills24h: null,
    volume24hSteem: null,
    volume24hSbd: null,
    engineVersion: null,
    engineMode: null,
    lastTick: null,
    ledgerFills: [],
    ledgerReason: reason,
  };
  return {
    at: new Date().toISOString(),
    marketMaking: blank,
    curation: {
      ok: false,
      reason,
      account: ACCOUNT,
      pending: { hive: null, hbd: null, vests: null },
      lifetimeVests: null,
      last7d: {
        windowDays: CURATION_WINDOW_DAYS,
        ops: null,
        vests: null,
        steem: null,
        usd: null,
        vestsPerSteem: null,
        partial: false,
        walkedEntries: 0,
        scannedFromIdx: null,
        scannedToIdx: null,
        lastOpAt: null,
        note: reason,
      },
    },
    declaration: { fundingRequests: "none", selfFunded: true },
  };
}

// ── הרכבת דוח-ההכנסה ──────────────────────────────────────────────────

/**
 * מעולם לא זורק — כל כשלון פנימי הופך ל-null עם סיבה כנה.
 */
export async function composeIncomeStatement(): Promise<IncomeStatement> {
  const down: string[] = [];
  try {
    const marketMaking = composeMarketMaking();
    const curation = await composeCuration(down);
    return {
      at: new Date().toISOString(),
      marketMaking,
      curation,
      declaration: { fundingRequests: "none", selfFunded: true },
    };
  } catch (e) {
    // רשת-ביטחון: דוח-ההכנסה לעולם לא מפיל את ה-P&L שמסביבו
    down.push(`income: ${String((e as Error)?.message ?? e).slice(0, 60)}`);
    return emptyIncomeStatement(down.join(" · ").slice(0, 200));
  }
}
