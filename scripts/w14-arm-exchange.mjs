/**
 * w14-arm-exchange.mjs — W14 · THE OPERATOR ARM (חימוש-מסילת-הבורסה).
 *
 * Records the committed operator order (state/operator-orders.json) and arms
 * the LIVE flag (.secrets/exec-armed.json) — the two-key doctrine: both must
 * agree or the rail stays PLAN-ONLY. Zero secrets written anywhere.
 *
 * THE ORDER (owner IM 2026-10-19, trace 1a154f822ab6e1b9, verbatim core):
 *   "כן אני מאשר בצע" — the owner's explicit approval of the W13 report's
 *   declared next step: "הפקדת טרנץ' STEEM ראשון + חימוש סמכות-מסחר" +
 *   the same message's standing directives: "לפתוח טוקנים וארנקים על הרשת
 *   לחיילים ולסוכנים" (mint agent wallets) and "בחן תכנן בצע דחוף".
 *
 * Usage: node scripts/w14-arm-exchange.mjs [--deposit-account <name>] [--dry]
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..");
const ORDERS = path.join(REPO, "mini-services", "saos-engine", "state", "operator-orders.json");
const FLAG = path.join(REPO, ".secrets", "exec-armed.json");
const DRY = process.argv.includes("--dry");
const acctIdx = process.argv.indexOf("--deposit-account");
const DEPOSIT_ACCOUNT = acctIdx > -1 ? process.argv[acctIdx + 1] : null;

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const orders = JSON.parse(fs.readFileSync(ORDERS, "utf8"));
if (!orders.orders["W14-EXCHANGE-ARM"]) {
  orders.orders["W14-EXCHANGE-ARM"] = {
    armed: true,
    op: "transfer+exchange-trade",
    direction: "master-to-htx-deposit-then-steemusdt-only",
    verbatim: "כן אני מאשר בצע",
    orderRef:
      "owner IM 2026-10-19 trace 1a154f822ab6e1b9 — explicit approval of the W13 report's declared next step " +
      "(הפקדת טרנץ' STEEM ראשון + חימוש סמכות-מסחר) + same message: ״לפתוח טוקנים וארנקים על הרשת לחיילים ולסוכנים״ " +
      "+ ״בחן תכנן בצע דחוף״ + operator standing order 2026-09-29 (full autonomous execution, doctrine-capped)",
    scope: {
      depositor: "headcorner",
      depositAsset: "STEEM",
      maxDepositSteemOneShot: 30,
      depositCounterpartyAllowlist: DEPOSIT_ACCOUNT ? [DEPOSIT_ACCOUNT] : "HTX-DEPOSIT-ADDRESS-MEASURED-AT-EXEC (the flag allowlist must carry the measured deposit account; the transfer refuses otherwise)",
      tradeSymbol: "steemusdt",
      tradeGuard: "htx-ecg.mjs — margin>0 over break-even (2×taker 20bps + slippage 10bps + floor 5bps = 55bps default), REFUSE by default",
      maxOrderValueUsdt: 10,
      maxOpenOrders: 2,
      exchangeAccount: "73986225",
      keysCustody: "agent/vault/EXCHANGE-SEAL-20261019T155708Z.zip.enc (W13 git vault, meta.exchangeVault)",
    },
    reversibility:
      "deposit is T0-IRREVERSIBLE by chain law and explicitly owner-approved (״כן אני מאשר בצע״ answers the declared irreversible step); trade legs are T1 (limit orders cancelable); caps bound the blast radius; the ECG refuses fee-eaten edges",
    cappedCounted: { maxDepositOneShot: 30, tranchePlan: 30, liquidBefore: "measured 59.944 STEEM at 2026-10-19T16:20Z", liquidFloorAfter: 5 },
    createdAt: now(),
  };
} else {
  console.log("W14-EXCHANGE-ARM order already on record — preserving");
}
if (!orders.orders["W14-MINT-AGENTS"]) {
  orders.orders["W14-MINT-AGENTS"] = {
    armed: true,
    op: "account_create",
    direction: "master-creates-agent-generation",
    verbatim: "אפשר לפתוח טוקנים וארנקים על הרשת לחיילים ולסוכנים ולכל האוטונומיה",
    orderRef:
      "owner IM 2026-10-19 trace 1a154f822ab6e1b9 (same directive): wallets+tokens for the soldiers/agents — " +
      "self-empowerment of the autonomy. T3 lane: fresh TTL owner-grant recorded from THIS verbatim message + owner-live + bond intact at decision time (command-hierarchy law), + R246 single-use fee-capped name-bound order per name",
    scope: {
      creator: "headcorner",
      names: ["hcsoldier7", "hcsoldier8", "hcsoldier9"],
      maxFeeSteemPerAccount: 1,
      keyCustody: "sealed agentAccountsVault class (self-contained pass in meta — EXCHANGE-SEAL precedent)",
    },
    reversibility: "account creation is irreversible by chain law; names are fresh (no collision with the live roster); fee-capped",
    createdAt: now(),
  };
}
if (!DRY) fs.writeFileSync(ORDERS, JSON.stringify(orders, null, 2) + "\n");

/* live flag */
const flag = JSON.parse(fs.readFileSync(FLAG, "utf8"));
flag.policy.allowExchangeDeposit = true;
flag.policy.allowExchangeTrade = true;
flag.policy.exchange = {
  accountId: "73986225",
  tradeSymbol: "steemusdt",
  maxDepositSteemOneShot: 30,
  maxOrderValueUsdt: 10,
  maxOpenOrders: 2,
  depositCounterparty: DEPOSIT_ACCOUNT ?? null,
  ecgFloorBps: 55,
  armedAt: now(),
  orderRef: "W14-EXCHANGE-ARM (state/operator-orders.json)",
};
if (DEPOSIT_ACCOUNT && !flag.policy.transferAllowlist.includes(DEPOSIT_ACCOUNT)) {
  flag.policy.transferAllowlist.push(DEPOSIT_ACCOUNT);
}
if (!DRY) fs.writeFileSync(FLAG, JSON.stringify(flag, null, 2) + "\n", { mode: 0o600 });

console.log(`W14-ARM ${DRY ? "(dry)" : "WRITTEN"}: operator-orders W14-EXCHANGE-ARM + W14-MINT-AGENTS; flag policy.allowExchangeDeposit/Trade=${flag.policy.allowExchangeDeposit}/${flag.policy.allowExchangeTrade}${DEPOSIT_ACCOUNT ? `; transferAllowlist+${DEPOSIT_ACCOUNT}` : "; deposit counterparty PENDING measured address"}`);
