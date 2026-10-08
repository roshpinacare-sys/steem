/* SAOS CI-ACT (R243) — the sovereignty bridge runner.
 *
 * THE PROBLEM IT KILLS (operator directive 2026-10-07): "everything you do
 * dies with the sandbox wipe and I'm back in an endless loop". The private
 * repo's Actions minutes are quota-dead (measured 2026-10-07: even
 * `echo hello` fails in 3s, zero steps — private-repo billing wall, the same
 * wall R74 documented on 2026-09-21). The public twin repo (Domain) runs on
 * FREE public minutes and ALREADY holds the relayed key vault
 * (SA_HEAD_ACTIVE, STEEM_POSTING_WIF, MAIN_KEY, ... — vault-transfer, 2026-09-29).
 *
 * THIS RUNNER = the missing leg: it executes ON the public twin, pulls the
 * law repo (saos-cockpit), adopts the master credential CHAIN-JUDGED
 * (the chain is the only judge — keymine-r210 technique), runs ONE engine
 * cycle, lands the durable custody anchor, and speaks on the agent-bus.
 * Sandbox death becomes irrelevant: the loop closes on GitHub + chain.
 *
 * LAWS: fail-closed (no chain-verified credential → exit 1, honest alarm);
 * zero secret material printed, logged, or returned; custody-gated signing
 * (thinkGate) for every op; verdict-only receipts.
 *
 * Usage: bun ci-act.mjs [--cycle-only] [--no-anchor] [--no-bus]
 * Env candidates (first chain-verified winner, in order):
 *   CI_HEADCORNER_CRED  CI_MAIN_KEY  CI_STEEM_POSTING_WIF  CI_SA_HEAD_ACTIVE  CI_WEAVE_STEEM_WIF
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { wifDecode, pubkeyFromSeed, derivePub, SEED_ORDERS } from "./steemtx.mjs";
import { BUS_TYPES } from "./bus.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(DIR, "..", "..");
const RPC = process.env.SAOS_RPC || "https://api.steemit.com";
const ACCOUNT = process.env.SAOS_ACCOUNT || "headcorner";
const UPLOAD_KEY = path.join(REPO, "upload", "headcorner.txt");
const SECRETS = path.join(REPO, ".secrets");

const CANDIDATE_ENVS = [
  "CI_HEADCORNER_CRED", "CI_MAIN_KEY", "CI_STEEM_POSTING_WIF", "CI_SA_HEAD_ACTIVE", "CI_WEAVE_STEEM_WIF",
];

const WIF_RE = /^[5JK][1-9A-HJ-NP-Za-km-z]{50,51}$/;

function sh(cmd, args, cwd = REPO) {
  try { return { out: execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim(), code: 0 }; }
  catch (e) { return { out: (e.stdout ?? "").toString().trim(), code: e.status ?? 1, err: String(e.stderr ?? e.message).slice(0, 200) }; }
}

async function chainAuthorities(account = ACCOUNT) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[account]], id: 1 }),
  });
  const j = await r.json();
  const a = j.result?.[0];
  if (!a) throw new Error("account-not-found");
  return {
    owner: a.owner.key_auths.map((k) => k[0]),
    active: a.active.key_auths.map((k) => k[0]),
    posting: a.posting.key_auths.map((k) => k[0]),
    memo: a.memo_key ? [a.memo_key] : [],
  };
}

/* classify one candidate → {kind, roles:[...]} — NEVER returns the secret */
function classify(cand, auth) {
  const bare = cand.startsWith("P") && cand.length >= 51 ? cand.slice(1) : cand;
  if (WIF_RE.test(bare)) {
    try {
      const stm = pubkeyFromSeed(wifDecode(bare));
      const roles = ["owner", "active", "posting", "memo"].filter((r) => auth[r].includes(stm));
      return roles.length ? { kind: "wif", roles } : null;
    } catch { return null; }
  }
  /* master-password path: every documented seed order × role */
  const hits = [];
  for (const role of ["posting", "active", "owner", "memo"]) {
    for (const [order, fn] of Object.entries(SEED_ORDERS)) {
      try { if (auth[role].includes(derivePub(fn(ACCOUNT, role, cand)))) { hits.push(role); break; } } catch {}
    }
  }
  return hits.length ? { kind: "password", roles: [...new Set(hits)] } : null;
}

