import { describe, expect, it } from "vitest";
import { createEncryptedBackup, restoreEncryptedBackup } from "@/lib/durable/backup";
import { MemoryDurableStore } from "@/lib/durable/memory-store";
import type { DurableJob } from "@/lib/durable/types";

async function snapshotFixture() {
  const store = new MemoryDurableStore();
  const now = new Date("2026-07-10T12:00:00.000Z");
  const job: DurableJob<{ objective: string }> = {
    id: "backup-job",
    workflowName: "proof",
    payload: { objective: "restore me" },
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
  await store.createJob(job);
  return store.snapshot(now);
}

describe("encrypted durable backup", () => {
  it("round-trips a snapshot and restores it into a fresh store", async () => {
    const snapshot = await snapshotFixture();
    const envelope = createEncryptedBackup(
      snapshot,
      "correct horse battery staple",
      new Date("2026-07-10T12:01:00.000Z"),
    );
    const restored = restoreEncryptedBackup(
      envelope,
      "correct horse battery staple",
    );
    const target = new MemoryDurableStore();
    await target.restore(restored);
    expect(await target.getJob("backup-job")).toMatchObject({
      workflowName: "proof",
      payload: { objective: "restore me" },
    });
  });

  it("rejects an incorrect passphrase", async () => {
    const envelope = createEncryptedBackup(
      await snapshotFixture(),
      "correct horse battery staple",
    );
    expect(() => restoreEncryptedBackup(envelope, "wrong password value")).toThrow();
  });

  it("rejects ciphertext tampering", async () => {
    const envelope = createEncryptedBackup(
      await snapshotFixture(),
      "correct horse battery staple",
    );
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] ^= 0xff;
    envelope.ciphertext = bytes.toString("base64");
    expect(() =>
      restoreEncryptedBackup(envelope, "correct horse battery staple"),
    ).toThrow();
  });
});
