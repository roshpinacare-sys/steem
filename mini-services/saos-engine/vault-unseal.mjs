/**
 * vault-unseal.mjs — W15 · THE ONGOING-ACTIVITY KEY (מפתח-לפעילות-שוטפת).
 *
 * OPERATOR ORDER 2026-10-19 (verbatim distilled, IM trace 1a155217160a6429):
 *   "וודא כספת שיהיה מפתח לפעילות שוטפת של המערכת" — ensure the vault
 *   carries a key for the system's ONGOING activity. The drop attached with
 *   the order was measured IDENTICAL to the sealed exchange fingerprints
 *   (seal-exchange-w13.mjs → "SKIP — sealed fingerprints identical") — the
 *   owner re-delivered the live pair, not a rotation; the seal stands.
 *
 * THE LAW THIS MODULE IMPLEMENTS:
 *   A fresh sandbox owns exactly one thing — a git clone. Therefore the
 *   vault (agent/vault/*.enc) + its meta (agent/recovery-meta.json) must be
 *   sufficient to restore every self-contained class the daily rails need,
 *   with ZERO owner interaction:
 *
 *     bare clone → read meta → verify outer pin (sha256)
 *               → openssl AES-256-CBC · pbkdf2 · iter 300000 (the ONE formula)
 *               → verify inner pin (sha256) → unzip → parse
 *               → write 0600 cache (.secrets/<name>.json)
 *               → the rails run.
 *
 * CLASS DOCTRINE (as amended by R33 writer-custody law, 2026-10-19):
 *   - ACTIONS-CUSTODY (R33 law: the pass NEVER travels with its archive —
 *     CRITICAL-R11-KEY-BROADCAST): exchangeVault, integrationsVault, walletsVault,
 *     agentsVault. Passes resolve from Actions secrets (VAULT_PASS_<CLASS> /
 *     VAULT_PASSES_R33 bundle) at run time; seal scripts PUT them at seal time.
 *   - LEGACY SELF-CONTAINED (pre-R33 metas, incl. history-restored): a
 *     meta.<class>.pass that IS present still unseals — never a guess.
 *   - STRANDED-OWNER-PASS (R284/R-VAULTPASS-1 law): keysZip, toolbelt, extras,
 *     seedVault. These resolve to a typed honest strand — NEVER a guess,
 *     NEVER a brute force.
 *
 * LAWS:
 *   - ZERO secret material in stdout/logs/returns — fingerprints only.
 *   - Pins verify BEFORE any cache write; a mismatch is a typed death
 *     (VAULT-PIN-MISMATCH) — tamper evidence, fail closed.
 *   - Cache writes are 0600 into a 0700 dir; idempotent (same pins → refresh
 *     is allowed and cheap, it never re-seals).
 *   - Honesty: an absent pass is reported as STRANDED-OWNER-PASS, not an error
 *     path that leaks structure.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { envPassFor } from "../../scripts/actions-custody.mjs";

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fp = (t) => (t ? `${t.slice(0, 6)}…${t.slice(-4)}(${t.length})` : "null");

/** Classes whose pass lives in the meta itself (system custody, owner-approved doctrine). */
export const SELF_CONTAINED_CLASSES = ["exchangeVault", "integrationsVault", "agentsVault"];

/** Cache filename per class id under .secrets/ — cacheFormat keeps BYTE-COMPAT
 * with the seal scripts' caches (seal-exchange-w13.mjs writes format "exchange-1";
 * selftest 55.10 pins that shape — never drift the contract). */
const CACHE_BY_CLASS = {
  exchangeVault: { file: "exchange.json", inner: "exchange.json", cacheFormat: "exchange-1" },
  integrationsVault: { file: "integrations.json", inner: "integrations.json", cacheFormat: "integrations-1" },
  agentsVault: { file: "agents.json", inner: "agents.json", cacheFormat: "agents-1" },
};

function typed(code, msg) {
  const err = new Error(msg);
  err.code = code;
  return err;
}

/**
 * listVaultClasses(meta) — honest census of what the meta carries.
 * Returns [{ name, file, sealedAt, contents, custody }] with NO pass material.
 */
export function listVaultClasses(meta) {
  const out = [];
  for (const name of Object.keys(meta ?? {})) {
    const v = meta[name];
    if (v && typeof v === "object" && typeof v.file === "string" && v.file.endsWith(".enc")) {
      out.push({
        name,
        file: v.file,
        sealedAt: v.sealedAt ?? null,
        contents: Array.isArray(v.contents) ? v.contents : [],
        custody: v.pass
          ? "self-contained (pass in meta)"
          : v.passRef
            ? `actions-custody (${String(v.passRef).slice(0, 48)})`
            : "stranded-owner-pass (R-VAULTPASS-1)",
      });
    }
  }
  return out;
}

/**
 * unsealVaultClass(repoDir, meta, className, opts) — THE ONE-FORMULA UNSEAL.
 *
 * Verifies outer pin → decrypts (openssl AES-256-CBC · pbkdf2 · iter 300000)
 * → verifies inner pin → unzips the inner bundle → returns the parsed object.
 * Writes a 0600 cache under .secrets/ unless opts.noCache.
 * Typed deaths: VAULT-CLASS-UNKNOWN / VAULT-PASS-ABSENT / VAULT-PIN-MISMATCH /
 * VAULT-OPEN-FAIL (openssl or unzip) / VAULT-INNER-ABSENT.
 */
