/* SAOS AGENT-BUS (R243) — chain-native inter-agent communication.
 *
 * WHY (operator directive 2026-10-07): "make our agents inside the autonomous
 * sovereignty TALK TO EACH OTHER — full internal communication". The sandbox
 * dies ~5×/day; local queues die with it. The only medium that always
 * survives is the chain itself: custom_json ops (id `saos-bus-v1`) are the
 * sovereign mail — every agent (sandbox engine, CI runner, any future host)
 * reads the SAME inbox from the SAME public nodes, with zero external
 * services. This is the L2-contract technique of the chain-native ladder
 * (docs/CHAIN-NATIVE-SOVEREIGNTY.md §L4): the protocol lives in git, the
 * messages live on chain, the truth lives in both.
 *
 * LAWS:
 *  · custody first — only custody-verified accounts ever publish (T-80 gate)
 *  · rate-limited — ≤3 bus ops per cycle, ≥20s apart (no chain flooding)
 *  · bounded — body ≤ 512 bytes JSON, inbox scan bounded (pages × window)
 *  · verdict-only receipts — no secrets, no key material, ever
 */

const RPC_NODES = ["https://api.steemit.com", "https://api.steem.fans", "https://steem.61bts.com"];
const PAGE = 100;
const MAX_PAGES = 25;
const WINDOW = 25000;

export const BUS_ID = "saos-bus-v1";
export const BUS_MAX_BODY = 512;
export const BUS_MAX_PER_CYCLE = 3;
export const BUS_MIN_GAP_MS = 20000;

export const BUS_TYPES = Object.freeze({
  CYCLE_RECEIPT: "cycle.receipt",   // engine → * : one cycle finished (verdicts)
  ANCHOR_RECEIPT: "anchor.receipt", // runner → * : custody anchor landed
  QUALITY_THRESHOLD: "quality.threshold", // learning → content : spamgate tighten/loosen
  CUSTODY_STATUS: "custody.status", // runner → * : verified roster snapshot
  PUBLISH_VERDICT: "publish.verdict", // social → learning : gate verdicts + organic verdict
  DIRECTIVE: "directive",           // operator-plane → agents (from headcorner only)
});

/* ── pure: message + op building ─────────────────────────────────────────── */

export function buildBusMessage({ from, to = "*", type, seq = 1, at, body }) {
  if (!from) throw new Error("bus-from-required");
  if (!type || !Object.values(BUS_TYPES).includes(type)) throw new Error(`bus-type-invalid(${type})`);
  const json = JSON.stringify(body ?? {});
  if (json.length > BUS_MAX_BODY) throw new Error(`bus-body-too-big(${json.length}>${BUS_MAX_BODY})`);
  return { v: 1, from, to: to || "*", type, seq: Number(seq) || 1, at: at ?? new Date().toISOString(), body };
}

export function busOp(account, msg) {
  return [["custom_json", { required_auths: [], required_posting_auths: [account], id: BUS_ID, json: JSON.stringify(msg) }]];
}

/* ── pure: parsing + inbox filtering ─────────────────────────────────────── */

export function parseBusEntry(entry) {
  try {
    const [idx, raw] = entry;
    const op = raw?.op;
    if (!Array.isArray(op) || op[0] !== "custom_json" || op[1]?.id !== BUS_ID) return null;
    const msg = JSON.parse(op[1].json);
    if (!msg || msg.v !== 1 || !msg.from || !Object.values(BUS_TYPES).includes(msg.type)) return null;
    return { block: raw.block ?? null, idx: Number(idx), ...msg };
  } catch { return null; }
}

export function filterInbox(messages, me) {
  return messages.filter((m) => m && (m.to === me || m.to === "*") && m.from !== me);
}

export function busRateLimit(state, nowMs, { maxPerCycle = BUS_MAX_PER_CYCLE, minGapMs = BUS_MIN_GAP_MS } = {}) {
  const sent = Array.isArray(state?.sentAt) ? state.sentAt : [];
  const inCycle = sent.filter((t) => nowMs - Number(t) < minGapMs);
  if (inCycle.length >= 1 && sent.length && nowMs - Number(sent[sent.length - 1]) < minGapMs) {
    return { allow: false, reason: "min-gap" };
  }
  const inWindow = sent.filter((t) => nowMs - Number(t) < 3600000);
  if (inWindow.length >= maxPerCycle * 2) return { allow: false, reason: "hour-cap" };
  return { allow: true, inWindow: inWindow.length };
}

