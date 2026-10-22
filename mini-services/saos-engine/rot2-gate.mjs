/**
 * rot2-gate.mjs — T-80 COMPLETION · SUPERVISED CONSUMPTION OF THE ROT2
 * FLEET CUSTODY BUNDLE by the sovereign engine.
 *
 * Owner law 2026-10-16 (verbatim intent): "הטוקנים עם הרשאת הניהול יהיו
 * בכספת אטומית לשימוש הריבונות — אבל בצורה מפוקחת" — the agents'
 * management-authority tokens live in the atomic vault (vault-home,
 * fleet-rot2.keys.enc) FOR THE SOVEREIGNTY'S USE, supervised. Storage
 * alone is half the law; this module is the other half: the engine
 * consumes the material ONLY through the vault-home supervise/ gate.
 *
 * The supervised path (every property enforced by the gate, measured):
 *   bash vault-home/supervise/deploy-fleet-env.sh --out <tmp> --purpose …
 *     → custody-supervisor.mjs deploy
 *       · SHA-PIN TRIPLE GATE (zip sha + material json sha + roster
 *         semantic) — fail-closed, drift ⇒ REFUSED + ledger
 *       · vault unlock via the wraps registry (vault_unwrap +
 *         vault_forget_pass — zero standing plaintext)
 *       · material → 0600 in the caller's --out dir, NEVER stdout
 *       · every touch ledger-logged (vault-chain/CUSTODY-LEDGER.jsonl,
 *         fingerprints only)
 *   → engine adopts the WIFs fail-closed (adoptVerifiedWifIdentity —
 *     the LIVE CHAIN is the only judge; a refused wif never enters memory)
 *   → plaintext tmp SHREDDED in `finally`
 *   → verdict-only journal (pubkeys + counts; zero key material)
 *
 * ADDITIVE LAW: the GEN-2/GEN-1 git-vault revival (vault-revival.mjs)
 * stays untouched — fallback + master custody. ROT2 (ROT2-PHASE-A-2026-10-13)
 * is the newest measured generation (41/41 LIVE at seal, 2026-10-16); the
 * chain judges it again at every adoption.
 *
 * CROSS-CHAIN PAUSE STANDS: only the STEEM accounts are adopted here. The
 * ROT2 hive slots (israelnews/lsa/siq/woq × active+posting) stay sealed
 * inside the artifact until the operator re-arms hive/blurt — honest,
 * unchanged law (vault-revival header).
 *
 * Fail-soft to the engine: a gate refusal (vault sealed / sha-pin drift /
 * supervisor absent) is journaled verdict-only and the boot continues on
 * the git-vault fallback — the fleet never depends on one path.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { masterAccount, adoptVerifiedWifIdentity, armyCustodyState } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const SECRETS = path.join(DIR, "..", "..", ".secrets");
const LOG_FILE = path.join(STATE, "exec-log.jsonl");
/* ESTATE-REHOME LAW (T-570): the vault-home bundle is owner-provisioned
 * (never in git) and the estate layout moves between sandboxes — the
 * supervise gate is therefore PROBED at every known home, first existing
 * wins, fail-closed when none does:
 *   1. $SAOS_VAULT_HOME/supervise/deploy-fleet-env.sh (operator override)
 *   2. DIR/../../../vault-home/…   (estate/steem/mini-services/saos-engine)
 *   3. DIR/../../vault-home/…      (repo-root/vault-home)
 *   4. /home/z/estate/vault-home/… (estate canonical, tools/vault-seed.sh)
 *   5. ~/.secrets/vault-home/…     (secrets-home fallback) */
