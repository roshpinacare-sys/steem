"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Console API layer — typed contracts + resilient polling hooks.
// Every hook degrades to null; the console never crashes on a dead endpoint.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";

// ─── /api/ops/agent/status (daemon) ─────────────────────────────────────────

export interface LoopState {
  lastRun: string;
  status: string;
  detail: string;
  counters?: Record<string, number>;
}

export interface IdentityState {
  evmAddress: string;
  steemPub: string;
  heTokens: number;
  heValueSwapHive: number;
  heSwapHive: number;
  heTop: { symbol: string; total: number }[];
}

export interface EmpireSummary {
  totalAccounts: number;
  steemCount: number;
  hiveCount: number;
  totalSP: number;
  totalHP: number;
  totalHive: number;
  totalHbd: number;
  totalSteem: number;
  controllableNow: number;
  heSwapHive: number;
}

export interface DexState {
  bestAsk: number | null;
  bestBid: number | null;
  spreadPct: number | null;
  supply: number;
  backingSteem: number;
  openOrders: number;
  creditsTotal: number;
  issuerLiquidSteem: number;
  escrowedTotal: number;
  lastAction: string;
}

export interface AgentStatus {
  updatedAt: string;
  account: string;
  dryRun: boolean;
  feed: number;
  bidTop: number | null;
  identity: IdentityState | null;
  pendingClaims: number;
  rc: { max: number; current: number; pct: number };
  army?: { size?: number; operator?: number; factory?: number; pendingSp?: number; sweptSteem?: number } | null;
  tickets: number;
  loops: Record<string, LoopState>;
  factory: { agents: string[] } | null;
  empire: { scannedAt: string; summary: EmpireSummary } | null;
  dex: DexState | null;
  fleet?: {
    size: number;
    lastPingBy: string | null;
    lastPingAt: string | null;
    lastTxid: string | null;
    routed: string | null;
    pingsToday: number;
  } | null;
}

export interface StatusResponse {
  configured: boolean;
  status?: AgentStatus;
}

// ─── /api/ops/brain ──────────────────────────────────────────────────────────

export interface BrainPlanItem {
  id: string;
  title: string;
  kind: string;
  status: string;
  requiredKey: string;
  expectedUsdMonth: string;
  why: string;
  how: string;
  actionLabel: string;
}

export interface BrainJournal {
  id: string;
  kind: string;
  title: string;
  detail: string;
  createdAt: string;
}

export interface BrainResponse {
  ok: boolean;
  inference?: {
    spOwn: number;
    spOwnUsd: number;
    vpPct: number;
    rcPct: number;
    pendingUsd: number;
    steemUsd: number;
    conclusion: string;
  };
  totals?: { activeUsdMonth: number; potentialUsdMonth: number };
  autonomy?: {
    keyConfigured: boolean;
    keyMasked: string;
    activeKeyInVault: boolean;
    activeKeyMasked: string;
    realMode: boolean;
    curationEnabled: boolean;
    heartbeatRunning: boolean;
    heartbeatIntervalMin: number;
    lastTickAt: string;
    lastTickNote: string;
    agentLastRunAt: string;
  };
  plan?: BrainPlanItem[];
  journal?: BrainJournal[];
}

// ─── /api/ops/agent/proofs ───────────────────────────────────────────────────

export interface ProofResult {
  name: string;
  pass: boolean;
  evidence: string;
}

/** כניסה במפת-ההוכחות הציבורית — יכולת → עדות על-השרשרת + דרך-אימות צד-שלישי */
export interface ProofMapEntry {
  cap: string;
  tier: "on-chain" | "proven-local" | "empirical" | "idea";
  chain: string;
  txid: string | null;
  verifier: string;
}

export interface ProofsResponse {
  exists: boolean;
  ageMs?: number;
  proofs?: {
    at: string;
    account: string;
    verdict: string;
    allPass: boolean;
    results: ProofResult[];
    map?: ProofMapEntry[];
  };
}

// ─── /api/ops/agent/exec ─────────────────────────────────────────────────────

export interface ExecRun {
  id: string;
  script: string;
  label: string;
  startedAt: string;
  real: boolean;
}

export interface ExecResponse {
  ok: boolean;
  runs: ExecRun[];
  results: Record<string, { at: string | null; file: string }>;
}

export interface ExecLogResponse {
  ok: boolean;
  lines: string[];
}

// ─── /api/ops/agent/log ──────────────────────────────────────────────────────

export interface DaemonLogResponse {
  ok: boolean;
  mtime: string | null;
  lines: string[];
}

// ─── /api/steem/live ─────────────────────────────────────────────────────────

export interface LiveResponse {
  ok: boolean;
  steemUsd?: number;
  fetchedAt?: string;
  chain?: { vest2sp: number; steemUsd: number; sbdUsd: number; headBlock: number };
  balances?: {
    steem: number;
    sbd: number;
    spOwn: number;
    spEffective: number;
    savingsSteem: number;
    savingsSbd: number;
    pendingSteem: number;
    pendingSbd: number;
    pendingSp: number;
    totalUsd: number;
  };
  power?: {
    votingPower: number;
    rcPct: number;
    fullVoteValueUsd: number;
    fullVotesPerDay: number;
  };
  yield?: {
    claimsReady: boolean;
    claimableUsd: number;
    curationApyLow: number;
    curationApyHigh: number;
    wastedVotesPerDay: number;
    wastedUsdPerYear: number;
    score: number;
    advice: string[];
  };
}

// ─── /api/ops/capital ────────────────────────────────────────────────────────

export interface CapitalEvent {
  id: string;
  kind: string;
  amountUsd: number;
  asset?: string;
  note?: string;
  occurredAt: string;
}

export interface CapitalResponse {
  events: CapitalEvent[];
  summary: {
    depositsUsd: number;
    resultsUsd: number;
    rewardsUsd: number;
    expensesUsd: number;
    netUsd: number;
    cycleCount: number;
  };
}

// ─── /api/ops/accounts ───────────────────────────────────────────────────────

export interface ManagedAccount {
  username: string;
  label?: string;
  role?: string;
  createdAt: string;
}

export interface AccountsResponse {
  ok: boolean;
  accounts: ManagedAccount[];
}

// ─── /api/ops/vault/* — the sovereign key vault ─────────────────────────────

export interface VaultChainInfo {
  id: string;
  label: string;
  exists: boolean | null; // null = RPC unanswered
  posting: string;
  active: string;
  owner: string;
  memo: string;
}

export interface VaultStoredRole {
  role: string;
  pubMask: string;
  controls: { steem: boolean | null; hive: boolean | null; blurt: boolean | null };
}

export interface VaultMatrixResponse {
  ok: boolean;
  account: string;
  accountExistsOnSteem: boolean | null;
  chains: VaultChainInfo[];
  stored: VaultStoredRole[];
  lastSyncAt: string | null;
  vaultMode: string | null;
  dryRun: boolean;
}

export interface MasterRoleMatch {
  role: string;
  derivedMask: string;
  match: { steem: boolean | null; hive: boolean | null; blurt: boolean | null };
  steemControls: boolean;
}

export interface MasterDeriveResponse {
  ok: boolean;
  error?: string;
  account?: string;
  tier?: "primary" | "army";
  chains?: Record<string, { label: string; exists: boolean | null; posting: string; active: string; owner: string; memo: string }>;
  roles?: MasterRoleMatch[];
  stored?: { role: string; pubMask: string }[];
  storedError?: string | null;
  daemonRestarted?: boolean;
}

export function useVaultMatrix(): VaultMatrixResponse | null {
  return usePoll<VaultMatrixResponse>("/api/ops/vault/matrix", 60000);
}

export async function deriveMaster(
  username: string,
  master: string,
  store: string[],
): Promise<MasterDeriveResponse> {
  try {
    const res = await fetch("/api/ops/vault/master", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, master, store }),
    });
    return (await res.json()) as MasterDeriveResponse;
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 140) };
  }
}

export async function wipeVaultRole(role: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/ops/vault/matrix?role=${encodeURIComponent(role)}`, {
      method: "DELETE",
    });
    return (await res.json()) as { ok: boolean; error?: string };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// ─── /api/ops/vault/accounts — the army roster (multi-account empire) ──────

export interface ArmyAccountView {
  username: string;
  /** 'master-derive' | 'wif' | 'operator-delegated' (rescue anchor — signs via the operator's posting key) */
  mode: string;
  roles: { role: string; pubMask: string }[];
  chains: Record<string, string[]>;
  addedAt: string;
  syncedAt: string;
}

export interface VaultAccountsResponse {
  ok: boolean;
  primary: string;
  army: ArmyAccountView[];
  factoryAgents: { username: string }[];
  counts: { primary: number; operator: number; factory: number; total: number };
}

/** Army roster with on-demand refetch (connect/disconnect refresh immediately). */
export function useVaultAccounts(): {
  data: VaultAccountsResponse | null;
  refetch: () => void;
} {
  const [data, setData] = useState<VaultAccountsResponse | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let mounted = true;
    const ctrl = new AbortController();
    getJson<VaultAccountsResponse>("/api/ops/vault/accounts", ctrl.signal).then((d) => {
      if (mounted && d != null) setData(d);
    });
    return () => {
      mounted = false;
      ctrl.abort();
    };
  }, [nonce]);
  return { data, refetch: () => setNonce((n) => n + 1) };
}

export async function deleteArmyAccount(
  username: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/ops/vault/accounts?username=${encodeURIComponent(username)}`, {
      method: "DELETE",
    });
    return (await res.json()) as { ok: boolean; error?: string };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// ─── /api/ops/vault/delegated — connect a rescue soldier (operator-delegated) ─

