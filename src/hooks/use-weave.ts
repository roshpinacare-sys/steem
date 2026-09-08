"use client";

/**
 * use-weave — חיבור-חי לרשת-האמת.
 * polling עדין: כל-מקור-נתונים בקצב-משלו, הכל-סלחני (מצב-לא-זמין הוא מצב).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface WeaveStatus {
  ok: boolean;
  state?: string;
  why?: string;
  chain?: {
    height: number;
    blocksKept: number;
    truncated: boolean;
    finalRoot: string | null;
    nodeStateRoot: string | null;
    integrity: boolean | null;
    checkpoints: { checked: number; matched: number; firstBadHeight: number | null };
    historicalCps?: { checked: number; matched: number; firstBadHeight: number | null };
    anchor?: {
      height: number | null;
      hashMatched: boolean;
      rootLocked?: boolean | null;
      cpsAbove: { checked: number; matched: number };
      finalRootMatched: boolean;
      finalRoot: string | null;
      why: string | null;
    } | null;
    replayRejected: number;
    lastBlockTime?: string | null;
  };
  weave?: {
    liveStamps: number;
    cap: number;
    pressureSealAt: number;
    totalStamps: number;
    nextSeq: number;
    lastSeal: { seq: number; root: string; count: number; at: string } | null;
    seals: { seq: number; root: string; count: number; from: number; to: number; at: string }[];
    totalSeals: number;
    totalWitness: number;
    witnessTopics: { key: string; topic: string; claimHash: string | null; validators: string[]; quorum: number }[];
  };
  pendingSealRequest?: { root: string; count: number; at?: string } | null;
  batcher?: { at: string; mode: string; notes: string[]; anchored: Record<string, unknown> } | null;
  anchorsRegistry?: { seals: number; detail: Record<string, AnchorRecord> } | null;
  nodeWeave?: { seals?: { seq: number; root: string; height?: number }[] } | null;
}

export interface AnchorRecord {
  seq?: number;
  at?: string;
  dry?: boolean;
  txids?: { steem?: string | null; hive?: string | null; blurt?: string | null };
  tron?: { status: string; note?: string };
}

export interface BlockRow {
  height: number;
  time: string | null;
  hash: string | null;
  prevHash: string | null;
  gasUsed: number;
  txCount: number;
  ops: Record<string, number>;
  firstNote: string | null;
  isCheckpoint?: boolean;
}

export interface BlockFull {
  height: number;
  time: string | null;
  hash: string;
  prevHash: string;
  gasUsed: number;
  txs: Record<string, unknown>[];
  results: { ok: boolean; err: string | null; gas: number; type: string }[];
}

export interface StampRow {
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

export interface Certificate {
  h: string;
  status: "sealed" | "pending-seal" | "unknown";
  seq: number | null;
  kind?: string;
  by?: string;
  at?: string | null;
  stampBlock?: number;
  seal?: { seq: number; root: string; count: number; from: number; to: number; height: number | null; at: string | null } | null;
  proof?: {
    ok: boolean;
    pathLen?: number;
    why?: string;
    leafEntry?: { h: string; seq: number; kind: string; by: string; at: string | null; salt: string | null };
    leaf?: string;
    path?: { pos: "L" | "R"; h: string }[];
    root?: string;
  };
  checkpoint?: { height: number; stateRoot: string | null; note: string } | null;
  anchors?: { registry: AnchorRecord; tronNote: string } | null;
}

export interface VerifyPack {
  ok: boolean;
  at: string;
  checks: { id: number; name: string; ok: boolean; detail: string }[];
  summary: { total: number; passed: number; failed: number };
  verdict?: string;
}

export interface TxRow {
  height: number;
  idx: number;
  time: string | null;
  type: string;
  ok: boolean;
  err: string | null;
  gas: number;
  tx: Record<string, unknown>;
}

export interface BookPage {
  ok: boolean;
  tip: number | null;
  totalBlocks: number;
  filtered: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  blocks: BlockRow[];
}

export interface TxPage {
  ok: boolean;
  total: number;
  filtered: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  txs: TxRow[];
}

export interface StatsData {
  ok: boolean;
  height: number;
  totalBlocks: number;
  txTotal: number;
  byType: Record<string, number>;
  stamps24h: number;
  gasTotal: number;
  gasPerBlock: { height: number; gas: number }[];
  opsPerHour: { hour: string; n: number }[];
  sealCadenceMin: number | null;
  checkpointEvery: number;
  checkpoints: { checked: number; matched: number; firstBadHeight: number | null } | null;
  totals: { stamps: number; liveStamps: number; seals: number; witnesses: number };
}

export interface CheckpointRow {
  height: number;
  matched: boolean;
  stateRoot: string | null;
  at: string | null;
}

export interface CheckpointsData {
  ok: boolean;
  why?: string;
  checkpointEvery: number;
  height: number;
  summary: { checked: number; matched: number; firstBadHeight: number | null } | null;
  checkpoints: CheckpointRow[];
}

export interface SearchResultItem {
  kind: "stamp" | "block" | "seal";
  stamp?: StampRow;
  height?: number;
  time?: string | null;
  seal?: { seq: number; root: string; count: number; from: number; to: number; at: string };
}

function usePolling<T>(url: string, intervalMs: number, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return; // נימוס-רשת: לא שואלים כשהלשונית מאחור
    try {
      const res = await fetch(url, { cache: "no-store" });
      const j = (await res.json()) as T;
      if (alive.current) {
        setData(j);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(String((e as Error)?.message ?? e).slice(0, 120));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return () => { alive.current = false; };
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [refresh, intervalMs, enabled]);

  return { data, error, loading, refresh };
}

export const useWeaveStatus = () => usePolling<WeaveStatus>("/api/weave/status", 20000);
export const useBlocks = (limit = 24) => usePolling<{ ok: boolean; tip: number | null; totalBlocks?: number; filtered?: number; hasMore?: boolean; offset?: number; limit?: number; blocks: BlockRow[] }>(`/api/weave/blocks?limit=${limit}`, 10000);
export const useStamps = () => usePolling<{ ok: boolean; total: number; live: number; stamps: StampRow[] }>("/api/weave/stamp", 12000);
export const useVerifyPack = () => usePolling<VerifyPack>("/api/weave/verify-pack", 20000);
export const useWitnesses = () => usePolling<{ ok: boolean; total: number; topics: { topic: string; claimHash: string | null; validators: string[]; quorum: number }[] }>("/api/weave/witness", 15000);
export const useStats = () => usePolling<StatsData>("/api/weave/stats", 30000);
export const useTxPage = (url: string, intervalMs = 12000, enabled = true) => usePolling<TxPage>(url, intervalMs, enabled);
export const useBookPage = (url: string, intervalMs = 10000, enabled = true) => usePolling<BookPage>(url, intervalMs, enabled);

export async function fetchSearch(q: string): Promise<SearchResultItem[]> {
  try {
    const res = await fetch(`/api/weave/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
    const j = await res.json();
    return j?.ok ? (j.results as SearchResultItem[]) : [];
  } catch {
    return [];
  }
}

export async function fetchCheckpoints(): Promise<CheckpointsData | null> {
  try {
    const res = await fetch("/api/weave/checkpoints", { cache: "no-store" });
    const j = (await res.json()) as CheckpointsData;
    return j?.ok ? j : j;
  } catch {
    return null;
  }
}

export async function fetchBlock(height: number): Promise<BlockFull | null> {
  try {
    const res = await fetch(`/api/weave/blocks?height=${height}`, { cache: "no-store" });
    const j = await res.json();
    return j?.ok ? (j.block as BlockFull) : null;
  } catch {
    return null;
  }
}

export async function fetchCertificate(h: string): Promise<{ certificate: Certificate; verifier?: string } | null> {
  try {
    const res = await fetch(`/api/weave/proof?h=${h}`, { cache: "no-store" });
    const j = await res.json();
    return j?.ok ? j : null;
  } catch {
    return null;
  }
}

/** זמן יחסי בעברית */
export function timeAgoHe(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "לפני " + s + " שנ׳";
  const m = Math.floor(s / 60);
  if (m < 60) return "לפני " + m + " דק׳";
  const h = Math.floor(m / 60);
  if (h < 24) return "לפני " + h + " שע׳";
  const d = Math.floor(h / 24);
  return "לפני " + d + " ימ׳";
}

