/**
 * TelemetryContext — single shared poller for all telemetry data.
 *
 * Previously every component that imported useTelemetry() created its own
 * polling interval, resulting in N simultaneous fetch loops hitting the same
 * proxy endpoint (NeuralCore + CodeStream + FailureRecoveryPanel + App each
 * had an independent 3-second timer). This context provides ONE interval at
 * the root and distributes the data via React context, reducing network load
 * by ~75 %.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TelemetryEvent, UseTelemetry } from "../types/telemetry.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import { getSessionToken } from "../utils/session.js";
import { getProxyUrl } from "../utils/proxy-config.js";

/** null = the proxy was unreachable (distinct from "reachable, no events"). */
async function fetchEventsHttp(limit: number): Promise<TelemetryEvent[] | null> {
  // Resolved per poll, not at module load: the mobile Settings screen can
  // set a device-local proxy URL at runtime and polling picks it up on the
  // next tick without a reload.
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return null;
  try {
    const token = await getSessionToken(proxyUrl);
    const r = await fetchWithTimeout(
      `${proxyUrl}/telemetry?limit=${limit}`,
      { headers: { "X-Qodo-Session": token } },
      30_000,
    );
    if (!r.ok) return null;
    return (await r.json()) as TelemetryEvent[];
  } catch {
    return null;
  }
}

export type TelemetryFetcher = (limit: number) => Promise<TelemetryEvent[] | null>;

// Pluggable source: the mobile entry registers a sandbox-aware fetcher at
// import time; the desktop cockpit never touches this and keeps the HTTP
// path. Resolved per poll so mode flips (sandbox ↔ live) apply instantly.
let fetcher: TelemetryFetcher = fetchEventsHttp;

export function setTelemetryFetcher(fn: TelemetryFetcher): void {
  fetcher = fn;
}

/** The default HTTP source — exported so custom fetchers can fall back to it. */
export const httpTelemetryFetcher: TelemetryFetcher = fetchEventsHttp;

function fetchEvents(limit: number): Promise<TelemetryEvent[] | null> {
  return fetcher(limit);
}

function pickLatest(events: TelemetryEvent[]): TelemetryEvent | null {
  if (!events.length) return null;
  return events.reduce((a, b) =>
    new Date(a.timestamp) > new Date(b.timestamp) ? a : b,
  );
}

// ── Context ───────────────────────────────────────────────────────────────

const TelemetryCtx = createContext<UseTelemetry>({
  events: [],
  tiering: [],
  recentRuns: [],
  currentRunId: null,
  currentPhase: null,
  loading: false,
  error: null,
  lastSyncAt: null,
  refresh: async () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────

interface TelemetryProviderProps {
  children: React.ReactNode;
  /** Poll interval in milliseconds (default 3000). */
  pollMs?: number;
}

export function TelemetryProvider({
  children,
  pollMs = 3000,
}: TelemetryProviderProps): React.ReactElement {
  const [events,     setEvents]     = useState<TelemetryEvent[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const mounted = useRef(true);

  // Derive tiering and recentRuns without extra fetches.
  const tiering = useMemo(
    () => events.filter(
      (e) => e.decision === "tiering_decision" || e.phase === "ai-call",
    ),
    [events],
  );

  const recentRuns = useMemo(() => {
    const ids = new Set<string>();
    for (const e of events) ids.add(e.runId);
    return Array.from(ids);
  }, [events]);

  const latest      = useMemo(() => pickLatest(events), [events]);
  const currentRunId  = latest?.runId  ?? null;
  const currentPhase  = latest?.phase  ?? null;

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    setLoading(true);
    setError(null);
    try {
      const all = await fetchEvents(200);
      if (!mounted.current) return;
      if (all === null) {
        setError("telemetry proxy unreachable");
      } else {
        setEvents(all);
        setLastSyncAt(Date.now());
      }
    } catch (e: unknown) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : "telemetry fetch failed");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    // A 1s ticker fires refresh() when the *effective* interval has elapsed.
    // The device-local override (mobile Settings → Data) applies on the next
    // tick without remounting the provider; desktop has no override and
    // behaves exactly as before.
    let lastRun = Date.now();
    const effectivePollMs = () => {
      try {
        const v = Number(window.localStorage.getItem("qodo:poll-ms"));
        if (Number.isFinite(v) && v >= 1000) return v;
      } catch {
        /* fall through */
      }
      return pollMs;
    };
    const id = setInterval(() => {
      if (Date.now() - lastRun >= effectivePollMs()) {
        lastRun = Date.now();
        refresh();
      }
    }, 1000);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [pollMs, refresh]);

  const value = useMemo<UseTelemetry>(
    () => ({
      events,
      tiering,
      recentRuns,
      currentRunId,
      currentPhase,
      loading,
      error,
      lastSyncAt,
      refresh,
    }),
    [events, tiering, recentRuns, currentRunId, currentPhase, loading, error, lastSyncAt, refresh],
  );

  return (
    <TelemetryCtx.Provider value={value}>{children}</TelemetryCtx.Provider>
  );
}

// ── Consumer hook ─────────────────────────────────────────────────────────

/**
 * useTelemetry — reads from the shared TelemetryContext.
 * This is a zero-cost subscription; no extra fetch or timer is created.
 */
export function useTelemetryCtx(): UseTelemetry {
  return useContext(TelemetryCtx);
}
