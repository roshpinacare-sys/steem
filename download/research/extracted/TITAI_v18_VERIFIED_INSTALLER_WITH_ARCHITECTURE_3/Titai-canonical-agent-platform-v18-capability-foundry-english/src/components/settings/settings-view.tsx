"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRound, ShieldCheck, SlidersHorizontal, Check, Info } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Switch, Spinner } from "@/components/ui/misc";
import { PageHeader } from "@/components/shell/page-header";
import { useTheme } from "@/components/shell/theme-toggle";
import { PROVIDERS, KEYLESS_PROVIDERS, DEFAULT_MODELS } from "@/lib/constants";
import type { Policy } from "@/lib/db/schema";
import type { ProviderName } from "@/lib/engine/types";

interface ProviderView {
  provider: ProviderName;
  hasKey: boolean;
  mask: string | null;
  baseUrl: string | null;
  defaultModel: string;
  enabled: boolean;
}

export function SettingsView({
  initialProviders,
  initialPolicies,
}: {
  initialProviders: ProviderView[];
  initialPolicies: Policy[];
}) {
  const t = useTranslations();
  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <Tabs defaultValue="providers">
        <TabsList className="mb-5">
          <TabsTrigger value="providers">
            <KeyRound className="size-4" />
            {t("settings.tabProviders")}
          </TabsTrigger>
          <TabsTrigger value="policies">
            <ShieldCheck className="size-4" />
            {t("settings.tabPolicies")}
          </TabsTrigger>
          <TabsTrigger value="preferences">
            <SlidersHorizontal className="size-4" />
            {t("settings.tabPreferences")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="providers">
          <ProvidersPanel initial={initialProviders} />
        </TabsContent>
        <TabsContent value="policies">
          <PoliciesPanel initial={initialPolicies} />
        </TabsContent>
        <TabsContent value="preferences">
          <PreferencesPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}

function ProvidersPanel({ initial }: { initial: ProviderView[] }) {
  const t = useTranslations();
  const byProvider = new Map(initial.map((p) => [p.provider, p]));
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface/60 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        {t("settings.providers.subtitle")}. {t("settings.providers.simulationNote")}
      </div>
      {PROVIDERS.filter((p) => p !== "simulation").map((provider) => (
        <ProviderRow key={provider} provider={provider} config={byProvider.get(provider)} />
      ))}
    </div>
  );
}

function ProviderRow({
  provider,
  config,
}: {
  provider: ProviderName;
  config?: ProviderView;
}) {
  const t = useTranslations();
  const keyless = KEYLESS_PROVIDERS.includes(provider);
  const [apiKey, setApiKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState(config?.baseUrl ?? "");
  const [model, setModel] = React.useState(config?.defaultModel ?? "");
  const [enabled, setEnabled] = React.useState(config?.enabled ?? true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider,
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
        defaultModel: model || undefined,
        enabled,
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success(t("settings.providers.saved"));
      setApiKey("");
    } else {
      toast.error(t("errors.generic"));
    }
  }

  async function test() {
    setTesting(true);
    const res = await fetch("/api/providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const b = await res.json();
    setTesting(false);
    if (b.ok) toast.success(t("settings.providers.testOk"));
    else toast.error(`${t("settings.providers.testFail")}${b.error ? `: ${b.error}` : ""}`);
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display font-semibold">{t(`provider.${provider}`)}</span>
          {config?.hasKey && (
            <span className="flex items-center gap-1 text-xs text-status-completed">
              <Check className="size-3" />
              {t("settings.providers.apiKeyMasked", { mask: config.mask ?? "" })}
            </span>
          )}
          {keyless && (
            <span className="text-xs text-muted-foreground">
              {t("settings.providers.keyless")}
            </span>
          )}
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {!keyless && (
          <div>
            <Label>{t("settings.providers.apiKey")}</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.hasKey ? "••••••••" : "sk-…"}
            />
          </div>
        )}
        <div>
          <Label>{t("settings.providers.defaultModel")}</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_MODELS[provider]}
          />
        </div>
        {(provider === "ollama" || provider === "openrouter") && (
          <div className="sm:col-span-2">
            <Label>{t("settings.providers.baseUrl")}</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : t("settings.providers.save")}
        </Button>
        <Button size="sm" variant="outline" onClick={test} disabled={testing}>
          {testing ? <Spinner /> : t("settings.providers.test")}
        </Button>
      </div>
    </Card>
  );
}

function PoliciesPanel({ initial }: { initial: Policy[] }) {
  const t = useTranslations();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("settings.policies.subtitle")}</p>
      {initial.map((policy) => (
        <PolicyCard key={policy.id} policy={policy} />
      ))}
    </div>
  );
}

function PolicyCard({ policy }: { policy: Policy }) {
  const t = useTranslations();
  const [enabled, setEnabled] = React.useState(policy.enabled);
  const [rulesText, setRulesText] = React.useState(
    JSON.stringify(policy.rules, null, 2),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    let rules;
    try {
      rules = JSON.parse(rulesText);
    } catch {
      setError(t("settings.policies.invalid"));
      return;
    }
    setError(null);
    setSaving(true);
    const res = await fetch("/api/policies", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: policy.id, enabled, rules }),
    });
    setSaving(false);
    if (res.ok) toast.success(t("settings.policies.saved"));
    else toast.error(t("errors.generic"));
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="font-display font-semibold">{policy.name}</p>
          <p className="text-xs text-muted-foreground">{policy.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-subtle-foreground">
            {t("settings.policies.priority")} {policy.priority}
          </span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>
      <Label>{t("settings.policies.rules")}</Label>
      <Textarea
        rows={8}
        value={rulesText}
        onChange={(e) => setRulesText(e.target.value)}
        className="font-mono text-xs"
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <Button size="sm" className="mt-3" onClick={save} disabled={saving}>
        {t("common.save")}
      </Button>
    </Card>
  );
}

function PreferencesPanel() {
  const t = useTranslations();
  const { theme, setTheme } = useTheme();
  return (
    <div className="max-w-md space-y-4">
      <Card className="p-5">
        <Label>{t("settings.preferences.theme")}</Label>
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            variant={theme === "dark" ? "primary" : "outline"}
            onClick={() => setTheme("dark")}
          >
            {t("settings.preferences.themeDark")}
          </Button>
          <Button
            size="sm"
            variant={theme === "light" ? "primary" : "outline"}
            onClick={() => setTheme("light")}
          >
            {t("settings.preferences.themeLight")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