/* the credential text the engine natively adopts:
 * password → "account password"; posting WIF → "account P<bare>" (engine law) */
function credentialText(cand, verdict) {
  if (verdict.kind === "password") return `${ACCOUNT} ${cand}`;
  if (verdict.roles.includes("posting")) return `${ACCOUNT} P${cand.startsWith("P") && cand.length >= 51 ? cand.slice(1) : cand}`;
  return null; // active/owner-only WIF cannot sign posting ops — not adoptable here (honest)
}

async function adopt() {
  const auth = await chainAuthorities();
  console.log(`[adopt] chain authorities for ${ACCOUNT}: posting=${auth.posting.length} active=${auth.active.length} (observed)`);
  const tried = [];
  for (const name of CANDIDATE_ENVS) {
    const val = (process.env[name] ?? "").trim();
    if (val.length < 4) continue;
    const v = classify(val, auth);
    tried.push(name);
    if (!v) { console.log(`[adopt] ${name}: no-authority-match (chain refused)`); continue; }
    const text = credentialText(val, v);
    if (!text) { console.log(`[adopt] ${name}: matched ${v.roles.join(",")} but not posting-capable — not adoptable for this runner`); continue; }
    fs.mkdirSync(path.dirname(UPLOAD_KEY), { recursive: true });
    fs.writeFileSync(UPLOAD_KEY, `${text}\n`, { mode: 0o600 });
    console.log(`[adopt] ${name}: CHAIN-VERIFIED kind=${v.kind} roles=${v.roles.join(",")} → upload adoption staged (0600; key material never printed)`);
    return { ok: true, source: name, kind: v.kind, roles: v.roles };
  }
  return { ok: false, tried };
}

async function runCycle() {
  /* the child adopts the SAME chain-judged WIFs in its own process (the
   * engine's lawful runner-adoption path) — parents and children never
   * share memory */
  const sp = spawnSync("bun", ["daily.mjs"], { cwd: DIR, encoding: "utf8", timeout: 15 * 60 * 1000, env: {
    ...process.env,
    CI_ADOPT_WIF_POSTING: (process.env.CI_STEEM_POSTING_WIF ?? "").trim(),
    CI_ADOPT_WIF_ACTIVE: (process.env.CI_STEEM_ACTIVE_WIF ?? "").trim(),
  } });
  const out = `${sp.stdout ?? ""}\n${sp.stderr ?? ""}`;
  const tail = out.slice(-3500);
  /* the engine's OWN durable marker is the truth — not log parsing */
  let marker = null;
  try { marker = JSON.parse(fs.readFileSync(path.join(DIR, "state", "cycle-run.json"), "utf8")); } catch {}
  return { exitCode: sp.status, tail, marker, timedOut: sp.error?.code === "ETIMEDOUT" };
}

/* in-process credential adoption — the parent process needs its own verified
 * identity for the custody anchor + bus ops (the child adopts independently;
 * thinkGate trusts ONLY process-local verified memory — measured refusal).
 * The lawful path is the DIRECT WIF adoption (chain-judged, signer.mjs). */
let INPROC_FP = null; /* the adopted WIF's fingerprint (from the adoption result — never re-derived) */

/* in-process credential adoption — BOTH signing roles (posting + active),
 * each chain-judged via the lawful direct-WIF path. Then the staged upload
 * key is consumed INTO .secrets by THIS process (no child race) and the
 * child gets the same WIFs via CI_ADOPT_WIF_* env (engine-side adoption). */