export interface DelegatedAuthProbe {
  exists: boolean | null;
  verified: boolean;
  weight: number | null;
  threshold: number | null;
}

export interface DelegatedConnectResponse {
  ok: boolean;
  error?: string;
  username?: string;
  operator?: string;
  chains?: Record<string, DelegatedAuthProbe>;
  verifiedOn?: string[];
  alreadyConnected?: boolean;
  sealed?: boolean;
  daemonRestarted?: boolean;
  armySize?: number;
}

/** Connect a rescue soldier — the server proves the posting account-authority
 *  from BOTH chains before storing anything (zero secrets). */
export async function connectDelegatedSoldier(
  username: string,
): Promise<DelegatedConnectResponse> {
  try {
    const res = await fetch("/api/ops/vault/delegated", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    return (await res.json()) as DelegatedConnectResponse;
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 140) };
  }
}

// ─── /api/ops/linkage — L9 אחדות-הצי (Task 87) ──────────────────────────────

export interface LinkageChain {
  exists: boolean;
  linked: boolean;
  weight: number | null;
  threshold: number | null;
  keysIntact: Record<string, boolean> | null;
}

export interface LinkageSoldier {
  username: string;
  mode: string;
  steem: LinkageChain;
  hive: LinkageChain;
  rc: { steem: number | null; hive: number | null };
  fixes: { chain?: string; skipped?: string; txid?: string | null; error?: string; rcPct?: number; rcHave?: number; rcNeed?: number }[];
}

export interface LinkageReport {
  at: string;
  head: string;
  layer: string;
  soldiersTotal: number;
  linkedChains: number;
  chainsTotal: number;
  allLinked: boolean;
  fixedNow: number;
  soldiers: LinkageSoldier[];
}

export interface LinkageResponse {
  ok: boolean;
  report?: LinkageReport;
  ageSec?: number | null;
  stale?: boolean;
  error?: string;
}

export function useLinkage(): LinkageResponse | null {
  return usePoll<LinkageResponse>("/api/ops/linkage", 90000);
}

export async function triggerLinkageFix(): Promise<{ ok: boolean; dispatched?: boolean; syncAudit?: boolean; error?: string }> {
  try {
    const res = await fetch("/api/ops/linkage", { method: "POST" });
    return (await res.json()) as { ok: boolean; dispatched?: boolean; syncAudit?: boolean; error?: string };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 140) };
  }
}

// ─── /api/ops/forkscan — same-key territory audit (Steem-family forks) ─────

export interface ForkAccountProbe {
  name: string;
  exists: boolean | null;
  liquid?: number;
  debt?: number;
  vests?: number;
  pending?: number;
}

export interface ForkProbe {
  id: string;
  label: string;
  alive: boolean;
  endpoint: string | null;
  headBlock: number | null;
  accounts: ForkAccountProbe[];
}

export interface ForkscanResponse {
  ok: boolean;
  scannedAt: string | null;
  accounts: string[];
  forks: ForkProbe[];
  summary: {
    forksProbed: number;
    forksAlive: number;
    chainsControlled: number;
    accountsControlled: number;
  } | null;
}

export function useForkscan(): ForkscanResponse | null {
  return usePoll<ForkscanResponse>("/api/ops/forkscan", 120000);
}

// ─── /api/ops/opportunities — the value-injection engine ────────────────────

export interface OpportunityItem {
  id: string;
  title: string;
  chain: string;
  tier: "proven" | "measured" | "empirical" | "idea";
  status: "ready" | "needs-key" | "dormant" | "watch" | "info";
  why: string;
  how: string;
  potentialUsdYear: number | null;
  facts: string;
}

export interface OpportunitiesResponse {
  ok: boolean;
  account: string;
  prices: { steemUsd: number; sbdUsd: number; hiveUsd: number; hbdUsd: number };
  rates: { steemSbdInterestPct: number; hiveHbdInterestPct: number };
  opportunities: OpportunityItem[];
  generatedAt: string;
  refreshSec: number;
}

export function useOpportunities(): OpportunitiesResponse | null {
  return usePoll<OpportunitiesResponse>("/api/ops/opportunities", 600000);
}

// ─── fetch helpers ───────────────────────────────────────────────────────────

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function usePoll<T>(url: string, intervalMs: number, enabled = true): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const ctrl = new AbortController();
    const tick = () => {
      getJson<T>(url, ctrl.signal).then((d) => {
        if (mounted && d != null) setData(d);
      });
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      mounted = false;
      clearTimeout(first);
      ctrl.abort();
      clearInterval(id);
    };
  }, [url, intervalMs, enabled]);
  return data;
}

/** Force a re-render every `ms` — relative ages/clocks visibly tick, so the
 *  operator can SEE the console updating even between data changes. */
export function useTick(ms = 1000): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

// ─── chain heartbeat — SAOS-NET height, lightly polled, globally visible ─────

interface ChainBeatSummary {
  height: number;
  beats: number;
}

interface ChainBeatResponse {
  ok: boolean;
  ready: boolean;
  at: string;
  summary: ChainBeatSummary;
}

export interface ChainBeat extends ChainBeatResponse {
  ageSec: number | null;
}

/** SAOS-NET pulse: sovereign height + how long ago the chain beat.
 *  Re-renders every second so the age visibly ticks down toward the next poll. */
export function useChainBeat(): ChainBeat | null {
  const d = usePoll<ChainBeatResponse>("/api/ops/sovexplorer?limit=1", 20000);
  useTick(1000);
  if (!d) return null;
  const ageSec = d.at
    ? Math.max(0, Math.floor((Date.now() - new Date(d.at).getTime()) / 1000))
    : null;
  return { ...d, ageSec };
}

// ─── hooks ───────────────────────────────────────────────────────────────────

export function useStatus(): AgentStatus | null {
  const d = usePoll<StatusResponse>("/api/ops/agent/status", 15000);
  return d?.status ?? null;
}

export function useBrain(): BrainResponse | null {
  return usePoll<BrainResponse>("/api/ops/brain?username=headcorner", 30000);
}

export function useLive(): LiveResponse | null {
  return usePoll<LiveResponse>("/api/steem/live?username=headcorner", 60000);
}

export function useCapital(): CapitalResponse | null {
  return usePoll<CapitalResponse>("/api/ops/capital", 60000);
}

export function useAccounts(): AccountsResponse | null {
  return usePoll<AccountsResponse>("/api/ops/accounts", 60000);
}

export function useDaemonLog(enabled: boolean): DaemonLogResponse | null {
  return usePoll<DaemonLogResponse>("/api/ops/agent/log", 8000, enabled);
}

/* ── 49 — תעסוקת-צבא: מסילת-דלק + מסדר + סולם-גיוס-הון ─────────────────── */

export interface EmploymentSoldier {
  username: string;
  credit: number;
  saos: number;
  lpShares: number | null;
  escrowMuster: number | null;
  escrowTxid: string | null;
  escrowToday: number;
}

export interface EmploymentResponse {
  ok: boolean;
  at: string;
  fuel: {
    at: string;
    mode: string;
    spPerSoldier: number;
    vestsPerSoldier: number;
    fuelSteem: number;
    soldiers: number;
    delegations: { txid?: string; ops?: number; vestsEach?: number } | null;
    capital: { txid?: string; ops?: number; steemEach?: number; total?: number } | null;
    delegationConfirmed: string;
  } | null;
  muster: {
    at: string;
    mode: string;
    employment: string;
    employed: number;
    totalEscrow: number;
    waves: { username: string; amt: number; txid?: string }[];
  } | null;
  ladder: {
    at: string;
    mode: string;
    orders: { symbol: string; qty: number; price: number; bid?: number; error?: string }[];
    skip: { symbol: string; bal?: number; why: string }[];
    swapHiveBefore: number | null;
    swapHiveAfter: number | null;
    swapHiveDelta: number | null;
    fills: { symbol: string; qty: string; price: string }[];
  } | null;
  live: {
    soldiers: EmploymentSoldier[];
    employedFleet: number;
    escrowed: number;
    withSaos: number;
    withLp: number;
    pool: { saos: number; steem: number; lpSupply: number; feesSteem: number; swaps: number } | null;
    feeCaptureSeen: number;
    liqLastAction: string | null;
  };
  score: { funded: number; escrowed: number; withSaos: number; withLp: number; employmentPct: number };
}

export function useEmployment(open: boolean): EmploymentResponse | null {
  return usePoll<EmploymentResponse>("/api/ops/employment", 20000, open);
}

