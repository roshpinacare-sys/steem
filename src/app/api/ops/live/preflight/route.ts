import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Console v3 — בדיקת כוננות (preflight readiness self-test), read-only.
 *
 * GET /api/ops/live/preflight → { testedAt, overallOk, checks[] }
 *
 * IRON RULES honored here:
 *   - ZERO keys: no env secret is read, no secret is accepted; the derivation
 *     self-test generates a random throwaway secret, derives a posting key,
 *     validates it and DISCARDS everything in-memory (never logged/echoed).
 *   - ZERO ops: every probe is a read-only condenser_api call — no broadcast.
 *   - All results live from chain RPC (force-dynamic, cache: no-store).
 *   - One failing probe NEVER 500s the route: Promise.allSettled + per-probe
 *     guards → always HTTP 200 with an honest per-check failure detail.
 *   - Response is fully public-safe: numbers, names and booleans only.
 *
 * Checks:
 *   rpc    — 3 public RPC nodes probed in parallel (5s timeout each), latency
 *            measured, head_block_number parsed; ok = at least one node alive.
 *   derive — steem-js 0.7.11 (the same library the browser UMD ships) derives
 *            a posting WIF from a throwaway secret: isWif → wifToPublic STM.
 *   data   — live feed (current_median_history) + headcorner pending rewards
 *            converted to SP via the DGP vesting ratio.
 *   ops    — recomputes the exact pending claim VESTS string from the raw
 *            account (reward_vesting_balance, the same string the claim op
 *            carries) and validates it parses to SP>0.
 */

const ACCOUNT = "headcorner"; // mirrors CONSOLE_USERNAME (console-helpers)
const RPC_NODES = [
  "https://api.steemit.com",
  "https://api.justyy.com",
  "https://steem.fans",
] as const;
const NODE_TIMEOUT_MS = 5_000;

export interface PreflightCheck {
  id: "rpc" | "derive" | "data" | "ops";
  label: string;
  ok: boolean;
  latencyMs?: number;
  detail: string;
}

export interface PreflightResponse {
  testedAt: string;
  overallOk: boolean;
  checks: PreflightCheck[];
}

// ── Low-level helpers ────────────────────────────────────────────────────────

let rpcId = 2400;

/** One JSON-RPC POST with a hard AbortController timeout (read-only call). */
async function rpcPost<T>(
  url: string,
  method: string,
  params: unknown,
  timeoutMs: number = NODE_TIMEOUT_MS,
): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++rpcId }),
      signal: ac.signal,
      cache: "no-store",
    });
    let json: { result?: T; error?: { message?: string } };
    try {
      json = (await res.json()) as { result?: T; error?: { message?: string } };
    } catch {
      throw new Error(`HTTP ${res.status} — תשובה לא-JSON`);
    }
    if (json.error) throw new Error(`${method}: ${json.error.message ?? "RPC error"}`);
    if (json.result === undefined) throw new Error(`${method}: empty result`);
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Exact, short, honest failure text (timeouts included). */
function errText(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "AbortError" || /aborted|timeout/i.test(e.message)) {
      return `פסק-זמן ${Math.round(NODE_TIMEOUT_MS / 1000)}s`;
    }
    return e.message.slice(0, 180) || e.name;
  }
  return String(e).slice(0, 180);
}

