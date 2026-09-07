/**
 * sovereign-llm.test.ts — the deterministic offline intelligence layer.
 * Proves every simulated response is valid against the real agent schemas
 * (so the pipeline's own validators accept them) and that activation is
 * strictly opt-in.
 */
import { describe, it, expect } from "vitest";
import {
  simulateResponse,
  isSimEnabled,
  isSovereignLocal,
  ollamaBaseUrl,
  ollamaModel,
} from "../src/services/local/sovereign-llm.js";
import { ArchitectSchema } from "../src/schemas/architect-schema.js";
import { CoderSchema } from "../src/schemas/coder-schema.js";
import { ReviewerSchema } from "../src/schemas/reviewer-schema.js";

describe("sovereign simulator — schema validity", () => {
  it("produces a plan that satisfies ArchitectSchema", () => {
    const r = simulateResponse("plan.json", "Objective: Add a rate limiter\n");
    expect(() => ArchitectSchema.parse(JSON.parse(r.content))).not.toThrow();
    const plan = ArchitectSchema.parse(JSON.parse(r.content));
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.prefetch?.length).toBeGreaterThan(0);
  });

  it("produces a patch that satisfies CoderSchema and targets the given file", () => {
    const r = simulateResponse("src/rate-limiter.ts", "Objective: Add a rate limiter\nPlan: {}");
    const patch = CoderSchema.parse(JSON.parse(r.content));
    expect(patch.files[0].path).toBe("src/rate-limiter.ts");
    expect(patch.files[0].content.length).toBeGreaterThan(0);
    expect(patch.diff).toContain("+");
  });

  it("produces a review that satisfies ReviewerSchema", () => {
    const r = simulateResponse("review.json", "review this diff");
    expect(() => ReviewerSchema.parse(JSON.parse(r.content))).not.toThrow();
  });

  it("returns empty red-team findings (clean gate)", () => {
    const r = simulateResponse("red-team-pass", "adversarial prompt");
    expect(JSON.parse(r.content)).toEqual({ findings: [] });
  });

  it("returns a plain summary for a cartographer call", () => {
    const r = simulateResponse("src/index.ts", "Summarize the following code file in 5 lines.\n\nFile: src/index.ts\n...");
    expect(r.content).toContain("Sovereign summary");
    expect(() => JSON.parse(r.content)).toThrow(); // it is prose, not JSON
  });

  it("is deterministic — identical inputs yield identical output", () => {
    const a = simulateResponse("plan.json", "Objective: X\n");
    const b = simulateResponse("plan.json", "Objective: X\n");
    expect(a.content).toBe(b.content);
    expect(a.usage.total_tokens).toBe(b.usage.total_tokens);
  });

  it("records non-zero token usage tagged to the sovereign model", () => {
    const r = simulateResponse("plan.json", "Objective: X\n");
    expect(r.model).toBe("qodo-sovereign-sim");
    expect(r.usage.total_tokens).toBeGreaterThan(0);
  });
});

describe("sovereign activation — opt-in only", () => {
  it("isSimEnabled is false unless QODO_LLM_SIM === 'true'", () => {
    expect(isSimEnabled({})).toBe(false);
    expect(isSimEnabled({ QODO_LLM_SIM: "false" })).toBe(false);
    expect(isSimEnabled({ QODO_LLM_SIM: "true" })).toBe(true);
  });

  it("isSovereignLocal covers both the simulator and a local Ollama server", () => {
    expect(isSovereignLocal({})).toBe(false);
    expect(isSovereignLocal({ QODO_LLM_SIM: "true" })).toBe(true);
    expect(isSovereignLocal({ OLLAMA_BASE_URL: "http://localhost:11434" })).toBe(true);
    expect(isSovereignLocal({ OLLAMA_BASE_URL: "   " })).toBe(false);
  });

  it("normalizes the Ollama base URL and model", () => {
    expect(ollamaBaseUrl({ OLLAMA_BASE_URL: "http://localhost:11434/" })).toBe("http://localhost:11434");
    expect(ollamaBaseUrl({})).toBeUndefined();
    expect(ollamaModel({})).toBe("llama3.1");
    expect(ollamaModel({ OLLAMA_MODEL: "qwen2.5-coder" })).toBe("qwen2.5-coder");
  });
});
