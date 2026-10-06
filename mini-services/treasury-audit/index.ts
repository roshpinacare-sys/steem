// ─────────────────────────────────────────────────────────────────────
// TREASURY-AUDIT · דיבון-מבקר-האוצר (r145-b · D-r145-TRS · מחלקת "army")
//
// תפקיד: ביקורת-תקופתית של מצב-האוצר והכלכלה — בלי מפתחות, בלי כתיבה
// למערכות-כסף, קריאה בלבד: יומן-ההחלטות, שרשרת-תמונות-ה-PnL, ספר-הקבלות,
// פקודות-הסולם הפתוחות (רצפת-ערך · גיל-פקודות) ויתרות STEEM/SBD מול
// השרשרת הציבורית. כל ביקורת מפיקה ארטיפקט נמדד (pass/fail/warn לכל
// בדיקה + אנומליות) — אותה-שיטת-ראיה של יומן-ההחלטות עצמו.
//
// חוקי-ברזל:
//   · אפס סודות כאן — קריאת localhost + RPC ציבורי בלבד
//   · אפס שכפול: לא מנהל, לא מזיז, לא מחליט — מבקר בלבד (המוביל :3034
//     מנהל; הפנקס ב-/api/economy/pnl מחשב; כאן מאמתים ומציגים חריגות)
//   · אפס = מדידה לגיטימית; חוסר-מדידה נרשם warn/unmeasured — לא מומצא
//   · טיימר-יחיד · שרת-יחיד · כתיבת-מצב אטומית · מתג-איש-מת (r143-c)
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const PORT = 3043;
const BEAT_SEC = 5 * 60; // ביקורת כל 5 דק'
const HOME = "/home/z/my-project";
const AUDIT_DIR = path.join(HOME, "sovereign", "treasury-audit");
const STATE_FILE = path.join(AUDIT_DIR, "state.json");
const DECISION_LOG = path.join(HOME, "sovereign", "governance", "DECISION_LOG.jsonl");
const SNAPSHOTS = path.join(HOME, "sovereign", "economy", "pnl-snapshots.json");
const RECEIPTS = path.join(HOME, "sovereign", "money", "history.json");
const MONEY_API = "http://127.0.0.1:3000/api/money";
const STEEM_RPC = "https://api.steemit.com";
const TRONRPC = "https://api.trongrid.io";
const CUSTODY_PROOF = path.join(HOME, "sovereign", "custody", "tron-custody-proof.json");
const TRON_BALANCE_ART = path.join(HOME, "sovereign", "custody", "tron-balance.json");
const ACCOUNT = "headcorner";
const STALE_ORDER_HOURS = 48;
const BALANCE_DRIFT_EPS = 0.001;

interface CheckResult {
  id: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  numbers: Record<string, number | string | boolean | null>;
}

interface AuditArtifact {
  format: "treasury-audit-v1";
  seq: number;
  at: string;
  verdict: "PASS" | "WARN" | "FAIL";
  checks: CheckResult[];
  anomalies: string[];
}

interface AuditState {
  service: "treasury-audit";
  format: "treasury-audit-daemon-state-v1";
  bootedAt: string;
  beats: number;
  lastBeatAt: string | null;
  lastOk: boolean | null;
  failStreak: number;
  verdict: "AUDITING" | "HOME-DOWN" | "BOOTING";
  auditsCount: number;
  lastAuditVerdict: string | null;
  lastAuditAt: string | null;
  lastAnomalies: string[];
}

function readState(): AuditState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as AuditState;
    if (raw && raw.service === "treasury-audit") return raw;
  } catch {}
  return {
    service: "treasury-audit",
    format: "treasury-audit-daemon-state-v1",
    bootedAt: new Date().toISOString(),
    beats: 0,
    lastBeatAt: null,
    lastOk: null,
    failStreak: 0,
    verdict: "BOOTING",
    auditsCount: 0,
    lastAuditVerdict: null,
    lastAuditAt: null,
    lastAnomalies: [],
  };
}

const G = globalThis as unknown as { __TRSY_AUD_STATE__?: AuditState };
const state: AuditState = G.__TRSY_AUD_STATE__ ?? readState();
G.__TRSY_AUD_STATE__ = state;