function num(asset: string | undefined | null): number {
  if (!asset) return 0;
  return parseFloat(asset.split(" ")[0]) || 0;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ── Chain shapes (subset actually read) ──────────────────────────────────────

interface DgpShape {
  head_block_number?: number;
  total_vesting_fund_steem?: string;
  total_vesting_shares?: string;
}
interface FeedHistoryShape {
  current_median_history?: { base?: string; quote?: string } | null;
}
interface RawAccountShape {
  reward_vesting_balance?: string;
}

function feedOf(feedHist: FeedHistoryShape | null | undefined): number {
  const cm = feedHist?.current_median_history;
  const q = num(cm?.quote);
  return q > 0 ? num(cm?.base) / q : 0;
}

function vest2spOf(dgp: DgpShape | null | undefined): number {
  const shares = num(dgp?.total_vesting_shares);
  return shares > 0 ? num(dgp?.total_vesting_fund_steem) / shares : 0;
}

/** Runs `fn` against the first responsive node (primary → fallbacks). */
async function fetchLive<T>(fn: (url: string) => Promise<T>): Promise<{ data: T; via: string }> {
  let lastErr: unknown;
  for (const url of RPC_NODES) {
    try {
      return { data: await fn(url), via: url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`אף צומת לא נענה: ${RPC_NODES.map(hostOf).join(", ")}`);
}

// ── Probe runner (a failing probe becomes a failed check, never a 500) ───────

interface ProbeOutcome {
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

async function guard(id: PreflightCheck["id"], label: string, fn: () => Promise<ProbeOutcome>) {
  try {
    const r = await fn();
    return { id, label, ...r } satisfies PreflightCheck;
  } catch (e) {
    return { id, label, ok: false, detail: `נכשל: ${errText(e)}` } satisfies PreflightCheck;
  }
}

// ── Probe a — RPC nodes ──────────────────────────────────────────────────────

interface NodeProbe {
  url: string;
  ok: boolean;
  latencyMs: number;
  reason?: string;
}

async function probeNode(url: string): Promise<NodeProbe> {
  const t0 = performance.now();
  try {
    const dgp = await rpcPost<DgpShape>(url, "condenser_api.get_dynamic_global_properties", []);
    const latencyMs = Math.round(performance.now() - t0);
    const block = dgp?.head_block_number;
    if (typeof block !== "number" || block <= 0) {
      return { url, ok: false, latencyMs, reason: "תשובה חסרת head_block_number" };
    }
    return { url, ok: true, latencyMs };
  } catch (e) {
    return {
      url,
      ok: false,
      latencyMs: Math.round(performance.now() - t0),
      reason: errText(e),
    };
  }
}

async function probeRpc(): Promise<ProbeOutcome> {
  const nodes = await Promise.all(RPC_NODES.map(probeNode));
  const alive = nodes.filter((n) => n.ok);
  const dead = nodes.filter((n) => !n.ok);
  if (!alive.length) {
    return {
      ok: false,
      detail: `אף צומת לא נענה — ${nodes
        .map((n) => `${hostOf(n.url)} (${n.reason ?? "לא ידוע"})`)
        .join(", ")}`,
    };
  }
  const fastest = alive.reduce((a, b) => (a.latencyMs <= b.latencyMs ? a : b));
  const deadNote = dead.length
    ? ` · לא נענו: ${dead.map((n) => `${hostOf(n.url)} (${n.reason ?? "?"})`).join(", ")}`
    : "";
  return {
    ok: true,
    latencyMs: fastest.latencyMs,
    detail: `${alive.length}/${nodes.length} תקינים · המהיר: ${hostOf(fastest.url)} (${fastest.latencyMs}ms)${deadNote}`,
  };
}

// ── Probe b — derivation engine (steem-js, throwaway secret) ─────────────────

/** Minimal typed shape of the steem-js auth module (no @types package). */
interface SteemLib {
  auth: {
    isWif(wif: string): boolean;
    wifToPublic(wif: string): string;
    getPrivateKeys(username: string, password: string, roles?: string[]): Record<string, string>;
  };
}

async function loadSteemLib(): Promise<SteemLib> {
  // Lazy dynamic import: if the library fails to load at all, only THIS check
  // fails — the route still answers 200 (one broken probe never 500s).
  const mod: unknown = await import("steem");
  return (mod as { default?: SteemLib }).default ?? (mod as SteemLib);
}

async function probeDerive(): Promise<ProbeOutcome> {
  const t0 = performance.now();
  const lib = await loadSteemLib();

  // Random throwaway secret — generated here, used here, discarded here.
  // It is NEVER logged, echoed or stored anywhere (fully disposable).
  const throwaway = `saos-preflight-${Date.now()}`;
  let wif: string | undefined;
  let pubFromKeys: string | undefined;
  try {
    const keys = lib.auth.getPrivateKeys(ACCOUNT, throwaway, ["posting"]);
    wif = keys.posting;
    pubFromKeys = keys.postingPubkey;
  } catch (e) {
    return { ok: false, detail: `גזירה נכשלה: ${errText(e)}` };
  }
  if (typeof wif !== "string" || wif.length === 0) {
    return { ok: false, detail: "גזירה לא החזירה WIF (posting)" };
  }
  if (!lib.auth.isWif(wif)) {
    return { ok: false, detail: "אימות WIF (isWif) נכשל על מפתח-זבל מקומי" };
  }
  const pub = lib.auth.wifToPublic(wif);
  if (typeof pub !== "string" || !pub.startsWith("STM")) {
    return { ok: false, detail: "קידוד פומבי (wifToPublic) לא החזיר מפתח STM" };
  }
  if (pubFromKeys !== pub) {
    return { ok: false, detail: "אי-התאמה בין ה-WIF הגזור למפתח הפומבי" };
  }
  // wif / pub / throwaway die here — nothing leaves this function.
  return {
    ok: true,
    latencyMs: Math.round(performance.now() - t0),
    detail: "גזירה+אימות WIF+קידוד STM תקינים",
  };
}

// ── Probe c — chain data (feed + pending rewards) ────────────────────────────

async function probeData(): Promise<ProbeOutcome> {
  const t0 = performance.now();
  const { data } = await fetchLive(async (url) => {
    const [feedHist, accounts, dgp] = await Promise.all([
      rpcPost<FeedHistoryShape>(url, "condenser_api.get_feed_history", []),
      rpcPost<RawAccountShape[]>(url, "condenser_api.get_accounts", [[ACCOUNT]]),
      rpcPost<DgpShape>(url, "condenser_api.get_dynamic_global_properties", []),
    ]);
    return { feedHist, acc: accounts?.[0], dgp };
  });
  if (!data.acc) {
    return { ok: false, detail: `החשבון @${ACCOUNT} לא נמצא ברשת` };
  }
  const feed = feedOf(data.feedHist);
  if (!(feed > 0)) {
    return { ok: false, detail: "פיד SBD/STEEM לא זמין (current_median_history חסר)" };
  }
  const vest2sp = vest2spOf(data.dgp);
  if (!(vest2sp > 0)) {
    return { ok: false, detail: "יחס VESTS→SP לא זמין (DGP חסר)" };
  }
  const pendingSp = num(data.acc.reward_vesting_balance) * vest2sp;
  return {
    ok: true,
    latencyMs: Math.round(performance.now() - t0),
    detail: `פיד ${feed.toFixed(6)} · תביעה ממתינה ${pendingSp.toFixed(2)} SP`,
  };
}

// ── Probe d — ops assembly (the exact claim VESTS string) ────────────────────

async function probeOps(): Promise<ProbeOutcome> {
  const t0 = performance.now();
  const { data } = await fetchLive(async (url) => {
    const [accounts, dgp] = await Promise.all([
      rpcPost<RawAccountShape[]>(url, "condenser_api.get_accounts", [[ACCOUNT]]),
      rpcPost<DgpShape>(url, "condenser_api.get_dynamic_global_properties", []),
    ]);
    return { acc: accounts?.[0], dgp };
  });
  if (!data.acc) {
    return { ok: false, detail: `החשבון @${ACCOUNT} לא נמצא ברשת` };
  }
  const vest2sp = vest2spOf(data.dgp);
  if (!(vest2sp > 0)) {
    return { ok: false, detail: "יחס VESTS→SP לא זמין — בדיקת ההמרה נכשלה" };
  }
  // The claim op carries reward_vesting_balance verbatim — read it raw and
  // recompute/validate the exact string the transaction will assemble.
  const raw = (data.acc.reward_vesting_balance ?? "").trim();
  const vests = num(raw);
  if (!raw || vests < 0) {
    return { ok: false, detail: `מחרוזת VESTS לא תקינה מהצומת ("${raw}")` };
  }
  if (vests === 0) {
    // Nothing pending is NOT an assembly failure — the engine has nothing to
    // assemble. Honest detail instead of a fake error.
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - t0),
      detail: "אין פרסים ממתינים — אין מה להרכיב כרגע",
    };
  }
  const sp = vests * vest2sp;
  if (!(sp > 0)) {
    return { ok: false, detail: `התביעה לא מתפרסמת ל-SP חיובי (${raw})` };
  }
  const normalized = `${vests.toFixed(6)} VESTS`;
  return {
    ok: true,
    latencyMs: Math.round(performance.now() - t0),
    detail:
      normalized === raw
        ? `תביעה מוכנה: ${raw}`
        : `תביעה מוכנה: ${raw} (מנורמל: ${normalized})`,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

const PROBES: { id: PreflightCheck["id"]; label: string; fn: () => Promise<ProbeOutcome> }[] = [
  { id: "rpc", label: "חיבור לצמתי השרשרת", fn: probeRpc },
  { id: "derive", label: "מנוע גזירת מפתחות (steem-js 0.7.11)", fn: probeDerive },
  { id: "data", label: "נתוני שרשרת", fn: probeData },
  { id: "ops", label: "הרכבת עסקאות", fn: probeOps },
];

export async function GET() {
  // allSettled: a rejected probe can never take the route down with it.
  const settled = await Promise.allSettled(PROBES.map((p) => guard(p.id, p.label, p.fn)));
  const checks: PreflightCheck[] = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          id: PROBES[i].id,
          label: PROBES[i].label,
          ok: false,
          detail: `נכשל: ${errText(r.reason)}`,
        },
  );
  const body: PreflightResponse = {
    testedAt: new Date().toISOString(),
    overallOk: checks.length > 0 && checks.every((c) => c.ok),
    checks,
  };
  return NextResponse.json(body);
}
