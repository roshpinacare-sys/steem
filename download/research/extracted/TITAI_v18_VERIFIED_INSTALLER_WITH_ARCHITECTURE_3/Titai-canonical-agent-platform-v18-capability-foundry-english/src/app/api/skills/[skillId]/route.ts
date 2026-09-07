import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { parseSkillMd, buildSkillMd, SkillParseError } from "@/lib/engine/skills";
import { appendAudit } from "@/lib/engine/audit";
import { createId } from "@/lib/ids";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  body: z.string().max(20000),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ skillId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { skillId } = await params;
  const skill = db
    .select()
    .from(schema.skills)
    .where(eq(schema.skills.id, skillId))
    .get();
  if (!skill) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!skill.isBuiltin && skill.ownerId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const versions = db
    .select()
    .from(schema.skillVersions)
    .where(eq(schema.skillVersions.skillId, skillId))
    .orderBy(desc(schema.skillVersions.version))
    .all();
  return NextResponse.json({ skill, versions });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ skillId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { skillId } = await params;
  const skill = db
    .select()
    .from(schema.skills)
    .where(eq(schema.skills.id, skillId))
    .get();
  if (!skill) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (skill.isBuiltin || skill.ownerId !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  const d = parsed.data;
  const raw = buildSkillMd({ name: d.name, description: d.description }, d.body);
  try {
    parseSkillMd(raw);
  } catch (err) {
    if (err instanceof SkillParseError)
      return NextResponse.json({ error: "invalid_frontmatter" }, { status: 400 });
    throw err;
  }

  const latest = db
    .select({ v: schema.skillVersions.version })
    .from(schema.skillVersions)
    .where(eq(schema.skillVersions.skillId, skillId))
    .orderBy(desc(schema.skillVersions.version))
    .get();
  const version = (latest?.v ?? 0) + 1;
  const versionId = createId();
  db.insert(schema.skillVersions)
    .values({
      id: versionId,
      skillId,
      version,
      frontmatter: { name: d.name, description: d.description },
      body: d.body,
      raw,
    })
    .run();
  db.update(schema.skills)
    .set({
      name: d.name,
      description: d.description,
      currentVersionId: versionId,
      updatedAt: new Date(),
    })
    .where(eq(schema.skills.id, skillId))
    .run();

  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "skill.update",
    subjectType: "skill",
    subjectId: skillId,
    payload: { version },
  });
  return NextResponse.json({ ok: true, version });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ skillId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { skillId } = await params;
  const skill = db
    .select()
    .from(schema.skills)
    .where(eq(schema.skills.id, skillId))
    .get();
  if (!skill) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (skill.isBuiltin || skill.ownerId !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  db.delete(schema.skills).where(eq(schema.skills.id, skillId)).run();
  return NextResponse.json({ ok: true });
}
