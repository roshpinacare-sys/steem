import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { MemoryLedger } from "@/components/memory/memory-ledger";

export default async function MemoryPage() {
  const user = await requireUser();
  const memories = db
    .select()
    .from(schema.memories)
    .where(and(eq(schema.memories.ownerId, user.id), eq(schema.memories.status, "active")))
    .orderBy(desc(schema.memories.updatedAt))
    .limit(200)
    .all();
  return <MemoryLedger initialMemories={memories} />;
}