/* ── 50 — ריבונות-RC ── */
export interface SovereignRcResponse {
  ok: boolean;
  at: string;
  error?: string;
  map: {
    at: string | null;
    treasury: { account: string; maxRc: number; rcNow: number; pct: number; liquid: string } | null;
    soldiers: { account: string; maxRc: number; rcNow: number; pct: number; liquid: string }[];
    fleetRcNow: number | null;
    treasuryRcNow: number | null;
    hive: { maxRc: number; rcNow: number; pct: number; hpVests: string; hive: string } | null;
    throughput: {
      costPerCompactOp: number | null;
      perDay: { account: string; regenPerDay: number; opsPerDayCompact: number | null }[];
      fleetOpsPerDayCompact: number | null;
      burstOpsPerBlock: number;
      singleAccountWall: number;
    } | null;
  };
  salvo: {
    crossed: boolean;
    fired: number;
    maxSameBlock: number;
    maxBlock: number | null;
    blockEvidence: { block: number; ourSaosOpsInBlock: number; totalTxOpsInBlock: number } | null;
    singleWall: number;
    txids: { soldier: string; txid: string; block: number | null; opsInTx: number | null }[];
  };
  batch: {
    verified: boolean;
    soldier: string | null;
    txid: string | null;
    block: number | null;
    opsInTx: number | null;
    rcCost: number | null;
    rcCostPerOp: number | null;
  };
  runner: {
    anchored: boolean;
    count: number | null;
    ms: number | null;
    compression: number | null;
    digestOnChain: boolean;
    soldier: string | null;
    txid: string | null;
    block: number | null;
    opsInTx: number | null;
    head: string | null;
  };
  chunk: {
    verified: boolean;
    reassembled: boolean;
    bytes: number | null;
    chunks: number | null;
    hash: string | null;
    txids: { soldier: string; txid: string; idx: number; bytes: number }[];
  };
  powerup: {
    result: { verified: boolean; vestsDelta: number | null; rcMaxBefore: number | null; rcMaxAfter: number | null; rcRegenGainPct: number | null; amountPowered: string | null; at: string | null; mode: string | null } | null;
    machine: { stage: string; variant: string; sentAt: string | null; staleAt: string | null; poweredAt: string | null };
  };
  walls: { wall: string; measured: string; sovereign: string }[];
}

export function useSovereignRc(open: boolean): SovereignRcResponse | null {
  return usePoll<SovereignRcResponse>("/api/ops/sovereign/rc", 20000, open);
}

/* ── Task 51 — ריבונות מעל-השרשראות (cross-shard / rebuild / perf) ── */
export interface CrossResponse {
  ok: boolean;
  at: string;
  error?: string;
  cross: {
    mode: string | null;
    root: string | null;
    manifestBytes: number | null;
    reassembledBytes: number | null;
    shardCount: number | null;
    reassembled: boolean;
    rootMatch: boolean;
    bothChains: boolean;
    firstSoldierHiveSignature: boolean;
    manifestSections: string[];
    shards: { i: number; chain: string; signer: string; txid: string | null; bytes: number | null }[];
  } | null;
  rebuild: {
    corpus: { ops: number; lowestIdx: number; newestIdx: number; pages: number } | null;
    supply: number | null;
    verdict: string | null;
    passed: number | null;
    total: number | null;
    allPass: boolean;
    comparison: { name: string; ok: boolean; detail: string }[];
    bestAsk: number | null;
    pool: unknown;
    trades: number | null;
  } | null;
  perf: {
    rpc: { bestSingleMs: number | null; raceAllMs: number | null; table: { endpoint: string; p50ms: number | null; fails: number }[] } | null;
    engine: { swapsComputed: number; elapsedMs: number; opsPerSec: number; usPerOp: number } | null;
    inclusion: { steem: { txid: string | null; block?: number; latencyMs?: number; error?: string; method?: string } | null; hive: { txid: string | null; block?: number; latencyMs?: number; error?: string; method?: string } | null } | null;
    anchor: { txid: string | null; digest: string | null; error?: string } | null;
  } | null;
}

export function useSovereignCross(open: boolean): CrossResponse | null {
  return usePoll<CrossResponse>("/api/ops/sovereign/cross", 20000, open);
}

/* ── Task 53 — מנוע-ערך ריבוני: נעילת-ערך · POR-צי · ממסר-מפל ── */
export interface Value53Response {
  ok: boolean;
  at: string;
  error?: string;
  valueLock: {
    seq: number | null;
    lockedLp: number | null;
    lockedSaosCum: number | null;
    lastAt: string | null;
    lastTxid: string | null;
    lastHiveTxid: string | null;
    lastHiveVia: string | null;
    depthBefore: number | null;
    depthAfter: number | null;
    lastResult: { at: string | null; mode: string | null; txid: string | null; lockedLp: number | null; hiveVia: string | null } | null;
  };
  por: {
    checkpoints: number | null;
    anchoredTotal: number | null;
    lastCheckpointAt: string | null;
    lastTxid: string | null;
    routedDetail: string | null;
  };
  cascade: {
    at: string | null;
    mode: string | null;
    digest: string | null;
    allVerified: boolean;
    legs: { leg: string | null; chain: string | null; signer: string | null; txid: string | null; block: number | null; acceptedMs: number | null; visibleMs: number | null }[];
    verify: { leg: string | null; pass: boolean; block: number | null; witness: string | null }[];
  };
  pool: { saos: number; steem: number; lpSupply: number; locked: number; swaps: number; feesSaos: number; feesSteem: number } | null;
  loop: { valueLock: { status?: string; detail?: string } | null };
}

export function useSovereignValue53(open: boolean): Value53Response | null {
  return usePoll<Value53Response>("/api/ops/sovereign/value53", 20000, open);
}

/* ── Task 52 — מפעל-ההלוואות (borrow-mint) + מטח-40 ── */
export interface BorrowResponse {
  ok: boolean;
  at: string;
  error?: string;
  borrowWindow: {
    status: string;
    at: string;
    creator: string;
    name: string;
    frozen: number;
    restored: number;
    haranBoost: { txid: string; vests: number } | null;
    claim: { txid?: string; tickets?: number; rcCostG?: number } | null;
    mint: { txid?: string; verified?: boolean; receivedSp?: number } | null;
    measured: Record<string, unknown>;
    runs: number;
  } | null;
  threshold: {
    vests: number;
    ownVests: number;
    pct: number;
    note: string;
    pendingReturnsNote: string;
  };
  salvo52: {
    ourOps: number;
    signers: string[];
    heaviest: { block: number; ops: number } | null;
    scannedRange: number[];
    at: string;
  } | null;
  treasuryRc: { max?: number; current?: number; pct?: number } | null;
  measuredWalls: { wall: string; measured: string; solution: string }[];
}

export function useSovereignBorrow(open: boolean): BorrowResponse | null {
  return usePoll<BorrowResponse>("/api/ops/sovereign/borrow", 20000, open);
}

/* ── Task 54 — מנוע-רפלקס-בלוק ── */
export interface ReflexResponse {
  ok: boolean;
  at: string | null;
  engine: string;
  error?: string;
  summary: {
    rounds: number;
    totalResponses: number;
    swarmSize: number;
    maxLatencyBlocks: number | null;
    avgLatencyBlocks: number | null;
    liquidCost: number;
    distinctSigners: number;
    digest: string;
    hiveAnchor: { account: string; txid: string | null; block: number | null; verified: boolean } | null;
    triggers: { r: number; block: number; txid: string }[];
  } | null;
  rounds: {
    round: number;
    triggerBlock: number | null;
    triggerTxid: string | null;
    detectionMs: number | null;
    responded: number;
    swarmSize: number;
    maxLatencyBlocks: number | null;
    avgLatencyBlocks: number | null;
    perSoldier: Record<string, number | null>;
  }[];
  manaDelta: Record<string, number>;
  loop: { status?: string; detail?: string; lastRun?: string } | null;
  /* Task 55 — external-event reflex: the fleet reacts to ARBITRARY transfers */
  external: {
    at: string | null;
    source: string | null;
    from: string | null;
    amount: string | null;
    block: number | null;
    txid: string | null;
    maxLatencyBlocks: number | null;
    totalResponses: number | null;
    distinctSigners: number | null;
    hiveAnchor: { account?: string; verified?: boolean; block?: number | null } | null;
  } | null;
  /* Task 55 — Vault v2: deterministic rotation + master-connect admission */
  vaultv2: {
    account: string | null;
    chains: { chain: string; verified: boolean }[];
    scheme: string | null;
    at: string | null;
  } | null;
  /* Task 59 — boundary-breaking batch: recovery · market · savings · witness · energy · routing */
  sovereign59: {
    at: string | null;
    recoveryCount: number;
    marketRoundTrip: boolean;
    savingsLive: boolean;
    witnessSteem: boolean;
    witnessHive: boolean;
    energyYnetFinal: string | null;
    routeLive: boolean;
    delegateRcAbsent: boolean;
  } | null;
  empire60: {
    at: string | null;
    census: { accounts?: number; steemSp?: number; hiveHp?: number; fleetRcRegenGPerDay?: number | null } | null;
    rates: { steemSbdInterestPct?: number; hiveHbdInterestPct?: number } | null;
    market: { steem?: { mid?: number; spreadPct?: number | null } | null; hive?: { mid?: number; spreadPct?: number | null } | null } | null;
    engine: { reachable?: boolean; tokenCount?: number; bee?: { last?: number; lastDay?: number } | null; ourBalances?: number } | null;
    treasury: { steemDaoBalanceSteem?: number; hiveFundHive?: number; hiveFundHbd?: number } | null;
    curation: { steem?: { aprPct?: number; pendingPayout?: number } | null; hive?: { aprPct?: number; pendingPayout?: number } | null } | null;
    live: {
      curationVote: { status?: string; txid?: string; author?: string } | null;
      dhfBallot: { status?: string; signedWith?: string; voter?: string } | null;
      dhfFeeWall: string | null;
      engineBuy: { status?: string; symbol?: string; quantity?: number; priceSwaphive?: number } | null;
    } | null;
    hypotheses: { count: number; proven: number; measured: number; open: number; walls: number; top: { id?: string; why?: string }[] } | null;
  } | null;
  /* Task 61 — A5 curation flywheel LIVE in the daemon */
  flywheel61: {
    at: string | null;
    loopLive: boolean;
    daemonLive: boolean;
    votesToday: number | null;
    config: { minVpPct?: number; maxVotesDay?: number; weightPct?: number } | null;
    vpCost: number | null;
    batch: { votes?: number; rsharesTotal?: string; verifiedOnChain?: string } | null;
    lastVote: { author?: string; txid?: string; rshares?: string } | null;
  } | null;
}