/** קיצור-hash: ראש-זנב */
export function shortHash(h: string | null | undefined, head = 10, tail = 8): string {
  if (!h) return "—";
  if (h.length <= head + tail + 1) return h;
  return h.slice(0, head) + "…" + h.slice(-tail);
}

/** ספירה-לאחור לאצווה השעתית הבאה (שעון-האריגה) */
export function useNextHourCountdown() {
  const [left, setLeft] = useState<{ m: number; s: number }>({ m: 0, s: 0 });
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = new Date(now);
      next.setMinutes(60, 0, 0);
      const diff = Math.max(0, next.getTime() - now.getTime());
      setLeft({ m: Math.floor(diff / 60000), s: Math.floor((diff % 60000) / 1000) });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return left;
}
export interface SaosEconomy {
  node?: {
    height?: number;
    updatedAt?: string | null;
    beats?: number;
    sov?: { supply?: number; lockedSaos?: number } | null;
    assetMeta?: Record<string, { chain: string; contract: string; decimals: number; ref: string; note: string }> | null;
    assetPrices?: Record<string, { px: number; unit: string; src: string; ref: string; at: string | null }> | null;
    wrapped?: Record<string, { supply: number; locked: number; holders: number }> | null;
    /* 97 — GRID-PROFIT: יומן-רווח-חי + בריכת-הגשר + מחזיקי-WTRX + יתרות-צף */
    grid97?: {
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
      treasuryWtrx: number;
      treasurySaos: number;
      wtrxCover?: number;
      poolW: { saos: number; wtrx: number; lp: number; feeBps: number } | null;
      pool: { saos: number; steem: number; feeBps: number };
      height: number;
      at: string;
    } | null;
    wrappedHolders?: Record<string, number> | null;
    floatBalances?: Record<string, { saos: number; steem: number }> | null;
    /* 98 — GRID-98 ARENA: מנוע-הזרימה-הגבוהה (מדדים-חיים מהספר-הריבוני) */
    grid98?: {
      height?: number;
      dutyPct?: number;
      tradesToday?: number;
      tradesTotal?: number;
      ratePerMin?: number;
      extrapolatedDay?: number;
      treasuryPnlSAOS?: number;
      treasuryPnlTodaySAOS?: number;
      sweeps?: number;
      bigSweeps?: number;
      topUpsµ?: number;
      floor?: number | null;
      steps?: { at: string; floor: number; backedByµ: number }[];
      leaderboard?: { name: string; pnlSAOS: number }[];
      pools?: Record<string, { a: number; b: number; px: number; lp: number } | null>;
      paused?: string | null;
      skippedForEdge?: number;
      feeIncomeµ?: number;
      feeIncomeSAOS?: number;
      bench?: { txs?: number; txsPerSec?: number; capabilityPerDay?: number; at?: string; note?: string } | null;
    } | null;
  } | null;
  econ96?: { allMatch?: boolean; steps?: { id: string; match: boolean }[] } | null;
  /* 99b — ריבונות: גשר-Tron · עוגנים-תלת-שרשרתיים חיים */
  tron?: {
    address?: string | null;
    relay?: string | null;
    height?: number | null;
    at?: string | null;
    pulse?: Record<string, unknown> | null;
    lastAnchor?: { cpHeight?: number; txid?: string; tronBlock?: number; notedHeight?: number } | null;
    squad?: { address?: string; balanceTrx?: number; activated?: boolean }[] | null;
  } | null;
  liveAnchors?: {
    anchorId?: { at?: string | null; evm?: string | null; txids?: Record<string, string | null> } | null;
    weaveSeal?: { at?: string | null; txids?: Record<string, string | null> } | null;
    blurt99?: {
      at?: string | null;
      ok?: boolean | null;
      anchor?: { txid?: string | null; at?: string | null } | null;
      post?: { txid?: string | null; at?: string | null } | null;
      vote?: { txid?: string | null; at?: string | null } | null;
      reconcile?: { supplyBefore?: number; liveBal?: number; delta?: number } | null;
    } | null;
    revive?: { at?: string | null; ok?: boolean | null; broadcast?: { txid?: string | null; at?: string | null } | null } | null;
  } | null;
  /* 102 — אמת-שוק חיה: נגזרת-מהספר · סטיות-בריכות-מהאורקל · מדידות-חוץ · עדות-פיוס-יחידות */
  truth102?: {
    at?: string | null;
    market?: { bookMid?: number | null; ask?: number | null; bid?: number | null; steemUsd?: number | null; saosUsd?: number | null; at?: string | null } | null;
    poolsX?: Record<string, { symA: string; a: number; b: number; ratio: number; impliedUsd: number | null; oracleUsd: number | null; devPct: number | null; tvlUsd: number; skeleton: boolean; priceAt?: string | null }> | null;
    synthetic?: Record<string, { coin: string; collateral: string | null; lockRef: string | null; mintedTruth: number | null; chainSupply: number | null; dormant: boolean }> | null;
    measured?: ({ at?: string | null; oracle?: { at?: string | null; prices?: Record<string, number>; divergencePct?: number } | null } & Record<string, number | undefined | { at?: string | null } | null>) | null;
    unitRecon?: { at?: string | null; allMatch?: boolean; summaryHe?: string | null; retiredDormant?: boolean | null } | null;
    poolAnchor?: { at?: string | null; allMatch?: boolean; summaryHe?: string | null } | null;
  } | null;
  /* 103 — אמת-מנוע: פנקס-המנוע-החי ישירות-מהדיסק (לא-הייצוא-המסונכרן) · גיל-מוצהר */
  engine?: {
    at?: string | null;
    ageSec?: number | null;
    source?: string;
    height?: number | null;
    treasuryPnlSAOS?: number | null;
    treasuryPnlTodaySAOS?: number | null;
    feeIncomeSAOS?: number | null;
    topUpsSAOS?: number | null;
    tradesToday?: number | null;
    txsToday?: number | null;
    ratePerMin?: number | null;
    tradesTotal?: number | null;
    floor?: number | null;
    steps?: { at: string; floor: number; backedByµ: number }[];
    skippedForEdge?: number | null;
    rejected?: number | null;
    edgeLeak?: number | null;
    bench?: { txs?: number; txsPerSec?: number; capabilityPerDay?: number; at?: string; note?: string } | null;
    paused?: string | null;
    leaderboard?: { name: string; pnlSAOS: number }[];
  } | null;
  /* 103 — חדר-החיילים: קישוריות + RC-חי + רווח-דקס פר-חייל · הגדרות-מסודרות */
  fleet?: {
    at?: string | null;
    rcAt?: string | null;
    headRcPct?: number | null;
    headHp?: number | null;
    allLinked?: boolean | null;
    linkedHive?: number | null;
    soldiersTotal?: number | null;
    soldiers?: {
      username: string;
      steemLinked?: boolean | null;
      hiveLinked?: boolean | null;
      hiveRcPct?: number | null;
      hiveHp?: number | null;
      seqToday?: number;
      dexPnlSAOS?: number | null;
    }[];
    settings?: {
      rcFloorPct: number;
      rcHeavyPct: number;
      carryingCapacity: string;
      healGate: string;
      healLeverWeak?: boolean;
      healLastGate?: { at?: string; reason?: string; etaH?: number } | null;
      healAt?: string | null;
    } | null;
  } | null;
}
export const useSaosEconomy = () => usePolling<SaosEconomy>("/api/ops/saosnet", 20000);

