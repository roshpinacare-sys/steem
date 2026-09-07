import { NextResponse } from "next/server";

import { readAgentEnv, upsertAgentEnv } from "@/lib/agent-env";
import { listArmyAccounts } from "@/lib/army-vault";
import { journal } from "@/lib/brain";
import {
  CHAINS,
  ALL_ROLES,
  fetchChainAccount,
  maskPub,
  type ChainId,
  type KeyRole,
} from "@/lib/steem-keys";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/vault/matrix — the key situation, live from the chains.
//
//   - which roles are stored in the local vault (fingerprints only)
//   - the PUBLIC authority keys each chain publishes for the account
//   - per stored role: does the stored public key still control the role
//     on each chain (drift detection — e.g. keys rotated on one fork)
//
// No secrets cross this boundary. Public chain data + local fingerprints.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_ENV: Record<KeyRole, { wif: string; pub: string }> = {
  owner: { wif: "OWNER_WIF", pub: "OWNER_WIF_PUB" },
  active: { wif: "ACTIVE_WIF", pub: "ACTIVE_WIF_PUB" },
  posting: { wif: "POSTING_WIF", pub: "POSTING_WIF_PUB" },
  memo: { wif: "MEMO_WIF", pub: "MEMO_WIF_PUB" },
};

export async function GET() {
  const env = readAgentEnv();
  const username = (env.AGENT_ACCOUNT || "headcorner").replace(/^@/, "").toLowerCase();

  const chainIds = CHAINS.map((c) => c.id);
  const chainList = await Promise.all(chainIds.map((id) => fetchChainAccount(id, username)));
  const chains = Object.fromEntries(chainIds.map((id, i) => [id, chainList[i]])) as Record<
    ChainId,
    Awaited<ReturnType<typeof fetchChainAccount>>
  >;

  const steem = chains.steem;
  const stored = ALL_ROLES.filter((r) => env[ROLE_ENV[r].wif] && env[ROLE_ENV[r].pub]).map((r) => ({
    role: r,
    pubMask: maskPub(env[ROLE_ENV[r].pub]),
    controls: {
      steem:
        chains.steem.exists != null
          ? chainPubFor(chains.steem, r) === env[ROLE_ENV[r].pub]
          : null,
      hive:
        chains.hive.exists != null ? chainPubFor(chains.hive, r) === env[ROLE_ENV[r].pub] : null,
      blurt:
        chains.blurt.exists != null ? chainPubFor(chains.blurt, r) === env[ROLE_ENV[r].pub] : null,
    },
  }));

  return NextResponse.json({
    ok: true,
    account: username,
    accountExistsOnSteem: steem.exists,
    chains: CHAINS.map(({ id, label }) => {
      const c = chains[id];
      return {
        id,
        label,
        exists: c.exists,
        posting: maskPub(c.posting),
        active: maskPub(c.active),
        owner: maskPub(c.owner),
        memo: maskPub(c.memoKey),
      };
    }),
    stored,
    army: listArmyAccounts(),
    lastSyncAt: env.VAULT_MASTER_SYNC_AT ?? null,
    vaultMode: env.VAULT_MODE ?? null,
    dryRun: env.DRY_RUN !== "false",
  });
}

/** DELETE /api/ops/vault/matrix?role=posting — wipe a stored role. */
export async function DELETE(req: Request) {
  const role = new URL(req.url).searchParams.get("role") ?? "";
  if (!ALL_ROLES.includes(role as KeyRole)) {
    return NextResponse.json({ ok: false, error: "תפקיד לא מוכר" }, { status: 400 });
  }
  const envKey = ROLE_ENV[role as KeyRole];
  upsertAgentEnv({ [envKey.wif]: null, [envKey.pub]: null });
  await journal("key_vault", `מפתח ${role} נמחק מהכספת המקומית`);
  return NextResponse.json({ ok: true, role });
}

function chainPubFor(chain: { exists: boolean | null; posting?: string | null; active?: string | null; owner?: string | null; memoKey?: string | null }, role: KeyRole): string | null {
  if (!chain.exists) return null;
  return role === "memo"
    ? chain.memoKey ?? null
    : role === "owner"
      ? chain.owner ?? null
      : role === "active"
        ? chain.active ?? null
        : chain.posting ?? null;
}
