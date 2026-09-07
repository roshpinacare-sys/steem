import { NextResponse } from "next/server";

import { readArmyVault } from "@/lib/army-vault";
import { AGENT_DIR } from "@/lib/agent-env";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/infra/status — one aggregate for the SCI (SAOS Chain
 * Infrastructure) card: authority topology, RC arming, world-log state,
 * encrypted command bus, escrow rail, community readiness.
 *
 * Everything here is read-only. Chain reads (get_accounts / rc_api) are
 * cached 30s so the console can poll freely.
 */

const cache: { at: number; data?: Record<string, unknown> } = { at: 0 };

function readJson(p: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function rpc(method: string, params: unknown): Promise<unknown> {
  const endpoints = ["https://api.steemit.com", "https://steemapi.boyerasset.com", "https://api.steem.bts20.com"];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(15000),
      });
      const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message ?? "rpc error");
      return j.result;
    } catch {
      /* next endpoint */
    }
  }
  throw new Error("all steem endpoints failed");
}

export async function GET() {
  if (cache.data && Date.now() - cache.at < 30_000) {
    return NextResponse.json({ ok: true, cached: true, ...(cache.data as object) });
  }

  const vault = readArmyVault();
  const armyNames = vault.accounts.map((a) => a.username.toLowerCase());
  const operator = (process.env.AGENT_ACCOUNT || "headcorner").toLowerCase();

  let topology: unknown[] = [];
  let chainError: string | null = null;
  let communityReadiness: { pendingClaims: number; rcPct: number | null; note: string } = {
    pendingClaims: 0,
    rcPct: null,
    note: "",
  };
  try {
    const names = [operator, ...armyNames];
    const accs = (await rpc("condenser_api.get_accounts", [names])) as Array<{
      name: string;
      recovery_account: string;
      balance: string;
      vesting_shares: string;
      pending_claimed_accounts?: string | number;
      posting: { account_auths: [string, number][] };
    }>;
    const accByName = new Map(accs.map((a) => [a.name.toLowerCase(), a]));
    let rcAccounts: Array<{ account: string; max_rc: string }> = [];
    if (armyNames.length) {
      try {
        const rc = (await rpc("rc_api.find_rc_accounts", { accounts: armyNames })) as {
          rc_accounts: Array<{ account: string; max_rc: string }>;
        };
        rcAccounts = rc.rc_accounts ?? [];
      } catch {
        /* rc optional */
      }
    }
    const rcByName = new Map(rcAccounts.map((r) => [r.account, r.max_rc]));

    topology = armyNames.map((n) => {
      const acc = accByName.get(n);
      const entry = vault.accounts.find((a) => a.username.toLowerCase() === n);
      return {
        account: n,
        onChain: Boolean(acc),
        recovery: acc?.recovery_account ?? null,
        recoveryOurs: acc?.recovery_account === operator,
        operatorPostingAuth: Boolean(
          acc?.posting?.account_auths?.some(([name]) => name.toLowerCase() === operator),
        ),
        rcMax: Number(rcByName.get(n) ?? 0),
        externalApps: acc?.posting?.account_auths?.filter(([x]) => x.toLowerCase() !== operator).map(([x]) => x) ?? [],
        infra: entry?.infra ?? null,
      };
    });

    const me = accByName.get(operator);
    communityReadiness = {
      pendingClaims: Number(me?.pending_claimed_accounts ?? 0),
      rcPct: null,
      note: "",
    };
  } catch (e) {
    chainError = String((e as Error).message || e).slice(0, 140);
  }
  try {
    const st = readJson(path.join(AGENT_DIR, "agent-status.json")) as { rc?: { pct?: number } } | null;
    if (st?.rc?.pct != null) communityReadiness.rcPct = st.rc.pct;
  } catch {
    /* optional */
  }

  const worldlog = readJson(path.join(AGENT_DIR, "worldlog.json"));
  const worldlogVerify = readJson(path.join(AGENT_DIR, "worldlog_verify.json"));
  const commandSeen = readJson(path.join(AGENT_DIR, "command_seen.json")) as {
    commands?: Record<string, { cmd: string; by: string; at: string; txid?: string }>;
  } | null;
  const commandsSent = readJson(path.join(AGENT_DIR, "commands_sent.json"));
  const hardenResult = readJson(path.join(AGENT_DIR, "harden_result.json"));
  const escrowResult = readJson(path.join(AGENT_DIR, "escrow_result.json"));

  const acks = Object.entries(commandSeen?.commands ?? {})
    .map(([nonce, v]) => ({ nonce, ...v }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-8);

  const data = {
    ok: true,
    at: new Date().toISOString(),
    chainError,
    topology,
    worldlog: {
      state: worldlog,
      verify: worldlogVerify,
    },
    commandBus: {
      acks,
      totalDecoded: Object.keys(commandSeen?.commands ?? {}).length,
      lastSent: Array.isArray(commandsSent)
        ? (commandsSent as unknown[]).slice(-5)
        : ((commandsSent as { commands?: unknown[] })?.commands ?? []).slice(-5),
    },
    harden: hardenResult,
    escrow: escrowResult,
    communityReadiness,
  };
  cache.at = Date.now();
  cache.data = data;
  return NextResponse.json(data);
}
