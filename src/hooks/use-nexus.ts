"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** 117m — THE-NEXUS hook · סקר-חי-כל-5-שניות (backoff-כנה-בכשל) */

export type NexusData = {
  ok: boolean;
  at: string;
  meta: { issuer: string; supply: number; saosHeight: number; lastHeartbeat: string; lastTime: string };
  root: { height: number; promotedAt: string };
  tron: { height: number; alive: boolean };
  broker: { alive: boolean; doors: number; addresses: string[] };
  registryDoors: number;
  fleet: { at: string | null; services: Array<{ name: string; ok: boolean }> };
  relay: { sent: number; issued: number; open: number; openList: Array<{ ref: string; via: string; act: string; status: string; txid: string | null; chain: string }> };
  wrapped: Array<{ sym: string; locked: number; supply: number; redeemed: number; unlocked: number; refs: number }>;
  pools: {
    poolW: { saos: number; wtrx: number; lp: number; feeBps: number };
    poolsX: Array<{ pair: string; a: number; b: number; lp: number; feeBps: number; symA: string; symB: string }>;
  };
  fees: { total?: number; toLp?: number; toTreasury?: number };
  deposits: {
    tick: number;
    lastTickAt: string;
    minted: number;
    eventsCount: number;
    events: Array<Record<string, unknown>>;
    rpcHealth: Array<{ chain: string; ok: boolean; at: string }>;
    chainsOk: number;
    chainsTotal: number;
  };
  grid: { at: string; ticks: number; rounds: number; tradesToday: number; txsToday: number; treasuryPnlµ: number; treasuryPnlTodayµ: number; leaderboard: Array<{ name: string; pnlµ: number }> };
  harvest: { feesTotalµ: number; releases: number; railCredited: number; gridFeeµ: number };
  shield: { stats: { checks?: number; blocks?: number; warns?: number }; deny: string[]; allow: string[]; velocity: number };
  book: { head: number };
  relayOps: { failsCount: number; degraded: boolean; lastPick: { address?: string; bal?: number; family?: string } };
};

export function useNexus(ms = 5000) {
  const [data, setData] = useState<NexusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dead = useRef(false);

  const tick = useCallback(async () => {
    try {
      const r = await fetch("/api/nexus", { cache: "no-store" });
      if (!r.ok) throw new Error("nexus " + r.status);
      const j = (await r.json()) as NexusData;
      if (!dead.current) {
        setData(j);
        setError(null);
      }
    } catch (e) {
      if (!dead.current) setError(e instanceof Error ? e.message : "nexus-fail");
    } finally {
      if (!dead.current) {
        setLoading(false);
        timer.current = setTimeout(tick, ms);
      }
    }
  }, [ms]);

  useEffect(() => {
    dead.current = false;
    tick();
    return () => {
      dead.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tick]);

  return { data, error, loading };
}
