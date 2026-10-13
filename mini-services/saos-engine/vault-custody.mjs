/**
 * vault-custody.mjs — R-VAULTPASS-1 (zai-code-3, 2026-10-11T22:5xZ)
 *
 * LAW: passphrase material left the repo. The bundle lives ONLY in the
 * Actions secret STEEM_VAULT_PASSES (on roshpinacare-sys/steem and
 * roshpinacare-sys/saos-runtime — the two places the engine executes),
 * shape: {"gen1": {"keysZipUnlock": .., "keysBackupUnlock": ..},
 *         "recovery-3": {"keysZipUnlock": .., "keysBackupUnlock": ..}}.
 *
 * Resolution: era refs are stable ("gen1" / "recovery-3"); metas read from
 * commit-pinned history predate the ref fields, so callers pass
 * meta.keysZipUnlockRef ?? "<era>.keysZipUnlock". Fail-loud, no repo fallback:
 * if the env bundle is absent the probe refuses to run (honest death beats
 * silent forgery of custody).
 */

export function vaultPass(ref) {
  if (typeof ref !== "string" || ref.indexOf(".") < 1) {
    throw new Error("vault-custody: malformed passRef — expected '<era>.<field>'");
  }
  const raw = process.env.STEEM_VAULT_PASSES;
  if (!raw) {
    throw new Error(
      "vault-custody: STEEM_VAULT_PASSES absent — pass material moved off-repo " +
      "(R-VAULTPASS-1, 2026-10-11); inject the sealed bundle via env on the host " +
      "that runs this probe (steem + saos-runtime secrets)"
    );
  }
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch (e) {
    throw new Error("vault-custody: bundle is not valid JSON — refusing");
  }
  let v = bundle;
  for (const k of ref.split(".")) {
    if (v == null || typeof v !== "object" || !(k in v)) {
      throw new Error("vault-custody: bundle missing " + ref);
    }
    v = v[k];
  }
  if (typeof v !== "string" || v.length < 8) {
    throw new Error("vault-custody: bundle value for " + ref + " malformed — refusing");
  }
  return v;
}
