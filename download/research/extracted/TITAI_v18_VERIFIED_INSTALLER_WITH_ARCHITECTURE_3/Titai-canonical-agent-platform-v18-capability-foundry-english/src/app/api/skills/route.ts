import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, or, isNull, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { parseSkillMd, buildSkillMd, SkillParseError } from "@/lib/engine/skills";
import { appendAudit } from "@/lib/engine/audit";
import { slugify } from "@/lib/utils";
import { createId } from "@/lib/ids";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  body: z.string().max(20000).default(""),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = db
    .select()
    .from(schema.skills)
    .where(or(isNull(schema.skills.ownerId), eq(schema.skills.ownerId, session.user.id)))
    .orderBy(desc(schema.skills.isBuiltin), desc(schema.skills.updatedAt))
    .all();
  return NextResponse.json({ skills: rows });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
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

  const skillId = createId();
  const versionId = createId();
  db.insert(schema.skills)
    .values({
      id: skillId,
      ownerId: session.user.id,
      name: d.name,
      slug: `${slugify(d.name)}-${skillId.slice(0, 5)}`,
      description: d.description,
      currentVersionId: versionId,
      isBuiltin: false,
    })
    .run();
  db.insert(schema.skillVersions)
    .values({
      id: versionId,
      skillId,
      version: 1,
      frontmatter: { name: d.name, description: d.description },
      body: d.body,
      raw,
    })
    .run();

  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "skill.create",
    subjectType: "skill",
    subjectId: skillId,
  });
  return NextResponse.json({ id: skillId });
}
