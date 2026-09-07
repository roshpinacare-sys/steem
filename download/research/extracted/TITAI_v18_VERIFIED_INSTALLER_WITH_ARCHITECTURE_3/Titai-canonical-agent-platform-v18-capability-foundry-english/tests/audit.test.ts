import { describe, it, expect } from "vitest";
import { appendAudit, verifyAuditChain, GENESIS } from "@/lib/engine/audit";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

describe("audit chain", () => {
  it("appends a genesis-linked chain and verifies", () => {
    const a = appendAudit({ actorType: "system", action: "test.one" });
    const b = appendAudit({ actorType: "system", action: "test.two" });
    expect(a.prevHash).toBe(GENESIS);
    expect(b.prevHash).toBe(a.hash);
    const v = verifyAuditChain();
    expect(v.ok).toBe(true);
    expect(v.length).toBeGreaterThanOrEqual(2);
  });

  it("detects tampering with a past entry", () => {
    const row = appendAudit({
      actorType: "system",
      action: "test.tamper",
      payload: { value: 1 },
    });
    // Mutate the persisted payload without recomputing the hash.
    db.update(schema.auditLog)
      .set({ payload: { value: 999 } })
      .where(eq(schema.auditLog.id, row.id))
      .run();
    const v = verifyAuditChain();
    expect(v.ok).toBe(false);
    expect(v.brokenAtId).toBe(row.id);
  });
});
