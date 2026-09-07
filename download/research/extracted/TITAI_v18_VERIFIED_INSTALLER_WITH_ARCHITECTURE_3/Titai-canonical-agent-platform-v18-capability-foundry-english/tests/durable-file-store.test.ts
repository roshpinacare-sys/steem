import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileDurableStore } from "@/lib/durable/json-file-store";
import type { DurableJob } from "@/lib/durable/types";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fixture(now: Date): DurableJob<{ objective: string }> {
  return {
    id: "file-job",
    workflowName: "file-proof",
    payload: { objective: "persist across process boundaries" },
    status: "queued",
    checkpoint: {
      nextStepIndex: 0,
      outputs: {},
      completedStepIds: [],
      revision: 0,
    },
    attempt: 0,
    maxAttempts: 3,
    availableAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

describe("JSON file durable store", () => {
  it("persists jobs atomically and reloads them in a fresh store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "titai-file-store-"));
    dirs.push(dir);
    const path = join(dir, "store.json");
    const now = new Date("2026-07-10T12:00:00.000Z");

    const first = new JsonFileDurableStore(path);
    await first.load();
    await first.createJob(fixture(now));
    const claimed = await first.claimJob("file-job", "worker-a", now, 1_000);
    expect(claimed?.status).toBe("leased");

    const second = new JsonFileDurableStore(path);
    await second.load();
    const reloaded = await second.getJob("file-job");
    expect(reloaded).toMatchObject({
      status: "leased",
      attempt: 1,
      lease: { owner: "worker-a" },
    });
  });
});