/* ── pure: delivery to handlers (the "agents talking" law) ───────────────── */

/* handlers: { [type]: (msg, ctx) => {handled, note} } — unknown types are
 * stored but never crash delivery (fail-soft inbox) */
export function deliverInbox(messages, handlers, ctx = {}) {
  const out = { delivered: [], unknown: [], handled: 0 };
  for (const m of messages) {
    const h = handlers?.[m.type];
    if (typeof h === "function") {
      try {
        const r = h(m, ctx);
        out.delivered.push({ type: m.type, from: m.from, note: r?.note ?? null });
        out.handled++;
      } catch (e) {
        out.delivered.push({ type: m.type, from: m.from, note: `handler-error:${String(e).slice(0, 60)}` });
      }
    } else {
      out.unknown.push({ type: m.type, from: m.from });
    }
  }
  return out;
}

/* ── io: chain history scan (same pagination law as chain-anchor-probe) ──── */

async function rpc(node, method, params, timeoutMs = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(node, {
      method: "POST", headers: { "content-type": "application/json" }, signal: ac.signal,
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message ?? "rpc-error");
    return j.result;
  } finally { clearTimeout(t); }
}

export async function busHistory({ account = "headcorner", window = WINDOW, maxPages = MAX_PAGES, node = null } = {}) {
  const nodes = node ? [node, ...RPC_NODES.filter((n) => n !== node)] : RPC_NODES;
  let lastErr = null;
  for (const n of nodes) {
    try {
      const msgs = [];
      let start = -1;
      for (let p = 0; p < maxPages; p++) {
        const hist = await rpc(n, "condenser_api.get_account_history", [account, start, PAGE]);
        if (!Array.isArray(hist) || !hist.length) break;
        let minIdx = Infinity;
        for (const entry of hist) {
          minIdx = Math.min(minIdx, entry[0]);
          const m = parseBusEntry(entry);
          if (m) msgs.push(m);
        }
        if (minIdx <= 1) break;
        start = minIdx - 1;
        const span = Number(hist[hist.length - 1][0]) - minIdx;
        if (span >= window) break;
      }
      msgs.sort((a, b) => (a.block ?? 0) - (b.block ?? 0) || a.idx - b.idx);
      return { node: n, messages: msgs };
    } catch (e) { lastErr = e; }
  }
  throw new Error(`bus-history-failed: ${String(lastErr).slice(0, 120)}`);
}

/* ── io: publish through the signer's custody gate (thinkGate + executeAs) ─ */

export async function busPublish({ account, from, to = "*", type, seq = 1, body, signer = null }) {
  /* late import to keep the pure halves dependency-free for selftest */
  const { thinkGate, executeAs } = await import("./signer.mjs");
  const msg = buildBusMessage({ from, to, type, seq, body });
  const ops = busOp(account, msg);
  const gate = thinkGate(account, ops, { source: `bus:${type}` });
  if (gate?.verdict !== "ALLOW") return { ok: false, verdict: gate?.verdict ?? "GATE-REFUSED", reasons: gate?.reasons ?? [] };
  const r = await executeAs(account, ops, { tag: `bus-${type}`, role: "posting", ...(signer ? {} : {}) });
  return { ok: !!r?.ok, txid: r?.txid ?? null, verdict: r?.ok ? "BUS-SENT" : (r?.verdict ?? "BROADCAST-FAIL"), msg };
}

/* ── io: the cycle-level mailbox (T-88) — serve inbox, publish receipt ────── */

import fs from "node:fs";
import path from "node:path";

const BUS_DIR = path.dirname(new URL(import.meta.url).pathname);
const BUS_STATE_FILE = path.join(BUS_DIR, "state", "bus.json");