/* ── 107 — נתיב-האמת: יישור-הקו-לרשת · הספר-השני-חי · המגבילים-החיים ── */
export interface TruthPathData {
  ok?: boolean;
  at?: string;
  net?: string;
  our?: {
    height?: number | null;
    genesisHash?: string | null;
    stateRoot?: string | null;
    bookTxTotal?: number | null;
    bookBlocks?: number | null;
    density?: number | null;
  } | null;
  second?: {
    ok?: boolean;
    via?: string;
    commit?: string | null;
    snapshotAgeSec?: number | null;
    height?: number | null;
    genesisHash?: string | null;
    netVersion?: string | null;
    updatedAt?: string | null;
    updatedAtAgeSec?: number | null;
    error?: string | null;
  } | null;
  verdict?: {
    sameGenesis?: boolean;
    sameNetVersion?: boolean;
    canonical?: "ours" | "theirs" | "unknown";
    heightRatio?: number | null;
    answer?: string;
    countsExplainer?: string;
  } | null;
  limits?: {
    key: string;
    what: string;
    evidence: string;
    solution: string;
    severity: "gold" | "rose" | "green";
  }[];
  rc?: { avgPct?: number; minPct?: number; belowFloor?: number; total?: number; at?: string } | null;
  blurt?: { scanned?: number; alive?: number; at?: string | null; ageSec?: number | null } | null;
  tron?: {
    pulseAt?: string | null;
    pulseAgeSec?: number | null;
    lastAnchor?: { cpHeight?: number | null; at?: string | null; txid?: string | null };
  } | null;
}
export const useTruthPath = () => usePolling<TruthPathData>("/api/ops/truthpath", 30000);

