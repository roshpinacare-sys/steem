/**
 * saos-dex.ts — the SAOS-1/STEEM DEX engine (Task 31).
 *
 * A decentralized exchange whose ORDER BOOK is a DETERMINISTIC REPLAY of the
 * issuer's account history — the same construction as the SAOS-1 token ledger,
 * extended with trading ops on the feeless custom_json bus (id="saos",
 * protocol saos/v1):
 *
 *   order  {oid, side:"sell"|"buy", price, amount, account, time}
 *          sell → locks `amount` SAOS-1 from the owner's ledger balance
 *          buy  → locks `amount*price` STEEM from the owner's DEX credit
 *          (insufficient funds → order is recorded but marked invalid)
 *   cancel {oid, account}          — only the order owner may cancel
 *   fill   {oid, taker, amount}    — fills a resting order at the MAKER's
 *          exact price (no front-running surface); SAOS and STEEM-credit legs
 *          move atomically in the replay
 *
 * Real STEEM escrow is derived from native transfer ops (zero fee):
 *   incoming transfer → issuer with memo "saos:escrow…"   → credits sender
 *   outgoing transfer issuer → user, memo "saos:withdraw:user:amt" → debits
 * Incoming transfers appear in the issuer's history even when signed by the
 * sender's active key, so escrow is provable from a single history stream.
 *
 * Solvency is MEASURED, not promised: total DEX STEEM credits vs the issuer's
 * real liquid STEEM balance → live coverage ratio.
 *
 * Server-side, read-only, never throws. v1 scans the issuer's history (all
 * ops are issuer-posting-signed); the construction extends to a union of
 * participant histories without changing the replay rules.
 */

const USERNAME_RE = /^[a-z0-9\-.]{3,16}$/i;
// Task 47: 14 pages (~1400 ops) — MUST be ≥ the verifier's window, otherwise
// stale quotes outside a shallow window become invisible and never cancelled
// (measured live: an old 0.7448 ask survived every MM beat until deepened).
const MAX_PAGES = 14;
const PAGE_SIZE = 100;
// api.steemit.com round-robins across nodes with uneven replication lag — a
// page-0 fetch can miss ops broadcast seconds ago (read-your-writes violation
// for our own MM). Guard: race several public endpoints IN PARALLEL for page
// 0 and keep the freshest view (highest newest idx); older pages are immutable
// history, so only page 0 needs the freshness fight.
const RPC_URLS = [
  "https://api.steemit.com",
  "https://steemapi.boylikegirl.club",
  "https://api.justyy.com",
  "https://api.steem.fans",
];
const RPC_URL = RPC_URLS[0];
const TRADES_KEPT = 40;
// Task 65 — multi-account scan: soldier histories are short (young accounts),
// 3 pages each is a full read today; grow with the fleet as needed.
const EXTRA_MAX_PAGES = 3;
/** Fallback roster when the agent state file is unavailable. */
const ROSTER_FALLBACK = [
  "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic", "wog", "woq", "ynet",
];

/**
 * Task 65 — fleet roster for the multi-account scan. Primary source is the
 * daemon's own fleet state (seqBy keys = accounts that actually ping), so a
 * factory-minted identity is picked up automatically. No secrets here —
 * usernames only, all public on-chain identities.
 */
async function loadFleetRoster(issuer: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    const fs = await import("fs");
    const path = await import("path");
    const p = path.join(process.cwd(), "agent", "fleet_state.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { seqBy?: Record<string, number> };
    for (const name of Object.keys(raw.seqBy ?? {})) {
      const n = name.toLowerCase();
      if (n !== issuer && USERNAME_RE.test(n)) out.add(n);
    }
  } catch {
    /* fall through to the static roster */
  }
  for (const n of ROSTER_FALLBACK) {
    if (n !== issuer && USERNAME_RE.test(n)) out.add(n);
  }
  return [...out].sort();
}

