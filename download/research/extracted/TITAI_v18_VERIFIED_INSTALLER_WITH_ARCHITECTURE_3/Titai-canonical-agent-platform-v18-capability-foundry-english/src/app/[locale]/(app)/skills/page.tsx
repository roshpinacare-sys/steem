import { or, isNull, eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { SkillsList } from "@/components/skills/skills-list";

export default async function SkillsPage() {
  const user = await requireUser();
  const skills = db
    .select()
    .from(schema.skills)
    .where(or(isNull(schema.skills.ownerId), eq(schema.skills.ownerId, user.id)))
    .orderBy(desc(schema.skills.isBuiltin), desc(schema.skills.updatedAt))
    .all();
  return <SkillsList initial={skills} />;
}