/** 108 — THE-DOOR (דבר-גורר-דבר): לוח-הדלתות-החי — חוזה-חינם-שלנו → רשת-מרוחקת → הוכחה-חזרה */
export type RelayDoor = {
  ref: string;
  via: "steem" | "tron" | "blurt" | string;
  act: string;
  status: "queued" | "sent" | string;
  txid: string | null;
  tries: number;
  chain: string | null;
  from: string | null;
  note: string | null;
  budgetSun: number | null;
  escrowµ: number | null;
  spentSun: number | null;
  gasPaidµ: number | null;
  refundµ: number | null;
  failCount: number;
  lastErr: string | null;
};
export type RelaySenderScan = {
  at: string | null;
  ageSec: number | null;
  reason: string | null;
  pick: { family: string; idx: number; address: string; bal: number; freeLeft: number } | null;
  doorsScanned: number;
  fundedDoors: number;
  withBandwidth: number;
};
export type RelayDoorsData = {
  ok: boolean;
  at: string;
  height: number | null;
  metaIssuer: string | null;
  issued: number;
  sent: number;
  queued: number;
  gasSettledSun: number;
  nextSeqBy: Record<string, number>;
  relayerAlive: boolean;
  doorLogAgeSec: number | null;
  doors: RelayDoor[];
  senderScan: RelaySenderScan | null;
  remoteProof: {
    steem: { txid: string; ref: string; verify: string } | null;
    tron: { txid: string; ref: string; verify: string } | null;
  };
  explainer: string;
  error?: string;
};
export const useRelayDoors = () => usePolling<RelayDoorsData>("/api/ops/relay", 30000);

