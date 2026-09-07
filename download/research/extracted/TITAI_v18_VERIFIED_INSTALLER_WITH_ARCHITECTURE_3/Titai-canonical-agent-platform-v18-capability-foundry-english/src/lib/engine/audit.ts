import "server-only";
import { createHash } from "node:crypto";
import { asc, desc, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canonicalJson } from "@/lib/utils";
import type { AuditRow } from "@/lib/db/schema";

/**
 * Hash-linked, tamper-evident audit chain (adapted from V3/V4). Each row's
 * hash = sha256(prevHash + "\n" + canonicalJson(content)). Any edit to a past
 * row breaks every subsequent hash, which verifyAuditChain() detects.
 */

export const GENESIS = "GENESIS";

type AuditInput = {
  actorType: "user" | "agent" | "system";
  actorId?: string | null;
  action: string;
  subjectType?: string | null;
  subjectId?: string | null;
  payload?: unknown;
};

function hashEntry(prevHash: string, content: Record<string, unknown>): string {
  return createHash("sha256")
    .update(prevHash + "\n" + canonicalJson(content))
    .digest("hex");
}

export function appendAudit(entry: AuditInput): AuditRow {
  const append = db.$client.transaction(() => {
    const ts = new Date();
    const prev = db
      .select({ hash: schema.auditLog.hash })
      .from(schema.auditLog)
      .orderBy(desc(schema.auditLog.id))
      .limit(1)
      .get();
    const prevHash = prev?.hash ?? GENESIS;

    const content = {
      ts: ts.getTime(),
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      subjectType: entry.subjectType ?? null,
      subjectId: entry.subjectId ?? null,
      payload: entry.payload ?? null,
    };
    const hash = hashEntry(prevHash, content);

    const row = db
      .insert(schema.auditLog)
      .values({
        ts,
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        subjectType: entry.subjectType ?? null,
        subjectId: entry.subjectId ?? null,
        payload: entry.payload ?? null,
        prevHash,
        hash,
      })
      .returning()
      .get();
    db.insert(schema.durableOutbox)
      .values({
        idempotencyKey: `audit:${hash}`,
        aggregateType: entry.subjectType ?? "system",
        aggregateId: entry.subjectId ?? "global",
        type: `audit.${entry.action}`,
        payload: { auditId: row.id, hash },
        status: "pending",
        attempts: 0,
        availableAt: ts,
        createdAt: ts,
      })
      .run();
    return row;
  });
  return append.immediate();
}

export interface ChainVerification {
  ok: boolean;
  length: number;
  brokenAtId?: number;
}

export function verifyAuditChain(): ChainVerification {
  const rows = db
    .select()
    .from(schema.auditLog)
    .orderBy(asc(schema.auditLog.id))
    .all();

  let prevHash = GENESIS;
  for (const row of rows) {
    if (row.prevHash !== prevHash) {
      return { ok: false, length: rows.length, brokenAtId: row.id };
    }
    const content = {
      ts: row.ts.getTime(),
      actorType: row.actorType,
      actorId: row.actorId ?? null,
      action: row.action,
      subjectType: row.subjectType ?? null,
      subjectId: row.subjectId ?? null,
      payload: row.payload ?? null,
    };
    const expected = hashEntry(prevHash, content);
    if (expected !== row.hash) {
      return { ok: false, length: rows.length, brokenAtId: row.id };
    }
    prevHash = row.hash;
  }
  return { ok: true, length: rows.length };
}

export function listAudit(limit = 200): AuditRow[] {
  const rows = db
    .select()
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.id))
    .limit(limit)
    .all();
  if (rows.length === 0) return rows;
  const redacted = new Set(
    db
      .select({ auditId: schema.auditRedactions.auditId })
      .from(schema.auditRedactions)
      .where(inArray(schema.auditRedactions.auditId, rows.map((row) => row.id)))
      .all()
      .map((row) => row.auditId),
  );
  return rows.map((row) =>
    redacted.has(row.id)
      ? {
          ...row,
          actorId: null,
          subjectId: null,
          payload: { redacted: true },
        }
      : row,
  );
}
