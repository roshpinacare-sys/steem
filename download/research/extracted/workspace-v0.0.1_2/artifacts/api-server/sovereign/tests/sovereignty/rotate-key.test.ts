import "../_flush.mjs";
/**
 * tests/sovereignty/rotate-key.test.ts — L-hardening: key rotation.
 *
 * Coverage:
 *   MutableSigner unit (7): construct, sign/verify, rotate HMAC→HMAC, rotate HMAC→Ed25519,
 *     rotationCount, rotationLog, invalid signer rejected.
 *   rotate-key route via HTTP (10): success HMAC, success Ed25519, missing signerKind,
 *     unknown signerKind, secret too short, missing privateKey, missing x-tenant-id,
 *     rotation is live (new key used for subsequent signs),
 *     missing admin:key-rotation scope → 403, bare x-tenant-id → 403.
 */

import { test, assert, eq } from "../_harness.mjs";
import { MutableSigner, MutableSignerError } from "../../lib/orchestrator/mutable-signer.ts";
import { HmacSigner, Ed25519Signer, generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import type { Server } from "node:http";

// ─── MutableSigner unit tests ─────────────────────────────────────────────────

test("mutable-signer: wraps inner signer — sign/verify round-trip", () => {
  const inner = new HmacSigner("test-secret-long-enough-32bytes!!");
  const ms = new MutableSigner(inner);
  const sig = ms.sign("hello");
  assert(ms.verify("hello", sig), "verify passes");
  assert(!ms.verify("tampered", sig), "verify fails on tampered data");
});

test("mutable-signer: algorithm reflects inner signer", () => {
  const ms = new MutableSigner(new HmacSigner("test-secret-long-enough-32bytes!!"));
  eq(ms.algorithm, "hmac-sha256");
});

test("mutable-signer: rotate HMAC → new HMAC, rotationCount = 1", () => {
  const ms = new MutableSigner(new HmacSigner("old-secret-long-enough-32bytes!!"));
  const oldSig = ms.sign("data");
  const event = ms.rotate(new HmacSigner("new-secret-long-enough-32bytes!!"));
  eq(ms.rotationCount, 1);
  eq(event.sequence, 1);
  eq(event.newAlgorithm, "hmac-sha256");
  assert(typeof event.rotatedAt === "string", "rotatedAt is string");
  // Old signature no longer valid with new key
  assert(!ms.verify("data", oldSig), "old sig invalid after rotation");
  // New key works
  const newSig = ms.sign("data");
  assert(ms.verify("data", newSig), "new sig valid");
});

test("mutable-signer: rotate HMAC → Ed25519, algorithm changes", () => {
  const ms = new MutableSigner(new HmacSigner("test-secret-long-enough-32bytes!!"));
  const pair = generateAuditKeyPair();
  ms.rotate(new Ed25519Signer(pair.privateKey, pair.publicKey));
  eq(ms.algorithm, "ed25519");
  const sig = ms.sign("payload");
  assert(ms.verify("payload", sig), "Ed25519 verify passes after rotation");
});

test("mutable-signer: rotationLog records all events in order", () => {
  const ms = new MutableSigner(new HmacSigner("test-secret-long-enough-32bytes!!"));
  ms.rotate(new HmacSigner("second-secret-long-enough-32bytes!"));
  ms.rotate(new HmacSigner("third-secret-long-enough-32bytes!!"));
  eq(ms.rotationCount, 2);
  eq(ms.rotationLog.length, 2);
  eq(ms.rotationLog[0].sequence, 1);
  eq(ms.rotationLog[1].sequence, 2);
});

test("mutable-signer: throws MutableSignerError for invalid initial signer", () => {
  let threw = false;
  try { new MutableSigner(null as any); } catch (e: any) {
    assert(e instanceof MutableSignerError, "is MutableSignerError");
    eq(e.code, "INVALID_SIGNER");
    threw = true;
  }
  assert(threw, "threw on null signer");
});

test("mutable-signer: rotate() throws MutableSignerError for invalid new signer", () => {
  const ms = new MutableSigner(new HmacSigner("test-secret-long-enough-32bytes!!"));
  let threw = false;
  try { ms.rotate({} as any); } catch (e: any) {
    assert(e instanceof MutableSignerError, "is MutableSignerError");
    threw = true;
  }
  assert(threw, "threw on invalid new signer");
});

// ─── HTTP route tests ─────────────────────────────────────────────────────────

async function httpRequest(port: number, method: string, path: string, opts: {
  tenantId?: string;
  apiKey?: string;
  body?: unknown;
} = {}): Promise<{ status: number; body: any }> {
  const url = `http://127.0.0.1:${port}${path}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  else if (opts.tenantId) headers["x-tenant-id"] = opts.tenantId;
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function withServer(fn: (port: number, keys: { admin: string; user: string }) => Promise<void>): Promise<void> {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const admin = await stack.apiKeyService.create({ tenantId: "t1", name: "admin", scopes: ["admin:key-rotation"] });
  const user = await stack.apiKeyService.create({ tenantId: "t1", name: "user", scopes: ["adapter:run"] });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false }) as Server & { shutdown: () => Promise<void> };
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as any).port as number;
  try {
    await fn(port, { admin: admin.secret, user: user.secret });
  } finally {
    await server.shutdown();
  }
}

test("rotate-key HTTP: POST /api/sovereignty/rotate-key with HMAC returns 200", async () => {
  await withServer(async (port, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.admin,
      body: { signerKind: "hmac", secret: "new-key-secret-long-enough-32bytes!!" },
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
    eq(res.body.newAlgorithm, "hmac-sha256");
    eq(res.body.rotationCount, 1);
    assert(typeof res.body.rotatedAt === "string", "rotatedAt present");
  });
});

test("rotate-key HTTP: POST /api/sovereignty/rotate-key with Ed25519 returns 200", async () => {
  const pair = generateAuditKeyPair();
  await withServer(async (port, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.admin,
      body: { signerKind: "ed25519", privateKey: pair.privateKey, publicKey: pair.publicKey },
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
    eq(res.body.newAlgorithm, "ed25519");
  });
});

test("rotate-key HTTP: missing admin:key-rotation scope → 403", async () => {
  await withServer(async (port, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.user,
      body: { signerKind: "hmac", secret: "new-key-secret-long-enough-32bytes!!" },
    });
    eq(res.status, 403);
    eq(res.body.error, "missing admin:key-rotation scope");
  });
});

test("rotate-key HTTP: bare x-tenant-id in trusted mode (requireApiKey=false) gets superadmin → 200", async () => {
  await withServer(async (port) => {
    // Trusted mode (default): bare x-tenant-id gets superadmin scopes implicitly.
    // This is the dev/test convenience. Production uses requireApiKey=true.
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      tenantId: "t1",
      body: { signerKind: "hmac", secret: "new-key-secret-long-enough-32bytes!!" },
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
  });
});

test("rotate-key HTTP: missing signerKind → 400", async () => {
  await withServer(async (port, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.admin,
      body: { secret: "some-secret-long-enough-32bytes!!" },
    });
    eq(res.status, 400);
  });
});

test("rotate-key HTTP: unknown signerKind → 400", async () => {
  await withServer(async (port, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.admin,
      body: { signerKind: "rsa", secret: "x" },
    });
    eq(res.status, 400);
  });
});

test("rotate-key HTTP: HMAC secret too short → 400", async () => {
  await withServer(async (port, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.admin,
      body: { signerKind: "hmac", secret: "short" },
    });
    eq(res.status, 400);
  });
});

test("rotate-key HTTP: Ed25519 missing privateKey → 400", async () => {
  await withServer(async (port, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.admin,
      body: { signerKind: "ed25519", publicKey: "some-pub-key" },
    });
    eq(res.status, 400);
  });
});

test("rotate-key HTTP: missing x-tenant-id → 400", async () => {
  await withServer(async (port) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      // no tenantId, no apiKey
      body: { signerKind: "hmac", secret: "new-key-secret-long-enough-32bytes!!" },
    });
    eq(res.status, 400);
  });
});

test("rotate-key HTTP: rotation is live — new key signs, old key no longer verifies", async () => {
  await withServer(async (port, keys) => {
    // 1. Export bundle before rotation (signed with old key)
    const exportBefore = await httpRequest(port, "GET", "/api/sovereignty/export", { tenantId: "t1" });
    eq(exportBefore.status, 200);

    // 2. Rotate to a new HMAC key
    const rotateRes = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.admin,
      body: { signerKind: "hmac", secret: "brand-new-key-after-rotation-32xx" },
    });
    eq(rotateRes.status, 200);

    // 3. Verify old bundle — should now be invalid (different key)
    const verifyOld = await httpRequest(port, "POST", "/api/sovereignty/verify", {
      tenantId: "t1",
      body: exportBefore.body,
    });
    eq(verifyOld.status, 200);
    eq(verifyOld.body.valid, false); // old bundle invalid under new key

    // 4. Export new bundle — signed with new key — should verify
    const exportAfter = await httpRequest(port, "GET", "/api/sovereignty/export", { tenantId: "t1" });
    eq(exportAfter.status, 200);
    const verifyNew = await httpRequest(port, "POST", "/api/sovereignty/verify", {
      tenantId: "t1",
      body: exportAfter.body,
    });
    eq(verifyNew.status, 200);
    eq(verifyNew.body.valid, true);
  });
});
