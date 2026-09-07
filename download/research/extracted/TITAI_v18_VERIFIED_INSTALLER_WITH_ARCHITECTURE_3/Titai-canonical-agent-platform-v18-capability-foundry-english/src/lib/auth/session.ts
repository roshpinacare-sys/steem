import "server-only";
import { eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";

/** Returns the full user row for the current session, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .get();
  return user ?? null;
}

/**
 * Returns the current user, or redirects to /login. Use in (app) pages so a
 * missing session never throws a 500 on a cold/racey request.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    const locale = await getLocale();
    redirect({ href: "/login", locale });
  }
  return user!;
}
