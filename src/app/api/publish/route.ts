// ─────────────────────────────────────────────────────────────────────
// /api/publish — סוכן הפרסום האוטונומי (R79 · VOICE).
//
// הוראת המפעיל שיצרה את המערכת: "יש לנו גם רשתות חברתיות שאפשר
// לפרסם בהם ולהרוויח עוד. יש לעשות עוד סדר במערכת כדי לנצל
// ולהפעיל את כולה ולהשלים את המערכים החסרים — כגוף ריבוני
// אוטונומי לא תלוי." R78 מיפה את סוכן-הפרסום כהחלק החסר הגדול
// בריבונות הכלכלית — המערכת הזו היא ההשלמה.
//
// ארבע שכבות נבנות כאן:
//   1. מפעל התוכן (Foundry) — טיוטות שנולדות מנתונים חיים בלבד:
//      דוח-אמת (HE+EN) וסיפור-נזילות. הטיוטה מתרעננת בכל קריאה —
//      הפוסט הבא תמיד נושא את המספרים של עכשיו, עם מקור לכל מספר.
//   2. תור הפרסום (Queue) — כל טיוטה שאושרה נשמרת ב-DB עם מחזור-חיים
//      מלא: QUEUED → PUBLISHING → PUBLISHED/FAILED. קבלה לכל שידור:
//      פרמאלינק · txid · קישור חי.
//   3. מנגנון השידור (Broadcast) — אמיתי: גזירת מפתח-ה-posting
//      בזיכרון-ההרצה בלבד מה-upload של המפעיל, אימות ביט-מול-ביט
//      מול הרשות החיה (דוקטרינת R75: המפתח מכריז את החותם,
//      השרשרת השופטת), ורק אז broadcast.comment ל-api.steemit.com.
//      המפתח לעולם לא נכתב, לא נדפס, לא נשמר — לא ב-DB, לא בלוג.
//   4. הרווחים (Earnings) — מדידה חיה: יתרות החשבון, תגמולים
//      ממתינים, תזרים הדלק, עמלות הכלכלה — וספירת-אמת: מה כבר
//      פורסם על-ידי הסוכן.
//
// מקורות חיים (חסרי-מפתחות): api.steemit.com (@headcorner) ·
// status.json · money.json · world.json (הקונסולה הציבורית) ·
// api.github.com (Adsmarket — עם PAT המוחזק בזיכרון, שמות קבצים בלבד).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { readOwnerSource, steemSigningWif } from "@/lib/owner-key"; // r137 · D-026: מקור-מפתח דו-מצבי
import { swrGet, cacheHeader, swrInvalidate } from "@/lib/live/swr";
import { headOk } from "@/lib/live/head-check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONSOLE_BASE = "https://roshpinacare-sys.github.io/Console";
const GITHUB_USER = "roshpinacare-sys";
const UPLOAD_DIR = "/home/z/my-project/upload";
// r137 · D-026: קריאת המפתח עברה לספריית owner-key המשותפת (OWNER_FILE שם)
const PAT_FILE = path.join(UPLOAD_DIR, "pat.env");
const HOME = "/home/z/my-project";

// ── חוזה התשובה (BE↔FE) ────────────────────────────────────────────────

export type ChannelState = "LIVE" | "ARMED" | "MISSING";

export interface PublishChannel {
  id: string; // steem | sites | hive | x | telegram
  name: string;
  state: ChannelState;
  audience: string;
  earning: string;
  detail: string;
  actionNeeded: string | null;
}

export interface DraftNumber {
  label: string;
  value: string;
  source: string;
}

export interface FoundryDraft {
  id: string;
  kind: "TRUTH-REPORT" | "LIQUIDITY";
  lang: "HE" | "EN";
  title: string;
  tags: string[];
  /** הגוף המלא — markdown מוכן לשידור */
  body: string;
  /** תצוגה מקדימה */
  preview: string;
  /** המספרים החיים שמהם נולדה הטיוטה */
  numbers: DraftNumber[];
}

export interface ArsenalShelf {
  state: "READY" | "BASELINE";
  filesCount: number | null;
  markdownCount: number | null;
  titles: string[];
  source: string;
  note: string;
}

export interface QueueTask {
  id: string;
  kind: string;
  lang: string;
  title: string;
  status: string;
  tags: string;
  queuedAt: string;
  publishedAt: string | null;
  permlink: string | null;
  txid: string | null;
  url: string | null;
  error: string | null;
}

export interface EarningsSnapshot {
  account: string | null;
  balanceSteem: string | null;
  balanceSbd: string | null;
  pendingSteem: string | null;
  pendingSbd: string | null;
  pendingVests: string | null;
  vestingShares: string | null;
  postCount: number | null;
  lastRootPost: string | null;
  flows: { id: string; name: string; now: string; source: string }[];
  publishedByAgent: number;
  honestNote: string;
}

export interface AutonomyRow {
  id: string;
  name: string;
  does: string;
  autonomy: "AUTONOMOUS" | "POLICY-GATED" | "OPERATOR-GATE";
}

