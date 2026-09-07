"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 117 — use-swap: THE-SWAP live feed (polling, error-is-state).
 * Same doctrine as use-vault / use-roshpina.
 */
export type SwapLockedDoor = {
  address: string;
  role: string;
  trx: number;
  status: string;
};

export type SwapData = {
  ok: boolean;
  at: string;
  fresh: boolean;
  verdict: string | null;
  surveyedAt: string | null;
  prices: { trx: number | null; eth: number | null; sol: number | null };
  inventory: { controlledTrx: number | null; controlledUsd: number | null; doors: number; allZero: boolean };
  locked: { trx: number | null; usd: number | null; doors: SwapLockedDoor[] };
  mandate: { present: boolean; active: boolean; quote: string | null } | null;
  providerKey: { present: boolean; slot: string } | null;
  provider: {
    changenow: {
      reach: string;
      keylessSurvey: boolean;
      keylessCreate: boolean;
      createAuth: string;
      minAmounts: Record<string, { minAmount?: number }>;
      estimates: Record<string, { est?: number; speed?: string }>;
    };
    exolix: string;
    sideshift: string;
  } | null;
  legs: unknown[];
};

export function useSwap(intervalMs = 60000) {
  const [data, setData] = useState<SwapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNow = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/swap", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SwapData;
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

  return { data, error, loading, refresh: fetchNow };
}
