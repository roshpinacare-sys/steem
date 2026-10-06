"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Shared UI - תוויות אמת, צ'יפים ל-hash, תגיות סטטוס,
// סקלטונים, אנימציות עדינות וסקרולבר מעוצב.
// סמנטיקה: emerald=VERIFIED/REAL · rose=REFUTED/שבר · amber=UNMEASURED/LOCAL · zinc=NOT-YET
// ─────────────────────────────────────────────────────────────────────

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  CircleDashed,
  Compass,
  Copy,
  Hammer,
  HelpCircle,
  Radio,
  RotateCw,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TruthLabel as TruthKind } from "@/lib/weave/types";

// ── עזרי טקסט ────────────────────────────────────────────────────────

export function truncateMiddle(value: string, head = 10, tail = 8): string {
  if (!value) return "";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function truncateEnd(value: string, max = 64): string {
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── סקרולבר מעוצב לרשימות ארוכות ─────────────────────────────────────

export const scrollBoxClass = cn(
  "max-h-96 overflow-auto overscroll-contain rounded-lg",
  "[scrollbar-width:thin] [scrollbar-color:rgba(113,113,122,0.45)_transparent]",
  "[&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar]:h-2.5",
  "[&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-500/40",
  "hover:[&::-webkit-scrollbar-thumb]:bg-zinc-500/60"
);

// ── העתקה ────────────────────────────────────────────────────────────

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // נופל ל-fallback
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const onCopy = async () => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      toast.success(label ? `${label} הועתק ללוח` : "הועתק ללוח");
      window.setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error("ההעתקה נכשלה");
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-8 shrink-0 text-muted-foreground hover:text-foreground", className)}
      onClick={onCopy}
      aria-label={label ? `העתק ${label}` : "העתק"}
    >
      {copied ? <Check className="text-emerald-500" /> : <Copy />}
    </Button>
  );
}

// ── HashChip - mono, קטוע באמצע, עם tooltip והעתקה ───────────────────

export function HashChip({
  value,
  label,
  head = 10,
  tail = 8,
  className,
  copy = true,
}: {
  value: string | null | undefined;
  label?: string;
  head?: number;
  tail?: number;
  className?: string;
  copy?: boolean;
}) {
  if (!value) {
    return (
      <span dir="ltr" className={cn("font-mono text-xs text-muted-foreground", className)}>
        -
      </span>
    );
  }
  const short = truncateMiddle(value, head, tail);
  return (
    <span
      dir="ltr"
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5",
        className
      )}
    >
      {label ? (
        <span className="shrink-0 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help truncate font-mono text-xs leading-none text-foreground select-all">
            {short}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" dir="ltr" className="max-w-[360px] break-all font-mono text-[11px]">
          {value}
        </TooltipContent>
      </Tooltip>
      {copy ? <CopyButton value={value} className="size-6" /> : null}
    </span>
  );
}

// ── TruthLabel - תווית אמת מוצהרת ──────────────────────────────────

