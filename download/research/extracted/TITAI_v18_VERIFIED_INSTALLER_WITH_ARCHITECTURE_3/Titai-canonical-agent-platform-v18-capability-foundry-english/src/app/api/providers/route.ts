import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { encryptSecret, maskSecret } from "@/lib/crypto";
import { appendAudit } from "@/lib/engine/audit";
import { PROVIDERS, KEYLESS_PROVIDERS } from "@/lib/constants";
import type { ProviderConfig } from "@/lib/db/schema";

export const runtime = "nodejs";

const saveSchema = z.object({
  provider: z.enum(PROVIDERS as [string, ...string[]]),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional().or(z.literal("")),
  defaultModel: z.string().max(120).optional(),
  enabled: z.boolean().optional(),
});

/** Never leak secrets — return only a mask + whether a key exists. */
function publicView(c: ProviderConfig) {
  return {
    id: c.id,
    provider: c.provider,
    hasKey: !!c.apiKeyCiphertext,
    mask: c.apiKeyMask,
    baseUrl: c.baseUrl,
    defaultModel: c.defaultModel,
    enabled: c.enabled,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = db
    .select()
    .from(schema.providerConfigs)
    .where(eq(schema.providerConfigs.userId, session.user.id))
    .all();
  return NextResponse.json({ providers: rows.map(publicView) });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  const d = parsed.data;

  const existing = db
    .select()
    .from(schema.providerConfigs)
    .where(
      and(
        eq(schema.providerConfigs.userId, session.user.id),
        eq(schema.providerConfigs.provider, d.provider as never),
      ),
    )
    .get();

  const patch: Record<string, unknown> = {
    baseUrl: d.baseUrl || null,
    defaultModel: d.defaultModel ?? existing?.defaultModel ?? "",
    enabled: d.enabled ?? existing?.enabled ?? true,
    updatedAt: new Date(),
  };

  // Only (re)encrypt when a new key is provided.
  if (d.apiKey && !KEYLESS_PROVIDERS.includes(d.provider as never)) {
    const sealed = encryptSecret(
      d.apiKey,
      `${session.user.id}:${d.provider}`,
    );
    patch.apiKeyCiphertext = sealed.ciphertext;
    patch.apiKeyIv = sealed.iv;
    patch.apiKeyTag = sealed.tag;
    patch.apiKeyVersion = sealed.version ?? 2;
    patch.apiKeyMask = maskSecret(d.apiKey);
  }

  if (existing) {
    db.update(schema.providerConfigs)
      .set(patch)
      .where(eq(schema.providerConfigs.id, existing.id))
      .run();
  } else {
    db.insert(schema.providerConfigs)
      .values({
        userId: session.user.id,
        provider: d.provider as never,
        ...(patch as object),
      })
      .run();
  }

  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "provider.update",
    subjectType: "provider",
    subjectId: d.provider,
    payload: { hasKey: !!d.apiKey },
  });
  return NextResponse.json({ ok: true });
}
