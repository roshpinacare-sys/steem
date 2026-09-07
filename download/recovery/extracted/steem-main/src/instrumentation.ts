/**
 * Task 82 — GUARDIAN boot hook (official Next conditional-import pattern).
 * Every Next.js server start (including a sandbox restored from an OLD
 * snapshot) dispatches the guardian: anti-rollback to origin/main, deps/env
 * healing, daemon respawn, zero-touch fleet restore from the sealed vault.
 * The node-only logic lives in lib/guardian-boot-node.ts so the Edge bundle
 * never touches node modules.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/guardian-boot-node");
  }
}