function saveState(): void {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, STATE_FILE);
  } catch {}
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// ── אימות-שרשרת sha256 (זהה ביט-ביט ליומן-ההחלטות ולפנקס-ה-PnL) ─────
// החוק: מה שנכתב נחתם על כל-תוכנו פרט ל-entryHash שלו; קריאה מהדיסק
// משמרת סדר-שדות, ולכן חישוב-חוזר על האובייקט-ללא-entryHash משחזר את
// החתימה בדיוק (אותו מנגנון verifyDecisionLog/verifySnapshots בבית).
function verifyChain(
  entries: Array<Record<string, unknown> & { seq?: number; prevHash?: string; entryHash?: string }>,
): { ok: boolean; brokenAt: number | null; entries: number } {
  let prev = "GENESIS";
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (i === 0 ? e.prevHash !== "GENESIS" : e.prevHash !== prev) {
      return { ok: false, brokenAt: Number(e.seq ?? i + 1), entries: entries.length };
    }
    const { entryHash: _omit, ...rest } = e;
    const recomputed = createHash("sha256").update(JSON.stringify(rest)).digest("hex");
    if (recomputed !== e.entryHash) {
      return { ok: false, brokenAt: Number(e.seq ?? i + 1), entries: entries.length };
    }
    prev = String(e.entryHash);
  }
  return { ok: true, brokenAt: null, entries: entries.length };
}

