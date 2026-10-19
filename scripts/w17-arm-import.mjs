/**
 * w17-arm-import.mjs — W17 · THE IMPORT RAIL ARM (חימוש-מסילת-הייבוא).
 *
 * Records the operator order (state/operator-orders.json) and arms the live
 * flag (.secrets/exec-armed.json policy.exchangeImport) — the two-key
 * doctrine: both must agree or exchange-import.mjs stays PLAN-ONLY.
 * Zero secrets written anywhere.
 *
 * THE ORDER (owner IM 2026-10-19, trace 1a1556c780544431, verbatim core):
 * "תעשה פעילות דרך steem sbd עמלות משיכה די נמוכות שם אפשר להשתמש בזה חשוב
 * להעביר רק מטבעות אלו בנתיים הייתי רוצה להכניס יותר מטבעות לרשת שלנו אבל
 * אני מפחד מעמלות גבוהות קודם נראה שאנחנו עובדים טוב עם זה" + "תכניס אותו
 * נכון למערכת תפעיל הכל ודחוף".
 *
 * Usage: node scripts/w17-arm-import.mjs [--disarm]
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..");
const ORDERS = path.join(REPO, "mini-services", "saos-engine", "state", "operator-orders.json");
const FLAG = path.join(REPO, ".secrets", "exec-armed.json");
const DISARM = process.argv.includes("--disarm");
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const orders = JSON.parse(fs.readFileSync(ORDERS, "utf8"));
if (!orders.orders["W17-STEEM-SBD-IMPORT"]) {
  orders.orders["W17-STEEM-SBD-IMPORT"] = {
    armed: true,
    op: "exchange-withdraw-import",
    direction: "htx-to-headcorner-only",
    verbatim: "תעשה פעילות דרך steem sbd עמלות משיכה די נמוכות שם אפשר להשתמש בזה חשוב להעביר רק מטבעות אלו בנתיים",
    orderRef:
      "owner IM 2026-10-19 trace 1a1556c780544431 — STEEM/SBD as THE import channel (withdrawal-cheap coins), " +
      "transfer scope limited to these two coins until the operator orders otherwise; + same message: " +
      "״הייתי רוצה להכניס יותר מטבעות לרשת שלנו אבל אני מפחד מעמלות גבוהות קודם נראה שאנחנו עובדים טוב עם זה״ " +
      "+ ״תכניס אותו נכון למערכת תפעיל הכל ודחוף״ + operator standing order 2026-09-29 (full autonomous execution, doctrine-capped)",
    scope: {
      coins: ["sbd", "steem"],
      chains: { sbd: "sbd1", steem: "steem1" },
      destination: "headcorner",
      maxWithdrawsPerDay: 12,
      minNetUsdt: 0.02,
      feeBufferPct: 0.1,
      exchangeAccount: "73986225",
      keysCustody: "agent/vault/EXCHANGE-SEAL-20261019T185046Z.zip.enc (W17 rotation re-seal, meta.exchangeVault self-contained)",
      flowsGate: "G27/G28 — POST /api/sovereign/flows (venue HTX, kind transfer) → ext-deposit · routing 25% pool / 75% vault",
    },
    reversibility:
      "withdrawal to our OWN network account (headcorner) — chain-irreversible once broadcast but destination is the fleet treasury itself; " +
      "caps bound frequency and dust; the venue's L3/region gates are measured and recorded honestly (nothing is guessed, nothing is stranded)",
    measuredGates: {
      keyPair: "NEW rotated pair LIVE (SIGNED-PROOF-OK, W17 census)",
      withdrawPermission: "PRESENT (quota endpoint, steem+sbd)",
      accountTier: "L3 Advanced Verification REQUIRED for execution (owner console action) — measured legacy api-base-operation-forbidden / v2 404",
      tradeLeg: "REGION-BLOCKED for our network class (order-trade-forbidden, re-measured W17) — no trading armed",
    },
    createdAt: now(),
  };
} else {
  console.log("W17-STEEM-SBD-IMPORT order already on record — preserving");
}
fs.writeFileSync(ORDERS, JSON.stringify(orders, null, 2) + "\n");

/* live flag */
const flag = JSON.parse(fs.readFileSync(FLAG, "utf8"));
flag.policy.exchangeImport = {
  enabled: !DISARM,
  coins: ["sbd", "steem"],
  destination: "headcorner",
  maxWithdrawsPerDay: 12,
  minNetUsdt: 0.02,
  armedAt: DISARM ? flag.policy.exchangeImport?.armedAt ?? now() : now(),
  orderRef: "W17-STEEM-SBD-IMPORT (state/operator-orders.json)",
};
fs.writeFileSync(FLAG, JSON.stringify(flag, null, 2) + "\n", { mode: 0o600 });

console.log(`W17-ARM ${DISARM ? "DISARMED" : "ARMED"}: operator-orders W17-STEEM-SBD-IMPORT + flag policy.exchangeImport.enabled=${flag.policy.exchangeImport.enabled} (coins: sbd,steem → headcorner)`);
