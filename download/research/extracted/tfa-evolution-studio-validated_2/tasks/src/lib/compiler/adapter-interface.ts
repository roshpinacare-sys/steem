/**
 * TFA Evolution Studio v28 — Adapter Interface
 *
 * Canonical interface definitions for the adapter ecosystem.
 */

import type { AdapterTarget, AdapterLifecycle } from "@/lib/types";

export interface IAdapter {
  target: AdapterTarget;
  lifecycle: AdapterLifecycle;
}

export function createAdapter(target: AdapterTarget, lifecycle: AdapterLifecycle): IAdapter {
  return { target, lifecycle };
}
