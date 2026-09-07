import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RedisState } from "./redis-state.js";
import type { Telemetry } from "./telemetry.js";

export interface OffloadRequest {
  requestId: string;
  files: string[];
  testCommand: string;
  requestedAt: string;
}

export interface OffloadResult {
  requestId: string;
  passed: boolean;
  logs?: string;
}

export interface LocalTestResult {
  allowed: boolean;
  skipped?: boolean;
  error?: string;
}

const REQUEST_CHANNEL = "qodo:v24:compute:requests";
const REQUEST_QUEUE = "qodo:v24:compute:requests:pending";
const RESULT_PREFIX = "qodo:v24:compute:result:";
const PENDING_TTL_MS = 90_000;
const MAX_LOG_BYTES = 1_048_576; // 1 MiB cap on captured npm test output

// SECURITY FIX (V24 audit): testCommand ends up executed on whatever opt-in
// client (a user's browser/phone) claims the job. Without this allowlist,
// testCommand is an unrestricted string that a hallucinating or compromised
// Coder step could set to anything, and a remote client would run it
// unsandboxed. Restrict to a fixed set of known-safe project commands.
const ALLOWED_TEST_COMMANDS = new Set([
  "npm test",
  "npm run test",
  "npx vitest run",
  "npx tsc --noEmit",
]);

function assertSafeTestCommand(command: string): void {
  if (!ALLOWED_TEST_COMMANDS.has(command)) {
    throw new Error(
      `[edge-test-offload] refusing to offload disallowed command: "${command}". ` +
      `Allowed: ${[...ALLOWED_TEST_COMMANDS].join(", ")}`,
    );
  }
}

function resultKey(requestId: string): string {
  return `${RESULT_PREFIX}${requestId}`;
}

function generateRequestId(): string {
  return `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Attempts to offload the test run to an opt-in Mission Control client via
 * Redis Pub/Sub. If a client accepts and returns a result within the timeout,
 * the boolean pass/fail is returned; otherwise null, and the caller should
 * fall back to local test execution.
 */
interface EdgeTestEnv {
  UPSTASH_REDIS_REST_URL?: string;
}

export async function tryOffloadToClient(
  files: string[],
  testCommand: string,
  telemetry?: Telemetry,
  redis?: RedisState,
  env?: EdgeTestEnv,
): Promise<boolean | null> {
  if (!(env?.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_REDIS_REST_URL)) {
    await telemetry?.decision("edge-test", "offload-unavailable", { reason: "redis not configured" });
    return null;
  }

  // SECURITY FIX (V24 audit): validate before publishing anywhere.
  assertSafeTestCommand(testCommand);

  const state = redis ?? new RedisState();
  const requestId = generateRequestId();
  const payload: OffloadRequest = {
    requestId,
    files,
    testCommand,
    requestedAt: new Date().toISOString(),
  };
  const message = JSON.stringify(payload);

  // Publish for any live subscriber and enqueue for polling clients.
  await state.publish(REQUEST_CHANNEL, message);
  await state.lpush(REQUEST_QUEUE, message);
  await state.setWithTTL(resultKey(requestId), "", Math.ceil(PENDING_TTL_MS / 1000));

  await telemetry?.decision("edge-test", "offload-requested", { requestId, files, testCommand });

  const deadline = Date.now() + PENDING_TTL_MS;
  const pollMs = 1000;

  while (Date.now() < deadline) {
    const raw = await state.get(resultKey(requestId));
    if (raw && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as OffloadResult;
        await telemetry?.decision("edge-test", "offload-resolved", { requestId, passed: parsed.passed });
        await state.delete(resultKey(requestId));
        return parsed.passed;
      } catch {
        await telemetry?.decision("edge-test", "offload-result-parse-failed", { requestId, raw });
        return null;
      }
    }
    await sleep(pollMs);
  }

  await telemetry?.decision("edge-test", "offload-timeout", { requestId });
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs the project's local npm test as a fallback when edge offloading is
 * unavailable. In test environments this is skipped to avoid recursion.
 */
export async function runLocalNpmTest(telemetry?: Telemetry, isTestEnv = false): Promise<LocalTestResult> {
  // The caller is responsible for determining test mode; this function no
  // longer reads process.env directly, so tests and production callers remain
  // in full control of the execution path.
  if (isTestEnv) {
    await telemetry?.decision("edge-test", "local-skipped-test-env", {});
    return { allowed: true, skipped: true };
  }

  const cwd = process.cwd();
  const packageJsonPath = join(cwd, "package.json");
  if (!existsSync(packageJsonPath)) {
    return { allowed: true, skipped: true };
  }

  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { scripts?: { test?: string } };
  if (!pkg.scripts?.test) {
    return { allowed: true, skipped: true };
  }

  await telemetry?.decision("edge-test", "local-started", { cwd });
  return new Promise((resolve) => {
    const proc = spawn("npm", ["test"], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: string[] = [];
    const stderr: string[] = [];
    let capturedBytes = 0;

    const capture = (target: string[], chunk: Buffer) => {
      if (capturedBytes >= MAX_LOG_BYTES) return;
      const chunkStr = chunk.toString("utf-8");
      const room = MAX_LOG_BYTES - capturedBytes;
      target.push(chunkStr.slice(0, room));
      capturedBytes = Math.min(capturedBytes + Buffer.byteLength(chunkStr, "utf-8"), MAX_LOG_BYTES);
    };

    proc.stdout?.on("data", (chunk: Buffer) => capture(stdout, chunk));
    proc.stderr?.on("data", (chunk: Buffer) => capture(stderr, chunk));
    proc.on("error", (err) => {
      resolve({ allowed: false, error: err.message });
    });
    proc.on("close", (code) => {
      const passed = code === 0;
      const logs = [...stdout, ...stderr].filter(Boolean).join("\n");
      telemetry?.decision("edge-test", "local-finished", { passed, code });
      resolve({ allowed: passed, error: passed ? undefined : logs || "npm test failed" });
    });
  });
}
