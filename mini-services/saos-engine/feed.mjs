/**
 * feed.mjs — T-48 · POWER-LADDER RUNG-2: THE EXTERNAL-AGENT DOOR (MCP-style
 * tool registry + the market-data-feed product's second delivery lane).
 *
 * Examined live (2025-06-18 spec, modelcontextprotocol.io, fetched not
 * guessed): JSON-RPC 2.0 single messages (batching removed in this version),
 * initialize → {protocolVersion, capabilities, serverInfo, instructions},
 * notifications/initialized, tools/list → {tools:[{name,description,
 * inputSchema}]}, tools/call → {content:[{type:"text",text}], isError}.
 *
 * THE LEASH (the T-33-NEXT law: every new power arrives with its own leash):
 *  - ALLOWLIST: the tool table below is the entire surface; anything else is
 *    a typed JSON-RPC error. No tool mutates — the door is READ-ONLY class.
 *  - KEY LAW: a paid entitlement key (issued by catalog.mjs on a verified
 *    SAOS-CATALOG:market-data-feed payment, 7d TTL) or the operator's engine
 *    token (the owner lane — an existing trust boundary, not a new one).
 *    Missing key 401, wrong key 403, expired key typed FEED-KEY-EXPIRED.
 *  - BOUNDS: body ≤ 16KB, one message per request (no batches), bounded
 *    arguments per tool, in-memory rate leash per key.
 *  - HONESTY: every payload keeps the measured/estimated/blocked class
 *    labels — the door sells the measurements, never their costume.
 *
 * T-59b · DOOR TELEMETRY: the door's demand is now MEASURED, not remembered.
 * Pure law doorHitLaw folds a typed verdict into a typed counter bucket
 * {hits, byTool, byVerdict, firstAt, lastAt}; persistDoorCounters mirrors it
 * to state/feed-door.json (atomic tmp+rename, bounded 8KB); loadDoorCounters
 * restores it fail-open (any garbage → the honest zero default); the handler
 * sites (index.ts) count and persist fire-and-forget — the response never
 * waits on telemetry, and telemetry failure never touches the door.
 *
 * T-59b · THE 6TH TOOL — hive.regime: the measured Hive venue (T-54/57/63
 * sensor) becomes sellable through the same key law — spread/range/tick/
 * volume/plan-class with the blocked-no-credential note. Honest nulls when
 * the sensor has not landed a pulse; nothing invented.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { measureAll } from "./measure.mjs";
import { hiveState, HIVE_MARKET_PAIR } from "./hive.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

export const FEED_LAW = "הדלת קוראת, לעולם לא כותבת — מפתח-זכאות משולם או מפתח-המפעיל, תחומים קשוחים, וכל-מספר נושא את-המחלקה שלו (measured/estimated/blocked).";

/* the credential wall of the 6th tool, named in plain words (T-54 gate) */
const HIVE_CREDENTIAL_NOTE = "blocked-no-credential — Hive signing is byte-proven (steemtx adapter law) but NO Hive account credential is held; the grid plan stays journal-only (T-54 operator gate). Nothing here moves HIVE.";

