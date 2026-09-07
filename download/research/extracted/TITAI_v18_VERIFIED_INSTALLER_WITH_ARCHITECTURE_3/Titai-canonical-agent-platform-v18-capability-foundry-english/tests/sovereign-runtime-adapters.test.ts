import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LlamaCppServerRuntime,
  NoModelRuntime,
  OpenAICompatibleLocalRuntime,
  verifyRuntimeArtifact,
} from "@/lib/sovereignty/runtime-adapters";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("sovereign runtime adapters", () => {
  it("verifies model artifacts and rejects drift", () => {
    const dir = mkdtempSync(join(tmpdir(), "titai-model-artifact-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "model.gguf");
    const bytes = Buffer.from("GGUF-test-artifact");
    writeFileSync(path, bytes);
    expect(verifyRuntimeArtifact({ modelId: "m", family: "test", format: "gguf", artifactPath: path, artifactSha256: hash(bytes), license: "MIT", contextTokens: 1024, minimumRamBytes: 1 })).toEqual(expect.objectContaining({ verified: true, bytes: bytes.length }));
    expect(verifyRuntimeArtifact({ modelId: "m", family: "test", format: "gguf", artifactPath: path, artifactSha256: "0".repeat(64), license: "MIT", contextTokens: 1024, minimumRamBytes: 1 }).blockers).toContain("model_artifact_hash_mismatch");
  });

  it("uses a loopback OpenAI-compatible runtime and reports measured metrics", async () => {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/models") return response.end(JSON.stringify({ data: [{ id: "local-test" }] }));
      if (request.url === "/v1/chat/completions") return response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 4 } }));
      response.statusCode = 404; response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server address unavailable");
    const runtime = new OpenAICompatibleLocalRuntime(`http://127.0.0.1:${address.port}`);
    await runtime.start();
    await runtime.loadModel({ modelId: "local-test", family: "test", format: "mock", license: "MIT", contextTokens: 1024, minimumRamBytes: 1 });
    const result = await runtime.generate({ modelId: "local-test", prompt: "Return JSON", maximumOutputTokens: 20, jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } });
    expect(result.structured).toBe(true);
    expect(result.inputTokens).toBe(5);
    expect(runtime.metrics()).toEqual(expect.objectContaining({ requests: 1, failures: 0, loadedModelId: "local-test", health: "healthy" }));
    await runtime.shutdown();
  });

  it("rejects remote endpoints and missing real runtime artifacts", async () => {
    expect(() => new OpenAICompatibleLocalRuntime("https://example.com")).toThrow("local_runtime_endpoint_must_be_loopback");
    const runtime = new LlamaCppServerRuntime({ binaryPath: "/missing/llama-server", binarySha256: "0".repeat(64), model: { modelId: "missing", family: "test", format: "gguf", artifactPath: "/missing/model.gguf", artifactSha256: "0".repeat(64), license: "MIT", contextTokens: 1024, minimumRamBytes: 1 } });
    await expect(runtime.start()).rejects.toThrow("llama_cpp_binary_missing");
  });

  it("fails closed when no real local model is installed", async () => {
    const runtime = new NoModelRuntime();
    expect(await runtime.healthCheck()).toBe("unavailable");
    await expect(runtime.generate()).rejects.toThrow("no_local_model_available");
  });
});
