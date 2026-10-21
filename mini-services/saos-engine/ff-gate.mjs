/**
 * ff-gate.mjs — W27-a · THE FIXEDFLOAT REAL-MONEY GATE
 * ═══════════════════════════════════════════════════════════════════════
 * W120 FIX (measured 2026-10-21, owner trace web-39a3a21d "חמש הכל תפעיל
 * הכל למה לא אני מאשר קדימה"): the previous probe sent `signature` inside a
 * JSON body WITHOUT the X-API-SIGN header — the measured W117 lesson (my-project
 * console rail, w117.0 GREEN) proves the real v2 convention is:
 *     X-API-SIGN = HMAC-SHA256(api_secret, exact_request_body_string)
 * sent as a HEADER, transport = curl (Cloudflare WAF blocks undici/bun-fetch
 * against ff.io — measured twice, G42 + w117). The old probe therefore read a
 * PERMANENT 501 "Not have permission" while the console rail measured code:0
 * with the SAME key — a false PENDING-ACTIVATION that hid an OPEN gate.
 *
 * CREDENTIAL SOURCE LAW (strata, first hit wins — never logged, fingerprints only):
 *   1. /home/z/.secrets/fixedfloat.env  (host vault 0600 — da2568bd…, measured
 *      LIVE code:0 via the console rail 2026-10-21 04:49Z)
 *   2. repo integrations seal (unknown-id stratum)
 *   3. env SAOS_FIXEDFLOAT_*
 *
 * STATUS MACHINE (pure, deterministic, selftest-covered):
 *   code 0                      → ACTIVE (gate opens; dust caps stay armed)
 *   code 501 / not-have-perm    → PENDING-ACTIVATION (their dashboard, not ours)
 *   code 401 / auth-reject      → KEY-REJECTED (fail-closed, no retry storm)
 *   anything else               → UNEXPECTED (ABSTAIN — recorded verbatim)
 *
 * W120 PROMOTION LAW (owner word, recorded): on ACTIVE the promote plan is
 * ARMED within the standing dust license (state/fixedfloat-policy.json in
 * my-project: ≤$1/order, ≤3/day, destination-whitelist = the sovereign TRON
 * wallet) — internal treasury law; anything above the dust caps still routes
 * to the operator by the escalation clause. No key material ever leaves the
 * vault strata; logs carry fingerprints only.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const GATE_FILE = path.join(STATE, "ff-gate.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");

/* vault strata — the ONLY secret sources (R322), first hit wins */
const HOST_VAULT = "/home/z/.secrets/fixedfloat.env";
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
  timeoutMs: 20000,
  endpoint: "https://ff.io/api/v2/ccies",
};

