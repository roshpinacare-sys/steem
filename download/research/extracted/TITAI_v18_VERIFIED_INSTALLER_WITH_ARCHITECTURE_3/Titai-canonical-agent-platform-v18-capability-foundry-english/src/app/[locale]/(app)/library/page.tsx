import { desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { TemplateGallery } from "@/components/library/template-gallery";

export default async function LibraryPage() {
  await requireUser();
  const templates = db
    .select()
    .from(schema.templates)
    .orderBy(desc(schema.templates.createdAt))
    .all();
  return <TemplateGallery templates={templates} />;
}
