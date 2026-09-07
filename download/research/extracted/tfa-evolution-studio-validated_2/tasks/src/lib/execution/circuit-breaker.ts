/**
 * TFA Evolution Studio v28 — Circuit Breaker
 *
 * 3-state FSM (closed/open/half-open) with metrics export.
 */

type CircuitState = "closed" | "open" | "half-open";

interface CircuitRecord {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt?: string;
  openedAt?: string;
}

const circuits = new Map<string, CircuitRecord>();

const FAILURE_THRESHOLD = 5;
const RECOVERY_TIMEOUT_MS = 30_000;

function getCircuit(name: string): CircuitRecord {
  if (!circuits.has(name)) {
    circuits.set(name, { state: "closed", failures: 0, successes: 0 });
  }
  return circuits.get(name)!;
}

export function callThroughCircuit<T>(name: string, fn: () => T): T {
  const circuit = getCircuit(name);

  if (circuit.state === "open") {
    const now = Date.now();
    const opened = circuit.openedAt ? new Date(circuit.openedAt).getTime() : 0;
    if (now - opened > RECOVERY_TIMEOUT_MS) {
      circuit.state = "half-open";
      circuit.failures = 0;
    } else {
      throw new Error(`Circuit "${name}" is OPEN`);
    }
  }

  try {
    const result = fn();
    if (circuit.state === "half-open") {
      circuit.state = "closed";
      circuit.failures = 0;
    }
    circuit.successes++;
    return result;
  } catch (e) {
    circuit.failures++;
    circuit.lastFailureAt = new Date().toISOString();
    if (circuit.failures >= FAILURE_THRESHOLD) {
      circuit.state = "open";
      circuit.openedAt = new Date().toISOString();
    }
    throw e;
  }
}

export function getMetrics(name: string): {
  state: CircuitState;
  failures: number;
  successes: number;
} {
  const c = getCircuit(name);
  return { state: c.state, failures: c.failures, successes: c.successes };
}
