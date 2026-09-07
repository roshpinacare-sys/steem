/**
 * Cost Ledger (P1) — per-objective cost attribution.
 *
 * Opens a ledger entry when an objective arrives, records every LLM call,
 * gate run, and canary step against that objective (tagged by team/repo),
 * and closes it when the run finishes. This is the foundation for provider
 * arbitrage (P2), green scheduling (P3), and chargeback reporting (P4).
 */
import { log } from "./logger.js";
import type { RedisState } from "./redis-state.js";
import type { R2Storage } from "./r2-storage.js";
import type { Telemetry } from "./telemetry.js";
import type { CostEntry } from "./cost-tracker.js";

export interface LedgerEntry {
  id: string; // runId
  owner: string;
  repo: string;
  objective: string;
  category: string;
  team?: string;
  openedAt: string;
  closedAt?: string;
  costs: CostEntry[];
  totals: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedUsdCents: number;
    callCount: number;
  };
}

const LEDGER_INDEX_KEY = "qodo:v24:cost-ledger:index";
const ENTRY_TTL_SEC = 90 * 24 * 60 * 60;

function entryKey(owner: string, repo: string, runId: string) {
  return `qodo:v24:cost-ledger:${owner}:${repo}:${runId}`;
}

function teamFromObjectiveOrCodeowners(objective: string): string | undefined {
  // Naive heuristic: look for team/project prefixes like "[checkout]" or "team:mobile"
  const bracket = objective.match(/\[([a-z0-9\-]+)\]/i);
  if (bracket) return bracket[1].toLowerCase();
  const teamTag = objective.match(/team:([a-z0-9\-]+)/i);
  if (teamTag) return teamTag[1].toLowerCase();
  return undefined;
}

/** Open a ledger entry when a run starts. */
export async function openLedger(
  runId: string,
  owner: string,
  repo: string,
  objective: string,
  category: string,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<LedgerEntry> {
  const entry: LedgerEntry = {
    id: runId,
    owner,
    repo,
    objective,
    category,
    team: teamFromObjectiveOrCodeowners(objective),
    openedAt: new Date().toISOString(),
    costs: [],
    totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedUsdCents: 0, callCount: 0 },
  };
  await state.setJSONWithTTL(entryKey(owner, repo, runId), entry, ENTRY_TTL_SEC);
  await appendIndex(state, entry);
  await telemetry?.decision("cost-ledger", "opened", { runId, owner, repo, category, team: entry.team });
  return entry;
}

async function appendIndex(state: RedisState, entry: LedgerEntry): Promise<void> {
  const index = (await state.getJSON<string[]>(LEDGER_INDEX_KEY)) || [];
  const key = entryKey(entry.owner, entry.repo, entry.id);
  if (!index.includes(key)) {
    index.push(key);
    await state.setJSONWithTTL(LEDGER_INDEX_KEY, index.slice(-1000), ENTRY_TTL_SEC);
  }
}

/** Record a cost entry against the open run. */
export async function recordCost(
  owner: string,
  repo: string,
  runId: string,
  cost: CostEntry,
  state: RedisState,
): Promise<void> {
  const entry = await state.getJSON<LedgerEntry>(entryKey(owner, repo, runId));
  if (!entry) {
    log.warn("cost-ledger: no open entry for cost", { owner, repo, runId });
    return;
  }
  entry.costs.push(cost);
  entry.totals.promptTokens += cost.usage.promptTokens;
  entry.totals.completionTokens += cost.usage.completionTokens;
  entry.totals.totalTokens += cost.usage.totalTokens;
  entry.totals.estimatedUsdCents += cost.estimatedUsdCents;
  entry.totals.callCount += 1;
  await state.setJSONWithTTL(entryKey(owner, repo, runId), entry, ENTRY_TTL_SEC);
}