function loadBusState() {
  try { return JSON.parse(fs.readFileSync(BUS_STATE_FILE, "utf8")); } catch { return { sentAt: [], receipts: [] }; }
}
function saveBusState(s) {
  fs.mkdirSync(path.dirname(BUS_STATE_FILE), { recursive: true });
  const t = `${BUS_STATE_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(t, JSON.stringify(s, null, 1));
  fs.renameSync(t, BUS_STATE_FILE);
}
function appendBusEvent(v) {
  try {
    const f = path.join(BUS_DIR, "state", "events.jsonl");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify(v) + "\n");
  } catch { /* fail-soft */ }
}

/* every daily-cycle invocation: (1) deliver the inbox to the standard
 * handlers, (2) publish ONE custody-gated cycle receipt (rate-limited). */
export async function runBus({ now = new Date().toISOString(), cycleReport = null, account = "headcorner" } = {}) {
  const t0 = Date.now();
  const state = loadBusState();
  const save = () => saveBusState(state);

  /* 1 · INBOX — the chain is the mail server */
  let inbox = { scanned: 0, delivered: 0, unknown: 0, node: null, error: null };
  try {
    const hist = await busHistory({ account });
    const handlers = standardHandlers({ state, save });
    const deliver = deliverInbox(filterInbox(hist.messages, account), handlers, { now });
    inbox = { node: hist.node, scanned: hist.messages.length, delivered: deliver.handled, unknown: deliver.unknown.length };
    if (deliver.handled || deliver.unknown.length) appendBusEvent({ type: "bus.inbox", at: now, ...inbox });
  } catch (e) {
    inbox.error = String(e).slice(0, 120);
  }

  /* 2 · RECEIPT — custody-gated + rate-limited (no credential = honest 0) */
  let published = 0;
  let verdict = "BUS-INBOX-ONLY";
  const rl = busRateLimit(state, Date.now());
  if (rl.allow) {
    let head = null;
    try { head = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], { cwd: path.join(BUS_DIR, "..", ".."), encoding: "utf8" }).trim(); } catch {}
    try {
      const r = await busPublish({ account, from: account, type: BUS_TYPES.CYCLE_RECEIPT, seq: (state.seq ?? 0) + 1, body: { ok: !!cycleReport?.ok, health: cycleReport?.health ?? null, head, runner: "engine" } });
      if (r.ok) {
        published++;
        state.seq = (state.seq ?? 0) + 1;
        state.sentAt = [...(state.sentAt ?? []), Date.now()].slice(-40);
        verdict = "BUS-LIVE";
        appendBusEvent({ type: "bus.sent", at: now, kind: BUS_TYPES.CYCLE_RECEIPT, txid: r.txid ?? null });
      } else {
        verdict = `BUS-GATED:${String(r.verdict).slice(0, 40)}`;
      }
    } catch (e) {
      verdict = `BUS-ERROR:${String(e).slice(0, 60)}`;
    }
  } else {
    verdict = `BUS-RATE-LIMITED:${rl.reason}`;
  }
  save();

  return { verdict, delivered: inbox.delivered, published, inbox, ms: Date.now() - t0 };
}

/* built-in handlers — the standard inbox the engine serves every cycle */
export function standardHandlers({ state = {}, save = () => {} } = {}) {
  return {
    [BUS_TYPES.QUALITY_THRESHOLD]: (m) => {
      const b = m.body ?? {};
      state.qualityThreshold = { minPostChars: Number(b.minPostChars) || null, verdict: b.verdict ?? null, at: m.at, from: m.from };
      save();
      return { handled: true, note: `quality->${b.verdict ?? "?"}` };
    },
    [BUS_TYPES.CUSTODY_STATUS]: (m) => {
      state.lastCustodyStatus = { verified: Number(m.body?.verified ?? 0), at: m.at, from: m.from };
      save();
      return { handled: true, note: "custody" };
    },
    [BUS_TYPES.CYCLE_RECEIPT]: (m) => {
      state.receipts = [ ...(state.receipts ?? []), { from: m.from, at: m.at, ok: !!m.body?.ok, head: m.body?.head ?? null } ].slice(-20);
      save();
      return { handled: true, note: "receipt" };
    },
    [BUS_TYPES.PUBLISH_VERDICT]: (m) => {
      state.publishVerdicts = [ ...(state.publishVerdicts ?? []), { from: m.from, at: m.at, ...(m.body ?? {}) } ].slice(-20);
      save();
      return { handled: true, note: "publish" };
    },
    [BUS_TYPES.ANCHOR_RECEIPT]: (m) => {
      state.lastAnchor = { from: m.from, at: m.at, txid: m.body?.txid ?? null, tip: m.body?.tip ?? null };
      save();
      return { handled: true, note: "anchor" };
    },
  };
}
