/**
 * kill-switch.ts — a single, dependency-free halt check.
 *
 * Audit recommendation (Brutal Audit §7): with 8+ opt-in external
 * integrations (Slack, QStash, Sentry, Datadog, etc.), a failure or
 * misconfiguration in any one of them must never be the only thing standing
 * between a runaway pipeline and a stop. This check has exactly one
 * dependency — process.env — so it works even if Redis, every provider,
 * and every integration are down or misbehaving.
 *
 * Call assertNotHalted() at the top of every phase in cli.ts's phase-runner,
 * before anything else runs for that phase.
 */

export class PipelineHaltedError extends Error {
  constructor(reason: string) {
    super(`Pipeline halted: ${reason}`);
    this.name = "PipelineHaltedError";
  }
}

export interface KillSwitchEnv {
  QODO_HALT?: string;
  QODO_HALT_REASON?: string;
}

/** Returns true if the global kill switch is engaged. Pure env check, no I/O. */
export function isHalted(env: KillSwitchEnv = process.env as KillSwitchEnv): boolean {
  return env.QODO_HALT === "true" || env.QODO_HALT === "1";
}

/**
 * Throws PipelineHaltedError if QODO_HALT is set. Intended to be called at
 * the start of every phase (architect, coder, reviewer, gate, ...) so a
 * single env var change stops the pipeline before its next phase, without
 * needing Redis, a webhook, or any other service to be healthy.
 */
export function assertNotHalted(env: KillSwitchEnv = process.env as KillSwitchEnv): void {
  if (isHalted(env)) {
    const reason = env.QODO_HALT_REASON || "QODO_HALT is set";
    throw new PipelineHaltedError(reason);
  }
}