/* ── the tool table (the allowlist IS the leash) ─────────────────────────── */
export const MCP_TOOLS = [
  {
    name: "market.snapshot",
    description: "Latest MEASURED STEEM/SBD market window: book, spread, trades/day, parity source. Class labels ride along (measured/estimated).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "router.verdict",
    description: "The evidence-weighted venue router: per-venue class (measured full / estimated half / blocked zero), $/day, weights, and the named binding constraint.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "catalog.list",
    description: "The offer catalog: SKUs, prices, and the exact on-chain payment memo law (SAOS-CATALOG:<sku>).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "fills.recent",
    description: "Our most recent measured market fills (our own order book history).",
    inputSchema: { type: "object", properties: { count: { type: "number", description: "1..50, default 10" } }, additionalProperties: false },
  },
  {
    name: "payouts.clock",
    description: "The measured payout clock: phase, hours to the curation window, pending rewards verdict.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "hive.regime",
    description: "The MEASURED Hive regime (HBD:HIVE internal market): book/spread, closes-only 24h range, tick, volume, and the plan-only grid verdict — credential-gated, journal-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/* ── pure law 1: entitlement keys (issue/check, timing-safe) ─────────────── */
export const FEED_TTL_MS = 7 * 24 * 3600 * 1000; // the SKU sells "per week" — the key keeps the promise

export function feedKeyIssue({ txid, sku, salt, now = Date.now(), ttlMs = FEED_TTL_MS }) {
  const t = String(txid ?? "").trim();
  const s = String(sku ?? "").trim();
  const saltStr = String(salt ?? "");
  if (!/^[0-9a-f]{40,78}$/i.test(t) || !s || saltStr.length < 16) return null; // fail-closed
  const key = crypto.createHmac("sha256", saltStr).update(`${t}:${s}`).digest("hex").slice(0, 32);
  return { key, sku: s, txid: t, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
}

export function feedKeyCheck(entitlements, presentedKey, now = Date.now()) {
  const k = typeof presentedKey === "string" ? presentedKey.trim() : "";
  if (!k || !Array.isArray(entitlements)) return { ok: false, why: "FEED-KEY-UNKNOWN" };
  const kBuf = Buffer.from(k);
  for (const e of entitlements) {
    if (!e?.key) continue;
    if (kBuf.length === Buffer.byteLength(e.key) && crypto.timingSafeEqual(kBuf, Buffer.from(e.key))) {
      const exp = Date.parse(e.expiresAt ?? "");
      if (Number.isFinite(exp) && now > exp) return { ok: false, why: "FEED-KEY-EXPIRED" };
      return { ok: true, entitlement: e };
    }
  }
  return { ok: false, why: "FEED-KEY-UNKNOWN" };
}

/* ── pure law 2: the MCP frame judge (single message, allowlist, bounds) ─── */
const MCP_METHODS = new Set(["initialize", "tools/list", "tools/call", "ping"]);
const MCP_NOTIFICATIONS = new Set(["notifications/initialized", "notifications/cancelled"]);
const JSONRPC_ERRORS = {
  PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603,
};
export { JSONRPC_ERRORS as MCP_JSONRPC_ERRORS };

export function mcpFrameJudge(rawBody) {
  let msg;
  try {
    msg = JSON.parse(typeof rawBody === "string" ? rawBody : String(rawBody ?? ""));
  } catch {
    return { ok: false, code: JSONRPC_ERRORS.PARSE, why: "parse error" };
  }
  if (Array.isArray(msg)) return { ok: false, code: JSONRPC_ERRORS.INVALID_REQUEST, why: "batching removed in 2025-06-18 — one message per request" };
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return { ok: false, code: JSONRPC_ERRORS.INVALID_REQUEST, why: "jsonrpc must be the string \"2.0\"" };
  const method = typeof msg.method === "string" ? msg.method : "";
  if (!method) return { ok: false, code: JSONRPC_ERRORS.INVALID_REQUEST, why: "method required" };
  const isNotification = msg.id === undefined;
  if (!isNotification) {
    if (msg.id !== null && typeof msg.id !== "string" && typeof msg.id !== "number") return { ok: false, code: JSONRPC_ERRORS.INVALID_REQUEST, why: "id must be string|number|null" };
    if (!MCP_METHODS.has(method)) return { ok: false, code: JSONRPC_ERRORS.METHOD_NOT_FOUND, why: `unknown method ${method}` };
  } else if (!MCP_NOTIFICATIONS.has(method)) {
    return { ok: false, why: `unknown notification ${method}`, notification: true };
  }
  if (msg.params !== undefined && (typeof msg.params !== "object" || msg.params === null || Array.isArray(msg.params))) return { ok: false, code: JSONRPC_ERRORS.INVALID_REQUEST, why: "params must be an object" };
  return { ok: true, method, id: isNotification ? undefined : msg.id, notification: isNotification, params: msg.params ?? {} };
}

/* ── pure law 3: bounded tool arguments ──────────────────────────────────── */
export function mcpToolArgsJudge(toolName, args) {
  const tool = MCP_TOOLS.find((t) => t.name === toolName);
  if (!tool) return { ok: false, why: `unknown tool ${toolName}` };
  if (args === undefined || args === null) return { ok: true, args: {} };
  if (typeof args !== "object" || Array.isArray(args)) return { ok: false, why: "arguments must be an object" };
  const keys = Object.keys(args);
  const schemaKeys = Object.keys(tool.inputSchema?.properties ?? {});
  for (const k of keys) if (!schemaKeys.includes(k)) return { ok: false, why: `unknown argument ${k}` };
  if (toolName === "fills.recent") {
    const c = args.count ?? 10;
    if (typeof c !== "number" || !Number.isFinite(c) || c < 1 || c > 50) return { ok: false, why: "count must be a number 1..50" };
    return { ok: true, args: { count: Math.floor(c) } };
  }
  if (toolName === "hive.regime") {
    if (keys.length) return { ok: false, why: "hive.regime takes no arguments" };
    return { ok: true, args: {} };
  }
  if (keys.length) return { ok: false, why: "this tool takes no arguments" };
  return { ok: true, args: {} };
}

/* ── read-only handlers: the door serves MEASUREMENTS, classes ride along ──
 * async because fills.recent reads the CHAIN (fill_order history via
 * measureAll — the same measured source the /fills route serves); state-file
 * tools stay synchronous reads under the hood. */
export async function feedToolResult(toolName, args, { account = "" } = {}) {
  const judged = mcpToolArgsJudge(toolName, args);
  if (!judged.ok) return { isError: true, text: `invalid arguments: ${judged.why}` };
  switch (toolName) {
    case "market.snapshot": {
      const m = readJson(path.join(STATE, "market.json"));
      const o = readJson(path.join(STATE, "offer.json"));
      if (!m && !o) return { isError: true, text: "market state unavailable" };
      return { isError: false, data: { windowHours: m?.windowHours ?? o?.market?.windowHours ?? null, tradesPerDay: m?.tradesPerDay ?? o?.market?.tradesPerDay ?? null, class: m?.class ?? o?.market?.class ?? null, book: m?.book ?? o?.book ?? null, parity: o?.marks ?? null, at: m?.at ?? o?.publishedAt ?? null } };
    }
    case "router.verdict": {
      const r = readJson(path.join(STATE, "router.json"));
      if (!r) return { isError: true, text: "router state unavailable" };
      return { isError: false, data: { at: r.at, venues: r.venues, binding: r.binding ?? r.bindingConstraint ?? null, law: r.law } };
    }
    case "catalog.list": {
      const c = readJson(path.join(STATE, "catalog.json"));
      if (!c) return { isError: true, text: "catalog state unavailable" };
      return { isError: false, data: { skus: c.skus, law: c.law, counts: c.counts ?? null } };
    }
    case "fills.recent": {
      /* CHAIN truth, not a cached guess: fill_order history for OUR account
       * (the same measureAll the /fills route serves). Honest error on an
       * unmeasurable window — never an empty list pretending to be empty. */
      if (!account) return { isError: true, text: "account context missing" };
      try {
        const meas = await measureAll(account);
        if (!meas?.ok) return { isError: true, text: "fill history unavailable (chain read failed)" };
        const fills = (Array.isArray(meas.fills) ? meas.fills : []).slice(-(judged.args.count ?? 10)).reverse();
        return { isError: false, data: { count: fills.length, windowMeasured: meas.fills?.length ?? 0, fills, note: "measured fill_order history (our account, chain-read)" } };
      } catch (e) {
        return { isError: true, text: `fill history unavailable: ${String(e?.message ?? e).slice(0, 80)}` };
      }
    }
    case "payouts.clock": {
      const p = readJson(path.join(STATE, "payouts.json"));
      if (!p) return { isError: true, text: "payouts state unavailable" };
      return { isError: false, data: { phase: p.payout?.phase ?? null, hoursRemaining: p.payout?.hoursRemaining ?? null, pending: p.pending ?? null, vp: p.vp?.pct ?? null, at: p.at } };
    }
    case "hive.regime": {
      /* T-59b · the 6th tool: the MEASURED second venue (state/hive.json —
       * the T-54/57/63 sensor state). Honest nulls when no pulse has landed;
       * the plan rides as a SUMMARY (verdict/spacing/levels, orders count —
       * never the raw ladder) and the credential wall is named in plain
       * words: the Hive plan is journal-only until an operator credential
       * exists (the T-54 OPERATOR-GATED class). */
      const h = (() => { try { return hiveState(); } catch { return null; } })();
      if (!h || typeof h !== "object") {
        return { isError: false, data: { pair: HIVE_MARKET_PAIR, at: null, measured: false, book: null, spreadBps: null, range: null, tick: null, volume: null, plan: null, credentialNote: HIVE_CREDENTIAL_NOTE, note: "no hive measurement yet — honest nulls, nothing invented" } };
      }
      return { isError: false, data: {
        pair: h.pair ?? HIVE_MARKET_PAIR,
        at: h.at ?? null,
        measured: !!h.ok,
        book: h.book ?? null,
        spreadBps: h.book?.spreadBps ?? null,
        range: h.range ?? null,
        tick: h.tick ?? null,
        volume: h.volume ?? null,
        plan: h.plan ? {
          verdict: h.plan.verdict ?? null,
          mid: h.plan.mid ?? null,
          spacingBps: h.plan.spacingBps ?? null,
          levels: h.plan.levels ?? null,
          budgetHive: h.plan.budgetHive ?? null,
          widthSource: h.plan.widthSource ?? null,
          ordersPlanned: Array.isArray(h.plan.orders) ? h.plan.orders.length : null,
          execution: h.plan.execution ?? null,
        } : null,
        credentialNote: HIVE_CREDENTIAL_NOTE,
        note: h.note ?? null,
      } };
    }
    default:
      return { isError: true, text: `unknown tool ${toolName}` };
  }
}

/* ── rate leash (in-memory, per key-prefix; a door, not a firehose) ─────── */
const rateBuckets = new Map();
export function feedRateOk(keyId, { perMin = 60, now = Date.now() } = {}) {
  const win = rateBuckets.get(keyId) ?? [];
  const alive = win.filter((t) => now - t < 60_000);
  if (alive.length >= perMin) {
    rateBuckets.set(keyId, alive);
    return false;
  }
  alive.push(now);
  rateBuckets.set(keyId, alive);
  return true;
}

/* ══ T-59b · DOOR TELEMETRY (demand is measured, never remembered) ════════
 * Verdict classes are a CLOSED set — one per handling site at the door:
 *   initialize  — the initialize method + its notifications/initialized 202
 *   tools-list  — a served tools/list
 *   tools-call  — a served tools/call (byTool names the tool; the plain
 *                 /market-feed lane counts here too, tool "market-feed")
 *   tool-name   — a tools/call whose name is not on the allowlist (-32602)
 *   ping        — a served ping
 *   unauthorized — 401/403 at the key law
 *   bad-frame   — 405 method, >16KB body, unparseable/invalid JSON-RPC
 *   rate-limited — 429 at the 60/min leash                                  */
export const DOOR_VERDICTS = ["initialize", "tools-list", "tools-call", "tool-name", "ping", "unauthorized", "bad-frame", "rate-limited"];
const DOOR_VERDICT_SET = new Set(DOOR_VERDICTS);
export const DOOR_TOOLS_MAX = 32;      // byTool is bounded — the counter can never grow unbounded
export const DOOR_FILE_MAX_BYTES = 8192; // the persisted mirror is bounded too

/** the typed counter bucket — the ONE shape door telemetry speaks */
export function doorCountersInit() {
  return { hits: 0, byTool: {}, byVerdict: {}, firstAt: null, lastAt: null };
}

const safeIso = (t) => { const d = new Date(t); return Number.isFinite(d.getTime()) ? d.toISOString() : null; };

/** PURE law: fold one hit into a bucket. Never mutates the input; unknown
 * verdicts (outside the closed set) and non-finite timestamps are refused
 * with ok:false and the bucket returned unchanged — telemetry never lies
 * about classes it does not know. byTool counts only tools-call verdicts
 * (unnamed → "_unknown") and is trimmed to the busiest DOOR_TOOLS_MAX keys. */
export function doorHitLaw({ bucket, now, verdict, tool } = {}) {
  const base = bucket && typeof bucket === "object" && !Array.isArray(bucket) ? bucket : doorCountersInit();
  if (!DOOR_VERDICT_SET.has(verdict)) return { ok: false, why: "unknown-verdict", bucket: base };
  const iso = safeIso(now);
  if (!iso) return { ok: false, why: "bad-now", bucket: base };
  let byTool = {};
  for (const [k, v] of Object.entries(base.byTool ?? {})) {
    const n = Number(v);
    if (typeof k === "string" && k && Number.isFinite(n) && n > 0) byTool[String(k).slice(0, 40)] = Math.floor(n);
  }
  if (verdict === "tools-call") {
    const t = typeof tool === "string" && tool.trim() ? tool.trim().slice(0, 40) : "_unknown";
    byTool[t] = (byTool[t] ?? 0) + 1;
  }
  if (Object.keys(byTool).length > DOOR_TOOLS_MAX) {
    byTool = Object.fromEntries(Object.entries(byTool).sort((a, b) => b[1] - a[1]).slice(0, DOOR_TOOLS_MAX));
  }
  const byVerdict = {};
  for (const v of DOOR_VERDICTS) {
    const n = Number(base.byVerdict?.[v] ?? 0);
    if (Number.isFinite(n) && n > 0) byVerdict[v] = Math.floor(n);
  }
  byVerdict[verdict] = (byVerdict[verdict] ?? 0) + 1;
  return {
    ok: true,
    bucket: {
      hits: (Number.isFinite(Number(base.hits)) ? Math.max(0, Math.floor(Number(base.hits))) : 0) + 1,
      byTool,
      byVerdict,
      firstAt: typeof base.firstAt === "string" && base.firstAt ? base.firstAt : iso,
      lastAt: iso,
    },
  };
}

/* ── the live counters + the one-line wiring verb for handler sites ─────── */
let doorLive = doorCountersInit();
export function doorCounters() { return doorLive; }
export function doorCountersSet(c) { if (c && typeof c === "object" && !Array.isArray(c)) doorLive = c; return doorLive; }
export function doorHit(verdict, { now = Date.now(), tool } = {}) {
  const r = doorHitLaw({ bucket: doorLive, now, verdict, tool });
  if (r.ok) doorLive = r.bucket;
  return doorLive;
}

/* ── persistence: atomic mirror (tmp+rename), bounded 8KB, fail-open ────── */
export function doorCountersPath(dir = STATE) { return path.join(dir, "feed-door.json"); }

/** bounded shape: closed verdict set, sanitized tool map — shrink by dropping
 * the least-busy tool names until the JSON fits the byte bound. Deterministic
 * (count desc, then key asc). */
export function doorCountersBound(counters, maxBytes = DOOR_FILE_MAX_BYTES) {
  const base = counters && typeof counters === "object" && !Array.isArray(counters) ? counters : {};
  const byVerdict = {};
  for (const v of DOOR_VERDICTS) {
    const n = Number(base.byVerdict?.[v] ?? 0);
    if (Number.isFinite(n) && n > 0) byVerdict[v] = Math.floor(n);
  }
  const tools = Object.entries(base.byTool ?? {})
    .filter(([k, v]) => typeof k === "string" && k && Number.isFinite(Number(v)) && Number(v) > 0)
    .map(([k, v]) => [String(k).slice(0, 40), Math.floor(Number(v))])
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
  const hits = Number.isFinite(Number(base.hits)) && Number(base.hits) >= 0 ? Math.floor(Number(base.hits)) : 0;
  const shrink = (kept) => JSON.stringify({ hits, byTool: Object.fromEntries(kept), byVerdict, firstAt: typeof base.firstAt === "string" ? base.firstAt : null, lastAt: typeof base.lastAt === "string" ? base.lastAt : null });
  let kept = tools;
  if (Buffer.byteLength(shrink(kept)) > maxBytes) {
    while (kept.length && Buffer.byteLength(shrink(kept)) > maxBytes) kept = kept.slice(0, kept.length - 1);
  }
  return JSON.parse(shrink(kept));
}

/** persist fire-and-forget: async write (tmp+rename), NEVER throws — a
 * telemetry failure returns {ok:false} and the door keeps serving. */
export async function persistDoorCounters(counters, { dir = STATE } = {}) {
  try {
    const body = JSON.stringify(doorCountersBound(counters));
    if (Buffer.byteLength(body) > DOOR_FILE_MAX_BYTES) return { ok: false, why: "door-counters-overbound" };
    const p = doorCountersPath(dir);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    const t = `${p}.tmp.${process.pid}`;
    await fs.promises.writeFile(t, body);
    await fs.promises.rename(t, p);
    return { ok: true, bytes: Buffer.byteLength(body) };
  } catch (e) {
    return { ok: false, why: String(e?.message ?? e).slice(0, 120) }; // fail-open on IO
  }
}

/** restore at boot — FAIL-OPEN: any missing/corrupt/garbage file yields the
 * honest zero default; junk verdicts are filtered to the closed set, tool
 * names clamped, the busiest DOOR_TOOLS_MAX kept. */
export function loadDoorCounters({ dir = STATE } = {}) {
  try {
    const raw = readJson(doorCountersPath(dir), null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return doorCountersInit();
    const byVerdict = {};
    let verdictSum = 0;
    for (const v of DOOR_VERDICTS) {
      const n = Number(raw.byVerdict?.[v] ?? 0);
      if (Number.isFinite(n) && n > 0) { byVerdict[v] = Math.floor(n); verdictSum += Math.floor(n); }
    }
    let toolEntries = Object.entries(raw.byTool ?? {})
      .filter(([k, v]) => typeof k === "string" && k && Number.isFinite(Number(v)) && Number(v) > 0)
      .map(([k, v]) => [String(k).slice(0, 40), Math.floor(Number(v))]);
    if (toolEntries.length > DOOR_TOOLS_MAX) {
      toolEntries = toolEntries.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, DOOR_TOOLS_MAX);
    }
    const hitsRaw = Number(raw.hits ?? 0);
    return {
      hits: Number.isFinite(hitsRaw) && hitsRaw >= 0 ? Math.floor(hitsRaw) : verdictSum,
      byTool: Object.fromEntries(toolEntries),
      byVerdict,
      firstAt: typeof raw.firstAt === "string" && raw.firstAt ? raw.firstAt.slice(0, 30) : null,
      lastAt: typeof raw.lastAt === "string" && raw.lastAt ? raw.lastAt.slice(0, 30) : null,
    };
  } catch {
    return doorCountersInit(); // telemetry never breaks the door
  }
}

/** the ≤2KB /status passthrough: top tools only, closed verdict set, clamped
 * keys — small enough to ride the one-body aggregate forever. */
export function doorTelemetrySnapshot(counters = doorCounters(), { maxTools = 12 } = {}) {
  const c = counters && typeof counters === "object" && !Array.isArray(counters) ? counters : doorCountersInit();
  const byTool = Object.entries(c.byTool ?? {})
    .filter(([k, v]) => typeof k === "string" && k && Number.isFinite(Number(v)))
    .map(([k, v]) => [String(k).slice(0, 40), Math.max(0, Math.floor(Number(v)))])
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, Math.max(1, Math.min(24, Math.floor(Number(maxTools) || 12))));
  const byVerdict = {};
  for (const v of DOOR_VERDICTS) {
    const n = Number(c.byVerdict?.[v] ?? 0);
    if (Number.isFinite(n) && n > 0) byVerdict[v] = Math.floor(n);
  }
  const hits = Number.isFinite(Number(c.hits)) && Number(c.hits) >= 0 ? Math.floor(Number(c.hits)) : 0;
  return {
    hits,
    byTool: Object.fromEntries(byTool),
    byVerdict,
    firstAt: typeof c.firstAt === "string" ? c.firstAt.slice(0, 30) : null,
    lastAt: typeof c.lastAt === "string" ? c.lastAt.slice(0, 30) : null,
  };
}

/* ── the entitlement store (atomic mirror law: tmp+rename, never append) ── */
export function entitlementsPath() { return path.join(STATE, "feed-entitlements.json"); }
export function readEntitlements() { return readJson(entitlementsPath(), { entitlements: [], counts: { issued: 0 } }); }
export function writeEntitlements(doc) {
  const t = `${entitlementsPath()}.tmp.${process.pid}`;
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.writeFileSync(t, JSON.stringify(doc, null, 2));
  fs.renameSync(t, entitlementsPath());
}

/* issue on a verified PAID-NEW order (called by catalog.mjs fulfillment) */
export function issueFeedEntitlement({ txid, sku, from, salt, now = Date.now() }) {
  const ent = feedKeyIssue({ txid, sku, salt, now });
  if (!ent) return { ok: false, why: "issue-refused" };
  const doc = readEntitlements();
  if ((doc.entitlements ?? []).some((e) => e.txid === txid && e.sku === sku)) return { ok: true, entitlement: doc.entitlements.find((e) => e.txid === txid && e.sku === sku), dup: true };
  const rec = { ...ent, from: String(from ?? "").slice(0, 32) };
  doc.entitlements = [...(doc.entitlements ?? []), rec].slice(-200);
  doc.counts = { ...(doc.counts ?? {}), issued: (doc.counts?.issued ?? 0) + 1 };
  writeEntitlements(doc);
  return { ok: true, entitlement: rec };
}

/* the JSON-RPC result builders (spec shapes, measured from the 2025-06-18 pages) */
export function mcpResult(id, result) { return { jsonrpc: "2.0", id, result }; }
export function mcpError(id, code, message, data = undefined) {
  return { jsonrpc: "2.0", id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } };
}

export const FEED_SERVER_INFO = { name: "saos-engine", title: "SAOS sovereign machine — measured market data", version: "t-59b.1.0" };
