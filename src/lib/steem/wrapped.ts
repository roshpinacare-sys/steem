import fs from "fs";
import path from "path";

const USERNAME_RE = /^[a-z0-9\-.]{3,16}$/i;

/**
 * Task 63 — WRAPPED: deterministic replay of the wrapped-value layer
 * (protocol saos.wrap/v1 on the free custom_json bus id="saos") plus the
 * native lock rails (transfers carrying `saos:xlock:` memos).
 *
 * The operator's ask: "pegged wrapped coins on the DEX so we capture value
 * on the orders and give our grids more resistance". This snapshot is the
 * truth source: everything below is derived ONLY from the issuer's account
 * history — the chain is the ledger, the console never invents state.
 *
 * Assets:
 *   WSBD-1  — 1:1 SBD-backed wrap. Backing measured from xlock transfers
 *             INTO the issuer (self-lock + fleet sweeps) — replay-verifiable
 *             on Steem itself.
 *   PHIVE-1 — cross-chain HIVE wrap. The lock happens on Hive (self-transfer
 *             memo saos:xlock:PHIVE); the Steem-side mint carries the Hive
 *             txid as its backing reference (declared backing + live Hive
 *             balance cross-check on the daemon side).
 *
 * Fee capture: every pool_init carries feeBps; every pool_swap accrues
 * fees = inAmt × feeBps/10000 split LP/treasury — "value from the orders".
 */

const RPC_URLS = ["https://api.justyy.com", "https://api.steemitdev.com", "https://api.steemit.com"];
const RPC_URL = RPC_URLS[0];
const PAGE_SIZE = 100;
const MAX_PAGES = 14;
const WRAP_PROTOCOL = "saos.wrap/v1";
const FEE_BPS_DEFAULT = 30;
const BATTERY = "powerspan"; // סוללת-האנרגיה של הצי (Task 58)
const PEGS: Record<string, string> = { WSBD: "SBD", PHIVE: "HIVE", ENERGY: "SP", WBTC: "BTC", WETH: "ETH", WXRP: "XRP", WDOGE: "DOGE" };
const SYNTH_COINS = new Set(["WBTC", "WETH", "WXRP", "WDOGE"]);
// Task 66 — multi-account replay for the WRAP layer (same lesson as Task 65):
// wrap fills/burns signed by SOLDIERS live in the soldier's history, not the
// issuer's — without the union the lifecycle replay misses delivery/redemption.
const WRAP_EXTRA_MAX_PAGES = 3;
const WRAP_ROSTER_FALLBACK = [
  "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic", "wog", "woq", "ynet",
];

async function loadWrapRoster(issuer: string): Promise<string[]> {
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
  for (const n of WRAP_ROSTER_FALLBACK) {
    if (n !== issuer && USERNAME_RE.test(n)) out.add(n);
  }
  return [...out].sort();
}

type HistEntry = { trx_id?: string; block?: number; timestamp?: string; op: [string, Record<string, unknown>] };

async function rpc<T>(method: string, params: unknown, url: string = RPC_URL): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "rpc error");
  if (j.result === undefined) throw new Error("empty rpc result");
  return j.result;
}

function r3(n: number): number {
  return Math.round(n * 1e3) / 1e3;
}
function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
function num(asset: string | undefined): number {
  return parseFloat(String(asset ?? "").split(" ")[0]) || 0;
}
function unit(asset: string | undefined): string {
  return String(asset ?? "").split(" ")[1] || "";
}
function parseJson(raw: unknown): Record<string, unknown> | null {
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
  } catch (_) {
    return null;
  }
}

/** Task 64 — תביעת-הגיבוי לפי-סוג-נכס (מה-payload של המינט) */
function claimFor(symbol: string, bk: Record<string, unknown> | undefined, amt: number): number {
  if (!bk) return amt;
  if (symbol === "WSBD") return Number(bk.lockedSbd ?? 0) || amt;
  if (symbol === "PHIVE") return Number(bk.lockedHive ?? 0) || amt;
  if (symbol === "ENERGY") return Number(bk.lockedSp ?? 0) || amt;
  return Number(bk.lockedSteem ?? 0) || amt; // WBTC/WETH/WXRP/WDOGE — collateral-oracle
}

