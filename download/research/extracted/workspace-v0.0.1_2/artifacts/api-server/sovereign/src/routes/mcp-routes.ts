/**
 * src/routes/mcp-routes.ts — HTTP bridge for TfaMcpServer (MCP JSON-RPC 2.0).
 *
 * Exposes a single HTTP endpoint:
 *   POST /api/mcp
 *     Accept a JSON-RPC 2.0 request body, dispatch to TfaMcpServer.handleRequest(),
 *     and return the JSON-RPC 2.0 response.
 *
 * Design invariants:
 *   • tenantId from x-tenant-id is mandatory and is injected into every request
 *     that reaches TfaMcpServer. The server further validates it on tool calls
 *     that require tenant scope.
 *   • fail-closed: malformed JSON → 400; TfaMcpServer returns null (notification)
 *     → 204 No Content; any response → 200.
 *   • Rate limiting and structured logging are handled upstream by the express-adapter
 *     (same as all other routes).
 *   • Authentication (optional): if x-api-key is present, it must carry the "mcp:execute"
 *     scope (or "superadmin"). If no key is provided, the request is passed through with
 *     only x-tenant-id validation (anonymous access allowed — caller policy).
 *     fail-closed: key present but scope missing → 403.
 *   • No business logic here — this is a thin transport bridge only.
 *   • The MCP server instance is created once via mcpServerFromStack() in composition
 *     and injected here; this route does NOT construct its own TfaMcpServer.
 *
 * MCP JSON-RPC 2.0 contract:
 *   Request body: { jsonrpc: "2.0", id?: string|number, method: string, params?: object }
 *   Response 200: { jsonrpc: "2.0", id, result: ... } or { jsonrpc: "2.0", id, error: ... }
 *   Response 204: for notifications (no id field in request → handleRequest returns null)
 *   Response 400: body is not valid JSON or not a JSON-RPC 2.0 object
 */

import type { TfaMcpServer } from "../../lib/mcp-server/mcp-server.ts";
import { requireScope } from "../../lib/rbac/require-scope.ts";

interface Ctx {
  tenantId: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  /**
   * API-key scopes resolved by ApiKeyService middleware.
   * undefined = no x-api-key header present (anonymous, passthrough).
   * string[]  = key was present and validated; scope check applies.
   */
  scopes?: string[];
}

interface Res {
  status: number;
  body: unknown;
}

interface Route {
  method: string;
  pattern: string;
  handler: (ctx: Ctx) => Promise<Res>;
}

const err = (status: number, message: string): Res => ({ status, body: { error: message } });

/**
 * mcpRoutes — returns the MCP JSON-RPC 2.0 HTTP bridge route.
 *
 * @param mcpServer - TfaMcpServer instance (created via mcpServerFromStack in composition).
 */
export function mcpRoutes(mcpServer: TfaMcpServer): Route[] {
  return [
    // ── POST /api/mcp ─────────────────────────────────────────────────────────
    // Transport bridge: HTTP body → TfaMcpServer.handleRequest() → HTTP response.
    //
    // Error handling:
    //   • body is not an object → 400 (fail-closed; avoid sending arbitrary data to MCP server)
    //   • handleRequest returns null (MCP notification, no id) → 204 No Content
    //   • handleRequest returns a response → 200 with the JSON-RPC response body
    //   • Unexpected throw in handleRequest → 500
    {
      method: "POST",
      pattern: "/api/mcp",
      handler: async (c: Ctx): Promise<Res> => {
        // tenantId is required by the express-adapter before this handler is called.
        // We re-validate defensively (fail-closed).
        if (!c.tenantId || typeof c.tenantId !== "string") {
          return err(400, "x-tenant-id header required");
        }

        // Optional API-key scope check (fail-closed when key is present):
        //   • c.scopes === undefined → no key provided → passthrough (anonymous allowed)
        //   • c.scopes is an array   → key present → must include "mcp:execute" or "superadmin"
        if (c.scopes !== undefined) {
          const denial = requireScope(c.scopes, "mcp:execute");
          if (denial) return denial;
        }

        // Validate body shape — must be a non-null object (JSON-RPC 2.0 message)
        if (!c.body || typeof c.body !== "object" || Array.isArray(c.body)) {
          return err(400, "request body must be a JSON-RPC 2.0 object");
        }

        const body = c.body as Record<string, unknown>;

        // Minimal JSON-RPC 2.0 structure validation (fail-closed)
        if (body.jsonrpc !== "2.0") {
          return err(400, "invalid JSON-RPC 2.0 request: jsonrpc must be \"2.0\"");
        }

        if (typeof body.method !== "string" || !body.method) {
          return err(400, "invalid JSON-RPC 2.0 request: method is required and must be a string");
        }

        // Build the JsonRpcRequest shape that TfaMcpServer.handleRequest expects
        const rpcRequest = {
          jsonrpc: "2.0" as const,
          id: body.id as string | number | undefined,
          method: body.method as string,
          params: (body.params ?? {}) as Record<string, unknown>,
          // Inject tenantId into params so tool handlers can read it.
          // TfaMcpServer reads tenantId from params.tenantId on capability-gated tools.
          // This is additive — it does NOT override an explicit params.tenantId (if already
          // present, the caller's intent wins; if absent, we supply it from the header).
          _tenantId: c.tenantId, // internal, not part of MCP spec
        };

        // If params is an object but doesn't have tenantId, inject it
        if (
          rpcRequest.params &&
          typeof rpcRequest.params === "object" &&
          !("tenantId" in rpcRequest.params)
        ) {
          (rpcRequest.params as Record<string, unknown>).tenantId = c.tenantId;
        }

        let result: Awaited<ReturnType<TfaMcpServer["handleRequest"]>>;
        try {
          result = await mcpServer.handleRequest(rpcRequest);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "internal error";
          return err(500, `MCP server error: ${msg}`);
        }

        // Notifications (requests without id) → handleRequest returns null → 204
        if (result === null) {
          return { status: 204, body: null };
        }

        return { status: 200, body: result };
      },
    },
  ];
}
