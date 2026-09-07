/**
 * lib/events/index.ts — public API of the event-bus module.
 */
export type {
  DomainEvent,
  OutboxEntry,
  OutboxStatus,
  AttemptRecord,
  EventHandler,
  Subscription,
  EventBus,
  ISOTimestamp,
  EventId,
} from "./types.ts";

export { InMemoryOutbox } from "./outbox.ts";
