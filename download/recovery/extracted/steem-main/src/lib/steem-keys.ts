import { AGENT_DIR } from "@/lib/agent-env";

// ─────────────────────────────────────────────────────────────────────────────
// steem-keys.ts — the sovereign key engine.
//
// ONE master password → the full key set. In Steem/Hive/Blurt (same crypto,
// same derivation), a role key is deterministically derived from the account
// creation password:  WIF = base58check(0x80 ‖ sha256(username + role + password)).
// So the operator pastes ONE secret; we derive owner/active/posting/memo,
// derive each public key locally, and compare against what the chains
// actually publish in the account authorities (public data — no secrets).
//
// Three chains are probed: Steem, Hive, Blurt — all forks sharing the same
// key derivation, so one paste proves which territories the master key
// already controls.
//
// Iron rules (same as brain.ts vault):
//   - The master password is used in-memory only: never stored, never logged,
//     never returned. Responses carry public fingerprints at most.
//   - A role is stored ONLY when its derived public key matches the live
//     on-chain authority on Steem (the execution chain). No match → no store.
//   - Everything here degrades gracefully: a dead RPC is "no answer", never
//     a false match.
// ─────────────────────────────────────────────────────────────────────────────

export type KeyRole = "owner" | "active" | "posting" | "memo";
export const ALL_ROLES: KeyRole[] = ["owner", "active", "posting", "memo"];

export type ChainId = "steem" | "hive" | "blurt";
export const CHAINS: { id: ChainId; label: string; endpoints: string[] }[] = [
  { id: "steem", label: "Steem", endpoints: ["https://api.steemit.com", "https://api.justyy.com"] },
  { id: "hive", label: "Hive", endpoints: ["https://api.hive.blog", "https://api.openhive.network"] },
  { id: "blurt", label: "Blurt", endpoints: ["https://blurt-rpc.saboin.com", "https://rpc.blurt.world"] },
];

export interface ChainAccount {
  ok: boolean;
  exists: boolean | null; // null = RPC answered nothing usable
  posting?: string | null;
  active?: string | null;
  owner?: string | null;
  memoKey?: string | null;
  /** liquid + vesting strings for downstream engines */
  balances?: Record<string, string> | null;
}

interface RpcAccountShape {
  posting?: { key_auths?: [string, ...unknown[]][] };
  active?: { key_auths?: [string, ...unknown[]][] };
  owner?: { key_auths?: [string, ...unknown[]][] };
  memo_key?: string;
  balance?: string;
  savings_balance?: string;
  vesting_shares?: string;
  hbd_balance?: string;
  savings_hbd_balance?: string;
}

async function rpcFirst(
  endpoints: string[],
  body: unknown,
  timeoutMs = 9_000,
): Promise<unknown | null> {
  // Blurt-class community nodes answer intermittently (~60%), and they fail
  // FAST (~300ms) — so up to 3 passes over the endpoint list: cheap passes
  // when a mirror is down, still bounded when one hangs.
  for (let pass = 0; pass < 3; pass++) {
    for (const url of endpoints) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!res.ok) continue;
        const json = (await res.json()) as { result?: unknown };
        if (json && Array.isArray(json.result)) return json.result;
      } catch {
        // try next endpoint / next pass
      } finally {
        clearTimeout(t);
      }
    }
  }
  return null;
}

