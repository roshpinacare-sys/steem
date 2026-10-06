#!/usr/bin/env bun
/**
 * export-erc8004-registry — גשר-הסטנדרטים של THE WEAVE (r179)
 *
 * עקרון: "לדבר-סטנדרט" — אקונומיות-סוכני-ה-AI על-EVM התגבשו-סביב
 * ERC-8004 "Trustless Agents" (Identity/Reputation/Validation — 8004scan.io,
 * arXiv-2026). יש-לנו-את-כל-הרכיבים-הקריפטוגרפיים-מאחורי-הסטנדרט-מהיום-הראשון:
 * 13-סוכנים-עם-זהויות-מחזור-חיים (ethAddress + pubKey) · 1,251-אישורים-חתומים
 * (EIP-712 + hash-chain) · 1,241-checkpoints עם-Merkle-roots-עגונים-על-שרשראות-חוץ.
 * מה-שאין-לאף-שחקן-אחר: האמת-שאנחנו-מאמתים-חיה-באפס-דלק-על-Steem/Hive/Zero-EVM.
 *
 * הפלט אינו-עסקה-על-השרשרת — הוא-רישום-מטא-דאטה-במבנה-ERC-8004 (agentURI
 * metadata): קריא, מאומת-מחדש, ומוכן-להצמדה-ל-onchain-registry-כשנחליט-על-רשת
 * יעד (Base-Stage-1 — המועמדת-הראשונה-לפי-המחקר-r179-a). אפס-סודות: רק
 * מידע-ציבורי-מה-ledger.
 *
 * Usage: bun scripts/export-erc8004-registry.mjs
 * Output: sovereign/agents/erc8004-registry.json
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";

const LEDGER = "sovereign/ledger.json";
const OUT = "sovereign/agents/erc8004-registry.json";

const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
const at = new Date().toISOString();

// ERC-8004 agentURI metadata shape (best-practices.8004scan.io):
// type/name/description/registrations עם-domain-id תואם-CAIP-2-ish.
// אנחנו-מרחיבים-בכנות עם "x-weave" — הראיות-שלנו-הן-שכבת-ה-reputation.
const agents = ledger.agents.map((a) => {
  const atts = ledger.attestations.filter((x) => x.agentId === a.id).length;
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#identity-registry-metadata",
    name: a.name,
    description: `THE WEAVE sovereign agent — role ${a.role}. Signs hash-chain attestations (EIP-712) over the weave ledger; ${atts} attestations on record.`,
    registrations: [
      ...(a.ethAddress
        ? [{ domain: "eip155:9369", identifier: a.ethAddress }] // Zero rail (zero-gas EVM) — rail zero-9369
        : []),
      { domain: "x-weave:hash-chain", identifier: a.id },
    ],
    supportsTrustlessAgents: {
      identity: true,
      reputation: "x-weave:attestations", // 1,251 signed attestations = our reputation layer
      validation: "x-weave:checkpoint-anchors", // Merkle roots anchored on-chain
    },
    x_weave: {
      role: a.role,
      status: a.status,
      pubKeyHex: a.pubKeyHex,
      nonce: a.nonce,
      createdAt: a.createdAt,
      attestationsCount: atts,
    },
  };
});

const registry = {
  schema: "weave-erc8004-registry-v1",
  at,
  standard: "ERC-8004 (Trustless Agents) — metadata export, not an onchain tx",
  networkWitnesses: [
    { chain: "steem", role: "checkpoint roots as custom_json (posting auth)" },
    { chain: "hive", role: "planned — blocked on posting WIF (honest gap, r179)" },
    { chain: "eip155:9369", role: "checkpoint+attestation anchors, zero-gas, nonce 658+" },
  ],
  counters: {
    agents: ledger.agents.length,
    attestations: ledger.attestations.length,
    checkpoints: ledger.checkpoints.length,
    chainCount: ledger.chainCount,
  },
  agents,
  notes: [
    "מקור-אמת: sovereign/ledger.json (חתום-ב-hash-chain) — הקובץ-הזה-הוא-תצפית-תואמת-סטנדרט, לא-הצהרה",
    "מחקר-r179-a: https://www.quicknode.com · https://best-practices.8004scan.io · arXiv-SoK-2026",
    "אפס-סודות: רק-מידע-ציבורי — pubKey-וכתובות, בלי-WIF-ובלי-מפתחות-פרטיים",
  ],
};

mkdirSync("sovereign/agents", { recursive: true });
writeFileSync(`${OUT}.tmp`, JSON.stringify(registry, null, 2) + "\n");
renameSync(`${OUT}.tmp`, OUT); // R107b — אטומי: הקוראים-לא-יראו-שבר-JSON
console.log(`erc8004-registry: ${ledger.agents.length} agents · ${ledger.attestations.length} attestations · ${ledger.checkpoints.length} checkpoints → ${OUT}`);
