/**
 * ff-gate.mjs — W27-a · THE FIXEDFLOAT REAL-MONEY GATE (owner trace
 * 1a15c67385c253b5: "fixedfloat מסתבר שהטוקן pending מחכה לאימות על ידם
 * אז צריך לחכות שנקבל אישור ואז נוכל לקדם את זה").
 * ═══════════════════════════════════════════════════════════════════════
 * CONTEXT: the operator uploaded an API key pair that lived unidentified in
 * the integrations seal (honesty law: "label awaits the operator"). The
 * operator HAS now named it: FixedFloat. Measured live 2026-10-21: the key
 * authenticates but every method answers `code 501 Not have permission` —
 * exactly the PENDING-ACTIVATION state the operator described. The gate
 * waits for FixedFloat's verification; NO promote action before it flips.
 *
 * WHAT THIS MODULE DOES (and does NOT):
 *   - every 30 minutes, ONE gentle signed probe of POST /api/v2/getInfo
 *     (X-API-KEY + HMAC-SHA256 signature per FF API v2 convention);
 *   - records the status machine:
 *       PENDING-ACTIVATION (code 501 / not-have-permission) → keep waiting;
 *       ACTIVE             (any permitted response)          → gate opens:
 *          events line + state flip. THE PROMOTE PLAN (recorded, requires
 *          the operator's word or the standing autonomy law to execute):
 *          probe get Emergencies/currencies → measure FF's supported pairs →
 *          size the first real-money conversion within treasury caps →
 *          the SBD/STEEM treasury starts its path to REAL BTC.
 *   - NEVER logs or stores the key/secret anywhere outside the vault;
 *   - never retries aggressively (30min cadence is the politeness law);
 *   - ABSTAIN honesty: any unexpected answer is recorded verbatim and the
 *     status machine does NOT guess.
 *
 * KEY SOURCE LAW (R322 vault): the pair lives ONLY in the integrations seal
 * (operator-named "fixedfloat"). No plaintext in state, no plaintext in git.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const GATE_FILE = path.join(STATE, "ff-gate.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");

/* vault paths — the ONLY secret sources (R322) */
const SECRETS_DIR = path.join(DIR, "..", "..", ".secrets");
const INTEGRATIONS_FILE = path.join(SECRETS_DIR, "integrations.json");
const VAULT_INTEGRATIONS_FILE = "/home/z/.secrets-sovereign/integrations.json";

const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { try { fs.appendFileSync(p, JSON.stringify(v) + "\n"); } catch { /* best-effort */ } };

export const FF_GATE_DEFAULTS = {
  cadenceSec: 1800,      // one probe per 30 min — the politeness law
  timeoutMs: 12000,
  endpoint: "https://fixedfloat.com/api/v2/getInfo",
};

/* the operator's naming (trace 1a15c67385c253b5, verbatim evidence) — the
 * unknown pair in the integrations seal is the FixedFloat credential */
const FF_LABEL = "fixedfloat";

function readFixedFloatPair() {
  const candidates = [INTEGRATIONS_FILE, VAULT_INTEGRATIONS_FILE];
  for (const f of candidates) {
    try {
      const d = JSON.parse(fs.readFileSync(f, "utf8"));
      const items = Array.isArray(d?.items) ? d.items : [];
      const it = items.find((i) => i?.id === FF_LABEL || i?.env === "SAOS_FIXEDFLOAT_ID" || i?.env === "SAOS_UNKNOWN_ID");
      if (it?.token) return { id: String(it.token), secret: String(items.find((x) => x?.id === "unknown-secret")?.token ?? it.secret ?? ""), src: path.basename(f) };
    } catch { /* try next */ }
  }
  /* env fallback (the seal wires both into the environment) */
  const id = process.env.SAOS_FIXEDFLOAT_ID || process.env.SAOS_UNKNOWN_ID;
  const secret = process.env.SAOS_FIXEDFLOAT_SECRET || process.env.SAOS_UNKNOWN_SECRET;
  if (id && secret) return { id, secret, src: "env" };
  return null;
}

