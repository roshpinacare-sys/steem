import { sha256 } from '../contracts/crypto.js';

export type PaymentState = 'CREATED' | 'AUTHORIZED' | 'CAPTURED' | 'SETTLED' | 'FAILED' | 'REFUNDED';
export type PaymentEventKind = 'AUTHORIZE' | 'CAPTURE' | 'SETTLE' | 'FAIL' | 'REFUND';

export interface PaymentIntent {
  readonly intentId: string;
  readonly tenantId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly providerId: string;
}

export interface PaymentProviderEvent {
  readonly providerEventId: string;
  readonly idempotencyKey: string;
  readonly intentId: string;
  readonly tenantId: string;
  readonly providerId: string;
  readonly kind: PaymentEventKind;
  readonly amountMinor: number;
  readonly currency: string;
  readonly signatureVerified: boolean;
  readonly observedAt: string;
}

export interface PaymentSafetyState extends PaymentIntent {
  readonly state: PaymentState;
  readonly capturedMinor: number;
  readonly settledMinor: number;
  readonly refundedMinor: number;
  readonly revision: number;
  readonly lastEventDigest?: string;
}

export interface ReconciliationResult {
  readonly status: 'MATCH' | 'MISMATCH';
  readonly internalSettledMinor: number;
  readonly providerSettledMinor: number;
  readonly deltaMinor: number;
  readonly digest: string;
}

/** SAE-derived safety state machine. It performs no provider call and grants no payment authority. */
export class PaymentSafetyLedger {
  readonly #states = new Map<string, PaymentSafetyState>();
  readonly #providerEvents = new Map<string, string>();
  readonly #idempotency = new Map<string, string>();

  create(intent: PaymentIntent): PaymentSafetyState {
    validateIntent(intent);
    if (this.#states.has(intent.intentId)) throw new Error('payment_intent_exists');
    const state: PaymentSafetyState = { ...intent, state: 'CREATED', capturedMinor: 0, settledMinor: 0, refundedMinor: 0, revision: 1 };
    this.#states.set(intent.intentId, state);
    return structuredClone(state);
  }

  apply(event: PaymentProviderEvent): PaymentSafetyState {
    validateEvent(event);
    const digest = sha256(event);
    const priorProvider = this.#providerEvents.get(event.providerEventId);
    if (priorProvider !== undefined) {
      if (priorProvider !== digest) throw new Error('payment_provider_event_conflict');
      return this.get(event.intentId);
    }
    const priorIdempotency = this.#idempotency.get(event.idempotencyKey);
    if (priorIdempotency !== undefined) {
      if (priorIdempotency !== digest) throw new Error('payment_idempotency_conflict');
      return this.get(event.intentId);
    }
    const current = this.get(event.intentId);
    if (current.tenantId !== event.tenantId || current.providerId !== event.providerId) throw new Error('payment_authority_boundary_mismatch');
    if (current.amountMinor !== event.amountMinor || current.currency !== event.currency) throw new Error('payment_amount_or_currency_mismatch');
    const next = transition(current, event.kind, digest);
    this.#providerEvents.set(event.providerEventId, digest);
    this.#idempotency.set(event.idempotencyKey, digest);
    this.#states.set(event.intentId, next);
    return structuredClone(next);
  }

  get(intentId: string): PaymentSafetyState {
    const state = this.#states.get(intentId);
    if (state === undefined) throw new Error('payment_intent_not_found');
    return structuredClone(state);
  }

  reconcile(intentId: string, providerSettledMinor: number): ReconciliationResult {
    if (!Number.isSafeInteger(providerSettledMinor) || providerSettledMinor < 0) throw new Error('provider_settlement_invalid');
    const state = this.get(intentId);
    const deltaMinor = providerSettledMinor - state.settledMinor;
    const material = {
      status: deltaMinor === 0 ? 'MATCH' as const : 'MISMATCH' as const,
      internalSettledMinor: state.settledMinor,
      providerSettledMinor,
      deltaMinor,
    };
    return { ...material, digest: sha256(material) };
  }
}

function transition(current: PaymentSafetyState, kind: PaymentEventKind, digest: string): PaymentSafetyState {
  const base = { ...current, revision: current.revision + 1, lastEventDigest: digest };
  if (kind === 'AUTHORIZE' && current.state === 'CREATED') return { ...base, state: 'AUTHORIZED' };
  if (kind === 'CAPTURE' && current.state === 'AUTHORIZED') return { ...base, state: 'CAPTURED', capturedMinor: current.amountMinor };
  if (kind === 'SETTLE' && current.state === 'CAPTURED' && current.capturedMinor === current.amountMinor) return { ...base, state: 'SETTLED', settledMinor: current.amountMinor };
  if (kind === 'FAIL' && (current.state === 'CREATED' || current.state === 'AUTHORIZED')) return { ...base, state: 'FAILED' };
  if (kind === 'REFUND' && current.state === 'SETTLED' && current.refundedMinor === 0) return { ...base, state: 'REFUNDED', refundedMinor: current.settledMinor };
  throw new Error(`payment_transition_invalid:${current.state}:${kind}`);
}

function validateIntent(intent: PaymentIntent): void {
  if (intent.intentId.trim() === '' || intent.tenantId.trim() === '' || intent.providerId.trim() === '') throw new Error('payment_intent_identity_invalid');
  if (!Number.isSafeInteger(intent.amountMinor) || intent.amountMinor <= 0) throw new Error('payment_amount_invalid');
  if (!/^[A-Z]{3}$/.test(intent.currency)) throw new Error('payment_currency_invalid');
}

function validateEvent(event: PaymentProviderEvent): void {
  if (!event.signatureVerified) throw new Error('payment_webhook_signature_unverified');
  if (event.providerEventId.trim() === '' || event.idempotencyKey.trim() === '' || event.intentId.trim() === '' || event.tenantId.trim() === '' || event.providerId.trim() === '') throw new Error('payment_event_identity_invalid');
  if (!Number.isFinite(Date.parse(event.observedAt))) throw new Error('payment_event_time_invalid');
  if (!Number.isSafeInteger(event.amountMinor) || event.amountMinor <= 0) throw new Error('payment_event_amount_invalid');
  if (!/^[A-Z]{3}$/.test(event.currency)) throw new Error('payment_event_currency_invalid');
}