async function adoptInProcess() {
  const out = {};
  /* R276: the MASTER credential first — CI_HEADCORNER_CRED is chain-judged for
   * the master account itself (posting). Measured incident 2026-10-08 14:51Z:
   * without this adoption the parent's custody check read master-unverified
   * (the army envs are cashmachine keys — they can never verify HEAD by
   * definition) and the custody anchor refused CUSTODY-REFUSED:master-unverified
   * even though the chain-proven credential was already staged to the keyfile. */
  {
    const raw = (process.env.CI_HEADCORNER_CRED ?? "").trim();
    if (!raw) { out.master = { ok: false, verdict: "absent" }; }
    else try {
      const bare = raw.startsWith("P") && raw.length >= 51 ? raw.slice(1) : raw;
      const { adoptVerifiedWifIdentity } = await import("./signer.mjs");
      const r = await adoptVerifiedWifIdentity(ACCOUNT, bare, { role: "posting" });
      if (r?.ok) INPROC_FP = r.fingerprint ?? INPROC_FP;
      out.master = { ok: !!r?.ok, verdict: String(r?.ok ? `wif-verified-fp=${r.fingerprint}` : (r?.reason ?? "adoption-refused")).slice(0, 120) };
    } catch (e) {
      out.master = { ok: false, verdict: `error:${String(e).slice(0, 80)}` };
    }
  }
  for (const [role, envName] of [["posting", "CI_STEEM_POSTING_WIF"], ["active", "CI_STEEM_ACTIVE_WIF"]]) {
    const raw = (process.env[envName] ?? "").trim();
    if (!raw) { out[role] = { ok: false, verdict: "absent" }; continue; }
    try {
      const bare = raw.startsWith("P") && raw.length >= 51 ? raw.slice(1) : raw;
      const { adoptVerifiedWifIdentity } = await import("./signer.mjs");
      const r = await adoptVerifiedWifIdentity(ACCOUNT, bare, { role });
      if (r?.ok) INPROC_FP = r.fingerprint ?? INPROC_FP;
      out[role] = { ok: !!r?.ok, verdict: String(r?.ok ? `wif-verified-fp=${r.fingerprint}` : (r?.reason ?? "adoption-refused")).slice(0, 120) };
    } catch (e) {
      out[role] = { ok: false, verdict: `error:${String(e).slice(0, 80)}` };
    }
  }
  /* stable key file for the whole process tree — consume the staged upload
   * key HERE (the child then adopts from .secrets; no upload race) */
  try {
    if (fs.existsSync(UPLOAD_KEY)) {
      const text = fs.readFileSync(UPLOAD_KEY, "utf8").trim();
      fs.mkdirSync(SECRETS, { recursive: true });
      fs.writeFileSync(path.join(SECRETS, "headcorner.key"), `${text}\n`, { mode: 0o600 });
      fs.rmSync(UPLOAD_KEY, { force: true });
      console.log("[keyfile] .secrets/headcorner.key staged (0600; upload copy consumed)");
    }
  } catch { /* fail-soft — the child's own syncCredential still covers it */ }
  return out;
}

/* durable ≤1/h law — same state stamp the custodian commits */
function lastAnchorMs() {
  try { return Number(JSON.parse(fs.readFileSync(path.join(DIR, "state", "custody-anchor.json"), "utf8")).at) || 0; } catch { return 0; }
}

async function custodyAnchor() {
  const { thinkGate, executeAs, custodyOf } = await import("./signer.mjs");
  const last = lastAnchorMs();
  if (Date.now() - last < 3600000) return { ok: true, verdict: "RATE-LIMITED-DURABLE", last };
  /* custody check uses the process-local VERIFIED identity (adopted via the
   * chain-judged direct-WIF path) — never a password re-derivation */
  const co = custodyOf(ACCOUNT);
  if (co !== "master-verified") return { ok: false, verdict: `CUSTODY-REFUSED:${co}` };
  const tip = sh("git", ["rev-parse", "HEAD"]).out;
  const ops = [["custom_json", { required_auths: [], required_posting_auths: [ACCOUNT], id: "saos-git-custody-v1", json: JSON.stringify({ branch: "saos-cockpit", tip, at: new Date().toISOString(), src: "ci-act", fp: INPROC_FP }) }]];
  const gate = thinkGate(ACCOUNT, ops, { source: "ci-custody-witness" });
  if (gate?.verdict !== "ALLOW") return { ok: false, verdict: `GATE:${(gate?.reasons ?? []).join(";").slice(0, 120)}` };
    const r = await executeAs(ACCOUNT, ops, { tag: "ci-custody-witness", role: "posting" });
  if (r?.ok) {
    try { fs.mkdirSync(path.join(DIR, "state"), { recursive: true }); fs.writeFileSync(path.join(DIR, "state", "custody-anchor.json"), JSON.stringify({ at: Date.now(), txid: r.txid ?? null, tip })); } catch {}
    return { ok: true, verdict: "ANCHORED", txid: r.txid ?? null, tip };
  }
  return { ok: false, verdict: `BROADCAST-FAIL:${String(r?.verdict ?? r?.error ?? "?").slice(0, 100)}` };
}

