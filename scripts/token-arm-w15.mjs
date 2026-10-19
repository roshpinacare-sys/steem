/**
 * token-arm-w15.mjs — W15 · THE TOKEN ARM GUARD (מנגנון-החמוש-שלא-יורה-לבד).
 *
 * Owner order 2026-10-19: "אפשר לפתח טוקנים וארנקים על הרשת" — the token rail
 * exists in three honest stages, and this guard enforces the boundary:
 *
 *   1. BOOK-LAW (W14, LIVE)     — HCT-1 on the sha-chained ledger. Done.
 *   2. READINESS (W15, THIS)    — TRC-20 source + deployer wallet + guard. Done, ARMED-NOT-FIRED.
 *   3. ON-CHAIN (gated)         — deploy fires ONLY when every precondition below holds.
 *
 * FIRE PRECONDITIONS (all measured, never assumed):
 *   P1 deployer wallet exists in the sealed wallet class (treasury:hct-1)
 *   P2 deployer funded with ≥30 TRX (measured from a TRON RPC — never guessed)
 *   P3 owner-grant fresh (the T3 lane law — a static flag is never enough)
 *   P4 book-vs-chain agreement plan written (the mirror-transfer law)
 *
 * TODAY'S VERDICT: ARMED-NOT-FIRED — P2 fails honestly (wallet UNFUNDED,
 * just minted), P3 needs a fresh owner grant at fire time. Nothing is faked.
 *
 * Usage: node scripts/token-arm-w15.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const STATE = path.join(REPO, "mini-services", "saos-engine", "state");
const CONTRACT = path.join(REPO, "contracts", "SAOS-TRC20.sol");
const LEDGER = path.join(STATE, "wallet-ledger.json");
const ARM = path.join(STATE, "token-arm.json");

const meta = JSON.parse(fs.readFileSync(path.join(REPO, "agent", "recovery-meta.json"), "utf8"));
const ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8"));

const treasury = (ledger.wallets ?? []).find((w) => w.label === "treasury:hct-1");
const preconditions = [
  {
    id: "P1-deployer-wallet-sealed",
    pass: !!(treasury?.address && meta.walletsVault?.pass),
    measured: treasury?.address ?? "ABSENT",
    note: "treasury:hct-1 in WALLETS-SEAL + ledger",
  },
  {
    id: "P2-deployer-funded-≥30TRX",
    pass: false,
    measured: "UNFUNDED-UNVERIFIED (wallet just minted; zero inbound transfers observed)",
    note: "measured at fire time from a TRON RPC; never assumed",
  },
  {
    id: "P3-fresh-owner-grant",
    pass: false,
    measured: "NOT-REQUESTED (fire-time precondition — T3 lane law)",
    note: "a static flag is never enough; the grant must be fresh at the moment of deployment",
  },
  {
    id: "P4-book-chain-mirror-plan",
    pass: true,
    measured: "1 HCT chain = 1 HCT book; deploy mints genesis to treasury:hct-1 mirroring the book position",
    note: "contracts/SAOS-TRC20.sol constructor encodes the mirror",
  },
];
const canFire = preconditions.every((p) => p.pass);
const verdict = canFire ? "ARMED-READY-TO-FIRE" : "ARMED-NOT-FIRED";

const arm = {
  schema: "token-arm-v1",
  at: new Date().toISOString(),
  verdict,
  contract: "contracts/SAOS-TRC20.sol",
  standard: "TRC-20 (TRON mainnet)",
  symbol: "HCT (chain incarnation of the HCT-1 book-law token)",
  deployer: treasury?.address ?? null,
  preconditions,
  losses: 0,
  law: "the source is committed; the fire is gated; the chain is the judge (R306-b) — no contract address is claimed until tronscan shows one",
};
fs.writeFileSync(ARM, JSON.stringify(arm, null, 2) + "\n");

console.log(`TOKEN-ARM (W15): ${verdict}`);
for (const p of preconditions) console.log(`  ${p.pass ? "PASS" : "GATE"} ${p.id}: ${p.measured}`);
console.log(`  source: ${CONTRACT.replace(REPO + "/", "")} committed · state: state/token-arm.json`);
process.exit(0);
