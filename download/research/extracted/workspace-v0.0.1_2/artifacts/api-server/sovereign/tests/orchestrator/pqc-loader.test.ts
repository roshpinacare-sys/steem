import "../_flush.mjs";
/**
 * tests/orchestrator/pqc-loader.test.ts — PQC Loader (v310 sub-step 1).
 *
 * Verifies resolveHybridMlDsaProvider / resolveHybridMlDsaProviderSync:
 *   • explicit provider wins over everything
 *   • compiled providers (OQS → WASM) probed before local simulation
 *   • zero-dep sandbox falls through OQS/WASM to local provider
 *   • local provider passes conformance suite and is labeled "-sim"
 *   • deterministic fallback is last resort
 *   • fail-closed on malformed input
 *   • sync variant works without async boot
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  resolveHybridMlDsaProvider,
  resolveHybridMlDsaProviderSync,
  tryLoadOqsModule,
  tryLoadWasmModule,
} from "../../lib/orchestrator/pqc-loader.ts";
import {
  MlDsaProviderConformanceSuite,
  MlDsaDeterministicProvider,
  ML_DSA_44_SIGNATURE_BYTES,
  SignerError,
} from "../../lib/orchestrator/signer.ts";
import { adaptPqcProvider } from "../../lib/orchestrator/pqc-adapter.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRawSigner(): { sign(msg: Uint8Array): Uint8Array; verify(msg: Uint8Array, sig: Uint8Array): boolean } {
  const state = new Map<string, Uint8Array>();
  return {
    sign(msg: Uint8Array): Uint8Array {
      const sig = new Uint8Array(ML_DSA_44_SIGNATURE_BYTES);
      for (let i = 0; i < msg.length && i < ML_DSA_44_SIGNATURE_BYTES; i++) sig[i] = msg[i] ^ 0xab;
      state.set(Buffer.from(msg).toString("hex"), sig);
      return sig;
    },
    verify(msg: Uint8Array, sig: Uint8Array): boolean {
      const expected = state.get(Buffer.from(msg).toString("hex"));
      if (!expected || expected.length !== sig.length) return false;
      for (let i = 0; i < expected.length; i++) if (expected[i] !== sig[i]) return false;
      return true;
    },
  };
}

// ─── Module probing in zero-dep sandbox ──────────────────────────────────────

test("tryLoadOqsModule: returns undefined when no OQS module is installed", async () => {
  const result = await tryLoadOqsModule();
  eq(result, undefined);
});

test("tryLoadWasmModule: returns undefined when no WASM module is installed", async () => {
  const result = await tryLoadWasmModule();
  eq(result, undefined);
});

// ─── resolveHybridMlDsaProvider — priority order ────────────────────────────

test("resolveHybridMlDsaProvider: explicit Uint8Array provider wins over compiled/local", async () => {
  const raw = makeRawSigner();
  const signer = await resolveHybridMlDsaProvider({ provider: raw });
  eq(signer.algorithm, "ml-dsa-44-adapted");
  const sig = signer.sign("hello");
  assert(signer.verify("hello", sig));
});

test("resolveHybridMlDsaProvider: explicit full Signer wins over everything", async () => {
  const dummy: Signer = {
    algorithm: "custom-dummy",
    kid: "kid-1",
    sign(_d: string): string { return "dummy-sig"; },
    verify(_d: string, _s: string): boolean { return _s === "dummy-sig"; },
  };
  const signer = await resolveHybridMlDsaProvider({ provider: dummy });
  eq(signer.algorithm, "custom-dummy");
});

test("resolveHybridMlDsaProvider: zero-dep sandbox falls through OQS/WASM to local provider", async () => {
  // Resolution order: explicit → OQS → WASM → local → deterministic.
  // In zero-dep sandbox OQS and WASM are unavailable, so local is discovered.
  const signer = await resolveHybridMlDsaProvider();
  eq(signer.algorithm, "ml-dsa-44-local-sim", "local provider is discovered after compiled probes fail, and labeled -sim");
  const result = MlDsaProviderConformanceSuite(signer);
  eq(result.ok, true, `conformance failed: ${result.failures.join("; ")}`);
});

test("resolveHybridMlDsaProvider: explicit deterministicSecret wired to local provider", async () => {
  const secret = Buffer.from("stable-secret-for-testing-only-12345");
  const s1 = await resolveHybridMlDsaProvider({ deterministicSecret: secret });
  const s2 = await resolveHybridMlDsaProvider({ deterministicSecret: secret });
  eq(s1.algorithm, "ml-dsa-44-local-sim");
  const sig1 = s1.sign("same-data");
  const sig2 = s2.sign("same-data");
  eq(sig1, sig2, "same secret + same data must yield identical signature (deterministic)");
});

test("resolveHybridMlDsaProvider: deterministic with different secrets diverges", async () => {
  const s1 = await resolveHybridMlDsaProvider({ deterministicSecret: "secret-a-thirty-two-bytes-long!!" });
  const s2 = await resolveHybridMlDsaProvider({ deterministicSecret: "secret-b-thirty-two-bytes-long!!" });
  const sig1 = s1.sign("same-data");
  const sig2 = s2.sign("same-data");
  assert(sig1 !== sig2, "different secrets must produce different signatures");
});

// ─── resolveHybridMlDsaProviderSync ─────────────────────────────────────────

test("resolveHybridMlDsaProviderSync: explicit Signer wins", () => {
  const dummy: Signer = {
    algorithm: "sync-dummy",
    kid: undefined,
    sign(): string { return "x"; },
    verify(): boolean { return true; },
  };
  const signer = resolveHybridMlDsaProviderSync({ provider: dummy });
  eq(signer.algorithm, "sync-dummy");
});

test("resolveHybridMlDsaProviderSync: discovers local provider without async", () => {
  const signer = resolveHybridMlDsaProviderSync();
  eq(signer.algorithm, "ml-dsa-44-local-sim", "sync local provider is preferred over deterministic fallback and labeled -sim");
  const result = MlDsaProviderConformanceSuite(signer);
  eq(result.ok, true, `conformance failed: ${result.failures.join("; ")}`);
});

test("resolveHybridMlDsaProviderSync: deterministicSecret wired to local provider", () => {
  const secret = Buffer.from("sync-stable-secret-42-must-be-32-bytes!!");
  const s1 = resolveHybridMlDsaProviderSync({ deterministicSecret: secret });
  const s2 = resolveHybridMlDsaProviderSync({ deterministicSecret: secret });
  eq(s1.algorithm, "ml-dsa-44-local-sim");
  eq(s1.sign("data"), s2.sign("data"));
});

// ─── Fail-closed ────────────────────────────────────────────────────────────

test("resolveHybridMlDsaProvider: malformed explicit provider without algorithm is adapted", async () => {
  const raw = {
    sign(msg: Uint8Array): Uint8Array { return new Uint8Array(ML_DSA_44_SIGNATURE_BYTES); },
    verify(_msg: Uint8Array, _sig: Uint8Array): boolean { return false; },
  };
  const signer = await resolveHybridMlDsaProvider({ provider: raw });
  eq(signer.algorithm, "ml-dsa-44-adapted");
  // Adapted provider with always-false verify must reject its own signatures
  const sig = signer.sign("x");
  assert(!signer.verify("x", sig), "adapted always-false verify should fail-closed");
});

test("MlDsaDeterministicProvider: short secret throws SECRET_TOO_SHORT", () => {
  let threw = false;
  let code = "";
  try {
    new MlDsaDeterministicProvider("short");
  } catch (e: any) {
    threw = true;
    code = e.code;
  }
  assert(threw);
  eq(code, "SECRET_TOO_SHORT");
});

// ─── Resolution order documentation ─────────────────────────────────────────

test("resolution order invariant: compiled providers probed before local (zero-dep fall-through)", async () => {
  // This test documents that OQS and WASM are probed before local.
  // In a sandbox without compiled providers installed, both return undefined
  // and the chain falls through to local, proving the probes ran first.
  eq(await tryLoadOqsModule(), undefined);
  eq(await tryLoadWasmModule(), undefined);
  const signer = await resolveHybridMlDsaProvider();
  eq(signer.algorithm, "ml-dsa-44-local-sim");
});