let dexRpcId = 3100;
async function rpc<T>(method: string, params: unknown, url: string = RPC_URL): Promise<T> {
  // hard 12s ceiling per call — a dead/overloaded public node must never hold
  // the snapshot hostage (measured: serial extras scan = minute-long API)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++dexRpcId }),
      cache: "no-store",
      signal: ctrl.signal,
    });
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (json.error) throw new Error(`${method}: ${json.error.message ?? "RPC error"}`);
    if (json.result === undefined) throw new Error(`${method}: empty result`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

export interface DexBookRow {
  oid: string
  owner: string
  price: number
  remaining: number
  placedTime: string
}

export interface DexTrade {
  idx: number
  time: string
  txid: string
  oid: string
  /** Side of the resting (maker) order. */
  side: "buy" | "sell"
  maker: string
  taker: string
  amount: number
  price: number
  selfTrade: boolean
}

export interface DexBalanceRow {
  account: string
  saos: number
  locked: number
  credit: number
}

/**
 * Task 47 — AMM pool on the feeless custom_json bus. The pool IS a smart
 * contract implemented as a deterministic replay of issuer-history ops —
 * the chain doesn't know it can host this; the construction proves it can.
 *
 *   pool_init  {pair, feeBps, account}                     — create (once)
 *   pool_add   {pair, account, saosAmt, steemAmt}          — deposit both legs,
 *              receive LP shares (first: √(saos×steem), then pro-rata)
 *   pool_swap  {pair, taker, side:"sell_saos"|"buy_saos", inAmt}
 *              x·y=k with fee (feeBps) accruing to the reserves (LPs)
 *   pool_remove {pair, account, lpAmt}                     — burn shares →
 *              pro-rata reserves back to SAOS balance / STEEM credit
 *
 * The STEEM leg of a pool is DEX-credit (escrowed STEEM) — solvency stays
 * measured: every credit the pool owes is backed by the issuer's real balance.
 */
export interface DexPool {
  pair: string
  feeBps: number
  saos: number
  steem: number
  lpSupply: number
  swaps: number
  feesSaos: number
  feesSteem: number
  /** Task 53 — LP shares moved to the permanent-lock bucket via pool_lock:
   *  they still earn fees (they stay in lpSupply) but can NEVER be removed. */
  locked: number
  lp: { account: string; shares: number }[]
}

export interface SaosDexResponse {
  ok: boolean
  error?: string
  issuer: string
  fetchedAt: string
  book: { asks: DexBookRow[]; bids: DexBookRow[] }
  stats: {
    lastPrice: number | null
    bestAsk: number | null
    bestBid: number | null
    spreadPct: number | null
    vol24hSaos: number
    vol24hSteem: number
    tradesTotal: number
    openOrders: number
    invalidOps: number
  }
  mine: {
    saosLiquid: number
    saosLocked: number
    steemCredit: number
    steemLocked: number
    openOids: string[]
  }
  balances: DexBalanceRow[]
  pools: DexPool[]
  solvency: { creditsTotal: number; issuerLiquidSteem: number | null; coveragePct: number | null }
  market: { feedSbdPerSteem: number | null }
  trades: DexTrade[]
  pagesScanned: number
  malformed: number
  /** Task 65 — multi-account scan: issuer + self-signed soldier histories. */
  accountsScanned: string[]
  extraOps: number
  /** Task 66 — on-chain credit settlement (action "pay"): soldier→maker quote
   * legs and future fee splits, replayed deterministically from both histories. */
  payments: DexPayment[]
}

export interface DexPayment {
  time: string
  txid: string
  from: string
  to: string
  amount: number
  ref: string
}

type HistEntry = {
  block: number
  timestamp: string
  trx_id?: string
  op: [string, Record<string, unknown>]
}

interface RawAccountBalance {
  balance: string
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
function num(asset: string | undefined): number {
  if (!asset) return 0;
  return parseFloat(asset.split(" ")[0]) || 0;
}
function assetUnit(asset: string | undefined): string {
  return asset?.split(" ")[1] ?? "";
}

function parseSaosJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* malformed */
  }
  return null;
}

