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
  const keyText = fs.readFileSync(path.join(REPO, ".secrets", "headcorner.key"), "utf8");
  const adopt = signer.adoptCredentialText(keyText, { source: "actions-unseal" });
  console.log(`[trade-batch] master credential: ${adopt.ok ? "ADOPTED fp=" + adopt.fingerprint : "REFUSED " + adopt.reason}`);

  // ── 2. army custody from the sealed cache (every WIF chain-judged) ──────
  const rev = await revival.reviveArmyCustody().catch((e) => ({ error: String(e?.message ?? e).slice(0, 200) }));
  const custody = signer.armyCustodyState(revival.ARMY_ROSTER_VAULT ?? []);
  console.log(`[trade-batch] custody: ${JSON.stringify(custody)}`);
  if (rev?.error) console.log(`[trade-batch] revival note: ${rev.error}`);

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
