import { create } from "zustand";
import type { ClientRunEvent } from "@/lib/engine/event-types";

interface RunStreamState {
  events: Record<string, ClientRunEvent[]>;
  connected: Record<string, boolean>;
  seed: (runId: string, events: ClientRunEvent[]) => void;
  append: (runId: string, event: ClientRunEvent) => void;
  setConnected: (runId: string, connected: boolean) => void;
  lastId: (runId: string) => number;
  clear: (runId: string) => void;
}

export const useRunStreamStore = create<RunStreamState>((set, get) => ({
  events: {},
  connected: {},
  seed: (runId, events) =>
    set((s) => ({ events: { ...s.events, [runId]: dedupe(events) } })),
  append: (runId, event) =>
    set((s) => {
      const existing = s.events[runId] ?? [];
      if (existing.some((e) => e.id === event.id)) return s;
      return {
        events: {
          ...s.events,
          [runId]: [...existing, event].sort((a, b) => a.id - b.id),
        },
      };
    }),
  setConnected: (runId, connected) =>
    set((s) => ({ connected: { ...s.connected, [runId]: connected } })),
  lastId: (runId) => {
    const list = get().events[runId] ?? [];
    return list.length ? list[list.length - 1].id : 0;
  },
  clear: (runId) =>
    set((s) => {
      const events = { ...s.events };
      delete events[runId];
      return { events };
    }),
}));

function dedupe(events: ClientRunEvent[]): ClientRunEvent[] {
  const seen = new Set<number>();
  return events
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => a.id - b.id);
}
