"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · EVM UI bits - אבנים משותפות להרחבות ה-EVM בטאבים
// CheckRow (OK/FAIL), Stepper לזרימות צעדים, ועזרת העתקה עם טוסט.
// סמנטיקה: emerald=תקין/הצלחה · rose=כשל/דחייה · amber=LOCAL · zinc=NOT-YET
// ─────────────────────────────────────────────────────────────────────

import type * as React from "react";
import { toast } from "sonner";
import { Check, CheckCircle2, Copy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── CheckRow - שורת בדיקה עם emerald תקין / rose כשל ─────────────────────

export function CheckRow({
  ok,
  label,
  hint,
  className,
}: {
  ok: boolean;
  label: string;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-2.5 rounded-lg border p-3",
        ok ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "border-rose-500/40 bg-rose-500/[0.05]",
        className
      )}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug">{label}</p>
        {hint ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </li>
  );
}

// ── Stepper - מצביע צעדים ויזואלי פשוט ──────────────────────────────

export function Stepper({
  steps,
  current,
  className,
}: {
  steps: { label: string }[];
  current: number; // 1-based; current > steps.length => הכל הושלם
  className?: string;
}) {
  return (
    <ol dir="rtl" className={cn("flex items-center gap-1.5", className)}>
      {steps.map((step, i) => {
        const n = i + 1;
        const done = n < current || current > steps.length;
        const active = n === current && current <= steps.length;
        return (
          <li key={n} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold",
                done
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : active
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    : "border-zinc-500/30 bg-muted/40 text-zinc-500 dark:text-zinc-400"
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="size-3.5" /> : n}
            </span>
            <span
              className={cn(
                "hidden truncate text-xs sm:inline",
                active ? "font-semibold text-foreground" : "text-muted-foreground"
              )}
            >
              {step.label}
            </span>
            {n < steps.length ? (
              <span
                aria-hidden
                className={cn(
                  "h-px flex-1",
                  done ? "bg-emerald-500/40" : "bg-border"
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ── עזרת העתקה עם טוסט ──────────────────────────────────────────────

export async function copyWithToast(text: string, label: string): Promise<boolean> {
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      ok = document.execCommand("copy");
      document.body.removeChild(el);
    } catch {
      ok = false;
    }
  }
  if (ok) {
    toast.success(`${label} הועתק ללוח`);
  } else {
    toast.error("ההעתקה נכשלה");
  }
  return ok;
}

// ── LabeledCopyButton - כפתור עם אייקון + טקסט + העתקה ──────────────

export function LabeledCopyButton({
  value,
  label,
  className,
  disabled,
}: {
  value: string;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn("h-11", className)}
      onClick={() => void copyWithToast(value, label)}
      disabled={disabled}
      aria-label={`העתק ${label}`}
    >
      <Copy />
      {label}
    </Button>
  );
}