/** Task 64 — אורקל-חי לשערי-הסינתטיים (Binance; cache 60s; null כן בכישלון) */
let oracleCache: { at: number; prices: Record<string, number> | null } = { at: 0, prices: null };
async function fetchOraclePrices(): Promise<Record<string, number> | null> {
  if (Date.now() - oracleCache.at < 60_000) return oracleCache.prices;
  const prices: Record<string, number> = {};
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbols=" + encodeURIComponent('["BTCUSDT","ETHUSDT","XRPUSDT","DOGEUSDT"]'),
      { signal: AbortSignal.timeout(8000), cache: "no-store" }
    );
    const j = (await res.json()) as { symbol: string; price: string }[];
    if (Array.isArray(j)) for (const r of j) prices[String(r.symbol).replace("USDT", "")] = parseFloat(r.price);
  } catch (_) {
    /* honest null */
  }
  oracleCache = { at: Date.now(), prices: Object.keys(prices).length === 4 ? prices : null };
  return oracleCache.prices;
}

export interface WrapOrder {
  oid: string;
  side: "buy" | "sell";
  owner: string;
  price: number;
  amount: number;
  remaining: number;
  status: "open" | "cancelled" | "filled";
  placedAt: string | null;
}
export interface WrapPool {
  pair: string;
  feeBps: number;
  base: number;
  quote: number;
  swaps: number;
  feesTotal: number;
  feesLp: number;
  feesTreasury: number;
}
export interface WrapAsset {
  symbol: string;
  peg: string;
  supply: number;
  backing: {
    mode: string; lockedSbd: number; lockedHive: number; lockedSp: number; lockedSteem: number;
    chain: string; refs: string[];
  };
  backingRatioPct: number | null;
  fairSteem: number | null;
  book: { asks: WrapOrder[]; bids: WrapOrder[] };
  pools: WrapPool[];
  mints: number;
  burns: number;
  /** Task 66 — lifecycle: redeemed (burned-through-replay) + holder balances */
  redeemed: number;
  unlocked: number;
  holders: { account: string; balance: number }[];
}
export interface WrappedSnapshot {
  ok: boolean;
  issuer: string;
  fetchedAt: string;
  assets: WrapAsset[];
  fees: { totalCaptured: number; lp: number; treasury: number };
  locks: { symbol: string; from: string; amount: number; txid: string; at: string | null; block: number | null }[];
  measured: { feedSbdPerSteem: number | null; steemSbdBalance: number | null; actions: number; lastActionAt: string | null };
  actions: { at: string | null; block: number | null; txid: string; kind: string; detail: string }[];
  pagesScanned: number;
  malformed: number;
  /** Task 66 — multi-account wrap replay: self-signed soldier wrap ops */
  extrasOps: number;
  error?: string;
}

