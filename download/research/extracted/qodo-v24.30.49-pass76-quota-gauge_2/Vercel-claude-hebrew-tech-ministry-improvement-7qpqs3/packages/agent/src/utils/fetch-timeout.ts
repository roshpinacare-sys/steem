/**
 * fetchWithTimeout wraps the global fetch with an AbortController-based timeout.
 *
 * This prevents long-running external calls from blocking the agent pipeline
 * when a downstream service hangs or is unreachable. All callers supply their own
 * sensible timeout; the default is intentionally conservative.
 *
 * If `init.signal` is provided (e.g. a race-cancellation signal from
 * raceProviders), it is combined with the timeout signal via AbortSignal.any()
 * so that whichever fires first wins. Previously, spreading `init` and then
 * overwriting `signal` meant the caller's signal was silently dropped.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const { signal: callerSignal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  const signal = callerSignal
    ? AbortSignal.any([controller.signal, callerSignal])
    : controller.signal;
  try {
    return await fetch(input, { ...rest, signal });
  } finally {
    clearTimeout(timer);
  }
}
