"use client";

import * as React from "react";
import { Sparkles, Command, LogOut, ShieldCheck } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { NAV_ITEMS } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";
import { usePaletteStore } from "@/stores/palette";
import { CommandPalette } from "@/components/palette/command-palette";

interface ShellUser {
  name: string;
  email: string;
  role: string;
}

function useActive(href: string) {
  const pathname = usePathname();
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function NavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const active = useActive(href);
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/12 text-primary"
          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <Icon className="size-[18px] shrink-0" />
      <span>{label}</span>
    </Link>
  );
}

function Sidebar({ user }: { user: ShellUser }) {
  const t = useTranslations();
  const openPalette = usePaletteStore((s) => s.open);
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-e border-border bg-surface/60 md:flex">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="size-[18px]" />
        </div>
        <span className="font-display text-lg font-bold tracking-tight">
          {t("app.name")}
        </span>
      </div>

      <button
        onClick={openPalette}
        className="mx-3 mb-2 flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted-foreground hover:bg-surface-hover"
      >
        <span className="flex items-center gap-2">
          <Command className="size-4" />
          {t("common.search")}
        </span>
        <kbd className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={t(`nav.${item.labelKey}`)}
            icon={item.icon}
          />
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="mb-2 flex items-center gap-2 px-1">
          <div className="flex size-8 items-center justify-center rounded-full bg-surface-raised text-xs font-semibold uppercase text-muted-foreground">
            {user.name.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          {user.role === "admin" && (
            <ShieldCheck className="size-4 text-primary" aria-label="admin" />
          )}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
        >
          <LogOut className="size-4" />
          {t("nav.signOut")}
        </button>
      </div>
    </aside>
  );
}

function TopBar() {
  const t = useTranslations();
  const openPalette = usePaletteStore((s) => s.open);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2 md:hidden">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="size-4" />
        </div>
        <span className="font-display font-bold">{t("app.name")}</span>
      </div>
      <div className="hidden md:block" />
      <div className="flex items-center gap-1.5">
        <button
          onClick={openPalette}
          aria-label={t("nav.commandPalette")}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground md:hidden"
        >
          <Command className="size-[18px]" />
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}

function BottomTabs() {
  const t = useTranslations();
  const items = NAV_ITEMS.filter((i) => i.mobile);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="Primary"
    >
      {items.map((item) => (
        <BottomTab
          key={item.href}
          href={item.href}
          label={t(`nav.${item.labelKey}`)}
          icon={item.icon}
        />
      ))}
    </nav>
  );
}

function BottomTab({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const active = useActive(href);
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="size-5" />
      <span>{label}</span>
    </Link>
  );
}

export function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 px-4 pb-24 pt-5 sm:px-6 md:pb-8 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <BottomTabs />
      <CommandPalette />
    </div>
  );
}