export async function fetchWrappedSnapshot(issuerInput: string): Promise<WrappedSnapshot> {
  const issuer = issuerInput.toLowerCase();
  const base: WrappedSnapshot = {
    ok: false,
    issuer,
    fetchedAt: new Date().toISOString(),
    assets: [],
    fees: { totalCaptured: 0, lp: 0, treasury: 0 },
    locks: [],
    measured: { feedSbdPerSteem: null, steemSbdBalance: null, actions: 0, lastActionAt: null },
    actions: [],
    pagesScanned: 0,
    malformed: 0,
    extrasOps: 0,
  };
  if (!USERNAME_RE.test(issuer)) {
    base.error = "bad username";
    return base;
  }

  try {
    // ── 1. history — page 0: multi-node RACE for the freshest view; walk back
    // on the WINNING node only (nodes lag differently — mixing index spaces
    // across nodes corrupts the walk). Known live behavior (2026-09):
    // account_history is capped at limit=100/page and some nodes lag minutes→hours.
    const pages: [number, HistEntry][][] = [];
    let winner: string | null = null;
    let lowest = -1;
    {
      const settled = await Promise.allSettled(
        RPC_URLS.map(async (u) => ({ u, entries: await rpc<[number, HistEntry][]>("condenser_api.get_account_history", [issuer, -1, PAGE_SIZE], u) }))
      );
      let freshest: [number, HistEntry][] | null = null;
      let newestIdx = -1;
      for (const s of settled) {
        if (s.status !== "fulfilled" || !Array.isArray(s.value.entries) || !s.value.entries.length) continue;
        const entries = s.value.entries.map(([idx, e]) => [idx, e] as [number, HistEntry]);
        const pageNewest = entries.reduce((m, [idx]) => Math.max(m, idx), -1);
        if (pageNewest > newestIdx) { newestIdx = pageNewest; freshest = entries; winner = s.value.u; }
      }
      if (freshest) { base.pagesScanned++; pages.push(freshest); lowest = freshest.reduce((m, [idx]) => Math.min(m, idx), Infinity); }
    }
    for (let p = 1; p < MAX_PAGES && lowest > 0; p++) {
      const raw = await rpc<[number, HistEntry][]>("condenser_api.get_account_history", [issuer, lowest - 1, PAGE_SIZE], winner || RPC_URL).catch(() => null);
      if (!Array.isArray(raw) || !raw.length) break;
      base.pagesScanned++;
      const entries = raw.map(([idx, e]) => [idx, e] as [number, HistEntry]);
      pages.push(entries);
      lowest = entries.reduce((m, [idx]) => Math.min(m, idx), lowest);
    }
    const seenIdx = new Set<number>();
    const issuerEntries = pages.flat().filter(([idx]) => (seenIdx.has(idx) ? false : (seenIdx.add(idx), true))).sort((a, b) => a[0] - b[0]);

    // ── Task 66 — multi-account union for the wrap layer: soldier-signed
    // fills/burns (protocol saos.wrap/v1) live in SOLDIER histories. Extras
    // contribute custom_json ONLY (transfer rails stay issuer-scoped — zero
    // double-counting), deduped globally by trx_id, chain-time ordered.
    const wrapRoster = await loadWrapRoster(issuer);
    const seenTrxWrap = new Set<string>(issuerEntries.map(([, e]) => e.trx_id ?? "").filter(Boolean));
    const wrapExtras: [number, HistEntry][] = [];
    const perWrapAccount = await Promise.allSettled(
      wrapRoster.map(async (name, src) => {
        const found: { entry: [number, HistEntry]; src: number }[] = [];
        let lowest = -1;
        for (let p = 0; p < WRAP_EXTRA_MAX_PAGES; p++) {
          const start = lowest === -1 ? -1 : lowest - 1;
          if (start !== -1 && start <= 0) break;
          const raw = await rpc<[number, HistEntry][]>("condenser_api.get_account_history", [name, start, PAGE_SIZE], RPC_URLS[p % RPC_URLS.length]).catch(() => null);
          if (!Array.isArray(raw) || !raw.length) break;
          for (const [idx, e] of raw) {
            if (lowest === -1 || idx < lowest) lowest = idx;
            const [type, value] = e.op ?? [];
            if (type !== "custom_json" || value?.id !== "saos") continue;
            const payload = parseJson(value.json);
            if (!payload || payload.protocol !== WRAP_PROTOCOL) continue;
            found.push({ entry: [idx, e], src });
          }
        }
        return found;
      })
    );
    for (const r of perWrapAccount) {
      if (r.status !== "fulfilled") continue;
      for (const { entry } of r.value) {
        const key = entry[1].trx_id ?? "";
        if (key && seenTrxWrap.has(key)) continue;
        if (key) seenTrxWrap.add(key);
        wrapExtras.push(entry);
        base.extrasOps++;
      }
    }
    const all = [...issuerEntries, ...wrapExtras]
      .sort((a, b) => {
        const tA = a[1].timestamp || "";
        const tB = b[1].timestamp || "";
        if (tA !== tB) return tA < tB ? -1 : 1;
        return a[0] - b[0];
      });

    // ── 2. replay
    type SymState = {
      symbol: string; peg: string; supply: number; minted: number; burned: number;
      backing: { mode: string; lockedSbd: number; lockedHive: number; lockedSp: number; lockedSteem: number; chain: string; refs: string[] };
      refClaims: Map<string, number>; // ref (lock/delegation txid) → claimed backing amount — dedupes double-mints
      orders: Map<string, WrapOrder>;
      pools: Map<string, WrapPool>;
      // Task 66 — lifecycle layer: who HOLDS the wrapped asset (mint/fill move
      // it, burn REQUIRES holding), redeemed counter, and unlock acknowledgements
      holders: Map<string, number>;
      redeemed: number;
      unlocked: number;
      unlockRefs: string[];
    };
    const syms = new Map<string, SymState>();
    const getSym = (symbol: string): SymState => {
      let s = syms.get(symbol);
      if (!s) {
        s = { symbol, peg: PEGS[symbol] ?? "?", supply: 0, minted: 0, burned: 0,
          backing: { mode: "declared", lockedSbd: 0, lockedHive: 0, lockedSp: 0, lockedSteem: 0, chain: symbol === "PHIVE" ? "hive" : "steem", refs: [] },
          refClaims: new Map(), orders: new Map(), pools: new Map(),
          holders: new Map(), redeemed: 0, unlocked: 0, unlockRefs: [] };
        syms.set(symbol, s);
      }
      return s;
    };
    let feeTotal = 0, feeLp = 0, feeTreasury = 0;
    let lastActionAt: string | null = null;
    const delegations = new Map<string, { vests: number; txid: string; at: string | null }>(); // Task 64 — מסילת-האנרגיה

    const pushAction = (e: HistEntry, kind: string, detail: string) => {
      base.actions.push({ at: e.timestamp ?? null, block: e.block ?? null, txid: e.trx_id ?? "", kind, detail });
      if (e.timestamp && (!lastActionAt || e.timestamp > lastActionAt)) lastActionAt = e.timestamp;
    };

    for (const [idx, e] of all) {
      const [type, v] = e.op;

      // native lock rails — transfers with saos:xlock / saos:collat memos
      if (type === "transfer") {
        const memo = String(v.memo ?? "");
        if (!memo.startsWith("saos:")) continue;
        const parts = memo.split(":");
        const symbol = (parts[2] || "").toUpperCase();
        const amount = num(String(v.amount ?? ""));
        const au = unit(String(v.amount ?? ""));
        if (!amount) continue;
        const from = String(v.from ?? "").toLowerCase();
        const to = String(v.to ?? "").toLowerCase();
        if (au === "SBD" && symbol === "WSBD" && to === issuer) {
          const s = getSym("WSBD");
          // הגיבוי = נעילה-עצמית בלבד (אוצר→אוצר); סחיבות-צי = הכנה (עדות, לא-גיבוי)
          if (from === issuer && to === issuer) {
            s.backing.lockedSbd = r6(s.backing.lockedSbd + amount);
            s.backing.mode = "replay-verified";
            s.backing.refs.push(e.trx_id ?? "");
          }
          base.locks.push({ symbol: "WSBD", from, amount, txid: e.trx_id ?? "", at: e.timestamp ?? null, block: e.block ?? null });
          pushAction(e, from === issuer ? "wsbd-self-lock" : "wsbd-inflow", from + " → " + to + " " + amount + " SBD");
        } else if (au === "SBD" && memo.includes("xunlock") && from === issuer) {
          const s = getSym("WSBD");
          s.backing.lockedSbd = r6(Math.max(0, s.backing.lockedSbd - amount));
          pushAction(e, "wsbd-unlock", amount + " SBD released");
        } else if (au === "HIVE" && symbol === "PHIVE" && from === issuer && to === issuer) {
          // Hive-side lock mirrored on the Steem bus by the daemon — the Steem
          // history shows the same memo on cross-chain bridge ops; treat as
          // declared backing reinforcement (the Hive txid lives in the mint op).
          const s = getSym("PHIVE");
          s.backing.lockedHive = r6(s.backing.lockedHive + amount);
          base.locks.push({ symbol: "PHIVE", from, amount, txid: e.trx_id ?? "", at: e.timestamp ?? null, block: e.block ?? null });
          pushAction(e, "phive-lock-echo", "self-lock " + amount + " HIVE (mirror)");
        } else if (au === "STEEM" && memo.startsWith("saos:collat:") && from === issuer && to === issuer) {
          // Task 64 — קולטרל הסינתטיים: נעילה-עצמית שנראית לעין על-השרשרת
          const sym = (memo.split(":")[2] || "").toUpperCase();
          if (SYNTH_COINS.has(sym)) {
            const s = getSym(sym);
            s.backing.lockedSteem = r6(s.backing.lockedSteem + amount);
            s.backing.mode = "collateral-verified";
            s.backing.refs.push(e.trx_id ?? "");
            base.locks.push({ symbol: sym, from, amount, txid: e.trx_id ?? "", at: e.timestamp ?? null, block: e.block ?? null });
            pushAction(e, "collat-lock", sym + " collateral " + amount + " STEEM");
          }
        }
        continue;
      }

      if (type === "delegate_vesting_shares") {
        // Task 64 — מסילת-האנרגיה: האצלת-VESTS היא op מצטבר — הערך-האחרון
        // לכל-זוג הוא הסכום-הנוכחי. הגיבוי של ENERGY = ההאצלה אל-הסוללה.
        const del = String(v.delegator ?? "").toLowerCase();
        const dee = String(v.delegatee ?? "").toLowerCase();
        if (del === issuer && dee) {
          delegations.set(dee, { vests: num(String(v.vesting_shares ?? "")), txid: e.trx_id ?? "", at: e.timestamp ?? null });
          if (dee === BATTERY) {
            base.locks.push({ symbol: "ENERGY", from: del, amount: num(String(v.vesting_shares ?? "")), txid: e.trx_id ?? "", at: e.timestamp ?? null, block: e.block ?? null });
            pushAction(e, "energy-delegation", "battery @" + dee + " ← " + String(v.vesting_shares ?? ""));
          }
        }
        continue;
      }

      if (type !== "custom_json" || v?.id !== "saos") continue;
      const payload = parseJson(v.json);
      if (!payload) { base.malformed++; continue; }
      if (payload.protocol !== WRAP_PROTOCOL) continue; // אוטובוס saos/v1 אחר — לא-שכבת-העגונים
      const action = String(payload.action ?? "");
      let symbol = String(payload.symbol ?? "").toUpperCase();
      if (!symbol && typeof payload.pair === "string" && payload.pair.includes(":")) {
        symbol = String(payload.pair).split(":")[0].toUpperCase(); // order/pool ops carry pair, not symbol
      }
      if (!symbol) { base.malformed++; continue; }
      const s = getSym(symbol);
      const amt = Number(payload.amount ?? 0);

      if (action === "mint") {
        if (!(amt > 0)) { base.malformed++; continue; }
        // Task 64 — דיוק מלא (ללא r3): היצע-סינתטיים זעיר (7e-8) לא יימחק בעיגול
        s.minted = s.minted + amt;
        s.supply = s.supply + amt;
        const mintTo = String(payload.account ?? payload.to ?? issuer).toLowerCase(); // Task 66 — holders
        s.holders.set(mintTo, r6((s.holders.get(mintTo) ?? 0) + amt));
        const bk = payload.backing as Record<string, unknown> | undefined;
        const ref = typeof payload.ref === "string" ? payload.ref : "";
        if (bk && typeof bk === "object" && ref) {
          // גיבוי נספר פעם-אחת לכל-ref — מנפק-כפול על-אותו-נעילה לא מנפח גיבוי
          if (!s.refClaims.has(ref)) {
            const claim = claimFor(symbol, bk, amt);
            s.refClaims.set(ref, claim);
          }
        }
        if (typeof bk?.mode === "string") s.backing.mode = String(bk.mode);
        if (symbol === "PHIVE" && bk) s.backing.chain = "hive";
        if (ref) s.backing.refs.push(ref);
        pushAction(e, "mint", symbol + " +" + amt + " (ref " + String(ref || "—").slice(0, 18) + ")");
      } else if (action === "burn") {
        if (!(amt > 0)) { base.malformed++; continue; }
        // Task 66 — redemption honesty: burn REQUIRES holding. The redeemer
        // must have received the asset through the replay (mint/fill) — no
        // phantom redemptions, the unlock that follows is backed by a real
        // holder balance. payload.account = the burner (self-signed).
        const burner = String(payload.account ?? issuer).toLowerCase();
        const held = s.holders.get(burner) ?? 0;
        if (held + 1e-9 < amt) { base.malformed++; continue; }
        s.holders.set(burner, r6(held - amt));
        s.burned = s.burned + amt;
        s.redeemed = r6(s.redeemed + amt);
        s.supply = Math.max(0, s.supply - amt);
        pushAction(e, "burn", symbol + " −" + amt + " by " + burner + " → redemption path armed");
      } else if (action === "unlock") {
        // Task 66 — unlock-ack: the native chain released collateral (ref = the
        // native unlock txid, e.g. Hive self-transfer memo saos:xunlock:PHIVE).
        // Backing lock counter decreases — conservation: locked ≥ supply holds
        // end-to-end through the full lifecycle.
        const uAmt = Number(payload.amount ?? 0);
        const uRef = String(payload.ref ?? "");
        if (!(uAmt > 0) || !uRef) { base.malformed++; continue; }
        if (symbol === "PHIVE") s.backing.lockedHive = r6(Math.max(0, s.backing.lockedHive - uAmt));
        else if (symbol === "WSBD") s.backing.lockedSbd = r6(Math.max(0, s.backing.lockedSbd - uAmt));
        else if (symbol === "ENERGY") s.backing.lockedSp = r6(Math.max(0, s.backing.lockedSp - uAmt));
        else if (SYNTH_COINS.has(symbol)) s.backing.lockedSteem = r6(Math.max(0, s.backing.lockedSteem - uAmt));
        s.unlocked = r6(s.unlocked + uAmt);
        s.unlockRefs.push(uRef);
        pushAction(e, "unlock", symbol + " −" + uAmt + " collateral released (ref " + uRef.slice(0, 18) + ")");
      } else if (action === "order") {
        const oid = String(payload.oid ?? "");
        const side = payload.side === "buy" ? "buy" : "sell";
        const price = Number(payload.price ?? 0);
        const amount = Number(payload.amount ?? 0);
        if (!oid || !(price > 0) || !(amount > 0)) { base.malformed++; continue; }
        s.orders.set(oid, { oid, side, owner: String(payload.account ?? issuer).toLowerCase(), price, amount, remaining: amount, status: "open", placedAt: e.timestamp ?? null });
        pushAction(e, "order", oid + " " + side + " " + amount + " @ " + price);
      } else if (action === "cancel") {
        const oid = String(payload.oid ?? "");
        const o = s.orders.get(oid);
        if (o) { o.status = "cancelled"; o.remaining = 0; }
        pushAction(e, "cancel", oid);
      } else if (action === "fill") {
        const oid = String(payload.oid ?? "");
        const amount = Number(payload.amount ?? 0);
        const o = s.orders.get(oid);
        if (o && amount > 0) {
          o.remaining = r3(Math.max(0, o.remaining - amount));
          if (o.remaining <= 0) o.status = "filled";
          // Task 66 — delivery: the asset MOVES maker→taker (sell) or
          // taker→maker (buy) in the holders ledger, so a later burn can only
          // come from a real on-chain acquisition path.
          const taker = String(payload.taker ?? issuer).toLowerCase();
          if (o.side === "sell") {
            const makerHeld = s.holders.get(o.owner) ?? 0;
            s.holders.set(o.owner, Math.max(0, r6(makerHeld - amount)));
            s.holders.set(taker, r6((s.holders.get(taker) ?? 0) + amount));
          } else {
            const takerHeld = s.holders.get(taker) ?? 0;
            if (takerHeld + 1e-9 >= amount) {
              s.holders.set(taker, r6(takerHeld - amount));
              s.holders.set(o.owner, r6((s.holders.get(o.owner) ?? 0) + amount));
            }
          }
          const fee = r6(amount * o.price * FEE_BPS_DEFAULT / 10000);
          feeTotal = r6(feeTotal + fee);
          feeTreasury = r6(feeTreasury + fee / 2);
          feeLp = r6(feeLp + fee / 2);
        }
        pushAction(e, "fill", oid + " filled " + amount + " (fee " + FEE_BPS_DEFAULT + "bps)");
      } else if (action === "pool_init") {
        const pair = String(payload.pair ?? "");
        if (!pair) { base.malformed++; continue; }
        s.pools.set(pair, { pair, feeBps: Number(payload.feeBps ?? FEE_BPS_DEFAULT), base: 0, quote: 0, swaps: 0, feesTotal: 0, feesLp: 0, feesTreasury: 0 });
        pushAction(e, "pool_init", pair + " fee " + Number(payload.feeBps ?? FEE_BPS_DEFAULT) + "bps");
      } else if (action === "pool_add") {
        const pair = String(payload.pair ?? "");
        const pool = s.pools.get(pair);
        if (pool) {
          pool.base = r6(pool.base + Number(payload.baseAmt ?? 0));
          pool.quote = r6(pool.quote + Number(payload.quoteAmt ?? 0));
          pushAction(e, "pool_add", pair + " + " + Number(payload.baseAmt ?? 0) + "/" + Number(payload.quoteAmt ?? 0));
        }
      } else if (action === "pool_swap") {
        const pair = String(payload.pair ?? "");
        const pool = s.pools.get(pair);
        if (pool && Number(payload.inAmt) > 0) {
          const inAmt = Number(payload.inAmt);
          const fee = r6(inAmt * pool.feeBps / 10000);
          pool.swaps++;
          pool.feesTotal = r6(pool.feesTotal + fee);
          pool.feesLp = r6(pool.feesLp + fee / 2);
          pool.feesTreasury = r6(pool.feesTreasury + fee / 2);
          // constant-product: "buy_base" adds quote (in after fee) and removes base;
          // "sell_base" adds base and removes quote — both fee-adjusted (Task 65 fix:
          // inAfterFee was scoped inside the buy branch and crashed sell-side replays)
          const side = String(payload.side ?? "");
          const inAfterFee = inAmt - fee;
          if (side.startsWith("buy_")) {
            pool.quote = r6(pool.quote + inAfterFee);
            pool.base = r6(pool.base > 0 ? (pool.base * pool.quote) / (pool.quote + inAfterFee) : 0);
            pool.base = r6(Math.max(0, pool.base));
          } else {
            pool.base = r6(pool.base + inAfterFee);
            pool.quote = r6(pool.quote > 0 ? (pool.quote * pool.base) / (pool.base + inAfterFee) : 0);
            pool.quote = r6(Math.max(0, pool.quote));
          }
          feeTotal = r6(feeTotal + fee);
          feeLp = r6(feeLp + fee / 2);
          feeTreasury = r6(feeTreasury + fee / 2);
          pushAction(e, "pool_swap", pair + " " + side + " " + inAmt + " fee " + fee);
        }
      }
    }

    // ── 3. live measured anchors
    let feedSbdPerSteem: number | null = null;
    let sbdBalance: number | null = null;
    let steemPerVest: number | null = null;
    try {
      // get_current_price_feed was retired on public nodes — median feed via
      // get_feed_history is the honest declared anchor (book price rules).
      const fh = await rpc<{ current_median_history: { base: string; quote: string } }>("condenser_api.get_feed_history", []);
      const b = parseFloat(String(fh.current_median_history.base).split(" ")[0]);
      const q = parseFloat(String(fh.current_median_history.quote).split(" ")[0]);
      if (q > 0) feedSbdPerSteem = b / q;
    } catch (_) { /* honest null */ }
    try {
      const [acc] = await rpc<{ sbd_balance: string }[]>("condenser_api.get_accounts", [[issuer]]);
      sbdBalance = num(acc.sbd_balance);
    } catch (_) { /* honest null */ }
    try {
      // Task 64 — קצב-SP להמרת ההאצלה ל-SP (חוק-שימור-האנרגיה בר-הצגה)
      const dgp = await rpc<{ total_vesting_fund_steem: string; total_vesting_shares: string }>("condenser_api.get_dynamic_global_properties", []);
      const tvf = parseFloat(String(dgp.total_vesting_fund_steem).split(" ")[0]);
      const tvs = parseFloat(String(dgp.total_vesting_shares).split(" ")[0]);
      if (tvf > 0 && tvs > 0) steemPerVest = tvf / tvs;
    } catch (_) { /* honest null */ }
    const oraclePrices = await fetchOraclePrices(); // BTC/ETH/XRP/DOGE — ליחס-הגיבוי של הסינתטיים

    // ── 4. shape response
    const batDelegation = delegations.get(BATTERY) || null; // האצלה-מצטברת אל-הסוללה
    for (const s of syms.values()) {
      // גיבוי-אמת: נעילות-עצמיות שנמדדו ב-replay — אחרת סכום-refs ייחודיים;
      // Task 66 — unlocked מופחת מהשימור הסופי (שחרור-קולטרל מוכח)
      const refClaimSum = r6([...s.refClaims.values()].reduce((a, b) => a + b, 0));
      const netClaims = r6(Math.max(0, refClaimSum - s.unlocked));
      const lockedSbdFinal = s.symbol === "WSBD" ? (s.backing.lockedSbd > 0 ? Math.max(0, r6(s.backing.lockedSbd - s.unlocked)) : netClaims) : 0;
      const lockedHiveFinal = s.symbol === "PHIVE" ? (s.backing.lockedHive > 0 ? Math.max(0, r6(s.backing.lockedHive - s.unlocked)) : netClaims) : 0;
      // Task 64 — ENERGY: הגיבוי שנמדד-מהשרשרת (delegation op) קודם להצהרה
      const measuredSp = batDelegation && steemPerVest ? r6(batDelegation.vests * steemPerVest) : 0;
      const lockedSpFinal = s.symbol === "ENERGY" ? (measuredSp > 0 ? measuredSp : (s.backing.lockedSp > 0 ? s.backing.lockedSp : refClaimSum)) : 0;
      if (s.symbol === "ENERGY" && measuredSp > 0) s.backing.mode = "delegation-verified";
      const lockedSteemFinal = SYNTH_COINS.has(s.symbol) ? (s.backing.lockedSteem > 0 ? s.backing.lockedSteem : refClaimSum) : 0;
      const orders = [...s.orders.values()];
      const asks = orders.filter((o) => o.side === "sell" && o.status === "open").sort((a, b) => a.price - b.price);
      const bids = orders.filter((o) => o.side === "buy" && o.status === "open").sort((a, b) => b.price - a.price);
      let backingRatioPct: number | null = null;
      if (s.supply > 0) {
        if (s.symbol === "WSBD") backingRatioPct = Math.round((lockedSbdFinal / s.supply) * 1000) / 10;
        else if (s.symbol === "PHIVE") backingRatioPct = Math.round((lockedHiveFinal / s.supply) * 1000) / 10;
        else if (s.symbol === "ENERGY") backingRatioPct = Math.round((lockedSpFinal / s.supply) * 1000) / 10;
        else {
          // סינתטיים: יחס-ערך — קולטרל-נעול × steemUsd מול היצע × שער-אורקל-חי
          const coin = PEGS[s.symbol];
          const price = oraclePrices ? oraclePrices[coin] : null;
          if (price && feedSbdPerSteem) {
            backingRatioPct = Math.round(((lockedSteemFinal * feedSbdPerSteem) / (s.supply * price)) * 1000) / 10;
          }
        }
      }
      const coinPrice = SYNTH_COINS.has(s.symbol) && oraclePrices ? oraclePrices[PEGS[s.symbol]] : null;
      const fairSteem = s.symbol === "WSBD"
        ? (feedSbdPerSteem ? r6(1 / feedSbdPerSteem) : null)
        : s.symbol === "PHIVE"
          ? null // cross fair lives on the daemon (dual feeds) — replay keeps declared
          : s.symbol === "ENERGY"
            ? 1.0 // 1 SP = 1 STEEM נדיר-בר — SP הוא מדוד-ב-STEEM מלכתחילה
            : coinPrice && feedSbdPerSteem
              ? r6(coinPrice / feedSbdPerSteem)
              : null;
      base.assets.push({
        symbol: s.symbol,
        peg: s.peg,
        supply: s.supply,
        backing: { mode: s.backing.mode, lockedSbd: lockedSbdFinal, lockedHive: lockedHiveFinal, lockedSp: lockedSpFinal, lockedSteem: lockedSteemFinal, chain: s.backing.chain, refs: s.backing.refs.slice(-4) },
        backingRatioPct,
        fairSteem,
        book: { asks, bids },
        pools: [...s.pools.values()],
        mints: s.minted,
        burns: s.burned,
        redeemed: s.redeemed,
        unlocked: s.unlocked,
        holders: [...s.holders.entries()]
          .filter(([, bal]) => bal > 1e-9)
          .map(([account, balance]) => ({ account, balance }))
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 10),
      });
    }
    base.fees = { totalCaptured: feeTotal, lp: feeLp, treasury: feeTreasury };
    base.measured = { feedSbdPerSteem, steemSbdBalance: sbdBalance, actions: base.actions.length, lastActionAt };
    base.actions = base.actions.slice(-24);
    base.ok = true;
    return base;
  } catch (e) {
    base.error = String((e as Error).message || e).slice(0, 160);
    return base;
  }
}

/** daemon state mirror — live ops counters from wrapped_state.json (non-secret) */
export function readWrappedDaemonState(): Record<string, unknown> | null {
  try {
    const p = path.join(process.cwd(), "agent", "wrapped_state.json");
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch (_) {
    return null;
  }
}
