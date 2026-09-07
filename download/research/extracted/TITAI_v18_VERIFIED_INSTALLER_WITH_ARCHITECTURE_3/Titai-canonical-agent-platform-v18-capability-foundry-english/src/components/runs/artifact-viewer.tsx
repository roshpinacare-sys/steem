"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import Markdown from "react-markdown";
import { FileText, Download, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { Artifact } from "@/lib/db/schema";

export function ArtifactViewer({ artifacts }: { artifacts: Artifact[] }) {
  const t = useTranslations();
  const [selected, setSelected] = React.useState<string | null>(
    artifacts[0]?.id ?? null,
  );

  if (artifacts.length === 0) {
    return (
      <EmptyState icon={<FileText />} title={t("runs.noArtifacts")} />
    );
  }

  const current = artifacts.find((a) => a.id === selected) ?? artifacts[0];

  function download(a: Artifact) {
    const blob = new Blob([a.content], {
      type: a.kind === "json" ? "application/json" : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <ul className="space-y-1">
        {artifacts.map((a) => (
          <li key={a.id}>
            <button
              onClick={() => setSelected(a.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm transition-colors",
                current.id === a.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <FileText className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <ChevronRight className="size-3.5 rtl:rotate-180" />
            </button>
          </li>
        ))}
      </ul>

      <div className="min-w-0 rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="font-mono text-xs text-muted-foreground">
            {current.name}
          </span>
          <button
            onClick={() => download(current)}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Download className="size-3.5" />
            {current.sizeBytes} B
          </button>
        </div>
        <div className="max-h-[60vh] overflow-auto p-4">
          {current.kind === "markdown" ? (
            <div className="prose-titai text-sm">
              <Markdown>{current.content}</Markdown>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
              {current.content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
