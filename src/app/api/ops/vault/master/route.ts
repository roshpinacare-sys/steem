import { NextRequest, NextResponse } from "next/server";

import { readAgentEnv, upsertAgentEnv } from "@/lib/agent-env";
import { updateArmyInfra, upsertArmyEntry, readArmyVault, type ArmyVaultEntry } from "@/lib/army-vault";
import { restartDaemon } from "@/lib/daemon-ctl";
import { journal } from "@/lib/brain";
import {
  ALL_ROLES,
  CHAINS,
  buildRoleMatches,
  deriveAllRoles,
  fetchChainAccount,
  maskPub,
  type ChainId,
  type KeyRole,
} from "@/lib/steem-keys";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ops/vault/master  —  ONE paste → the full key set.
//
// body: { username?, master, store?: KeyRole[] }
//
// The operator pastes ONE secret. Two accepted shapes:
//   1. Master password (account-creation password) → we derive
//      owner/active/posting/memo locally (sha256(username+role+password) →
//      WIF, the documented chain derivation) and compare each derived PUBLIC
//      key against what Steem/Hive/Blurt publish in the authorities.
//   2. A single WIF (5J…) → we derive its public key and match it against
//      every role authority on every chain; matched roles are storeable.
//
// Storage rules (iron):
//   - A role is stored ONLY when its public key equals the live Steem
//     authority for that role (or memo_key for memo). No match → no store.
//   - The PRIMARY account (AGENT_ACCOUNT) lives in agent/.env — unchanged.
//   - Every OTHER account (username ≠ primary) becomes an ARMY account:
//     stored per-account in agent/keys/vault.json (git-ignored, machine-local)
//     so the daemon arms per-account loops (claim / curation / sweep).
//   - After a successful store the daemon restarts so the loops arm.
// ─────────────────────────────────────────────────────────────────────────────

const WIF_RE = /^[5][1-9A-HJ-NP-Za-km-z]{50}$/;

/**
 * SCI connect-time hardening (Task 44) — the ONLY moment we hold the new
 * account's owner key in memory: use it to point recovery_account at the
 * operator (set_reset_account, owner-signed). If the account is ever
 * compromised/lost, the operator can recover it after the 30-day delay.
 * Steem-only (Hive op-ids diverged post-fork — dhive roadmap).
 * Best-effort: any failure is reported, never blocks the connection.
 */
async function hardenRecovery(
  username: string,
  ownerWif: string | undefined,
): Promise<{ recovery: string; txid?: string; error?: string }> {
  const operator = (process.env.AGENT_ACCOUNT || "headcorner").toLowerCase();
  let currentRecovery: string | null = null;
  try {
    const mod = await import("steem");
    const steem = (mod.default ?? mod) as typeof import("steem");
    steem.api.setOptions({ url: process.env.RPC_URL || "https://api.steemit.com" });
    const accs = (await steem.api.getAccountsAsync([username])) as Array<{
      recovery_account?: string;
    }>;
    currentRecovery = accs?.[0]?.recovery_account ?? null;
    if (!ownerWif) return { recovery: currentRecovery ?? "?", error: "owner key unavailable" };
    if (currentRecovery === operator) return { recovery: operator };
    const conf = await steem.broadcast.sendAsync(
      {
        operations: [
          [
            "set_reset_account",
            { account: username, current_reset_account: currentRecovery ?? "", reset_account: operator },
          ],
        ],
        extensions: [],
      },
      [ownerWif],
    );
    return { recovery: operator, txid: (conf as { id?: string })?.id ?? undefined };
  } catch (e) {
    return { recovery: currentRecovery ?? "?", error: String((e as Error).message || e).slice(0, 140) };
  }
}

const ENV_KEY: Record<KeyRole, string> = {
  owner: "OWNER_WIF",
  active: "ACTIVE_WIF",
  posting: "POSTING_WIF",
  memo: "MEMO_WIF",
};

/**
 * Task 58 — auto-resurrection hook.
 * When the operator pastes the master password for ANY account, we silently
 * re-try every operator-delegated (rescue-mode) army entry with the SAME
 * secret. The rescued accounts' on-chain keys were derived from the factory
 * master — so if this paste derives them 4/4 on BOTH chains, the pasted
 * password IS the factory master, and we:
 *   1. upgrade the entry to full master-derive sovereignty (all 4 keys),
 *   2. restore FACTORY_MASTER into agent/.env (git-ignored) so deterministic
 *      key-derivation ("keys are never lost again") is armed again,
 *   3. restart the daemon so the soldier wakes up fully armed.
 * Only PUBLIC masked data ever reaches the response/journal.
 */
