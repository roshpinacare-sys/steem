#!/usr/bin/env node
/**
 * secret-relay.mjs — the sovereign secret relay (R74).
 *
 * The incident: the operator delivered WEAVE_STEEM_WIF into the Zip vault
 * (16:45:59Z, 2026-09-21) — but the anchor machine that needs it runs in
 * Domain (public minutes), and GitHub secrets never cross repositories.
 * The private-repo quota death means Zip's own machine cannot even run.
 *
 * This relay: runs ONCE inside the repo where the value lives, reads it
 * from the run's own env, seals it with the target repo's public key
 * (libsodium sealed-box — the same pattern key-verify uses), and PUTs it
 * into the target's Actions vault. After that, the target's twins carry
 * their lines on public minutes — unlimited, quota-immune.
 *
 * Custody: the value moves operator-vault → operator-vault inside the
 * same org, via GitHub's own encryption envelope. It is never printed,
 * never logged, never written to disk.
 *
 * Usage (env):
 *   RELAY_SOURCE      — env var name holding the value (default WEAVE_STEEM_WIF)
 *   WEAVE_OPS_PAT     — a PAT with admin on the target repo
 *   RELAY_TARGET_REPO — optional override (default roshpinacare-sys/Domain)
 *   RELAY_TARGET_NAME — optional secret-name override (default = source name)
 *   RELAY_DISPATCH    — optional workflow file to dispatch after relay
 *                       (default weave-anchor-lines.yml)
 */

import { createRequire } from "node:module";
import path from "node:path";

const sodiumDir = process.env.SODIUM_DIR || "/tmp/sodium";
const sodium = createRequire(path.join(sodiumDir, "probe.cjs"))("libsodium-wrappers");

const SOURCE = process.env.RELAY_SOURCE || "WEAVE_STEEM_WIF";
const TARGET_NAME = process.env.RELAY_TARGET_NAME || SOURCE;
const TARGET_REPO = process.env.RELAY_TARGET_REPO || "roshpinacare-sys/Domain";
const DISPATCH_WF = process.env.RELAY_DISPATCH === "" ? "" : (process.env.RELAY_DISPATCH || "weave-anchor-lines.yml");
const PAT = process.env.WEAVE_OPS_PAT || "";

await sodium.ready;

const value = (process.env[SOURCE] || "").trim();

function fail(code, he) {
  console.log(`[relay] ✗ ${code} — ${he}`);
  process.exit(1);
}

async function gh(path, method = "GET", body = null) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `token ${PAT}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function main() {
  console.log(`[relay] boot · ${SOURCE} → ${TARGET_REPO}/actions/secrets/${TARGET_NAME}`);

  if (!value) fail("no-source", `הסוד ${SOURCE} לא סופק לריצה — אין מה להעביר`);
  if (!PAT) fail("no-pat", "WEAVE_OPS_PAT חסר — אין הרשאה לכתוב לכספת היעד");

  // 1. the target repo's public key
  const pk = await gh(`/repos/${TARGET_REPO}/actions/secrets/public-key`);
  if (pk.status !== 200 || !pk.json?.key) {
    fail(
      "public-key",
      `קריאת המפתח-הציבורי של ${TARGET_REPO} נכשלה (HTTP ${pk.status}: ${String(pk.json?.message || "").slice(0, 80)}). ` +
        `אם 403/404 — ל-WEAVE_OPS_PAT אין הרשאת admin על הריפו; החלופה הידנית: הוספת הסוד ידנית ב-Settings > Secrets and variables > Actions של Domain.`
    );
  }

  // 2. sealed-box encrypt (the value never travels in the clear over any log)
  const sealed = sodium.to_base64(
    sodium.crypto_box_seal(
      sodium.from_string(value),
      sodium.from_base64(pk.json.key, sodium.base64_variants.ORIGINAL)
    ),
    sodium.base64_variants.ORIGINAL
  );

  // 3. PUT into the target vault
  const put = await gh(`/repos/${TARGET_REPO}/actions/secrets/${TARGET_NAME}`, "PUT", {
    encrypted_value: sealed,
    key_id: pk.json.key_id,
  });
  if (put.status !== 201 && put.status !== 204) {
    fail("put", `האטימה נדחתה (HTTP ${put.status}: ${String(put.json?.message || "").slice(0, 90)}) — הסוד לא נשמר בשום מקום`);
  }

  // 4. verify by listing (names only — values are never readable)
  const list = await gh(`/repos/${TARGET_REPO}/actions/secrets?per_page=100`);
  const found = (list.json?.secrets || []).find((s) => s.name === TARGET_NAME);
  if (!found) fail("unverified", "ה-PUT התקבל אך הסוד לא נראה ברשימה — דוח כנה, לא מזויף");
  console.log(`[relay] ✓ relayed · ${TARGET_REPO}/actions/secrets/${TARGET_NAME} · updated ${found.updated_at}`);

  // 5. kick the target's machine immediately (public minutes from here on)
  let dispatched = false;
  if (DISPATCH_WF) {
    try {
      const d = await gh(`/repos/${TARGET_REPO}/actions/workflows/${DISPATCH_WF}/dispatches`, "POST", { ref: "main" });
      dispatched = d.status === 204;
      if (!dispatched) console.log(`[relay] ⚠ dispatch non-204 (${d.status}) — the cadence will pick it up anyway`);
    } catch {
      console.log("[relay] ⚠ dispatch failed — the cadence will pick it up anyway");
    }
  }
  console.log(`[relay] ✓ done${dispatched ? ` · ${DISPATCH_WF} dispatched for the first cycle` : ""}`);
  console.log("[relay] הקו מעתה חי על דקות ציבוריות — ריבונות מלאה מפני מות-מכסה בריפואים הפרטיים.");
}

main().catch((e) => fail("unexpected", String(e?.message || e).slice(0, 120)));
