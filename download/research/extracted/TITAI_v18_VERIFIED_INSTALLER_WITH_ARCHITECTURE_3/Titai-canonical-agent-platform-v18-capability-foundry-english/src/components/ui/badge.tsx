import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-raised text-muted-foreground",
        primary:
          "border-transparent bg-primary/15 text-primary",
        outline: "border-border-strong text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

/**
 * A colored dot + label badge driven by a CSS variable color token.
 * Accessibility: always renders a text label, never color alone.
 */
export function DotBadge({
  color,
  label,
  className,
  pulse,
}: {
  color: string; // a --color-* token name, e.g. "status-running"
  label: string;
  className?: string;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", pulse && "animate-pulse")}
        style={{ backgroundColor: `var(--color-${color})` }}
      />
      <span style={{ color: `var(--color-${color})` }}>{label}</span>
    </span>
  );
}
