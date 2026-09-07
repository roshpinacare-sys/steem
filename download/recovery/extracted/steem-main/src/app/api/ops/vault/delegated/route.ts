import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";

import { AGENT_DIR, readAgentEnv } from "@/lib/agent-env";
import { readArmyVault, upsertArmyEntry } from "@/lib/army-vault";
import { restartDaemon } from "@/lib/daemon-ctl";
import { journal } from "@/lib/brain";
import { CHAINS, type ChainId } from "@/lib/steem-keys";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ops/vault/delegated — connect a RESCUE SOLDIER (operator-delegated).
//
// Some army accounts lost their own keys (factory master lost in a sandbox
// wipe), but the OPERATOR's posting key still controls their posting
// authority as an ACCOUNT AUTHORITY (posting.account_auths, weight ≥
// weight_threshold — public chain data). Such a soldier signs posting ops
// with the operator's posting WIF: `required_posting_auths=[him]`, signed by
// the operator — exactly the Task-57 rescue-anchor mechanism, no new secret
// is ever stored for him (mode: 'operator-delegated').
//
// The route PROVES the anchor live from the chains BEFORE storing anything:
//   1. the account exists on Steem/Hive (condenser get_accounts)
//   2. its posting.account_auths carries [operator, w] with w ≥ threshold
//   3. the operator's POSTING_WIF is armed in agent/.env (the signing voice)
//
// Then: vault entry (zero secrets) → fleet seal re-taken → daemon restart
// (ARMY reloads → the soldier joins claims / curation / fleet loops at once).
//
// Idempotent: re-connecting refreshes the verification timestamps.
// ─────────────────────────────────────────────────────────────────────────────

interface PostingAuthProbe {
  exists: boolean | null; // null = RPC answered nothing usable
  verified: boolean;
  weight: number | null;
  threshold: number | null;
}

async function probePostingAuth(
  chain: ChainId,
  account: string,
  operator: string,
): Promise<PostingAuthProbe> {
  const out: PostingAuthProbe = { exists: null, verified: false, weight: null, threshold: null };
  const cfg = CHAINS.find((c) => c.id === chain);
  if (!cfg) return out;
  let result: unknown = null;
  // 2 passes over the endpoint list — same degradation philosophy as
  // steem-keys.rpcFirst: a dead RPC is "no answer", never a false match.
  for (let pass = 0; pass < 2 && result == null; pass++) {
    for (const url of cfg.endpoints) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9_000);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "condenser_api.get_accounts",
            params: [[account]],
            id: 1,
          }),
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!res.ok) continue;
        const json = (await res.json()) as { result?: unknown };
        if (json && Array.isArray(json.result)) {
          result = json.result;
          break;
        }
      } catch {
        // try next endpoint / next pass
      } finally {
        clearTimeout(t);
      }
    }
  }
  if (!Array.isArray(result)) return out;
  if (result.length === 0) {
    out.exists = false;
    return out;
  }
  out.exists = true;
  const acc = result[0] as {
    posting?: { weight_threshold?: number; account_auths?: [string, number][] };
  };
  const threshold = acc.posting?.weight_threshold ?? null;
  const hit = (acc.posting?.account_auths ?? []).find(
    ([name]) => String(name).toLowerCase() === operator,
  );
  out.threshold = threshold;
  out.weight = hit ? hit[1] : null;
  out.verified = Boolean(hit && threshold != null && hit[1] >= threshold);
  return out;
}