export function useSovereignReflex(open: boolean): ReflexResponse | null {
  return usePoll<ReflexResponse>("/api/ops/sovereign/reflex", 20000, open);
}

/* Task 62 — PAYMASTER: the contract pays gas + cross-chain breach */
export interface PaymasterResponse {
  ok: boolean;
  at: string;
  error?: string;
  relay: {
    steem: {
      relayed?: boolean;
      client?: string;
      txid?: string | null;
      block?: number | null;
      signatureCovered?: boolean;
      clientRcBeforePct?: number | null;
      clientRcAfterPct?: number | null;
      clientRcDeltaPct?: number | null;
    } | null;
    hive: {
      relayed?: boolean;
      client?: string;
      anchorSigned?: boolean;
      txid?: string | null;
      block?: number | null;
      verifiedOnNode?: boolean;
      clientRcBeforePct?: number | null;
      clientRcAfterPct?: number | null;
      clientRcDeltaPct?: number | null;
    } | null;
    relaysVerified: number;
  } | null;
  fuel: {
    payer?: { account?: string; isTreasury?: boolean } | null;
    client?: { account?: string; maxRcDelta?: number } | null;
    txid?: string | null;
    verified?: boolean | null;
  } | null;
  memo: {
    customer?: string | null;
    order?: { txid?: string; memo?: string; verifiedOnChain?: boolean } | null;
    fill?: { txid?: string; verifiedOnChain?: boolean } | null;
    encryptedReceipt?: { sent?: boolean; decryptedOk?: boolean; txid?: string } | null;
    pricing?: { rate?: number; anchor?: string } | null;
  } | null;
  xnet: {
    liveCount: number;
    deadCount: number;
    live: { net: string; ms: number; tip?: string }[];
  } | null;
  xwallet: {
    lastMode?: string | null;
    match?: boolean | null;
    recovered?: string | null;
    network?: string | null;
    signature?: string | null;
    confirmed?: boolean | null;
    feePayer?: string | null;
    clientPaidLamports?: number | null;
    explorer?: string | null;
  } | null;
  gasTank: { policy?: string | null; debits?: number; updatedAt?: string | null } | null;
  memoLedger: { total: number; updatedAt: string | null } | null;
  loop: { status?: string; detail?: string; lastRun?: string } | null;
}

export function useSovereignPaymaster(open: boolean): PaymasterResponse | null {
  return usePoll<PaymasterResponse>("/api/ops/sovereign/paymaster", 20000, open);
}

// ─── /api/ops/saos/wrapped — Task 63 WRAPPED: pegged wrapped assets on the DEX ───

export interface WrappedOrder {
  oid: string;
  side: "buy" | "sell";
  owner: string;
  price: number;
  amount: number;
  remaining: number;
  status: "open" | "cancelled" | "filled";
  placedAt: string | null;
}
export interface WrappedPool {
  pair: string;
  feeBps: number;
  base: number;
  quote: number;
  swaps: number;
  feesTotal: number;
  feesLp: number;
  feesTreasury: number;
}
export interface WrappedAsset {
  symbol: string;
  peg: string;
  supply: number;
  backing: { mode: string; lockedSbd: number; lockedHive: number; lockedSp?: number; chain: string; refs: string[] };
  backingRatioPct: number | null;
  fairSteem: number | null;
  book: { asks: WrappedOrder[]; bids: WrappedOrder[] };
  pools: WrappedPool[];
  mints: number;
  burns: number;
}
export interface WrappedResponse {
  ok: boolean;
  issuer: string;
  fetchedAt: string;
  assets: WrappedAsset[];
  fees: { totalCaptured: number; lp: number; treasury: number };
  locks: { symbol: string; from: string; amount: number; txid: string; at: string | null; block: number | null }[];
  measured: { feedSbdPerSteem: number | null; steemSbdBalance: number | null; actions: number; lastActionAt: string | null };
  actions: { at: string | null; block: number | null; txid: string; kind: string; detail: string }[];
  pagesScanned: number;
  malformed: number;
  error?: string;
  daemon: {
    booted?: boolean;
    mode?: string | null;
    engine?: { beeOrder?: { price?: number; qty?: number; txid?: string | null; at?: string } | null } | null;
    fees?: { poolCapture?: Record<string, number> } | null;
    opsToday?: number;
    at?: string | null;
    oracle?: { prices?: Record<string, number>; divergencePct?: number } | null;
    assets?: Record<string, { minted?: number; lockedSp?: number; battery?: string; pool?: { base?: number; quote?: number; feeBps?: number } | null }> | null;
  } | null;
}

export function useWrapped(open: boolean): WrappedResponse | null {
  return usePoll<WrappedResponse>("/api/ops/saos/wrapped", 30000, open);
}