async function attemptResurrections(
  secret: string,
  skipUsername: string,
): Promise<{ resurrected: string[]; factoryMasterRestored: boolean }> {
  const out = { resurrected: [] as string[], factoryMasterRestored: false };
  try {
    const vault = readArmyVault();
    const candidates = vault.accounts.filter(
      (a) =>
        a.mode === "operator-delegated" &&
        a.username.toLowerCase() !== skipUsername.toLowerCase(),
    );
    for (const cand of candidates) {
      const derived = await deriveAllRoles(cand.username, secret);
      if (!derived) continue;
      const [steemAcc, hiveAcc] = await Promise.all([
        fetchChainAccount("steem", cand.username),
        fetchChainAccount("hive", cand.username),
      ]);
      const chains = { steem: steemAcc, hive: hiveAcc, blurt: steemAcc } as unknown as Record<
        ChainId,
        Awaited<ReturnType<typeof fetchChainAccount>>
      >;
      const matches = buildRoleMatches(derived, chains);
      const fullSteem = matches.every((m) => m.steemControls);
      const fullHive = matches.every((m) => m.match.hive === true);
      if (!fullSteem || !fullHive) continue;
      // 4/4 × 2 chains — the pasted password IS the factory master.
      const now = new Date().toISOString();
      upsertArmyEntry({
        username: cand.username,
        tier: "operator",
        mode: "master-derive",
        keys: Object.fromEntries(
          derived.map((d) => [
            d.role,
            {
              wif: d.wif,
              pub:
                d.role === "memo"
                  ? steemAcc.memoKey ?? ""
                  : d.role === "owner"
                    ? steemAcc.owner ?? ""
                    : d.role === "active"
                      ? steemAcc.active ?? ""
                      : steemAcc.posting ?? "",
            },
          ]),
        ) as ArmyVaultEntry["keys"],
        chains: { steem: ALL_ROLES, hive: ALL_ROLES },
        addedAt: cand.addedAt,
        syncedAt: now,
        infra: cand.infra,
      });
      journal(
        "army_vault",
        `תחיית-@${cand.username}: ארבעת התפקידים נגזרו מהסיסמה שהודבקה ואומתו 4/4 ×2 שרשראות — ריבונות-מלאה הושבה (owner/active חזרו לשליטתנו)`,
        `mode: operator-delegated → master-derive · entry upgraded machine-local · secrets never left this machine`,
      );
      out.resurrected.push(cand.username);
    }
    if (out.resurrected.length > 0) {
      // The paste derived factory keys → it IS FACTORY_MASTER. Restore it so
      // deterministic derivation (factory_v2 / re-derivable identities) is armed.
      const env = readAgentEnv();
      if (!env.FACTORY_MASTER) {
        upsertAgentEnv({ FACTORY_MASTER: secret, FACTORY_MASTER_SYNC_AT: new Date().toISOString() });
        out.factoryMasterRestored = true;
        journal(
          "key_vault",
          `מפתח-המפעל נסקר מחדש דרך תחיית-${out.resurrected.join(",")} — FACTORY_MASTER חזר ל-.env: מפעל-הגזירה-הדטרמיניסטית מתקבע ("המפתחות לעולם לא אובדים")`,
          `restored machine-local (agent/.env, git-ignored) · verified by 4/4×2 chain match`,
        );
      }
      await restartDaemon();
    }
  } catch {
    // best-effort — never block the primary connect flow
  }
  return out;
}

