"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { toast } from "sonner";
import { Sparkles, Plus, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { PageHeader } from "@/components/shell/page-header";
import type { Skill } from "@/lib/db/schema";

export function SkillsList({ initial }: { initial: Skill[] }) {
  const t = useTranslations();
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") setCreateOpen(true);
  }, []);

  const { data } = useQuery({
    queryKey: ["skills"],
    queryFn: async () => (await fetch("/api/skills")).json(),
    initialData: { skills: initial },
  });
  const skills: Skill[] = data?.skills ?? [];

  return (
    <>
      <PageHeader
        title={t("skills.title")}
        subtitle={t("skills.subtitle")}
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t("skills.create")}
          </Button>
        }
      />
      {skills.length === 0 ? (
        <EmptyState
          icon={<Sparkles />}
          title={t("skills.empty")}
          action={<Button onClick={() => setCreateOpen(true)}>{t("skills.create")}</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <Link key={skill.id} href={`/skills/${skill.id}`}>
              <Card className="h-full p-4 transition-colors hover:bg-surface-hover">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <Sparkles className="size-5" />
                  </div>
                  {skill.isBuiltin ? (
                    <Badge variant="outline">
                      <Lock className="size-3" />
                      {t("skills.builtin")}
                    </Badge>
                  ) : (
                    <Badge>{t("skills.custom")}</Badge>
                  )}
                </div>
                <p className="font-display font-semibold text-foreground">{skill.name}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {skill.description}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <CreateSkillModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

function CreateSkillModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        description: form.get("description"),
        body: form.get("body"),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(t("skills.editor.invalidFrontmatter"));
      return;
    }
    const b = await res.json();
    qc.invalidateQueries({ queryKey: ["skills"] });
    onClose();
    router.push(`/skills/${b.id}`);
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="create-skill-title">
      <ModalHeader id="create-skill-title" title={t("skills.create")} />
      <form onSubmit={submit}>
        <ModalBody className="space-y-3">
          <div>
            <Label htmlFor="sname">{t("skills.editor.name")}</Label>
            <Input id="sname" name="name" required autoFocus />
          </div>
          <div>
            <Label htmlFor="sdesc">{t("skills.editor.description")}</Label>
            <Textarea id="sdesc" name="description" rows={2} required />
            <p className="mt-1 text-xs text-subtle-foreground">
              {t("skills.editor.descriptionHint")}
            </p>
          </div>
          <div>
            <Label htmlFor="sbody">{t("skills.editor.body")}</Label>
            <Textarea id="sbody" name="body" rows={4} className="font-mono text-xs" />
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
