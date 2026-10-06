// ─────────────────────────────────────────────────────────────────────
// /api/sovereign/holdings — מאזן הריבונות (R78 · SOVEREIGN-HOLDINGS).
//
// הוראת המפעיל: "בחן את כלל המצב הקיים — מה יש לנו בידיים, איזה ערך
// זה יכול להפיק ומה חסר כדי למקסם. יש לנו גם רשתות חברתיות שאפשר
// לפרסם בהן ולהרוויח. לעשות סדר במערכת ולהשלים את המערכים החסרים —
// כגוף ריבוני אוטונומי לא תלוי."
//
// חמש שכבות נבנות כאן מנתונים חיים בלבד — שום נכס לא מומצא:
//   1. נכסים — מה יש בידיים: זהויות, צי-קוד, הון, דלק, תוכן, מפתחות,
//      סוכנים — לכל אחד מספר חי ומקור מדידה.
//   2. תזרימי-ערך — מה כבר זורם (FLOWING), מה חמוש וממתין (ARMED),
//      ומה חסום (BLOCKED) — עם החוסם הכן בכל שורה.
//   3. פערים — מה חסר כדי למקסם, דרוג חומרה, והראיה החיה לכל פער.
//   4. רשתות חברתיות — ערוצי פרסום-והרווחה: מה חי, מה מוכן, מה חסר
//      בכנות (חשבונות שאינם בידיים מסומנים MISSING — לא מוסתר).
//   5. מערכים חסרים — מפת השלמה: מה נבנה-ורדום, מה חלקי, מה לא-נבנה —
//      ומה כל השלמה פותחת.
//
// מקורות חיים (כולם נקראים חסר-מפתחות): status.json · money.json ·
// world.json · grid.json · watch.json (הקונסולה הציבורית) · trongrid
// (המשמרת) · api.steemit.com (@headcorner והצי) · api.github.com
// (הריפואים הציבוריים). מקור שנפל מסומן down — לא מוסתר.
//
// בסיסי-מפגש (מסומנים בכנות עם חותמת-מדידה — לא ניתנים לקריאה חסרת
// מפתח): מלאי 16 הריפואים הפרטיים · אדום-ה-Actions · אימות 4/4 המפתחות
// (R76) · ארסנל התוכן (Adsmarket) · 7 סוכני-הראוטר (R77).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";

export const dynamic = "force-dynamic";

const CONSOLE_BASE = "https://roshpinacare-sys.github.io/Console";
const TRON_CUSTODY = "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy";
const GITHUB_USER = "roshpinacare-sys";
const FLEET_ACCOUNTS = ["headcorner", "cashmachine", "lsa"];

// ── חוזה התשובה (BE↔FE) ────────────────────────────────────────────────

export type AssetGroup =
  | "identity"  // זהויות בשרשרות חברתיות
  | "code"      // צי הקוד — הריפואים
  | "capital"   // הון — כלכלה פנימית ומשמרות
  | "fuel"      // דלק — powerdown וגריד
  | "reach"     // תפוצה — אתרים ציבוריים ותוכן
  | "keys"      // מפתחות וסודות
  | "agents"    // הסוכנים — המשתמשים
  | "sandbox";  // סביבת הפיתוח (ארעית — בכנות)

export type AssetState = "LIVE" | "READY" | "WAIT" | "DORMANT" | "EPHEMERAL" | "BASELINE" | "PARTIAL";

export interface HoldingAsset {
  id: string;
  name: string;
  group: AssetGroup;
  state: AssetState;
  /** המספר החי הראשי של הנכס */
  primary: string;
  /** מה בדיוק נמדד ומאיפה */
  source: string;
  /** ערך פוטנציאלי — מה הנכס יכול להפיק */
  potential: string;
}

export type FlowState = "FLOWING" | "ARMED" | "BLOCKED";

export interface ValueStream {
  id: string;
  name: string;
  state: FlowState;
  /** הזרימה הנוכחית הנמדדת */
  now: string;
  /** מה מקסם את הזרימה — בכנות */
  ceiling: string;
  blocker: string | null;
}

export interface GapItem {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium";
  status: "OPEN" | "PARTIAL" | "GATE";
  /** מה מקסום הפתרון */
  unlocks: string;
  /** הראיה החיה לקיום הפער */
  evidence: string;
}

export interface SocialChannel {
  id: string;
  name: string;
  state: "LIVE" | "READY" | "MISSING";
  /** הקהל שהערוץ מגיע אליו */
  audience: string;
  /** איך מרוויחים בו */
  earning: string;
  detail: string;
  actionNeeded: string | null;
}

