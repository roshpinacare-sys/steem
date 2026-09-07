/**
 * src/routes/ard-routes.ts — ARD (Agentic Resource Discovery) v0.9-draft publisher route.
 *
 * Route:
 *   GET /.well-known/ai-catalog.json
 *     Returns a spec-conformant ARD catalog with TFA-backed trustManifest
 *     (identity + detached JWS). The JWS is produced by the kernel signer
 *     and wrapped via the thin ARD adapter.
 *
 * Invariants:
 *   - tenantId from x-tenant-id is mandatory — fail-closed.
 *   - The catalog is cached per tenant (30s TTL) to avoid re-signing every request.
 *   - ARD is v0.9 draft; the adapter is labelled as such.
 */

import type { SovereignStack } from "../composition.ts";
import type { Ctx, Res, Route } from "./sovereign-routes.ts";
import { getCachedArdCatalog } from "../../lib/adapter/ard-publisher.ts";
import { verifyArdAgent } from "../../lib/adapter/ard-verifier.ts";

const ok = (body: unknown, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

export function ardRoutes(stack: SovereignStack): Route[] {
  return [
    {
      method: "GET",
      pattern: "/.well-known/ai-catalog.json",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) {
          return err(400, "x-tenant-id header required");
        }
        try {
          const catalog = getCachedArdCatalog({
            tenantId: c.tenantId,
            signer: stack.signer,
            publicKey: stack.publicKey,
          });
          return ok(catalog);
        } catch (e: any) {
          return err(500, e?.message ?? "failed to build ARD catalog");
        }
      },
    },
    {
      method: "POST",
      pattern: "/api/ard/verify",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) {
          return err(400, "x-tenant-id header required");
        }
        const body = c.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return err(400, "request body must be a JSON object");
        }
        const urn = body.urn;
        const trustManifest = body.trustManifest;
        if (!urn || typeof urn !== "string") {
          return err(400, "urn is required and must be a string");
        }
        if (!trustManifest || typeof trustManifest !== "object" || Array.isArray(trustManifest)) {
          return err(400, "trustManifest is required and must be an object");
        }
        try {
          const verdict = verifyArdAgent({
            urn,
            trustManifest: trustManifest as any,
            signer: stack.signer,
          });
          return ok(verdict);
        } catch (e: any) {
          return err(500, e?.message ?? "ARD verification failed");
        }
      },
    },
  ];
}
