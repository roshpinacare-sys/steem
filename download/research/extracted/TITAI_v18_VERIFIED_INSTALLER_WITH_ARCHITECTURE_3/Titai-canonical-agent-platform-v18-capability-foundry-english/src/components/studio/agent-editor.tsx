"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Save, Play, History, Trash2, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, Select } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { TierBadge } from "@/components/runs/badges";
import { RunTimeline } from "@/components/runs/run-timeline";
import { useRunEvents } from "@/hooks/use-run-events";
import { PROVIDERS, TIERS, DEFAULT_MODELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type {
  Agent,
  AgentVersion,
  Skill,
  ProviderName,
  AgentTier,
} from "@/lib/db/schema";

interface Props {
  agent: Agent;
  versions: AgentVersion[];
  attachedSkillIds: string[];
  allSkills: Skill[];
  toolNames: { name: string; risk: string; description: string }[];
}

export function AgentEditor({
  agent,
  versions,
  attachedSkillIds,
  allSkills,
  toolNames,
}: Props) {
  const t = useTranslations();
  const router = useRouter();
  const qc = useQueryClient();
  const current = versions[0];

  const [name, setName] = React.useState(agent.name);
  const [description, setDescription] = React.useState(agent.description);
  const [tier, setTier] = React.useState<AgentTier>(agent.tier);
  const [systemPrompt, setSystemPrompt] = React.useState(current?.systemPrompt ?? "");
  const [provider, setProvider] = React.useState<ProviderName>(current?.provider ?? "simulation");
  const [model, setModel] = React.useState(current?.model ?? "");
  const [temperature, setTemperature] = React.useState(current?.temperature ?? 0.7);
  const [maxSteps, setMaxSteps] = React.useState(current?.maxSteps ?? 8);
  const [maxToolIterations, setMaxToolIterations] = React.useState(current?.maxToolIterations ?? 6);
  const [tools, setTools] = React.useState<string[]>(current?.tools ?? []);
  const [skillIds, setSkillIds] = React.useState<string[]>(attachedSkillIds);
  const [saving, setSaving] = React.useState(false);

  function toggleTool(n: string) {
    setTools((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  }
  function toggleSkill(id: string) {
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        tier,
        skillIds,
        version: {
          systemPrompt,
          provider,
          model,
          temperature,
          maxSteps,
          maxToolIterations,
          tools,
        },
      }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("errors.generic"));
      return;
    }
    const body = await res.json();
    toast.success(t("agents.editor.saved", { n: body.version }));
    qc.invalidateQueries({ queryKey: ["agents"] });
    router.refresh();
  }

  async function remove() {
    if (!confirm(`${t("common.delete")}: ${agent.name}?`)) return;
    await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["agents"] });
    router.push("/agents");
  }

  const [restoring, setRestoring] = React.useState<string | null>(null);
  // Restore = create a NEW version copying the old one; history is immutable.
  async function restore(v: AgentVersion) {
    setRestoring(v.id);
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: {
          systemPrompt: v.systemPrompt,
          provider: v.provider,
          model: v.model,
          temperature: v.temperature,
          maxSteps: v.maxSteps,
          maxToolIterations: v.maxToolIterations,
          tools: v.tools,
        },
      }),
    });
    setRestoring(null);
    if (!res.ok) {
      toast.error(t("errors.generic"));
      return;
    }
    const body = await res.json();
    toast.success(t("agents.editor.saved", { n: body.version }));
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title={agent.name}
        subtitle={t("agents.studio")}
        action={
          <div className="flex items-center gap-2">
            <TierBadge tier={tier} />
            <Button variant="ghost" size="icon" onClick={remove} aria-label={t("common.delete")}>
              <Trash2 className="size-4" />
            </Button>
            <Button onClick={save} disabled={saving}>
              <Save className="size-4" />
              {t("agents.editor.saveVersion")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {/* Identity */}
          <Card className="p-5">
            <h2 className="mb-3 font-display text-sm font-semibold">
              {t("agents.editor.identity")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="name">{t("agents.editor.name")}</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="tier">{t("agents.tier")}</Label>
                <Select
                  id="tier"
                  value={tier}
                  onChange={(e) => setTier(e.target.value as AgentTier)}
                >
                  {TIERS.map((x) => (
                    <option key={x} value={x}>
                      {t(`agents.tiers.${x}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor="desc">{t("agents.editor.description")}</Label>
              <Textarea
                id="desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </Card>

          {/* Prompt + model */}
          <Card className="p-5">
            <h2 className="mb-3 font-display text-sm font-semibold">
              {t("agents.editor.systemPrompt")}
            </h2>
            <Textarea
              rows={7}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t("agents.editor.systemPromptPlaceholder")}
              className="font-mono text-xs"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="provider">{t("agents.editor.provider")}</Label>
                <Select
                  id="provider"
                  value={provider}
                  onChange={(e) => {
                    const p = e.target.value as ProviderName;
                    setProvider(p);
                    if (!model) setModel(DEFAULT_MODELS[p]);
                  }}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {t(`provider.${p}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="model">{t("agents.editor.model")}</Label>
                <Input
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={DEFAULT_MODELS[provider]}
                />
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <NumberField
                label={t("agents.editor.temperature")}
                value={temperature}
                step={0.1}
                min={0}
                max={2}
                onChange={setTemperature}
              />
              <NumberField
                label={t("agents.editor.maxSteps")}
                value={maxSteps}
                step={1}
                min={1}
                max={20}
                onChange={(v) => setMaxSteps(Math.round(v))}
              />
              <NumberField
                label={t("agents.editor.maxToolIterations")}
                value={maxToolIterations}
                step={1}
                min={1}
                max={20}
                onChange={(v) => setMaxToolIterations(Math.round(v))}
              />
            </div>
          </Card>

          {/* Tools */}
          <Card className="p-5">
            <h2 className="mb-3 font-display text-sm font-semibold">
              {t("agents.editor.tools")}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {toolNames.map((tool) => (
                <label
                  key={tool.name}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors",
                    tools.includes(tool.name)
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:bg-surface-hover",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={tools.includes(tool.name)}
                    onChange={() => toggleTool(tool.name)}
                    className="mt-0.5 accent-[var(--color-primary)]"
                  />
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-medium">{tool.name}</p>
                    <p className="text-[11px] text-muted-foreground">{tool.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </Card>

          {/* Skills */}
          <Card className="p-5">
            <h2 className="mb-3 font-display text-sm font-semibold">
              {t("agents.editor.skills")}
            </h2>
            {allSkills.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("agents.editor.noSkills")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allSkills.map((skill) => (
                  <button
                    key={skill.id}
                    onClick={() => toggleSkill(skill.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      skillIds.includes(skill.id)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {skill.name}
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right rail: test bench + versions */}
        <div className="space-y-5">
          <TestBench agentId={agent.id} />
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold">
              <History className="size-4" />
              {t("agents.editor.versions")}
            </h2>
            <ul className="space-y-1.5">
              {versions.map((v, idx) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium">
                      {t("agents.editor.version", { n: v.version })}
                    </span>
                    <span className="ms-2 font-mono text-xs text-muted-foreground">
                      {v.provider}
                      {v.model ? ` · ${v.model}` : ""}
                    </span>
                  </div>
                  {idx > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={restoring === v.id}
                      onClick={() => restore(v)}
                    >
                      {t("agents.editor.restore")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function TestBench({ agentId }: { agentId: string }) {
  const t = useTranslations();
  const [objective, setObjective] = React.useState("");
  const [runId, setRunId] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);

  async function run() {
    if (!objective.trim()) return;
    setStarting(true);
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objective, agentId, provider: "simulation" }),
    });
    setStarting(false);
    if (!res.ok) {
      toast.error(t("errors.generic"));
      return;
    }
    const body = await res.json();
    setRunId(body.runId);
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 flex items-center gap-2 font-display text-sm font-semibold">
        <FlaskConical className="size-4" />
        {t("agents.editor.testBench")}
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("agents.editor.testHint")}
      </p>
      <Textarea
        rows={2}
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        placeholder={t("agents.editor.testObjective")}
        className="mb-2"
      />
      <Button size="sm" onClick={run} disabled={starting || !objective.trim()} className="w-full">
        <Play className="size-4" />
        {t("agents.editor.runTest")}
      </Button>
      {runId && (
        <div className="mt-4 max-h-80 overflow-auto rounded-md border border-border p-2">
          <TestBenchStream key={runId} runId={runId} />
        </div>
      )}
    </Card>
  );
}

function TestBenchStream({ runId }: { runId: string }) {
  const { events } = useRunEvents(runId, [], true);
  return <RunTimeline events={events} />;
}
