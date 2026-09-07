"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { toast } from "sonner";
import { Bot, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { PageHeader } from "@/components/shell/page-header";
import { TierBadge, TierDot } from "@/components/runs/badges";
import { TIERS } from "@/lib/constants";
import type { Agent } from "@/lib/db/schema";

export function AgentsList({ initial }: { initial: Agent[] }) {
  const t = useTranslations();
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") setCreateOpen(true);
  }, []);

  const { data } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await fetch("/api/agents")).json(),
    initialData: { agents: initial },
  });
  const agents: Agent[] = data?.agents ?? [];

  return (
    <>
      <PageHeader
        title={t("agents.title")}
        subtitle={t("agents.subtitle")}
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t("agents.create")}
          </Button>
        }
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={<Bot />}
          title={t("agents.empty")}
          action={
            <Button onClick={() => setCreateOpen(true)}>
              {t("agents.create")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="h-full p-4 transition-colors hover:bg-surface-hover">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-surface-raised">
                    <Bot className="size-5 text-muted-foreground" />
                  </div>
                  <TierBadge tier={agent.tier} />
                </div>
                <p className="font-display font-semibold text-foreground">
                  {agent.name}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {agent.description || "—"}
                </p>
                <div className="mt-3 flex items-center gap-1.5 text-xs text-subtle-foreground">
                  <TierDot tier={agent.tier} />
                  {t(`agents.status.${agent.status}`)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

function CreateAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        description: form.get("description"),
        tier: form.get("tier"),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(t("errors.generic"));
      return;
    }
    const body = await res.json();
    qc.invalidateQueries({ queryKey: ["agents"] });
    onClose();
    router.push(`/agents/${body.id}`);
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="create-agent-title">
      <ModalHeader id="create-agent-title" title={t("agents.create")} />
      <form onSubmit={submit}>
        <ModalBody className="space-y-3">
          <div>
            <Label htmlFor="name">{t("agents.editor.name")}</Label>
            <Input id="name" name="name" required autoFocus />
          </div>
          <div>
            <Label htmlFor="description">{t("agents.editor.description")}</Label>
            <Textarea id="description" name="description" rows={2} />
          </div>
          <div>
            <Label htmlFor="tier">{t("agents.tier")}</Label>
            <Select id="tier" name="tier" defaultValue="engineering">
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {t(`agents.tiers.${tier}`)}
                </option>
              ))}
            </Select>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {t("common.create")}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
