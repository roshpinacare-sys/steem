"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 116 — use-roshpina: THE-BRIDGE live feed (polling, error-is-state).
 * Same doctrine as use-vault / use-wallets.
 */
export type RoshpinaAnchor = {
  headHash: string;
  tenantId: string;
  height: number;
  hostTxid: string;
  onBook: string;
  at: string;
  consumedAt: string;
};

export type RoshpinaBridge = {
  queueLines: number;
  consumedTotal: number;
  quarantined: number;
  lastScan: string | null;
  daemonAlive: boolean;
  lastLog: string;
};

export type RoshpinaData = {
  ok: boolean;
  at: string;
  bridge: RoshpinaBridge;
  anchors: RoshpinaAnchor[];
};

export function useRoshpina(intervalMs = 30000) {
  const [data, setData] = useState<RoshpinaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNow = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/roshpina", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as RoshpinaData;
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