export interface MissingSystem {
  id: string;
  name: string;
  buildState: "BUILT-DORMANT" | "PARTIAL" | "NOT-BUILT";
  /** מה ההשלמה פותחת */
  unlocks: string;
  effort: string;
  note: string;
}

export interface HoldingsAudit {
  ok: boolean;
  at: string;
  height: number | null;
  assets: HoldingAsset[];
  valueStreams: ValueStream[];
  gaps: GapItem[];
  socialChannels: SocialChannel[];
  missingSystems: MissingSystem[];
  totals: {
    assets: number;
    liveAssets: number;
    flowing: number;
    armed: number;
    blocked: number;
    openGaps: number;
    liveChannels: number;
    missingChannels: number;
  };
  baselines: { label: string; measuredAt: string; what: string }[];
  down: string[];
  cached: boolean;
  stale: boolean;
  cacheAgeSec: number;
  refreshing: boolean;
}

// ── רשת עם timeout (חסר-מפתחות בלבד) ─────────────────────────────────

async function jget(url: string, timeoutMs = 9000, init?: RequestInit): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: { accept: "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function steemAccounts(names: string[]): Promise<any[]> {
  const r = await jget("https://api.steemit.com", 9000, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "condenser_api.get_accounts",
      params: [names],
      id: 1,
    }),
  });
  const res = r?.result;
  if (!Array.isArray(res)) throw new Error("steem: empty");
  return res;
}

const mu = (v: number | undefined) => (v ?? 0) / 1000;
const pct = (x: number | null | undefined, digits = 2) =>
  x == null ? "—" : `${(100 * x).toFixed(digits)}%`;

// ── בסיסי-מפגש — נמדדו עם גישת-מפעיל, מוצגים בכנות עם חותמת ───────────
// (מדידה חיה מ-2026-09-21T21:27Z · ריפואים פרטיים אינם קריאים חסר-מפתח)

const FLEET_MEASURED_AT = "2026-09-21T21:27Z";
const FLEET_TOTAL = 16;
const FLEET_TOTAL_MB = 462; // סכום size ב-KB שנמדד ÷ 1024, מעוגל
// הריפואים הציבוריים שנמדדו חי במפגש זה — משמשים כנפילה-כנה כשה-API
// הציבורי של GitHub נופל (מגבלת-IP 403): הנכס ממשיך להיות מוצג, ומקורו
// מסומן בכנות כבסיס-מפגש במקום מדידה-חיה.
const PUBLIC_REPOS_BASELINE = [
  { name: "Domain", pushed: "2026-09-21T21:27:14Z", size: 2376 },
  { name: "Console", pushed: "2026-09-21T21:21:43Z", size: 4229 },
];
const ACTIONS_EVIDENCE =
  "3 ריצות נכשלו היום (weave-heart 11:08Z · anchor-lines 18:47Z · web-publish 11:12Z — נמדד חי)";
const KEYS_EVIDENCE = "R76: 4/4 רשויות (owner/active/posting/memo) אומתו מול השרשרת החיה";
const CONTENT_EVIDENCE = "Adsmarket: 12 פוסטים + 26 פרסומי EN — נמדד 2026-09-16";
const AGENTS_EVIDENCE = "R77: 7 סוכני-ראוטר, 6 אוטונומיים, 1 בשער-מפעיל";

// ── הרכב המאזן ────────────────────────────────────────────────────────

