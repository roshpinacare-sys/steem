"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function useTheme() {
  const [theme, setThemeState] = React.useState<"dark" | "light">("dark");
  React.useEffect(() => {
    const stored = document.documentElement.dataset.theme;
    if (stored === "light" || stored === "dark") setThemeState(stored);
  }, []);
  const setTheme = React.useCallback((next: "dark" | "light") => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("titai-theme", next);
    } catch {
      /* ignore */
    }
    setThemeState(next);
    // Persist to the account in the background.
    fetch("/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => {});
  }, []);
  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const t = useTranslations();
  return (
    <button
      onClick={toggle}
      aria-label={t("nav.toggleTheme")}
      title={t("nav.toggleTheme")}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground",
        className,
      )}
    >
      {theme === "dark" ? (
        <Sun className="size-[18px]" />
      ) : (
        <Moon className="size-[18px]" />
      )}
    </button>
  );
}
