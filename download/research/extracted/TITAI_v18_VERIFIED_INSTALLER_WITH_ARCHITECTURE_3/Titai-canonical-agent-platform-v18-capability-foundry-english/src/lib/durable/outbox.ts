import "server-only";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export interface OutboxMessage {
  id: number;
  idempotencyKey: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: unknown;
  attempts: number;
  createdAt: string;
}

export function claimOutboxBatch(
  workerId: string,
  limit = 50,
  leaseMs = 30_000,
  now = new Date(),
): OutboxMessage[] {
  if (!workerId.trim()) throw new Error("outbox_worker_id_required");
  const bounded = Math.max(1, Math.min(limit, 500));
  const claim = db.$client.transaction(() => {
    const rows = db
      .select()
      .from(schema.durableOutbox)
      .where(
        and(
          lte(schema.durableOutbox.availableAt, now),
          or(
            inArray(schema.durableOutbox.status, ["pending", "failed"]),
            and(
              eq(schema.durableOutbox.status, "processing"),
              or(
                isNull(schema.durableOutbox.leaseExpiresAt),
                lte(schema.durableOutbox.leaseExpiresAt, now),
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(schema.durableOutbox.id))
      .limit(bounded)
      .all();

    const claimed: typeof rows = [];
    for (const row of rows) {
      const result = db
        .update(schema.durableOutbox)
        .set({
          status: "processing",
          attempts: row.attempts + 1,
          leaseOwner: workerId,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          lastError: null,
        })
        .where(
          and(
            eq(schema.durableOutbox.id, row.id),
            eq(schema.durableOutbox.status, row.status),
          ),
        )
        .run();
      if (result.changes === 1) claimed.push(row);
    }

    return claimed.map((row) => ({
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      type: row.type,
      payload: row.payload,
      attempts: row.attempts + 1,
      createdAt: row.createdAt?.toISOString() ?? now.toISOString(),
    }));
  });
  return claim.immediate();
}

export function markOutboxPublished(
  id: number,
  workerId: string,
  now = new Date(),
): boolean {
  const result = db
    .update(schema.durableOutbox)
    .set({
      status: "published",
      publishedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
    })
    .where(
      and(
        eq(schema.durableOutbox.id, id),
        eq(schema.durableOutbox.status, "processing"),
        eq(schema.durableOutbox.leaseOwner, workerId),
      ),
    )
    .run();
  return result.changes === 1;
}

export function markOutboxFailed(
  id: number,
  workerId: string,
  error: string,
  retryAt: Date,
): boolean {
  const result = db
    .update(schema.durableOutbox)
    .set({
      status: "failed",
      lastError: error.slice(0, 2_000),
      availableAt: retryAt,
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(schema.durableOutbox.id, id),
        eq(schema.durableOutbox.status, "processing"),
        eq(schema.durableOutbox.leaseOwner, workerId),
      ),
    )
    .run();
  return result.changes === 1;
}
