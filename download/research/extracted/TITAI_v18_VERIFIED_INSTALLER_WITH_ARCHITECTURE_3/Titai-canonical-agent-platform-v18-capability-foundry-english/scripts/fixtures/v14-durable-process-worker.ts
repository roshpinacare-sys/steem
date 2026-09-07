import { readFileSync } from "node:fs";

const [action, databasePath, jobId, workerId, timestamp, tokenRaw, barrierPath] = process.argv.slice(2);
if (!action || !databasePath || !jobId || !workerId || !timestamp) {
  throw new Error("usage: action databasePath jobId workerId timestamp [token] [barrier]");
}
process.env.DATABASE_PATH = databasePath;
process.env.TITAI_SQLITE_DRIVER = "node:sqlite";
process.env.NODE_NO_WARNINGS = "1";

if (barrierPath) {
  while (true) {
    try {
      if (readFileSync(barrierPath, "utf8").trim() === "go") break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const { SqliteDurableStore } = await import("../../src/lib/durable/sqlite-store");
const store = new SqliteDurableStore();
const now = new Date(timestamp);
try {
  if (action === "claim") {
    const claimed = await store.claimJob(jobId, workerId, now, 250);
    console.log(JSON.stringify({ ok: true, action, claimed: Boolean(claimed), token: claimed?.lease?.token ?? null }));
  } else if (action === "checkpoint") {
    const token = Number(tokenRaw);
    await store.updateCheckpoint(jobId, workerId, token, {
      nextStepIndex: 1,
      outputs: { workerId },
      completedStepIds: ["prepare"],
      revision: 1,
    }, now);
    console.log(JSON.stringify({ ok: true, action, committed: true }));
  } else {
    throw new Error(`unsupported_action:${action}`);
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, action, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 2;
}
