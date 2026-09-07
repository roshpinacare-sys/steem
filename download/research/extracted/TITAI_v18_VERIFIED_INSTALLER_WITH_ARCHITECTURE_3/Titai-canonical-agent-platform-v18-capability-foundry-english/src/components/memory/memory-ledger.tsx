"use client";

import * as React from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { BrainCircuit, Clock3, FileCheck2, Plus, Search, Shield, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import type { Memory, MemoryKind, MemorySensitivity } from "@/lib/db/schema";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const kinds: MemoryKind[] = [
  "working",
  "episodic",
  "semantic",
  "procedural",
  "decision",
  "preference",
  "evidence",
  "negative",
];
const sensitivities: MemorySensitivity[] = ["public", "internal", "restricted"];

export function MemoryLedger({ initialMemories }: { initialMemories: Memory[] }) {
  const t = useTranslations("memory");
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [content, setContent] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [kind, setKind] = React.useState<MemoryKind>("semantic");
  const [sensitivity, setSensitivity] = React.useState<MemorySensitivity>("internal");
  const [saving, setSaving] = React.useState(false);
  const [correcting, setCorrecting] = React.useState<string | null>(null);
  const [correction, setCorrection] = React.useState("");

  const visible = initialMemories.filter((memory) => {
    const haystack = `${memory.content} ${memory.kind} ${memory.tags.join(" ")}`.toLocaleLowerCase("en");
    return haystack.includes(query.trim().toLocaleLowerCase("en"));
  });

  async function createMemory() {
    if (!content.trim()) return;
    setSaving(true);
    const response = await fetch("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        content: content.trim(),
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        provenance: { sourceType: "user" },
        confidence: 0.8,
        authority: 0.8,
        contradictionRisk: 0,
        sensitivity,
      }),
    });
    setSaving(false);
    if (!response.ok) return toast.error(t("createFailed"));
    setContent("");
    setTags("");
    toast.success(t("created"));
    router.refresh();
  }

  async function correctMemory(memory: Memory) {
    if (!correction.trim()) return;
    setSaving(true);
    const response = await fetch("/api/memory", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "correct",
        memoryId: memory.id,
        kind: memory.kind,
        content: correction.trim(),
        tags: memory.tags,
        provenance: { sourceType: "user", sourceRef: memory.id },
        confidence: memory.confidence,
        authority: memory.authority,
        contradictionRisk: memory.contradictionRisk,
        sensitivity: memory.sensitivity,
        contradictionGroup: memory.contradictionGroup ?? undefined,
        expiresAt: memory.expiresAt?.toISOString(),
      }),
    });
    setSaving(false);
    if (!response.ok) return toast.error(t("correctFailed"));
    setCorrecting(null);
    setCorrection("");
    toast.success(t("corrected"));
    router.refresh();
  }

  async function deleteMemory(memory: Memory) {
    if (!window.confirm(t("deleteConfirm"))) return;
    const response = await fetch(`/api/memory?id=${encodeURIComponent(memory.id)}`, { method: "DELETE" });
    if (!response.ok) return toast.error(t("deleteFailed"));
    toast.success(t("deleted"));
    router.refresh();
  }

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="memory-ledger-title" className="min-w-0">
          <div className="mb-4 flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("search")}
                className="ps-9"
              />
            </div>
            <Badge variant="outline">{t("count", { count: visible.length })}</Badge>
          </div>
          <div id="memory-ledger-title" className="sr-only">{t("title")}</div>
          <div className="space-y-3">
            {visible.length === 0 ? (
              <Card className="border-dashed p-8 text-center">
                <BrainCircuit className="mx-auto mb-3 size-8 text-muted-foreground" />
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("emptyBody")}</p>
              </Card>
            ) : visible.map((memory) => (
              <Card key={memory.id} className="overflow-hidden p-0">
                <div className="flex items-start gap-3 border-b border-border px-4 py-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    {memory.kind === "evidence" ? <FileCheck2 className="size-4" /> : <BrainCircuit className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge>{t(`kind.${memory.kind}`)}</Badge>
                      <Badge variant="outline" className={cn(memory.sensitivity === "restricted" && "border-amber-500/40 text-amber-500")}>
                        <Shield className="me-1 size-3" />
                        {t(`sensitivity.${memory.sensitivity}`)}
                      </Badge>
                      {memory.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6">{memory.content}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 bg-surface/40 px-4 py-2.5 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1"><Clock3 className="size-3" />{memory.updatedAt.toLocaleString()}</span>
                    <span>{t("confidence", { value: Math.round(memory.confidence * 100) })}</span>
                    <span>{t("source", { value: memory.provenance.sourceType })}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setCorrecting(memory.id);
                        setCorrection(memory.content);
                      }}
                    >
                      <Wrench className="size-3.5" />{t("correct")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteMemory(memory)}>
                      <Trash2 className="size-3.5" />{t("delete")}
                    </Button>
                  </div>
                </div>
                {correcting === memory.id && (
                  <div className="space-y-2 border-t border-border p-4">
                    <Label htmlFor={`correction-${memory.id}`}>{t("correctionLabel")}</Label>
                    <Textarea id={`correction-${memory.id}`} value={correction} onChange={(event) => setCorrection(event.target.value)} rows={4} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => correctMemory(memory)} disabled={saving}>{t("saveCorrection")}</Button>
                      <Button size="sm" variant="outline" onClick={() => setCorrecting(null)}>{t("cancel")}</Button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>

        <aside>
          <Card className="sticky top-20 p-4">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary"><Plus className="size-4" /></div>
              <div>
                <p className="font-display font-semibold">{t("createTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("createBody")}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="memory-kind">{t("kindLabel")}</Label>
                <select id="memory-kind" value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
                  {kinds.map((value) => <option key={value} value={value}>{t(`kind.${value}`)}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="memory-content">{t("contentLabel")}</Label>
                <Textarea id="memory-content" value={content} onChange={(event) => setContent(event.target.value)} rows={7} maxLength={8000} />
              </div>
              <div>
                <Label htmlFor="memory-tags">{t("tagsLabel")}</Label>
                <Input id="memory-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t("tagsPlaceholder")} />
              </div>
              <div>
                <Label htmlFor="memory-sensitivity">{t("sensitivityLabel")}</Label>
                <select id="memory-sensitivity" value={sensitivity} onChange={(event) => setSensitivity(event.target.value as MemorySensitivity)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
                  {sensitivities.map((value) => <option key={value} value={value}>{t(`sensitivity.${value}`)}</option>)}
                </select>
              </div>
              <Button className="w-full" onClick={createMemory} disabled={saving || !content.trim()}>
                <Plus className="size-4" />{saving ? t("saving") : t("create")}
              </Button>
              <p className="text-xs leading-5 text-muted-foreground">{t("authorityNote")}</p>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
