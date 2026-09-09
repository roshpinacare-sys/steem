#!/usr/bin/env node
/**
 * keys-access.cjs — Task 29-b: THE smart multi-agent key-access infrastructure.
 * =============================================================================
 * ANY agent, in ANY chat session, in ANY folder, works with the fleet keys
 * through THIS tool only. The private keys themselves live in ONE sealed
 * envelope (SAOS-FLEET-VAULT-1) held by the external-signer process (:3033) —
 * agents never see, read, copy or move key material. Ever.
 *
 * Usage:
 *   node keys-access.cjs status              # which keys are live-matched (public data only)
 *   node keys-access.cjs health              # signer liveness + capabilities
 *   node keys-access.cjs sign '<json>'       # request a signed+broadcast op via the signer
 *                                            # e.g. {"requestId":"t29-1","network":"HIVE","kind":"transfer_to_vesting","account":"headcorner","amount":9.682}
 *   node keys-access.cjs ping                # process liveness
 *
 * IRON RULES (mirrored from AGENTS.md + owner keys-directive 2026-09-08/09):
 *   1. NEVER read/write/print/copy any key file (.env, keys/*, fleet_keys.enc contents).
 *   2. The ONLY key material this tool ever handles is its own Bearer token
 *      (~/.secrets/external-signer-token) — and it is never echoed.
 *   3. NEVER paste keys into chat, logs, code or tickets. The owner connects
 *      keys ONLY via the control screen (Security tab → מפתח-בעלים).
 *   4. Every op passes the signer's gates: live-authority match, RC feasibility,
 *      hard amount bounds, allowlist. Refusals are honest — fix the cause,
 *      never bypass the gate.
 *   5. Zero secret values in any output: this tool prints verdicts, txids,
 *      account names and PUBLIC keys only.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const SIGNER_URL = process.env.SAOS_SIGNER_URL || "http://127.0.0.1:3033";
const TOKEN_PATH = path.join(os.homedir(), ".secrets", "external-signer-token");

function token() {
  try {
    return fs.readFileSync(TOKEN_PATH, "utf8").trim();
  } catch {
    console.error("FAIL-CLOSED: signer token not found at ~/.secrets/external-signer-token (never inline it).");
    process.exit(2);
  }
}

async function call(pathname, method, body) {
  const res = await fetch(SIGNER_URL + pathname, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer " + token() },
    body: body ? JSON.stringify(body) : undefined
  });
  let json;
  try { json = await res.json(); } catch { json = { ok: false, error: "non-JSON response" }; }
  return { status: res.status, json };
}

async function main() {
  const [, , cmd, arg] = process.argv;
  try {
    if (cmd === "ping") {
      const r = await fetch(SIGNER_URL + "/ping");
      console.log(JSON.stringify(await r.json()));
    } else if (cmd === "health") {
      const { status, json } = await call("/health", "GET");
      console.log(JSON.stringify(json));
      process.exitCode = status === 200 ? 0 : 1;
    } else if (cmd === "status") {
      const { json } = await call("/keys/status", "GET");
      if (!json.ok) { console.error("signer error:", json.error ?? "?"); process.exit(1); }
      console.log(`main account: ${json.main.account}  (vault sealed ${json.sealedAt}, signer v${json.version})`);
      for (const [net, roles] of Object.entries(json.main.networks ?? {})) {
        for (const [slot, s] of Object.entries(roles)) {
          const mark = s.loaded ? (s.match === true ? "LIVE-MATCH" : s.match === false ? "LOADED-BUT-STALE" : "UNVERIFIED") : "missing";
          console.log(`  ${net.padEnd(6)} ${slot.padEnd(8)} ${mark}${s.derived ? `  pubkey=${s.derived.slice(0, 16)}…` : ""}`);
        }
      }
      const fleet = json.fleet ?? [];
      const withActive = fleet.filter((f) => f.active?.loaded).length;
      const withPosting = fleet.filter((f) => f.posting?.loaded).length;
      console.log(`fleet: ${fleet.length} accounts (${withPosting} posting, ${withActive} active keys loaded)`);
    } else if (cmd === "sign") {
      if (!arg) { console.error('usage: keys-access.cjs sign \'{"requestId":"...","network":"HIVE","kind":"...",...}\''); process.exit(1); }
      let body;
      try { body = JSON.parse(arg); } catch { console.error("payload is not valid JSON"); process.exit(1); }
      if (!body.requestId) body.requestId = "keys-access-" + Date.now();
      const { status, json } = await call("/sign", "POST", body);
      console.log(JSON.stringify(json));
      process.exitCode = status === 200 && json.ok ? 0 : 1;
    } else {
      console.log('usage: node keys-access.cjs <status|health|sign|ping>');
      process.exit(1);
    }
  } catch (e) {
    console.error("signer-unreachable:", String(e?.message ?? e).slice(0, 160));
    process.exit(3);
  }
}

main();
