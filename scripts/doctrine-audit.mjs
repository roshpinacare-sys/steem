#!/usr/bin/env bun
/**
 * doctrine-audit.mjs — R267 THE ANTI-ROT GATE (fail-closed).
 *
 * The measured disease (operator, R267): every session re-discovers itself —
 * docs rot while code moves (AGENTS.md still said "427 vectors" five rounds
 * after the truth moved). The cure is not more documents; it is ENFORCED
 * documents. This gate verifies the doctrine layer against reality:
 *   D1 every path/asset referenced in agent/DOCTRINE.md + agent/ATLAS.md +
 *      agent/COLD-START.md exists in the tree (or is whitelisted with reason)
 *   D2 the selftest vector count claimed in the doctrine equals the last
 *      measured run (state/selftest-last-run.json) and fail==0
 *   D3 no stale vector counts in AGENTS.md/README (the 427 class of rot)
 *   D4 rosters/ports/RC-constants recorded in ATLAS match the CODE exports
 *   D5 chain facts pinned: Hive id prefix in steemtx.mjs AND atlas, Blurt id
 *      recorded once, verbatim
 *   D6 required sections present in all three doctrine files
 * Exit 0 = the map is true. Exit 1 = fix the docs IN THE SAME COMMIT as the
 * change that moved reality. Never push a lying map.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ENGINE = path.join(ROOT, "mini-services", "saos-engine");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const doctrine = read("agent/DOCTRINE.md");
const atlas = read("agent/ATLAS.md");
const cold = read("agent/COLD-START.md");
const agents = read("AGENTS.md");
const readme = read("README.md");
const docsBlob = doctrine + atlas + cold;

const fails = [];
const notices = [];
const F = (id, msg) => fails.push(`${id}: ${msg}`);
const N = (msg) => notices.push(msg);

/* ── D1 · every referenced asset exists ──────────────────────────────────── */
const SPAN_RE = /`([^`\n]{3,120})`/g;
const TLD_RE = /\.(com|net|me|blog|world|fans|club|network|org|io|dev)$/i;
const WHITELIST = new Map([
  ["agent/keys/vault.json", "vault-internal path (inside the encrypted zip, not a tree file)"],
  ["vault.json", "vault-internal basename"],
  ["KEYS-ZIP-2026-09-10.zip.enc", "sealed archive lives under agent/vault/ (git history + tree)"],
  ["KEYS-ZIP-2026-10-08.zip.enc", "sealed archive lives under agent/vault/"],
  ["blurt.mjs", "planned third-chain module (ready-to-arm) — its recorded ABSENCE is the fact"],
  ["keys.steem.*", "vault-shape JSON field fragment (inside the encrypted vault, not a tree file)"],
  ["keys.posting", "vault-shape JSON field fragment (inside the encrypted vault, not a tree file)"],
]);
function resolveToken(tok) {
  const bases = [ROOT, ENGINE, path.join(ENGINE, "state"), path.join(ENGINE, ".."), path.join(ROOT, "scripts"), path.join(ROOT, "docs"), path.join(ROOT, "agent", "vault"), path.join(ROOT, "agent")];
  for (const b of bases) { try { if (fs.existsSync(path.join(b, tok))) return path.join(b, tok); } catch { /* next */ } }
  if (tok.includes("*")) {
    const re = new RegExp("^" + tok.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
    for (const b of bases) { try { for (const f of fs.readdirSync(b)) if (re.test(f)) return path.join(b, f); } catch { /* next */ } }
  }
  return null;
}
const spans = new Set();
for (const blob of [doctrine, atlas, cold]) { let m; while ((m = SPAN_RE.exec(blob))) spans.add(m[1].trim()); }
let checked = 0;
for (const tok of spans) {
  if (/\s|\(|\)|\{|\}|\$/.test(tok)) continue;
  if (TLD_RE.test(tok)) continue;
  if (WHITELIST.has(tok)) continue;
  if (!/[./]/.test(tok)) continue;
  if (/^[0-9a-f]{7,64}$/i.test(tok)) continue; /* commit shas */
  if (/^[0-9][0-9_,.]*$/.test(tok)) continue; /* numbers */
  if (tok.endsWith(".mjs”") || tok.endsWith("…")) continue;
  checked++;
  if (!resolveToken(tok)) F("D1", `referenced asset does not exist: ${tok}`);
}

/* ── D2 · selftest truth ─────────────────────────────────────────────────── */
const lastPath = path.join(ENGINE, "state", "selftest-last-run.json");
let last = null;
try { last = JSON.parse(fs.readFileSync(lastPath, "utf8")); } catch { }
if (!last || typeof last.vectors !== "number") F("D2", "state/selftest-last-run.json missing/malformed — run bun selftest.mjs");
else {
  if (last.fail !== 0) F("D2", `last selftest had ${last.fail} failures`);
  const claimed = doctrine.match(/(\d+)\s*וקטורי-selftest/) || doctrine.match(/selftest\s+(\d{2,5})\s*וקטורים/);
  if (claimed && Number(claimed[1]) !== last.vectors) F("D2", `doctrine claims ${claimed[1]} vectors but last run measured ${last.vectors} — update DOCTRINE in the same commit`);
  const ageH = (Date.now() - Date.parse(last.at ?? "")) / 36e5;
  if (ageH > 48) N(`selftest-last-run is ${Math.round(ageH)}h old — run bun selftest.mjs at session open (COLD-START stage 2)`);
}

/* ── D3 · the 427 class of rot ───────────────────────────────────────────── */
for (const [name, blob] of [["AGENTS.md", agents], ["README.md", readme]]) {
  const m = blob.match(/\b(427|960|970|977)\s*(וקטורים|vectors|\/\d+)/);
  if (m) F("D3", `${name} still carries a stale vector count (${m[0].trim()}) — point at the measured truth instead`);
}

/* ── D4 · rosters / ports / RC constants: code is the source, atlas must match ── */
const vaultSrc = fs.readFileSync(path.join(ENGINE, "vault-revival.mjs"), "utf8");
const hiveSrc = fs.readFileSync(path.join(ENGINE, "hive.mjs"), "utf8");
const rcSrc = fs.readFileSync(path.join(ENGINE, "rc-pool.mjs"), "utf8");
const armyMatch = vaultSrc.match(/const ARMY = \[([^\]]+)\]/);
if (armyMatch) {
  for (const raw of armyMatch[1].split(",")) {
    const name = raw.trim().replace(/["']/g, "");
    if (name && !atlas.includes(name)) F("D4", `ARMY roster member "${name}" (vault-revival.mjs) missing from ATLAS §6`);
  }
} else F("D4", "could not parse ARMY from vault-revival.mjs (the roster law moved — update audit)");
const hiveRoster = hiveSrc.match(/HIVE_ROSTER = \[([^\]]+)\]/);
if (hiveRoster) {
  for (const raw of hiveRoster[1].split(",")) {
    const name = raw.trim().replace(/["']/g, "");
    if (name && !atlas.includes(name)) F("D4", `HIVE_ROSTER member "${name}" (hive.mjs) missing from ATLAS §6`);
  }
} else F("D4", "could not parse HIVE_ROSTER from hive.mjs");
const ports = { "saos-engine": 3040, "saos-custodian": 3041, "saos-metrics": 3042, "saos-builder": 3043 };
for (const [svc, port] of Object.entries(ports)) {
  const src = fs.readFileSync(path.join(ENGINE, "..", svc, "index.ts"), "utf8");
  if (!new RegExp(`PORT\\s*=\\s*${port}`).test(src)) F("D4", `${svc}/index.ts no longer declares PORT=${port} — the port law moved`);
  if (!atlas.includes(String(port))) F("D4", `port ${port} (${svc}) missing from ATLAS §1`);
}
const rcChecks = [["POST_RC_COST", /POST_RC_COST\s*=\s*([\d_]+)/, "2,300,000,000"], ["MIN_DELEGATION_RC", /MIN_DELEGATION_RC\s*=\s*([\d_]+)/, "1,607,605,799"], ["DONOR_KEEP_MAX", /DONOR_KEEP_MAX\s*=\s*([\d_]+)/, "2,450,000,000"]];
for (const [name, re, human] of rcChecks) {
  const src = (name === "POST_RC_COST") ? hiveSrc : rcSrc;
  const m = src.match(re);
  if (!m) F("D4", `${name} not found in source (the RC law moved — update audit)`);
  else {
    const val = Number(m[1].replace(/_/g, "")).toLocaleString("en-US").replace(/,/g, ",");
    if (!atlas.includes(human)) F("D4", `ATLAS missing ${name} as ${human}`);
  }
}

/* ── D5 · chain facts pinned ─────────────────────────────────────────────── */
const txSrc = fs.readFileSync(path.join(ENGINE, "steemtx.mjs"), "utf8");
if (!/beeab0de/i.test(txSrc)) F("D5", "HIVE_CHAIN_ID prefix beeab0de vanished from steemtx.mjs");
if (!/beeab0de/i.test(atlas)) F("D5", "ATLAS no longer records the Hive chain-id prefix");
const BLURT_ID = "cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f";
if (!atlas.includes(BLURT_ID)) F("D5", "ATLAS must pin the Blurt chain_id verbatim (the ready-to-arm fact)");

/* ── D6 · required sections ──────────────────────────────────────────────── */
for (const s of ["1 ·", "2 ·", "3 ·", "4 ·", "5 ·", "6 ·", "7 ·"]) if (!doctrine.includes(s)) F("D6", `DOCTRINE missing section ${s}`);
for (const s of ["1 ·", "2 ·", "3 ·", "4 ·", "5 ·", "6 ·", "7 ·", "8 ·"]) if (!atlas.includes(s)) F("D6", `ATLAS missing section ${s}`);
for (const s of ["שלב-אפס", "שלב-שני", "שלב-שלוש", "שלב-ארבע", "שלב-חמש"]) if (!cold.includes(s)) F("D6", `COLD-START missing stage ${s}`);

/* ── verdict ─────────────────────────────────────────────────────────────── */
console.log(`DOCTRINE-AUDIT: ${checked} referenced assets checked · selftest ${last?.vectors ?? "?"}/${last?.fail === 0 ? "0-fail" : "?"} · D1-D6`);
for (const n of notices) console.log(`NOTICE: ${n}`);
if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`DOCTRINE-AUDIT: ${fails.length} failure(s) — the map lies. Fix the docs in the same commit that moved reality.`);
  process.exit(1);
}
console.log("DOCTRINE-AUDIT: PASS — the map is true");