/* 110 — THE-DEX (דקס-המפלצת): כיסוי-חי · בריכת-WTRX/SAOS · התיישבות-טרון · אימות-אח */
export type DexDoor = {
  ref: string;
  status: string;
  txid: string | null;
  amountSun: number | null;
  toIdx: number | null;
  note: string | null;
  verifyUrl: string | null;
};
export type SiblingRec = {
  txid: string;
  kind: string;
  verdict: string;
  contract: string | null;
  step: number | null;
  note: string | null;
  at: string | null;
};
export type TronDexData = {
  ok: boolean;
  at: string;
  height: number | null;
  pair: string;
  coverage: {
    supplyMu: number;
    lockedMu: number;
    liveMu: number;
    supplyTrx: number;
    lockedTrx: number;
    liveTrx: number;
    perfect: boolean;
    status: string;
  } | null;
  vault: {
    sun: number;
    tronBlock: number | null;
    at: string | null;
    ageSec: number | null;
    per: { idx: number; addr: string; trx: number }[];
  } | null;
  pool: { aMu: number; bMu: number; aTrx: number; bSaos: number; mid: number | null; lpSupply: number; feeBps: number } | null;
  swapsX: number;
  issuer: { saos: number; wtrx: number };
  nativeBookLastPrice: number | null;
  settlement: { doors: DexDoor[]; sent: number; queued: number };
  relayerAlive: boolean;
  siblings: { total: number; verified: number; peer: string; recs: SiblingRec[] };
  energyWall: { measured: string; freeRails: string; paths: string[] };
  error?: string;
};
export const useTronDex = () => usePolling<TronDexData>("/api/ops/trondex", 30000);

