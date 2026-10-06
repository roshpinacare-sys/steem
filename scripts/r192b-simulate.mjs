#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// r192-b — pre-broadcast simulation attempt on rpc.zero.tech ($0, keyless).
//
// Plan was: creation eth_call of the Sim harness (runs the REAL compiled
// W1 bytecode end-to-end) + eth_estimateGas for each deploy tx.
//
// MEASURED OUTCOME (this script, live): the rpc.zero.tech gateway
// refuses ANY data whose first 4 bytes are not on the selector
// allowlist — including eth_call and eth_estimateGas of init code:
//   "You are not authorized to make this request:
//    eth_call:selector:0x60808060"
// (0x60808060 = the Solidity init preamble; allowlist = 0xa9059cbb
// transfer · 0x095ea7b3 approve). The wall is therefore at the RPC
// edge, before VM execution. This is itself the honest simulation
// result: on-chain pre-broadcast execution of our init code is not
// authorized on the public gateway; correctness stands on the
// deterministic mirror tests (713/713) + solc 0.8.37 verification.
// The broadcast-level gate is measured separately (r192b-deploy.mjs).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const ROOT = "/home/z/my-project";
const ART = path.join(ROOT, "contracts", "w1", "artifacts");
const RPC = "https://rpc.zero.tech";
const CHAIN = 9369;

const factory = JSON.parse(fs.readFileSync(path.join(ART, "Factory.json"), "utf8"));
const wusds = JSON.parse(fs.readFileSync(path.join(ART, "WrappedToken.json"), "utf8"));
const router = JSON.parse(fs.readFileSync(path.join(ART, "Router.json"), "utf8"));

const provider = new ethers.JsonRpcProvider(RPC, CHAIN, { batchMaxCount: 1 });
const PROBE = "0xe376d8431089A0275A0CF125655B6Bc7d693F1b2"; // WEAVE zero signer (read-only here)

let PASS = 0;
let FAIL = 0;
const fails = [];
const measurements = [];
function ok(cond, name) {
  if (cond) PASS++;
  else {
    FAIL++;
    fails.push(name);
    console.error(`  ✗ ${name}`);
  }
}
function measured(name, detail) {
  measurements.push({ name, detail });
  console.log(`  ⚑ MEASURED: ${name}${detail ? " — " + detail : ""}`);
}

console.log("[sim] chain probe…");
const [chainId, gasWei, blockHex] = await Promise.all([
  provider.send("eth_chainId", []),
  provider.send("eth_gasPrice", []),
  provider.send("eth_blockNumber", []),
]);
const chainIdNum = parseInt(String(chainId), 16);
const gasPriceWei = BigInt(gasWei);
console.log(`[sim] chainId ${chainIdNum} · gasPrice ${gasPriceWei} wei · block ${parseInt(String(blockHex), 16)}`);
ok(chainIdNum === CHAIN, "chainId == 9369 (fail-closed rail gate)");
ok(gasPriceWei === 0n, "gasPrice == 0 (the zero property, measured live)");

console.log("[sim] creation eth_call of Sim (full W1 lifecycle on the real VM)…");
const sim = JSON.parse(fs.readFileSync(path.join(ART, "Sim.json"), "utf8"));
let resultHex = null;
try {
  resultHex = await provider.send("eth_call", [
    { from: PROBE, data: sim.bytecode, gas: "0x2000000" },
    "latest",
  ]);
  measured("eth_call of init code EXECUTED", `${((sim.bytecode.length - 2) / 2)} bytes init accepted`);
} catch (e) {
  const body = e?.info?.responseBody ?? e?.shortMessage ?? String(e);
  const m = String(body).match(/eth_call:selector:(0x[0-9a-f]+)/);
  measured(
    "gateway REFUSES eth_call of init code (selector allowlist at the RPC edge)",
    m ? `refused selector ${m[1]}` : String(body).slice(0, 220)
  );
}

