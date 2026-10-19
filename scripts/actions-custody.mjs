/**
 * actions-custody.mjs — R33 writer-custody law (R11-containment).
 *
 * THE LAW (CRITICAL-R11-KEY-BROADCAST + R-VAULTPASS-1): a passphrase that
 * travels with its archive in git IS a plaintext secret in git. Vault-class
 * passes live in GitHub Actions secrets (write-only, server-side encrypted).
 *
 * Seal-time: pushClassPass() PUTs the fresh pass to a per-class secret
 * (VAULT_PASS_<CLASS>) BEFORE the meta is written — a failed PUT aborts the
 * seal, so a pass can never land in recovery-meta.json again.
 *
 * Unseal-time (vault-unseal.mjs): passes resolve from
 *   1. legacy meta.<class>.pass (pre-migration / history-restored metas)
 *   2. env VAULT_PASS_<CLASS>
 *   3. env VAULT_PASSES_R33 (the 2026-10-19 bundle JSON)
 * and if none — typed fail-closed custody error. Never guessed, never inline.
 */

export const CLASS_SECRET = {
  exchangeVault: "VAULT_PASS_EXCHANGE",
  integrationsVault: "VAULT_PASS_INTEGRATIONS",
  walletsVault: "VAULT_PASS_WALLETS",
  agentsVault: "VAULT_PASS_AGENTS",
};

/** Resolve a class pass from env custody (no meta, no git, no guessing). */
export function envPassFor(className) {
  const named = CLASS_SECRET[className];
  if (named && process.env[named]) return process.env[named];
  try {
    const bundle = JSON.parse(process.env.VAULT_PASSES_R33 ?? "");
    const v = bundle?.[className];
    if (typeof v === "string" && v.length >= 8) return v;
    if (v && typeof v.pass === "string" && v.pass.length >= 8) return v.pass;
  } catch {}
  return null;
}

/**
 * PUT a freshly generated class pass into its per-class Actions secret.
 * Returns the secret name. Throws (fail-closed) when token/class unknown or
 * the PUT fails — the caller MUST abort before writing meta in that case.
 */
export async function pushClassPass(className, pass) {
  const secret = CLASS_SECRET[className];
  if (!secret) throw new Error(`actions-custody: no secret mapping for class ${className}`);
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  if (!token) throw new Error(`actions-custody: GH_TOKEN/GITHUB_TOKEN absent — refusing to seal ${className} with a stranded pass (fail-closed)`);
  const repoSlug = process.env.GH_REPO_SLUG ?? "roshpinacare-sys/steem";
  const pkRes = await fetch(`https://api.github.com/repos/${repoSlug}/actions/secrets/public-key`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!pkRes.ok) throw new Error(`actions-custody: public-key HTTP ${pkRes.status}`);
  const pk = await pkRes.json();
  const { sealedBox } = await sealedBoxFactory();
  const encrypted_value = sealedBox(Buffer.from(pass, "utf8"), Buffer.from(pk.key, "base64"));
  const put = await fetch(`https://api.github.com/repos/${repoSlug}/actions/secrets/${secret}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ encrypted_value, key_id: pk.key_id }),
  });
  if (!(put.status === 201 || put.status === 204)) {
    throw new Error(`actions-custody: PUT ${secret} HTTP ${put.status} — aborting seal before meta write`);
  }
  return secret;
}

/* libsodium sealed box via tweetnacl+blakejs when installed; fail-closed otherwise. */
let sealedBoxPromise = null;
function sealedBoxFactory() {
  sealedBoxPromise ??= (async () => {
    const nacl = (await import("tweetnacl").catch(() => null));
    const blakejs = (await import("blakejs").catch(() => null));
    if (!nacl || !blakejs) throw new Error("actions-custody: tweetnacl/blakejs unavailable — cannot seal to Actions (fail-closed)");
    return {
      sealedBox(msg, recipientPk) {
        const esk = nacl.default.box.keyPair();
        const nonce = blakejs.blake2b(new Uint8Array([...esk.publicKey, ...new Uint8Array(recipientPk)]), undefined, 24);
        const boxed = nacl.default.box(new Uint8Array(msg), nonce, new Uint8Array(recipientPk), esk.secretKey);
        return Buffer.from([...esk.publicKey, ...boxed]).toString("base64");
      },
    };
  })();
  return sealedBoxPromise;
}
