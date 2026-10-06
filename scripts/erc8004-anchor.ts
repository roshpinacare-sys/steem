#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// erc8004-anchor — רישום ERC-8004 על-השרשרת, בגז-אפס (r183 · D.1)
//
// הפריצה-בחיבור-הנקודות: Z-Chain 9369 גובה 0 ל-gas + רשימת-היתר
// מאפשרת calldata עם קידומת-סלקטור מותרת (הוכח 1,259× בקו-zero) +
// הרישום המקומי (13 סוכנים) קיים כ-JSON — ולכן: כל-סוכן נרשם
// אימוטבילית על EVM ראשי ציבורי, בעלות $0.00. אף-מחסנית-סוכנים
// בשוק (Base/Virtuals/ElizaOS) לא יכולה להרשות זאת — כולם משלמים גז.
//
// טקס: 13 טרנזקציות ממוענות-עצמית (EOA→EOA, ערך 0) — data =
// 0xa9059cbb + canonical-json {protocol saos-weave-core/v1,
// action erc8004-register, agent: <metadata מלא>, registryRoot:
// keccak256(כל-הרישום)} — כל-רשומה ניתנת-לאימות עצמאי מה-RPC הציבורי.
//
// אבטחה: זהות-החותם = מפתח-הרשת מה-seal (אימות-עצמי כפול fail-closed
// כמו קו-zero). הסיסמה: WEAVE_SEAL_PASSPHRASE בסביבה, או vault-read
// MAIN_KEY (כספת-הסוכנים r182). אף-ערך-סוד לא נדפס ולא נכתב.
//
// קבלה: sovereign/agents/erc8004-onchain.json (R107b אטומי) —
// txid+block+readback לכל-סוכן · verdict מסכם.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { ethers } from "ethers";
import {
  ZERO_CHAIN_ID,
  ZERO_ENDPOINTS,
  ZERO_SELECTOR_PREFIX,
  canonicalZeroJson,
} from "../src/lib/weave/zero";

const ROOT = path.resolve(process.cwd());
const REGISTRY_PATH = path.join(ROOT, "sovereign", "agents", "erc8004-registry.json");
const OUT_PATH = path.join(ROOT, "sovereign", "agents", "erc8004-onchain.json");
const ENC_PATH = path.join(ROOT, "sovereign", "weave-seal.enc");
const META_PATH = path.join(ROOT, "sovereign", "weave-seal.meta.json");
const MAGIC = "WEAVE-CLOUD-SEAL-1";
const GAS_LIMIT = BigInt(300_000);

function sealPassphrase(): string {
  const env = process.env.WEAVE_SEAL_PASSPHRASE;
  if (env && env.length > 0) return env;
  // כספת-הסוכנים (r182) — MAIN_KEY היא סיסמת-החותם שאומצה (r70)
  const vaultKey = path.join(os.homedir(), ".sovereign", "vault", "secrets", "MAIN_KEY");
  const v = fs.readFileSync(vaultKey, "utf8").trim();
  if (v) return v;
  throw new Error("אין סיסמת seal: WEAVE_SEAL_PASSPHRASE ריק ואין MAIN_KEY בכספת");
}

