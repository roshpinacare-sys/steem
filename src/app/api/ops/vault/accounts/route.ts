import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

import { readAgentEnv } from "@/lib/agent-env";
import { deleteArmyEntry, listArmyAccounts } from "@/lib/army-vault";
import { restartDaemon } from "@/lib/daemon-ctl";
import { journal } from "@/lib/brain";

// ─────────────────────────────────────────────────────────────────────────────
// GET    /api/ops/vault/accounts — the army roster (masked, HTTP-safe).
//        Includes: operator-connected army accounts (keys/vault.json) AND
//        factory-minted synthetic agents (agent/keys/<name>.json) when the
//        daemon reports them in agent-status.json.
// DELETE /api/ops/vault/accounts?username=x — disconnect an army account
//        (wipes its entry; the daemon restarts so its loops disarm).
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const env = readAgentEnv();
  const primary = (env.AGENT_ACCOUNT || "headcorner").replace(/^@/, "").toLowerCase();

  // Factory agents: only those whose key file actually exists on this machine
  // (a sandbox reset can wipe keys/ while agent-status.json keeps old names —
  // the roster must never claim an army that isn't armed).
  const keysDir = `${process.cwd()}/agent/keys`;
  let factoryAgents: { username: string }[] = [];
  try {
    const status = JSON.parse(
      fs.readFileSync(`${process.cwd()}/agent/agent-status.json`, "utf8"),
    ) as { factory?: { agents?: string[] } };
    factoryAgents = (status.factory?.agents ?? [])
      .filter((name) => {
        try {
          const j = JSON.parse(fs.readFileSync(`${keysDir}/${name}.json`, "utf8")) as {
            keys?: { posting?: { wif?: string } };
          };
          return Boolean(j?.keys?.posting?.wif);
        } catch {
          return false;
        }
      })
      .map((name) => ({ username: name }));
  } catch {
    factoryAgents = [];
  }

  const army = listArmyAccounts();
  return NextResponse.json({
    ok: true,
    primary,
    army,
    factoryAgents,
    counts: {
      primary: 1,
      operator: army.length,
      factory: factoryAgents.length,
      total: 1 + army.length + factoryAgents.length,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const username = (new URL(req.url).searchParams.get("username") ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!/^[a-z0-9\-.]{3,16}$/.test(username)) {
    return NextResponse.json({ ok: false, error: "שם חשבון לא תקין" }, { status: 400 });
  }
  const env = readAgentEnv();
  if (username === (env.AGENT_ACCOUNT || "headcorner").toLowerCase()) {
    return NextResponse.json(
      { ok: false, error: "לא ניתן לנתק את החשבון הראשי דרך רשימת הצבא" },
      { status: 400 },
    );
  }
  const removed = deleteArmyEntry(username);
  if (!removed) {
    return NextResponse.json({ ok: false, error: `@${username} לא בכספת הצבא` }, { status: 404 });
  }
  await journal("army_vault", `חשבון-צבא נותק: @${username}`, "entry wiped from keys/vault.json");
  const rd = await restartDaemon();
  return NextResponse.json({ ok: true, username, daemonRestarted: rd.restarted });
}
