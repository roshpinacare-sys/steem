import { NextResponse } from "next/server";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { appendAudit } from "@/lib/engine/audit";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";

export const runtime = "nodejs";

const createSchema = z.object({
  kind: z.enum(["objective", "agent"]),
  name: z.string().min(1).max(120),
  description: z.string().max(4000).default(""),
  payload: z.record(z.unknown()),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const scope = resolvePilotScope(session.user.id);
  const rows = db
    .select()
    .from(schema.templates)
    .where(
      or(
        eq(schema.templates.isBuiltin, true),
        and(
          eq(schema.templates.ownerId, session.user.id),
          eq(schema.templates.tenantId, scope.tenantId),
          eq(schema.templates.workspaceId, scope.workspaceId),
        ),
      ),
    )
    .orderBy(desc(schema.templates.createdAt))
    .all();
  return NextResponse.json({ templates: rows });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const scope = resolvePilotScope(session.user.id);
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  const d = parsed.data;
  const row = db
    .insert(schema.templates)
    .values({
      ownerId: session.user.id,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      visibility: "private",
      kind: d.kind,
      name: d.name,
      description: d.description,
      payload: d.payload as Record<string, unknown>,
      isBuiltin: false,
    })
    .returning()
    .get();
  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "template.create",
    subjectType: "template",
    subjectId: row.id,
    payload: { kind: d.kind, name: d.name },
  });
  return NextResponse.json({ id: row.id });
}
