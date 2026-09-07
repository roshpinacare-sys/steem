/**
 * lib/indexer/event-bus.ts — Event-driven auto-projection for the Trust-Graph read model.
 *
 * IndexerEventBus subscribes to domain events (execution.updated, approval.decided,
 * escrow.updated, passport.issued) and automatically projects them into the read-model
 * store. This replaces manual `projectXxx()` calls scattered across the domain.
 *
 * Usage:
 *   const bus = new IndexerEventBus(readModelStore);
 *   bus.emit({ type: "execution.updated", tenantId, workflow });
 *   bus.emit({ type: "passport.issued", tenantId, passport, executionId, approvalId });
 *
 * Fail-closed: projection errors are caught and logged; they never propagate to the
 * caller (the bus is a side-effect channel, not a control-flow path).
 *
 * Zero external dependencies.
 */

import type { IndexerEvent, ReadModelStore } from "./types.ts";

// ─── IndexerEventBus ─────────────────────────────────────────────────────────

/**
 * IndexerEventBus — thin synchronous event dispatcher that drives read-model
 * projections from domain events.
 *
 * The bus does NOT own the store — it receives one at construction time so
 * both InMemoryReadModelStore and PgReadModelStore are supported without coupling.
 */
export class IndexerEventBus {
  private readonly store: ReadModelStore;
  private readonly onError: (err: unknown, event: IndexerEvent) => void;

  /**
   * @param store    The read-model store to project into.
   * @param onError  Optional error handler. Default: logs to console.error.
   *                 Never rethrows — the bus must not interrupt the calling path.
   */
  constructor(
    store: ReadModelStore,
    onError?: (err: unknown, event: IndexerEvent) => void,
  ) {
    this.store = store;
    this.onError = onError ?? ((err, event) => {
      console.error(`[IndexerEventBus] projection error for ${event.type}:`, err);
    });
  }

  /**
   * Emit a domain event and trigger the corresponding projection.
   * Synchronous; never throws (errors are forwarded to `onError`).
   */
  emit(event: IndexerEvent): void {
    try {
      this._dispatch(event);
    } catch (err) {
      this.onError(err, event);
    }
  }

  private _dispatch(event: IndexerEvent): void {
    switch (event.type) {
      case "execution.updated": {
        this.store.projectExecution(event.workflow);
        // Project the actor from the most-recent log entry (last transition wins).
        const lastEntry = event.workflow.runLog.length > 0
          ? event.workflow.runLog[event.workflow.runLog.length - 1]
          : null;
        const actor = lastEntry?.actor ?? "system";
        // The ReadModelStore interface doesn't mandate projectActor (not all impls have it).
        // Cast to any to call it opportunistically when available.
        const s = this.store as any;
        if (typeof s.projectActor === "function") {
          s.projectActor({
            tenantId: event.tenantId,
            actorId: actor,
            actorType: "agent",
            timestamp: event.workflow.updatedAt,
            valueMovedMicrounits: 0n,
          });
        }
        break;
      }

      case "approval.decided": {
        this.store.projectApproval({
          id: event.approvalId,
          tenantId: event.tenantId,
          actionId: event.actionId,
          riskClass: event.riskClass,
          approvalClass: event.approvalClass,
          decisionTrace: event.decisionTrace,
          outcome: event.outcome,
          timestamp: event.timestamp,
          executionId: event.executionId,
        });
        break;
      }

      case "escrow.updated": {
        // projectEscrow may accept an optional opts bag for cross-references
        const s = this.store as any;
        if (typeof s.projectEscrow === "function") {
          s.projectEscrow(event.agreement, { executionId: event.executionId });
        }
        break;
      }

      case "passport.issued": {
        // projectPassport may accept an optional opts bag for cross-references
        const s = this.store as any;
        if (typeof s.projectPassport === "function") {
          s.projectPassport(event.passport, {
            executionId: event.executionId,
            approvalId: event.approvalId,
          });
        }
        break;
      }

      default: {
        // Exhaustiveness guard — unreachable if callers use typed IndexerEvent
        const _exhaustive: never = event;
        throw new Error(`[IndexerEventBus] unknown event type: ${(_exhaustive as any).type}`);
      }
    }
  }
}
