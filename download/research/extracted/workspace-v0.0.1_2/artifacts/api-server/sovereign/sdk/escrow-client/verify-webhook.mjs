// @tfa/escrow-client/verify-webhook.mjs — standalone, zero-dependency webhook signature verifier.
//
// Purpose: any consumer (partner, tenant, auditor) can verify a TFA webhook
// callback WITHOUT trusting our code base. Uses only node:crypto — no kernel
// imports, no npm dependencies.
//
// Library mode:
//   import { verifyWebhookSignature } from "@tfa/escrow-client";
//
// CLI mode:
//   node verify-webhook.mjs --secret <secret> --payload '<json>' --signature "sha256=..."

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a TFA webhook HMAC-SHA256 signature.
 *
 * The server signs the raw request body (UTF-8) with the registration secret
 * and sends the result in the `x-tfa-signature` header as:
 *   sha256=<base64(hmac-sha256(secret, payload))>
 *
 * @param {string} secret    The webhook registration secret (UTF-8 string).
 * @param {string} payload   The raw request body exactly as received (UTF-8 string).
 * @param {string} signature The x-tfa-signature header value (must start with "sha256=").
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyWebhookSignature(secret, payload, signature) {
  if (!secret || typeof secret !== "string") {
    return { ok: false, reason: "secret must be a non-empty string" };
  }
  if (payload === undefined || payload === null) {
    return { ok: false, reason: "payload must be a string" };
  }
  if (typeof payload !== "string") {
    return { ok: false, reason: "payload must be a string" };
  }
  if (!signature || typeof signature !== "string") {
    return { ok: false, reason: "signature must be a non-empty string" };
  }
  if (!signature.startsWith("sha256=")) {
    return { ok: false, reason: 'signature must start with "sha256="' };
  }

  try {
    // Reconstruct the expected signature string (including "sha256=" prefix)
    // to match the format produced by WebhookService.signPayload().
    const mac = createHmac("sha256", Buffer.from(secret, "utf8"))
      .update(payload, "utf8")
      .digest("base64");
    const expected = Buffer.from(`sha256=${mac}`, "utf8");
    const actual = Buffer.from(signature, "utf8");
    if (expected.length !== actual.length) {
      return { ok: false, reason: "signature length mismatch" };
    }
    if (!timingSafeEqual(expected, actual)) {
      return { ok: false, reason: "signature does not match payload" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "verification error" };
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { args.help = true; continue; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`flag --${key} requires a value`);
      }
      args[key] = next;
      i++;
      continue;
    }
    args._.push(a);
  }
  return args;
}

function usage() {
  process.stderr.write(
    "Usage: node verify-webhook.mjs --secret <s> --payload '<json>' --signature \"sha256=...\"\n" +
    "  --secret <string>     The webhook registration secret\n" +
    "  --payload <string>    The raw request body (JSON string)\n" +
    "  --signature <string>  The x-tfa-signature header value\n" +
    "  --help, -h            Show this help\n",
  );
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`error: ${e.message}\n`); usage(); process.exit(2); }

  if (args.help) { usage(); process.exit(0); }

  const secret = args.secret;
  const payload = args.payload;
  const signature = args.signature;

  if (!secret || !payload || !signature) {
    process.stderr.write("error: --secret, --payload, and --signature are required\n");
    usage();
    process.exit(2);
  }

  const result = verifyWebhookSignature(secret, payload, signature);
  if (result.ok) {
    process.stdout.write("Webhook signature VALID\n");
    process.exit(0);
  } else {
    process.stdout.write(`Webhook signature INVALID: ${result.reason}\n`);
    process.exit(1);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}` ||
               import.meta.url.endsWith(process.argv[1]);
if (isMain) main();
