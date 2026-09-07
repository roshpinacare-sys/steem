import { eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { SettingsView } from "@/components/settings/settings-view";

export default async function SettingsPage() {
  const user = await requireUser();
  const providerRows = db
    .select()
    .from(schema.providerConfigs)
    .where(eq(schema.providerConfigs.userId, user.id))
    .all();
  const providers = providerRows.map((c) => ({
    provider: c.provider,
    hasKey: !!c.apiKeyCiphertext,
    mask: c.apiKeyMask,
    baseUrl: c.baseUrl,
    defaultModel: c.defaultModel,
    enabled: c.enabled,
  }));
  const policies = db
    .select()
    .from(schema.policies)
    .orderBy(asc(schema.policies.priority))
    .all();

  return <SettingsView initialProviders={providers} initialPolicies={policies} />;
}