/* ── 111 — THE-HARVEST (קציר-האנרגיה) ── */
export type HarvestStream = { stream: string; he: string; amountµ: number };
export type HarvestRelease = { to: string; amountµ: number; purpose: string; purposeHe: string; ref: string | null; h: number };
export type HarvestFeeDoor = { ref: string; via: string; status: string; txid: string | null; escrowµ: number; feeBps: number; harvestFeeµ: number; refundµ: number | null };
export type HarvestData = {
  ok: boolean;
  at: string;
  height: number | null;
  potµ: number;
  harvestedTotalµ: number;
  inconsistent?: boolean;
  releasedµ: number;
  count: number;
  byStream: HarvestStream[];
  releases: HarvestRelease[];
  feeDoors: HarvestFeeDoor[];
  policy: { railTag: string; railSteemPerSaos: number; releaseFloorµ: number; releaseSharePct: number };
  cursor: Record<string, unknown>;
  issuerBalanceµ: { saos: number; lockedSaos: number };
  energy: { energyFeeSun: number | null; energyFeeMaxSun: number | null; trc20CostTrx: number | null; trc20CostMaxTrx: number | null; vaultTrx: number | null; vaultAgeSec: number | null; why?: string };
  log: string[];
  relayerAlive: boolean;
  explainer: string;
  error?: string;
};
export const useHarvest = () => usePolling<HarvestData>("/api/ops/harvest", 30000);

/* ── 112 — DEX בקרת-איכות (מעקב-איכותי אחרי הדברים שנבין) ── */
export type DexQualityPair = {
  pair: string;
  symA: string;
  symB: string;
  aMu: number;
  bMu: number;
  mid: number | null;
  midText: string;
  tvlSaos: number;
  feeBps: number;
  minBuyInMu: number | null;
  activity: { swaps: number; lastH: number | null; ageBlocks: number | null; lastSide: string | null; windowLines: number };
  badge: string;
  backing: { sym: string; locked: number; supply: number; ratio: number | null; lockRef: string | null; verifyUrl: string | null };
};
export type DexQualityData = {
  ok: boolean;
  at: string;
  height: number;
  pairsCount: number;
  pairs: DexQualityPair[];
  cross: {
    saosPerSteemViaWSTEEM: number;
    saosPerSteemViaWTRX: number | null;
    steemPerTrxMarket: number | null;
    gapPct: number | null;
    siblingW25: { steemPerSaos: number; note: string };
  } | null;
  insights: { at: string; kind: string; text: string; ref?: string; url?: string }[];
  factsNote: string | null;
  error?: string;
};
export const useDexQuality = () => usePolling<DexQualityData>("/api/ops/dexquality", 30000);

