import "../_flush.mjs";
/**
 * tests/auth/idp-exchange.test.ts — IdP-integration adapter (v322).
 * mintTfaSsoToken() turns already-verified IdP claims into a TFA bearer JWT
 * that tenant-resolver.ts's existing verifyJwt() path (v321) accepts.
 */
import { test, assert, eq } from "../_harness.mjs";
import { mintTfaSsoToken, IdpExchangeError } from "../../lib/auth/idp-exchange.ts";
import { verifyJwt } from "../../lib/auth/jwt.ts";

const SECRET = "tfa-idp-exchange-test-secret-min-32-bytes!!";

test("HAPPY: mints a token tenant-resolver's verifyJwt accepts, with tenantId + scopes intact", () => {
  const token = mintTfaSsoToken(
    { tenantId: "acme", subject: "okta|user-1", scopes: ["admin:kill-switch"] },
    { secret: SECRET },
  );
  const r = verifyJwt(token, SECRET);
  assert(r.ok, "minted token must verify");
  if (r.ok) {
    eq(r.payload.tenantId, "acme");
    eq(r.payload.sub, "okta|user-1");
    eq(JSON.stringify(r.payload.scopes), JSON.stringify(["admin:kill-switch"]));
    assert(typeof r.payload.exp === "number", "exp should be set");
  }
});

test("EDGE: roles claim is carried through when scopes is absent (tenant-resolver falls back to roles)", () => {
  const token = mintTfaSsoToken({ tenantId: "acme", subject: "user-2", roles: ["admin:kill-switch"] }, { secret: SECRET });
  const r = verifyJwt(token, SECRET);
  assert(r.ok);
  if (r.ok) {
    eq(JSON.stringify(r.payload.roles), JSON.stringify(["admin:kill-switch"]));
    eq(r.payload.scopes, undefined);
  }
});

test("EDGE: default expiry is short-lived (300s) when not overridden", () => {
  const before = Math.floor(Date.now() / 1000);
  const token = mintTfaSsoToken({ tenantId: "acme", subject: "user-3" }, { secret: SECRET });
  const r = verifyJwt(token, SECRET);
  assert(r.ok);
  if (r.ok) {
    const exp = r.payload.exp as number;
    assert(exp >= before + 295 && exp <= before + 305, "default expiry should be ~300s out");
  }
});

test("EDGE: caller can override expiresInSec and issuer", () => {
  const token = mintTfaSsoToken({ tenantId: "acme", subject: "user-4" }, { secret: SECRET, expiresInSec: 60, issuer: "acme-gateway" });
  const r = verifyJwt(token, SECRET);
  assert(r.ok);
  if (r.ok) eq(r.payload.iss, "acme-gateway");
});

test("FAIL-CLOSED: missing tenantId throws IdpExchangeError, never mints a guessed-tenant token", () => {
  let threw = false;
  try {
    mintTfaSsoToken({ tenantId: "", subject: "user-5" }, { secret: SECRET });
  } catch (e) {
    threw = true;
    assert(e instanceof IdpExchangeError, "must throw IdpExchangeError");
    if (e instanceof IdpExchangeError) eq(e.reason, "missing_tenant_id");
  }
  assert(threw, "missing tenantId must throw, not default");
});

test("FAIL-CLOSED: missing subject throws IdpExchangeError, never mints an anonymous token", () => {
  let threw = false;
  try {
    mintTfaSsoToken({ tenantId: "acme", subject: "" }, { secret: SECRET });
  } catch (e) {
    threw = true;
    assert(e instanceof IdpExchangeError);
    if (e instanceof IdpExchangeError) eq(e.reason, "missing_subject");
  }
  assert(threw, "missing subject must throw, not default");
});

test("FAIL-CLOSED: missing secret throws IdpExchangeError before any signing is attempted", () => {
  let threw = false;
  try {
    mintTfaSsoToken({ tenantId: "acme", subject: "user-6" }, { secret: "" });
  } catch (e) {
    threw = true;
    assert(e instanceof IdpExchangeError);
    if (e instanceof IdpExchangeError) eq(e.reason, "missing_secret");
  }
  assert(threw, "missing secret must throw, not default");
});

test("INTEGRATION: a minted token is rejected by verifyJwt under the wrong secret (no cross-tenant leak via secret confusion)", () => {
  const token = mintTfaSsoToken({ tenantId: "acme", subject: "user-7" }, { secret: SECRET });
  const r = verifyJwt(token, "a-totally-different-secret-value!!");
  assert(!r.ok, "wrong secret must fail verification");
});
