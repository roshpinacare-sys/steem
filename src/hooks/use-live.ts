"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 117n — use-live · סקר-גנרי-חי (backoff-כנה)
 * hook-אחד-לכל-הכלים: book · audit · logs · doors · inventory
 */

export function useLive<T>(url: string, ms = 6000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dead = useRef(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const tick = useCallback(async () => {
    if (pausedRef.current) {
      timer.current = setTimeout(tick, ms);
      return;
    }
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as T;
      if (!dead.current) {
        setData(j);
        setError(null);
      }
    } catch (e) {
      if (!dead.current) setError(e instanceof Error ? e.message : "fail");
    } finally {
      if (!dead.current) {
        setLoading(false);
        timer.current = setTimeout(tick, ms);
      }
    }
  }, [url, ms]);

  useEffect(() => {
    dead.current = false;
    tick();
    return () => {
      dead.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tick]);

  return { data, error, loading, paused, setPaused };
}