function checkDecisionChain(): CheckResult {
  try {
    const log = fs
      .readFileSync(DECISION_LOG, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const v = verifyChain(log);
    return {
      id: "decision-chain",
      status: v.ok ? "pass" : "fail",
      detail: v.ok
        ? `יומן-ההחלטות מאומת — ${v.entries} רשומות, שרשרת sha256 תקינה`
        : `שרשרת-ההחלטות נשברה ב-seq ${v.brokenAt} — אנומליה-ריבונית`,
      numbers: { entries: v.entries, brokenAt: v.brokenAt, ok: v.ok },
    };
  } catch (e) {
    return {
      id: "decision-chain",
      status: "warn",
      detail: `יומן-ההחלטות לא נקרא (${String((e as Error)?.message ?? e).slice(0, 80)}) — unmeasured`,
      numbers: { entries: null, brokenAt: null, ok: false },
    };
  }
}

function checkSnapshotChain(): CheckResult {
  try {
    const file = JSON.parse(fs.readFileSync(SNAPSHOTS, "utf8")) as { entries?: Array<Record<string, unknown>> };
    const entries = Array.isArray(file.entries) ? file.entries : [];
    if (entries.length === 0) {
      return { id: "pnl-snapshot-chain", status: "warn", detail: "אין תמונות-מצב PnL — unmeasured (טרם נסגר מחזור-ראשון)", numbers: { entries: 0, brokenAt: null, ok: false } };
    }
    const v = verifyChain(entries);
    const last = entries[entries.length - 1] as { seq?: number; at?: string };
    return {
      id: "pnl-snapshot-chain",
      status: v.ok ? "pass" : "fail",
      detail: v.ok
        ? `שרשרת-תמונות-ה-PnL מאומתת — ${v.entries} תמונות (אחרונה seq ${last?.seq} בת ${Math.round((Date.now() - Date.parse(String(last?.at))) / 60_000)} דק')`
        : `שרשרת-תמונות-ה-PnL נשברה ב-seq ${v.brokenAt} — אנומליה-כלכלית`,
      numbers: { entries: v.entries, brokenAt: v.brokenAt, ok: v.ok, lastSeq: Number(last?.seq ?? 0) },
    };
  } catch (e) {
    return {
      id: "pnl-snapshot-chain",
      status: "warn",
      detail: `פנקס-ה-PnL לא נקרא (${String((e as Error)?.message ?? e).slice(0, 80)}) — unmeasured`,
      numbers: { entries: null, brokenAt: null, ok: false },
    };
  }
}

function txCount(v: unknown): number {
  return Array.isArray(v) ? v.filter((p) => typeof (p as { txid?: unknown })?.txid === "string" && String((p as { txid: string }).txid).length >= 40).length : 0;
}

function checkReceiptsBook(): CheckResult {
  try {
    const hist = JSON.parse(fs.readFileSync(RECEIPTS, "utf8")) as Array<{ at?: string; kind?: string; placed?: unknown; cancelled?: unknown }>;
    if (!Array.isArray(hist)) throw new Error("not-an-array");
    let withTxid = 0;
    let outOfOrder = 0;
    let lastMs = 0;
    for (const r of hist) {
      if (txCount(r.placed) + txCount(r.cancelled) > 0) withTxid += 1;
      const ms = r.at ? Date.parse(r.at) : NaN;
      if (Number.isFinite(ms)) {
        if (lastMs && ms < lastMs) outOfOrder += 1;
        lastMs = Math.max(lastMs, ms);
      }
    }
    const ageMin = lastMs ? Math.round((Date.now() - lastMs) / 60_000) : null;
    const status: CheckResult["status"] = outOfOrder > 0 ? "fail" : "pass";
    return {
      id: "receipts-book",
      status,
      detail:
        outOfOrder > 0
          ? `ספר-הקבלות פגום — ${outOfOrder} רשומות אינן-כרונולוגיות (אנומליה)`
          : `ספר-הקבלות תקין — ${hist.length} קבלות · ${withTxid} עם txid · אחרונה בת ${ageMin ?? "?"} דק'`,
      numbers: { total: hist.length, withTxid, outOfOrder, lastAgeMinutes: ageMin ?? -1 },
    };
  } catch (e) {
    return {
      id: "receipts-book",
      status: "warn",
      detail: `ספר-הקבלות לא נקרא (${String((e as Error)?.message ?? e).slice(0, 80)}) — unmeasured`,
      numbers: { total: null, withTxid: null },
    };
  }
}

async function fetchMoney(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(MONEY_API, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchChainBalances(): Promise<{ steem: number | null; sbd: number | null } | null> {
  try {
    const res = await fetch(STEEM_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[ACCOUNT]], id: 1 }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json()) as { result?: Array<{ balance?: string; sbd_balance?: string }> };
    const a = j.result?.[0];
    if (!a) return null;
    return { steem: parseFloat(a.balance ?? "") || null, sbd: parseFloat(a.sbd_balance ?? "") || null };
  } catch {
    return null;
  }
}

function checkLadderFloor(money: Record<string, unknown> | null): { check: CheckResult; orders: Array<Record<string, unknown>> } {
  if (!money) {
    return {
      check: { id: "ladder-floor", status: "warn", detail: "/api/money לא נענה — רצפת-הערך unmeasured בביקורת זו", numbers: { state: "UNMEASURED" } },
      orders: [],
    };
  }
  const vf = (money.valueFloor ?? {}) as Record<string, unknown>;
  const stateV = String(vf.state ?? "UNMEASURED");
  const below = Number(vf.asksBelowParity ?? 0);
  const worstBps = Number.isFinite(Number(vf.worstBps)) ? Number(vf.worstBps) : null;
  const driftSbd = Number.isFinite(Number(vf.maxDriftLossSbd)) ? Number(vf.maxDriftLossSbd) : null;
  const status: CheckResult["status"] = stateV === "HELD" ? "pass" : stateV === "DRIFT" ? "fail" : "warn";
  const orders = Array.isArray(money.orders) ? (money.orders as Array<Record<string, unknown>>) : [];
  return {
    check: {
      id: "ladder-floor",
      status,
      detail:
        stateV === "HELD"
          ? `רצפת-הערך מוחזקת — אף פקודת-מכירה מתחת לפאריטה (${orders.length} פקודות פתוחות)`
          : stateV === "DRIFT"
            ? `חריגת-רצפה: ${below} פקודות מתחת לפאריטה · גרוע ${worstBps}bps · חשיפה ${driftSbd} SBD`
            : "רצפת-הערך unmeasured (אין פאריטה חיה) — נרשם בכנות",
      numbers: { state: stateV, asksBelowParity: below, worstBps, maxDriftLossSbd: driftSbd, ordersOpen: orders.length },
    },
    orders,
  };
}

function checkStaleOrders(orders: Array<Record<string, unknown>>): CheckResult {
  const now = Date.now();
  const stale = orders
    .map((o) => {
      const created = Date.parse(String(o.created ?? ""));
      const ageH = Number.isFinite(created) ? (now - created) / 3_600_000 : null;
      return { orderid: o.orderid, ageH: ageH == null ? null : Math.round(ageH * 10) / 10 };
    })
    .filter((o): o is { orderid: unknown; ageH: number } => o.ageH != null && o.ageH > STALE_ORDER_HOURS);
  return {
    id: "orders-stale",
    status: stale.length > 0 ? "warn" : "pass",
    detail:
      stale.length > 0
        ? `פקודות-ישנות: ${stale.map((o) => `#${o.orderid} בת ${o.ageH}ש'`).join(" · ")} — מעבר לחלון ${STALE_ORDER_HOURS}ש' (מוביל-הכסף יגרר בהזדמנות-הפעולה הבאה; נמדד, לא מומצא)`
        : `אין פקודות-ישנות מעל ${STALE_ORDER_HOURS}ש' (${orders.length} פקודות נבדקו)`,
    numbers: { staleCount: stale.length, thresholdHours: STALE_ORDER_HOURS, oldestHours: stale.length ? Math.max(...stale.map((o) => o.ageH)) : null },
  };
}

// ── r188 · מסילת-TRON הרביעית — פיקוח ציבורי תקופתי ────────────────────
// אפס-סודות: הכתובת-הציבורית נקראת מארטיפקט-הוכחת-הבעלות (r187-A),
// היתרה-נמדדת מ-trongrid (RPC ציבורי). כלי-היתרות (scripts/tron-balance.ts)
// מכתיב ארטיפקט פרטי-שמור; כאן מאמתים שהמסילה חיה ושהכלי טרי.
async function fetchTronRail(): Promise<{ trx: number | null; exists: boolean | null; address: string | null }> {
  try {
    const proof = JSON.parse(fs.readFileSync(CUSTODY_PROOF, "utf8")) as { address?: string };
    const address = proof.address ?? null;
    if (!address) return { trx: null, exists: null, address: null };
    const res = await fetch(`${TRONRPC}/v1/accounts/${address}`, { signal: AbortSignal.timeout(10_000) });
    const j = (await res.json()) as { data?: Array<{ balance?: number }> };
    const acc = j.data?.[0];
    if (!acc) return { trx: 0, exists: false, address };
    return { trx: (acc.balance ?? 0) / 1e6, exists: true, address };
  } catch {
    return { trx: null, exists: null, address: null };
  }
}

function checkTronRail(rail: { trx: number | null; exists: boolean | null; address: string | null }): CheckResult {
  if (!rail.address || rail.trx == null) {
    return { id: "tron-rail", status: "warn", detail: "מסילת-TRON לא נמדדה הפעם (RPC/ארטיפקט לא נענו) — unmeasured", numbers: { measured: false } };
  }
  if (rail.exists === false) {
    return { id: "tron-rail", status: "fail", detail: `כתובת-המשמרת ${rail.address} נעלמה מהשרשרת — מסילת-TRON נפגעה (אנומליה-ריבונית)`, numbers: { measured: true, trx: rail.trx, exists: false } };
  }
  let toolAgeH: number | null = null;
  try {
    const art = JSON.parse(fs.readFileSync(TRON_BALANCE_ART, "utf8")) as { at?: string };
    if (art.at) toolAgeH = Math.round(((Date.now() - Date.parse(art.at)) / 3_600_000) * 10) / 10;
  } catch {
    /* אין ארטיפקט כלי — נרשם */
  }
  return {
    id: "tron-rail",
    status: "pass",
    detail: `מסילת-TRON חיה ונמדדת — ${rail.address} · ${rail.trx} TRX על-השרשרת · כלי-היתרות בן ${toolAgeH ?? "?"}ש'`,
    numbers: { measured: true, trx: rail.trx, exists: true, toolAgeHours: toolAgeH },
  };
}

function checkBalancesDrift(money: Record<string, unknown> | null, chain: { steem: number | null; sbd: number | null } | null): CheckResult {
  if (!chain) {
    return { id: "balances-drift", status: "warn", detail: "יתרות-השרשרת הציבורית לא נענו — unmeasured בביקורת זו", numbers: { measured: false } };
  }
  const b = (money?.balances ?? {}) as Record<string, unknown>;
  const homeSteem = Number.isFinite(Number(b.steem)) ? Number(b.steem) : null;
  const homeSbd = Number.isFinite(Number(b.sbd)) ? Number(b.sbd) : null;
  if (homeSteem == null || homeSbd == null) {
    return { id: "balances-drift", status: "warn", detail: "יתרות-הבית לא נמדדו מ-/api/money — unmeasured", numbers: { measured: false } };
  }
  const dSteem = Math.round((homeSteem - (chain.steem ?? homeSteem)) * 1e6) / 1e6;
  const dSbd = Math.round((homeSbd - (chain.sbd ?? homeSbd)) * 1e6) / 1e6;
  const ok = Math.abs(dSteem) <= BALANCE_DRIFT_EPS && Math.abs(dSbd) <= BALANCE_DRIFT_EPS;
  return {
    id: "balances-drift",
    status: ok ? "pass" : "fail",
    detail: ok
      ? `יתרות מתואמות מול השרשרת — STEEM ${homeSteem} · SBD ${homeSbd} (סטייה ≤ ${BALANCE_DRIFT_EPS})`
      : `אי-התאמת יתרות מול השרשרת — דריפת STEEM ${dSteem} · דריפת SBD ${dSbd} (אנומליה)`,
    numbers: { measured: true, homeSteem, homeSbd, chainSteem: chain.steem, chainSbd: chain.sbd, driftSteem: dSteem, driftSbd: dSbd },
  };
}

async function runAudit(): Promise<AuditArtifact> {
  const [money, chainBalances] = await Promise.all([fetchMoney(), fetchChainBalances()]);
  const { check: floor, orders } = checkLadderFloor(money);

  // r187-B — ייחוס-דריפה: המדידה-הכפולה. הצי סוחר-חי (cancels/fills בכל-רגע) —
  // שתי-קריאות-מקבילות (בית-מול-שרשרת) נפרדות-בזמן-ריצה ופעולת-סולם בשידור
  // ביניהן נראית כ-"דריפה". חוק-האמת: דריפה = מה שנשאר-גם-במדידה-שנייה
  // (8ש' אחרי). חולפת → pass-עם-ייחוס; מתמדת → fail אמיתי.
  let driftCheck = checkBalancesDrift(money, chainBalances);
  if (driftCheck.status === "fail") {
    await new Promise((r) => setTimeout(r, 8_000));
    const [money2, chain2] = await Promise.all([fetchMoney(), fetchChainBalances()]);
    const retry = checkBalancesDrift(money2, chain2);
    const first = driftCheck.numbers as { driftSteem?: number; driftSbd?: number };
    driftCheck =
      retry.status === "pass"
        ? {
            ...retry,
            detail: `דריפה-חולפת — פעולת-סולם בשידור בין-המדידות; מדידה-שנייה (8ש') חזרה לקו — ${retry.detail}`,
            numbers: { ...retry.numbers, transientResolved: true, firstDriftSteem: first.driftSteem ?? null, firstDriftSbd: first.driftSbd ?? null },
          }
        : {
            ...retry,
            detail: `אי-התאמה מתמדת (שתי-מדידות בהפרש 8ש') — ${retry.detail}`,
            numbers: { ...retry.numbers, transientResolved: false, firstDriftSteem: first.driftSteem ?? null, firstDriftSbd: first.driftSbd ?? null },
          };
  }

  const tronRail = await fetchTronRail();
  const checks: CheckResult[] = [
    checkDecisionChain(),
    checkSnapshotChain(),
    checkReceiptsBook(),
    floor,
    checkStaleOrders(orders),
    driftCheck,
    checkTronRail(tronRail),
  ];
  const anomalies = checks.filter((c) => c.status === "fail").map((c) => `${c.id}: ${c.detail}`);
  const warnings = checks.filter((c) => c.status === "warn").map((c) => `${c.id}: ${c.detail}`);
  const verdict: AuditArtifact["verdict"] = anomalies.length > 0 ? "FAIL" : warnings.length > 0 ? "WARN" : "PASS";
  state.auditsCount += 1;
  return { format: "treasury-audit-v1", seq: state.auditsCount, at: new Date().toISOString(), verdict, checks, anomalies: [...anomalies, ...warnings.map((w) => `warn · ${w}`)] };
}

function writeArtifact(a: AuditArtifact): void {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    const day = a.at.slice(0, 10);
    fs.writeFileSync(path.join(AUDIT_DIR, `audit-${day}.json`), JSON.stringify(a, null, 2));
    fs.writeFileSync(path.join(AUDIT_DIR, "last-audit.json"), JSON.stringify(a, null, 2));
  } catch {}
}

