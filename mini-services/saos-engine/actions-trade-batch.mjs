/**
 * actions-trade-batch.mjs — the SOVEREIGN TRADE BATCH for GitHub Actions.
 * ═══════════════════════════════════════════════════════════════════════════
 * 2026-10-29 owner directive: "הריבונות היא הבעלים... צריך לבצע" — the
 * engine must LIVE somewhere permanent. The sandbox died; Actions is the
 * sovereign runtime. This batch:
 *   1. boots custody (master credential + army cache, ALL chain-judged)
 *   2. runs the REAL army-grid doctrine (startArmyGrid interval) for
 *      TRADE_MS milliseconds — live limit_order_create/cancel broadcasts
 *      on custody-verified, RC-fed, liquid hands
 *   3. flushes receipts (state/) to stdout files for the workflow to commit
 * LAWS: executeAs gate stack unchanged; no transfers-out; no delegations;
 * fail-honest verdicts; zero secrets in any output.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..", ".."); // steem repo root
const TRADE_MS = Number(process.env.TRADE_MS ?? 360_000); // 6 min trading window
const OUT = process.env.RECEIPTS_DIR ?? "/tmp/receipts";

function copyState(srcName, outName) {
  try {
    const src = path.join(DIR, "state", srcName);
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(OUT, { recursive: true });
    fs.copyFileSync(src, path.join(OUT, outName ?? srcName));
  } catch { /* fail-soft */ }
}

async function main() {
  console.log(`[trade-batch] boot at ${new Date().toISOString()} trade_ms=${TRADE_MS}`);
  const signer = await import("./signer.mjs");
  const revival = await import("./vault-revival.mjs");

  // ── 1. master credential (password-derived, chain-judged inside) ────────
  /* T-594 (2026-11-04): the key FILE is one delivery channel, never the
   * custody (R302 law) — when it is absent (sandbox cold-reset), the
   * crown-vault-adopt path below revives the master identity in-memory,
   * chain-judged. Boot must survive its absence instead of dying on ENOENT. */
  const MASTER_KEY = path.join(REPO, ".secrets", "headcorner.key");
  if (fs.existsSync(MASTER_KEY)) {
    const keyText = fs.readFileSync(MASTER_KEY, "utf8");
    const adopt = signer.adoptCredentialText(keyText, { source: "actions-unseal" });
    console.log(`[trade-batch] master credential: ${adopt.ok ? "ADOPTED fp=" + adopt.fingerprint : "REFUSED " + adopt.reason}`);
  } else {
    console.log("[trade-batch] master key file absent — crown-vault-adopt is the revival path (R302)");
  }

  // ── 2. army custody from the sealed cache (every WIF chain-judged) ──────
  const rev = await revival.reviveArmyCustody().catch((e) => ({ error: String(e?.message ?? e).slice(0, 200) }));
  if (rev?.error) console.log(`[trade-batch] revival note: ${rev.error}`);

  // ── 2b. VAULT-OF-RECORD ADOPTION (crown custody, chain-judged, in-process) ──
  /* T-594: the GEN-1 git carriers are dead on origin (measured: no
   * agent/vault/GEN-1-ERA-META.json on any reachable ref) — while the vault
   * of record .secrets/custody-vault/ holds chain-verified WIFs for the
   * whole fleet (judge CUSTODY-ALIVE 13/13 every patrol). Same lawful
   * adoption path, fail-closed, in-process so the signing rail sees the
   * identities. Multi-role: active AND posting (limit_order needs active). */
  const adoptMod = await import("./crown-vault-adopt.mjs");
  const adoptRes = await adoptMod.runAdopt().catch((e) => ({ ok: false, verdict: "REFUSED", reason: String(e?.message ?? e).slice(0, 200), verified: 0, total: 0 }));
  console.log(`[trade-batch] crown-adopt: ${JSON.stringify({ verdict: adoptRes.verdict ?? (adoptRes.ok ? "ADOPTED" : "REFUSED"), verified: adoptRes.verified, total: adoptRes.total, reason: adoptRes.reason ?? null })}`);
  const custody = signer.armyCustodyState(revival.ARMY_ROSTER_VAULT ?? []);
  console.log(`[trade-batch] custody: ${JSON.stringify(custody)}`);

  // ── 3. trade window: the REAL army-grid loop ─────────────────────────────
  const army = await import("./armygrid.mjs");
  army.startArmyGrid();
  const dexflow = await import("./dexflow.mjs");
  try { dexflow.startDexFlow(); console.log("[trade-batch] dexflow: STARTED"); } catch (e) { console.log(`[trade-batch] dexflow: ${String(e?.message ?? e).slice(0, 120)}`); }

  await new Promise((r) => setTimeout(r, TRADE_MS));

  // ── 4. flush receipts ────────────────────────────────────────────────────
  try { fs.mkdirSync(OUT, { recursive: true }); } catch { /* */ }
  const state = army.armyGridState();
  fs.writeFileSync(path.join(OUT, "army-grid-state.json"), JSON.stringify({ at: new Date().toISOString(), ...state }, null, 2));
  for (const [src, out] of [
    ["army-grid/events.jsonl", "army-grid-events.jsonl"],
    ["exec-log.jsonl", "exec-log.jsonl"],
    ["think-log.jsonl", "think-log.jsonl"],
  ]) copyState(src, out);
  console.log(`[trade-batch] done at ${new Date().toISOString()} — receipts at ${OUT}`);
  console.log(`[trade-batch] final: ${JSON.stringify(state).slice(0, 600)}`);
  process.exit(0);
}

main().catch((e) => { console.error(`[trade-batch] FATAL: ${String(e?.message ?? e)}`); process.exit(1); });
