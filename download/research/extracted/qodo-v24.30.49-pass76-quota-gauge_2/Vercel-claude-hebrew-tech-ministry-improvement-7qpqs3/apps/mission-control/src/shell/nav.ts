/**
 * shell/nav.ts — the platform shell's navigation model.
 *
 * Every destination maps to a REAL capability the agent exposes through
 * telemetry (see utils/phase-meta.ts) or the proxy — no aspirational pages.
 * Grouped so the rail reads as "operate the run / inspect the system / tools".
 */
import type { IconName } from "./icons.js";

export type PageId =
  | "chat"
  | "studio"
  | "files"
  | "tasks"
  | "overview"
  | "activity"
  | "runs"
  | "pipeline"
  | "insights"
  | "ministry"
  | "safety"
  | "cost"
  | "automations"
  | "governance"
  | "connections"
  | "releases"
  | "docs"
  | "settings";

export interface NavItem {
  id: PageId;
  label: string;
  icon: IconName;
  /** One-line description shown in the top bar + command palette. */
  blurb: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Build",
    items: [
      { id: "chat", label: "Chat", icon: "chat", blurb: "Talk to your operations — run commands or chat with your own AI model." },
      { id: "studio", label: "Studio", icon: "studio", blurb: "An in-browser dev environment — create, write, run, install, preview, and build." },
      { id: "files", label: "Files", icon: "files", blurb: "Browse, view, edit, upload, and download — real files in your repository." },
    ],
  },
  {
    label: "Operate",
    items: [
      { id: "tasks", label: "Tasks", icon: "tasks", blurb: "Launch delivery tasks and watch many run in parallel." },
      { id: "overview", label: "Overview", icon: "overview", blurb: "System state, current mission, and live vitals at a glance." },
      { id: "activity", label: "Activity", icon: "activity", blurb: "The live decision stream from every agent, newest first." },
      { id: "runs", label: "Runs", icon: "runs", blurb: "Every delivery run, with status, progress, and cost." },
      { id: "pipeline", label: "Pipeline", icon: "pipeline", blurb: "The nine-phase delivery pipeline for the current run." },
      { id: "insights", label: "Insights", icon: "insights", blurb: "Success rates, durations, and failure hotspots across recent runs." },
    ],
  },
  {
    label: "System",
    items: [
      { id: "ministry", label: "Agents", icon: "agents", blurb: "The full agent ministry, grouped by role, with live activity." },
      { id: "safety", label: "Safety", icon: "safety", blurb: "Gates, guards, drift, and mentor approvals protecting each run." },
      { id: "cost", label: "Cost", icon: "cost", blurb: "LLM spend and token usage, by run and by model." },
      { id: "automations", label: "Automations", icon: "automations", blurb: "Autonomous agent modes, the resume queue, and the edge-test executor." },
      { id: "governance", label: "Governance", icon: "governance", blurb: "The repository's agent policy — budget, autonomy, approval — plus every CLI mode." },
      { id: "connections", label: "Connections", icon: "connections", blurb: "Verify every connection and integration — live checks and the full catalog." },
    ],
  },
  {
    label: "Resources",
    items: [
      { id: "releases", label: "Releases", icon: "releases", blurb: "Releases and CI artifacts — including the Android APK — with real downloads." },
      { id: "docs", label: "Docs", icon: "docs", blurb: "The repository's guides and ADRs, rendered on-device." },
    ],
  },
  {
    label: "Settings",
    items: [
      { id: "settings", label: "Settings", icon: "settings", blurb: "Data mode, connection, autonomy, and refresh cadence." },
    ],
  },
];

/** Flattened lookup for routing + top-bar/palette metadata. */
export const NAV_ITEMS: Record<PageId, NavItem> = Object.fromEntries(
  NAV.flatMap((g) => g.items).map((i) => [i.id, i]),
) as Record<PageId, NavItem>;
