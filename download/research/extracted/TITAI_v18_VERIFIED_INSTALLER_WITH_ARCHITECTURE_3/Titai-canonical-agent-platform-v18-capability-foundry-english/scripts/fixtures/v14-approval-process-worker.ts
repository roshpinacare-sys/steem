const [databasePath, approvalId, userId, decision, expectedRevisionRaw, barrierPath] = process.argv.slice(2);
if (!databasePath || !approvalId || !userId || !decision || expectedRevisionRaw === undefined) throw new Error("missing_arguments");
process.env.DATABASE_PATH = databasePath;
process.env.TITAI_SQLITE_DRIVER = "node:sqlite";
process.env.NODE_NO_WARNINGS = "1";
process.env.AUTH_SECRET = "test-v14-approval-worker-auth-secret-32";
process.env.ENCRYPTION_KEY = "dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25nISE=";
if (barrierPath) {
  const { readFileSync } = await import("node:fs");
  while (true) {
    try { if (readFileSync(barrierPath, "utf8").trim() === "go") break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const { runManager } = await import("../../src/lib/engine/runner");
try {
  const ok = await runManager.resolveApproval(approvalId, decision as "approved" | "rejected", userId, "v14 multiprocess proof", Number(expectedRevisionRaw));
  console.log(JSON.stringify({ ok, decision }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, decision, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 2;
}
setTimeout(() => process.exit(process.exitCode ?? 0), 10);

export {};