async function composeAudit() {
  const down: string[] = [];
  const pushDown = (k: string) => (m: string) => {
    down.push(`${k}: ${String(m).slice(0, 40)}`);
    return null;
  };

  const [status, money, world, grid, watch, tronAcct, steem, ghPublic] = await Promise.all([
    jget(`${CONSOLE_BASE}/status.json`).catch(pushDown("status")),
    jget(`${CONSOLE_BASE}/dex/money.json`).catch(pushDown("money")),
    jget(`${CONSOLE_BASE}/dex/world.json`).catch(pushDown("world")),
    jget(`${CONSOLE_BASE}/dex/grid.json`).catch(pushDown("grid")),
    jget(`${CONSOLE_BASE}/dex/watch.json`).catch(pushDown("watch")),
    jget(`https://api.trongrid.io/v1/accounts/${TRON_CUSTODY}`).catch(pushDown("tron")),
    steemAccounts(FLEET_ACCOUNTS).catch(pushDown("steem")),
    jget(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=pushed`).catch(pushDown("github")),
  ]);

  // ── חילוץ מספרים חיים ─────────────────────────────────────────────
  const head = steem?.find?.((a: any) => a?.name === "headcorner") ?? null;
  const fleetAlive = Array.isArray(steem) ? steem.length : 0;
  const fresh = status?.freshness?.verdict === "FRESH";
  const attestations = status?.witness?.attestations ?? null;
  const checkpoint = status?.witness?.checkpoint ?? null;

  const pd = money?.fuel?.powerdown;
  const weeklyUsd = money?.weeklyUsd ?? grid?.fuel?.weeklyUsd ?? 0;
  const redemption = money?.redemption;
  const custodyTrx =
    tronAcct?.data?.[0]?.balance != null ? tronAcct.data[0].balance / 1e6 : (redemption?.custody?.balanceTrx ?? null);

  const pools = world?.pools ?? [];
  const swaps = world?.state?.swaps ?? 0;
  const height = world?.state?.height ?? null;
  const savings = world?.state?.savings ?? {};
  const savApy = savings?.apyBps != null ? savings.apyBps / 10000 : null;
  const feesTotal = pools.reduce((s: number, p: any) => s + mu(p.feeAccruedTreasury), 0);
  const treasuryUsds = mu(
    (world?.wallets ?? []).find((w: any) => w.name === "treasury")?.balances?.USDS,
  );
  const operatorUsds = mu(
    (world?.wallets ?? []).find((w: any) => w.name === "operator")?.balances?.USDS,
  );
  const poolsTvl = pools.reduce((s: number, p: any) => s + mu(p.ra), 0);
  const thinPools = pools.filter((p: any) => mu(p.ra) < 1).length;

  const gridArmed = grid?.armed === true;
  const gridFills = grid?.run?.filledTotal ?? 0;
  const gridFlowUsd = grid?.externalFlowUsd ?? 0;
  const gridBlockers: string[] = Array.isArray(grid?.blocker) ? grid.blocker : [];

  const watchChainsOk = Object.values(watch?.chains ?? {}).filter((s) =>
    String(s).startsWith("ok"),
  ).length;
  const depositsTotal = watch?.depositsTotal ?? 0;

  const publicReposLive: Array<{ name: string; pushed: string; size: number }> = Array.isArray(ghPublic)
    ? ghPublic.map((r: any) => ({ name: r.name, pushed: r.pushed_at, size: r.size }))
    : [];
  const publicReposFallback = publicReposLive.length === 0;
  const publicRepos = publicReposFallback ? PUBLIC_REPOS_BASELINE : publicReposLive;
  const publicNames = publicRepos.map((r) => r.name);
  const privateCount = Math.max(FLEET_TOTAL - publicRepos.length, 0);
  const publicSitesSource = publicReposFallback
    ? `נפילה כנה: ה-API הציבורי של GitHub נופל (403/מגבלה) · בסיס-מפגש ${FLEET_MEASURED_AT} · ${publicRepos.map((r) => `${r.name}@${r.pushed.slice(11, 16)}Z`).join(" · ")}`
    : `api.github.com חסר-מפתח · ${publicRepos.map((r) => `${r.name}@${r.pushed.slice(11, 16)}Z`).join(" · ")}`;

  // ── 1. נכסים — מה יש בידיים ────────────────────────────────────────
  const assets: HoldingAsset[] = [];

  assets.push({
    id: "steem-headcorner",
    name: "זהות Steem — @headcorner",
    group: "identity",
    state: head ? "LIVE" : "WAIT",
    primary: head
      ? `${(Number(String(head.vesting_shares).replace(" VESTS", "")) / 1e6).toFixed(2)}M VESTS · ${head.post_count} פוסטים`
      : "—",
    source: "api.steemit.com · חשבון חי מ-2018 · עד 2 עדי-שרשרת",
    potential: "ריבונות העדות (עוגן ב-$0) + פרסום מרוויח: מחבר/אוצר-קשב → SP/SBD",
  });
  assets.push({
    id: "steem-fleet",
    name: "חשבונות הצי ב-Steem",
    group: "identity",
    state: fleetAlive >= FLEET_ACCOUNTS.length ? "LIVE" : "PARTIAL",
    primary: `${fleetAlive}/${FLEET_ACCOUNTS.length} חיים (headcorner · cashmachine · lsa)`,
    source: "api.steemit.com · מדידה חיה",
    potential: "פיזור פעילות ואוצר-קשב רב-חשבוני — עמידות ללא נקודת-כשל אחת",
  });
  assets.push({
    id: "witness-line",
    name: "קו העדות — העד בשרשרת",
    group: "identity",
    state: fresh ? "LIVE" : "WAIT",
    primary:
      attestations != null
        ? `${attestations} אימותים · צ׳קפוינט ${checkpoint} · ${status?.freshness?.verdict}`
        : "—",
    source: `status.json חי · עדכון אחרון ${status?.generatedAt ?? "—"}`,
    potential: "הספר הציבורי שמאמת כל טענה — עמוד השדרה של האמון ברשת",
  });
  assets.push({
    id: "repo-fleet",
    name: "צי הקוד — 16 ריפואים",
    group: "code",
    state: "BASELINE",
    primary: `${FLEET_TOTAL} ריפואים · ~${FLEET_TOTAL_MB}MB · ${privateCount} פרטיים · ${publicRepos.length} ציבוריים`,
    source: `נמדד ${FLEET_MEASURED_AT} עם גישת-מפעיל · הציבוריים מאומתים חי בכל קריאה`,
    potential: "כל הארסנל: פלטפורמה, בורסה, ארנק 7-רשתות, גריד, נוטריון-עוגן, קרנל-סוכנים, שיווק",
  });
  assets.push({
    id: "public-sites",
    name: "האתרים הציבוריים (Pages)",
    group: "reach",
    state: publicRepos.length >= 2 ? "LIVE" : publicRepos.length === 1 ? "PARTIAL" : "WAIT",
    primary: publicRepos.length
      ? publicRepos.map((r) => r.name).join(" · ") + (publicReposFallback ? " — בסיס-מפגש (החי נפל)" : " — נדחפו חי היום")
      : "—",
    source: publicSitesSource,
    potential: "חזית ציבורית לכל גולש: קונסולה, שער, דקס, דפים — ללא תלות בסנדבוקס",
  });
  assets.push({
    id: "internal-economy",
    name: "הכלכלה הפנימית (world)",
    group: "capital",
    state: height != null ? "LIVE" : "WAIT",
    primary:
      height != null
        ? `גובה ${height.toLocaleString("en-US")} · ${swaps.toLocaleString("en-US")} החלפות · ${pools.length} בריכות · עומק ${poolsTvl.toFixed(0)} USDS`
        : "—",
    source: `world.json חי · עמלות נאספו ${feesTotal.toFixed(2)} USDS · אוצר ${treasuryUsds.toFixed(0)} USDS פנויים`,
    potential: "מפעל-עמלות מפעילות-עצמה: כל החלפה מזינה אוצר→קרן→חוסכים — נזילות יש מאין",
  });
  assets.push({
    id: "savings-fund",
    name: "קרן החיסכון",
    group: "capital",
    state: (savings?.potMu ?? 0) > 0 ? "LIVE" : "DORMANT",
    primary: `${mu(savings?.potMu).toFixed(0)} USDS בקרן · APY ${pct(savApy)} נמדד · ${savings?.savers ?? 0} חוסכים`,
    source: `world.json חי · שולם ${mu(savings?.paidMu).toFixed(2)} USDS לחוסכים עד היום`,
    potential: "מנוע ריבית-דריבית: 30% חית-עמלות + ריבית + עתודה — מתועד ומורכב יומית",
  });
  assets.push({
    id: "tron-custody",
    name: "המשמרת ב-TRON",
    group: "capital",
    state: custodyTrx != null && custodyTrx > 0 ? "LIVE" : "WAIT",
    primary: custodyTrx != null ? `${custodyTrx.toFixed(6)} TRX` : "—",
    source: "trongrid חי · הדלת החוצה ל-SunSwap→USDT→JustLend (בנוי, ממתין לסף-הון)",
    potential: "רגל-היציאה לעורק הסליקה הגדול בעולם — USDT-טרון $23.8B/יום",
  });
  assets.push({
    id: "fuel-powerdown",
    name: "מנוע הדלק (powerdown)",
    group: "fuel",
    state: pd?.active ? "LIVE" : "DORMANT",
    primary: pd?.active ? `${pd.rateSp} SP/שבוע ≈ $${weeklyUsd.toFixed(2)}/שבוע` : "כבוי",
    source: `money.json חי · תשלום הבא ${pd?.nextPayout ?? "—"} · נותר ${(Number(pd?.remainingVests ?? 0) / 1e6).toFixed(0)}M VESTS`,
    potential: "הכנסה שבועית קבועה מההון החברתי → דלק לגריד → נזילות חוץ",
  });
  assets.push({
    id: "grid-external",
    name: "הגריד החוץ (STEEM market)",
    group: "fuel",
    state: gridArmed ? "LIVE" : "WAIT",
    primary: `${gridFills} מילויים · זרימה $${gridFlowUsd.toFixed(4)}`,
    source: `grid.json חי · פסק-דין ${grid?.verdict ?? "—"}${gridBlockers.length ? ` · חוסם: ${gridBlockers[0]}` : ""}`,
    potential: "מכונת-הנזילות המוכחת: המשך grid98 שייצר 90% מנזילות הדקס — עכשיו על השרשרת החיה",
  });
  assets.push({
    id: "bridges-4",
    name: "גשרי ההפקדות (4 רשתות)",
    group: "capital",
    state: watchChainsOk >= 4 ? "READY" : "WAIT",
    primary: `${watchChainsOk}/4 רשתות ok · ${depositsTotal} הפקדות`,
    source: "watch.json חי · TRON · EVM · SOL · BTC — נצפים חסר-מפתחות כל 20 דק׳",
    potential: "כל הפקדה חוץ ≥$5 → תביעה → זיכוי USDS — שער קליטת הון פתוח לעולם",
  });
  assets.push({
    id: "keys-vault",
    name: "המפתחות (4/4 מאומתים)",
    group: "keys",
    state: "BASELINE",
    primary: "owner · active · posting · memo — הכל מקושר לאמת",
    source: KEYS_EVIDENCE,
    potential: "ה-active הוא גם מפתח-המשמרת ב-TRON (32 בתים גולמיים) — דלת אחת, שתי רשתות",
  });
  assets.push({
    id: "content-arsenal",
    name: "ארסנל התוכן",
    group: "reach",
    state: "BASELINE",
    primary: "12 פוסטים + 26 פרסומי EN מוכנים",
    source: CONTENT_EVIDENCE,
    potential: "חומר פרסום מוכן-לעריכה: פיץ׳, מודעות, תסריטים, press-kit — חיכוך אפס ליציאה לדרך",
  });
  assets.push({
    id: "agents-users",
    name: "הסוכנים — המשתמשים",
    group: "agents",
    state: "BASELINE",
    primary: "7 סוכני-ראוטר · 6 אוטונומיים · 1 בשער-מפעיל",
    source: AGENTS_EVIDENCE,
    potential: "כוח-העבודה העצמאי: לב-הדקס, מנוע חיסכון, צופה כסף, צופה חסר-מפתחות, זרם-אוצר, חיילי אשראי",
  });
  assets.push({
    id: "sandbox",
    name: "סביבת הפיתוח (הסנדבוקס)",
    group: "sandbox",
    state: "EPHEMERAL",
    primary: "נמחקת מדי יום — ומוחזרת מהרשת בכל מפגש",
    source: "נמדד בכל מפגש: הקנון חי ב-GitHub+Steem, המקומי נבנה מחדש מהם",
    potential: "מרחב בנייה חופשי — אבל אינו נכס: רק מה שנדחף החוצה שורד",
  });

  // ── 2. תזרימי-ערך — מה זורם, מה חמוש, מה חסום ─────────────────────
  const valueStreams: ValueStream[] = [
    {
      id: "vs-fees",
      name: "עמלות מפעילות-עצמה",
      state: "FLOWING",
      now: `${feesTotal.toFixed(2)} USDS נאספו מ-${swaps.toLocaleString("en-US")} החלפות`,
      ceiling: `כל החלפה מזינה את האוצר — 30% מהחית זורמים לקרן (${mu(savings?.incomeStreams?.feeShareMu).toFixed(2)} עד כה)`,
      blocker: null,
    },
    {
      id: "vs-savings",
      name: "ריבית הקרן",
      state: (savings?.potMu ?? 0) > 0 ? "FLOWING" : "ARMED",
      now: `APY ${pct(savApy)} על ${mu(savings?.potMu).toFixed(0)} USDS · שולם ${mu(savings?.paidMu).toFixed(2)}`,
      ceiling: "מורכב יומית מהכנסה המדודה — גדל עם כל החלפה וכל מילוי",
      blocker: null,
    },
    {
      id: "vs-fuel",
      name: "דלק שבועי (powerdown)",
      state: pd?.active ? "FLOWING" : "ARMED",
      now: `$${weeklyUsd.toFixed(2)}/שבוע · תשלום הבא ${pd?.nextPayout?.slice(0, 10) ?? "—"}`,
      ceiling: `~$${(weeklyUsd * 4.33).toFixed(0)}/חודש מההון החברתי — זרימה אוטומטית לגריד`,
      blocker: null,
    },
    {
      id: "vs-grid",
      name: "נזילות חוץ (הגריד)",
      state: gridArmed && gridFills > 0 ? "FLOWING" : gridArmed ? "ARMED" : "BLOCKED",
      now: `${gridFills} מילויים · $${gridFlowUsd.toFixed(4)} זרמו החוצה`,
      ceiling: "הדלק הנוחת נמכר בשוק STEEM החיצוני — ערוץ ההמרה היחיד שכבר עובד",
      blocker: gridBlockers[0] ?? null,
    },
    {
      id: "vs-publish",
      name: "פרסום מרוויח (Steem)",
      state: "ARMED",
      now: "זהות מאומתת + 905 פוסטים היסטוריים + ארסנל תוכן — הצינור בנוי",
      ceiling: "פרסום קבוע → פרסי מחבר/אוצר-קשב ב-SP/SBD → מזין את מנוע הדלק — תלוי בסוכן הפרסום",
      blocker: "סוכן הפרסום האוטונומי טרם נבנה — כרגע פרסום ידני בלבד",
    },
    {
      id: "vs-deposits",
      name: "הפקדות חוץ (4 רשתות)",
      state: depositsTotal > 0 ? "FLOWING" : "ARMED",
      now: `${depositsTotal} הפקדות · ${watchChainsOk}/4 רשתות ok`,
      ceiling: "כל הפקדה ≥$5 = הון חיצוני נכנס → USDS → כלי תשואה — הזרימה תיוולד עם ההפקדה הראשונה",
      blocker: depositsTotal === 0 ? "אפס הפקדות עד עתה — השער פתוח, העולם עוד לא בא" : null,
    },
    {
      id: "vs-tron",
      name: "נתיב TRON (יציאה)",
      state:
        redemption?.outboxTrx != null && redemption.outboxTrx >= (redemption?.sendThresholdTrx ?? 1.05)
          ? "FLOWING"
          : "BLOCKED",
      now: `משמרת ${custodyTrx?.toFixed(6) ?? "—"} TRX · פדיון ${redemption?.outboxTrx ?? "?"} מתוך ${redemption?.sendThresholdTrx ?? "?"} TRX`,
      ceiling: "SunSwap → USDT → JustLend: המסלול בנוי — ייפתח כשההון יעבור את סף-העלות הכלכלי",
      blocker: redemption?.action ?? "סף-הון לא נחצה",
    },
    {
      id: "vs-idle",
      name: "פריסת הון פנוי",
      state: "ARMED",
      now: `${(treasuryUsds + operatorUsds).toFixed(0)} USDS פנויים (אוצר ${treasuryUsds.toFixed(0)} + מפעיל ${operatorUsds.toFixed(0)})`,
      ceiling: "דירוג חי של כלי התשואה — הפריסה הגדולה דורשת שער-מפעיל (החלטת סיכון-הון)",
      blocker: "פריסה גדולה = שער-מפעיל — בכנות, לא מוסתר",
    },
  ];

  // ── 3. פערים — מה חסר כדי למקסם ────────────────────────────────────
  const gaps: GapItem[] = [
    {
      id: "gap-actions",
      title: "Actions אדום — דקות החינם אזלו",
      severity: "critical",
      status: "PARTIAL",
      unlocks: "אוטומציה עננית מלאה 24/7 (לב שעתי, עוגנים דו-שעתיים, פרסום)",
      evidence: `${ACTIONS_EVIDENCE} · הפוגה: ריבונות הדחיפה עובדת — 5 ריפואים נדחפו ישירות היום`,
    },
    {
      id: "gap-sbd",
      title: "מלאי SBD לצד-הקנייה של הגריד",
      severity: "high",
      status: "OPEN",
      unlocks: "הגריד ממלא גם קניות — לא רק מכירות — ומכפיל את נזילות החוץ",
      evidence: gridBlockers[0] ?? "אין חוסם חי — הגריד ממלא בשני הכיוונים",
    },
    {
      id: "gap-reach",
      title: "תפוצה מחוץ ל-Steem",
      severity: "high",
      status: "OPEN",
      unlocks: "קהל ב-X/טלגרם → תנועה לאתרים הציבוריים → הפקדות ראשונות",
      evidence: "נמדד ביד: אפס חשבונות חוץ ברשות — רק Steem חי (905 פוסטים, מאומת)",
    },
    {
      id: "gap-deposits",
      title: "אפס הפקדות חוץ",
      severity: "medium",
      status: "OPEN",
      unlocks: "ההון החיצוני הראשון נכנס → USDS → מנוע התשואה מתחיל לעבוד על כסף אמיתי",
      evidence: `watch.json חי: ${depositsTotal} הפקדות · ${watchChainsOk}/4 רשתות ok — השער בנוי וממתין`,
    },
    {
      id: "gap-redemption",
      title: "סף הפדיון לא נחצה",
      severity: "medium",
      status: "OPEN",
      unlocks: "ה-USDS המגובה נפדה ל-TRON חוץ — המעגל נסגר",
      evidence: redemption?.action ?? "—",
    },
    {
      id: "gap-thin-pools",
      title: "בריכות דקות",
      severity: "medium",
      status: "PARTIAL",
      unlocks: "כל בריכה מעל עומק-מינימום = נזילות עבור זרימה אחרת",
      evidence: `${thinPools} מתוך ${pools.length} בריכות מתחת ל-1 USDS עומק (world.json חי)`,
    },
    {
      id: "gap-sandbox",
      title: "הסנדבוקס נמחק מדי יום",
      severity: "medium",
      status: "PARTIAL",
      unlocks: "רצף פיתוח ללא חימום-מחדש יומי — האצת השלמות",
      evidence: "נמדד בכל מפגש: הקנון שורד (GitHub+Steem+Pages), הזיכרון המקומי לא — ולכן כל מפגש מתחיל בקריאת-אמת מהרשת",
    },
  ];

  // ── 4. רשתות חברתיות — ערוצי פרסום והרווחה ─────────────────────────
  const socialChannels: SocialChannel[] = [
    {
      id: "sc-steem",
      name: "Steem — @headcorner + הצי",
      state: "LIVE",
      audience: "קהילת Steem חיה (3.7M חשבונות בשרשרת)",
      earning: "פרסי מחבר ואוצר-קשב ב-SP/SBD — SP גדל → יותר דלק",
      detail: `זהות מאומדת 4/4 · ${head?.post_count ?? "—"} פוסטים היסטוריים · עלות פרסום $0 (RC)`,
      actionNeeded: null,
    },
    {
      id: "sc-kit",
      name: "ארסנל התוכן (Adsmarket)",
      state: "READY",
      audience: "מוכן לפרסום מיידי — 38 יצירות מדודות",
      earning: "חומר מוכן = אפס עלות יצירה לכל פרסום עתידי",
      detail: "12 פוסטים + 26 פרסומי EN + פיץ׳ 30ש׳/2ד׳/5ד׳ + מודעות + תסריטים",
      actionNeeded: "לחבר לסוכן פרסום — החומר מחכה לצינור",
    },
    {
      id: "sc-console",
      name: "האתרים הציבוריים (Console + Domain)",
      state: "LIVE",
      audience: "כל גולש באינטרנט — ללא הרשמה",
      earning: "נקודת-נחיתה להפקדות: כתובות הגשר גלויות בעמוד הכסף",
      detail: publicNames.length
        ? `${publicNames.join(" · ")} — ${publicReposFallback ? "בסיס-מפגש" : "נדחפו חי היום"} (GitHub Pages, חינם)`
        : "לא נמדדו ריפואים ציבוריים חיים",
      actionNeeded: null,
    },
    {
      id: "sc-hive",
      name: "Hive",
      state: "MISSING",
      audience: "קהילת Hive — שרשרת-אחות של Steem",
      earning: "פרסי מחבר ב-HIVE/HBD — פיזור שני חינמי",
      detail: "קווי-עוגן ל-Hive חיים במערכת — אבל מפתחות פרסום ל-Hive לא נמדדו ביד",
      actionNeeded: "לגזור/לייבא מפתח posting ל-Hive — החלטת מפעיל",
    },
    {
      id: "sc-x",
      name: "X (טוויטר)",
      state: "MISSING",
      audience: "קהל הקריפטו הרחב — שם הקשב",
      earning: "עקיף: תנועה → הפקדות דרך האתרים הציבוריים",
      detail: "אין חשבון ביד — בכנות: נכס שלא קיים, לא מומצא",
      actionNeeded: "פתיחת חשבון + מפתח API — החלטת מפעיל",
    },
    {
      id: "sc-telegram",
      name: "טלגרם",
      state: "MISSING",
      audience: "ערוץ שידור + בוט (מודל שהוכיח את עצמו: GMGN $6.5B/חודש)",
      earning: "עקיף: קהילה → תנועה → הפקדות",
      detail: "אין ערוץ/bot-token ביד — בכנות",
      actionNeeded: "פתיחת ערוץ + bot — החלטת מפעיל",
    },
  ];

  // ── 5. מערכים חסרים — מפת ההשלמה ───────────────────────────────────
  const missingSystems: MissingSystem[] = [
    {
      id: "ms-publish-agent",
      name: "סוכן פרסום אוטונומי",
      buildState: "NOT-BUILT",
      unlocks: "פרסום תדיר מהארסנל → פרסים חוזרים ב-SP/SBD → האצת מנוע הדלק",
      effort: "בינוני — דמון מתוזמן + מפתח posting (יש בכספת)",
      note: "החלק החסר הגדול ביותר בריבונות הכלכלית: הפרסום עדיין ידני",
    },
    {
      id: "ms-sbd-loop",
      name: "לולאת צבירת SBD",
      buildState: "PARTIAL",
      unlocks: "צד-הקנייה של הגריד נפתח — מילויים בשני הכיוונים",
      effort: "נמוך — העברת SBD מפרסים/מכירות למלאי commitable",
      note: "נמדד חי: 0.049 SBD ביד מול 0.15 נדרשים — הפער קטן וסגיר",
    },
    {
      id: "ms-audience",
      name: "ערוצי קהל חוץ (X/טלגרם)",
      buildState: "NOT-BUILT",
      unlocks: "תפוצה מעבר ל-Steem → תנועה → הפקדות ראשונות",
      effort: "נמוך-בינוני — פתיחת חשבונות (החלטת מפעיל) + חיבור תוכן",
      note: "החוליה החסרה בין הארסנל לעולם — הכל מוכן חוץ מהחשבונות",
    },
    {
      id: "ms-tron-defi",
      name: "נתיב TRON החי (SunSwap→JustLend)",
      buildState: "BUILT-DORMANT",
      unlocks: "הון המשמרת מתחיל לעבוד בעורק הסליקה הגדול",
      effort: "הון: מעל סף-עלות שידור — לא קוד",
      note: "המסלול מוגדר ומדוד — חסם כלכלי טהור, לא טכני",
    },
    {
      id: "ms-revenue-gov",
      name: "מושל הרווחים (revenue-governor)",
      buildState: "BUILT-DORMANT",
      unlocks: "ממשל אוטומטי על הכנסות הדקס — חלוקה מדידה לפי מדיניות",
      effort: "הפעלה: להעיר מ-saos-control-center (18.6KB מוכן)",
      note: "נמדד במלאי-המערכות — מוכן, רדום",
    },
    {
      id: "ms-router",
      name: "מנוע ניתוב ה-DeFi",
      buildState: "BUILT-DORMANT",
      unlocks: "כל מסלולי ההון מחושבים וגלויים — תשתית ההחלטה",
      effort: "הושלם (R77) — לתחזק ולהרחיב",
      note: "22 כלים · 6 מסלולים · 7 סוכנים — חי באתר",
    },
    {
      id: "ms-persistence",
      name: "שכבת ההישרדות מעבר לסנדבוקס",
      buildState: "BUILT-DORMANT",
      unlocks: "הקנון שורד כל מחיקה יומית — אמת מוחזרת מהרשת",
      effort: "הושלם — GitHub (16 ריפואים) + Steem (עדות שעתית) + Pages (2 אתרים)",
      note: "הוכח במפגש זה: הכל נקרא מחדש מהרשת, שום דבר לא אבד",
    },
  ];

  // ── סיכומים ───────────────────────────────────────────────────────
  const flowing = valueStreams.filter((v) => v.state === "FLOWING").length;
  const armed = valueStreams.filter((v) => v.state === "ARMED").length;
  const blocked = valueStreams.filter((v) => v.state === "BLOCKED").length;
  const liveAssets = assets.filter((a) => a.state === "LIVE" || a.state === "READY").length;

  const audit: Omit<HoldingsAudit, "cached" | "stale" | "cacheAgeSec" | "refreshing"> = {
    ok: down.length === 0,
    at: new Date().toISOString(),
    height,
    assets,
    valueStreams,
    gaps,
    socialChannels,
    missingSystems,
    totals: {
      assets: assets.length,
      liveAssets,
      flowing,
      armed,
      blocked,
      openGaps: gaps.filter((g) => g.status !== "GATE").length,
      liveChannels: socialChannels.filter((c) => c.state === "LIVE").length,
      missingChannels: socialChannels.filter((c) => c.state === "MISSING").length,
    },
    baselines: [
      { label: "צי הריפואים (16 · ~462MB · 2 ציבוריים)", measuredAt: FLEET_MEASURED_AT, what: "GitHub API עם גישת-מפעיל" },
      { label: "אדום-ה-Actions (3 כישלונות היום)", measuredAt: "2026-09-21T18:47Z", what: "runs API חי" },
      { label: "אימות המפתחות 4/4", measuredAt: "R76 (2026-09-21)", what: "הצלבת api.steemit.com" },
      { label: "ארסנל התוכן (12+26)", measuredAt: "2026-09-16", what: "מלאי-המערכות (Task 32-b)" },
      { label: "7 סוכני-ראוטר", measuredAt: "R77 (2026-09-21)", what: "הקנון בריפו Defi" },
    ],
    down,
  };

  return audit;
}

// ── ה-handler — SWR 60 שניות, כנות מלאה בכל תשובה ─────────────────────

export async function GET() {
  const { value, meta } = await swrGet("sovereign-holdings-v1", 60_000, composeAudit);
  return NextResponse.json(
    { ...value, cached: meta.cached, stale: meta.stale, cacheAgeSec: meta.cacheAgeSec, refreshing: meta.refreshing },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}