/** Proofs + rerun-with-polling. */
export function useProofs() {
  const [data, setData] = useState<ProofsResponse | null>(null);
  const [running, setRunning] = useState(false);
  const startedAt = useRef<string | null>(null);
  const mounted = useRef(true);

  const poll = useCallback(async () => {
    const d = await getJson<ProofsResponse>("/api/ops/agent/proofs");
    if (mounted.current && d != null) setData(d);
    return d;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const first = setTimeout(() => void poll(), 0);
    const id = setInterval(() => mounted.current && poll(), 20000);
    return () => {
      mounted.current = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [poll]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(async () => {
      const d = await poll();
      const at = d?.proofs?.at ?? null;
      if (at != null && startedAt.current != null && at !== startedAt.current && mounted.current) {
        setRunning(false);
        clearInterval(id);
      }
    }, 6000);
    const timeout = setTimeout(() => mounted.current && setRunning(false), 240000);
    return () => {
      clearInterval(id);
      clearTimeout(timeout);
    };
  }, [running, poll]);

  const rerun = useCallback(async (): Promise<boolean> => {
    const current = await poll();
    startedAt.current = current?.proofs?.at ?? null;
    setRunning(true);
    try {
      const res = await fetch("/api/ops/agent/proofs", { method: "POST" });
      if (!res.ok) {
        setRunning(false);
        return false;
      }
      return true;
    } catch {
      setRunning(false);
      return false;
    }
  }, [poll]);

  return { proofs: data, running, rerun };
}

/** Exec runs + spawn + per-run log fetch. */
export function useExec(open: boolean) {
  const [data, setData] = useState<ExecResponse | null>(null);
  const mounted = useRef(true);

  const poll = useCallback(async () => {
    const d = await getJson<ExecResponse>("/api/ops/agent/exec");
    if (mounted.current && d != null) setData(d);
    return d;
  }, []);

  useEffect(() => {
    if (!open) return;
    mounted.current = true;
    const first = setTimeout(() => void poll(), 0);
    const id = setInterval(() => mounted.current && poll(), 6000);
    return () => {
      mounted.current = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [open, poll]);

  const spawn = useCallback(
    async (script: string, params?: Record<string, unknown>): Promise<{ ok: boolean; error?: string; runId?: string }> => {
      try {
        const res = await fetch("/api/ops/agent/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ script, params: params ?? {} }),
        });
        const j = (await res.json()) as { ok: boolean; error?: string; runId?: string };
        void poll();
        return j;
      } catch (e) {
        return { ok: false, error: String(e).slice(0, 120) };
      }
    },
    [poll],
  );

  const runLog = useCallback(async (id: string): Promise<string[]> => {
    const d = await getJson<ExecLogResponse>(`/api/ops/agent/exec?log=${id}`);
    return d?.lines ?? [];
  }, []);

  return { data, spawn, runLog, poll };
}

// ─── formatters ──────────────────────────────────────────────────────────────

const heNum = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("he-IL", { maximumFractionDigits: digits }).format(n);
}

export function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${heNum.format(n)}`;
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "עכשיו";
  const m = Math.floor(s / 60);
  if (m < 60) return `לפני ${m} דק'`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} שע'`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

/** POST helper for brain actions. */
export async function brainAction(
  type: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/ops/brain?username=headcorner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...extra }),
    });
    const j = (await res.json()) as { ok?: boolean; error?: string };
    return { ok: Boolean(j.ok), error: j.error };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// ─── SCI — SAOS Chain Infrastructure (Task 44) ───────────────────────────────

export interface InfraTopologyRow {
  account: string;
  onChain: boolean;
  recovery: string | null;
  recoveryOurs: boolean;
  operatorPostingAuth: boolean;
  rcMax: number;
  externalApps: string[];
  infra: {
    recoverySetAt?: string;
    recoveryTxid?: string;
    postingAuthAt?: string;
    postingAuthTxid?: string;
    rcDelegatedAt?: string;
    rcDelegatedVests?: string;
  } | null;
}

export interface InfraAck {
  nonce: string;
  cmd: string;
  by: string;
  at: string;
  txid?: string;
}

export interface InfraStatusResponse {
  ok: boolean;
  at: string;
  chainError: string | null;
  topology: InfraTopologyRow[];
  worldlog: {
    state: { seq?: number; prev?: string; lastAt?: string; lastSteemTxid?: string; lastHiveTxid?: string; total?: number } | null;
    verify: { ok?: boolean; depth?: number; linkage?: boolean; parity?: boolean; lastSeq?: number; lastHash?: string; at?: string; problems?: string[] } | null;
  };
  commandBus: {
    acks: InfraAck[];
    totalDecoded: number;
    lastSent: Array<Record<string, unknown>>;
  };
  harden: { at?: string; ok?: boolean; results?: Array<{ account: string; postingAuth?: string | null; rcDelegate?: string | null }> } | null;
  escrow: { at?: string; ok?: boolean; escrowId?: number | string; amount?: string; buyer?: string; arbiter?: string; steps?: Array<{ op: string; txid: string; block?: number; signer?: string; role?: string }> } | null;
  communityReadiness: { pendingClaims: number; rcPct: number | null; note: string };
}

export function useInfraStatus(): InfraStatusResponse | null {
  return usePoll<InfraStatusResponse>("/api/ops/infra/status", 20000);
}

/** Send an encrypted command over the SCI command bus (memo ECDH). */
export async function sendEncryptedCommand(
  to: string,
  cmd: string,
): Promise<{ ok: boolean; sent?: Array<{ to: string; txid: string; nonce: string }>; errors?: string[]; error?: string }> {
  try {
    const res = await fetch("/api/ops/infra/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, cmd }),
    });
    const j = (await res.json()) as {
      ok: boolean;
      sent?: Array<{ to: string; txid: string; nonce: string }>;
      errors?: string[];
      error?: string;
    };
    return j;
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// ─── /api/ops/net — SAOS-Net v1 (smart network on the chain) ────────────────

export interface NetLimits {
  at?: string;
  customJsonWallBytes?: number | null;
  blockCadenceSec?: number | null;
  throughputTps?: number | null;
  historyWindow?: { returned?: number; span?: number; cap?: number } | null;
  authorityWall?: { maxAccepted?: number; rejectedAt?: number; err?: string | null } | null;
  summary?: { probes?: number; passed?: number; walls?: number; wallList?: string[] } | null;
  probes?: { name: string; expect: string; got: string; verdict: string }[];
}
export interface NetRegistryEntry {
  name: string;
  type: string;
  caps?: string[];
  chains?: string[];
  endpoint?: string;
  owner?: string;
  block?: number;
  txid?: string;
}
export interface NetRegistry {
  at?: string;
  protocol?: string;
  entries?: number;
  onChainResolved?: number;
  missing?: string[];
  verified?: boolean;
  registry?: Record<string, NetRegistryEntry>;
}
export interface NetKv {
  at?: string;
  verified?: boolean;
  put?: { key?: string; size?: number; parts?: number; sha256?: string };
  readBack?: { hashMatch?: boolean; size?: number; parts?: number; attempts?: number; sha256?: string; doc?: Record<string, unknown> };
  hashMatch?: boolean;
  size?: number;
  parts?: number;
  attempts?: number;
}
export interface NetMission {
  id: string;
  cmd?: string;
  status?: string;
  assignedTo?: string | null;
  submitTxid?: string | null;
  assignTxid?: string | null;
  resultTxid?: string | null;
  resultKind?: string | null;
  resultData?: Record<string, unknown> | null;
  resultAt?: string | null;
  payTxid?: string | null;
  payAmount?: number | null;
}
export interface GenesisStep {
  step?: string;
  ok?: boolean;
  detail?: string;
  txid?: string | null;
}
export interface GenesisResult {
  at?: string;
  dry?: boolean;
  run?: number;
  ladder?: {
    bee?: { before?: number; after?: number };
    swapHive?: { before?: number; after?: number };
    totalBeeBoughtEver?: number;
    createThreshold?: number;
    progressPct?: number;
  } | null;
  steps?: GenesisStep[];
  token?: {
    symbol?: string;
    created?: boolean;
    issued?: boolean;
    createTxid?: string | null;
    issueTxid?: string | null;
    params?: { ok?: boolean; payload?: string; txid?: string | null; err?: string }[];
    market?: { ok?: boolean; quantity?: string; price?: string; txid?: string | null; err?: string }[];
  } | null;
}
export interface ConformsAssert {
  id?: string;
  op?: string;
  expect?: string;
  got?: string;
  pass?: boolean;
  evidence?: string;
}
export interface ConformsResult {
  at?: string;
  account?: string;
  summary?: { total?: number; walls?: number; allows?: number; passCount?: number } | null;
  asserts?: ConformsAssert[];
}
export interface NetSite {
  verified?: boolean;
  sha256?: string;
  size?: number;
  parts?: number;
  headBlock?: number | null;
  at?: string;
  txids?: (string | null)[] | null;
}
export interface NetResponse {
  ok: boolean;
  limits: NetLimits | null;
  registry: NetRegistry | null;
  kv: NetKv | null;
  missions: { total: number; open: number; done: number; pay?: Record<string, unknown> | null; tasks: NetMission[] } | null;
  unstake: {
    at?: string;
    results?: {
      symbol?: string;
      stakedBefore?: number;
      txid?: string;
      schedule?: { transactionsLeft?: number; periodMs?: string; quantityLeft?: string } | null;
      unlockValueHive?: number | null;
      bestBidAtUnstake?: number | null;
      error?: string;
    }[];
  } | null;
  genesis: GenesisResult | null;
  conforms: ConformsResult | null;
  site: NetSite | null;
  army: { size?: number } | null;
}

export async function runExec(
  script: string,
): Promise<{ ok: boolean; runId?: string; error?: string }> {
  try {
    const res = await fetch("/api/ops/agent/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script }),
    });
    const j = (await res.json()) as { ok: boolean; runId?: string; error?: string };
    return j;
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

export function useNet(): NetResponse | null {
  return usePoll<NetResponse>("/api/ops/net", 30000);
}

export async function submitMission(
  cmd: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch("/api/ops/net", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd }),
    });
    const j = (await res.json()) as { ok: boolean; id?: string; error?: string };
    return j;
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// ─── /api/ops/liq — ממלכת-הנזילות (Task 47) ─────────────────────────────────

export interface LiqPoolLpRow {
  account: string;
  shares: number;
}
export interface LiqPool {
  pair: string;
  feeBps: number;
  saos: number;
  steem: number;
  lpSupply: number;
  swaps: number;
  feesSaos: number;
  feesSteem: number;
  lp: LiqPoolLpRow[];
}
export interface LiqBookRow {
  oid: string;
  owner: string;
  price: number;
  remaining: number;
  placedTime: string;
}
export interface LiqTradeRow {
  idx: number;
  time: string;
  txid: string;
  oid: string;
  side: "buy" | "sell";
  maker: string;
  taker: string;
  amount: number;
  price: number;
  selfTrade: boolean;
}
export interface LiqBalanceRow {
  account: string;
  saos: number;
  locked: number;
  credit: number;
}
export interface LiqResponse {
  ok: boolean;
  fetchedAt: string;
  issuer: string;
  dex: {
    ok: boolean;
    error?: string;
    stats: {
      lastPrice: number | null;
      bestAsk: number | null;
      bestBid: number | null;
      spreadPct: number | null;
      vol24hSaos: number;
      vol24hSteem: number;
      tradesTotal: number;
      openOrders: number;
      invalidOps: number;
    } | null;
    mine: { saosLiquid: number; saosLocked: number; steemCredit: number; steemLocked: number; openOids: string[] } | null;
    solvency: { creditsTotal: number; issuerLiquidSteem: number | null; coveragePct: number | null } | null;
    book: { asks: LiqBookRow[]; bids: LiqBookRow[] } | null;
    trades: LiqTradeRow[] | null;
    balances: LiqBalanceRow[] | null;
    pools: LiqPool[] | null;
  } | null;
  routing: {
    at: string | null;
    lastAction: string | null;
    escrowsToday: number;
    escrowedBySoldier: Record<string, { amt?: number; txid?: string }>;
    lpGranted: Record<string, number>;
    arbsToday: number;
    lastArbAt: string | null;
    feeCaptureSeen: number;
  };
  mm: {
    day: string | null;
    broadcastsToday: number;
    fillsToday: number;
    escrowedTotal: number;
    lastQuotes: { askPrice?: number; bidPrice?: number } | null;
  };
  ladder: {
    at: string | null;
    bee: number | null;
    swapHive: number | null;
    token: { symbol?: string; created?: boolean } | null;
  };
  bridge: { at: string | null; anchoredTotal: number | null; lastTxid: string | null };
  heWallet: { account: string; symbol: string; balance: number; stake: number }[];
  heSymbols: string[];
  mainPool: LiqPool | null;
}

export function useLiq(): LiqResponse | null {
  return usePoll<LiqResponse>("/api/ops/liq", 30000);
}

// ─── /api/ops/sovereign/microdex — Task 65: soldier self-signed micro-DEX ops ───

export interface MicrodexTx {
  at?: string;
  by?: string;
  why?: string;
  txid?: string | null;
  verified?: boolean;
}

export interface MicrodexResponse {
  ok: boolean;
  state: {
    day: string | null;
    beats: number;
    opsToday: number;
    bySoldier: Record<string, number>;
    txids: MicrodexTx[];
    verifiedCount: number;
    lastAt: string | null;
  };
  loop: { status?: string | null; detail?: string | null } | null;
  fleetSize: number;
  replay: {
    accountsScanned: number;
    extraOps: number;
    openOrders: number;
    tradesTotal: number;
    poolSwaps: number;
  } | null;
  at: string;
}

export function useSovereignMicrodex(open: boolean): MicrodexResponse | null {
  return usePoll<MicrodexResponse>("/api/ops/sovereign/microdex", 20000, open);
}

export interface Case66Step {
  key: string;
  label: string;
  chain: string;
  txid: string | null;
  verified: boolean;
  node: string | null;
  block: number | null;
}

export interface Case66Response {
  ok: boolean;
  at: string;
  yield: {
    day: string | null;
    pool: number;
    feesTotal: number;
    totalPaid: number;
    paid: { account: string; amt: number; txid: string | null; verified: boolean; memo: string | null }[];
    verifiedCount: number;
    selfFunded: boolean;
  } | null;
  roundtrip: {
    allVerified: boolean;
    steps: Case66Step[];
    conservation: {
      supply: number;
      lockedHive: number;
      ratioPct: number | null;
      redeemed: number;
      unlocked: number;
      holders: { account: string; balance: number }[];
    } | null;
  } | null;
  budget: {
    opsPerBeat: number;
    opsPerSoldierDay: number;
    activeSoldiers: number;
    fleetSize: number;
    bySoldier: Record<string, number>;
    rcCostMeasured: { by: string; delta: number }[];
  } | null;
  pay: {
    total: number;
    count: number;
    last: { time: string; from: string; to: string; amount: number; ref: string; txid: string } | null;
  } | null;
  eff: {
    feesCaptured: number;
    yieldDistributed: number;
    liquidCostOps: number;
    rcCostPerOpPct: number | null;
    vol24hSteem: number;
    trades: number;
    verdict: string;
  } | null;
  commerce: {
    sales: number;
    revenue: number;
    verified: number;
    last: { buyer: string; sent: number; qty: number; price: number; txid: string | null; buyTxid: string | null } | null;
    lpHolders: number;
    lpSupply: number | null;
    hivePings: number;
    hivePingsLanded: number;
  } | null;
}

export function useCase66(open: boolean): Case66Response | null {
  return usePoll<Case66Response>("/api/ops/sovereign/case66", 30000, open);
}

/* ── Task 68 — SAOS-NET: הרשת-הריבונית שלנו ── */
export interface SaosNetCheckpoint {
  height: number;
  stateRoot: string | null;
  checkpointHash: string | null;
  anchors: Record<string, string>;
  attests: { by: string; txid: string | null; verified: boolean }[];
  at: string | null;
}

export interface SaosNetResponse {
  ok: boolean;
  at: string;
  net: string;
  genesis: {
    genesisHash: string | null;
    time: string | null;
    counts: { accounts: number; wrappedSymbols: number; lpHolders: number } | null;
    supplySaos: number;
    issuer: string | null;
    sources: string[];
  } | null;
  node: {
    height: number;
    stateRoot: string | null;
    genesisHash: string | null;
    beats: number;
    updatedAt: string | null;
    checkpoints: SaosNetCheckpoint[];
    lastCheckpoint: SaosNetCheckpoint | null;
    verifiedCount: number;
    pendingCount: number;
    mirror: { sales: number; yields: number; poolAdds: number; poolSwaps: number; failed: number; beats: number } | null;
    beeWall: {
      at: string | null;
      bee: number;
      target: number;
      gateCost: number | null;
      askTop?: number | null;
      bid?: number | null;
      fuel: { swapHive?: number; hiveLiquid?: number; dustUnlockable?: number; total?: number } | null;
      deficit: number | null;
      incomeRate: { beePerDay?: number; runs?: number; bought?: number; days?: number } | null;
      etaDays: number | null;
      gateDepthOk?: boolean | null;
      binding?: string | null;
      pendingReleases?: { valueHive?: number; rows?: { account: string; symbol: string; pending: number; valueHive: number }[] } | null;
      sovereign?: string | null;
      noBridge?: string | null;
      fleet?: {
        routes?: number;
        beeRouted?: number;
        swapRouted?: number;
        probePhase?: string | null;
        probeSoldier?: string | null;
        chains?: { at: string; mode: string; soldier: string; legs: number; verified: number }[];
      } | null;
    } | null;
    sov: { floats: number; orders: number; fills: number; matches: number; askPosts: number; yieldDay: string | null; yieldSAOS: number; skips: number; ask?: { orderId: number | null; priceµ?: number } | null; yieldNote?: string | null } | null;
    book: {
      asks: { id: number; owner: string; amount: number; price: number }[];
      bids: { id: number; owner: string; amount: number; price: number }[];
      trades: number;
      lastPrice: number | null;
      feesµ: number;
      yieldSAOS: number;
      boundarySteem: number;
      floatAccounts: number;
    } | null;
    /* 94 — נגזרות-עטופות (מוצרי-הדקס): WTRX = ערך-TRON על-הרשת-שלנו (עטוף-מלא, עתודות-מדודות) */
    wrapped: Record<string, { supply: number; locked: number; holders: number }> | null;
    /* 95 — האצלות: חיבור-כולם לראש @headcorner בסקופים — בלי-לגעת-במפתחות-ראשיים */
    delegations: Record<string, { scopes: string[]; ref: string }> | null;
    /* 96 — כלכלת-טרון-העטופה: רישומי-מטבעות (חוזה-אם מאומת-חי) + ציטוטי-מחיר (src+ref חתום) */
    assetMeta: Record<string, { chain: string; contract: string; decimals: number; ref: string; note: string }> | null;
    assetPrices: Record<string, { px: number; unit: string; src: string; ref: string; at: string | null }> | null;
    /* 97 — GRID-PROFIT: יומן-רווח-חי (נמדד-מהספר-עצמו) + מחזיקי-WTRX + יתרות-צף */
    grid97: {
      day: string;
      feesTrTodayµ: number;
      feesLpTodayµ: number;
      feesTotalµ: number;
      tradesToday: number;
      swapsToday: number;
      ladderPosts: number;
      ladderRecycles: number;
      ladderLive?: number;
      mid?: number;
      gapBps: number;
      arbEvents: number;
      arbLastSide?: string;
      arbLastAmt?: number;
      treasuryWtrx: number;
      treasurySaos: number;
      wtrxCover?: number;
      poolW: { saos: number; wtrx: number; lp: number; feeBps: number } | null;
      pool: { saos: number; steem: number; feeBps: number };
      height: number;
      at: string;
    } | null;
    wrappedHolders: Record<string, number> | null;
    floatBalances: Record<string, { saos: number; steem: number }> | null;
    /* 98 — GRID-98 ARENA: מנוע-הזרימה-הגבוהה (מדדים-חיים מהספר-הריבוני) */
    grid98: {
      at?: string | null;
      ticks?: number;
      tradesToday?: number;
      tradesTotal?: number;
      ratePerMin?: number;
      extrapolatedDay?: number;
      dutyPct?: number;
      height?: number;
      treasuryPnlSAOS?: number;
      treasuryPnlTodaySAOS?: number;
      feeIncomeµ?: number;
      sweeps?: number;
      bigSweeps?: number;
      sweepSpendµ?: number;
      poolflows?: number;
      topUpsµ?: number;
      lockSkips?: number;
      floor?: number | null;
      steps?: { at: string; floor: number; backedByµ: number }[];
      leaderboard?: { name: string; pnlSAOS: number }[];
      pools?: Record<string, { a: number; b: number; px: number; lp: number } | null>;
      seeds?: Record<string, string>;
      mints?: Record<string, string>;
      bench?: { at: string; trades: number; tradesPerSec: number; capabilityPerDay: number; roundsPerSec: number } | null;
      disk?: { freeMB: number } | null;
      paused?: string | null;
      skippedForEdge?: number;
      rejected?: number;
      edgeLeak?: number;
    } | null;
  } | null;
  /* 95 — WEAVE-95: תיקון-הכיסוי + לולאת-הפדיון + ההאצלה + העוגן */
  weave95: {
    at: string | null;
    allMatch: boolean;
    summaryHe: string | null;
    steps: { id: string; net: string | null; label: string | null; match: boolean; measured: unknown }[];
    completion: {
      ok: boolean;
      verify: { missingRefs: string[]; refsOnBook: number; locked: number; supply: number; holders: number; delegations: number; burnHeight: number | null };
      anchor: { txid: string | null; found: { txid: string; block: number | null; node: string | null } | null; error: string | null; digest: string | null };
      bugFound: string | null;
      bugFixed: string | null;
      at: string;
    } | null;
  } | null;
  /* 96 — ECON-96: המצב-הכלכלי מהספר-עצמו + איזון-הדקס (סגירת-ארביטראז פנימי) */
  econ96: {
    at: string | null;
    allMatch: boolean;
    summaryHe: string | null;
    steps: { id: string; label: string | null; match: boolean }[];
  } | null;
  blocks: { height: number; time: string; hash: string; txs: number; gasUsed: number; heartbeat: string | null }[];
  quorum: { required: number; attestTotal: number; attestVerified: number };
  recovery: { at: string | null; verdict: string | null } | null;
  kernel: { present: boolean; spec: string };
}

/* 94 — CHAINTALK: שפת-התקשורת בין-הרשתות — תוצאת-המשימה + מחזור-הסוחר-הריבוני */
export interface ChainTalkResponse {
  ok: boolean;
  at: string;
  mission: {
    id: string | null;
    language: string;
    matches: string | null;
    allMatch: boolean;
    at: string | null;
    durationS: number | null;
    summaryHe: string | null;
    steps: { id: string; net: string | null; label: string | null; match: boolean; evidence: string }[];
  } | null;
  sovBiz: {
    at: string | null;
    customer: string | null;
    steemMoved: string | null;
    orderTxid: string | null;
    orderBlock: number | null;
    receiptTxid: string | null;
    encReceiptOk: boolean;
    fill: string | null;
  } | null;
}
export function useChainTalk(open: boolean): ChainTalkResponse | null {
  return usePoll<ChainTalkResponse>("/api/ops/chaintalk", 30000, open);
}

export function useSaosNet(open: boolean): SaosNetResponse | null {
  return usePoll<SaosNetResponse>("/api/ops/saosnet", 30000, open);
}

/* ── Task 71 — EXPLORER: אקספלורר SAOS-NET (תיעוד-הרשת-על-הרשת) ── */
export interface ExplorerBlock {
  height: number;
  time: string;
  hash: string;
  prevHash: string | null;
  gasUsed: number;
  txs: number;
  okTxs: number;
  failTxs: number;
  hashVerified: boolean | null;
  resultsVerified: boolean | null;
}

export interface ExplorerTxBreakdown {
  type: string;
  ref: string | null;
  mirror: string | null;
  [key: string]: unknown;
  ok: boolean | null;
  err: string | null;
  gas: number;
}

export interface ExplorerBlockFull extends ExplorerBlock {
  txView: ExplorerTxBreakdown[];
  results: { ok: boolean; err: string | null; type: string; gas: number }[];
}

export interface ExplorerAccount {
  name: string;
  saos: number;
  steem: number;
  lockedSaos: number;
  lockedSteem: number;
  lp: number;
  wrapped: Record<string, number>;
  credits: number;
  boundary: boolean;
}

export interface ExplorerOrder {
  id: number;
  side: "sell" | "buy";
  owner: string;
  amount: number;
  price: number;
  live: boolean;
  at: string | null;
}

export interface ExplorerFill {
  height: number;
  time: string;
  taker: string;
  orderId: number;
  maker: string | null;
  amount: number;
  price: number | null;
  ok: boolean;
  filled: number | null;
  ref: string | null;
  mirror: string | null;
}

export interface ExplorerCheckpoint {
  height: number;
  stateRoot: string | null;
  checkpointHash: string | null;
  anchors: Record<string, string | { verified: boolean; txid: string; block: number; by: string; duplicates?: number; backfilled?: boolean }>;
  attests: { by: string; txid: string | null; verified: boolean }[];
  at: string | null;
  reproduced: boolean | null; // 105 — null = מחוץ-לחלון-הפרטים (מוצהר-בכנות)
}

export interface ExplorerPublication {
  height: number;
  txid: string | null;
  verified: boolean;
  at: string;
  digest: string | null;
  by?: string;
  skip?: string;
}

export interface ExplorerProduceRound {
  round: number;
  height: number;
  producer: string;
  ref: string | null;
  ok: boolean | null;
  lawOk: boolean | null;
  hostTxid: string | null;
  verified: boolean;
}

export interface ExplorerRotation {
  law: string;
  roster: string[];
  rosterDigest: string | null;
  rosterPubs: { digest: string; txid: string | null; by?: string; verified: boolean; at: string }[];
  current: { round: number; mandated: string | null; produced: boolean };
  next: { round: number; mandated: string | null };
  rounds: ExplorerProduceRound[];
  misses: number;
}

export interface ExplorerResponse {
  ok: boolean;
  ready: boolean;
  at: string;
  net: string;
  summary: {
    height: number;
    stateRoot: string | null;
    genesisHash: string | null;
    lastBlockHash: string | null;
    beats: number;
    supply: number;
    txsTotal: number;
    /* 107 — הצהרת-היקף + ספירת-הספר-המלא (אימוץ-W18 של-הסוכן-השני) */
    txsScope: { from: number | null; to: number | null; blocksKept: number } | null;
    bookTxTotal: number | null;
    bookBlocks: number | null;
    txCompletion: {
      total: number;
      ok: number;
      fail: number;
      ratePct: number;
      recent: { window: number; ok: number; fail: number; ratePct: number };
      failByErr: Record<string, number>;
      failByType: Record<string, number>;
      at: string;
    } | null;
    gasTotal: number;
    opsByType: Record<string, number>;
    trades: number;
    swaps: number;
    pays: number;
    steemPays: number;
    yieldTotal: number;
    yieldDay: string | null;
    fees: { total: number; toLp: number; toTreasury: number; feeBps: number };
    boundarySteem: number;
    accountsCount: number;
    liveOrders: number;
    asks: number;
    bids: number;
    lastPrice: number | null;
    pool: { saos: number; steem: number; lpSupply: number };
    attestRoots: number;
    head: string | null;
    headRound: number | null;
    integrity: {
      stateRepro: { checked: number; matched: number; firstBadHeight: number | null };
      finalRootMatch: boolean | null; // 105 — null = פער-ספר/צומת (בלתי-ניתן-לשיפוט)
      anchor: { height: number | null; hashMatched: boolean; rootLocked?: boolean | null; cpsAbove: { checked: number; matched: number }; finalRootMatched: boolean | null; finalRoot: string | null; why: string | null } | null;
      lineage: { from: number | null; to: number | null; judgeable: boolean; reason: string | null };
      checkpoints: number;
      checkpointsReproduced: number;
      stateSource: string;
      ok: boolean;
      at: string;
    };
  };
  blocks: ExplorerBlock[];
  blocksStart: number;
  blocksEnd: number;
  accounts: ExplorerAccount[];
  orders: ExplorerOrder[];
  fills: ExplorerFill[];
  checkpoints: ExplorerCheckpoint[];
  publications: ExplorerPublication[];
  rotation: ExplorerRotation | null;
  spark: ExplorerSpark | null;
  verifyPack: { ready: boolean; how: string } | null;
  explorer: { publishes?: ExplorerPublication[]; lastDigest?: string | null; note?: string | null } | null;
  mirror: { sales: number; yields: number; poolAdds: number; poolSwaps: number; failed: number; beats: number } | null;
  sov: { floats: number; orders: number; fills: number; matches: number; askPosts: number; yieldDay: string | null; yieldSAOS: number; skips: number } | null;
  phoenix: { at: string | null; verdict: string | null; checks: number } | null;
  genesis: { genesisHash: string | null; time: string | null; sources: string[] } | null;
}

export interface ExplorerSpark {
  gas: { h: number; gas: number; txs: number }[];
  price: { h: number; p: number }[];
}

export interface ExplorerActivityItem {
  height: number;
  time: string;
  type: string;
  roles: string[];
  ok: boolean | null;
  err: string | null;
  gas: number;
  view: Record<string, unknown>;
}

export interface ExplorerAccountDetail {
  ok: boolean;
  ready: boolean;
  at: string;
  net: string;
  chainHeight: number;
  account: {
    name: string;
    known: boolean;
    boundary: boolean;
    balances: ExplorerAccount | null;
    ops: number;
    stats: Record<string, number>;
    yieldReceived: number;
    gasPaid: number;
    produceRounds: number;
    attests: number;
  };
  activity: ExplorerActivityItem[];
  orders: ExplorerOrder[];
  fills: ExplorerFill[];
  produces: ExplorerProduceRound[];
  attests: { height: number; verified: boolean; txid: string | null }[];
}

export function useAccount(name: string | null): ExplorerAccountDetail | null {
  const [data, setData] = useState<ExplorerAccountDetail | null>(null);
  useEffect(() => {
    if (!name) return;
    let alive = true;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/ops/sovexplorer?a=${encodeURIComponent(name)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((j) => {
          if (alive) setData(j as ExplorerAccountDetail);
        })
        .catch(() => {});
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
      ctrl.abort();
    };
  }, [name]);
  return data;
}

export function useExplorer(open: boolean): ExplorerResponse | null {
  return usePoll<ExplorerResponse>("/api/ops/sovexplorer?limit=20", 20000, open);
}

/* ── Task 90: גשר SAOS-NET ⇄ TRON — הצלבה חיה דו-כיוונית מול TronGrid ── */
export interface TronBridgeAnchor {
  cpHeight: number;
  cpHash: string;
  txid: string;
  expectedAmountSun: number;
  amountOnChainSun: number | null;
  encodedMatch: boolean | null;
  onChain: boolean;
  liveChecked: boolean;
  contractRet: string | null;
  tronBlock: number | null;
  netFeeSun: number;
  notedHeight: number | null;
  at: string;
}

/* 91: SQUAD — טבעת-החיילים על TRON */
export interface TronSquadMember {
  idx: number;
  address: string;
  activated?: boolean;
  balanceTrx?: number;
  freeNetLeft?: number;
}
export interface TronSquadFunding {
  idxTo: number;
  from: string;
  to: string;
  txid: string;
  expectedSun: number;
  amountOnChainSun: number | null;
  match: boolean | null;
  onChain: boolean;
  netFeeSun: number;
  burnSun: number;
  verified: boolean;
  notedHeight: number | null;
}
export interface TronSquadLeg {
  n: number;
  from: number;
  to: number;
  txid: string;
  linkedKind: string | null;
  expectedSun: number | null;
  amountOnChainSun: number | null;
  linkedMatch: boolean | null;
  onChain: boolean;
  netFeeSun: number;
  notedHeight: number | null;
}
export interface TronSquadRing {
  id: number;
  at: string;
  closed: boolean;
  verified: boolean;
  zeroFeeAll: boolean;
  burnSun: number;
  notedHeight: number | null;
  legs: TronSquadLeg[];
}
export interface TronSquad {
  indices: number[];
  members: TronSquadMember[];
  activated: number;
  burnLedger: { activationsSun?: number; netFeeSun?: number; totalSun?: number } | null;
  live: boolean;
  funding: TronSquadFunding[];
  rings: TronSquadRing[];
  totals: {
    fundingProven: number;
    legsTotal: number;
    legsZeroFee: number;
    legsLinkedProven: number;
    activationBurnSun: number;
  };
}

/* 92: PULSE 24/7 + קשירת-סדוגה + נגזרות + כיבולת */
export interface TronPulse {
  tronHeight?: number;
  tronBlockId?: string | null;
  at?: string;
  notedHeight?: number | null;
  error?: string;
}
export interface TronSquadBound {
  notedHeight?: number;
  count?: number;
  at?: string;
}
export interface TronDerivatives {
  usdtTotal?: number;
  measured?: string | null;
  at?: string;
  readOnly?: boolean;
  notedHeight?: number | null;
  valueInNotedHeight?: number | null;
}
export interface TronCapacity {
  addresses: number;
  dailyFreeBytes: number;
  estFreeTxPerDay: number;
}

export interface TronBridgeResponse {
  ok: boolean;
  task: number;
  at: string;
  address: string | null;
  relay: string | null;
  guards: { maxPerDay?: number; minFreeNetBytes?: number; internalOnly?: boolean } | null;
  sovNote: {
    address?: string;
    relay?: string;
    anchors?: number;
    lastAnchor?: { cpHeight?: number; txid?: string; tronBlock?: number | null; netFeeSun?: number; amountSun?: number; notedHeight?: number | null };
    height?: number;
    at?: string;
  } | null;
  wallet?: {
    senderBalanceSun: number | null;
    relayBalanceSun: number | null;
    freeNetLeft: number;
    freeNetLimit: number;
    live: boolean;
  } | null;
  anchors: TronBridgeAnchor[];
  squad?: TronSquad | null;
  reaction: {
    saosBlock: number;
    blockFound: boolean;
    noteHasTxid: boolean;
    note: string | null;
    interleaved: boolean;
  } | null;
  totals?: { count: number; onChain: number; bindingProven: number; burnSunTotal: number };
  pulse?: TronPulse | null;
  squadBound?: TronSquadBound | null;
  derivatives?: TronDerivatives | null;
  capacity?: TronCapacity | null;
  live?: { ok: boolean; note: string | null };
  cached?: boolean;
  degraded?: string;
}

export function useTronBridge(open: boolean): TronBridgeResponse | null {
  return usePoll<TronBridgeResponse>("/api/ops/tronbridge", 30000, open);
}

// ─── /api/weave/** — רשת-האמת (THE WEAVE · W3 API / W4 מסך) ──────────────────
// המסך ניזון מה-replay-עצמו (אותו-קרנל, אותו-ארכיון) — הכל כנה: מצב-לא-זמין
// הוא מצב, לא שגיאה. ה-API לעולם לא 500.

export interface WeaveStatusChain {
  height: number;
  blocksKept: number;
  truncated: boolean;
  finalRoot: string;
  nodeStateRoot: string | null;
  integrity: boolean | null;
  checkpoints: { checked: number; matched: number; firstBadHeight: number | null };
  replayRejected: number;
}

export interface WeaveSealRec {
  seq: number;
  root: string;
  count: number;
  from: number;
  to: number;
  height?: number;
  at: string | null;
}

export interface WeaveWitnessTopic {
  key?: string;
  topic: string;
  claimHash: string | null;
  validators: string[];
  quorum: number;
}

export interface WeaveAnchorRec {
  seq?: number;
  at?: string;
  dry?: boolean;
  txids?: { steem: string | null; hive: string | null; blurt: string | null };
  tron?: { via: string; cpHeight?: number; stateRoot?: string; note?: string } | null;
}

export interface WeaveStatusResponse {
  ok: boolean;
  state?: string;
  why?: string;
  chain?: WeaveStatusChain;
  weave?: {
    liveStamps: number;
    cap: number;
    pressureSealAt: number;
    totalStamps: number;
    nextSeq: number;
    lastSeal: { seq: number; root: string; count: number; at: string | null } | null;
    seals: WeaveSealRec[];
    totalSeals: number;
    totalWitness: number;
    witnessTopics: WeaveWitnessTopic[];
  };
  pendingSealRequest?: { root: string; count: number; at?: string; requestedAt?: string } | null;
  batcher?: { at: string; mode: string; notes: string[]; anchored: WeaveAnchorRec | null } | null;
  anchorsRegistry?: { seals: number; detail: Record<string, WeaveAnchorRec> } | null;
  nodeWeave?: Record<string, unknown> | null;
  endpoints?: Record<string, string>;
}

export function useWeaveStatus(): WeaveStatusResponse | null {
  return usePoll<WeaveStatusResponse>("/api/weave/status", 30000);
}

export interface WeaveStampRow {
  h: string;
  seq: number;
  kind: string;
  by: string;
  at: string | null;
  salt: string | null;
  block: number;
  status: "sealed" | "live";
  sealRoot: string | null;
  sealSeq: number | null;
}

export interface WeaveStampListResponse {
  ok: boolean;
  state?: string;
  why?: string;
  total?: number;
  live?: number;
  stamps?: WeaveStampRow[];
}

export function useWeaveStamps(open: boolean): WeaveStampListResponse | null {
  return usePoll<WeaveStampListResponse>("/api/weave/stamp", 30000, open);
}

export interface WeaveStampPostResult {
  ok: boolean;
  err?: string;
  why?: string;
  note?: string;
  h?: string;
  seq?: number | null;
  stamped?: {
    h: string;
    seq: number;
    kind: string;
    by: string;
    at: string | null;
    block: number;
    live: boolean;
    seal: { seq: number; root: string } | null;
    note: string;
  };
  chain?: { height: number; nextSeq: number; liveStamps: number };
}

export async function postWeaveStamp(body: {
  content?: string;
  h?: string;
  kind?: string;
  by?: string;
  salt?: string;
}): Promise<WeaveStampPostResult> {
  try {
    const res = await fetch("/api/weave/stamp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as WeaveStampPostResult;
  } catch (e) {
    return { ok: false, err: "network", why: String(e).slice(0, 120) };
  }
}

export interface WeaveWitnessListResponse {
  ok: boolean;
  state?: string;
  why?: string;
  total?: number;
  topics?: WeaveWitnessTopic[];
}

export function useWeaveWitnesses(open: boolean): WeaveWitnessListResponse | null {
  return usePoll<WeaveWitnessListResponse>("/api/weave/witness", 30000, open);
}

export interface WeaveWitnessPostResult {
  ok: boolean;
  err?: string;
  why?: string;
  note?: string;
  witnessed?: {
    topic: string;
    claimHash: string;
    validator: string;
    quorum: number;
    validators: string[];
    note: string;
  };
}

export async function postWeaveWitness(body: {
  topic: string;
  claimHash?: string;
  content?: string;
  validator?: string;
}): Promise<WeaveWitnessPostResult> {
  try {
    const res = await fetch("/api/weave/witness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as WeaveWitnessPostResult;
  } catch (e) {
    return { ok: false, err: "network", why: String(e).slice(0, 120) };
  }
}

export interface WeaveProofResponse {
  ok: boolean;
  state?: string;
  why?: string;
  err?: string;
  certificate?: {
    h: string;
    status: "sealed" | "pending-seal" | "unknown";
    seq: number | null;
    kind?: string;
    by?: string;
    at?: string | null;
    stampBlock?: number;
    seal?: { seq: number; root: string; count: number; from: number; to: number; height: number | null; at: string | null } | null;
    proof?: { ok: boolean; pathLen?: number; why?: string };
    checkpoint?: { height: number; stateRoot: string | null; note: string } | null;
    anchors?: { registry: WeaveAnchorRec; tronNote: string } | null;
  };
  verifier?: string;
}

export async function fetchWeaveProof(h: string): Promise<WeaveProofResponse | null> {
  return getJson<WeaveProofResponse>(`/api/weave/proof?h=${encodeURIComponent(h)}`);
}

export interface WeaveVerifyPackResponse {
  ok: boolean;
  at: string;
  chain?: { height: number; blocksKept: number; truncated: boolean; finalRoot: string; rejected: number };
  checks: { id: number; name: string; ok: boolean; detail: string }[];
  summary: { total: number; passed: number; failed: number };
  verdict: string;
}

export async function fetchWeaveVerifyPack(): Promise<WeaveVerifyPackResponse | null> {
  return getJson<WeaveVerifyPackResponse>("/api/weave/verify-pack");
}

/** sha256 צד-לקוח — ההמחשה נעשית אצל-הלקוח (ה-API גם מקבל content גולמי). */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
