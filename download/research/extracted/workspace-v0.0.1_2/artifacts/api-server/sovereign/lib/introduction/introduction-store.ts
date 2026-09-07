/**
 * lib/introduction/introduction-store.ts — In-memory store for cross-tenant introduction requests.
 *
 * Tenant isolation:
 *   • list filters by sourceTenantId (outbox).
 *   • listForTarget filters by targetTenantId (inbox).
 *   • get filters by sourceTenantId (source-side view).
 *   • getWithAccess allows either source or target tenant (shared view).
 * Future: PgIntroductionStore (append-only, survives restart).
 */

import type { IntroductionRequest } from "./types.ts";

export interface IntroductionStore {
  save(req: IntroductionRequest): Promise<void> | void;
  list(tenantId: string): Promise<IntroductionRequest[]> | IntroductionRequest[];
  get(id: string, tenantId: string): Promise<IntroductionRequest | null> | IntroductionRequest | null;
  listForTarget(tenantId: string): Promise<IntroductionRequest[]> | IntroductionRequest[];
  getWithAccess(id: string, tenantId: string): Promise<IntroductionRequest | null> | IntroductionRequest | null;
}

export class InMemoryIntroductionStore implements IntroductionStore {
  private readonly reqs = new Map<string, IntroductionRequest>();

  save(req: IntroductionRequest): void {
    this.reqs.set(req.id, req);
  }

  list(tenantId: string): IntroductionRequest[] {
    return Array.from(this.reqs.values()).filter(
      (r) => r.sourceTenantId === tenantId,
    );
  }

  get(id: string, tenantId: string): IntroductionRequest | null {
    const r = this.reqs.get(id);
    if (!r) return null;
    if (r.sourceTenantId !== tenantId) return null;
    return r;
  }

  listForTarget(tenantId: string): IntroductionRequest[] {
    return Array.from(this.reqs.values()).filter(
      (r) => r.targetTenantId === tenantId,
    );
  }

  getWithAccess(id: string, tenantId: string): IntroductionRequest | null {
    const r = this.reqs.get(id);
    if (!r) return null;
    if (r.sourceTenantId !== tenantId && r.targetTenantId !== tenantId) return null;
    return r;
  }
}