/* 113 — THE-WALLETS (ארנקי-הצבא): זהות-כספית-רב-רשתית-מעוגנת לכל-סוכן */
export type WalletAgent = {
  agent: string;
  evm: string;
  tron: string;
  sol: string;
  btc: string;
  anchored: boolean;
  hostTxid: string | null;
  budget: { WSTEEM: number; WBLURT: number; ENERGY: number; saos: number };
  devnetSol: { funded: boolean; lamports: number; err: string | null };
  selfReg: boolean;
};
export type WalletsData = {
  ok: boolean;
  at: string;
  height: number | null;
  digest: string | null;
  anchor: { txid: string; by: string; at: string; verified: boolean; url: string } | null;
  networks: string[];
  totals: { agents: number; anchored: number; funded: number; devnetFunded: number; onBookTotal: number | null };
  agents: WalletAgent[];
  budgetLast: { at?: string; plan?: string[]; txs?: number } | null;
  airdropAt: string | null;
  error?: string;
};
export const useWallets = () => usePolling<WalletsData>("/api/ops/wallets", 30000);

/* 114 — THE-VAULT + THE-DEPOSITS: הכספת-המוצפנת ותיבת-ההפקדות החיה (נמל-הצבא) */
export type VaultChainHealth = { key: string; he: string; ok: boolean; via: string | null; err: string | null; note: string | null; at: string | null };
export type DepositEvent = { at: string; chain: string; agent: string; sym: string; human: number; unit: string; note?: string };
export type VaultData = {
  ok: boolean;
  at: string;
  vault: {
    sealed: boolean;
    verified: boolean;
    verifiedAt: string | null;
    envelopeDigest: string | null;
    sealedAt: string | null;
    anchoredTxid: string | null;
    anchoredDigest: string | null;
    checks: Record<string, unknown>;
    errors: string[];
    ceremony: string;
  };
  /* 117g — בריכות-האמת-החיות + יומן-הסוופים עליהן (הצומת-הוא-הסמכות · ה-API מציג-בלבד) */
  xnet: {
    swapsX: number | null;
    snapHeight: number | null;
    pools: { pair: string; humanA: number; humanB: number; feeBps: number; lpSupply: number; priceBperA: number | null }[];
    trades: {
      h: number; at: string; pair: string; side: string; taker: string | null;
      inSym: string; inHuman: number; outSym: string; out: number | null; outHuman: number | null;
      ok: boolean; ref: string | null;
    }[];
    treasury: { WETH: number | null; WSOL: number | null; WSTEEM: number | null };
  } | null;
  deposits: {
    watcherAlive: boolean;
    watcherAgeSec: number | null;
    tick: number | null;
    lastTickAt: string | null;
    addressesTracked: number;
    mintedTotal: number;
    poolsOpened: string[];
    chains: VaultChainHealth[];
    prices?: Record<string, number> | null;
    pending: { key: string; chain: string; agent: string; sym: string; human: number; raw?: string; firstTick?: number; ticks: number }[];
    events: DepositEvent[];
    preflight: {
      at: string | null;
      ready: boolean;
      mission: string | null;
      checksOk: number;
      checksTotal: number;
      checks: { name: string; ok: boolean; detail: string }[];
    } | null;
  };
  sendTo: {
    evm: string;
    tron: string;
    sol: string;
    btc: string;
    validity?: {
      evmChecksumOk: boolean;
      evmChecksummed: string;
      evmComputed: boolean;
      tronOk: boolean;
      tronComputed: boolean;
      solBytesOk: boolean;
      btcFormatOk: boolean;
    };
  } | null;
};
export const useVault = () => usePolling<VaultData>("/api/ops/vault", 30000);