export async function POST(req: NextRequest) {
  let body: { username?: string; master?: string; store?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const env = readAgentEnv();
  const username = (body.username ?? env.AGENT_ACCOUNT ?? "headcorner")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  const secret = (body.master ?? "").trim();
  if (secret.length < 20) {
    return NextResponse.json(
      { ok: false, error: "הקלט קצר מדי — הדבק סיסמת-אב או מפתח WIF" },
      { status: 400 },
    );
  }

  // Probe all three chains in parallel (public authority data).
  const chainIds = CHAINS.map((c) => c.id);
  const chainList = await Promise.all(chainIds.map((id) => fetchChainAccount(id, username)));
  const chains = Object.fromEntries(chainIds.map((id, i) => [id, chainList[i]])) as Record<
    ChainId,
    Awaited<ReturnType<typeof fetchChainAccount>>
  >;

  const steem = chains.steem;
  if (!steem.exists) {
    return NextResponse.json(
      { ok: false, error: `החשבון @${username} לא נמצא ב-Steem — בדוק שם משתמש` },
      { status: 400 },
    );
  }

  // ── derive / match ────────────────────────────────────────────────────────
  /* P5… = פורמט-גרפן (P + WIF) — מנורמל ל-WIF רגיל לפני-זיהוי/גזירה/אחסון (R18b) */
  const wifNormalized = secret.replace(/^P(?=[5JKL][1-9A-HJ-NP-Za-km-z]{50})/, "");
  const isWif = WIF_RE.test(wifNormalized);
  let matches;
  const wifFor: Partial<Record<KeyRole, string>> = {};
  let ephemeralOwnerWif: string | undefined;

  if (isWif) {
    // Single-WIF paste: one private key may control several roles/chains.
    let pub: string;
    try {
      const mod = await import("steem");
      pub = derivePubQuietly(wifNormalized, (w) => (mod.default ?? mod).auth.wifToPublic(w)) ?? "";
    } catch {
      return NextResponse.json({ ok: false, error: "WIF לא תקין" }, { status: 400 });
    }
    const rolePub: Record<KeyRole, string | null> = {
      owner: steem.owner ?? null,
      active: steem.active ?? null,
      posting: steem.posting ?? null,
      memo: steem.memoKey ?? null,
    };
    const hiveRolePub = (role: KeyRole): string | null =>
      role === "memo"
        ? chains.hive.memoKey ?? null
        : role === "owner"
          ? chains.hive.owner ?? null
          : role === "active"
            ? chains.hive.active ?? null
            : chains.hive.posting ?? null;
    matches = (["owner", "active", "posting", "memo"] as KeyRole[]).map((role) => ({
      role,
      derivedMask: maskPub(pub),
      match: {
        steem: rolePub[role] ? rolePub[role] === pub : null,
        hive: chains.hive.exists != null ? hiveRolePub(role) === pub : null,
        blurt: null,
      },
      steemControls: rolePub[role] === pub,
    }));
    for (const m of matches) if (m.steemControls) wifFor[m.role] = wifNormalized;
    if (matches.find((m) => m.role === "owner")?.steemControls) ephemeralOwnerWif = wifNormalized;
  } else {
    const derived = await deriveAllRoles(username, secret);
    if (!derived) {
      return NextResponse.json(
        { ok: false, error: "מנוע הגזירה המקומי אינו זמין — נסה שוב" },
        { status: 500 },
      );
    }
    matches = buildRoleMatches(derived, chains);
    for (const d of derived) {
      const m = matches.find((x) => x.role === d.role);
      if (m?.steemControls) wifFor[d.role] = d.wif;
      if (d.role === "owner" && m?.steemControls) ephemeralOwnerWif = d.wif;
    }
  }

  const matchedRoles = matches.filter((m) => m.steemControls).map((m) => m.role);

  // ── optional store ────────────────────────────────────────────────────────
  const stored: { role: KeyRole; pubMask: string }[] = [];
  let daemonRestarted = false;
  let storedError: string | null = null;
  const isPrimary = username === (env.AGENT_ACCOUNT ?? "headcorner").toLowerCase();

  if (Array.isArray(body.store) && body.store.length > 0) {
    const wanted = body.store.filter(
      (r): r is KeyRole => r === "owner" || r === "active" || r === "posting" || r === "memo",
    );
    const chainPubFor = (role: KeyRole): string =>
      role === "memo"
        ? steem.memoKey ?? ""
        : role === "owner"
          ? steem.owner ?? ""
          : role === "active"
            ? steem.active ?? ""
            : steem.posting ?? "";

    const storable = wanted.filter(
      (role) => matchedRoles.includes(role) && wifFor[role] && chainPubFor(role),
    );

    if (isPrimary) {
      const updates: Record<string, string> = { AGENT_ACCOUNT: username };
      for (const role of storable) {
        const wif = wifFor[role] as string;
        const chainPub = chainPubFor(role);
        updates[ENV_KEY[role]] = wif;
        updates[`${ENV_KEY[role]}_PUB`] = chainPub;
        stored.push({ role, pubMask: maskPub(chainPub) });
      }
      if (stored.length > 0) {
        updates.VAULT_MASTER_SYNC_AT = new Date().toISOString();
        updates.VAULT_MODE = "master-derive";
        upsertAgentEnv(updates);
        await journal(
          "key_vault",
          `חיבור מפתח-ראשי (ראשי): ${stored.map((s) => s.role).join(" + ")} נגזרו ואומתו מול השרשרת (${stored
            .map((s) => s.pubMask)
            .join(", ")})`,
          `chains probed: ${chainIds.join(", ")} · hive match: ${
            matches.filter((m) => m.match.hive === true).map((m) => m.role).join(",") || "—"
          } · secrets stay machine-local`,
        );
        const rd = await restartDaemon();
        daemonRestarted = rd.restarted;
      } else {
        storedError = "אף תפקיד שנבחר לא אומת מול השרשרת — לא נשמר כלום";
      }
    } else {
      // ── ARMY branch: per-account entry in agent/keys/vault.json ────────────
      for (const role of storable) {
        const chainPub = chainPubFor(role);
        stored.push({ role, pubMask: maskPub(chainPub) });
      }
      if (stored.length > 0) {
        const chainsMatch: Record<string, KeyRole[]> = {};
        for (const m of matches) {
          for (const c of chainIds) {
            if (m.match[c as ChainId] === true) {
              (chainsMatch[c] ??= []).push(m.role);
            }
          }
        }
        const now = new Date().toISOString();
        upsertArmyEntry({
          username,
          tier: "operator",
          mode: isWif ? "wif" : "master-derive",
          keys: Object.fromEntries(
            storable.map((role) => [role, { wif: wifFor[role] as string, pub: chainPubFor(role) }]),
          ),
          chains: chainsMatch,
          addedAt: now,
          syncedAt: now,
        });
        // ── SCI connect-time hardening: recovery_account → operator (owner-signed,
        //    ephemeral key, never stored). Best-effort — failure never blocks. ──
        const harden = await hardenRecovery(username, ephemeralOwnerWif);
        if (harden.txid) {
          updateArmyInfra(username, { recoverySetAt: new Date().toISOString(), recoveryTxid: harden.txid });
        }
        await journal(
          "army_vault",
          `חשבון-צבא חובר: @${username} — ${stored.map((s) => s.role).join(" + ")} נגזרו ואומתו מול השרשרת${
            harden.txid ? " · recovery_account הוצב עלינו (הקשחה ריבונית)" : ""
          }`,
          `chains match: ${Object.entries(chainsMatch).map(([c, rs]) => `${c}:${rs.join("/")}`).join(" · ") || "—"} · entry stored machine-local (keys/vault.json)${
            harden.error ? ` · hardening note: ${harden.error}` : ""
          }`,
        );
        const rd = await restartDaemon();
        daemonRestarted = rd.restarted;
        // Task 58 — auto-resurrection: the same paste may heal rescue-mode accounts
        const resurrection = !isWif
          ? await attemptResurrections(secret, username)
          : { resurrected: [], factoryMasterRestored: false };
        return NextResponse.json({
          ok: true,
          account: username,
          tier: "army",
          chains: serializeChains(chains),
          roles: matches,
          stored,
          storedError,
          daemonRestarted,
          hardening: harden,
          resurrection,
        });
      } else {
        storedError = "אף תפקיד שנבחר לא אומת מול השרשרת — לא נשמר כלום";
      }
    }
  }

  const resurrection = !isWif && matchedRoles.length > 0
    ? await attemptResurrections(secret, username)
    : { resurrected: [], factoryMasterRestored: false };

  return NextResponse.json({
    ok: true,
    account: username,
    tier: isPrimary ? "primary" : "army",
    chains: serializeChains(chains),
    roles: matches,
    stored,
    storedError,
    daemonRestarted,
    resurrection,
  });
}

function serializeChains(chains: Record<ChainId, Awaited<ReturnType<typeof fetchChainAccount>>>) {
  return Object.fromEntries(
    CHAINS.map(({ id, label }) => {
      const c = chains[id];
      return [
        id,
        {
          label,
          exists: c.exists,
          posting: maskPub(c.posting),
          active: maskPub(c.active),
          owner: maskPub(c.owner),
          memo: maskPub(c.memoKey),
        },
      ];
    }),
  );
}