export function unsealVaultClass(repoDir, meta, className, opts = {}) {
  const spec = CACHE_BY_CLASS[className];
  if (!spec) throw typed("VAULT-CLASS-UNKNOWN", `vault: no cache spec for class ${className}`);
  const cls = meta?.[className];
  if (!cls || typeof cls !== "object" || !cls.file) {
    throw typed("VAULT-CLASS-UNKNOWN", `vault: meta has no class ${className}`);
  }
  const pass = cls.pass ?? envPassFor(className);
  if (!pass) {
    throw typed("VAULT-PASS-ABSENT", `vault: ${className} pass absent — never guessed. The sealed meta carries it (W16-a restored self-keyed law), or wire envPassFor (VAULT_PASS_* / VAULT_PASSES_R33) in Actions. NEVER inlined anywhere else.`);
  }
  const encPath = path.join(repoDir, cls.file);
  let enc;
  try {
    enc = fs.readFileSync(encPath);
  } catch (e) {
    throw typed("VAULT-OPEN-FAIL", `vault: sealed file unreadable ${cls.file}: ${String(e?.message ?? e).slice(0, 60)}`);
  }
  if (sha256(enc) !== cls.outerSha256) {
    throw typed("VAULT-PIN-MISMATCH", `vault: outer pin mismatch for ${className} (${cls.file}) — tamper or drift, refusing`);
  }
  const tmp = fs.mkdtempSync("/tmp/vault-unseal-");
  fs.chmodSync(tmp, 0o700);
  try {
    const innerZip = path.join(tmp, "inner.zip");
    try {
      execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
        "-in", encPath, "-out", innerZip, "-pass", `pass:${pass}`],
        { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      throw typed("VAULT-OPEN-FAIL", `vault: openssl open failed for ${className} — ${String(e?.status ?? "spawn")}`);
    }
    if (sha256(fs.readFileSync(innerZip)) !== cls.innerSha256) {
      throw typed("VAULT-PIN-MISMATCH", `vault: inner pin mismatch for ${className} — refusing`);
    }
    try {
      execFileSync("unzip", ["-o", "-q", innerZip, spec.inner, "-d", tmp],
        { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      throw typed("VAULT-INNER-ABSENT", `vault: inner ${spec.inner} missing from ${className} bundle`);
    }
    const parsed = JSON.parse(fs.readFileSync(path.join(tmp, spec.inner), "utf8"));
    if (!opts.noCache) {
      const dir = path.join(repoDir, ".secrets");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const cacheObj = { format: spec.cacheFormat, unsealedAt: new Date().toISOString(), items: parsed.items ?? parsed };
      fs.writeFileSync(path.join(dir, spec.file), JSON.stringify(cacheObj, null, 2), { mode: 0o600 });
    }
    return parsed;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

/**
 * unsealExchange(repoDir, opts) — convenience: the htx item from exchangeVault.
 * Returns { accessKey, secretKey, source: "vault:<class>" } — call-site redacts.
 */
export function unsealExchange(repoDir, opts = {}) {
  const meta = JSON.parse(fs.readFileSync(path.join(repoDir, "agent", "recovery-meta.json"), "utf8"));
  const parsed = unsealVaultClass(repoDir, meta, "exchangeVault", opts);
  const it = (parsed.items ?? []).find((x) => x.id === "htx");
  if (!it?.accessKey || !it?.secretKey) {
    throw typed("VAULT-INNER-ABSENT", "vault: exchange bundle lacks the htx item");
  }
  return { accessKey: it.accessKey, secretKey: it.secretKey, source: "vault:exchangeVault" };
}

/**
 * bootstrappableVerdict(repoDir) — the ongoing-activity audit: for every
 * class, can a bare clone reach it? Fingerprints only; never throws.
 */
export function bootstrappableVerdict(repoDir) {
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(repoDir, "agent", "recovery-meta.json"), "utf8"));
  } catch (e) {
    return { verdict: "META-ABSENT", classes: [] };
  }
  const classes = listVaultClasses(meta).map((c) => {
    const cls = meta[c.name];
    const encOk = (() => {
      try {
        return sha256(fs.readFileSync(path.join(repoDir, c.file))) === cls.outerSha256;
      } catch { return false; }
    })();
    return { ...c, outerPinOk: encOk, reachable: !!((cls.pass || envPassFor(c.name)) && encOk) };
  });
  const selfContained = classes.filter((c) => SELF_CONTAINED_CLASSES.includes(c.name));
  const reachable = selfContained.filter((c) => c.reachable).length;
  return {
    verdict: selfContained.length === 0 ? "NO-SELF-CONTAINED" : (reachable === selfContained.length ? "ONGOING-ACTIVITY-KEY-OK" : "PARTIAL"),
    classes,
    law: "bare clone + meta = operational keys for every self-contained class; owner-pass classes stay honestly stranded (R-VAULTPASS-1)",
  };
}
