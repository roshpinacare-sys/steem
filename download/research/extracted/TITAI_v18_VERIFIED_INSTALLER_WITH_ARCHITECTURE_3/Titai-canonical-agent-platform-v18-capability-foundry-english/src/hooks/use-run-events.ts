"use client";

import * as React from "react";
import { useRunStreamStore } from "@/stores/run-stream";
import {
  TERMINAL_EVENT_TYPES,
  type ClientRunEvent,
} from "@/lib/engine/event-types";

/**
 * Subscribes to a run's SSE stream. Seeds from server-provided initial events,
 * reconnects with ?after=<lastId> so no event is missed, and stops once the
 * run reaches a terminal event.
 */
export function useRunEvents(
  runId: string,
  initialEvents: ClientRunEvent[] = [],
  live = true,
) {
  const events = useRunStreamStore((s) => s.events[runId]) ?? initialEvents;
  const connected = useRunStreamStore((s) => s.connected[runId] ?? false);
  const seed = useRunStreamStore((s) => s.seed);
  const append = useRunStreamStore((s) => s.append);
  const setConnected = useRunStreamStore((s) => s.setConnected);

  const seededRef = React.useRef(false);
  if (!seededRef.current) {
    seed(runId, initialEvents);
    seededRef.current = true;
  }

  React.useEffect(() => {
    if (!live) return;
    // Don't reconnect if we already have a terminal event.
    const current = useRunStreamStore.getState().events[runId] ?? [];
    if (current.some((e) => TERMINAL_EVENT_TYPES.includes(e.type))) {
      return;
    }

    let source: EventSource | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const lastId = useRunStreamStore.getState().lastId(runId);
      source = new EventSource(`/api/runs/${runId}/events?after=${lastId}`);
      setConnected(runId, true);

      const handle = (ev: MessageEvent) => {
        try {
          const parsed = JSON.parse(ev.data) as ClientRunEvent;
          if (typeof parsed.id === "number") append(runId, parsed);
          if (TERMINAL_EVENT_TYPES.includes(parsed.type)) {
            stopped = true;
            source?.close();
            setConnected(runId, false);
          }
        } catch {
          /* ignore malformed frame */
        }
      };

      // Named events (event: <type>) plus the default message channel.
      source.onmessage = handle;
      for (const type of ALL_EVENT_NAMES) {
        source.addEventListener(type, handle as EventListener);
      }
      source.addEventListener("end", () => {
        stopped = true;
        source?.close();
        setConnected(runId, false);
      });
      source.onerror = () => {
        setConnected(runId, false);
        source?.close();
        if (!stopped) setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      stopped = true;
      source?.close();
      setConnected(runId, false);
    };
  }, [runId, live, append, setConnected]);

  return { events, connected };
}

const ALL_EVENT_NAMES = [
  "run.started",
  "plan.created",
  "step.started",
  "assistant.delta",
  "assistant.message",
  "tool.call",
  "tool.result",
  "approval.requested",
  "approval.resolved",
  "step.completed",
  "step.failed",
  "artifact.created",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.interrupted",
];