function fromEnvVault() {
  try {
    if (!fs.existsSync(HOST_VAULT)) return null;
    const t = fs.readFileSync(HOST_VAULT, "utf8");
    const key = (t.match(/^FIXEDFLOAT_API_KEY=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
    const secret = (t.match(/^FIXEDFLOAT_API_SECRET=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
    if (key && secret) return { id: key, secret, src: "host-vault-0600" };
  } catch { /* next stratum */ }
  return null;
}

function fromIntegrationsSeal() {
  for (const f of [INTEGRATIONS_FILE, VAULT_INTEGRATIONS_FILE]) {
    try {
      const d = JSON.parse(fs.readFileSync(f, "utf8"));
      const items = Array.isArray(d?.items) ? d.items : [];
      const it = items.find((i) => i?.id === "fixedfloat" || i?.env === "SAOS_FIXEDFLOAT_ID" || i?.env === "SAOS_UNKNOWN_ID");
      if (it?.token) {
        const secret = String(items.find((x) => x?.id === "unknown-secret" || x?.env === "SAOS_FIXEDFLOAT_SECRET")?.token ?? it.secret ?? "");
        if (secret) return { id: String(it.token), secret, src: path.basename(f) };
      }
    } catch { /* try next */ }
  }
  return null;
}

function fromEnv() {
  const id = process.env.SAOS_FIXEDFLOAT_ID || process.env.FIXEDFLOAT_API_KEY;
  const secret = process.env.SAOS_FIXEDFLOAT_SECRET || process.env.FIXEDFLOAT_API_SECRET;
  if (id && secret) return { id, secret, src: "env" };
  return null;
}

function readFixedFloatPair() {
  return fromEnvVault() || fromIntegrationsSeal() || fromEnv();
}

/* FF API v2 convention (measured, w117): signature = HMAC-SHA256 of the EXACT
 * request body string, in the X-API-SIGN header. Exported for the selftest's
 * deterministic vectors (the secret itself never enters state). */
export function ffSig(secret, bodyStr) {
  return crypto.createHmac("sha256", secret).update(bodyStr ?? "").digest("hex");
}

/* W120 STATUS MACHINE — 501/not-have-permission is the MEASURED pending
 * signature (their dashboard has not enabled the key); code 0 = ACTIVE;
 * 401 = key rejected; anything else = UNEXPECTED (ABSTAIN, never guessed). */
export function classifyFfResponse({ code, msg, resOk, data }) {
  const c = String(code ?? "");
  const m = String(msg ?? "");
  if (c === "501" || /not have permission/i.test(m)) return "PENDING-ACTIVATION";
  if (c === "0" && resOk && data) return "ACTIVE";
  if (c === "401" || /api key (is )?invalid|unauthorized/i.test(m)) return "KEY-REJECTED";
  return "UNEXPECTED";
}

export function ffGateState() {
  try { return JSON.parse(fs.readFileSync(GATE_FILE, "utf8")); } catch { return { status: "NO-READ-YET", law: "owner W120: gate armed on ACTIVE within the dust license" }; }
}

/* curl transport — the measured-proven rail (WAF blocks bun-fetch/undici).
 * Zero echo: headers are passed via execFile argv (never logged), the secret
 * never appears in any output — fingerprints only. */
async function probe() {
  const now = new Date().toISOString();
  const pair = readFixedFloatPair();
  if (!pair) {
    return { status: "KEY-MISSING", at: now, note: "no fixedfloat pair in any vault stratum — honest absence" };
  }
  const bodyStr = "";
  const sign = ffSig(pair.secret, bodyStr);
  const args = [
    "-s", "--max-time", String(Math.ceil(FF_GATE_DEFAULTS.timeoutMs / 1000)),
    "-X", "POST", FF_GATE_DEFAULTS.endpoint,
    "-H", `X-API-KEY: ${pair.id}`,
    "-H", `X-API-SIGN: ${sign}`,
    "-H", "Content-Type: application/json",
  ];
  if (bodyStr) args.push("-d", bodyStr);
  try {
    const { stdout } = await execFileP("curl", args, { timeout: FF_GATE_DEFAULTS.timeoutMs + 5000, maxBuffer: 4 * 1024 * 1024 });
    let j = null;
    try { j = JSON.parse(stdout); } catch { /* WAF/HTML */ }
    if (!j) {
      const html = stdout.startsWith("<!");
      return { status: "WAF-BLOCKED", at: now, lastMsg: html ? "html-waf-page" : "unparseable-response", note: "transport measured: curl is the proven rail; retry next cadence" };
    }
    const code = String(j?.code ?? "");
    const msg = String(j?.msg ?? j?.error ?? "").slice(0, 120);
    const status = classifyFfResponse({ code, msg, resOk: code === "0", data: j?.data });
    if (status === "ACTIVE") {
      return {
        status, at: now, lastCode: code, lastMsg: msg,
        data: { currencies: Array.isArray(j.data) ? j.data.length : null, keySource: pair.src },
        promotedBy: "owner W120 approval (2026-10-21): dust license ARMED — ≤$1/order, ≤3/day, destination-whitelist (sovereign TRON wallet)",
      };
    }
    if (status === "PENDING-ACTIVATION") return { status, at: now, lastCode: code, lastMsg: msg };
    if (status === "KEY-REJECTED") return { status, at: now, lastCode: code, lastMsg: msg, note: "fail-closed: no retry storm, next probe on cadence" };
    return { status, at: now, lastCode: code, lastMsg: msg, note: "ABSTAIN — recorded verbatim, no guess" };
  } catch (e) {
    return { status: "PROBE-ERROR", at: now, lastMsg: String(e?.message ?? e).slice(0, 100) };
  }
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
    promotedBy: r.promotedBy ?? null,
    note: r.note ?? null,
    since: prev.status === r.status ? (prev.since ?? r.at) : r.at,
    law: "W120 owner word: ACTIVE → promote plan ARMED within the dust license (≤$1 · ≤3/day · whitelist TRON-sovereign); above dust → operator escalation clause",
    keySource: "vault strata (R322) — never logged",
  };
  if (prev.status !== r.status) {
    appendLine(EVENTS_FILE, { type: "ff-gate.status", at: r.at, from: prev.status ?? null, to: r.status, lastCode: st.lastCode ?? null, promotedBy: st.promotedBy ?? null });
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