const TRUTH_META: Record<TruthKind, { tooltip: string; badge: string }> = {
  REAL: {
    tooltip: "קריפטוגרפיה תקנית אמיתית רצה כאן",
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  LOCAL: {
    tooltip: "אחסון מקומי בסנדבוקס (SQLite)",
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  "NOT-YET": {
    tooltip: "מוכן אך נעול מאחורי שער - טרם בוצע",
    badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
  },
};

export function TruthLabel({
  kind,
  className,
  compact = false,
}: {
  kind: TruthKind;
  className?: string;
  compact?: boolean;
}) {
  const meta = TRUTH_META[kind];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          dir="ltr"
          className={cn(
            "cursor-help font-mono",
            compact && "px-1.5 text-[10px]",
            meta.badge,
            className
          )}
        >
          {kind}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{meta.tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── StatusBadge - סטטוס אימות ───────────────────────────────────

const STATUS_META: Record<string, { icon: LucideIcon; badge: string }> = {
  VERIFIED: {
    icon: CheckCircle2,
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  REFUTED: {
    icon: XCircle,
    badge: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
  UNMEASURED: {
    icon: CircleDashed,
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  CONTESTED: {
    icon: AlertTriangle,
    badge: "border-rose-500/40 bg-transparent text-rose-700 dark:text-rose-400",
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const meta =
    STATUS_META[status] ?? {
      icon: HelpCircle,
      badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
    };
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      dir="ltr"
      className={cn("gap-1 font-mono", meta.badge, className)}
    >
      <Icon className="size-3" />
      {status}
    </Badge>
  );
}

// ── ClaimTypeBadge - סוג טענה (מונח טכני, mono) ─────────────────

export function ClaimTypeBadge({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      dir="ltr"
      className={cn("font-mono text-[11px] tracking-tight", className)}
    >
      {type}
    </Badge>
  );
}

// ── תפקידי סוכנים ────────────────────────────────────────────────────

export const AGENT_ROLES = ["AUDITOR", "SCOUT", "BUILDER", "DAEMON", "RELAYER"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const ROLE_META: Record<string, { icon: LucideIcon; badge: string; hint: string }> = {
  AUDITOR: {
    icon: ShieldCheck,
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    hint: "מבקר - חותם אימותי AUDIT",
  },
  SCOUT: {
    icon: Compass,
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    hint: "סייר - מודד ומדווח מדידות",
  },
  BUILDER: {
    icon: Hammer,
    badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
    hint: "בונה - אחראי על BUILD",
  },
  DAEMON: {
    icon: Bot,
    badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
    hint: "דמון רקע - אוטומציה ותחזוקה",
  },
  RELAYER: {
    icon: Radio,
    badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
    hint: "ממסר - העברת עוגנים לשרשרת",
  },
};

export function RoleBadge({ role, className }: { role: string; className?: string }) {
  const meta =
    ROLE_META[role] ?? {
      icon: Bot,
      badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
      hint: role,
    };
  const Icon = meta.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          dir="ltr"
          className={cn("cursor-help gap-1 font-mono", meta.badge, className)}
        >
          <Icon className="size-3" />
          {role}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{meta.hint}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function RoleIcon({ role, className }: { role: string; className?: string }) {
  const meta = ROLE_META[role] ?? ROLE_META.DAEMON;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/60 text-muted-foreground [&_svg]:size-5",
        className
      )}
    >
      <Icon />
    </span>
  );
}

// ── שטיפת-גרדיאנט לאזורי-כותרת — עומק עדין במשפחת הקונסולה בלבד ────

export function PageWash({ className = "inset-0" }: { className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute -z-10 bg-gradient-to-l from-emerald-500/[0.08] via-emerald-500/[0.02] to-transparent",
        className
      )}
      aria-hidden="true"
    />
  );
}

// ── מצב-ריק כנה — אף רשימה לא נשארת שקטה-מוזרה ─────────────────────

export function EmptyState({
  icon: Icon,
  title,
  hint,
  term,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  term?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center",
        className
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground" aria-hidden="true">
        <Icon className="size-4" />
      </span>
      <p className="text-sm font-medium text-foreground/90">{title}</p>
      {hint ? <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      {term ? (
        <p className="font-mono text-[10px] tracking-wide text-muted-foreground/70" dir="ltr">
          {term}
        </p>
      ) : null}
    </div>
  );
}

// ── Section - כותרת מקטע עם אייקון ופעולה ────────────────────────

export function Section({
  title,
  description,
  icon,
  action,
  children,
  className,
  wash = false,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  wash?: boolean;
}) {
  return (
    // overflow-x-clip: שטיפת-העומק בולטת 16px מעבר לקופסה מטעמי-עיצוב —
    // הקליפ מבטיח שהיא לעולם לא תיצור דימום-אופקי ברמת-המסמך (RTL phantom bleed).
    <section className={cn("flex flex-col gap-4", wash && "relative isolate overflow-x-clip", className)}>
      {wash ? <PageWash className="-inset-x-4 -inset-y-3 rounded-2xl" /> : null}
      <div className="flex flex-wrap items-center gap-3">
        {icon ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight sm:text-lg">{title}</h2>
          {description ? (
            <p className="text-xs text-muted-foreground sm:text-sm">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

// ── אנימציות עדינות ──────────────────────────────────────────────────

export function FadeIn({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function MotionCard({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Card>) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      whileHover={reduced ? undefined : { scale: 1.008, y: -2 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="h-full min-w-0"
    >
      <Card
        className={cn(
          "h-full transition-[border-color,box-shadow] duration-200",
          !reduced && "hover:border-emerald-500/30 hover:shadow-md hover:shadow-emerald-950/10",
          className
        )}
        {...props}
      >
        {children}
      </Card>
    </motion.div>
  );
}

// ── ErrorBox - שגיאה ברורה עם ניסיון חוזר ───────────────────────

export function ErrorBox({
  message,
  onRetry,
  retrying = false,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>שגיאה בטעינת הנתונים</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>{message}</span>
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={retrying}
            className="h-11 border-rose-500/40 text-rose-600 dark:text-rose-400"
          >
            <RotateCw className={cn(retrying && "animate-spin")} />
            נסה שוב
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

// ── סקלטונים ─────────────────────────────────────────────────────────

export function KpiSkeletonRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-4 sm:p-6">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-8 w-16" />
          <Skeleton className="mt-4 h-4 w-32" />
        </Card>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
          <Skeleton className="size-9 rounded-lg" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex gap-3 border-b bg-muted/50 p-3">
        {["w-10", "w-24", "flex-1", "w-16", "w-24"].map((w, i) => (
          <Skeleton key={i} className={cn("h-3.5", w)} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 border-b p-3">
          {["w-10", "w-24", "flex-1", "w-16", "w-24"].map((w, j) => (
            <Skeleton key={j} className={cn("h-4", w)} />
          ))}
        </div>
      ))}
    </div>
  );
}