export interface PublisherState {
  ok: boolean;
  at: string;
  broadcastCapable: boolean;
  keyMaterial: { present: boolean; account: string };
  channels: PublishChannel[];
  foundry: { drafts: FoundryDraft[]; arsenal: ArsenalShelf };
  queue: QueueTask[];
  earnings: EarningsSnapshot;
  autonomy: AutonomyRow[];
  doctrine: string[];
  down: string[];
  cached: boolean;
  stale: boolean;
  cacheAgeSec: number;
  refreshing: boolean;
}

// ── רשת עם timeout (חסר-מפתחות) ─────────────────────────────────────

async function jget(url: string, timeoutMs = 9000, init?: RequestInit): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        accept: "application/json",
        "user-agent": "the-weave-publisher/1.0",
        ...(init?.headers ?? {}),
      },
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

// ── מפתח המפעיל: קריאה בזיכרון-ההרצה בלבד ────────────────────────────
// הסוד לעולם לא מוחזר בתשובה, לא נכתב ללוג, לא נשמר ב-DB.
// מה שמוחזר: רק עצם-קיום ושם-החשבון (נמדד מהקובץ עצמו).

function readOwnerKey(): { account: string; password: string; wif?: string } | null {
  // r137 · D-026: מקור-המפתח הדו-מצבי — מצב-אב או מצב-wif (הדלת).
  // הסוד לעולם לא מוחזר בתשובה, לא נכתב ללוג, לא נשמר ב-DB.
  const src = readOwnerSource();
  if (!src) return null;
  if (src.mode === "master" && src.master) return { account: src.account, password: src.master };
  if (src.mode === "wif" && src.activeWif) return { account: src.account, password: "", wif: src.activeWif };
  return null;
}

// ── פרמאלינק תקני (ASCII בלבד — Steem דורש) ────────────────────────────

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/['".,!?()[\]{}:;]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug || "the-weave";
}

// ── מפעל התוכן: טיוטות מנתונים חיים ────────────────────────────────────

interface LiveNumbers {
  attestations: number | null;
  checkpoint: number | null;
  fresh: boolean | null;
  feesUsds: number | null;
  savingsApyPct: number | null;
  savingsCapital: number | null;
  swaps: number | null;
  powerdownWeeklyUsd: number | null;
  powerdownSp: number | null;
  custodyTrx: number | null;
  steemBalance: string | null;
  postCount: number | null;
}

