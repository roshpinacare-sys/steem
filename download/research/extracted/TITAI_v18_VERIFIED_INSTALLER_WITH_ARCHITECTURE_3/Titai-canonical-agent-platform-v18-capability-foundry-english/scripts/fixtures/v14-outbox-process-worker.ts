const [action, databasePath, workerId, idRaw, barrierPath] = process.argv.slice(2);
if (!action || !databasePath || !workerId) throw new Error("missing_arguments");
process.env.DATABASE_PATH = databasePath;
process.env.TITAI_SQLITE_DRIVER = "node:sqlite";
process.env.NODE_NO_WARNINGS = "1";
if (barrierPath) {
  const { readFileSync } = await import("node:fs");
  while (true) {
    try { if (readFileSync(barrierPath, "utf8").trim() === "go") break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const { claimOutboxBatch, markOutboxPublished } = await import("../../src/lib/durable/outbox");
try {
  if (action === "claim") {
    const messages = claimOutboxBatch(workerId, 10, 250, new Date("2026-07-11T13:00:00Z"));
    console.log(JSON.stringify({ ok: true, action, messages }));
  } else if (action === "publish") {
    const published = markOutboxPublished(Number(idRaw), workerId, new Date("2026-07-11T13:00:01Z"));
    console.log(JSON.stringify({ ok: true, action, published }));
  } else throw new Error(`unsupported_action:${action}`);
} catch (error) {
  console.log(JSON.stringify({ ok: false, action, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 2;
}

export {};
