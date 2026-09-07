import type { RunStatus, AgentTier, RiskLevel } from "@/lib/db/schema";
import type { ProviderName } from "@/lib/engine/types";

/** Maps a run status to its color token and the i18n key under runs.stage.* */
export const RUN_STATUS_META: Record<
  RunStatus,
  { color: string; stageKey: string; pulse?: boolean }
> = {
  queued: { color: "status-queued", stageKey: "queued" },
  running: { color: "status-running", stageKey: "running", pulse: true },
  awaiting_approval: {
    color: "status-awaiting",
    stageKey: "awaiting",
    pulse: true,
  },
  completed: { color: "status-completed", stageKey: "completed" },
  failed: { color: "status-failed", stageKey: "failed" },
  cancelled: { color: "status-cancelled", stageKey: "cancelled" },
  interrupted: { color: "status-interrupted", stageKey: "interrupted" },
};

export const TIER_META: Record<AgentTier, { color: string }> = {
  executive: { color: "tier-executive" },
  engineering: { color: "tier-engineering" },
  quality: { color: "tier-quality" },
  release: { color: "tier-release" },
};

export const TIERS: AgentTier[] = [
  "executive",
  "engineering",
  "quality",
  "release",
];

export const RISK_META: Record<RiskLevel, { color: string }> = {
  low: { color: "risk-low" },
  medium: { color: "risk-medium" },
  high: { color: "risk-high" },
};

export const PROVIDERS: ProviderName[] = [
  "simulation",
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "ollama",
];

export const KEYLESS_PROVIDERS: ProviderName[] = ["simulation", "ollama"];

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
  google: "gemini-2.0-flash",
  openrouter: "openai/gpt-4o-mini",
  ollama: "llama3.2",
  simulation: "sim-1",
};

/** The run "stage rail" order used in the timeline and cards. */
export const STAGE_RAIL: {
  key: string;
  matches: RunStatus[];
}[] = [
  { key: "queued", matches: ["queued"] },
  { key: "planning", matches: [] },
  { key: "running", matches: ["running"] },
  { key: "awaiting", matches: ["awaiting_approval"] },
  { key: "completed", matches: ["completed", "failed", "cancelled", "interrupted"] },
];