function resolveGate() {
  const rel = path.join("supervise", "deploy-fleet-env.sh");
  const candidates = [
    ...(process.env.SAOS_VAULT_HOME ? [path.join(process.env.SAOS_VAULT_HOME, rel)] : []),
    path.join(DIR, "..", "..", "..", "vault-home", rel),
    path.join(DIR, "..", "..", "vault-home", rel),
    path.join("/home/z/estate", "vault-home", rel),
    path.join(os.homedir(), ".secrets", "vault-home", rel),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return { ok: true, gate: c, probed: candidates };
  return { ok: false, probed: candidates };
}
const CUSTODY_DOC = path.join(STATE, "rot2-custody.json");
const EVENTS = path.join(STATE, "events.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/**
 * Open the ROT2 bundle THROUGH the supervised gate into a private tmp dir.
 * Returns { ok, dir, gate } — the caller MUST shred dir. On refusal:
 * { ok:false, reason } (verdict-only; the gate already ledger-logged it).
 */
function gateOpen(tmpDir, purpose) {
  const resolved = resolveGate();
  if (!resolved.ok) return { ok: false, reason: `gate-missing (probed: ${resolved.probed.join(" | ")})` };
  const GATE = resolved.gate;
  let stdout = "";
  try {
    /* execFileSync, stdio piped — the gate's stdout carries verdict JSON
     * (counts + shas) only; material lands in tmpDir at 0600 by the gate. */
    stdout = execFileSync("bash", [GATE, "--out", tmpDir, "--purpose", purpose], {
      stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    }).toString();
  } catch (e) {
    const tail = String(e?.stderr ?? e?.message ?? "").trim().split("\n").slice(-2).join(" / ").slice(0, 160);
    return { ok: false, reason: `gate-refused (${tail || "no-stderr"})` };
  }
  let gate = null;
  try { gate = JSON.parse(stdout); } catch { gate = { ok: false, reason: "gate-nonjson-stdout" }; }
  if (!gate?.ok) return { ok: false, reason: `gate-refused (${String(gate?.reason ?? "unknown").slice(0, 120)})` };
  return { ok: true, gate };
}

/**
 * STALE-SHRED SWEEP — crash-mid-adoption hygiene (measured live 2026-10-16:
 * an OOM-killed engine left a plaintext rot2-gate-* tmp behind — `finally`
 * never ran under SIGKILL). Every adoption FIRST shreds any pre-existing
 * gate tmp dirs in .secrets, then opens a fresh one. The material therefore
 * never outlives one adoption call by more than the next call — and the
 * sweep itself runs before any new material exists.
 */
function sweepStaleGateTmp() {
  try {
    for (const e of fs.readdirSync(SECRETS)) {
      if (e.startsWith("rot2-gate-")) {
        fs.rmSync(path.join(SECRETS, e), { recursive: true, force: true });
        appendLine(LOG_FILE, { at: new Date().toISOString(), tag: "rot2-gate-stale-shred", dir: e, verdict: "SHREDDED" });
      }
    }
  } catch { /* best effort — SECRETS may not exist yet */ }
}

/**
 * THE ENTRY POINT — idempotent, fail-soft, chain-judged, shred-guaranteed.
 * Adopts every STEEM account the ROT2 material carries (posting first, then
 * active — the same order the GEN revival uses). Already-verified accounts
 * are skipped honestly (ALREADY-VERIFIED) unless force.
 */
export async function adoptRot2Fleet({ force = false, purpose = "boot adoption" } = {}) {
  const t0 = Date.now();
  const now = new Date().toISOString();
  const roster = [];
  try {
    const master = masterAccount();
    sweepStaleGateTmp();
    const tmp = fs.mkdtempSync(path.join(SECRETS, "rot2-gate-"));
    fs.chmodSync(tmp, 0o700);
    try {
      const opened = gateOpen(tmp, `saos-engine rot2-adoption ${purpose} ${now}`);
      if (!opened.ok) {
        const doc = { at: now, verdict: "GATE-REFUSED", reason: opened.reason, law: "fail-soft — GEN git-vault fallback stays armed", ms: Date.now() - t0 };
        appendLine(LOG_FILE, { at: now, tag: "rot2-gate", verdict: "REFUSED", reason: opened.reason });
        appendLine(EVENTS, { type: "rot2.custody", at: now, verdict: "GATE-REFUSED", reason: opened.reason });
        writeDoc(doc);
        return { ok: false, reason: opened.reason, doc };
      }
      const matPath = path.join(tmp, "rot2-keys.json");
      if (!fs.existsSync(matPath)) throw new Error("material-missing-after-gate-open (fail-closed)");
      const mat = JSON.parse(fs.readFileSync(matPath, "utf8"));
      /* material schema: accounts.<chain>.<account>.<role>.{wif,pub} */
      const steemAccounts = Object.keys(mat?.accounts?.steem ?? {});
      if (!steemAccounts.length) throw new Error("material-carries-no-steem-accounts (fail-closed)");
      const results = [];
      let verified = 0;
      for (const account of steemAccounts) {
        roster.push(account);
        if (!force && armyCustodyState([account]).accounts?.[account] === "verified") {
          results.push({ account, verdict: "ALREADY-VERIFIED" });
          verified++;
          continue;
        }
        const roles = mat.accounts.steem[account] ?? {};
        let doneRole = null;
        for (const role of ["posting", "active"]) {
          const wif = roles?.[role]?.wif ?? null;
          if (!wif) continue;
          const r = await adoptVerifiedWifIdentity(account, wif, { role });
          if (r?.ok) {
            doneRole = role;
            results.push({ account, role, verdict: "VERIFIED-VS-CHAIN", pubkey: r.pubkey ?? null });
            appendLine(LOG_FILE, { at: new Date().toISOString(), tag: "rot2-gate-adopted", account, role, pubkey: r.pubkey ?? null, verdict: "VERIFIED-VS-CHAIN" });
          } else {
            results.push({ account, role, verdict: `REFUSED:${String(r?.reason ?? "?").slice(0, 60)}` });
          }
        }
        if (doneRole) verified++;
      }
      const doc = {
        at: now, verdict: verified === steemAccounts.length && verified > 0 ? "ROT2-CUSTODY-ALIVE" : (verified > 0 ? "PARTIAL" : "NONE-VERIFIED"),
        gate: { artifact: opened.gate?.artifact ?? "fleet-rot2.keys.enc", innerSha: opened.gate?.innerSha ?? null, ledger: "vault-home/vault-chain/CUSTODY-LEDGER.jsonl (supervisor-logged)" },
        roster: steemAccounts.length, verified, adopted: results,
        hiveNote: "ROT2 hive slots stay SEALED (cross-chain pause stands until operator re-arms)",
        masterNote: `master (${master}) custody remains on the GEN-2/GEN-1 git-vault rail (untouched)`,
        law: "supervised gate → 0600 → chain-judged adoption → shred · zero material in journals",
        ms: Date.now() - t0,
      };
      appendLine(EVENTS, { type: "rot2.custody", at: now, verdict: doc.verdict, verified, roster: steemAccounts.length });
      writeDoc(doc);
      return { ok: verified > 0, verified, roster: steemAccounts.length, doc };
    } finally {
      /* SHRED — the plaintext material never outlives this function. */
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  } catch (e) {
    const reason = String(e?.message ?? e).slice(0, 160);
    const doc = { at: now, verdict: "ROT2-GATE-FAIL", reason, ms: Date.now() - t0 };
    appendLine(LOG_FILE, { at: now, tag: "rot2-gate", verdict: "FAIL", reason });
    writeDoc(doc);
    return { ok: false, reason, doc };
  }
}

function writeDoc(doc) {
  try {
    fs.mkdirSync(STATE, { recursive: true, mode: 0o700 });
    const t = `${CUSTODY_DOC}.tmp.${process.pid}`;
    fs.writeFileSync(t, JSON.stringify(doc, null, 2), { mode: 0o600 });
    fs.chmodSync(t, 0o600);
    fs.renameSync(t, CUSTODY_DOC);
  } catch { /* best effort */ }
}

export { adoptRot2Fleet as default };