/** Fetch an account from one chain via condenser get_accounts. */
export async function fetchChainAccount(chain: ChainId, username: string): Promise<ChainAccount> {
  const cfg = CHAINS.find((c) => c.id === chain);
  if (!cfg) return { ok: false, exists: null };
  const result = await rpcFirst(cfg.endpoints, {
    jsonrpc: "2.0",
    method: "condenser_api.get_accounts",
    params: [[username]],
    id: 1,
  });
  if (!Array.isArray(result) || result.length === 0) {
    // A well-formed RPC answer with an empty array means the account does
    // not exist on that chain — that IS an answer (unlike a dead endpoint).
    return { ok: Array.isArray(result), exists: Array.isArray(result) ? false : null };
  }
  const acc = result[0] as RpcAccountShape;
  return {
    ok: true,
    exists: true,
    posting: acc.posting?.key_auths?.[0]?.[0] ?? null,
    active: acc.active?.key_auths?.[0]?.[0] ?? null,
    owner: acc.owner?.key_auths?.[0]?.[0] ?? null,
    memoKey: acc.memo_key ?? null,
    balances: {
      balance: acc.balance ?? "0",
      savings_balance: acc.savings_balance ?? "0",
      vesting_shares: acc.vesting_shares ?? "0 VESTS",
      hbd_balance: acc.hbd_balance ?? "0",
      savings_hbd_balance: acc.savings_hbd_balance ?? "0",
    },
  };
}

// ── derivation (steem lib — same code path the chains document) ──────────────

interface SteemAuth {
  getPrivateKeys: (u: string, p: string, roles?: string[]) => Record<string, string>;
  wifToPublic: (w: string) => string;
}

async function steemAuth(): Promise<SteemAuth | null> {
  try {
    const mod = await import("steem");
    return ((mod.default ?? mod) as { auth: SteemAuth }).auth;
  } catch {
    return null;
  }
}

export interface DerivedRole {
  role: KeyRole;
  wif: string; // INTERNAL ONLY — never serialized to a response
  pub: string; // STM… public key
}

/** Derive the full role set from one master password (in-memory only). */
export async function deriveAllRoles(username: string, master: string): Promise<DerivedRole[] | null> {
  const auth = await steemAuth();
  if (!auth) return null;
  const wifs = auth.getPrivateKeys(username.trim().replace(/^@/, ""), master, ALL_ROLES);
  return ALL_ROLES.map((role) => ({
    role,
    wif: wifs[role],
    pub: auth.wifToPublic(wifs[role]),
  }));
}

export async function wifToPub(wif: string): Promise<string | null> {
  const auth = await steemAuth();
  if (!auth) return null;
  try {
    return auth.wifToPublic(wif);
  } catch {
    return null;
  }
}

// ── matrix building ──────────────────────────────────────────────────────────

export function maskPub(pub: string | null | undefined): string {
  if (!pub) return "—";
  return pub.length > 14 ? `${pub.slice(0, 8)}…${pub.slice(-4)}` : pub;
}

export interface RoleMatch {
  role: KeyRole;
  derivedPub: string;
  derivedMask: string;
  match: Partial<Record<ChainId, boolean | null>>; // null = chain unanswered
  /** true when the derived key controls the role on Steem (execution chain) */
  steemControls: boolean;
}

export function buildRoleMatches(
  derived: DerivedRole[],
  chains: Record<ChainId, ChainAccount>,
): RoleMatch[] {
  return derived.map((d) => {
    const match: RoleMatch["match"] = {};
    for (const c of CHAINS) {
      const acc = chains[c.id];
      if (!acc?.exists) {
        match[c.id] = acc?.exists === false ? false : null;
        continue;
      }
      const chainPub =
        d.role === "memo" ? acc.memoKey ?? null : d.role === "owner" ? acc.owner ?? null : d.role === "active" ? acc.active ?? null : acc.posting ?? null;
      match[c.id] = chainPub ? chainPub === d.pub : null;
    }
    return {
      role: d.role,
      derivedPub: d.pub,
      derivedMask: maskPub(d.pub),
      match,
      steemControls: match.steem === true,
    };
  });
}

// ── stored-state reading (no secrets cross this boundary) ────────────────────

export interface StoredRole {
  role: KeyRole;
  pubMask: string;
}

export function readStoredRoles(env: Record<string, string>): StoredRole[] {
  const out: StoredRole[] = [];
  for (const role of ALL_ROLES) {
    const pub = env[`${role.toUpperCase()}_WIF_PUB`];
    const wif = env[`${role.toUpperCase()}_WIF`];
    if (wif && pub) out.push({ role, pubMask: maskPub(pub) });
  }
  return out;
}

export function agentDir(): string {
  return AGENT_DIR;
}
