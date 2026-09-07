import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../contracts/crypto.js';
import { withSovereignFileLease } from '../persistence/sovereign-file-lease.js';
import {
  recordApprovalDecision,
  type ApprovalDecisionInput,
  type ApprovalDecisionRecord,
  type PushApprovalCard,
} from './chat-mission.js';

export const CONVERSATION_EVENT_TYPES = [
  'USER_INTENT',
  'SYSTEM_CLARIFICATION',
  'MISSION_COMPILED',
  'APPROVAL_CARD_CREATED',
  'APPROVAL_DECISION',
  'SYSTEM_RESULT',
] as const;
export type ConversationEventType = (typeof CONVERSATION_EVENT_TYPES)[number];

export interface ConversationEventInput {
  readonly eventId: string;
  readonly tenantId: string;
  readonly missionId: string;
  readonly authorityGrantDigest: string;
  readonly actorId: string;
  readonly type: ConversationEventType;
  readonly occurredAt: string;
  readonly content: string;
  readonly evidenceRefs?: readonly string[];
}

export interface ConversationEventRecord {
  readonly version: '33.2';
  readonly sequence: number;
  readonly eventId: string;
  readonly tenantId: string;
  readonly missionId: string;
  readonly authorityGrantDigest: string;
  readonly actorId: string;
  readonly type: ConversationEventType;
  readonly occurredAt: string;
  readonly content: string;
  readonly contentDigest: string;
  readonly evidenceRefs: readonly string[];
  readonly previousDigest?: string;
  readonly digest: string;
}

export interface MissionConversationSnapshot {
  readonly version: '33.2';
  readonly tenantId: string;
  readonly missionId: string;
  readonly authorityGrantDigest: string;
  readonly events: readonly ConversationEventRecord[];
  readonly rootDigest?: string;
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface MissionConversationStore {
  append(input: ConversationEventInput, now?: Date): ConversationEventRecord;
  get(tenantId: string, missionId: string): MissionConversationSnapshot | undefined;
}

export class InMemoryMissionConversationStore implements MissionConversationStore {
  readonly #snapshots = new Map<string, MissionConversationSnapshot>();

  append(input: ConversationEventInput, now = new Date()): ConversationEventRecord {
    const key = conversationKey(input.tenantId, input.missionId);
    const current = this.#snapshots.get(key);
    const next = appendToSnapshot(current, input, now);
    this.#snapshots.set(key, next.snapshot);
    return structuredClone(next.event);
  }

  get(tenantId: string, missionId: string): MissionConversationSnapshot | undefined {
    const row = this.#snapshots.get(conversationKey(tenantId, missionId));
    if (row === undefined) return undefined;
    verifyConversationSnapshot(row);
    return structuredClone(row);
  }

