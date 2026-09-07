"use client";

import * as React from "react";
import Markdown from "react-markdown";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Save, Trash2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import type { Skill, SkillVersion } from "@/lib/db/schema";

export function SkillEditor({
  skill,
  versions,
}: {
  skill: Skill;
  versions: SkillVersion[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const current = versions[0];
  const readOnly = skill.isBuiltin;

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [body, setBody] = React.useState(current?.body ?? "");
  const [saving, setSaving] = React.useState(false);
  const [tab, setTab] = React.useState("edit");

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/skills/${skill.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description, body }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("skills.editor.invalidFrontmatter"));
      return;
    }
    const b = await res.json();
    toast.success(t("skills.editor.saved", { n: b.version }));
    router.refresh();
  }

  async function remove() {
    if (!confirm(`${t("common.delete")}: ${skill.name}?`)) return;
    await fetch(`/api/skills/${skill.id}`, { method: "DELETE" });
    router.push("/skills");
  }

  return (
    <>
      <PageHeader
        title={skill.name}
        subtitle={t("skills.subtitle")}
        action={
          readOnly ? (
            <Badge variant="outline">
              <Lock className="size-3" />
              {t("skills.builtin")}
            </Badge>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={remove} aria-label={t("common.delete")}>
                <Trash2 className="size-4" />
              </Button>
              <Button onClick={save} disabled={saving}>
                <Save className="size-4" />
                {t("common.save")}
              </Button>
            </div>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="space-y-3">
            <div>
              <Label htmlFor="name">{t("skills.editor.name")}</Label>
              <Input id="name" value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="desc">{t("skills.editor.description")}</Label>
              <Textarea
                id="desc"
                rows={2}
                value={description}
                disabled={readOnly}
                onChange={(e) => setDescription(e.target.value)}
              />
              <p className="mt-1 text-xs text-subtle-foreground">
                {t("skills.editor.descriptionHint")}
              </p>
            </div>
            <div>
              <Label htmlFor="body">{t("skills.editor.body")}</Label>
              <Textarea
                id="body"
                rows={14}
                value={body}
                disabled={readOnly}
                onChange={(e) => setBody(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-3">
              <TabsTrigger value="edit">{t("skills.editor.preview")}</TabsTrigger>
              <TabsTrigger value="raw">{t("skills.editor.raw")}</TabsTrigger>
            </TabsList>
            <TabsContent value="edit">
              <div className="prose-titai min-h-40 text-sm">
                <h3>{name}</h3>
                <p className="text-muted-foreground">{description}</p>
                <hr className="my-3 border-border" />
                <Markdown>{body || "_No instructions yet._"}</Markdown>
              </div>
            </TabsContent>
            <TabsContent value="raw">
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 font-mono text-xs">
                {current?.raw ?? ""}
              </pre>
            </TabsContent>
          </Tabs>
          <p className="mt-4 text-xs text-subtle-foreground">
            {versions.length} version{versions.length === 1 ? "" : "s"}
          </p>
        </Card>
      </div>
    </>
  );
}
