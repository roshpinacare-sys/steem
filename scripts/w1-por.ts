/* ─────────────────────────────────────────────────────────────────────
 * THE WEAVE · w1-por (r192-b) — PoR attestation feed for the W1 DEX core
 * on Zero-9369 (laws L1/L4: every shown unit must be redeemable 1:1).
 *
 * Reads, per attestation run:
 *   · supply   — WrappedToken.totalSupply() from the public Zero RPC
 *                (keyless; the WUSDS address comes from the w1 section
 *                of sovereign/zero-line.json when it exists)
 *   · backing  — the operator's backing balance: the operator's own
 *                WUSDS reserve position on-chain (the locked 1:1 side
 *                of everything minted); keyless, third-party verifiable
 *   · ok       — backing ≥ supply (a shortfall ⇒ PoR FALSE ⇒ law L4
 *                mandates automatic cap contraction upstream)
 *
 * Honest states:
 *   · no WUSDS deployed yet ⇒ supply 0, backing 0, ok TRUE trivially
 *     (nothing owed) — recorded explicitly, never silently assumed.
 *
 * Output: sovereign/w1-por.json {at, chain, operator, wusds, backing,
 * supply, ok, verdict} — atomic write (R107b), zero secrets, $0 (read-only).
 * ───────────────────────────────────────────────────────────────────── */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ZERO_LINE = path.join(ROOT, "sovereign", "zero-line.json");
const OUT = path.join(ROOT, "sovereign", "w1-por.json");
const RPC = "https://rpc.zero.tech";
const CHAIN = 9369;
const OPERATOR = "0xe376d8431089A0275A0CF125655B6Bc7d693F1b2"; // the WEAVE zero signer = W1 operator/treasury

async function main() {
  const at = new Date().toISOString();
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN, { batchMaxCount: 1 });

  // locate the deployed WUSDS (none yet — honest trivial state until W1 lands)
  let wusds: string | null = null;
  if (existsSync(ZERO_LINE)) {
    const line = JSON.parse(readFileSync(ZERO_LINE, "utf8")) as {
      w1?: { contracts?: { wusds?: string | null } };
    };
    wusds = line.w1?.contracts?.wusds ?? null;
  }

  let supply = BigInt(0); // BigInt() form — repo target is pre-ES2020 (same as zero.ts)
  let backing = BigInt(0);
  let note: string;

  if (!wusds) {
    note = "no WrappedToken (WUSDS) deployed on Zero-9369 yet — supply 0, backing 0, nothing owed (law L1 held trivially)";
  } else {
    const token = new ethers.Contract(
      wusds,
      ["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"],
      provider
    );
    supply = BigInt(await token.totalSupply());
    backing = BigInt(await token.balanceOf(OPERATOR)); // operator's locked reserve position
    note = "supply = totalSupply(); backing = operator balanceOf (1:1 reserve position); ok ⇔ backing ≥ supply";
  }

  const ok = backing >= supply;
  const verdict = !wusds
    ? "W1-POR-TRIVIAL: no wrapper deployed — zero supply, zero backing, honest empty state"
    : ok
      ? `W1-POR-OK: backing (${backing}) ≥ supply (${supply}) — 1:1 redeemability attested`
      : `W1-POR-SHORTFALL: supply ${supply} > backing ${backing} — law L4: caps must contract, show nothing as redeemable`;

  const out = {
    at,
    chain: `eip155:${CHAIN}`,
    rpc: RPC,
    operator: OPERATOR,
    wusds,
    backing: backing.toString(),
    supply: supply.toString(),
    ok,
    verdict,
    note,
    gasCostWei: "0", // read-only attestation — $0
  };

  const tmp = OUT + ".tmp";
  writeFileSync(tmp, JSON.stringify(out, null, 1) + "\n");
  renameSync(tmp, OUT);
  console.log(`[w1-por] ${verdict}`);
  console.log(`[w1-por] at=${at} backing=${backing} supply=${supply} ok=${ok}`);
  console.log(`[w1-por] artifact: ${path.relative(ROOT, OUT)}`);
  provider.destroy();
}

main().catch((e) => {
  console.error("[w1-por] honest failure:", (e as Error).message);
  process.exit(1);
});
