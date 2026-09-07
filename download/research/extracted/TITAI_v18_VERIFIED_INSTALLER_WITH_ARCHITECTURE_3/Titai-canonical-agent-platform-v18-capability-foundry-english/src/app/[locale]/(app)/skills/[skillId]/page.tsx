import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { SkillEditor } from "@/components/skills/skill-editor";

export default async function SkillEditorPage({
  params,
}: {
  params: Promise<{ skillId: string }>;
}) {
  const user = await requireUser();
  const { skillId } = await params;
  const skill = db
    .select()
    .from(schema.skills)
    .where(eq(schema.skills.id, skillId))
    .get();
  if (!skill) notFound();
  // Visible if builtin or owned.
  if (!skill.isBuiltin && skill.ownerId !== user.id) notFound();

  const versions = db
    .select()
    .from(schema.skillVersions)
    .where(eq(schema.skillVersions.skillId, skillId))
    .orderBy(desc(schema.skillVersions.version))
    .all();

  return <SkillEditor skill={skill} versions={versions} />;
}