async function busReceipts(cycleSummary, anchorRes) {
  try {
    const { busPublish } = await import("./bus.mjs");
    const head = sh("git", ["rev-parse", "--short=8", "HEAD"]).out;
    const out = [];
    const a = await busPublish({ account: ACCOUNT, from: ACCOUNT, type: BUS_TYPES.ANCHOR_RECEIPT, body: { txid: anchorRes?.txid ?? null, tip: anchorRes?.tip ?? head, src: "ci-act" } });
    out.push({ kind: "anchor.receipt", ok: a.ok, verdict: a.verdict });
    if (cycleSummary) {
      const c = await busPublish({ account: ACCOUNT, from: ACCOUNT, type: BUS_TYPES.CYCLE_RECEIPT, body: { ok: !!cycleSummary.ok, head, runner: "ci-act" } });
      out.push({ kind: "cycle.receipt", ok: c.ok, verdict: c.verdict });
    }
    return out;
  } catch (e) { return [{ kind: "bus-error", ok: false, error: String(e).slice(0, 100) }]; }
}

/* ── main ─────────────────────────────────────────────────────────────────── */
const flags = new Set(process.argv.slice(2));
const t0 = Date.now();
const summary = { runner: "saos-ci-act-v1", at: new Date().toISOString(), account: ACCOUNT };

summary.adoption = await adopt();
if (!summary.adoption.ok) {
  console.log(JSON.stringify({ ...summary, verdict: "REFUSED-NO-CUSTODY", note: "fail-closed: no env candidate chain-verified — the loop honestly does not run" }, null, 1));
  process.exit(1);
}
summary.inProcess = await adoptInProcess();
console.log(`[in-process] ${JSON.stringify(summary.inProcess)}`);

if (!flags.has("--cycle-only")) {
  summary.anchor = await custodyAnchor();
  console.log(`[anchor] ${summary.anchor.verdict}${summary.anchor.txid ? ` txid=${summary.anchor.txid}` : ""}`);
}

const cycle = await runCycle();
summary.cycle = { exitCode: cycle.exitCode, timedOut: !!cycle.timedOut, ok: !!cycle.marker?.ok, health: cycle.marker?.health ?? null, finishedAt: cycle.marker?.finishedAt ?? null };
console.log(`[cycle] exit=${cycle.exitCode} ok=${summary.cycle.ok}${cycle.timedOut ? " TIMED-OUT" : ""}${cycle.marker?.health ? ` health=${cycle.marker.health}` : ""}`);
if (cycle.tail) console.log(`[cycle-tail] ${cycle.tail.split("\n").slice(-12).join("\n[cycle-tail] ")}`);

if (!flags.has("--no-bus")) {
  summary.bus = await busReceipts(cycle.marker, summary.anchor);
  for (const b of summary.bus ?? []) console.log(`[bus] ${b.kind}: ${b.verdict ?? b.error ?? b.ok}`);
}

summary.ms = Date.now() - t0;
summary.verdict = summary.cycle.ok ? "CYCLE-OK" : "CYCLE-FAIL";
console.log(JSON.stringify(summary, null, 1));
process.exit(summary.cycle.ok ? 0 : 2);
