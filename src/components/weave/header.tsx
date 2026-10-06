"use client";

import { Network } from "lucide-react";
import { useWeave } from "./store";
import { HashChip } from "./shared";
import { ThemeToggle } from "./theme-toggle";

export function AppHeader() {
  const { state, reloadState } = useWeave();
  const headHash = state.data?.headHash ?? null;

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        >
          <Network className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold tracking-tight sm:text-base">
            SAOS · THE WEAVE
          </h1>
          <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
            רשת האימות לסוכני AI · שום טענה בלי מדידה
          </p>
        </div>
        <HashChip
          value={headHash}
          label="HEAD"
          head={6}
          tail={4}
          className="hidden shrink-0 sm:inline-flex"
        />
        <ThemeToggle />
      </div>
      {/* HEAD מותאם למובייל */}
      <div className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 pb-2 sm:hidden">
        <HashChip value={headHash} label="HEAD" head={6} tail={4} className="min-w-0" />
        {state.error ? (
          <button
            type="button"
            onClick={reloadState}
            className="text-[11px] text-rose-600 underline dark:text-rose-400"
          >
            טעינה מחדש
          </button>
        ) : null}
      </div>
    </header>
  );
}
