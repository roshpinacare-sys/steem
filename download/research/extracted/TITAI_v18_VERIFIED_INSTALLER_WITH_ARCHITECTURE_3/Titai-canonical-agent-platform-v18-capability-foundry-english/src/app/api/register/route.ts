import { NextResponse } from "next/server";
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { appendAudit } from "@/lib/engine/audit";

export const runtime = "nodejs";

const schemaBody = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(12).max(200),
  locale: z.string().optional(),
  inviteToken: z.string().max(256).optional(),
});

export async function POST(req: Request) {
  const { checkRateLimit, clientKey } = await import("@/lib/rate-limit");
  if (!checkRateLimit(`register:${clientKey(req)}`, { limit: 5, windowMs: 60_000 })) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = schemaBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const totalUsers = db.select({ value: count() }).from(schema.users).get()?.value ?? 0;
  const publicRegistration = process.env.ALLOW_PUBLIC_REGISTRATION === "true";
  const configuredInvite = process.env.REGISTRATION_INVITE_TOKEN;
  if (totalUsers > 0 && !publicRegistration) {
    return NextResponse.json({ error: "registration_closed" }, { status: 403 });
  }
  if (configuredInvite && parsed.data.inviteToken !== configuredInvite) {
    return NextResponse.json({ error: "invalid_invite" }, { status: 403 });
  }

  const email = parsed.data.email.toLowerCase();
  const existing = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .get();
  if (existing) {
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const user = db
    .insert(schema.users)
    .values({
      name: parsed.data.name,
      email,
      passwordHash,
      locale: parsed.data.locale ?? "en",
      role: totalUsers === 0 ? "admin" : "member",
    })
    .returning()
    .get();
  appendAudit({
    actorType: "user",
    actorId: user.id,
    action: "user.register",
    subjectType: "user",
    subjectId: user.id,
  });
  return NextResponse.json({ ok: true });
}