/** Close the ledger entry and optionally mirror to R2. */
export async function closeLedger(
  owner: string,
  repo: string,
  runId: string,
  state: RedisState,
  storage?: R2Storage,
  telemetry?: Telemetry,
): Promise<LedgerEntry | null> {
  const key = entryKey(owner, repo, runId);
  const entry = await state.getJSON<LedgerEntry>(key);
  if (!entry) return null;

  entry.closedAt = new Date().toISOString();
  await state.setJSONWithTTL(key, entry, ENTRY_TTL_SEC);

  if (storage) {
    try {
      await storage.putText(
        `cost-ledger/${owner}/${repo}/${runId}.json`,
        JSON.stringify(entry, null, 2),
      );
    } catch (e: unknown) {
      log.warn("cost-ledger: R2 mirror failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  await telemetry?.decision("cost-ledger", "closed", {
    runId,
    owner,
    repo,
    totalTokens: entry.totals.totalTokens,
    estimatedUsdCents: entry.totals.estimatedUsdCents,
  });
  return entry;
}

/** Load a single ledger entry. */
export async function loadLedger(
  owner: string,
  repo: string,
  runId: string,
  state: RedisState,
): Promise<LedgerEntry | null> {
  return state.getJSON<LedgerEntry>(entryKey(owner, repo, runId));
}

/** Query ledger entries by filters. */
export interface LedgerQuery {
  owner?: string;
  repo?: string;
  team?: string;
  category?: string;
  limit?: number;
}

export async function queryLedger(
  state: RedisState,
  q: LedgerQuery = {},
): Promise<LedgerEntry[]> {
  const index = (await state.getJSON<string[]>(LEDGER_INDEX_KEY)) || [];
  const results: LedgerEntry[] = [];
  for (const key of index) {
    const entry = await state.getJSON<LedgerEntry>(key);
    if (!entry) continue;
    if (q.owner && entry.owner !== q.owner) continue;
    if (q.repo && entry.repo !== q.repo) continue;
    if (q.team && entry.team !== q.team) continue;
    if (q.category && entry.category !== q.category) continue;
    results.push(entry);
  }
  results.sort((a, b) => (b.openedAt || "").localeCompare(a.openedAt || ""));
  return results.slice(0, q.limit ?? 100);
}

/** Monthly chargeback report per team/repo (P4). */
export interface ChargebackReport {
  period: string; // YYYY-MM
  team?: string;
  owner: string;
  repo: string;
  objectives: number;
  totalTokens: number;
  estimatedUsdCents: number;
  estimatedHoursSaved: number;
}

export async function generateChargebackReport(
  owner: string,
  repo: string,
  yearMonth: string, // YYYY-MM
  state: RedisState,
  telemetry?: Telemetry,
): Promise<ChargebackReport[]> {
  const entries = await queryLedger(state, { owner, repo });
  const inMonth = entries.filter((e) => (e.closedAt || e.openedAt).startsWith(yearMonth));

  const byTeam = new Map<string | undefined, LedgerEntry[]>();
  for (const e of inMonth) {
    const list = byTeam.get(e.team) || [];
    list.push(e);
    byTeam.set(e.team, list);
  }

  const reports: ChargebackReport[] = [];
  for (const [team, list] of byTeam) {
    const totalTokens = list.reduce((s, e) => s + e.totals.totalTokens, 0);
    const estimatedUsdCents = list.reduce((s, e) => s + e.totals.estimatedUsdCents, 0);
    // Rough heuristic: 1 objective ≈ 0.75 human hour saved on low-risk work
    const estimatedHoursSaved = Math.round(list.length * 0.75 * 10) / 10;
    reports.push({
      period: yearMonth,
      team,
      owner,
      repo,
      objectives: list.length,
      totalTokens,
      estimatedUsdCents,
      estimatedHoursSaved,
    });
  }

  await telemetry?.decision("cost-ledger", "chargeback-report", {
    owner,
    repo,
    period: yearMonth,
    teams: reports.length,
  });
  return reports;
}
