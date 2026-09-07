import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

/** Coerce a Date | epoch-ms number | ISO string (from JSON) to epoch ms. */
export function toMs(
  date: Date | number | string | null | undefined,
): number | null {
  if (date == null) return null;
  if (typeof date === "number") return date;
  if (typeof date === "string") {
    const ts = Date.parse(date);
    return Number.isNaN(ts) ? null : ts;
  }
  return date.getTime();
}

/**
 * Locale-aware relative time (for example, "19h ago").
 * Falls back to a localized date once past ~30 days.
 */
export function formatRelativeTime(
  date: Date | number | string | null | undefined,
  locale = "en",
): string {
  const ts = toMs(date);
  if (ts == null) return "—";
  const diffSec = Math.round((ts - Date.now()) / 1000); // negative = past
  const abs = Math.abs(diffSec);

  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  } catch {
    rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });
  }

  if (abs < 60) return rtf.format(Math.trunc(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.trunc(diffSec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.trunc(diffSec / 3600), "hour");
  if (abs < 2_592_000) return rtf.format(Math.trunc(diffSec / 86_400), "day");
  try {
    return new Date(ts).toLocaleDateString(locale);
  } catch {
    return new Date(ts).toLocaleDateString();
  }
}

/** Safe elapsed-time formatter between two date-ish values (handles JSON strings). */
export function durationBetween(
  start: Date | number | string | null | undefined,
  end: Date | number | string | null | undefined,
): string {
  const a = toMs(start);
  const b = toMs(end);
  if (a == null || b == null) return "—";
  return formatDuration(b - a);
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + "…";
}

/** Stable, key-sorted JSON — used for audit hashing and comparisons. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "untitled";
}
