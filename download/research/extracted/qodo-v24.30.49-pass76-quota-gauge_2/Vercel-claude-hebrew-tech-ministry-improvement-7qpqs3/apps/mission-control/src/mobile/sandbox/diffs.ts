/**
 * Seed content for the sandbox engine — realistic plans, file sets and
 * unified diffs the simulated Coder "produces". Picked by seeded random so
 * each sandbox run feels distinct but is stable across app restarts.
 */

export interface SeedPatch {
  files: { path: string }[];
  diff: string;
  planSteps: (objective: string) => { description: string; files: string[] }[];
}

export const SEED_PATCHES: SeedPatch[] = [
  {
    files: [{ path: "src/services/retry.ts" }, { path: "tests/retry.test.ts" }],
    planSteps: (o) => [
      { description: `Analyze the objective: ${o}`, files: ["src/services/retry.ts"] },
      { description: "Introduce a bounded exponential-backoff helper", files: ["src/services/retry.ts"] },
      { description: "Cover retry exhaustion and jitter with unit tests", files: ["tests/retry.test.ts"] },
    ],
    diff: `--- a/src/services/retry.ts
+++ b/src/services/retry.ts
@@ -1,4 +1,21 @@
+const MAX_RETRIES = 4;
+const BASE_DELAY_MS = 250;
+
+/** Retry an async operation with exponential backoff + full jitter. */
+export async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
+  let lastErr: unknown;
+  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
+    try {
+      return await fn();
+    } catch (err) {
+      lastErr = err;
+      const cap = BASE_DELAY_MS * 2 ** attempt;
+      await sleep(Math.random() * cap);
+    }
+  }
+  throw lastErr;
+}
+
 export function sleep(ms: number): Promise<void> {
   return new Promise((r) => setTimeout(r, ms));
 }`,
  },
  {
    files: [{ path: "src/api/rate-limiter.ts" }, { path: "src/api/handler.ts" }],
    planSteps: (o) => [
      { description: `Scope the change: ${o}`, files: ["src/api/handler.ts"] },
      { description: "Add a sliding-window rate limiter keyed by client IP", files: ["src/api/rate-limiter.ts"] },
      { description: "Wire the limiter into the request handler", files: ["src/api/handler.ts"] },
    ],
    diff: `--- a/src/api/rate-limiter.ts
+++ b/src/api/rate-limiter.ts
@@ -0,0 +1,16 @@
+const WINDOW_MS = 60_000;
+const MAX_REQUESTS = 120;
+
+const hits = new Map<string, number[]>();
+
+export function allow(ip: string): boolean {
+  const now = Date.now();
+  const windowStart = now - WINDOW_MS;
+  const seen = (hits.get(ip) ?? []).filter((t) => t > windowStart);
+  if (seen.length >= MAX_REQUESTS) {
+    hits.set(ip, seen);
+    return false;
+  }
+  seen.push(now);
+  hits.set(ip, seen);
+  return true;
+}
--- a/src/api/handler.ts
+++ b/src/api/handler.ts
@@ -12,6 +12,10 @@
 export async function handle(req: Request): Promise<Response> {
+  if (!allow(clientIp(req))) {
+    return new Response("rate limit exceeded", { status: 429 });
+  }
+
   const route = matchRoute(req);
   return route.render(req);
 }`,
  },
  {
    files: [{ path: "src/db/migrations/012_add_index.sql" }, { path: "src/db/queries.ts" }],
    planSteps: (o) => [
      { description: `Investigate slow path behind: ${o}`, files: ["src/db/queries.ts"] },
      { description: "Add a covering index for the hot lookup", files: ["src/db/migrations/012_add_index.sql"] },
      { description: "Rewrite the N+1 lookup as a single joined query", files: ["src/db/queries.ts"] },
    ],
    diff: `--- a/src/db/migrations/012_add_index.sql
+++ b/src/db/migrations/012_add_index.sql
@@ -0,0 +1,3 @@
+-- Covers the orders-by-customer hot path (seq scan -> index-only scan)
+CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_customer_created
+  ON orders (customer_id, created_at DESC);
--- a/src/db/queries.ts
+++ b/src/db/queries.ts
@@ -31,9 +31,8 @@
-  const orders = await db.query("SELECT * FROM orders WHERE customer_id = $1", [id]);
-  for (const order of orders) {
-    order.items = await db.query("SELECT * FROM items WHERE order_id = $1", [order.id]);
-  }
+  const orders = await db.query(
+    \`SELECT o.*, json_agg(i.*) AS items
+       FROM orders o LEFT JOIN items i ON i.order_id = o.id
+      WHERE o.customer_id = $1 GROUP BY o.id\`, [id]);
   return orders;`,
  },
];

/** Models the sandbox "AI router" rotates through, with realistic pricing feel. */
export const SEED_MODELS = [
  { provider: "groq", model: "llama-3.3-70b", tier: "T2", centsPer1k: 0.059 },
  { provider: "groq", model: "qwen-2.5-coder-32b", tier: "T2", centsPer1k: 0.079 },
  { provider: "openrouter", model: "deepseek-r1", tier: "T3", centsPer1k: 0.055 },
] as const;
