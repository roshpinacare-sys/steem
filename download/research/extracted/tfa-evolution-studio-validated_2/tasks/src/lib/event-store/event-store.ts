/**
 * TFA Evolution Studio v28 — Event Store
 *
 * Append-only event log for platform observability.
 * Supports project-scoped and global event streams.
 */

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getTracesDir, ensureDir } from "@/lib/paths";
import type { PlatformEvent } from "@/lib/types";

export type EventKind = string;
export type EventSeverity = "info" | "warn" | "error" | "critical";

function getEventsFile(projectId?: string): string {
  if (projectId) {
    return path.join(getTracesDir(), `${projectId}.ndjson`);
  }
  return path.join(getTracesDir(), "global.ndjson");
}

function loadEvents(projectId?: string): PlatformEvent[] {
  const filePath = getEventsFile(projectId);
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as PlatformEvent);
}

function appendEvent(event: PlatformEvent, projectId?: string): void {
  const filePath = getEventsFile(projectId);
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(event) + "\n");
}

export function recordEvent(
  type: string,
  payload: unknown,
  projectId?: string,
  runId?: string
): PlatformEvent {
  const event: PlatformEvent = {
    id: uuidv4(),
    projectId,
    runId,
    type,
    payload,
    timestamp: new Date().toISOString(),
  };
  appendEvent(event, projectId);
  return event;
}

export function getEvents(projectId?: string, limit = 500): PlatformEvent[] {
  return loadEvents(projectId).slice(-limit).reverse();
}

export function getEventsByRunId(runId: string): PlatformEvent[] {
  // Search across all trace files for this runId
  const dir = getTracesDir();
  if (!fs.existsSync(dir)) return [];
  const events: PlatformEvent[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".ndjson")) continue;
    const filePath = path.join(dir, file);
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line) as PlatformEvent;
        if (ev.runId === runId) events.push(ev);
      } catch {
        // ignore
      }
    }
  }
  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// ── Additional exports required by API routes ──────────────────────────────

export function getProjectEvents(
  projectId: string,
  opts?: { limit?: number; after?: string; kinds?: string[] }
) {
  let events = getEvents(projectId);
  if (opts?.kinds?.length) events = events.filter((e) => opts.kinds!.includes((e as { type?: string }).type ?? ""));
  if (opts?.after) events = events.filter((e) => e.timestamp > opts.after!);
  if (opts?.limit) events = events.slice(-opts.limit);
  return events;
}

export function emitEvent(
  opts: Record<string, unknown> | string,
  kind?: string,
  payload?: unknown
): PlatformEvent {
  if (typeof opts === "string") {
    return recordEvent(kind ?? "unknown", payload, opts);
  }
  return recordEvent(
    (opts.kind ?? opts.type ?? "unknown") as string,
    opts.payload,
    opts.projectId as string | undefined,
    opts.runId as string | undefined
  );
}

export function getAuditTrail(projectId: string, limit?: number) {
  const events = getEvents(projectId);
  return limit ? events.slice(-limit) : events;
}

export function replayProjectEvents(projectId: string) {
  return getEvents(projectId);
}
