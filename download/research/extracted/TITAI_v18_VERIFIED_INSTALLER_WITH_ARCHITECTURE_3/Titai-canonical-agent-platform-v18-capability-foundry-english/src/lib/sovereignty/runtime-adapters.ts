import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { SovereignNetworkGuard } from "./network-policy";

export type RuntimeHealth = "stopped" | "starting" | "healthy" | "degraded" | "unavailable";

export interface RuntimeModelManifest {
  modelId: string;
  family: string;
  format: string;
  artifactPath?: string;
  artifactSha256?: string;
  license: string;
  contextTokens: number;
  minimumRamBytes: number;
  minimumVramBytes?: number;
  quantization?: string;
}

export interface RuntimeCapabilities {
  runtimeId: string;
  local: true;
  structuredOutput: boolean;
  tools: boolean;
  streaming: boolean;
  cancellation: boolean;
  tokenization: "native" | "estimated";
  loadedModelId?: string;
}

export interface RuntimeGenerateRequest {
  modelId: string;
  prompt: string;
  maximumOutputTokens: number;
  temperature?: number;
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface RuntimeGenerateResult {
  modelId: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  timeToFirstTokenMs?: number;
  latencyMs: number;
  tokensPerSecond: number;
  structured: boolean;
  finishReason: string;
}

export interface RuntimeMetrics {
  runtimeId: string;
  health: RuntimeHealth;
  requests: number;
  failures: number;
  loadedModelId?: string;
  startedAt?: string;
  lastRequestAt?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatencyMs: number;
  processId?: number;
}

export interface SovereignLocalRuntime {
  readonly id: string;
  start(): Promise<void>;
  loadModel(manifest: RuntimeModelManifest): Promise<void>;
  healthCheck(): Promise<RuntimeHealth>;
  capabilities(): Promise<RuntimeCapabilities>;
  tokenize(text: string): Promise<number>;
  generate(request: RuntimeGenerateRequest): Promise<RuntimeGenerateResult>;
  cancel(): Promise<void>;
  unload(): Promise<void>;
  metrics(): RuntimeMetrics;
  shutdown(): Promise<void>;
}

function sha256File(path: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export function verifyRuntimeArtifact(manifest: RuntimeModelManifest): { verified: boolean; blockers: string[]; bytes?: number } {
  const blockers: string[] = [];
  if (!manifest.artifactPath) blockers.push("model_artifact_path_missing");
  if (!manifest.artifactSha256) blockers.push("model_artifact_hash_missing");
  if (manifest.artifactPath && !existsSync(manifest.artifactPath)) blockers.push("model_artifact_missing");
  let bytes: number | undefined;
  if (manifest.artifactPath && existsSync(manifest.artifactPath)) {
    const info = statSync(manifest.artifactPath);
    if (!info.isFile()) blockers.push("model_artifact_not_file");
    else {
      bytes = info.size;
      if (manifest.artifactSha256 && sha256File(manifest.artifactPath) !== manifest.artifactSha256) {
        blockers.push("model_artifact_hash_mismatch");
      }
    }
  }
  if (!manifest.license.trim()) blockers.push("model_license_missing");
  return { verified: blockers.length === 0, blockers, bytes };
}

class MetricsState {
  health: RuntimeHealth = "stopped";
  requests = 0;
  failures = 0;
  loadedModelId?: string;
  startedAt?: string;
  lastRequestAt?: string;
  totalInputTokens = 0;
  totalOutputTokens = 0;
  totalLatencyMs = 0;

  snapshot(runtimeId: string, processId?: number): RuntimeMetrics {
    return {
      runtimeId,
      health: this.health,
      requests: this.requests,
      failures: this.failures,
      loadedModelId: this.loadedModelId,
      startedAt: this.startedAt,
      lastRequestAt: this.lastRequestAt,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalLatencyMs: this.totalLatencyMs,
      processId,
    };
  }
}

export class OpenAICompatibleLocalRuntime implements SovereignLocalRuntime {
  readonly id: string;
  private readonly state = new MetricsState();
  private activeAbort?: AbortController;
  private model?: RuntimeModelManifest;

  constructor(
    private readonly baseUrl: string,
    options: { id?: string; timeoutMs?: number } = {},
  ) {
    const url = new URL(baseUrl);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
      throw new Error("local_runtime_endpoint_must_be_loopback");
    }
    this.id = options.id ?? "openai-compatible-local-runtime";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private readonly timeoutMs: number;

  async start(): Promise<void> {
    this.state.health = "starting";
    this.state.startedAt = new Date().toISOString();
    this.state.health = await this.healthCheck();
    if (this.state.health !== "healthy") throw new Error("local_runtime_unavailable");
  }

  async loadModel(manifest: RuntimeModelManifest): Promise<void> {
    if (!manifest.modelId.trim()) throw new Error("model_id_required");
    this.model = structuredClone(manifest);
    this.state.loadedModelId = manifest.modelId;
  }

  async healthCheck(): Promise<RuntimeHealth> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 5_000));
    try {
      const guard = new SovereignNetworkGuard("local_only", true);
      guard.authorize({ url: new URL("/v1/models", this.baseUrl).toString(), actor: this.id });
      const response = await fetch(new URL("/v1/models", this.baseUrl), { signal: controller.signal });
      this.state.health = response.ok ? "healthy" : "degraded";
    } catch {
      this.state.health = "unavailable";
    } finally {
      clearTimeout(timer);
    }
    return this.state.health;
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    return {
      runtimeId: this.id,
      local: true,
      structuredOutput: true,
      tools: true,
      streaming: false,
      cancellation: true,
      tokenization: "estimated",
      loadedModelId: this.model?.modelId,
    };
  }

  async tokenize(text: string): Promise<number> {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  async generate(request: RuntimeGenerateRequest): Promise<RuntimeGenerateResult> {
    if (!request.prompt.trim()) throw new Error("prompt_required");
    if (!Number.isInteger(request.maximumOutputTokens) || request.maximumOutputTokens <= 0) {
      throw new Error("output_budget_invalid");
    }
    if (this.model && request.modelId !== this.model.modelId) throw new Error("model_not_loaded");
    const started = performance.now();
    const controller = new AbortController();
    this.activeAbort = controller;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const forwardAbort = () => controller.abort();
    request.signal?.addEventListener("abort", forwardAbort, { once: true });
    this.state.requests += 1;
    this.state.lastRequestAt = new Date().toISOString();
    try {
      const guard = new SovereignNetworkGuard("local_only", true);
      const endpoint = new URL("/v1/chat/completions", this.baseUrl).toString();
      guard.authorize({ url: endpoint, actor: this.id });
      const body: Record<string, unknown> = {
        model: request.modelId,
        messages: [{ role: "user", content: request.prompt }],
        max_tokens: request.maximumOutputTokens,
        temperature: request.temperature ?? 0,
        stream: false,
      };
      if (request.jsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: "titai_response", strict: true, schema: request.jsonSchema },
        };
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`local_runtime_http_${response.status}`);
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      const inputTokens = json.usage?.prompt_tokens ?? (await this.tokenize(request.prompt));
      const outputTokens = json.usage?.completion_tokens ?? (await this.tokenize(text));
      const latencyMs = Math.max(1, Math.round(performance.now() - started));
      const result: RuntimeGenerateResult = {
        modelId: request.modelId,
        text,
        inputTokens,
        outputTokens,
        latencyMs,
        tokensPerSecond: Number((outputTokens / (latencyMs / 1_000)).toFixed(3)),
        structured: request.jsonSchema ? isJson(text) : false,
        finishReason: json.choices?.[0]?.finish_reason ?? "unknown",
      };
      this.state.totalInputTokens += inputTokens;
      this.state.totalOutputTokens += outputTokens;
      this.state.totalLatencyMs += latencyMs;
      return result;
    } catch (error) {
      this.state.failures += 1;
      throw error;
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", forwardAbort);
      if (this.activeAbort === controller) this.activeAbort = undefined;
    }
  }

  async cancel(): Promise<void> {
    this.activeAbort?.abort();
  }

  async unload(): Promise<void> {
    this.model = undefined;
    this.state.loadedModelId = undefined;
  }

  metrics(): RuntimeMetrics {
    return this.state.snapshot(this.id);
  }

  async shutdown(): Promise<void> {
    await this.cancel();
    await this.unload();
    this.state.health = "stopped";
  }
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export class LlamaCppServerRuntime extends OpenAICompatibleLocalRuntime {
  private child?: ChildProcess;

  constructor(
    private readonly options: {
      binaryPath: string;
      binarySha256: string;
      model: RuntimeModelManifest;
      host?: string;
      port?: number;
      contextTokens?: number;
      threads?: number;
      extraArgs?: string[];
      startupTimeoutMs?: number;
    },
  ) {
    const port = options.port ?? 11435;
    super(`http://${options.host ?? "127.0.0.1"}:${port}`, { id: "llama-cpp-local-runtime", timeoutMs: 120_000 });
  }

  override async start(): Promise<void> {
    if (!existsSync(this.options.binaryPath)) throw new Error("llama_cpp_binary_missing");
    if (sha256File(this.options.binaryPath) !== this.options.binarySha256) {
      throw new Error("llama_cpp_binary_hash_mismatch");
    }
    const modelStatus = verifyRuntimeArtifact(this.options.model);
    if (!modelStatus.verified) throw new Error(`model_artifact_invalid:${modelStatus.blockers.join(",")}`);
    const port = this.options.port ?? 11435;
    const args = [
      "--model", this.options.model.artifactPath!,
      "--host", this.options.host ?? "127.0.0.1",
      "--port", String(port),
      "--ctx-size", String(this.options.contextTokens ?? this.options.model.contextTokens),
      "--threads", String(this.options.threads ?? Math.max(1, Math.floor((navigatorCores() || 2) / 2))),
      ...(this.options.extraArgs ?? []),
    ];
    const child = spawn(this.options.binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: { ...process.env, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    });
    this.child = child;
    child.once("exit", () => { if (this.child === child) this.child = undefined; });
    const deadline = Date.now() + (this.options.startupTimeoutMs ?? 90_000);
    while (Date.now() < deadline) {
      if (!this.child) throw new Error("llama_cpp_process_exited");
      if ((await this.healthCheck()) === "healthy") {
        await this.loadModel(this.options.model);
        return;
      }
      await delay(250);
    }
    await this.shutdown();
    throw new Error("llama_cpp_startup_timeout");
  }

  override metrics(): RuntimeMetrics {
    return { ...super.metrics(), processId: this.child?.pid };
  }

  override async shutdown(): Promise<void> {
    await super.shutdown();
    if (this.child) {
      const child = this.child;
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
        delay(3_000).then(() => { if (!child.killed) child.kill("SIGKILL"); }),
      ]);
      this.child = undefined;
    }
  }
}

function navigatorCores(): number | undefined {
  const value = (globalThis.navigator as { hardwareConcurrency?: number } | undefined)?.hardwareConcurrency;
  return Number.isFinite(value) ? value : undefined;
}

export class NoModelRuntime implements SovereignLocalRuntime {
  readonly id = "no-model-runtime";
  async start(): Promise<void> {}
  async loadModel(): Promise<void> { throw new Error("no_local_model_available"); }
  async healthCheck(): Promise<RuntimeHealth> { return "unavailable"; }
  async capabilities(): Promise<RuntimeCapabilities> {
    return { runtimeId: this.id, local: true, structuredOutput: false, tools: false, streaming: false, cancellation: true, tokenization: "estimated" };
  }
  async tokenize(text: string): Promise<number> { return Math.max(1, Math.ceil(text.length / 4)); }
  async generate(): Promise<RuntimeGenerateResult> { throw new Error("no_local_model_available"); }
  async cancel(): Promise<void> {}
  async unload(): Promise<void> {}
  metrics(): RuntimeMetrics { return { runtimeId: this.id, health: "unavailable", requests: 0, failures: 0, totalInputTokens: 0, totalOutputTokens: 0, totalLatencyMs: 0 }; }
  async shutdown(): Promise<void> {}
}
