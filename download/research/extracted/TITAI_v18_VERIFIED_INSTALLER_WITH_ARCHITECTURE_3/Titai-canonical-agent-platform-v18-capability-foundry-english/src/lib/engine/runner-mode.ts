export type RunnerMode =
  | "legacy"
  | "durable_shadow"
  | "durable_opt_in"
  | "durable_default"
  | "legacy_rollback";

const MODES = new Set<RunnerMode>([
  "legacy",
  "durable_shadow",
  "durable_opt_in",
  "durable_default",
  "legacy_rollback",
]);

export function parseRunnerMode(value: string | undefined): RunnerMode {
  const normalized = value?.trim().toLowerCase() as RunnerMode | undefined;
  return normalized && MODES.has(normalized) ? normalized : "legacy";
}

export function currentRunnerMode(): RunnerMode {
  return parseRunnerMode(process.env.TITAI_RUNNER_MODE);
}

export function runnerModeUsesDurableExecution(
  mode: RunnerMode,
  requested?: boolean,
): boolean {
  if (mode === "durable_default") return true;
  if (mode === "durable_opt_in") return requested === true;
  return false;
}

export function runnerModeUsesShadow(mode: RunnerMode): boolean {
  return mode === "durable_shadow";
}
