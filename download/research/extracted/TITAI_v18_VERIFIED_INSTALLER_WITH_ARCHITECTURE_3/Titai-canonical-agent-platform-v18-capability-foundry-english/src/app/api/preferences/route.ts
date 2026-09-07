import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

const body = z.object({
  theme: z.enum(["dark", "light"]).optional(),
  locale: z.literal("en").optional(),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const patch: Record<string, string> = {};
  if (parsed.data.theme) patch.theme = parsed.data.theme;
  if (parsed.data.locale) patch.locale = parsed.data.locale;
  if (Object.keys(patch).length) {
    db.update(schema.users)
      .set(patch)
      .where(eq(schema.users.id, session.user.id))
      .run();
  }
  return NextResponse.json({ ok: true });
}
