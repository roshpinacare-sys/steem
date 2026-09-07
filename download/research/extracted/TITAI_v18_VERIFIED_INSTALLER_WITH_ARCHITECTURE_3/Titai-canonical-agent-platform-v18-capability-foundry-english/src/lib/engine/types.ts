/**
 * Core engine types shared by the gateway, providers, runner, tools, and UI.
 * No imports from db/schema here to keep this usable in pure unit tests.
 */

export type ProviderName =
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "ollama"
  | "simulation";

export type RiskLevel = "low" | "medium" | "high";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on tool-result messages: which tool call this answers. */
  toolCallId?: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** JSON-schema-ish parameter description passed to providers. */
export type JsonSchema = Record<string, unknown>;

/** Tool as advertised to a provider (no executor). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export type GatewayEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; input: number; output: number }
  | { type: "done" }
  | { type: "error"; error: string };

export interface ChatRequest {
  provider: ProviderName;
  model?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxOutputTokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
  onEvent?: (e: GatewayEvent) => void;
  /** Resolved by the caller from provider_configs / env. */
  apiKey?: string;
  baseUrl?: string;
  /** Simulation provider only. */
  simulationScript?: SimulationScript;
  /** Simulation delta pacing in ms (0 = instant, for tests). */
  simulationDelayMs?: number;
}

export interface ChatResult {
  ok: boolean;
  output: string;
  toolCalls: ToolCall[];
  usage?: { input: number; output: number };
  error?: string;
}

export interface ProviderAdapter {
  name: ProviderName;
  chat(req: ChatRequest): Promise<ChatResult>;
}

// ─── Simulation scripting ────────────────────────────────────────────────

export interface SimulationPlanStep {
  name: string;
  description: string;
  dependsOn?: string[];
}

export interface SimulationTurn {
  deltas: string[];
  toolCalls?: ToolCall[];
  finalText: string;
}

export interface SimulationScript {
  id: string;
  keywords: string[];
  plan: SimulationPlanStep[];
  /** Keyed by step name → ordered turns (one per tool iteration). */
  stepTurns: Record<string, SimulationTurn[]>;
}

// ─── Tool execution ──────────────────────────────────────────────────────

export interface ToolContext {
  runId: string;
  stepId: string;
  dryRun: boolean;
  idempotencyKey: string;
  /** Persist an artifact; returns its id. */
  writeArtifact: (a: {
    name: string;
    kind: "markdown" | "json" | "text";
    content: string;
    idempotencyKey?: string;
  }) => string;
  signal: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
  error?: string;
}

export type ToolEffect = "read" | "write" | "external";
export type ToolIdempotency = "intrinsic" | "receipt" | "reconciliation";

export interface ToolDef {
  name: string;
  description: string;
  schemaVersion: number;
  parameters: JsonSchema;
  risk: RiskLevel;
  effect: ToolEffect;
  idempotency: ToolIdempotency;
  network: boolean;
  filesystem: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
}