export async function POST(req: NextRequest) {
  let body: { username?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const env = readAgentEnv();
  const operator = (env.AGENT_ACCOUNT || "headcorner").replace(/^@/, "").toLowerCase();
  const username = (body.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9\-.]{3,16}$/.test(username)) {
    return NextResponse.json({ ok: false, error: "שם חשבון לא תקין" }, { status: 400 });
  }
  if (username === operator) {
    return NextResponse.json(
      { ok: false, error: "החשבון הראשי אינו נרשם כחייל-מואצל — הוא כבר הקול החותם" },
      { status: 400 },
    );
  }
  if (!env.POSTING_WIF) {
    return NextResponse.json(
      { ok: false, error: "אין POSTING_WIF חמוש בכספת — אין קול-חתימה לחייל-מואצל" },
      { status: 409 },
    );
  }

  // ── the deductive gate: prove the anchor from the chains, live ────────────
  const [steem, hive] = await Promise.all([
    probePostingAuth("steem", username, operator),
    probePostingAuth("hive", username, operator),
  ]);
  const chains: Record<string, PostingAuthProbe> = { steem, hive };
  const verifiedOn = (Object.keys(chains) as ChainId[]).filter((c) => chains[c].verified);

  if (steem.exists === false && hive.exists === false) {
    return NextResponse.json(
      { ok: false, error: `@${username} לא נמצא באף שרשרת (Steem+Hive)`, chains },
      { status: 404 },
    );
  }
  if (verifiedOn.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `עוגן-הפוסטינג לא אומת: סמכות-הפוסטינג של @${username} אינה נושאת את @${operator} במשקל-סף (נבדק מהשרשרת — אין ניחושים)`,
        chains,
      },
      { status: 409 },
    );
  }

  // ── store (zero secrets — the entry has no keys at all) ───────────────────
  const existing = readArmyVault().accounts.find(
    (a) => a.username.toLowerCase() === username,
  );
  const now = new Date().toISOString();
  upsertArmyEntry({
    username,
    tier: "operator",
    mode: "operator-delegated",
    keys: {},
    chains: Object.fromEntries(verifiedOn.map((c) => [c, ["posting" as const]])),
    infra: { ...(existing?.infra ?? {}), postingAuthAt: now },
    addedAt: existing?.addedAt ?? now,
    syncedAt: now,
  });

  // ── re-take the fleet seal NOW (deterministic; guardian auto-reseal is the
  //    backstop) so the new soldier survives every sandbox reset zero-touch ──
  let sealed = false;
  try {
    execFileSync(process.execPath, ["fleet_vault.cjs", "--seal"], {
      cwd: AGENT_DIR,
      timeout: 30_000,
      stdio: "pipe",
    });
    sealed = true;
  } catch {
    sealed = false; // honest: guardian's keys-newer trigger will reseal anyway
  }

  const rd = await restartDaemon();
  const armySize = readArmyVault().accounts.length + 1; // + primary

  journal(
    "army_vault",
    `חייל-מואצל חובר: @${username} — עוגן-פוסטינג אומת מהשרשרת (${verifiedOn.join("+")}: @${operator} בסמכות-הפוסטינג במשקל-סף) · חותם דרך הפוסטינג של הראשי · אפס-סודות-חדשים`,
    `verified: ${verifiedOn.join(",")} · seal: ${sealed ? "re-taken" : "guardian-will-reseal"} · daemon restarted: ${rd.restarted} · army(inc-primary): ${armySize}`,
  );

  return NextResponse.json({
    ok: true,
    username,
    operator,
    chains,
    verifiedOn,
    alreadyConnected: existing?.mode === "operator-delegated",
    sealed,
    daemonRestarted: rd.restarted,
    armySize,
  });
}

/** GET — idempotent status probe for the console (no side effects). */
export async function GET(req: NextRequest) {
  const username = (new URL(req.url).searchParams.get("username") ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  const env = readAgentEnv();
  const operator = (env.AGENT_ACCOUNT || "headcorner").replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9\-.]{3,16}$/.test(username)) {
    return NextResponse.json({ ok: false, error: "שם חשבון לא תקין" }, { status: 400 });
  }
  const [steem, hive] = await Promise.all([
    probePostingAuth("steem", username, operator),
    probePostingAuth("hive", username, operator),
  ]);
  const connected = readArmyVault().accounts.some(
    (a) => a.username.toLowerCase() === username && a.mode === "operator-delegated",
  );
  return NextResponse.json({
    ok: true,
    username,
    operator,
    chains: { steem, hive },
    connected,
  });
}
