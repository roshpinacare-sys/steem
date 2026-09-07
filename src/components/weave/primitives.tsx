"use client";

/**
 * primitives — אבני-היסוד של הנול.
 * HashText · Panel · SectionHead · Stat · LiveDot · OpChip · Spinner · EmptyState
 */

import { useState } from "react";
import { Check, Copy, Loader2, WifiOff, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/* ── hash — מונו LTR עם קיצור-אמצע והעתקה ── */
export function HashText({
  h,
  head = 12,
  tail = 10,
  className,
  copy = true,
  mono = true,
}: {
  h: string | null | undefined;
  head?: number;
  tail?: number;
  className?: string;
  copy?: boolean;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!h) return <span className={cn("text-ink-2", className)}>—</span>;
  const display = h.length > head + tail + 1 ? h.slice(0, head) + "…" + h.slice(-tail) : h;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 max-w-full", mono && "hash text-[0.92em]", className)}
      dir="ltr"
    >
      <span className="truncate" title={h}>{display}</span>
      {copy && (
        <button
          type="button"
          aria-label="העתקת-hash"
          className="shrink-0 text-gold-dim hover:text-gold transition-colors"
          onClick={() => {
            navigator.clipboard?.writeText(h).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </span>
  );
}

/* ── פאנל-זכוכית-חמה ── */
export function Panel({
  className,
  children,
  glow,
}: {
  className?: string;
  children: React.ReactNode;
  glow?: boolean;
}) {
  return <div className={cn("panel p-5 md:p-6", glow && "panel-glow", className)}>{children}</div>;
}

/* ── כותרת-מקטע ── */
export function SectionHead({
  eyebrow,
  title,
  desc,
  icon,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-6 md:mb-8">
      <div className="flex items-center gap-2 text-gold-dim text-xs font-medium tracking-wide mb-2">
        {icon}
        <span className="hash uppercase">{eyebrow}</span>
        <span className="h-px flex-1 bg-gradient-to-l from-gold/25 to-transparent" aria-hidden />
      </div>
      <h2 className="font-display text-2xl md:text-3xl font-bold text-ink">{title}</h2>
      {desc && <p className="mt-2 text-sm text-ink-2 max-w-2xl leading-relaxed">{desc}</p>}
    </div>
  );
}

/* ── מדד-חי ── */
export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="panel px-4 py-3.5 min-w-0">
      <div className="text-[11px] text-ink-2 mb-1 truncate">{label}</div>
      <div
        className={cn(
          "metric-value text-xl md:text-2xl font-bold leading-none",
          accent ? "text-gold root-glow" : "text-ink"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-ink-2 mt-1.5 truncate">{sub}</div>}
    </div>
  );
}

/* ── נקודה-חיה ── */
export function LiveDot({ tone = "gold", className }: { tone?: "gold" | "green" | "rose" | "gray"; className?: string }) {
  const color =
    tone === "gold"
      ? "text-gold bg-gold"
      : tone === "green"
        ? "text-verified bg-verified"
        : tone === "rose"
          ? "text-broken bg-broken"
          : "text-ink-2 bg-ink-2";
  return <span className={cn("live-dot", color, className)} aria-hidden />;
}

/* ── צ'יפ-אופ ── */
const OP_TONES: Record<string, string> = {
  stamp: "bg-gold/10 text-gold border-gold/25",
  seal: "bg-gold/20 text-gold-soft border-gold/40",
  witness: "bg-verified/10 text-verified border-verified/25",
  heartbeat: "bg-muted text-ink-2 border-border",
  checkpoint: "bg-verified/10 text-verified border-verified/25",
  attest: "bg-accent text-accent-foreground border-border",
};
export function OpChip({ op, n }: { op: string; n?: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium hash",
        OP_TONES[op] || "bg-muted text-ink-2 border-border"
      )}
    >
      {op}
      {n !== undefined && n > 0 ? ` ×${n}` : ""}
    </span>
  );
}

/* ── טוען ── */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-gold-dim", className)} aria-label="טוען" />;
}

/* ── מצב-ריק כנה ── */
export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="text-center py-10 px-4 border border-dashed border-border rounded-xl">
      <div className="text-sm text-ink-2 font-medium">{title}</div>
      {sub && <div className="text-xs text-ink-2/70 mt-1.5">{sub}</div>}
    </div>
  );
}

/* ── מצב-שגיאה כן — שגיאה אף-פעם לא מתחפשת לריק ── */
export function ErrorState({
  title = "שגיאת-תקשורת עם הצומת",
  sub = "הספר עצמו לא נפגע — רק התצוגה. אפשר לנסות שוב.",
  detail,
  onRetry,
}: {
  title?: string;
  sub?: string;
  detail?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="text-center py-10 px-4 border border-broken/30 bg-broken/[0.03] rounded-xl" role="alert">
      <WifiOff className="size-6 mx-auto mb-3 text-broken/70" aria-hidden />
      <div className="text-sm text-ink font-medium">{title}</div>
      <div className="text-xs text-ink-2/80 mt-1.5 max-w-md mx-auto leading-relaxed">{sub}</div>
      {detail && <div className="hash text-[10px] text-ink-2/50 mt-2" dir="ltr">{detail}</div>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-xs font-bold text-gold hover:bg-gold/15 transition-colors"
        >
          <RefreshCw className="size-3.5" /> נסה שוב
        </button>
      )}
    </div>
  );
}

/* ── Tip — tooltip נגיש (מקלדת + מגע) במקום title ── */
export function Tip({ label, children, side = "bottom" }: { label: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} dir="rtl" className="max-w-72 bg-[#1c1710] text-ink border border-gold/20 text-[11px] leading-relaxed">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/* ── זמן-קצר ── */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}