if (resultHex && resultHex !== "0x") {
  const iface = new ethers.Interface([
    "function run() external returns (address factoryAddr, address pairAddr, address routerAddr, address wusdsAddr, uint256 liquidity, uint256 quoteOut, uint256 swapOut, uint256 treasuryWusds, uint256 kBefore, uint256 kAfter, uint256 removeOut0, uint256 removeOut1, uint8 guardMinOut, uint8 guardDeadline, uint8 guardNonOpMint, uint8 guardNonOpBurn)",
  ]);
  const [decoded] = iface.decodeFunctionResult("run", resultHex);
  const [factoryAddr, pairAddr, routerAddr, wusdsAddr, liquidity, quoteOut, swapOut, treasuryWusds, kBefore, kAfter, removeOut0, removeOut1, guardMinOut, guardDeadline, guardNonOpMint, guardNonOpBurn] = decoded;
  const E18 = 10n ** 18n;
  const a0 = "0x0000000000000000000000000000000000000000";
  ok(factoryAddr !== a0, `factory deployed in sim: ${factoryAddr}`);
  ok(pairAddr !== a0, `pair created in sim: ${pairAddr}`);
  ok(routerAddr !== a0, `router deployed in sim: ${routerAddr}`);
  ok(wusdsAddr !== a0, `WUSDS deployed in sim: ${wusdsAddr}`);
  ok(liquidity === 100000n * E18, `first LP mint == ⌊√(100k·100k)⌋ = 100k (${liquidity})`);
  ok(quoteOut > 0n && quoteOut === swapOut, `router swap out == quote (${ethers.formatUnits(swapOut, 18)} CTR out of 1000 WUSDS)`);
  ok(kAfter > kBefore, `k grew on swap (Δk = ${kAfter - kBefore} > 0)`);
  ok(treasuryWusds === (1000n * E18 * 9n) / 10000n, `treasury fee == 9bps of swap-in (0.9 WUSDS; got ${ethers.formatUnits(treasuryWusds, 18)})`);
  ok(removeOut0 > 0n && removeOut1 > 0n, "removeLiquidity pays both sides proportionally");
  ok(guardMinOut === 1n, "guard: minOut above quote → reverted (on-chain VM)");
  ok(guardDeadline === 1n, "guard: expired deadline → reverted (on-chain VM)");
  ok(guardNonOpMint === 1n, "guard: non-operator mint → reverted (law L1, on-chain VM)");
  ok(guardNonOpBurn === 1n, "guard: non-operator burn → reverted (law L1, on-chain VM)");
  console.log(`[sim] lifecycle: LP=${ethers.formatUnits(liquidity, 18)} · out=${ethers.formatUnits(swapOut, 18)} · treasury=${ethers.formatUnits(treasuryWusds, 18)} · Δk=${kAfter - kBefore}`);
}

console.log("[sim] eth_estimateGas probes for the deployment transactions…");
const wusdsInit =
  wusds.bytecode +
  ethers.AbiCoder.defaultAbiCoder()
    .encode(["string", "string", "address"], ["Wrapped USDS (Zero W1)", "WUSDS", PROBE])
    .slice(2);
const deployables = [
  ["Factory", factory.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address"], [PROBE]).slice(2)],
  ["WrappedToken(WUSDS)", wusdsInit],
  ["Router", router.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address"], [PROBE]).slice(2)],
];
for (const [name, data] of deployables) {
  try {
    const g = await provider.send("eth_estimateGas", [{ from: PROBE, data }]);
    measured(`eth_estimateGas EXECUTED for ${name}`, `${BigInt(g)} gas`);
  } catch (e) {
    const body = e?.info?.responseBody ?? e?.shortMessage ?? String(e);
    const m = String(body).match(/selector:(0x[0-9a-f]+)/);
    measured(`gateway REFUSES eth_estimateGas of init code (${name})`, m ? `refused selector ${m[1]}` : String(body).slice(0, 160));
  }
}

console.log("");
console.log(`[sim] chain gates: PASS ${PASS}/${PASS + FAIL} · measurements recorded: ${measurements.length}`);
for (const m of measurements) console.log(`  ⚑ ${m.name}${m.detail ? " — " + m.detail : ""}`);
if (FAIL > 0) {
  console.error("failures:", fails.join(" | "));
  process.exit(1);
}
provider.destroy();
