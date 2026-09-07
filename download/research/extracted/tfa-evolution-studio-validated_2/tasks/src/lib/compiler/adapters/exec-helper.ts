/**
 * TFA Evolution Studio v28 — Execution Helper
 *
 * Robust child-process execution with retry, timeout,
 * per-attempt evidence, and structured logging.
 */

import { spawn } from "child_process";
import type { EvidenceNode } from "@/lib/types";

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  log?: (msg: string) => void;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  attempts: number;
  timedOut: boolean;
  evidence: EvidenceNode[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runOnce(
  command: string,
  args: string[],
  options: Required<Pick<ExecOptions, "cwd" | "env" | "timeoutMs">>
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: exitCode ?? -1, timedOut });
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: -1, timedOut });
    });
  });
}

export async function execWithRetry(
  command: string,
  args: string[],
  options: ExecOptions = {}
): Promise<ExecResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? {};
  const timeoutMs = options.timeoutMs ?? 120_000;
  const retries = options.retries ?? 0;
  const retryDelayMs = options.retryDelayMs ?? 3000;
  const log = options.log ?? (() => {});

  const evidence: EvidenceNode[] = [];
  const startedAt = Date.now();
  let lastError = "";

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    log(`[exec] attempt ${attempt}/${retries + 1}: ${command} ${args.join(" ")}`);
    const result = await runOnce(command, args, { cwd, env, timeoutMs });

    if (!result.timedOut && result.exitCode === 0) {
      evidence.push({
        kind: "build_passed",
        status: "passed",
        message: `attempt_${attempt}: ${command} succeeded`,
        timestamp: new Date().toISOString(),
        metadata: { exitCode: result.exitCode, durationMs: Date.now() - startedAt },
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: Date.now() - startedAt,
        attempts: attempt,
        timedOut: false,
        evidence,
      };
    }

    lastError = result.timedOut
      ? `attempt_${attempt}: timed out after ${timeoutMs}ms`
      : `attempt_${attempt}: exitCode=${result.exitCode}`;

    evidence.push({
      kind: "build_passed",
      status: attempt === retries + 1 ? "failed" : "pending",
      message: lastError,
      timestamp: new Date().toISOString(),
      metadata: { stdout: result.stdout.slice(0, 500), stderr: result.stderr.slice(0, 500) },
    });

    if (attempt <= retries) {
      log(`[exec] attempt ${attempt} failed; retrying in ${retryDelayMs}ms`);
      await sleep(retryDelayMs);
    }
  }

  return {
    stdout: "",
    stderr: lastError,
    exitCode: -1,
    durationMs: Date.now() - startedAt,
    attempts: retries + 1,
    timedOut: lastError.includes("timed out"),
    evidence,
  };
}