/* FF API v2 convention: signature = HMAC-SHA256 of the url-encoded params
 * (empty params → HMAC of ""), sent alongside X-API-KEY. Exported for the
 * selftest's deterministic vectors (the secret itself never enters state). */
export function ffSig(secret, paramsObj) {
  const enc = Object.entries(paramsObj ?? {}).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return crypto.createHmac("sha256", secret).update(enc).digest("hex");
}

/* W27-a STATUS MACHINE — the one place that maps an FF API answer to a gate
 * state (pure, deterministic, selftest-covered): 501/not-have-permission is
 * the MEASURED pending signature; any permitted json body = ACTIVE; anything
 * else = UNEXPECTED (ABSTAIN — recorded verbatim, never guessed). */
export function classifyFfResponse({ code, msg, resOk, data }) {
  const c = String(code ?? "");
  const m = String(msg ?? "");
  if (c === "501" || /not have permission/i.test(m)) return "PENDING-ACTIVATION";
  if (resOk && data) return "ACTIVE";
  return "UNEXPECTED";
}

export function ffGateState() {
  try { return JSON.parse(fs.readFileSync(GATE_FILE, "utf8")); } catch { return { status: "NO-READ-YET", law: "owner: wait for FixedFloat verification, then promote" }; }
}

async function probe() {
  const now = new Date().toISOString();
  const pair = readFixedFloatPair();
  if (!pair) {
    return { status: "KEY-MISSING", at: now, note: "no fixedfloat pair in the vault strata — honest absence" };
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FF_GATE_DEFAULTS.timeoutMs);
  try {
    const sig = ffSig(pair.secret, {});
    const res = await fetch(FF_GATE_DEFAULTS.endpoint, {
      method: "POST",
      signal: ctl.signal,
      headers: { "X-API-KEY": pair.id, "Content-Type": "application/json" },
      body: JSON.stringify({ signature: sig }),
    });
    const j = await res.json().catch(() => null);
    const code = String(j?.code ?? res.status);
    const msg = String(j?.msg ?? j?.error ?? res.statusText ?? "").slice(0, 120);
    const status = classifyFfResponse({ code, msg, resOk: res.ok, data: j?.data });
    if (status === "PENDING-ACTIVATION") return { status, at: now, lastCode: code, lastMsg: msg };
    if (status === "ACTIVE") return { status, at: now, lastCode: code, lastMsg: msg, data: { tradeEnabled: !!j.data?.tradeEnabled, currencies: Array.isArray(j.data?.currencies) ? j.data.currencies.length : null } };
    return { status, at: now, lastCode: code, lastMsg: msg, note: "ABSTAIN — recorded verbatim, no guess" };
  } catch (e) {
    return { status: "PROBE-ERROR", at: now, lastMsg: String(e?.message ?? e).slice(0, 100) };
  } finally { clearTimeout(t); }
}

export async function tickGate() {
  const prev = ffGateState();
  const r = await probe();
  const st = {
    status: r.status,
    at: r.at,
    attempts: (prev.attempts ?? 0) + 1,
    lastCode: r.lastCode ?? null,
    lastMsg: r.lastMsg ?? null,
    data: r.data ?? null,
    since: prev.status === r.status ? (prev.since ?? r.at) : r.at,
    law: "PENDING-ACTIVATION → keep waiting (owner order); ACTIVE → promote plan armed (treasury caps, operator word/standing law)",
    keySource: "vault-seal (R322) — never logged",
  };
  if (prev.status !== r.status) {
    appendLine(EVENTS_FILE, { type: "ff-gate.status", at: r.at, from: prev.status ?? null, to: r.status, lastCode: st.lastCode ?? null });
  }
  writeJson(GATE_FILE, st);
  return st;
}

export function startFfGate() {
  const G = globalThis;
  if (G.__saosFfGateTimer) clearInterval(G.__saosFfGateTimer);
  G.__saosFfGateTimer = setInterval(() => { void tickGate(); }, FF_GATE_DEFAULTS.cadenceSec * 1000);
  void tickGate();
  return { started: true, startedAt: new Date().toISOString(), cadenceSec: FF_GATE_DEFAULTS.cadenceSec };
}