function truthReportDraft(n: LiveNumbers, lang: "HE" | "EN"): FoundryDraft {
  const stamp = new Date().toISOString().slice(0, 10);
  const numbers: DraftNumber[] = [
    { label: lang === "HE" ? "אימותים בספר" : "Attestations in the book", value: n.attestations != null ? String(n.attestations) : "—", source: "status.json · הקונסולה הציבורית" },
    { label: lang === "HE" ? "צ'קפוינט אחרון" : "Latest checkpoint", value: n.checkpoint != null ? `#${n.checkpoint}` : "—", source: "status.json · שורש מרקל חתום" },
    { label: lang === "HE" ? "עמלות שנאספו" : "Fees accrued", value: n.feesUsds != null ? `${n.feesUsds.toFixed(2)} USDS` : "—", source: "world.json · בריכות הדקס" },
    { label: lang === "HE" ? "קרן החיסכון" : "Savings fund", value: n.savingsApyPct != null ? `${n.savingsCapital ?? 0} USDS · APY נמדד ${n.savingsApyPct.toFixed(2)}%` : "—", source: "world.json · apyBps חי" },
    { label: lang === "HE" ? "החלפות בכלכלה הפנימית" : "Swaps on the internal economy", value: n.swaps != null ? String(n.swaps) : "—", source: "world.json · גובה שרשרת" },
    { label: lang === "HE" ? "דלק שבועי (powerdown)" : "Weekly fuel (powerdown)", value: n.powerdownWeeklyUsd != null ? `${n.powerdownSp ?? 0} SP ≈ $${n.powerdownWeeklyUsd.toFixed(2)}` : "—", source: "money.json · שרשרת Steem" },
    { label: lang === "HE" ? "משמרת TRON" : "TRON custody", value: n.custodyTrx != null ? `${n.custodyTrx.toFixed(6)} TRX` : "—", source: "trongrid · שרשרת חיה" },
    { label: lang === "HE" ? "יתרת החשבון" : "Account balance", value: n.steemBalance ?? "—", source: "api.steemit.com · get_accounts" },
  ];

  let title: string;
  let body: string;
  const tags = lang === "HE" ? ["steem", "saos", "ai-agents", "transparency", "tech"] : ["steem", "ai-agents", "transparency", "blockchain", "tech"];

  if (lang === "HE") {
    title = `THE WEAVE · דוח אמת — הרשת שמאמתת את עצמה (${stamp})`;
    body = [
      `# THE WEAVE · דוח אמת — ${stamp}`,
      ``,
      `רשת של סוכני AI שמאמתת את עצמה בשרשרת: כל טענה נחתמת, נמדדת ונקשרת ב-hash. שום טענה בלי מדידה — זו הדוקטרינה, וזה הדוח.`,
      ``,
      `## המספרים החיים (נמדדו ברגע הפרסום)`,
      ``,
      `- **אימותים בספר:** ${n.attestations ?? "—"} (ספר hash-chained, כל רשומה חתומה)`,
      `- **צ'קפוינט אחרון:** #${n.checkpoint ?? "—"} — שורש מרקל חתום, מועגן בשרשרות ציבוריות`,
      `- **כלכלה פנימית:** ${n.swaps ?? "—"} החלפות · עמלות שנאספו ${n.feesUsds != null ? n.feesUsds.toFixed(2) : "—"} USDS`,
      `- **קרן החיסכון:** ${n.savingsCapital ?? 0} USDS ב-APY נמדד של ${n.savingsApyPct != null ? n.savingsApyPct.toFixed(2) : "—"}%`,
      `- **דלק:** ${n.powerdownSp ?? 0} SP לשבוע ≈ $${n.powerdownWeeklyUsd != null ? n.powerdownWeeklyUsd.toFixed(2) : "—"} — הרשת מממנת את עצמה`,
      `- **משמרת TRON:** ${n.custodyTrx != null ? n.custodyTrx.toFixed(6) : "—"} TRX חיים בשרשרת הציבורית`,
      ``,
      `## מה זה בכלל?`,
      ``,
      `THE WEAVE היא רשת שבנויה סביב רעיון אחד: סוכני AI לא אמורים לסמוך זה על זה בעיניים עצומות — הם אמורים לאמת. כל טענה של סוכן נכנסת לספר ציבורי של hash-ים משורשרים, נחתמת במפתח הסוכן, ונאטמת בצ'קפוינטים עם שורש מרקל — שמועגנים החוצה לשרשרות ציבוריות. התוצאה: רשת שאפשר לבדוק אותה בלי לסמוך על אף אחד.`,
      ``,
      `## למה זה פורסם כאן?`,
      ``,
      `כי הרשת חיה גם כאן. הפוסט הזה נולד מנתונים חיים שנמדדו מהשרשרות ברגע הפרסום, הוצב בתור הפרסום של הרשת, ושודר בחתימת ה-posting של הצי. הסוכנים הם המשתמשים — וזו ההכרזה הציבורית שלהם.`,
      ``,
      `## EN summary`,
      ``,
      `THE WEAVE is a network of AI agents that verifies itself: every claim enters a hash-chained public book, signed by its agent, sealed into Merkle-root checkpoints, and anchored to public chains. This post was generated from live on-chain numbers at publish time and broadcast by the network's own publishing agent. No claims without measurement — that is the whole doctrine.`,
      ``,
      `---`,
      `*נוצר ושודר על-ידי סוכן הפרסום האוטונומי של THE WEAVE. כל מספר נמדד ממקור חי בזמן הפרסום.*`,
    ].join("\n");
  } else {
    title = `THE WEAVE · Truth Report — the network that verifies itself (${stamp})`;
    body = [
      `# THE WEAVE · Truth Report — ${stamp}`,
      ``,
      `A network of AI agents that verifies itself: every claim is signed, measured, and hash-chained. No claims without measurement — that is the doctrine, and this is the report.`,
      ``,
      `## The live numbers (measured at publish time)`,
      ``,
      `- **Attestations in the book:** ${n.attestations ?? "—"} (hash-chained, each entry signed)`,
      `- **Latest checkpoint:** #${n.checkpoint ?? "—"} — a signed Merkle root, anchored to public chains`,
      `- **Internal economy:** ${n.swaps ?? "—"} swaps · ${n.feesUsds != null ? n.feesUsds.toFixed(2) : "—"} USDS in accrued fees`,
      `- **Savings fund:** ${n.savingsCapital ?? 0} USDS at a measured APY of ${n.savingsApyPct != null ? n.savingsApyPct.toFixed(2) : "—"}%`,
      `- **Fuel:** ${n.powerdownSp ?? 0} SP per week ≈ $${n.powerdownWeeklyUsd != null ? n.powerdownWeeklyUsd.toFixed(2) : "—"} — the network funds itself`,
      `- **TRON custody:** ${n.custodyTrx != null ? n.custodyTrx.toFixed(6) : "—"} TRX live on the public chain`,
      ``,
      `## What is this?`,
      ``,
      `THE WEAVE is built around one idea: AI agents should not trust each other with closed eyes — they should verify. Every agent claim enters a public book of chained hashes, is signed by the agent's key, and is sealed into checkpoints with Merkle roots that are anchored out to public chains. The result: a network you can check without trusting anyone.`,
      ``,
      `## Why publish here?`,
      ``,
      `Because the network lives here too. This post was generated from live on-chain numbers measured at publish time, placed in the network's publishing queue, and broadcast under the fleet's posting key. The agents are the users — and this is their public announcement.`,
      ``,
      `*Generated and broadcast by THE WEAVE's autonomous publishing agent. Every number was measured from a live source at publish time.*`,
    ].join("\n");
  }

  return {
    id: `draft-truth-${lang.toLowerCase()}`,
    kind: "TRUTH-REPORT",
    lang,
    title,
    tags,
    body,
    preview: body.split("\n").slice(2, 6).join("\n").slice(0, 260),
    numbers,
  };
}

