import fs from "fs";
import path from "path";

import { AGENT_DIR } from "@/lib/agent-env";
import { maskPub, type ChainId, type KeyRole } from "@/lib/steem-keys";

// ─────────────────────────────────────────────────────────────────────────────
// army-vault.ts — the multi-account sovereign vault (agent/keys/vault.json).
//
// The primary account (headcorner) signs from agent/.env — unchanged. Every
// FURTHER account the operator connects with username + master password is
// derived, chain-validated and stored HERE, one entry per account, so the
// daemon can arm an economic army: per-account claim / curation / sweep.
//
// Iron rules (inherited from the key engine):
//   - secrets live ONLY in agent/keys/vault.json (git-ignored, machine-local)
//   - a role is stored ONLY when its derived public key equals the live Steem
//     authority (execution chain). No match → no store.
//   - everything crossing this module's boundary to HTTP is masked.
//   - atomic writes (tmp → rename); corrupt file = empty vault, never a crash.
// ─────────────────────────────────────────────────────────────────────────────

export const ARMY_VAULT_PATH = path.join(AGENT_DIR, "keys", "vault.json");

export interface ArmyVaultKey {
  wif: string;
  pub: string;
}

export interface ArmyVaultEntry {
  username: string;
  tier: "operator";
  mode: string;
  keys: Partial<Record<KeyRole, ArmyVaultKey>>;
  /** roles that provably match on each chain (from the connect-time probe) */
  chains: Partial<Record<ChainId, KeyRole[]>>;
  /** SCI hardening results recorded when the operator's power was embedded */
  infra?: {
    recoverySetAt?: string;
    recoveryTxid?: string;
    postingAuthAt?: string;
    postingAuthTxid?: string;
    rcDelegatedAt?: string;
    rcDelegatedVests?: string;
  };
  addedAt: string;
  syncedAt: string;
}

export interface ArmyVaultFile {
  accounts: ArmyVaultEntry[];
}

export function readArmyVault(): ArmyVaultFile {
  try {
    const raw = JSON.parse(fs.readFileSync(ARMY_VAULT_PATH, "utf8")) as ArmyVaultFile;
    if (raw && Array.isArray(raw.accounts)) return { accounts: raw.accounts };
    return { accounts: [] };
  } catch {
    return { accounts: [] };
  }
}

function writeArmyVault(file: ArmyVaultFile): void {
  fs.mkdirSync(path.dirname(ARMY_VAULT_PATH), { recursive: true });
  const tmp = `${ARMY_VAULT_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, ARMY_VAULT_PATH);
}

export function upsertArmyEntry(entry: ArmyVaultEntry): void {
  const file = readArmyVault();
  const username = entry.username.toLowerCase();
  const rest = file.accounts.filter((a) => a.username.toLowerCase() !== username);
  rest.push({ ...entry, username });
  rest.sort((a, b) => a.username.localeCompare(b.username));
  writeArmyVault({ accounts: rest });
}

export function deleteArmyEntry(username: string): boolean {
  const file = readArmyVault();
  const next = file.accounts.filter((a) => a.username.toLowerCase() !== username.toLowerCase());
  if (next.length === file.accounts.length) return false;
  writeArmyVault({ accounts: next });
  return true;
}

/** Merge SCI hardening evidence into an army entry (idempotent). */
export function updateArmyInfra(
  username: string,
  infra: NonNullable<ArmyVaultEntry["infra"]>,
): void {
  const file = readArmyVault();
  const entry = file.accounts.find((a) => a.username.toLowerCase() === username.toLowerCase());
  if (!entry) return;
  entry.infra = { ...(entry.infra ?? {}), ...infra };
  entry.syncedAt = new Date().toISOString();
  writeArmyVault(file);
}

// ── masked views (HTTP-safe) ─────────────────────────────────────────────────

export interface ArmyAccountView {
  username: string;
  /** 'master-derive' | 'wif' | 'operator-delegated' (rescue anchor, signs via the operator) */
  mode: string;
  roles: { role: KeyRole; pubMask: string }[];
  chains: Partial<Record<ChainId, KeyRole[]>>;
  addedAt: string;
  syncedAt: string;
}

export function listArmyAccounts(): ArmyAccountView[] {
  return readArmyVault().accounts.map((a) => ({
    username: a.username,
    mode: a.mode ?? "master-derive",
    roles: Object.entries(a.keys ?? {})
      .filter(([, k]) => Boolean(k?.pub))
      .map(([role, k]) => ({ role: role as KeyRole, pubMask: maskPub(k!.pub) }))
      .sort((x, y) => x.role.localeCompare(y.role)),
    chains: a.chains ?? {},
    addedAt: a.addedAt ?? "",
    syncedAt: a.syncedAt ?? "",
  }));
}

/** All army usernames (vault accounts only — factory agents are read daemon-side). */
export function armyUsernames(): string[] {
  return readArmyVault().accounts.map((a) => a.username.toLowerCase());
}
