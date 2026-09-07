"use client";

import * as React from "react";
import { Command } from "cmdk";
import { createPortal } from "react-dom";
import {
  LayoutDashboard,
  Bot,
  Play,
  Sparkles,
  LibraryBig,
  Settings,
  Rocket,
  Moon,
  Languages,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useRouter, usePathname } from "@/i18n/navigation";
import { usePaletteStore } from "@/stores/palette";
import { useTheme } from "@/components/shell/theme-toggle";
import { routing } from "@/i18n/routing";
import { truncate } from "@/lib/utils";
import type { Agent, Skill, Run } from "@/lib/db/schema";

export function CommandPalette() {
  const { isOpen, close, toggle } = usePaletteStore();
  const [mounted, setMounted] = React.useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations();
  const { toggle: toggleTheme } = useTheme();

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Entity search data — fetched only while the palette is open.
  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await fetch("/api/agents")).json(),
    enabled: isOpen,
    staleTime: 30_000,
  });
  const { data: skillsData } = useQuery({
    queryKey: ["skills"],
    queryFn: async () => (await fetch("/api/skills")).json(),
    enabled: isOpen,
    staleTime: 30_000,
  });
  const { data: runsData } = useQuery({
    queryKey: ["runs-list"],
    queryFn: async () => (await fetch("/api/runs")).json(),
    enabled: isOpen,
    staleTime: 15_000,
  });
  const agents: Agent[] = agentsData?.agents ?? [];
  const skills: Skill[] = skillsData?.skills ?? [];
  const runs: Run[] = (runsData?.runs ?? []).slice(0, 8);

  const go = (href: string) => {
    close();
    router.push(href);
  };

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <Command
        loop
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-fade-up"
      >
        <Command.Input
          autoFocus
          placeholder={t("palette.placeholder")}
          className="w-full border-b border-border bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-subtle-foreground"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("palette.noResults")}
          </Command.Empty>

          <Command.Group
            heading={t("palette.navigate")}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle-foreground"
          >
            <PaletteItem icon={LayoutDashboard} label={t("nav.missions")} onSelect={() => go("/")} />
            <PaletteItem icon={Bot} label={t("nav.agents")} onSelect={() => go("/agents")} />
            <PaletteItem icon={Play} label={t("nav.runs")} onSelect={() => go("/runs")} />
            <PaletteItem icon={Sparkles} label={t("nav.skills")} onSelect={() => go("/skills")} />
            <PaletteItem icon={LibraryBig} label={t("nav.library")} onSelect={() => go("/library")} />
            <PaletteItem icon={Settings} label={t("nav.settings")} onSelect={() => go("/settings")} />
          </Command.Group>

          {agents.length > 0 && (
            <Command.Group
              heading={t("palette.agents")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle-foreground"
            >
              {agents.map((a) => (
                <PaletteItem
                  key={a.id}
                  icon={Bot}
                  label={a.name}
                  onSelect={() => go(`/agents/${a.id}`)}
                />
              ))}
            </Command.Group>
          )}

          {skills.length > 0 && (
            <Command.Group
              heading={t("palette.skills")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle-foreground"
            >
              {skills.map((s) => (
                <PaletteItem
                  key={s.id}
                  icon={Sparkles}
                  label={s.name}
                  onSelect={() => go(`/skills/${s.id}`)}
                />
              ))}
            </Command.Group>
          )}

          {runs.length > 0 && (
            <Command.Group
              heading={t("palette.runs")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle-foreground"
            >
              {runs.map((r) => (
                <PaletteItem
                  key={r.id}
                  icon={Play}
                  label={truncate(r.objective, 56)}
                  onSelect={() => go(`/runs/${r.id}`)}
                />
              ))}
            </Command.Group>
          )}

          <Command.Group
            heading={t("palette.actions")}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle-foreground"
          >
            <PaletteItem
              icon={Rocket}
              label={t("palette.launchRun")}
              onSelect={() => go("/?launch=1")}
            />
            <PaletteItem
              icon={Bot}
              label={t("palette.newAgent")}
              onSelect={() => go("/agents?new=1")}
            />
            <PaletteItem
              icon={Sparkles}
              label={t("palette.newSkill")}
              onSelect={() => go("/skills?new=1")}
            />
            <PaletteItem
              icon={Moon}
              label={t("palette.toggleTheme")}
              onSelect={() => {
                toggleTheme();
                close();
              }}
            />
            <PaletteItem
              icon={Languages}
              label={t("palette.switchLanguage")}
              onSelect={() => {
                const next = routing.locales.find((l) => l !== locale) ?? "en";
                close();
                router.replace(pathname, { locale: next });
              }}
            />
          </Command.Group>
        </Command.List>
      </Command>
    </div>,
    document.body,
  );
}

function PaletteItem({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground data-[selected=true]:bg-surface-hover"
    >
      <Icon className="size-4 text-muted-foreground" />
      {label}
    </Command.Item>
  );
}