async function beat(): Promise<void> {
  state.beats += 1;
  state.lastBeatAt = new Date().toISOString();
  try {
    const audit = await runAudit();
    writeArtifact(audit);
    state.lastOk = true;
    state.failStreak = 0;
    state.verdict = "AUDITING";
    state.lastAuditVerdict = audit.verdict;
    state.lastAuditAt = audit.at;
    state.lastAnomalies = audit.anomalies;
  } catch (e) {
    state.lastOk = false;
    state.failStreak += 1;
    if (state.failStreak >= 3) state.verdict = "HOME-DOWN";
    try {
      fs.mkdirSync(path.join(HOME, "sovereign", "keeper", "logs"), { recursive: true });
      fs.appendFileSync(path.join(HOME, "sovereign", "keeper", "logs", "treasury-audit-daemon.log"), `${new Date().toISOString()} beat-failed: ${String((e as Error)?.message ?? e).slice(0, 160)}\n`);
    } catch {}
  }
  saveState();
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: state.verdict !== "HOME-DOWN", ...state });
    }
    if (url.pathname === "/beat" && req.method === "POST") {
      await beat();
      return json({ ok: state.lastOk === true, ...state });
    }
    if (url.pathname === "/audit") {
      try {
        return json(JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, "last-audit.json"), "utf8")));
      } catch (e) {
        return json({ ok: false, error: `no audit yet (${String((e as Error)?.message ?? e).slice(0, 60)})` }, 502);
      }
    }
    return json({ ok: false, error: "not-found", hint: "/ · /health · POST /beat · /audit" }, 404);
  },
});