  export(): readonly MissionConversationSnapshot[] {
    return [...this.#snapshots.values()]
      .sort((a, b) => conversationKey(a.tenantId, a.missionId).localeCompare(conversationKey(b.tenantId, b.missionId)))
      .map((row) => structuredClone(row));
  }

  static restore(rows: readonly MissionConversationSnapshot[]): InMemoryMissionConversationStore {
    const store = new InMemoryMissionConversationStore();
    for (const row of rows) {
      verifyConversationSnapshot(row);
      const key = conversationKey(row.tenantId, row.missionId);
      if (store.#snapshots.has(key)) throw new Error('conversation_restore_duplicate');
      store.#snapshots.set(key, structuredClone(row));
    }
    return store;
  }
}

export class FileMissionConversationStore implements MissionConversationStore {
  readonly #root: string;

  constructor(root: string) {
    if (root.trim() === '') throw new Error('conversation_store_root_required');
    this.#root = resolve(root);
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    fsyncDirectory(this.#root);
  }

  append(input: ConversationEventInput, now = new Date()): ConversationEventRecord {
    const path = this.#path(input.tenantId, input.missionId);
    return withSovereignFileLease(`${path}.lock`, () => {
      const current = this.#read(path);
      const next = appendToSnapshot(current, input, now);
      atomicReplace(path, `${JSON.stringify(next.snapshot, null, 2)}\n`);
      fsyncDirectory(this.#root);
      return structuredClone(next.event);
    });
  }

  get(tenantId: string, missionId: string): MissionConversationSnapshot | undefined {
    return this.#read(this.#path(tenantId, missionId));
  }

  #read(path: string): MissionConversationSnapshot | undefined {
    if (!existsSync(path)) return undefined;
    const row = JSON.parse(readFileSync(path, 'utf8')) as MissionConversationSnapshot;
    verifyConversationSnapshot(row);
    return structuredClone(row);
  }

  #path(tenantId: string, missionId: string): string {
    return join(this.#root, `${sha256({ tenantId: identifier(tenantId, 'tenant_id_required'), missionId: identifier(missionId, 'mission_id_required') })}.json`);
  }
}

export type ApprovalInboxState = 'PENDING' | 'DELIVERED' | 'DECIDED' | 'EXPIRED';

export interface ApprovalDeliveryReceipt {
  readonly version: '33.2';
  readonly deliveryId: string;
  readonly cardId: string;
  readonly tenantId: string;
  readonly approverId: string;
  readonly deliveredAt: string;
  readonly cardDigest: string;
  readonly externalEffectsExecuted: 0;
  readonly deliveryDigest: string;
}

export interface ApprovalInboxItem {
  readonly version: '33.2';
  readonly card: PushApprovalCard;
  readonly state: ApprovalInboxState;
  readonly enqueuedAt: string;
  readonly deliveries: readonly ApprovalDeliveryReceipt[];
  readonly decisions: readonly ApprovalDecisionRecord[];
  readonly terminalDecisionDigest?: string;
  readonly externalEffectsExecuted: 0;
  readonly itemDigest: string;
}

export interface ApprovalInboxTransport {
  enqueue(card: PushApprovalCard, now?: Date): ApprovalInboxItem;
  deliver(input: { readonly deliveryId: string; readonly tenantId: string; readonly cardId: string; readonly approverId: string; readonly deliveredAt: string }, now?: Date): ApprovalDeliveryReceipt;
  decide(tenantId: string, input: ApprovalDecisionInput, now?: Date): ApprovalDecisionRecord;
  list(tenantId: string, approverId: string, now?: Date): readonly ApprovalInboxItem[];
  get(tenantId: string, cardId: string, now?: Date): ApprovalInboxItem | undefined;
}

export class InMemoryApprovalInbox implements ApprovalInboxTransport {
  readonly #items = new Map<string, ApprovalInboxItem>();
  readonly #deliveryIndex = new Map<string, ApprovalDeliveryReceipt>();
  readonly #decisionIndex = new Map<string, ApprovalDecisionRecord>();

  enqueue(card: PushApprovalCard, now = new Date()): ApprovalInboxItem {
    validNow(now);
    verifyCard(card);
    if (now.getTime() >= instant(card.expiresAt, 'approval_expiry_invalid')) throw new Error('approval_card_expired');
    const key = inboxKey(card.tenantId, card.cardId);
    const prior = this.#items.get(key);
    const material = itemMaterial(card, 'PENDING', now.toISOString(), [], [], undefined);
    const candidate: ApprovalInboxItem = { ...material, itemDigest: sha256(material) };
    if (prior !== undefined) {
      verifyInboxItem(prior, now);
      if (prior.card.cardDigest !== card.cardDigest) throw new Error('approval_card_id_conflict');
      return structuredClone(prior);
    }
    this.#items.set(key, candidate);
    return structuredClone(candidate);
  }

  deliver(input: { readonly deliveryId: string; readonly tenantId: string; readonly cardId: string; readonly approverId: string; readonly deliveredAt: string }, now = new Date()): ApprovalDeliveryReceipt {
    validNow(now);
    const item = this.#requiredItem(input.tenantId, input.cardId, now);
    if (!item.card.approverIds.includes(input.approverId)) throw new Error('approval_actor_not_authorized');
    const delivered = instant(input.deliveredAt, 'approval_delivery_time_invalid');
    if (delivered > now.getTime()) throw new Error('approval_delivery_time_in_future');
    const deliveryId = identifier(input.deliveryId, 'approval_delivery_id_required');
    const prior = this.#deliveryIndex.get(deliveryId);
    const material = {
      version: '33.2' as const,
      deliveryId,
      cardId: item.card.cardId,
      tenantId: item.card.tenantId,
      approverId: identifier(input.approverId, 'approval_actor_required'),
      deliveredAt: input.deliveredAt,
      cardDigest: item.card.cardDigest,
      externalEffectsExecuted: 0 as const,
    };
    const receipt: ApprovalDeliveryReceipt = { ...material, deliveryDigest: sha256(material) };
    if (prior !== undefined) {
      if (prior.deliveryDigest !== receipt.deliveryDigest) throw new Error('approval_delivery_id_conflict');
      return structuredClone(prior);
    }
    if (item.state === 'DECIDED') throw new Error('approval_card_already_decided');
    if (item.state === 'EXPIRED') throw new Error('approval_card_expired');
    const deliveries = Object.freeze([...item.deliveries, receipt]);
    const updated = rebuildItem(item, 'DELIVERED', deliveries, item.decisions, item.terminalDecisionDigest);
    this.#items.set(inboxKey(item.card.tenantId, item.card.cardId), updated);
    this.#deliveryIndex.set(deliveryId, receipt);
    return structuredClone(receipt);
  }

  decide(tenantId: string, input: ApprovalDecisionInput, now = new Date()): ApprovalDecisionRecord {
    validNow(now);
    const item = this.#requiredItem(tenantId, input.cardId, now);
    const prior = this.#decisionIndex.get(input.decisionId);
    const decision = recordApprovalDecision(item.card, input, now);
    if (prior !== undefined) {
      if (prior.decisionDigest !== decision.decisionDigest) throw new Error('approval_decision_id_conflict');
      return structuredClone(prior);
    }
    if (item.terminalDecisionDigest !== undefined) throw new Error('approval_card_terminal_decision_exists');
    const terminal = decision.option !== 'EXPLAIN';
    const decisions = Object.freeze([...item.decisions, decision]);
    const updated = rebuildItem(item, terminal ? 'DECIDED' : item.deliveries.length > 0 ? 'DELIVERED' : 'PENDING', item.deliveries, decisions, terminal ? decision.decisionDigest : undefined);
    this.#items.set(inboxKey(item.card.tenantId, item.card.cardId), updated);
    this.#decisionIndex.set(decision.decisionId, decision);
    return structuredClone(decision);
  }

  list(tenantId: string, approverId: string, now = new Date()): readonly ApprovalInboxItem[] {
    validNow(now);
    identifier(tenantId, 'tenant_id_required');
    identifier(approverId, 'approval_actor_required');
    return [...this.#items.values()]
      .filter((item) => item.card.tenantId === tenantId && item.card.approverIds.includes(approverId))
      .map((item) => this.#withExpiry(item, now))
      .filter((item) => item.state !== 'DECIDED' && item.state !== 'EXPIRED')
      .sort((a, b) => a.card.expiresAt.localeCompare(b.card.expiresAt) || a.card.cardId.localeCompare(b.card.cardId))
      .map((item) => structuredClone(item));
  }

  get(tenantId: string, cardId: string, now = new Date()): ApprovalInboxItem | undefined {
    validNow(now);
    const item = this.#items.get(inboxKey(tenantId, cardId));
    if (item === undefined) return undefined;
    const updated = this.#withExpiry(item, now);
    return structuredClone(updated);
  }

  export(): readonly ApprovalInboxItem[] {
    return [...this.#items.values()].sort((a, b) => inboxKey(a.card.tenantId, a.card.cardId).localeCompare(inboxKey(b.card.tenantId, b.card.cardId))).map((item) => structuredClone(item));
  }

  static restore(items: readonly ApprovalInboxItem[], now = new Date()): InMemoryApprovalInbox {
    validNow(now);
    const inbox = new InMemoryApprovalInbox();
    for (const item of items) {
      verifyInboxItem(item, now, true);
      const key = inboxKey(item.card.tenantId, item.card.cardId);
      if (inbox.#items.has(key)) throw new Error('approval_inbox_restore_duplicate');
      inbox.#items.set(key, structuredClone(item));
      for (const delivery of item.deliveries) {
        const prior = inbox.#deliveryIndex.get(delivery.deliveryId);
        if (prior !== undefined && prior.deliveryDigest !== delivery.deliveryDigest) throw new Error('approval_delivery_id_conflict');
        inbox.#deliveryIndex.set(delivery.deliveryId, structuredClone(delivery));
      }
      for (const decision of item.decisions) {
        const prior = inbox.#decisionIndex.get(decision.decisionId);
        if (prior !== undefined && prior.decisionDigest !== decision.decisionDigest) throw new Error('approval_decision_id_conflict');
        inbox.#decisionIndex.set(decision.decisionId, structuredClone(decision));
      }
    }
    return inbox;
  }

  #requiredItem(tenantId: string, cardId: string, now: Date): ApprovalInboxItem {
    const item = this.#items.get(inboxKey(tenantId, cardId));
    if (item === undefined) throw new Error('approval_card_not_found');
    return this.#withExpiry(item, now);
  }

  #withExpiry(item: ApprovalInboxItem, now: Date): ApprovalInboxItem {
    verifyInboxItem(item, now, true);
    if (item.state !== 'DECIDED' && now.getTime() >= instant(item.card.expiresAt, 'approval_expiry_invalid')) {
      const expired = rebuildItem(item, 'EXPIRED', item.deliveries, item.decisions, item.terminalDecisionDigest);
      this.#items.set(inboxKey(item.card.tenantId, item.card.cardId), expired);
      return expired;
    }
    return item;
  }
}

function appendToSnapshot(current: MissionConversationSnapshot | undefined, input: ConversationEventInput, now: Date): { snapshot: MissionConversationSnapshot; event: ConversationEventRecord } {
  validNow(now);
  const tenantId = identifier(input.tenantId, 'tenant_id_required');
  const missionId = identifier(input.missionId, 'mission_id_required');
  const authorityGrantDigest = digest(input.authorityGrantDigest, 'authority_grant_digest_invalid');
  const actorId = identifier(input.actorId, 'actor_id_required');
  const eventId = identifier(input.eventId, 'event_id_required');
  if (!CONVERSATION_EVENT_TYPES.includes(input.type)) throw new Error('conversation_event_type_invalid');
  const occurred = instant(input.occurredAt, 'conversation_event_time_invalid');
  if (occurred > now.getTime()) throw new Error('conversation_event_time_in_future');
  const content = text(input.content, 'conversation_content_required', 32_000);
  const evidenceRefs = unique(input.evidenceRefs ?? [], 'conversation_evidence_ref_invalid');
  if (current !== undefined) {
    verifyConversationSnapshot(current);
    if (current.tenantId !== tenantId || current.missionId !== missionId) throw new Error('conversation_binding_mismatch');
    if (current.authorityGrantDigest !== authorityGrantDigest) throw new Error('conversation_authority_binding_mismatch');
    const priorById = current.events.find((event) => event.eventId === eventId);
    if (priorById !== undefined) {
      const candidate = eventRecord(priorById.sequence, priorById.previousDigest, { ...input, tenantId, missionId, authorityGrantDigest, actorId, eventId, content, evidenceRefs });
      if (priorById.digest !== candidate.digest) throw new Error('conversation_event_id_conflict');
      return { snapshot: structuredClone(current), event: structuredClone(priorById) };
    }
    const last = current.events.at(-1);
    if (last !== undefined && occurred < instant(last.occurredAt, 'conversation_event_time_invalid')) throw new Error('conversation_event_time_regression');
  }
  const events = current?.events ?? [];
  const event = eventRecord(events.length + 1, current?.rootDigest, { ...input, tenantId, missionId, authorityGrantDigest, actorId, eventId, content, evidenceRefs });
  const nextEvents = Object.freeze([...events, event]);
  const material = {
    version: '33.2' as const,
    tenantId,
    missionId,
    authorityGrantDigest,
    events: nextEvents,
    rootDigest: event.digest,
    externalEffectsExecuted: 0 as const,
  };
  const snapshot: MissionConversationSnapshot = { ...material, snapshotDigest: sha256(material) };
  verifyConversationSnapshot(snapshot);
  return { snapshot, event };
}

function eventRecord(sequence: number, previousDigest: string | undefined, input: ConversationEventInput & { readonly evidenceRefs: readonly string[] }): ConversationEventRecord {
  const material = {
    version: '33.2' as const,
    sequence,
    eventId: input.eventId,
    tenantId: input.tenantId,
    missionId: input.missionId,
    authorityGrantDigest: input.authorityGrantDigest,
    actorId: input.actorId,
    type: input.type,
    occurredAt: input.occurredAt,
    content: input.content,
    contentDigest: sha256({ content: input.content }),
    evidenceRefs: input.evidenceRefs,
    ...(previousDigest === undefined ? {} : { previousDigest }),
  };
  return { ...material, digest: sha256(material) };
}

export function verifyConversationSnapshot(snapshot: MissionConversationSnapshot): void {
  if (snapshot.version !== '33.2') throw new Error('conversation_version_invalid');
  identifier(snapshot.tenantId, 'tenant_id_required');
  identifier(snapshot.missionId, 'mission_id_required');
  digest(snapshot.authorityGrantDigest, 'authority_grant_digest_invalid');
  let previousDigest: string | undefined;
  const ids = new Set<string>();
  for (let index = 0; index < snapshot.events.length; index += 1) {
    const event = snapshot.events[index]!;
    if (event.version !== '33.2' || event.sequence !== index + 1) throw new Error('conversation_sequence_invalid');
    if (event.tenantId !== snapshot.tenantId || event.missionId !== snapshot.missionId || event.authorityGrantDigest !== snapshot.authorityGrantDigest) throw new Error('conversation_event_binding_invalid');
    if (event.previousDigest !== previousDigest) throw new Error('conversation_chain_invalid');
    if (ids.has(event.eventId)) throw new Error('conversation_event_duplicate');
    ids.add(event.eventId);
    if (event.contentDigest !== sha256({ content: event.content })) throw new Error('conversation_content_digest_invalid');
    const { digest: eventDigest, ...material } = event;
    if (sha256(material) !== eventDigest) throw new Error('conversation_event_digest_invalid');
    previousDigest = event.digest;
  }
  if (snapshot.rootDigest !== previousDigest) throw new Error('conversation_root_digest_invalid');
  const { snapshotDigest, ...material } = snapshot;
  if (sha256(material) !== snapshotDigest) throw new Error('conversation_snapshot_digest_invalid');
  if (snapshot.externalEffectsExecuted !== 0) throw new Error('conversation_external_effect_forbidden');
}

function itemMaterial(card: PushApprovalCard, state: ApprovalInboxState, enqueuedAt: string, deliveries: readonly ApprovalDeliveryReceipt[], decisions: readonly ApprovalDecisionRecord[], terminalDecisionDigest: string | undefined) {
  return {
    version: '33.2' as const,
    card,
    state,
    enqueuedAt,
    deliveries,
    decisions,
    ...(terminalDecisionDigest === undefined ? {} : { terminalDecisionDigest }),
    externalEffectsExecuted: 0 as const,
  };
}

function rebuildItem(item: ApprovalInboxItem, state: ApprovalInboxState, deliveries: readonly ApprovalDeliveryReceipt[], decisions: readonly ApprovalDecisionRecord[], terminalDecisionDigest: string | undefined): ApprovalInboxItem {
  const material = itemMaterial(item.card, state, item.enqueuedAt, Object.freeze([...deliveries]), Object.freeze([...decisions]), terminalDecisionDigest);
  const rebuilt: ApprovalInboxItem = { ...material, itemDigest: sha256(material) };
  verifyInboxItem(rebuilt, new Date(0), true);
  return rebuilt;
}

export function verifyInboxItem(item: ApprovalInboxItem, now = new Date(), allowExpired = false): void {
  if (item.version !== '33.2') throw new Error('approval_inbox_version_invalid');
  verifyCard(item.card);
  instant(item.enqueuedAt, 'approval_enqueue_time_invalid');
  if (!['PENDING', 'DELIVERED', 'DECIDED', 'EXPIRED'].includes(item.state)) throw new Error('approval_inbox_state_invalid');
  const deliveryIds = new Set<string>();
  for (const delivery of item.deliveries) {
    if (delivery.version !== '33.2' || delivery.cardId !== item.card.cardId || delivery.tenantId !== item.card.tenantId || delivery.cardDigest !== item.card.cardDigest || delivery.externalEffectsExecuted !== 0) throw new Error('approval_delivery_binding_invalid');
    if (!item.card.approverIds.includes(delivery.approverId)) throw new Error('approval_delivery_actor_invalid');
    if (deliveryIds.has(delivery.deliveryId)) throw new Error('approval_delivery_duplicate');
    deliveryIds.add(delivery.deliveryId);
    const { deliveryDigest, ...material } = delivery;
    if (sha256(material) !== deliveryDigest) throw new Error('approval_delivery_digest_invalid');
  }
  const decisionIds = new Set<string>();
  const terminal = item.decisions.filter((decision) => decision.option !== 'EXPLAIN');
  for (const decision of item.decisions) {
    if (decision.cardId !== item.card.cardId || decision.tenantId !== item.card.tenantId || decision.cardDigest !== item.card.cardDigest || decision.externalEffectsExecuted !== 0) throw new Error('approval_decision_binding_invalid');
    if (decisionIds.has(decision.decisionId)) throw new Error('approval_decision_duplicate');
    const { decisionDigest, ...material } = decision;
    if (sha256(material) !== decisionDigest) throw new Error('approval_decision_digest_invalid');
    decisionIds.add(decision.decisionId);
  }
  if (terminal.length > 1) throw new Error('approval_multiple_terminal_decisions');
  if (item.state === 'DECIDED' && terminal.length !== 1) throw new Error('approval_terminal_state_invalid');
  if (item.terminalDecisionDigest !== terminal[0]?.decisionDigest) throw new Error('approval_terminal_digest_invalid');
  if (item.externalEffectsExecuted !== 0) throw new Error('approval_external_effect_forbidden');
  if (!allowExpired && now.getTime() >= instant(item.card.expiresAt, 'approval_expiry_invalid') && item.state !== 'DECIDED') throw new Error('approval_card_expired');
  const { itemDigest, ...material } = item;
  if (sha256(material) !== itemDigest) throw new Error('approval_inbox_digest_invalid');
}

function verifyCard(card: PushApprovalCard): void {
  if (card.version !== '33.1') throw new Error('approval_card_version_invalid');
  identifier(card.cardId, 'approval_card_id_required');
  identifier(card.tenantId, 'tenant_id_required');
  digest(card.cardDigest, 'approval_card_digest_invalid');
  const { cardDigest, ...material } = card;
  if (sha256(material) !== cardDigest) throw new Error('approval_card_digest_invalid');
}

function conversationKey(tenantId: string, missionId: string): string {
  return `${identifier(tenantId, 'tenant_id_required')}\u0000${identifier(missionId, 'mission_id_required')}`;
}
function inboxKey(tenantId: string, cardId: string): string {
  return `${identifier(tenantId, 'tenant_id_required')}\u0000${identifier(cardId, 'approval_card_id_required')}`;
}
function identifier(value: string, code: string): string {
  const normalized = value.trim();
  if (normalized === '' || normalized.length > 256) throw new Error(code);
  return normalized;
}
function text(value: string, code: string, max: number): string {
  const normalized = value.trim().replace(/\r\n/g, '\n');
  if (normalized === '' || normalized.length > max) throw new Error(code);
  return normalized;
}
function digest(value: string, code: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(code);
  return value;
}
function instant(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}
function validNow(now: Date): void {
  if (!Number.isFinite(now.getTime())) throw new Error('current_time_invalid');
}
function unique(values: readonly string[], code: string): readonly string[] {
  const normalized = values.map((value) => identifier(value, code));
  if (new Set(normalized).size !== normalized.length) throw new Error(code);
  return Object.freeze([...normalized]);
}
function atomicReplace(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, contents, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}
function fsyncDirectory(path: string): void {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
