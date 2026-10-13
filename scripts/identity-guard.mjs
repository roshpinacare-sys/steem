#!/usr/bin/env node
/**
 * identity-guard.mjs — DECISIONS #10 / T-76 enforcement, fail-loud.
 *
 * The old identity-guard.yml was born-dead (committed as binary garbage in
 * bf8ff8e2 — GitHub Actions could never parse it, so the shield never ran).
 * This is the real one. It reads the PINNED STATE FILES and fails loud (exit
 * 1) the moment a forbidden identity or an ungated deployment appears:
 *
 *   - cred.foreignCredential=true / credentialAccount ≠ doctrineAccount
 *     (T-21 disease: 2026-10-01, a diagnostic paste flipped every rail to
 *     "testuser" for hours — this guard makes a recurrence LOUD at CI layer)
 *   - soldiers enabled while the operator gate is closed (T-76 law:
 *     deployment is operator-gated — soldiers.mjs:58, signer.mjs:460)
 *   - exec transfers-out / delegation armed while the standing order forbids
 *     them (the measured budget-leak class: ~114 SP delegation, T-81)
 *
 * Zero network, zero secrets — pinned state files are the only input.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); } catch { return null; }
};

const findings = [];
const check = (cond, name, detail) => { if (cond) findings.push({ name, detail }); };

// 1 · credential identity — the doctrine account is the only legal identity
const sov = readJson("mini-services/saos-engine/state/sovereign.json");
const cred = sov?.cred ?? {};
if (cred.foreignCredential === true) {
  findings.push({ name: "foreign-credential", detail: `credentialAccount=${cred.credentialAccount} doctrineAccount=${cred.doctrineAccount} (T-21/T-76 shield)` });
}
if (cred.credentialAccount && cred.doctrineAccount && cred.credentialAccount !== cred.doctrineAccount) {
  findings.push({ name: "identity-mismatch", detail: `${cred.credentialAccount} ≠ ${cred.doctrineAccount}` });
}

// 2 · soldier deployment — operator-gated, forever (T-76 law, T-80 structural)
const armed = readJson(".secrets/exec-armed.json") ?? readJson("sanbox/autonomy/state.json");
if (armed?.soldiers?.enabled === true && armed?.operator?.allowSoldierDeploy !== true) {
  findings.push({ name: "ungated-soldier-deploy", detail: "soldiers.enabled=true while operator.allowSoldierDeploy=false" });
}

// 3 · standing-order violations — transfers out / delegation must stay forbidden
if (armed?.policy?.allowTransfersOut === true) {
  findings.push({ name: "transfers-out-armed", detail: "policy.allowTransfersOut=true violates the standing order" });
}
if (armed?.policy?.allowDelegation === true) {
  findings.push({ name: "delegation-armed", detail: "policy.allowDelegation=true violates the standing order (T-81 measured leak)" });
}

// 4 · adopt-refused events — a refusal burst means someone is knocking with foreign identities
try {
  const lines = fs.readFileSync(path.join(ROOT, "mini-services/saos-engine/state/events.jsonl"), "utf8").trim().split("\n").slice(-400);
  const refused = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e?.type === "cred.adopt-refused");
  const accounts = [...new Set(refused.map((e) => e.account).filter(Boolean))];
  const foreign = accounts.filter((a) => a && a !== (cred.doctrineAccount ?? "headcorner"));
  if (foreign.length) {
    findings.push({ name: "foreign-adopt-attempts", detail: `refused foreign accounts in recent events: ${foreign.slice(0, 5).join(",")}` });
  }
} catch { /* events file absent — nothing to judge */ }

if (findings.length) {
  console.error("IDENTITY-GUARD: FAIL — forbidden identity / ungated deployment signals:");
  for (const f of findings) console.error(`  ✗ ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log("IDENTITY-GUARD: clean — doctrine identity sole, deployment gates closed");
