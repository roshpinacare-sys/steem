import { sha256 } from '../contracts/crypto.js';

export interface ModelTransition { readonly from: string; readonly event: string; readonly to: string; }
export interface ModelTraceEvent { readonly eventId: string; readonly event: string; readonly resultingState: string; readonly monotonicValue: number; }
export interface InvariantModelInput { readonly initialState: string; readonly transitions: readonly ModelTransition[]; readonly trace: readonly ModelTraceEvent[]; readonly terminalStates: readonly string[]; }
export interface InvariantModelReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly finalState: string;
  readonly violations: readonly string[];
  readonly metrics: { readonly events: number; readonly transitions: number; readonly terminalReached: boolean };
  readonly reportDigest: string;
}
export function checkInvariantModel(input: InvariantModelInput): InvariantModelReport {
  if (input.initialState.trim() === '') throw new Error('invariant_initial_state_required');
  const transitionKeys = new Set<string>();
  for (const transition of input.transitions) {
    const key = `${transition.from}\u0000${transition.event}`;
    if (transition.from.trim() === '' || transition.event.trim() === '' || transition.to.trim() === '' || transitionKeys.has(key)) throw new Error('invariant_transition_invalid');
    transitionKeys.add(key);
  }
  const violations: string[] = [];
  const eventIds = new Set<string>();
  let state = input.initialState;
  let monotonic = Number.NEGATIVE_INFINITY;
  for (const row of input.trace) {
    if (row.eventId.trim() === '' || eventIds.has(row.eventId)) violations.push(`duplicate_event:${row.eventId}`);
    eventIds.add(row.eventId);
    if (!Number.isFinite(row.monotonicValue) || row.monotonicValue <= monotonic) violations.push(`monotonic_regression:${row.eventId}`);
    const transition = input.transitions.find((item) => item.from === state && item.event === row.event);
    if (transition === undefined) violations.push(`transition_not_allowed:${state}:${row.event}`);
    else if (transition.to !== row.resultingState) violations.push(`result_state_mismatch:${row.eventId}`);
    if (transition !== undefined) state = transition.to;
    monotonic = Math.max(monotonic, row.monotonicValue);
  }
  const terminalReached = input.terminalStates.includes(state);
  const metrics = { events: input.trace.length, transitions: input.transitions.length, terminalReached };
  const material = { status: violations.length === 0 ? 'PASS' as const : 'BLOCK' as const, finalState: state, violations, metrics };
  return { ...material, reportDigest: sha256(material) };
}
