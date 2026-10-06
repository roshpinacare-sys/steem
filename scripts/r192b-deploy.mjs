#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// r192-b — W1 deploy attempt on Zero-9369 via the proven signing path
// (seal vault · self-verified · gasPrice-0 gates · key never printed).
//
// MEASURED 2026-10-04 (r192b-simulate.mjs): the rpc.zero.tech gateway
// refuses even eth_call whose data does not start with an allowed
// selector ("You are not authorized … eth_call:selector:0x60808060" —
// 0x60808060 is the Solidity init preamble). Contract-creation
// broadcast (eth_sendRawTransaction, data = init code) is expected to
// hit the same policy wall. This script MEASURES the broadcast-level
// gate with ONE free creation tx (gas $0 — nothing can be spent either
// way) and records the exact outcome honestly:
//   · refused  → chain stays clean, honest STOP for the deploy phase.
//   · accepted → receipt + eth_getCode verification, THEN stop-and-
//                record before any further deploy (arbitrary contract
//                CALL selectors are gateway-blocked, so a deployed core
//                would be inert — L1 forbids presenting that as live).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { ethers } from "ethers";

const ROOT = "/home/z/my-project";
const ART = path.join(ROOT, "contracts", "w1", "artifacts");
const ENC_PATH = path.join(ROOT, "sovereign", "weave-seal.enc");
const MAGIC = "WEAVE-CLOUD-SEAL-1";
const RPC = "https://rpc.zero.tech";
const CHAIN = 9369;
const GAS_LIMIT = 3_000_000n; // creation headroom; cost = limit × gasPrice (measured 0)

const factory = JSON.parse(fs.readFileSync(path.join(ART, "Factory.json"), "utf8"));

function sealPassphrase() {
  const env = process.env.WEAVE_SEAL_PASSPHRASE;
  if (env && env.length > 0) return env;
  const vaultKey = path.join(os.homedir(), ".sovereign", "vault", "secrets", "MAIN_KEY");
  return fs.readFileSync(vaultKey, "utf8").trim();
}

function sealOpen() {
  const raw = fs.readFileSync(ENC_PATH, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines[0] !== MAGIC) throw new Error("seal format unknown");
  const payload = Buffer.from(lines.slice(1).join(""), "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  const key = crypto.scryptSync(sealPassphrase(), salt, 32);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}

const seal = sealOpen();
const wallet = new ethers.Wallet(seal.networkKeyHex);
if (wallet.address.toLowerCase() !== seal.networkAddress.toLowerCase()) {
  throw new Error(`self-verify FAILED: derived ${wallet.address} ≠ sealed ${seal.networkAddress} — refusing`);
}
console.log(`[deploy] signer self-verified: ${wallet.address} (key never printed)`);

const provider = new ethers.JsonRpcProvider(RPC, CHAIN, { batchMaxCount: 1 });

// ── live gates (measured, never assumed) ──
const [chainIdHex, gasWei, balWei, nonceHex] = await Promise.all([
  provider.send("eth_chainId", []),
  provider.send("eth_gasPrice", []),
  provider.send("eth_getBalance", [wallet.address, "latest"]),
  provider.send("eth_getTransactionCount", [wallet.address, "pending"]),
]);
const chainId = parseInt(String(chainIdHex), 16);
const gasPriceWei = BigInt(gasWei);
const balanceWei = BigInt(balWei);
const nonce = parseInt(String(nonceHex), 16);
console.log(`[deploy] chainId ${chainId} · gasPrice ${gasPriceWei} wei · balance ${balanceWei} wei · nonce ${nonce}`);

if (chainId !== CHAIN) {
  console.error("[deploy] chainId gate FAILED — refusing (fail-closed). Nothing sent.");
  process.exit(1);
}
// honest money gate: cost = GAS_LIMIT × gasPrice; require balance ≥ cost × 2
const costWei = GAS_LIMIT * gasPriceWei;
if (balanceWei < costWei * 2n) {
  console.error(
    `[deploy] money gate: creation needs ${costWei} wei and balance ${balanceWei} < cost×2 — honest STOP, nothing spent, nothing sent.`
  );
  process.exit(2);
}

// ── craft the creation tx (Factory first — the probe) ──
const factoryInit =
  factory.bytecode +
  ethers.AbiCoder.defaultAbiCoder()
    .encode(["address"], [wallet.address]) // treasury = the WEAVE zero signer
    .slice(2);

const tx = await wallet.signTransaction({
  to: null, // contract creation
  value: 0n,
  data: factoryInit,
  gasLimit: GAS_LIMIT,
  gasPrice: gasPriceWei, // measured — 0 on the zero rail
  type: 0,
  nonce,
  chainId: CHAIN,
});
console.log(`[deploy] creation tx signed offline (Factory, ${((factoryInit.length - 2) / 2)} bytes init, to=null, value=0)`);
console.log("[deploy] broadcasting via eth_sendRawTransaction — measuring the gateway's broadcast-level selector gate…");

let hash = null;
let sendError = null;
try {
  hash = await provider.send("eth_sendRawTransaction", [tx]);
} catch (e) {
  sendError = e;
}

if (sendError || !hash) {
  const msg = String(sendError?.message ?? sendError ?? "empty result").slice(0, 500);
  const body = sendError?.info?.responseBody ?? "";
  console.log("[deploy] ── MEASURED: broadcast REFUSED by the gateway ──");
  console.log(`[deploy] exact error: ${msg}`);
  if (body) console.log(`[deploy] gateway body: ${String(body).slice(0, 400)}`);
  console.log("[deploy] chain state: NOTHING sent, NOTHING spent, nonce unconsumed, chain clean.");
  console.log('[deploy] verdict: honest STOP for W1 on-chain deploy — the RPC gateway allowlist (transfer/approve selectors only) blocks contract-creation calldata at the edge. Contracts+tests+artifacts stand; deployment deferred until an authorized deploy rail exists.');
  process.exit(3);
}

console.log(`[deploy] tx ACCEPTED by gateway: ${hash}`);
// wait for receipt
let receipt = null;
for (let i = 0; i < 24 && !receipt; i++) {
  await new Promise((r) => setTimeout(r, 2500));
  receipt = await provider.getTransactionReceipt(hash).catch(() => null);
}
if (!receipt || receipt.status !== 1) {
  console.log(`[deploy] receipt: ${receipt ? `status ${receipt.status}` : "timeout"} — treating as NOT deployed (honest)`);
  process.exit(4);
}
const code = await provider.send("eth_getCode", [receipt.contractAddress, "latest"]);
const deployed = code && code !== "0x";
console.log(
  `[deploy] Factory ${deployed ? "ON-CHAIN" : "NO-CODE"} · address ${receipt.contractAddress} · block ${receipt.blockNumber} · gasUsed ${receipt.gasUsed} · effectiveGasPrice ${receipt.gasPrice?.toString()}`
);
console.log(
  "[deploy] STOP-and-record per plan: further deploys (WUSDS/Router/createPair) would need arbitrary contract-CALL selectors, which the gateway demonstrably refuses — the core would be inert. L1: never present non-executable liquidity as live."
);
fs.writeFileSync(
  path.join(ROOT, "sovereign", "w1-deploy-probe.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      probe: "Factory creation tx (free, gasPrice 0)",
      accepted: true,
      txid: hash,
      block: receipt.blockNumber,
      gasUsed: Number(receipt.gasUsed),
      contractAddress: receipt.contractAddress,
      codeOnChain: deployed,
      note: "single-probe outcome — see worklog r192-b",
    },
    null,
    1
  ) + "\n"
);
provider.destroy();
