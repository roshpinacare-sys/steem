"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 117c — use-theswap: THE-SWAP-ONNET live feed (polling, error-is-state).
 * הבורסה-שלנו על הרשת-שלנו: בריכות-AMM אפס-עמלה · עדות-גיבוי-חיה · סוואפים-אמת.
 * Same doctrine as use-vault / use-swap.
 */
export type OnnetPool = {
  pair: string;
  symA: string;
  symB: string;
  reserveA: number;
  reserveB: number;
  feeBps: number;
  priceBperA: number | null;
  depthUsd: number | null;
};

export type OnnetQuote = {
  ok: boolean;
  err?: string;
  side?: string;
  feeBps?: number;
  inUnits?: number;
  outUnits?: number;
  priceBefore?: number;
  priceAfter?: number | null;
  impactPct?: number | null;
  cap?: number;
  capOk?: boolean;
};

export type OnnetSwap = {
  at: string;
  taker: string;
  pair: string;
  side: string;
  inHuman: number;
  inSym: string;
  outHuman: number;
  outSym: string;
  feeBps: number;
  quoteImpactPct: number | null;
};

export type OnnetDoor = {
  family: string;
  address: string;
  role: string | null;
  agent: string | null;
  trx: number | null;
  honest: string;
};

export type TheSwapData = {
  ok: boolean;
  at: string;
  height: number | null;
  swapsTotal: number | null;
  pools: OnnetPool[];
  scales: Record<string, number>;
  quote: OnnetQuote | null;
  attest: {
    at: string;
    protocol: string;
    prices: Record<string, number>;
    legacyTrx: number;
    v2Trx: number;
    totalTrx: number;
    totalUsd: number | null;
    doors: OnnetDoor[];
    backing: { ratio: number | null; note: string };
    bookSupplyTrx: number;
  } | null;
  house: { WTRX: number; WSTEEM: number; saos: number; steem: number } | null;
  wtrxBook: { supply: number; refs: number } | null;
  seeded: { at: string; pair: string; aU: number; bU: number; feeBps: number }[];
  swaps: OnnetSwap[];
  lastAttest: string | null;
};

export type ActResult = { ok: boolean; out?: string; err?: string; quote?: OnnetQuote };

export function useTheswap(intervalMs = 45000) {
  const [data, setData] = useState<TheSwapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNow = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/theswap", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as TheSwapData;
      setData(json);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNow();
    timer.current = setInterval(fetchNow, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [fetchNow, intervalMs]);

  /* פעולות-מוגנות: attest (עדות-דלתות-חיה) · swap (ביצוע-סוואפ-אמת) */
  const act = useCallback(
    async (body: { action: "attest" | "swap"; pair?: string; side?: string; in?: string | number; taker?: string }): Promise<ActResult> => {
      try {
        const res = await fetch("/api/ops/theswap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as ActResult;
        if (body.action === "swap" || body.action === "attest") void fetchNow();
        return json;
      } catch (e) {
        return { ok: false, err: String((e as Error).message || e) };
      }
    },
    [fetchNow]
  );

  return { data, error, loading, refresh: fetchNow, act };
}
