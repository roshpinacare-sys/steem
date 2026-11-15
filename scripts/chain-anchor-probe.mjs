/* CHAIN-ANCHOR-PROBE — R280 law: the on-chain custody anchor must sit in HEAD lineage.
 * Rebuilt 2026-11-15 (owner order "recover-all · prove everything"): the original
 * probe lived only in the sandbox tree and died with a wipe — the beat has honestly
 * reported PROBE-SCRIPT-ABSENT since (G76-g). This rebuild is git-resident.
 *
 * MEASURES (verdicts only, exit codes are the contract with the workflow wrapper):
 *   1. state/custody-anchor.json {at, txid, tip} — the last anchor the witness landed
 *   2. git merge-base --is-ancestor <tip> HEAD — the anchored commit must be part of
 *      the CURRENT tree's history (a rewritten/diverged history = FAILED, loud)
 * Exit 0 = OK (anchor in lineage) · Exit 1 = FAILED (honest red, the wrapper records it).
 * Fail-closed: unreadable state / malformed tip / git errors = FAILED with reason.
 * The STALENESS of the anchor is measured separately by the engine's own dex-takeover
 * gate (anchorAt) — this probe measures LINEAGE, not freshness (division of R316-Z). */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.resolve(DIR, "..", "mini-services", "saos-engine", "state", "custody-anchor.json");

function die(reason) {
  console.log(JSON.stringify({ verdict: "FAILED", reason, at: new Date().toISOString() }));
  process.exit(1);
}

let anchor = null;
try { anchor = JSON.parse(readFileSync(STATE, "utf8")); } catch (e) { die(`anchor-state-unreadable: ${String(e?.message ?? e).slice(0, 90)}`); }
const tip = typeof anchor?.tip === "string" ? anchor.tip.trim() : "";
if (!/^[0-9a-f]{40}$/.test(tip)) die(`anchor-tip-malformed: ${String(anchor?.tip).slice(0, 50)}`);

const ageH = anchor?.at ? Math.round(((Date.now() - (typeof anchor.at === "number" ? anchor.at : Date.parse(anchor.at))) / 3_600_000) * 10) / 10 : null;
let inLineage = false;
try { execFileSync("git", ["merge-base", "--is-ancestor", tip, "HEAD"], { stdio: "pipe" }); inLineage = true; } catch { inLineage = false; }

if (!inLineage) die(`anchor-not-in-lineage: tip ${tip.slice(0, 10)} is not an ancestor of HEAD (history rewritten or foreign branch — the runner is the sole custodian, 26-b)`);

console.log(JSON.stringify({ verdict: "OK", note: "anchor tip in HEAD lineage", tip: tip.slice(0, 10), txid: anchor?.txid ?? null, ageHours: ageH, at: new Date().toISOString() }));
process.exit(0);
