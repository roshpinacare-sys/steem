"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Check, ChevronRight, Rocket, Sparkles } from "lucide-react";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea, Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { TierDot } from "@/components/runs/badges";
import { PROVIDERS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Agent, Template } from "@/lib/db/schema";

interface WizardProps {
  open: boolean;
  onClose: () => void;
  presetObjective?: string;
  presetAgentId?: string;
}

const STEPS = ["stepObjective", "stepAgent", "stepOptions", "stepReview"] as const;

export function LaunchWizard({
  open,
  onClose,
  presetObjective,
  presetAgentId,
}: WizardProps) {
  const t = useTranslations();
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [objective, setObjective] = React.useState(presetObjective ?? "");
  const [agentId, setAgentId] = React.useState(presetAgentId ?? "");
  const [provider, setProvider] = React.useState("");
  const [dryRun, setDryRun] = React.useState(false);
  const [launching, setLaunching] = React.useState(false);

  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await fetch("/api/agents")).json(),
    enabled: open,
  });
  const { data: templatesData } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await fetch("/api/templates")).json(),
    enabled: open,
  });

  const agents: Agent[] = agentsData?.agents ?? [];
  const objectiveTemplates: Template[] = (templatesData?.templates ?? []).filter(
    (x: Template) => x.kind === "objective",
  );

  React.useEffect(() => {
    if (open) {
      setStep(0);
      setObjective(presetObjective ?? "");
      setAgentId(presetAgentId ?? "");
      setProvider("");
      setDryRun(false);
    }
  }, [open, presetObjective, presetAgentId]);

  React.useEffect(() => {
    if (!agentId && agents.length) setAgentId(agents[0].id);
  }, [agents, agentId]);

  const selectedAgent = agents.find((a) => a.id === agentId);
  const canNext =
    (step === 0 && objective.trim().length > 0) ||
    (step === 1 && !!agentId) ||
    step === 2 ||
    step === 3;

  async function launch() {
    setLaunching(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective,
          agentId,
          provider: provider || undefined,
          dryRun,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(t("errors.generic"));
        setLaunching(false);
        return;
      }
      onClose();
      router.push(`/runs/${body.runId}`);
    } catch {
      toast.error(t("errors.generic"));
      setLaunching(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="wizard-title">
      <ModalHeader id="wizard-title" title={t("wizard.title")} />

      {/* Step rail */}
      <div className="flex items-center gap-1 border-b border-border px-5 py-3">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium",
                i === step
                  ? "text-primary"
                  : i < step
                    ? "text-foreground"
                    : "text-subtle-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border text-[10px]",
                  i === step
                    ? "border-primary bg-primary/15"
                    : i < step
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border",
                )}
              >
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{t(`wizard.${s}`)}</span>
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight className="size-3 text-subtle-foreground rtl:rotate-180" />
            )}
          </React.Fragment>
        ))}
      </div>

      <ModalBody className="min-h-[280px]">
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="objective">{t("wizard.objectiveLabel")}</Label>
              <Textarea
                id="objective"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder={t("wizard.objectivePlaceholder")}
                rows={4}
                autoFocus
              />
            </div>
            {objectiveTemplates.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {t("wizard.objectiveFromTemplate")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {objectiveTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() =>
                        setObjective(
                          (tpl.payload as { objective?: string }).objective ??
                            tpl.description,
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <Sparkles className="size-3 text-primary" />
                      {tpl.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-2">
            <Label>{t("wizard.agentLabel")}</Label>
            {agents.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("agents.empty")}
              </p>
            )}
            <div className="space-y-2">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAgentId(a.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-3 text-start transition-colors",
                    agentId === a.id
                      ? "border-primary bg-primary/8"
                      : "border-border hover:bg-surface-hover",
                  )}
                >
                  <TierDot tier={a.tier} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.description || "—"}
                    </p>
                  </div>
                  {agentId === a.id && (
                    <Check className="size-4 text-primary" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="provider">{t("wizard.optionsProvider")}</Label>
              <Select
                id="provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="">
                  {t("wizard.optionsUseAgentDefault")}
                </option>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {t(`provider.${p}`)}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center justify-between rounded-lg border border-border p-3">
              <span className="text-sm">{t("wizard.optionsDryRun")}</span>
              <Switch checked={dryRun} onCheckedChange={setDryRun} />
            </label>
          </div>
        )}

        {step === 3 && (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">
                {t("wizard.reviewObjective")}
              </dt>
              <dd className="mt-1 rounded-md border border-border bg-surface-raised p-2.5 text-foreground">
                {objective}
              </dd>
            </div>
            <div className="flex gap-6">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">
                  {t("wizard.reviewAgent")}
                </dt>
                <dd className="mt-1 flex items-center gap-1.5">
                  {selectedAgent && <TierDot tier={selectedAgent.tier} />}
                  {selectedAgent?.name ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">
                  {t("wizard.reviewProvider")}
                </dt>
                <dd className="mt-1">
                  {provider
                    ? t(`provider.${provider}`)
                    : t("wizard.optionsUseAgentDefault")}
                </dd>
              </div>
            </div>
          </dl>
        )}
      </ModalBody>

      <ModalFooter>
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
            {t("common.back")}
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            {t("common.next")}
          </Button>
        ) : (
          <Button disabled={launching || !agentId} onClick={launch}>
            <Rocket className="size-4" />
            {launching ? t("wizard.launching") : t("wizard.launchButton")}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
