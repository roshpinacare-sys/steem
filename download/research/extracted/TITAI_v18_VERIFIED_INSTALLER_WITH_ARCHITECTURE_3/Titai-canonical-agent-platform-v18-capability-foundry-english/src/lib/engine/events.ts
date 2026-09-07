import "server-only";
import { EventEmitter } from "node:events";
import { eq, and, gt, asc, max } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { RunEvent } from "@/lib/db/schema";
import type { RunEventType } from "./event-types";

export type { RunEventType };

/** In-memory pub/sub, cached on globalThis so dev HMR keeps one bus. */
const globalForBus = globalThis as unknown as { __titaiBus?: EventEmitter };
const bus = globalForBus.__titaiBus ?? new EventEmitter();
bus.setMaxListeners(0);
globalForBus.__titaiBus = bus;

export function emitRunEvent(
  runId: string,
  type: RunEventType,
  payload: unknown,
): RunEvent {
  const write = db.$client.transaction(() => {
    const current = db
      .select({ m: max(schema.runEvents.seq) })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, runId))
      .get();
    const seq = (current?.m ?? -1) + 1;
    const createdAt = new Date();
    const row = db
      .insert(schema.runEvents)
      .values({ runId, seq, type, payload, createdAt })
      .returning()
      .get();
    db.insert(schema.durableOutbox)
      .values({
        idempotencyKey: `run-event:${runId}:${seq}`,
        aggregateType: "run",
        aggregateId: runId,
        type,
        payload: { eventId: row.id, seq, payload },
        status: "pending",
        attempts: 0,
        availableAt: createdAt,
        createdAt,
      })
      .run();
    return row;
  });
  const row = write.immediate();
  bus.emit(`run:${runId}`, row);
  bus.emit("run:*", row);
  return row;
}

export function subscribeRun(
  runId: string,
  listener: (e: RunEvent) => void,
): () => void {
  const channel = `run:${runId}`;
  bus.on(channel, listener);
  return () => bus.off(channel, listener);
}

/** Replay persisted events after a given global id (for SSE resume). */
export function getEventsAfter(runId: string, afterId: number): RunEvent[] {
  return db
    .select()
    .from(schema.runEvents)
    .where(
      and(eq(schema.runEvents.runId, runId), gt(schema.runEvents.id, afterId)),
    )
    .orderBy(asc(schema.runEvents.id))
    .all();
}

export function getAllEvents(runId: string): RunEvent[] {
  return db
    .select()
    .from(schema.runEvents)
    .where(eq(schema.runEvents.runId, runId))
    .orderBy(asc(schema.runEvents.seq))
    .all();
}