// פעימה ראשונה אחרי 15ש' (הביקורת הראשונה נמדדת מיד אחרי העלייה)
setTimeout(beat, 15_000);
setInterval(beat, BEAT_SEC * 1000);

// ── r143-c · מתג-איש-מת ─────────────────────────────────────────────
// כל 60ש' נמדדת טריות lastBeatAt; שתיקה מעל 3×BEAT (15 דק') ⇒ רישום
// ביומן-הדיבון ויציאה — fleet-guard (סיור-פורטים כל 60ש', :3043 רשום)
// מקים תהליך-טרי. המדידה בטוחה בעלייה: הביקורת הראשונה רצה ב-15ש'.
const DEAD_MAN_TICK_MS = 60_000;
const DEAD_MAN_STALL_MS = 3 * BEAT_SEC * 1000;
const DEAD_MAN_LOG = path.join(HOME, "sovereign", "keeper", "logs", "treasury-audit-daemon.log");
setInterval(() => {
  const lastMs = state.lastBeatAt ? Date.parse(state.lastBeatAt) : Date.parse(state.bootedAt);
  if (Number.isFinite(lastMs) && Date.now() - lastMs <= DEAD_MAN_STALL_MS) return;
  const msg = "dead-man: beats stalled >15min — exiting for revival";
  try {
    fs.mkdirSync(path.dirname(DEAD_MAN_LOG), { recursive: true });
    fs.appendFileSync(DEAD_MAN_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log(msg);
  process.exit(1);
}, DEAD_MAN_TICK_MS);

// רישום-עלייה כנה
try {
  fs.mkdirSync(path.join(HOME, "sovereign", "keeper", "logs"), { recursive: true });
  fs.appendFileSync(
    path.join(HOME, "sovereign", "keeper", "logs", "treasury-audit-daemon.log"),
    `${new Date().toISOString()} treasury-audit daemon up on ${PORT} (audit every ${BEAT_SEC}s)\n`,
  );
} catch {}
