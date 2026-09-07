import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { appendAudit } from "@/lib/engine/audit";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";
import {
  hashMemoryContent,
  selectMemoriesWithinBudget,
} from "@/lib/memory/governed-memory";

export const runtime = "nodejs";

const kind = z.enum([
  "working",
  "episodic",
  "semantic",
  "procedural",
  "decision",
  "preference",
  "evidence",
  "negative",
]);
const sensitivity = z.enum(["public", "internal", "restricted"]);
const provenance = z.object({
  sourceType: z.enum(["user", "run", "artifact", "import", "system"]),
  sourceRef: z.string().min(1).max(200).optional(),
});
const createSchema = z.object({
  kind,
  content: z.string().min(1).max(8_000),
  tags: z.array(z.string().min(1).max(60)).max(20).default([]),
  provenance,
  confidence: z.number().min(0).max(1).default(0.5),
  authority: z.number().min(0).max(1).default(0.5),
  contradictionRisk: z.number().min(0).max(1).default(0),
  sensitivity: sensitivity.default("internal"),
  contradictionGroup: z.string().min(1).max(120).optional(),
  expiresAt: z.string().datetime().optional(),
});
const correctSchema = createSchema.extend({
  action: z.literal("correct"),
  memoryId: z.string().min(1),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const scope = resolvePilotScope(session.user.id);
  const url = new URL(req.url);
  const query = (url.searchParams.get("q") ?? "").slice(0, 500);
  const maxTokens = Math.min(4_000, Math.max(64, Number(url.searchParams.get("maxTokens") ?? 1_000)));
  const includeRestricted = url.searchParams.get("includeRestricted") === "true";
  const now = new Date();
  const candidates = db
    .select()
    .from(schema.memories)
    .where(
      and(
        eq(schema.memories.ownerId, session.user.id),
        eq(schema.memories.tenantId, scope.tenantId),
        eq(schema.memories.workspaceId, scope.workspaceId),
        eq(schema.memories.status, "active"),
        or(isNull(schema.memories.expiresAt), gt(schema.memories.expiresAt, now)),
      ),
    )
    .orderBy(desc(schema.memories.updatedAt))
    .limit(200)
    .all();
  const selected = selectMemoriesWithinBudget(candidates, {
    query,
    maxTokens,
    includeRestricted,
    now,
  });
  return NextResponse.json({
    memories: selected.map(({ memory, score, estimatedTokens, reasons }) => ({
      ...memory,
      score,
      estimatedTokens,
      reasons,
    })),
    candidateCount: candidates.length,
    selectedCount: selected.length,
    maxTokens,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const scope = resolvePilotScope(session.user.id);
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "expiry_must_be_future" }, { status: 400 });
  }
  const row = db
    .insert(schema.memories)
    .values({
      ownerId: session.user.id,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      visibility: "private",
      kind: parsed.data.kind,
      content: parsed.data.content,
      contentHash: hashMemoryContent(parsed.data.content),
      tags: [...new Set(parsed.data.tags.map((tag) => tag.trim().toLocaleLowerCase("en")))],
      provenance: {
        ...parsed.data.provenance,
        capturedAt: new Date().toISOString(),
      },
      confidence: parsed.data.confidence,
      authority: parsed.data.authority,
      contradictionRisk: parsed.data.contradictionRisk,
      sensitivity: parsed.data.sensitivity,
      contradictionGroup: parsed.data.contradictionGroup ?? null,
      expiresAt,
      updatedAt: new Date(),
    })
    .returning()
    .get();
  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "memory.create",
    subjectType: "memory",
    subjectId: row.id,
    payload: { kind: row.kind, contentHash: row.contentHash, sensitivity: row.sensitivity },
  });
  return NextResponse.json({ memory: row }, { status: 201 });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const scope = resolvePilotScope(session.user.id);
  const parsed = correctSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "expiry_must_be_future" }, { status: 400 });
  }
  const correction = db.$client.transaction(() => {
    const original = db
      .select()
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.id, parsed.data.memoryId),
          eq(schema.memories.ownerId, session.user.id),
          eq(schema.memories.tenantId, scope.tenantId),
          eq(schema.memories.workspaceId, scope.workspaceId),
          eq(schema.memories.status, "active"),
        ),
      )
      .get();
    if (!original) return null;
    const replacement = db
      .insert(schema.memories)
      .values({
        ownerId: session.user.id,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        visibility: "private",
        kind: parsed.data.kind,
        content: parsed.data.content,
        contentHash: hashMemoryContent(parsed.data.content),
        tags: [...new Set(parsed.data.tags.map((tag) => tag.trim().toLocaleLowerCase("en")))],
        provenance: { ...parsed.data.provenance, capturedAt: new Date().toISOString() },
        confidence: parsed.data.confidence,
        authority: parsed.data.authority,
        contradictionRisk: parsed.data.contradictionRisk,
        sensitivity: parsed.data.sensitivity,
        correctsId: original.id,
        contradictionGroup: parsed.data.contradictionGroup ?? original.contradictionGroup,
        expiresAt,
        updatedAt: new Date(),
      })
      .returning()
      .get();
    db.update(schema.memories)
      .set({ status: "corrected", updatedAt: new Date() })
      .where(eq(schema.memories.id, original.id))
      .run();
    return { original, replacement };
  }).immediate();
  if (!correction) return NextResponse.json({ error: "not_found" }, { status: 404 });
  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "memory.correct",
    subjectType: "memory",
    subjectId: correction.replacement.id,
    payload: {
      correctsId: correction.original.id,
      previousHash: correction.original.contentHash,
      replacementHash: correction.replacement.contentHash,
    },
  });
  return NextResponse.json({ memory: correction.replacement });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const scope = resolvePilotScope(session.user.id);
  const memoryId = new URL(req.url).searchParams.get("id");
  if (!memoryId) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const row = db
    .select({ id: schema.memories.id, contentHash: schema.memories.contentHash })
    .from(schema.memories)
    .where(and(eq(schema.memories.id, memoryId), eq(schema.memories.ownerId, session.user.id), eq(schema.memories.tenantId, scope.tenantId), eq(schema.memories.workspaceId, scope.workspaceId)))
    .get();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  db.delete(schema.memories)
    .where(and(eq(schema.memories.id, memoryId), eq(schema.memories.ownerId, session.user.id), eq(schema.memories.tenantId, scope.tenantId), eq(schema.memories.workspaceId, scope.workspaceId)))
    .run();
  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "memory.delete",
    subjectType: "memory",
    subjectId: memoryId,
    payload: { contentHash: row.contentHash },
  });
  return NextResponse.json({ deleted: true });
}