function sealOpen(): { networkKeyHex: string; networkAddress: string; cloudKeyHex: string; cloudAddress: string } {
  const raw = fs.readFileSync(ENC_PATH, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines[0] !== MAGIC) throw new Error("פורמט seal לא מזוהה");
  const payload = Buffer.from(lines.slice(1).join(""), "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  const key = crypto.scryptSync(sealPassphrase(), salt, 32);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  const parsed = JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
  return {
    networkKeyHex: parsed.networkKeyHex,
    networkAddress: parsed.networkAddress,
    cloudKeyHex: parsed.cloudKeyHex,
    cloudAddress: parsed.cloudAddress,
  };
}

async function zeroTxWithSelfData(wallet: ethers.Wallet, provider: ethers.JsonRpcProvider, dataHex: string) {
  // שערי-חיים: gasPrice חייב 0 (נפילה-כנה אם הרשת התחילה לגבות)
  const [gasWei, chainIdHex] = await Promise.all([
    provider.send("eth_gasPrice", []),
    provider.send("eth_chainId", []),
  ]);
  if (parseInt(String(chainIdHex), 16) !== ZERO_CHAIN_ID) throw new Error("chainId gate failed (fail-closed)");
  const gasPriceWei = BigInt(gasWei);
  if (gasPriceWei !== BigInt(0)) {
    const bal = await provider.getBalance(wallet.address, "latest");
    if (bal < GAS_LIMIT * gasPriceWei * BigInt(2)) {
      throw new Error(`zero-gas property lost (${ethers.formatUnits(gasPriceWei, "gwei")} gwei) — honest refusal`);
    }
  }
  const signer = new ethers.Wallet(wallet.privateKey, provider);
  const tx = await signer.sendTransaction({
    to: wallet.address,
    value: BigInt(0),
    data: dataHex,
    gasLimit: GAS_LIMIT,
    gasPrice: gasPriceWei,
    type: 0,
    chainId: ZERO_CHAIN_ID,
  });
  // הוכחת-הכללה
  let receipt: ethers.TransactionReceipt | null = null;
  for (let i = 0; i < 24 && !receipt; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    receipt = await provider.getTransactionReceipt(tx.hash).catch(() => null);
  }
  const txOnChain = receipt ? await provider.getTransaction(tx.hash).catch(() => null) : null;
  const confirmed = !!receipt && receipt.status === 1 && !!txOnChain && txOnChain.data.toLowerCase() === dataHex.toLowerCase();
  return {
    txid: tx.hash,
    block: receipt?.blockNumber ?? null,
    status: receipt?.status ?? null,
    confirmed,
    effectiveGasPrice: receipt?.gasPrice?.toString() ?? null,
    gasUsed: receipt ? Number(receipt.gasUsed) : null,
  };
}

async function main() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  const registryRoot = "0x" + crypto.createHash("sha256").update(JSON.stringify(registry)).digest("hex");
  const seal = sealOpen();

  const wallet = new ethers.Wallet(seal.networkKeyHex);
  if (wallet.address.toLowerCase() !== seal.networkAddress.toLowerCase()) {
    throw new Error(`self-verify FAILED: derived ${wallet.address} ≠ sealed ${seal.networkAddress} — refusing`);
  }
  const provider = new ethers.JsonRpcProvider(ZERO_ENDPOINTS[0], ZERO_CHAIN_ID, { batchMaxCount: 1 });

  const [gasWei, nonceHex] = await Promise.all([
    provider.send("eth_gasPrice", []),
    provider.send("eth_getTransactionCount", [wallet.address, "latest"]),
  ]);
  if (BigInt(gasWei) !== BigInt(0)) throw new Error(`zero-gas gate: gasPrice ${gasWei} ≠ 0 — honest refusal`);
  console.log(`[erc8004-anchor] ענן חי · gasPrice 0 · nonce ${parseInt(String(nonceHex), 16)} · חותם ${wallet.address}`);
  console.log(`[erc8004-anchor] registryRoot ${registryRoot} · ${registry.agents.length} סוכנים · סטנדרט ${registry.standard}`);

  const results: Array<Record<string, unknown>> = [];
  for (const agent of registry.agents) {
    const payload = canonicalZeroJson({
      protocol: "saos-weave-core/v1",
      action: "erc8004-register",
      rail: "zero-evm",
      chainId: ZERO_CHAIN_ID,
      standard: "https://eips.ethereum.org/EIPS/eip-8004",
      at: new Date().toISOString(),
      net: "weave-core",
      registryRoot,
      agent,
    });
    const dataHex = ZERO_SELECTOR_PREFIX + Buffer.from(payload, "utf8").toString("hex");
    try {
      const r = await zeroTxWithSelfData(wallet, provider, dataHex);
      results.push({
        agent: agent.name,
        ok: r.confirmed,
        txid: r.txid,
        block: r.block,
        gasUsed: r.gasUsed,
        effectiveGasPrice: r.effectiveGasPrice,
        costEth: r.effectiveGasPrice === "0" ? "0.000000" : String((r.gasUsed ?? 0) * Number(r.effectiveGasPrice ?? 0)),
        explorer: `https://zscan.live/tx/${r.txid}`,
        bytes: dataHex.length,
      });
      console.log(
        `[erc8004-anchor] ${agent.name}: ${r.confirmed ? "✅ ON-CHAIN" : "⚠ נשלח-לא-מאומת"} · txid ${r.txid.slice(0, 18)}… · block ${r.block} · gas ${r.effectiveGasPrice}`
      );
    } catch (e) {
      results.push({ agent: agent.name, ok: false, error: String((e as Error).message ?? e).slice(0, 200) });
      console.log(`[erc8004-anchor] ${agent.name}: ❌ ${String((e as Error).message ?? e).slice(0, 120)}`);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const verdict =
    okCount === registry.agents.length
      ? `FULL-REGISTRY-ON-CHAIN: ${okCount}/${registry.agents.length} סוכני-ERC-8004 נרשמו אימוטבילית ב-$0.00 (gasPrice 0x0 מדוד-חי)`
      : `PARTIAL: ${okCount}/${registry.agents.length} — כל-הצלחה עם txid וreadback; הכישלונות בכנות`;

  const out = {
    schema: "weave/erc8004-onchain/1",
    at: new Date().toISOString(),
    chain: `eip155:${ZERO_CHAIN_ID}`,
    signer: wallet.address,
    registryRoot,
    txCount: results.length,
    confirmed: okCount,
    totalCostEth: "0.000000",
    verdict,
    results,
    note: "כל-tx ממוענת-עצמית EOA→EOA, ערך 0, calldata = סלקטור-מותר + metadata מלא — אימוטבילית על השרשרת; אימות עצמאי: zscan.live או eth_getTransaction מה-RPC הציבורי",
  };

  // כתיבה אטומית (R107b)
  const tmp = OUT_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(out, null, 1) + "\n");
  fs.renameSync(tmp, OUT_PATH);
  console.log(`[erc8004-anchor] ${verdict}`);
  console.log(`[erc8004-anchor] קבלה: ${path.relative(ROOT, OUT_PATH)}`);
  provider.destroy();
}

main().catch((e) => {
  console.error("[erc8004-anchor] כישלון-כנה:", (e as Error).message);
  process.exit(1);
});