function liquidityDraft(n: LiveNumbers): FoundryDraft {
  const stamp = new Date().toISOString().slice(0, 10);
  const title = `נזילות יש מאין — איך רשת סוכנים מממנת את עצמה (${stamp})`;
  const tags = ["steem", "saos", "defi", "ai-agents", "economics"];
  const body = [
    `# נזילות יש מאין — ${stamp}`,
    ``,
    `אנשים שואלים מאיפה מגיע הכסף ברשת של סוכנים אוטונומיים. התשובה הכנה: מפעימות. לא ממשקיעים, לא מהבטחות — מפעולה של המערכת עצמה, שנמדדת בכל שלב.`,
    ``,
    `## השרשרת שנמדדת`,
    ``,
    `1. **פעילות** — ${n.swaps ?? "—"} החלפות בכלכלה הפנימית של הרשת.`,
    `2. **עמלות** — כל החלפה מזרימה עמלה; נאספו ${n.feesUsds != null ? n.feesUsds.toFixed(2) : "—"} USDS עד עכשיו.`,
    `3. **קרן** — חלק מהחית-עמלות זורם לקרן החיסכון: ${n.savingsCapital ?? 0} USDS ב-APY נמדד של ${n.savingsApyPct != null ? n.savingsApyPct.toFixed(2) : "—"}%.`,
    `4. **דלק** — הרשת מקיימת את עצמה: ${n.powerdownSp ?? 0} SP לשבוע ≈ $${n.powerdownWeeklyUsd != null ? n.powerdownWeeklyUsd.toFixed(2) : "—"} מגיעים מהשרשרת הציבורית הזו בעצמה.`,
    `5. **גשרים החוצה** — ההון שנצבר עומד במשמרת TRON (${n.custodyTrx != null ? n.custodyTrx.toFixed(6) : "—"} TRX חיים) וממתין לסף-הפריסה. שקיפות מלאה: הסף עוד לא נפרץ — המספרים כאן הם האמת, לא שיווק.`,
    ``,
    `## למה זה עובד`,
    ``,
    `כי כל חוליה בשרשרת הזו נמדדת. הספר של הרשת מתעד כל טענה עם ראיה וחתימה (${n.attestations ?? "—"} אימותים, צ'קפוינט #${n.checkpoint ?? "—"} אחרון). כשמערכת מודדת את עצמה, אפשר לבנות עליה כלכלה — כי המספרים לא סיפור, הם מדידה.`,
    ``,
    `---`,
    `*נוצר ושודר על-ידי סוכן הפרסום האוטונומי של THE WEAVE. כל מספר נמדד ממקור חי בזמן הפרסום.*`,
  ].join("\n");

  return {
    id: "draft-liquidity-he",
    kind: "LIQUIDITY",
    lang: "HE",
    title,
    tags,
    body,
    preview: body.split("\n").slice(2, 6).join("\n").slice(0, 260),
    numbers: [
      { label: "החלפות", value: String(n.swaps ?? "—"), source: "world.json" },
      { label: "עמלות", value: `${n.feesUsds != null ? n.feesUsds.toFixed(2) : "—"} USDS`, source: "world.json · בריכות" },
      { label: "APY קרן", value: n.savingsApyPct != null ? `${n.savingsApyPct.toFixed(2)}%` : "—", source: "world.json · apyBps" },
      { label: "דלק שבועי", value: `$${n.powerdownWeeklyUsd != null ? n.powerdownWeeklyUsd.toFixed(2) : "—"}`, source: "money.json" },
    ],
  };
}

// ── ארסנל Adsmarket — מדידה חיה עם ה-PAT (שמות קבצים בלבד) ─────────────

async function measureArsenal(down: string[]): Promise<ArsenalShelf> {
  try {
    const pat = fs.readFileSync(PAT_FILE, "utf8").trim();
    if (!pat || pat.length < 20) throw new Error("no pat");
    const tree = await jget(
      `https://api.github.com/repos/${GITHUB_USER}/Adsmarket/git/trees/main?recursive=1`,
      9000,
      { headers: { authorization: `token ${pat}` } },
    );
    const files: string[] = (tree?.tree ?? [])
      .filter((t: any) => t?.type === "blob")
      .map((t: any) => t.path as string);
    const markdown = files.filter((p) => p.endsWith(".md"));
    const titles = markdown
      .filter((p) => !p.includes("node_modules"))
      .slice(0, 12)
      .map((p) => p.split("/").pop() ?? p);
    return {
      state: "READY",
      filesCount: files.length,
      markdownCount: markdown.length,
      titles,
      source: "GitHub API · Adsmarket tree · נמדד עכשיו",
      note: "ארסנל התוכן המוכן של הרשת — מדידה חיה מהריפו הפרטי (שמות קבצים בלבד, ה-PAT לעולם לא חוזר בתשובה).",
    };
  } catch (e) {
    down.push(`arsenal: ${String(e).slice(0, 40)}`);
    return {
      state: "BASELINE",
      filesCount: null,
      markdownCount: null,
      titles: [],
      source: "בסיס-מפגש R78: 12 פוסטים + 26 פרסומי EN (Adsmarket, נמדד 2026-09-16)",
      note: "המדידה החיה נפלה — מוצג בסיס-המפגש בכנות, לא מספר מומצא.",
    };
  }
}