export async function fetchDexSnapshot(issuerInput: string): Promise<SaosDexResponse> {
  // 45s in-process cache — the multi-account scan is heavier now (issuer +
  // fleet extras); the daemon and the UI poll this route and must never
  // stampede the public nodes (measured: stampede = minute-long hangs).
  const issuer = issuerInput.toLowerCase();
  const cached = DEX_CACHE.get(issuer);
  if (cached && Date.now() - cached.at < DEX_CACHE_MS) return cached.snap;
  const snap = await fetchDexSnapshotLive(issuer);
  DEX_CACHE.set(issuer, { at: Date.now(), snap });
  return snap;
}

const DEX_CACHE_MS = 45_000;
const DEX_CACHE = new Map<string, { at: number; snap: SaosDexResponse }>();

async function fetchDexSnapshotLive(issuer: string): Promise<SaosDexResponse> {
  const base: SaosDexResponse = {
    ok: false,
    issuer,
    fetchedAt: new Date().toISOString(),
    book: { asks: [], bids: [] },
    stats: {
      lastPrice: null,
      bestAsk: null,
      bestBid: null,
      spreadPct: null,
      vol24hSaos: 0,
      vol24hSteem: 0,
      tradesTotal: 0,
      openOrders: 0,
      invalidOps: 0,
    },
    mine: { saosLiquid: 0, saosLocked: 0, steemCredit: 0, steemLocked: 0, openOids: [] },
    balances: [],
    pools: [],
    solvency: { creditsTotal: 0, issuerLiquidSteem: null, coveragePct: null },
    market: { feedSbdPerSteem: null },
    trades: [],
    pagesScanned: 0,
    malformed: 0,
    accountsScanned: [issuer],
    extraOps: 0,
    payments: [],
  };
  if (!USERNAME_RE.test(issuer)) {
    base.error = "bad username";
    return base;
  }

  try {
    // ── 1. Pull the full history (newest → oldest pages), then replay ascending.
    const pages: [number, HistEntry][][] = [];
    let lowest = -1;
    {
      // page 0: parallel multi-endpoint race, keep the FRESHEST view
      const settled = await Promise.allSettled(
        RPC_URLS.map((u) =>
          rpc<[number, HistEntry][]>("condenser_api.get_account_history", [issuer, -1, PAGE_SIZE], u)
        )
      );
      let freshest: [number, HistEntry][] | null = null;
      let newestIdx = -1;
      for (const s of settled) {
        if (s.status !== "fulfilled" || !Array.isArray(s.value) || s.value.length === 0) continue;
        const entries = s.value.map(([idx, e]) => [idx, e] as [number, HistEntry]);
        const pageNewest = entries.reduce((m, [idx]) => Math.max(m, idx), -1);
        if (pageNewest > newestIdx) {
          newestIdx = pageNewest;
          freshest = entries;
        }
      }
      if (freshest) {
        base.pagesScanned++;
        pages.push(freshest);
        lowest = idx0(freshest);
      }
    }
    for (let p = 1; p < MAX_PAGES; p++) {
      if (lowest <= 0) break;
      const start = lowest - 1;
      const raw = await rpc<[number, HistEntry][]>("condenser_api.get_account_history", [
        issuer,
        start,
        PAGE_SIZE,
      ]);
      if (!Array.isArray(raw) || raw.length === 0) break;
      base.pagesScanned++;
      const entries = raw.map(([idx, e]) => [idx, e] as [number, HistEntry]);
      pages.push(entries);
      lowest = entries.reduce((m, [idx]) => Math.min(m, idx), lowest);
    }
    // ascending idx with defensive cross-page dedupe (never replay an op twice)
    const seenIdx = new Set<number>();
    const issuerEntries = pages
      .flat()
      .filter(([idx]) => (seenIdx.has(idx) ? false : (seenIdx.add(idx), true)));

    // ── Task 65 — multi-account scan (soldier self-signed DEX ops) ──
    // The structural wall this breaks: until now every DEX op was issuer-posting
    // signed (relayed), concentrating RC and capping the whole fleet on one key.
    // Soldiers now sign their own custom_json id="saos" ops — those appear in
    // the SOLDIER's history, which this scan unions into the replay.
    // Safety: extras contribute custom_json ONLY (transfers stay issuer-scoped,
    // so the escrow rails can never double-count across from/to histories),
    // and custom_json dedupes globally by trx_id.
    const roster = await loadFleetRoster(issuer);
    const extras: { entry: [number, HistEntry]; src: number }[] = [];
    let extraOps = 0;
    const seenTrx = new Set<string>(
      issuerEntries.map(([, e]) => e.trx_id ?? "").filter(Boolean)
    );
    // Parallel across accounts (sequential pages within one account): the API
    // is polled by the daemon and the UI — 11 accounts × 1-3 pages must not
    // serialize into a minute-long response (measured: serial = hang).
    const perAccount = await Promise.allSettled(
      roster.map(async (name, s) => {
        const found: { entry: [number, HistEntry]; src: number }[] = [];
        let lowest = -1;
        for (let p = 0; p < EXTRA_MAX_PAGES; p++) {
          const start = lowest === -1 ? -1 : lowest - 1;
          if (start !== -1 && start <= 0) break;
          const raw = await rpc<[number, HistEntry][]>(
            "condenser_api.get_account_history",
            [name, start, PAGE_SIZE],
            RPC_URLS[p % RPC_URLS.length]
          ).catch(() => null);
          if (!Array.isArray(raw) || raw.length === 0) break;
          for (const [idx, e] of raw) {
            if (lowest === -1 || idx < lowest) lowest = idx;
            const [type, value] = e.op ?? [];
            if (type !== "custom_json" || value?.id !== "saos") continue;
            const payload = parseSaosJson(value.json);
            if (!payload || payload.protocol !== "saos/v1") continue;
            found.push({ entry: [idx, e], src: s + 1 });
          }
        }
        return found;
      })
    );
    for (const r of perAccount) {
      if (r.status !== "fulfilled") continue;
      for (const { entry } of r.value) {
        const key = entry[1].trx_id ?? "";
        if (key && seenTrx.has(key)) continue; // cross-account dedupe
        if (key) seenTrx.add(key);
        extras.push({ entry, src: 0 });
        extraOps++;
      }
    }
    // deterministic global order: chain time, then issuer-first, then idx
    const all = [
      ...issuerEntries.map((entry) => ({ entry: entry as [number, HistEntry], src: 0 })),
      ...extras,
    ]
      .sort((A, B) => {
        const tA = A.entry[1].timestamp || "";
        const tB = B.entry[1].timestamp || "";
        if (tA !== tB) return tA < tB ? -1 : 1;
        if (A.src !== B.src) return A.src - B.src;
        return A.entry[0] - B.entry[0];
      })
      .map(({ entry }) => entry);
    base.accountsScanned = [issuer, ...roster];
    base.extraOps = extraOps;

    // ── 2. Replay state
    const saos = new Map<string, number>(); // SAOS-1 liquid balance per account
    const locked = new Map<string, number>(); // SAOS-1 locked in open sell orders
    const credit = new Map<string, number>(); // DEX STEEM credit (escrowed)
    const creditLocked = new Map<string, number>(); // STEEM credit locked in open buy orders
    const orders = new Map<
      string,
      {
        oid: string; side: "buy" | "sell"; owner: string; price: number; amount: number;
        filled: number; status: "open" | "cancelled" | "filled" | "invalid";
        placedIdx: number; placedTime: string; closedIdx?: number; closedTime?: string;
      }
    >();
    const pools = new Map<
      string,
      { pair: string; feeBps: number; saos: number; steem: number; lpSupply: number;
        swaps: number; feesSaos: number; feesSteem: number; locked: number; lp: Map<string, number> }
    >();
    const trades: DexTrade[] = [];
    const payments: DexPayment[] = []; // Task 66 — credit settlement rail
    let lastPrice: number | null = null;
    let malformed = 0;
    let invalidOps = 0;

    const addSaos = (a: string, v: number) => saos.set(a, r3((saos.get(a) ?? 0) + v));
    const addLocked = (a: string, v: number) => locked.set(a, r3((locked.get(a) ?? 0) + v));
    const addCredit = (a: string, v: number) => credit.set(a, r6((credit.get(a) ?? 0) + v));
    const addCreditLocked = (a: string, v: number) =>
      creditLocked.set(a, r6((creditLocked.get(a) ?? 0) + v));

    for (const [idx, entry] of all) {
      const [type, value] = entry.op;

      // Native escrow rails (zero-fee transfers carrying saos: memos)
      if (type === "transfer") {
        const from = String(value.from ?? "").toLowerCase();
        const to = String(value.to ?? "").toLowerCase();
        const memo = String(value.memo ?? "");
        const amt = num(String(value.amount ?? ""));
        if (memo.startsWith("saos:escrow") && to === issuer && assetUnit(String(value.amount ?? "")) === "STEEM" && amt > 0) {
          addCredit(from, amt);
          continue;
        }
        if (memo.startsWith("saos:withdraw") && from === issuer && assetUnit(String(value.amount ?? "")) === "STEEM" && amt > 0) {
          const user = memo.split(":")[2]?.toLowerCase() || to;
          addCredit(user, -amt);
          continue;
        }
        continue; // ordinary transfer — not part of the DEX
      }

      if (type !== "custom_json" || value?.id !== "saos") continue;
      const payload = parseSaosJson(value.json);
      if (!payload || payload.protocol !== "saos/v1") {
        malformed++;
        continue;
      }
      const action = String(payload.action ?? "");
      const time = entry.timestamp;
      const txid = entry.trx_id ?? "";
      const account = String(payload.account ?? payload.from ?? issuer).toLowerCase();

      if (action === "mint" || action === "burn" || action === "transfer") {
        // Token-ledger base layer (same rules as /api/ops/saos/token)
        const amount = r3(Number(payload.amount ?? 0));
        const to = String(payload.to ?? "").toLowerCase();
        if (!(amount > 0) || !Number.isFinite(amount)) { invalidOps++; continue; }
        if (action === "mint") addSaos(to, amount);
        else if (action === "burn") addSaos(account, -amount);
        else { addSaos(account, -amount); addSaos(to, amount); }
        continue;
      }

      if (action === "order") {
        const oid = String(payload.oid ?? "");
        const side = payload.side === "buy" ? "buy" : payload.side === "sell" ? "sell" : null;
        const price = r6(Number(payload.price ?? 0));
        const amount = r3(Number(payload.amount ?? 0));
        if (!oid || !side || !(price > 0) || !(amount > 0) || orders.has(oid)) {
          invalidOps++;
          continue;
        }
        if (side === "sell") {
          if ((saos.get(account) ?? 0) + 1e-9 < amount) {
            orders.set(oid, { oid, side, owner: account, price, amount, filled: 0, status: "invalid", placedIdx: idx, placedTime: time });
            invalidOps++;
            continue;
          }
          addSaos(account, -amount);
          addLocked(account, amount);
        } else {
          const cost = r6(price * amount);
          if ((credit.get(account) ?? 0) + 1e-9 < cost) {
            orders.set(oid, { oid, side, owner: account, price, amount, filled: 0, status: "invalid", placedIdx: idx, placedTime: time });
            invalidOps++;
            continue;
          }
          addCredit(account, -cost);
          addCreditLocked(account, cost);
        }
        orders.set(oid, { oid, side, owner: account, price, amount, filled: 0, status: "open", placedIdx: idx, placedTime: time });
        continue;
      }

      if (action === "cancel") {
        const oid = String(payload.oid ?? "");
        const o = orders.get(oid);
        if (!o || o.status !== "open" || o.owner !== account) { invalidOps++; continue; }
        if (o.side === "sell") {
          const back = r3(o.amount - o.filled);
          addLocked(o.owner, -back);
          addSaos(o.owner, back);
        }
        else { const back = r6(o.price * (o.amount - o.filled)); addCreditLocked(o.owner, -back); addCredit(o.owner, back); }
        o.status = "cancelled";
        o.closedIdx = idx;
        o.closedTime = time;
        continue;
      }

      if (action === "fill") {
        const oid = String(payload.oid ?? "");
        const taker = String(payload.taker ?? account).toLowerCase();
        const amt = r3(Number(payload.amount ?? 0));
        const o = orders.get(oid);
        if (!o || o.status !== "open" || !(amt > 0) || amt > o.amount - o.filled + 1e-9) {
          invalidOps++;
          continue;
        }
        if (o.side === "sell") {
          // taker buys SAOS with DEX STEEM credit; maker's locked SAOS pays out
          const cost = r6(o.price * amt);
          if ((credit.get(taker) ?? 0) + 1e-9 < cost) { invalidOps++; continue; }
          addLocked(o.owner, -amt);
          addSaos(taker, amt);
          addCredit(taker, -cost);
          addCredit(o.owner, cost);
        } else {
          // taker sells SAOS into the resting bid; maker's locked credit pays
          if ((saos.get(taker) ?? 0) + 1e-9 < amt) { invalidOps++; continue; }
          const cost = r6(o.price * amt);
          addSaos(taker, -amt);
          addSaos(o.owner, amt);
          addCreditLocked(o.owner, -cost);
          addCredit(taker, cost);
        }
        o.filled = r3(o.filled + amt);
        if (o.filled >= o.amount - 1e-9) {
          o.status = "filled";
          o.closedIdx = idx;
          o.closedTime = time;
        }
        lastPrice = o.price;
        trades.push({
          idx, time, txid, oid, side: o.side, maker: o.owner, taker,
          amount: amt, price: o.price, selfTrade: o.owner === taker,
        });
        continue;
      }
      // ── Task 47: AMM pool ops (the on-chain smart contract layer)
      // ── Task 53: pool_lock — permanent-liquidity lock (value-lock doctrine)
      if (action === "pool_init" || action === "pool_add" || action === "pool_swap" || action === "pool_remove" || action === "pool_lock") {
        const pair = String(payload.pair ?? "SAOS:STEEM").toUpperCase();
        if (action === "pool_init") {
          if (pools.has(pair)) { invalidOps++; continue; }
          const feeBps = Math.round(Number(payload.feeBps ?? 30));
          if (!(feeBps >= 0 && feeBps <= 1000)) { invalidOps++; continue; }
          pools.set(pair, { pair, feeBps, saos: 0, steem: 0, lpSupply: 0, swaps: 0, feesSaos: 0, feesSteem: 0, locked: 0, lp: new Map() });
          continue;
        }
        const p = pools.get(pair);
        if (!p) { invalidOps++; continue; }

        if (action === "pool_add") {
          const sIn = r3(Number(payload.saosAmt ?? 0));
          const tIn = r6(Number(payload.steemAmt ?? 0));
          if (sIn < 0 || tIn < 0 || (sIn === 0 && tIn === 0)) { invalidOps++; continue; }
          if ((saos.get(account) ?? 0) + 1e-9 < sIn || (credit.get(account) ?? 0) + 1e-9 < tIn) { invalidOps++; continue; }
          let shares: number;
          if (p.lpSupply <= 1e-9) {
            if (sIn <= 0 || tIn <= 0) { invalidOps++; continue; } // genesis needs both legs
            shares = r6(Math.sqrt(sIn * tIn));
          } else {
            const rS = sIn > 0 ? (sIn / p.saos) : Number.POSITIVE_INFINITY;
            const rT = tIn > 0 ? (tIn / p.steem) : Number.POSITIVE_INFINITY;
            const ratio = Math.min(rS, rT);
            if (!Number.isFinite(ratio) || ratio <= 0) { invalidOps++; continue; }
            shares = r6(ratio * p.lpSupply);
          }
          if (!(shares > 1e-9)) { invalidOps++; continue; }
          addSaos(account, -sIn);
          addCredit(account, -tIn);
          p.saos = r3(p.saos + sIn);
          p.steem = r6(p.steem + tIn);
          p.lpSupply = r6(p.lpSupply + shares);
          p.lp.set(account, r6((p.lp.get(account) ?? 0) + shares));
          continue;
        }

        if (action === "pool_swap") {
          const taker = String(payload.taker ?? account).toLowerCase();
          const side = String(payload.side ?? "");
          const inAmt = Number(payload.inAmt ?? 0);
          const withFee = r6(inAmt * (1 - p.feeBps / 10000));
          if (!(inAmt > 0) || !(withFee > 0)) { invalidOps++; continue; }
          if (side === "sell_saos") {
            if ((saos.get(taker) ?? 0) + 1e-9 < inAmt || p.steem <= 1e-9) { invalidOps++; continue; }
            const out = r6((p.steem * withFee) / (p.saos + withFee));
            if (!(out > 1e-6) || out >= p.steem) { invalidOps++; continue; }
            addSaos(taker, -r3(inAmt));
            addCredit(taker, out);
            p.saos = r3(p.saos + inAmt);
            p.steem = r6(p.steem - out);
            p.feesSteem = r6(p.feesSteem + (r6(inAmt) - withFee));
          } else if (side === "buy_saos") {
            if ((credit.get(taker) ?? 0) + 1e-9 < inAmt || p.saos <= 1e-9) { invalidOps++; continue; }
            const out = r3((p.saos * withFee) / (p.steem + withFee));
            if (!(out > 1e-6) || out >= p.saos) { invalidOps++; continue; }
            addCredit(taker, -inAmt);
            addSaos(taker, out);
            p.steem = r6(p.steem + inAmt);
            p.saos = r3(p.saos - out);
            p.feesSaos = r3(p.feesSaos + (r3(inAmt) - r3(withFee)));
          } else { invalidOps++; continue; }
          p.swaps += 1;
          continue;
        }

        if (action === "pool_remove") {
          const burn = r6(Number(payload.lpAmt ?? 0));
          const have = p.lp.get(account) ?? 0;
          if (!(burn > 1e-9) || have + 1e-9 < burn || p.lpSupply + 1e-9 < burn) { invalidOps++; continue; }
          const sOut = r3((p.saos * burn) / p.lpSupply);
          const tOut = r6((p.steem * burn) / p.lpSupply);
          p.saos = r3(p.saos - sOut);
          p.steem = r6(p.steem - tOut);
          p.lpSupply = r6(p.lpSupply - burn);
          const left = r6(have - burn);
          if (left > 1e-9) p.lp.set(account, left); else p.lp.delete(account);
          addSaos(account, sOut);
          addCredit(account, tOut);
          continue;
        }

        // Task 53 — pool_lock: move a deterministic pct of the account's LP into
        // the locked bucket. Locked shares keep earning fees (still in lpSupply)
        // but are permanently withdrawn-proof: pool_remove only sees p.lp.
        if (action === "pool_lock") {
          const have = p.lp.get(account) ?? 0;
          const pct = Math.min(Math.max(Number(payload.pct ?? 0), 0), 1);
          const burn = r6(have * pct);
          if (!(burn > 1e-9)) { invalidOps++; continue; }
          const left = r6(have - burn);
          if (left > 1e-9) p.lp.set(account, left); else p.lp.delete(account);
          p.locked = r6((p.locked ?? 0) + burn);
          continue;
        }
      }
      // Task 66 — pay: on-chain credit settlement between two accounts.
      // The missing economic primitive: quote-leg payment for wrapped-asset
      // delivery, soldier→treasury fee splits, service payments — all settled
      // ON-CHAIN as custom_json id="saos" and replayed deterministically.
      if (action === "pay") {
        const to = String(payload.to ?? "").toLowerCase();
        const amount = r6(Number(payload.amount ?? 0));
        const ref = String(payload.ref ?? "");
        if (!to || !(amount > 0) || to === account || !USERNAME_RE.test(to)) { invalidOps++; continue; }
        if ((credit.get(account) ?? 0) + 1e-9 < amount) { invalidOps++; continue; }
        addCredit(account, -amount);
        addCredit(to, amount);
        payments.push({ time, txid, from: account, to, amount, ref });
        continue;
      }
      // ping / unknown → no state effect
    }

    // ── 3. Compose the book
    const asks: DexBookRow[] = [];
    const bids: DexBookRow[] = [];
    for (const o of orders.values()) {
      if (o.status !== "open") continue;
      const row: DexBookRow = {
        oid: o.oid, owner: o.owner, price: o.price,
        remaining: r3(o.amount - o.filled), placedTime: o.placedTime,
      };
      if (o.side === "sell") asks.push(row);
      else bids.push(row);
    }
    asks.sort((a, b) => a.price - b.price);
    bids.sort((a, b) => b.price - a.price);

    const nowMs = Date.now();
    const dayAgo = nowMs - 86_400_000;
    const recent = trades.filter((t) => new Date(t.time).getTime() >= dayAgo);
    const bestAsk = asks[0]?.price ?? null;
    const bestBid = bids[0]?.price ?? null;
    const creditsTotal = r6([...credit.values()].reduce((a, b) => a + b, 0));

    // ── 4. Live solvency + feed (independent probes, never throw)
    let issuerLiquidSteem: number | null = null;
    try {
      const accs = await rpc<RawAccountBalance[]>("condenser_api.get_accounts", [[issuer]]);
      issuerLiquidSteem = accs?.[0] ? num(accs[0].balance) : null;
    } catch { /* degrade */ }
    let feedSbdPerSteem: number | null = null;
    try {
      const fh = await rpc<{ current_median_history: { base: string; quote: string } }>(
        "condenser_api.get_feed_history", [],
      );
      const b = num(fh.current_median_history?.base);
      const q = num(fh.current_median_history?.quote);
      if (b > 0 && q > 0) feedSbdPerSteem = r6(b / q);
    } catch { /* degrade */ }

    const me = issuer;
    const myOpen = [...orders.values()].filter((o) => o.status === "open" && o.owner === me);

    base.ok = true;
    base.book = { asks, bids };
    base.stats = {
      lastPrice,
      bestAsk,
      bestBid,
      spreadPct: bestAsk != null && bestBid != null ? r6(((bestAsk - bestBid) / bestAsk) * 100) : null,
      vol24hSaos: r3(recent.reduce((a, t) => a + t.amount, 0)),
      vol24hSteem: r6(recent.reduce((a, t) => a + t.amount * t.price, 0)),
      tradesTotal: trades.length,
      openOrders: asks.length + bids.length,
      invalidOps,
    };
    base.mine = {
      saosLiquid: r3(saos.get(me) ?? 0),
      saosLocked: r3(locked.get(me) ?? 0),
      steemCredit: r6(credit.get(me) ?? 0),
      steemLocked: r6(creditLocked.get(me) ?? 0),
      openOids: myOpen.map((o) => o.oid),
    };
    const accounts = new Set<string>([
      ...saos.keys(), ...locked.keys(), ...credit.keys(),
      ...pools.values().flatMap((p) => [...p.lp.keys()]),
    ]);
    base.balances = [...accounts]
      .map((account): DexBalanceRow => ({
        account, saos: r3(saos.get(account) ?? 0), locked: r3(locked.get(account) ?? 0), credit: r6(credit.get(account) ?? 0),
      }))
      .sort((a, b) => b.saos + b.locked - (a.saos + a.locked));
    base.solvency = {
      creditsTotal,
      issuerLiquidSteem,
      coveragePct: issuerLiquidSteem != null && creditsTotal > 0 ? r6((issuerLiquidSteem / creditsTotal) * 100) : null,
    };
    base.market = { feedSbdPerSteem };
    base.pools = [...pools.values()]
      .map((p): DexPool => ({
        pair: p.pair, feeBps: p.feeBps, saos: p.saos, steem: p.steem,
        lpSupply: p.lpSupply, swaps: p.swaps, feesSaos: p.feesSaos, feesSteem: p.feesSteem,
        locked: r6(p.locked ?? 0),
        lp: [...p.lp.entries()]
          .map(([account, shares]) => ({ account, shares }))
          .sort((a, b) => b.shares - a.shares),
      }))
      .sort((a, b) => b.lpSupply - a.lpSupply);
    base.trades = trades.slice(-TRADES_KEPT).reverse();
    base.payments = payments.slice(-24).reverse(); // Task 66 — settlement rail evidence
    base.malformed = malformed;
    return base;
  } catch (e) {
    base.error = String(e).slice(0, 200);
    return base;
  }
}

function idx0(entries: [number, HistEntry][]): number {
  return entries.reduce((m, [idx]) => Math.min(m, idx), Number.POSITIVE_INFINITY);
}
