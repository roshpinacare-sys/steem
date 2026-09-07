"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Bot, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { PageHeader } from "@/components/shell/page-header";
import { TierBadge } from "@/components/runs/badges";
import { LaunchWizard } from "@/components/mission-control/launch-wizard";
import type { Template, AgentTier } from "@/lib/db/schema";

export function TemplateGallery({ templates }: { templates: Template[] }) {
  const t = useTranslations();
  const router = useRouter();
  const qc = useQueryClient();
  const [wizard, setWizard] = React.useState<{ objective: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const agentTemplates = templates.filter((x) => x.kind === "agent");
  const objectiveTemplates = templates.filter((x) => x.kind === "objective");

  async function useAgentTemplate(tpl: Template) {
    setBusy(tpl.id);
    const payload = tpl.payload as Record<string, unknown>;
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: payload.name ?? tpl.name,
        description: payload.description ?? tpl.description,
        tier: payload.tier ?? tpl.tier ?? "engineering",
        systemPrompt: payload.systemPrompt,
        provider: payload.provider,
        model: payload.model,
        tools: payload.tools,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(t("errors.generic"));
      return;
    }
    const b = await res.json();
    qc.invalidateQueries({ queryKey: ["agents"] });
    router.push(`/agents/${b.id}`);
  }

  if (templates.length === 0) {
    return (
      <>
        <PageHeader title={t("library.title")} subtitle={t("library.subtitle")} />
        <EmptyState icon={<Sparkles />} title={t("library.empty")} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("library.title")} subtitle={t("library.subtitle")} />

      {agentTemplates.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-muted-foreground">
            <Bot className="size-4" />
            {t("library.agentTemplates")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agentTemplates.map((tpl) => (
              <Card key={tpl.id} className="flex h-full flex-col p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-surface-raised">
                    <Bot className="size-5 text-muted-foreground" />
                  </div>
                  {tpl.tier && <TierBadge tier={tpl.tier as AgentTier} />}
                </div>
                <p className="font-display font-semibold">{tpl.name}</p>
                <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted-foreground">
                  {tpl.description}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  disabled={busy === tpl.id}
                  onClick={() => useAgentTemplate(tpl)}
                >
                  {t("library.useTemplate")}
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      {objectiveTemplates.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-muted-foreground">
            <Sparkles className="size-4" />
            {t("library.objectiveTemplates")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {objectiveTemplates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() =>
                  setWizard({
                    objective:
                      (tpl.payload as { objective?: string }).objective ??
                      tpl.description,
                  })
                }
                className="text-start"
              >
                <Card className="flex h-full items-start gap-3 p-4 transition-colors hover:bg-surface-hover">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <Sparkles className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{tpl.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                      {tpl.description}
                    </p>
                  </div>
                  <ArrowRight className="size-4 text-subtle-foreground rtl:rotate-180" />
                </Card>
              </button>
            ))}
          </div>
        </section>
      )}

      <LaunchWizard
        open={!!wizard}
        onClose={() => setWizard(null)}
        presetObjective={wizard?.objective}
      />
    </>
  );
}