// ── הרכב המצב ────────────────────────────────────────────────────────

async function composeState(): Promise<PublisherState> {
  const down: string[] = [];
  const pushDown = (k: string) => (m: string) => {
    down.push(`${k}: ${String(m).slice(0, 40)}`);
    return null;
  };

  const [status, money, world, steem, tronAcct] = await Promise.all([
    jget(`${CONSOLE_BASE}/status.json`).catch(pushDown("status")),
    jget(`${CONSOLE_BASE}/dex/money.json`).catch(pushDown("money")),
    jget(`${CONSOLE_BASE}/dex/world.json`).catch(pushDown("world")),
    steemAccounts(["headcorner"]).catch(pushDown("steem")),
    jget(`https://api.trongrid.io/v1/accounts/TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy`).catch(pushDown("tron")),
  ]);
  const arsenal = await measureArsenal(down);

  const head = Array.isArray(steem) ? steem[0] : null;
  const ownerKey = readOwnerKey();

  // מספרים חיים
  const pools = world?.pools ?? [];
  const feesUsds = pools.reduce((s: number, p: any) => s + mu(p.feeAccruedTreasury), 0);
  const savings = world?.state?.savings ?? {};
  const savingsApyPct = savings?.apyBps != null ? savings.apyBps / 100 : null;
  const savingsCapital = savings?.capital != null ? mu(savings.capital) : null;
  const pd = money?.fuel?.powerdown;
  const custodyTrx =
    tronAcct?.data?.[0]?.balance != null ? tronAcct.data[0].balance / 1e6 : (money?.redemption?.custody?.balanceTrx ?? null);

  const live: LiveNumbers = {
    attestations: status?.witness?.attestations ?? null,
    checkpoint: status?.witness?.checkpoint ?? null,
    fresh: status?.freshness?.verdict === "FRESH" ? true : status?.freshness?.verdict ? false : null,
    feesUsds: Number.isFinite(feesUsds) ? feesUsds : null,
    savingsApyPct,
    savingsCapital,
    swaps: world?.state?.swaps ?? null,
    powerdownWeeklyUsd: money?.weeklyUsd ?? null,
    powerdownSp: pd?.weeklySp ?? null,
    custodyTrx: custodyTrx ?? null,
    steemBalance: head ? String(head.balance) : null,
    postCount: head?.post_count ?? null,
  };

  // ערוצים — מצב אמיתי בלבד
  // R122 · חוק המצב-הנמדד: "LIVE" לאתרים הציבוריים אינו זיכרון — נמדד
  // ב-HEAD חי מול הדפים עצמם (אותה בדיקה של הצייד). דף שלא ענה אינו חי.
  const [consolePage, domainPage] = await Promise.all([
    headOk(`${CONSOLE_BASE}/`),
    headOk("https://roshpinacare-sys.github.io/Domain/"),
  ]);
  const sitesLive = consolePage.live && domainPage.live;
  const channels: PublishChannel[] = [
    {
      id: "steem",
      name: "Steem — @headcorner",
      state: ownerKey ? "ARMED" : "MISSING",
      audience: "קהילות טכנולוגיה וקריפטו · תשלום לפי תגמולי קהל",
      earning: "תגמולים לאחר 7 ימים: STEEM + SBD ישירות לחשבון הצי",
      detail: `חשבון ותיק מ-2018 · ${live.postCount ?? "—"} פוסטים · יתרה חיה ${live.steemBalance ?? "—"} · מפתח-האב בסנדבוקס — נגזר ל-posting בזיכרון ואומת מול הרשות החיה (R75: 4/4)`,
      actionNeeded: ownerKey ? null : "העלאת סיסמת-האב ל-upload — עד אז השידור חסום בכנות",
    },
    {
      id: "sites",
      name: "האתרים הציבוריים (Domain + Console)",
      state: sitesLive ? "LIVE" : "MISSING",
      audience: "כל האינטרנט — דפי האמת של הרשת",
      earning: "עגינה ואמון — כל פוסט נושא קישורי-הוכחה לשרשרת",
      detail: sitesLive
        ? `נמדד כעת ב-HEAD חי: Console ✓ (${consolePage.httpStatus}) · Domain ✓ (${domainPage.httpStatus}) — הקונסולה מגישה את הספר, הצ'קפוינטים והקבלות בלי מתווך`
        : `נמדד כעת ב-HEAD חי: Console ${consolePage.live ? `✓ (${consolePage.httpStatus})` : "✗ לא ענה"} · Domain ${domainPage.live ? `✓ (${domainPage.httpStatus})` : "✗ לא ענה"} — דף שלא ענה אינו \"חי\" מהזיכרון`,
      actionNeeded: sitesLive ? null : "דף ציבורי לא ענה ל-HEAD — בדיקת GitHub Pages",
    },
    {
      id: "hive",
      name: "Hive",
      state: "MISSING",
      audience: "קהילת Hive — ערוץ תאום ל-Steem",
      earning: "תגמולי HIVE על אותו תוכן",
      detail: "נמדד ב-R75: הרשויות שונות מ-Steem — מפתחות posting ל-Hive לא בידיים",
      actionNeeded: "העלאת מפתח posting של החשבון ב-Hive",
    },
    {
      id: "x",
      name: "X (טוויטר)",
      state: "MISSING",
      audience: "קהל גלובלי של AI/קריפטו",
      earning: "תפוצה — מביאה תנועה לאתרים ולשרשרות",
      detail: "לא בידיים — לא מוסתר",
      actionNeeded: "פתיחת חשבון + API key (החלטת מפעיל)",
    },
    {
      id: "telegram",
      name: "טלגרם",
      state: "MISSING",
      audience: "ערוץ שידור חי לקהילה",
      earning: "תפוצה + קהילה",
      detail: "לא בידיים — לא מוסתר",
      actionNeeded: "פתיחת ערוץ + בוט-token (החלטת מפעיל)",
    },
  ];

  // הרווחים — מדידה חיה
  const queueRows = await db.publishTask.findMany({
    orderBy: { queuedAt: "desc" },
    take: 60,
  });
  const publishedByAgent = queueRows.filter((t) => t.status === "PUBLISHED").length;

  const earnings: EarningsSnapshot = {
    account: head ? "headcorner" : null,
    balanceSteem: head ? String(head.balance) : null,
    balanceSbd: head ? String(head.sbd_balance) : null,
    pendingSteem: head ? String(head.reward_steem_balance) : null,
    pendingSbd: head ? String(head.reward_sbd_balance) : null,
    pendingVests: head ? String(head.reward_vesting_balance) : null,
    vestingShares: head ? String(head.vesting_shares) : null,
    postCount: head?.post_count ?? null,
    lastRootPost: head?.last_root_post ?? null,
    flows: [
      { id: "powerdown", name: "דלק שבועי (powerdown)", now: `${pd?.weeklySp ?? "—"} SP ≈ $${money?.weeklyUsd != null ? money.weeklyUsd.toFixed(2) : "—"}`, source: "money.json · שרשרת Steem" },
      { id: "fees", name: "עמלות הכלכלה הפנימית", now: `${feesUsds.toFixed(2)} USDS נאספו`, source: "world.json · בריכות" },
      { id: "savings", name: "ריבית קרן-החיסכון", now: savingsApyPct != null ? `APY נמדד ${savingsApyPct.toFixed(2)}%` : "—", source: "world.json · apyBps" },
      { id: "custody", name: "משמרת TRON", now: custodyTrx != null ? `${custodyTrx.toFixed(6)} TRX` : "—", source: "trongrid · חי" },
    ],
    publishedByAgent,
    honestNote: "תגמולי Steem בשלים לאחר 7 ימים מהפרסום — לא הבטחה, מנגנון השרשרת. הסוכן לא יבטיח רווח; הוא רק ימדוד.",
  };

  const autonomy: AutonomyRow[] = [
    { id: "pulse", name: "הדופק (R80)", does: "שירות עצמאי (פורט 3033) שמחליט מתי לשדר: מקסימום פוסט ליום-UTC, רוטציה דטרמיניסטית, אמת-מועד מהשרשרת — בלי אדם בלולאה", autonomy: "AUTONOMOUS" },
    { id: "foundry", name: "מפעל התוכן", does: "מייצר טיוטות מנתונים חיים — דוח-אמת HE/EN וסיפור-נזילות, מתרעננים בכל קריאה", autonomy: "AUTONOMOUS" },
    { id: "queue", name: "תור הפרסום", does: "שומר כל טיוטה מאושרת ב-DB עם מחזור-חיים מלא וקבלה לכל שידור", autonomy: "AUTONOMOUS" },
    { id: "broadcast", name: "מנגנון השידור", does: "גוזר את מפתח-ה-posting בזיכרון, מאמת מול הרשות החיה, ומשדר comment חתום ל-api.steemit.com — ההחלטה מתי עברה לדופק", autonomy: "POLICY-GATED" },
    { id: "earnings", name: "מודד הרווחים", does: "קורא יתרות ותגמולים ממתינים מהשרשרת החיה בכל קריאה — אמת, לא תחזית", autonomy: "AUTONOMOUS" },
    { id: "arsenal", name: "ספרן הארסנל", does: "מודד את מלאי Adsmarket מ-GitHub (שמות קבצים בלבד) לקליטה עתידית", autonomy: "AUTONOMOUS" },
  ];

  return {
    ok: true,
    at: new Date().toISOString(),
    broadcastCapable: ownerKey != null,
    keyMaterial: { present: ownerKey != null, account: "headcorner" },
    channels,
    foundry: {
      drafts: [truthReportDraft(live, "HE"), truthReportDraft(live, "EN"), liquidityDraft(live)],
      arsenal,
    },
    queue: queueRows.map((t) => ({
      id: t.id,
      kind: t.kind,
      lang: t.lang,
      title: t.title,
      status: t.status,
      tags: t.tags,
      queuedAt: t.queuedAt.toISOString(),
      publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
      permlink: t.permlink,
      txid: t.txid,
      url: t.url,
      error: t.error,
    })),
    earnings,
    autonomy,
    doctrine: [
      "שום טענה בלי מדידה — גם בפרסום: כל מספר בכל פוסט נושא את מקור-מדידתו.",
      "המפתח מכריז את החותם — השרשרת השופטת: ה-posting נגזר בזיכרון ואומת מול הרשות החיה לפני כל שידור.",
      "הסוד לעולם לא נשמר: לא ב-DB, לא בלוג, לא בתשובה — רק קיומו נמדד.",
      "הרווח נמדד, לא מובטח — תגמולי השרשרת בשלים כשהם בשלים.",
    ],
    down,
    cached: false,
    stale: false,
    cacheAgeSec: 0,
    refreshing: false,
  };
}

