#!/usr/bin/env node
/**
 * verify-receipt.mjs — standalone, dependency-free verifier for Qodo
 * Verifiable Autonomy Receipts (qodo.receipt/v1). Third parties can audit a
 * receipt WITHOUT installing anything: only node:crypto and node:fs are used,
 * and the checks are re-implemented here independently of the agent package.
 *
 *   node scripts/verify-receipt.mjs receipt.json \
 *     [--audit .audit-log.ndjson] [--key <hmac-key>] [--parent-receipt parent.json]
 *
 * --parent-receipt lets a verifier at hop N check this receipt's claimed
 * lineage against the PARENT receipt's actual bytes: the parent's sha256 is
 * recomputed here, independently, and compared against this receipt's
 * `lineage.parentReceiptSha256` / `lineage.genesis`. That hash also becomes
 * the genesis the audit-chain walk starts from, so a forged or substituted
 * parent receipt breaks BOTH the lineage check and the chain walk.
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 * Spec: docs/RECEIPTS.md
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const GENESIS = "0".repeat(64);
const GATE_KEYS = ["lockCheck", "blast", "dom", "shadow", "chaos", "test"];

function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys
    .filter((k) => v[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
    .join(",")}}`;
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const hmac = (key, s) => createHmac("sha256", key).update(s).digest("hex");

function auditEntryHash(e) {
  return sha256(JSON.stringify({
    seq: e.seq, timestamp: e.timestamp, event: e.event, actor: e.actor,
    payload: e.payload, prevHash: e.prevHash,
  }));
}

// ── args ──
const args = process.argv.slice(2);
const receiptPath = args.find((a) => !a.startsWith("--"));
if (!receiptPath) {
  console.error("usage: node scripts/verify-receipt.mjs <receipt.json> [--audit <ndjson>] [--key <hmac-key>]");
  process.exit(1);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : undefined;
};
const auditPath = flag("--audit");
const key = flag("--key") ?? process.env.QODO_RECEIPT_KEY;
const parentReceiptPath = flag("--parent-receipt");

const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
const parentReceipt = parentReceiptPath ? JSON.parse(readFileSync(parentReceiptPath, "utf8")) : undefined;
const checks = [];
const push = (name, ok, detail) => checks.push({ name, ok, detail });

// 1. schema
const schemaOk = receipt?.schema === "qodo.receipt/v1"
  && receipt.subject && receipt.run && receipt.controls && receipt.evidence
  && ["done", "halted", "failed"].includes(receipt.run?.outcome);
push("schema", !!schemaOk, schemaOk ? "qodo.receipt/v1" : `unexpected schema/shape (${receipt?.schema})`);

if (schemaOk) {
  // 2. gates consistency
  const g = receipt.controls.gates;
  if (g) {
    const verdicts = [...GATE_KEYS.map((k) => g[k]), ...(g.contractGuard === undefined ? [] : [g.contractGuard])];
    const allPass = verdicts.every(Boolean);
    push("gates-consistent", g.gateOpen === allPass,
      g.gateOpen === allPass ? `gateOpen=${g.gateOpen} matches verdicts` : `gateOpen=${g.gateOpen} but verdicts say ${allPass}`);
  } else {
    push("gates-consistent", true, "no gate phase reached");
  }

  // 3. budget consistency
  const b = receipt.controls.budget;
  const budgetOk = b.capCents == null || b.exceeded || b.spentCents <= b.capCents;
  push("budget-consistent", budgetOk,
    budgetOk ? (b.capCents == null ? "no cap set" : `spent ${b.spentCents}¢ within cap ${b.capCents}¢`)
      : `spent ${b.spentCents}¢ exceeds cap ${b.capCents}¢ without exceeded flag`);

  // 4. signature
  const { signature, ...body } = receipt;
  if (signature) {
    if (key) {
      const expected = hmac(key, sha256(canonicalJson(body)));
      const keyId = sha256(key).slice(0, 8);
      const ok = expected === signature.value && keyId === signature.keyId;
      push("signature", ok, ok ? `HMAC-SHA256 valid (key ${keyId})` : "signature does NOT match this key");
    } else {
      push("signature", true, `present (key ${signature.keyId}) — pass --key to check it`);
    }
  } else {
    push("signature", true, "unsigned — integrity rests on audit-chain anchoring");
  }

  // 5. lineage — recompute the parent's hash ourselves; never trust the
  // child receipt's say-so. Determines the genesis the chain walk uses.
  let effectiveGenesis = GENESIS;
  if (receipt.lineage) {
    effectiveGenesis = receipt.lineage.genesis;
    if (parentReceipt) {
      const parentHash = sha256(canonicalJson(parentReceipt));
      const ok = receipt.lineage.parentReceiptSha256 === parentHash && receipt.lineage.genesis === parentHash;
      push("lineage", ok,
        ok ? `hop ${receipt.lineage.hopIndex} anchored to parent receipt ${parentHash.slice(0, 8)}`
          : `lineage does not match recomputed parent hash ${parentHash.slice(0, 8)}`);
    } else {
      push("lineage", true, `hop ${receipt.lineage.hopIndex}, parent claimed — pass --parent-receipt to check it`);
    }
  } else if (parentReceipt) {
    push("lineage", false, "--parent-receipt given but this receipt carries no lineage block");
  }

  // 6. audit-chain anchoring
  if (auditPath) {
    const lines = readFileSync(auditPath, "utf8").trim().split("\n").filter(Boolean);
    let prev = effectiveGenesis;
    let broken = -1;
    const entries = [];
    for (const line of lines) {
      let e;
      try { e = JSON.parse(line); } catch { broken = entries.length; break; }
      if (e.prevHash !== prev || auditEntryHash(e) !== e.hash) { broken = e.seq; break; }
      prev = e.hash;
      entries.push(e);
    }
    push("audit-chain", broken === -1,
      broken === -1 ? `chain valid (${entries.length} entries)` : `chain broken at seq ${broken}`);

    if (broken === -1) {
      const head = receipt.evidence.auditHead;
      const at = entries.find((e) => e.seq === head.seq);
      const headOk = !!at && at.hash === head.hash;
      push("chain-head", headOk,
        headOk ? `receipt anchored at seq ${head.seq}` : `no entry at seq ${head.seq} with the recorded hash`);

      const selfHash = sha256(canonicalJson(receipt));
      const issued = entries.some((e) => e.event === "receipt-issued" && e.payload?.receiptSha256 === selfHash);
      push("receipt-issued", issued,
        issued ? "chain records this exact receipt (mutual anchoring)" : "no receipt-issued event carries this receipt's sha256");
    }
  }
}

for (const c of checks) console.log(`  ${c.ok ? "✓" : "✕"} ${c.name.padEnd(18)} ${c.detail}`);
const valid = checks.every((c) => c.ok);
console.log(valid ? "\nRECEIPT VALID ✓" : "\nRECEIPT INVALID ✕");
process.exit(valid ? 0 : 1);