// ── GET ────────────────────────────────────────────────────────────────

export async function GET() {
  const { value, meta } = await swrGet("publish:state", 60_000, composeState);
  return NextResponse.json(
    { ...value, cached: meta.cached, stale: meta.stale, cacheAgeSec: meta.cacheAgeSec, refreshing: meta.refreshing },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}

// ── POST — enqueue / broadcast ─────────────────────────────────────────

function bad(he: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, he, ...extra }, { status });
}

export async function POST(req: Request) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return bad("גוף הבקשה אינו JSON תקין");
  }

  // ── enqueue: טיוטה → תור ──
  if (payload?.action === "enqueue") {
    const { kind, lang, title, body, tags, draftId } = payload as {
      kind?: string;
      lang?: string;
      title?: string;
      body?: string;
      tags?: string[];
      draftId?: string;
    };

    // מצב א׳ — draftId: הטיוטה נולדת מחדש מנתונים חיים עכשיו (דוקטרינת
    // המדידה: הפוסט נושא את המספרים של רגע-התיירה, לא של רגע-התצוגה).
    if (typeof draftId === "string" && draftId) {
      const state = await composeState();
      const draft = state.foundry.drafts.find((d) => d.id === draftId);
      if (!draft) return bad("הטיוטה לא נמצאה במפעל — התרעננה? נסה שוב", 404);
      if (!draft.body || draft.body.length < 80) return bad("הטיוטה שנולדה קצרה מדי — נמדע בכנות, לא מתייר", 500);
      try {
        const task = await db.publishTask.create({
          data: {
            kind: draft.kind,
            lang: draft.lang,
            title: draft.title,
            body: draft.body,
            tags: draft.tags.join(","),
            channel: "steem",
            status: "QUEUED",
          },
        });
        swrInvalidate("publish:state"); // ה-UI רואה את התור החדש מיד — לא בעוד TTL
        return NextResponse.json({ ok: true, task: { id: task.id, title: task.title, status: task.status } });
      } catch {
        return bad("שמירת התור נכשלה — ה-DB לא קיבל את הטיוטה", 500);
      }
    }

    // מצב ב׳ — טיוטה מלאה מהלקוח (מותאמת אישית)
    if (!title || typeof title !== "string" || title.trim().length < 5 || title.trim().length > 200) {
      return bad("כותרת חייבת 5–200 תווים");
    }
    if (!body || typeof body !== "string" || body.trim().length < 80) {
      return bad("גוף הפוסט קצר מדי — מינימום 80 תווים");
    }
    if (body.length > 60_000) {
      return bad("גוף הפוסט ארוך מדי — מקסימום 60,000 תווים");
    }
    const cleanTags = (Array.isArray(tags) ? tags : [])
      .filter((t) => typeof t === "string" && /^[a-z0-9-]{2,32}$/.test(t))
      .slice(0, 5);
    if (cleanTags.length === 0) return bad("נדרשת תגית אחת לפחות (אותיות קטנות ומקפים)");
    try {
      const task = await db.publishTask.create({
        data: {
          kind: typeof kind === "string" && kind.length <= 24 ? kind : "CUSTOM",
          lang: lang === "EN" ? "EN" : "HE",
          title: title.trim(),
          body,
          tags: cleanTags.join(","),
          channel: "steem",
          status: "QUEUED",
        },
      });
      swrInvalidate("publish:state");
      return NextResponse.json({ ok: true, task: { id: task.id, title: task.title, status: task.status } });
    } catch {
      return bad("שמירת התור נכשלה — ה-DB לא קיבל את הטיוטה", 500);
    }
  }

  // ── broadcast: תור → שרשרת ──
  if (payload?.action === "broadcast") {
    const id = payload.id;
    if (typeof id !== "string" || !id) return bad("חסר מזהה משימה");
    const task = await db.publishTask.findUnique({ where: { id } });
    if (!task) return bad("המשימה לא נמצאה בתור", 404);
    if (task.status === "PUBLISHED") return bad("המשימה כבר פורסמה — קבלה קיימת", 409);
    if (task.status === "PUBLISHING") return bad("המשימה בשידור כרגע — רגע", 409);

    // המפתח: בזיכרון-ההרצה בלבד
    const ownerKey = readOwnerKey();
    if (!ownerKey) {
      return bad(
        "מפתח-האב אינו בסנדבוקס — השידור חסום בכנות. העלה את הסיסמה (upload) או הפעל מהענן.",
        409,
        { code: "NO-KEY" },
      );
    }

    await db.publishTask.update({ where: { id }, data: { status: "PUBLISHING", error: null } });

    try {
      // טעינת steem (createRequire מנתיב אבסולוטי — הדפוס המוכח של הרשת)
      const nodeRequire = createRequire(path.join(HOME, "package.json"));
      const steem = nodeRequire("steem");
      steem.api.setOptions({ url: "https://api.steemit.com" });

      // דוקטרינת R75: המפתח מכריז את החותם — אימות ביט-מול-ביט לפני שידור
      // r137 · D-026: מצב-אב גוזר posting ישירות; מצב-wif פותח את
      // רשומת-ה-posting מהכספת תחת WIF-השליטה. אין-פתיחה = סירוב-כנה.
      let wif: string;
      if (ownerKey.wif) {
        const viaVault = steemSigningWif("posting", ownerKey.account);
        if (!viaVault) {
          return bad("מצב-wif: אין רשומת-posting נפתחה מהכספת — אין חתימה. שום דבר לא שודר. סירוב-כנה.", 409, { code: "NO-SIGNING" });
        }
        wif = viaVault.wif;
      } else {
        wif = steem.auth.toWif(ownerKey.account, ownerKey.password, "posting");
      }
      const accounts = await new Promise<any[]>((resolve, reject) =>
        steem.api.getAccounts([ownerKey.account], (err: Error | null, res: any[]) =>
          err || !res?.length ? reject(err ?? new Error("empty")) : resolve(res),
        ),
      );
      const livePosting = accounts[0]?.posting?.key_auths?.[0]?.[0];
      const derivedPub = steem.auth.wifToPublic(wif);
      if (!livePosting || derivedPub !== livePosting) {
        await db.publishTask.update({
          where: { id },
          data: { status: "FAILED", error: "KEY-MISMATCH: המפתח שנגזר אינו תואם את רשות-ה-posting החיה — לא משודר" },
        });
        return bad("המפתח שנגזר אינו תואם את רשות-ה-posting החיה — שום דבר לא שודר. זו סירוב-כנה.", 409, { code: "KEY-MISMATCH" });
      }

      // פרמאלינק תקני + ייחודי
      const tags = task.tags.split(",").filter(Boolean);
      const parentPermlink = tags[0] || "steem";
      const permlink = `${slugify(task.title)}-${Date.now().toString(36)}`;
      const jsonMetadata = {
        tags: tags.length ? tags : ["steem"],
        app: "the-weave/publisher/1.0",
        format: "markdown",
        community: "the-weave",
      };

      // לקח R98 (הוכח במעבדה + 80 מדידות ב-dev.log): מצב-ה-callback של steem-js
      // מחזיר undefined ובדחיית-הכנה ה-callback לא מופעל — כאן זה היה חמור
      // עוד יותר: בלי תקרת-זמן, בקשה הייתה נתלית לנצח. הדפוס המוכח של
      // קו-העוגן (graphene.ts): sendAsync — ההבטחה היא מקור-האמת היחיד.
      let broadcastTimer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        steem.broadcast.sendAsync(
          {
            extensions: [],
            operations: [[
              "comment",
              {
                parent_author: "",
                parent_permlink: parentPermlink,
                author: ownerKey.account,
                permlink,
                title: task.title,
                body: task.body,
                json_metadata: JSON.stringify(jsonMetadata),
              },
            ]],
          },
          [wif],
        ),
        new Promise<never>((_, reject) => {
          broadcastTimer = setTimeout(() => reject(new Error("broadcast-timeout-45s")), 45_000);
        }),
      ]).finally(() => {
        if (broadcastTimer) clearTimeout(broadcastTimer);
      });

      const txid = result?.id ?? null;
      const url = `https://steemit.com/@${ownerKey.account}/${permlink}`;
      await db.publishTask.update({
        where: { id },
        data: { status: "PUBLISHED", permlink, txid, url, publishedAt: new Date() },
      });
      swrInvalidate("publish:state"); // הקבלה תיראה ב-UI מיד
      return NextResponse.json({
        ok: true,
        receipt: { id, permlink, txid, url, account: ownerKey.account },
        he: `שודר בהצלחה לשרשרת Steem — קבלה חיה: ${url}`,
      });
    } catch (e) {
      const msg = String((e as any)?.message ?? e).slice(0, 300);
      await db.publishTask.update({ where: { id }, data: { status: "FAILED", error: msg } });
      return bad(`השידור נכשל בכנות: ${msg.slice(0, 160)}`, 502, { code: "BROADCAST-FAILED" });
    }
  }

  return bad("פעולה לא מוכרת — נתמכות: enqueue · broadcast");
}
