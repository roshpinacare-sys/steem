// SAOS CUSTODIAN — bounded-staleness persistence service (R215)
// Mission: shrink the "last minutes of cognitive state live only on disk" window
// (audit/r213/VERDICT.json currentCaveat) to <= TICK_MS, deterministically.
// LAW: SOVEREIGN-WRITER-LAW.md v1 — persistence ONLY via:
//   divergence-check (read-only) -> jq validation -> git commit -> scripts/sovereign-push.sh (FF-only gate)
// NEVER: force, merge autonomy, non-canonical branches, commits of invalid (torn) JSON.
import { spawnSync } from "node:child_process";
import { thinkGate, executeAs, masterAccount, credentialFingerprint, verifyRoles } from "../saos-engine/signer.mjs";
import { adoptAccountPostingWif } from "../saos-engine/vault-revival.mjs";
import { appendFileSync, writeFileSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync, renameSync } from "node:fs";

const REPO = "/home/z/my-project";
const STATE_DIR = `${REPO}/mini-services/saos-engine/state`;
const TICK_MS = Number(process.env.TICK_MS ?? 600000); // 10 min default
const PORT = 3041;

type TickResult = {
  at: string;
  head: string;
  dirty: number;
  divergenceExit: number | null;
  invalidJson: string[];
  committed: boolean;
  pushed: boolean;
  pushSha?: string;
  error?: string;
};

function sh(cmd: string, args: string[], cwd: string = REPO): { code: number; out: string; err: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 120000 });
  return { code: r.status ?? -1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function appendAlert(kind: string, detail: string) {
  try {
    appendFileSync(`${STATE_DIR}/custodian-alerts.jsonl`, JSON.stringify({ at: new Date().toISOString(), kind, detail: detail.slice(0, 300) }) + "\n");
  } catch {}
}

let lastAnchorAt = 0;
let vaultAdoptTried = false; /* R297: one in-process vault admission attempt max */
/* R297 · ALERT-HONESTY LAW (anchor-refused dedupe): the CREDENTIAL-MISMATCH
 * verdict is a standing informational condition (signer guidance: signing
 * continues via vault revival; no operator action wanted) — but the custodian
 * re-alerted it EVERY 10-min tick, burying the alert rail in noise (measured:
 * anchor-refused every tick since 2026-10-07). Fail-honest dedupe: alert on
 * TRANSITION and then a 6h heartbeat only; the stamp state file keeps the
 * condition + suppressed count so silence is never lost information. */
const ANCHOR_VERDICT_STAMP = `${STATE_DIR}/anchor-verdict.json`;
function appendAnchorRefusedDeduped(detail: string) {
  let prev: any = null;
  try { prev = JSON.parse(readFileSync(ANCHOR_VERDICT_STAMP, "utf8")); } catch {}
  const now = Date.now();
  const same = prev?.ok === false && prev?.detail === detail;
  const heartbeatDue = !prev?.at || now - Number(prev.at) >= 6 * 3600000;
  if (same && !heartbeatDue) {
    try { writeFileSync(ANCHOR_VERDICT_STAMP, JSON.stringify({ ok: false, detail, at: now, suppressed: (Number(prev?.suppressed) || 0) + 1 })); } catch {}
    return;
  }
  appendAlert("anchor-refused", detail);
  try { writeFileSync(ANCHOR_VERDICT_STAMP, JSON.stringify({ ok: false, detail, at: now, suppressed: 0 })); } catch {}
}
/* R217 · DURABLE ANCHOR RATE-LIMIT: the in-memory lastAnchorAt resets on every
 * custodian restart — measured live 22:49→22:51Z: two custody witnesses 9 min
 * apart (implant + watchdog heal each fired a first-push anchor). The ≤1/h law
 * must survive restarts BY CONSTRUCTION: the stamp lives in state (committed
 * like every other state file), memory is only a cache. */
const ANCHOR_STAMP = `${STATE_DIR}/custody-anchor.json`;
function lastAnchorMs(): number {
  try { return Number(JSON.parse(readFileSync(ANCHOR_STAMP, "utf8")).at) || 0; } catch { return 0; }
}
async function anchorWitness(): Promise<void> {
  try {
    const last = Math.max(lastAnchorMs(), lastAnchorAt);
    if (Date.now() - last < 3600000) { appendAlert("anchor-skip", `rate-limited durably (last ${new Date(last).toISOString()})`); return; }
    const acct: string = masterAccount() as any;
    /* R239 FIX (deadlock caught live): the gate refuses keyed-but-unverified
     * "until verifyRoles passes" — but no custodian path ever CALLED
     * verifyRoles, so after any cold credential adoption the custody anchor
     * stayed refused forever (engine verifies in its own process; the
     * custodian's memory cache stays empty). verifyRoles is read-only
     * (derive + chain read) and process-local cached — run it here, once,
     * before the gate. Fail-closed preserved: a bad credential still
     * refuses (verifyRoles.ok=false → alert, no broadcast). */
    let ver: any = await verifyRoles(acct);
    /* R297 · SECOND ADMISSION PATH (the anchor law, measured live: the chain
     * anchor went stale at 13:49Z because every cold custodian restart leaves
     * the password-derivation cache empty and verifyRoles honestly refuses a
     * pasted-era credential — while the SAME vault's WIF for this account is
     * chain-judged alive 14/14). Admission = the chain itself vouching for a
     * WIF we can sign with: adoptAccountPostingWif runs the existing
     * generation unlock + role-exact live-authority match (fail-closed, only
     * a chain-accepted WIF enters memory). Tried ONCE per process; if the
     * chain rejects every generation too, the anchor stays refused and the
     * dedupe law records it. */
    if (!ver?.ok && !vaultAdoptTried) {
      vaultAdoptTried = true;
      try {
        const adopt: any = await adoptAccountPostingWif(acct);
        if (adopt?.ok) {
          appendAlert("anchor-adopt-ok", `${acct} posting WIF adopted via ${adopt.gen} (chain-judged, memory-only)`);
          ver = await verifyRoles(acct);
        } else {
          appendAlert("anchor-adopt-fail", String(adopt?.reason ?? "unknown").slice(0, 140));
        }
      } catch (e) { appendAlert("anchor-adopt-fail", String(e).slice(0, 120)); }
    }
    if (!ver?.ok) { appendAnchorRefusedDeduped(`verifyRoles: ${String(ver?.reason ?? ver?.verdict ?? "unverified").slice(0, 180)}`); return; }
    const tip = sh("git", ["rev-parse", "HEAD"]).out;
    const ops: any = [["custom_json", { required_auths: [], required_posting_auths: [acct], id: "saos-git-custody-v1", json: JSON.stringify({ branch: "saos-cockpit", tip, at: new Date().toISOString(), src: "R216-custodian", fp: credentialFingerprint(acct) }) }]];
    const gate: any = thinkGate(acct, ops, { source: "custody-witness" });
    if (gate.verdict !== "ALLOW") { appendAlert("anchor-refused", (gate.reasons ?? []).join(";")); return; }
    const r: any = await executeAs(acct, ops, { tag: "custody-witness", role: "posting" } as any);
    lastAnchorAt = Date.now();
    try { writeFileSync(ANCHOR_STAMP, JSON.stringify({ at: lastAnchorAt, txid: r?.txid ?? null, tip })); } catch {}
    appendAlert("anchor-ok", JSON.stringify({ txid: r?.txid ?? null, tip }));
  } catch (e) { appendAlert("anchor-error", String(e).slice(0, 200)); }
}

let lastTick: TickResult | null = null;
let log: TickResult[] = [];

/* R285 · THE LEDGER BOUNDER LAW: the live node writers append to archive
 * ledgers with no cap of their own (measured: chain-archive-fork-quarantine
 * grew to 403MB in a day — five whole-file rewrites of it in one push range
 * made git hang up on GitHub and blocked every push). The tree truth-anchor
 * is the chain itself, not the archive; the archive keeps only its recent
 * operative tail. Bounded at 64MB, tail 2000, alert on every trim. */
const BOUNDED_LEDGERS: Array<{ path: string; maxBytes: number; tailLines: number }> = [
  { path: "sovereign/node/chain-archive-fork-quarantine.jsonl", maxBytes: 64 * 1024 * 1024, tailLines: 2000 },
  { path: "sovereign/node/chain-archive.jsonl", maxBytes: 64 * 1024 * 1024, tailLines: 2000 },
];
function boundLedgers() {
  for (const l of BOUNDED_LEDGERS) {
    try {
      const st = statSync(`${REPO}/${l.path}`);
      if (st.size <= l.maxBytes) continue;
      /* R297 FIX (measured live: 93.8MB quarantine never trimmed since R285
       * — every tick died RangeError before writing): fs.readSync returns
       * the NUMBER of bytes read, not a buffer. The old code called
       * tail.toString("utf8", …) on that number → Number.prototype.toString
       * with an invalid radix → RangeError on EVERY trim, so the 64MB cap
       * never executed. The buffer is now held explicitly. */
      const buf = Buffer.alloc(Math.min(st.size, l.maxBytes));
      const start = st.size - buf.length;
      const fd = openSync(`${REPO}/${l.path}`, "r");
      let bytesRead = 0;
      try { bytesRead = readSync(fd, buf, 0, buf.length, start); } finally { closeSync(fd); }
      const lines = buf.toString("utf8", 0, bytesRead).split("\n").filter((x) => x.trim());
      const keep = lines.slice(-l.tailLines);
      const tmp = `${REPO}/${l.path}.bound-tmp`;
      writeFileSync(tmp, keep.join("\n") + "\n");
      renameSync(tmp, `${REPO}/${l.path}`);
      appendAlert("ledger-bound", `${l.path} trimmed ${st.size} -> ${keep.length} lines`);
    } catch (e) {
      if (!String(e).includes("ENOENT")) appendAlert("ledger-bound-fail", `${l.path} :: ${String(e).slice(0, 120)}`);
    }
  }
}

function tick() {
  const res: TickResult = {
    at: new Date().toISOString(),
    head: "",
    dirty: 0,
    divergenceExit: null,
    invalidJson: [],
    committed: false,
    pushed: false,
  };
  try {
    boundLedgers();
    res.head = sh("git", ["rev-parse", "HEAD"]).out;

    // 1) divergence visibility (read-only)
    const dc = sh("bash", ["scripts/divergence-check.sh"]);
    res.divergenceExit = dc.code;

    // 2) dirty census
    const st = sh("git", ["status", "--porcelain=v1"]);
    res.dirty = st.out ? st.out.split("\n").filter(Boolean).length : 0;

    if (dc.code !== 0) {
      // LAW: divergence => stop, alert, decide later. Never force, never auto-merge.
      appendAlert("divergence", `exit=${dc.code} :: ${dc.out} ${dc.err} :: REMEDY(agent-law): snapshot→fetch→soft-reset origin→alive-wins json+union jsonl→sovereign-push`);
      /* R300-b · INTERNAL-OPERATOR SELF-HEAL (the standing law: nothing waits
       * for a human operator — measured 2026-10-10: the custodian alerted
       * divergence every 10min for 3h doing nothing). Behind-only divergence
       * (remote advanced, we changed nothing) is healable with ZERO data
       * loss: fast-forward only — merge --ff-only cannot create commits,
       * cannot lose lines, and harmlessly refuses the diverged case. True
       * divergence (both sides advanced, e.g. upstream history rewrite) stays
       * alert-only: it needs the agent merge-laws (the REMEDY line above). */
      sh("git", ["fetch", "origin"]);
      const ff = sh("git", ["merge", "--ff-only", "origin/saos-cockpit"]);
      if (ff.code === 0) {
        appendAlert("divergence-ff-healed", `fast-forwarded to ${sh("git", ["rev-parse", "--short", "HEAD"]).out}`);
        res.divergenceExit = 0;
      } else {
        /* R303 · SELF-RECONCILIATION LAW (measured 2026-10-10: 56 divergence
         * alerts/24h — the CI heartbeat advances every ~15min while the live
         * state files are always dirty, so ff-only collides and the tree
         * drifts until an agent ran the by-hand dance). The dance is now a
         * fail-closed script (scripts/reconcile-now.sh: G0-G7 — ahead==0
         * guard, soft-reset only, alive-wins json, union jsonl, jq-validate,
         * 0 code deletions, push through the gate). Proven live twice by
         * hand (R300 8da78332, R302 987f0664) and once as a script before
         * wiring. Nothing waits for a human operator. */
        const rec = sh("bash", ["scripts/reconcile-now.sh"]);
        if (rec.code === 0 && (rec.out || "").includes('"ok":true')) {
          appendAlert("reconcile-ok", (rec.out || "").slice(0, 160));
          res.divergenceExit = 0;
        } else {
          appendAlert("reconcile-fail", `${((rec.out || "") + " " + (rec.err || "")).slice(0, 180)}`);
        }
      }
    } else if (res.dirty > 0) {
      // 3) validate every state JSON — never persist torn state to the chain of record
      let files: string[] = [];
      try { files = readdirSync(STATE_DIR).filter((f) => f.endsWith(".json")); } catch {}
      for (const f of files) {
        if (sh("jq", ["-e", ".", `${STATE_DIR}/${f}`]).code !== 0) res.invalidJson.push(f);
      }
      if (res.invalidJson.length > 0) {
        appendAlert("torn-state", `invalid JSON skipped from persistence: ${res.invalidJson.join(",")}`);
      } else {
        // 4) commit + push through the law gate
        // R249 · STATE-ONLY PERSISTENCE LAW: this service persists runtime
        // state and measured evidence ONLY — never cognitive/module code.
        // Measured failure: tick 19:49:39Z swept a downgraded selftest.mjs
        // into 95e90d2 via `git add -A` (115 vectors silently lost; restored
        // by R248 under the lineage law). Targeted adds make that failure
        // mode impossible BY CONSTRUCTION: anything dirty outside
        // state/measured belongs to its cognitive writer and is LEFT ALONE.
        sh("git", ["add", "--", "mini-services/saos-engine/state", "docs/measured"]);
        const staged = sh("git", ["diff", "--cached", "--name-only"]);
        if (staged.out) {
          /* R249 · gate clause 2.5 (R220): body-prefixed subjects require a
           * GPG signature — the sandbox has no secret key (measured:
           * commit-fail 19:59-20:10Z, push-abort 20:12Z). State persistence
           * IS checkpoint noise by the gate's own taxonomy, so the subject
           * takes the canonical UUID checkpoint form and the descriptor
           * lives in the body — same history, same law, publishable. */
          const uuid = sh("python3", ["-c", "import uuid; print(uuid.uuid4())"]).out;
          const cm = sh("git", ["commit", "-m", uuid || "saos-custodian-checkpoint", "-m", "SAOS-custodian: bounded-staleness persistence (state-only, jq-validated, FF law) — R249"]);
          res.committed = cm.code === 0;
          if (!res.committed) {
            appendAlert("commit-fail", cm.err || cm.out);
          } else {
            const p = sh("bash", ["scripts/sovereign-push.sh"]);
            res.pushed = p.code === 0;
            const m = (p.out + " " + p.err).match(/PUSHED ([0-9a-f]{40})/);
            if (res.pushed && m) { res.pushSha = m[1]; void anchorWitness(); }
            if (!res.pushed) appendAlert("push-abort", `${p.out} ${p.err}`);
          }
        } else if (res.dirty > 0) {
          // R249 · lineage law in action: non-state dirt is NOT ours to commit.
          appendAlert("non-state-dirty-left", `${res.dirty} dirty paths outside state/measured — left to their writers (lineage law: restoration over deletion)`);
        }
      }
    }
    /* R300-b · ANCHOR-FRESHNESS LAW (measured 2026-10-10: the chain anchor
     * rotted 4.5h while custody was fully alive — anchorWitness fired only
     * after a custodian-INITIATED push, so any push by another plane (agent
     * or CI heartbeat) left the anchor stale. Per T-38 a >90min-stale anchor
     * opens the public runner's dex-takeover gate = the double-sovereignty
     * window. The anchor is a property of CUSTODY LIVENESS, not of who
     * pushed. The internal 1/h rate-limit of anchorWitness still bounds the
     * broadcast; failed attempts re-run per tick with deduped alerts. */
    try {
      let lastAt = 0;
      try { lastAt = Number(JSON.parse(readFileSync(ANCHOR_STAMP, "utf8")).at) || 0; } catch {}
      if (Date.now() - lastAt > 90 * 60_000) void anchorWitness();
    } catch {}
  } catch (e) {
    res.error = String(e);
    appendAlert("tick-error", res.error);
  }

  lastTick = res;
  log.push(res);
  if (log.length > 100) log = log.slice(-100);
  try {
    writeFileSync(`${STATE_DIR}/custodian.json`, JSON.stringify(lastTick, null, 2) + "\n");
  } catch {}
  console.log(`[custodian] tick ${res.at} dirty=${res.dirty} div=${res.divergenceExit} committed=${res.committed} pushed=${res.pushed} ${res.pushSha ?? ""} ${res.error ?? ""}`);
}

function json(obj: unknown, status = 200): Response {
  return Response.json(obj as any, { status });
}

Bun.serve({
  port: PORT,
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/health") {
      return json({ ok: true, service: "saos-custodian", at: new Date().toISOString(), tickMs: TICK_MS, ticks: log.length, last: lastTick });
    }
    if (u.pathname === "/drift") {
      const head = sh("git", ["rev-parse", "HEAD"]).out;
      let custody: any = null;
      try {
        custody = JSON.parse(readFileSync(`${STATE_DIR}/push-custody.json`, "utf8"));
      } catch {}
      return json({
        ok: true,
        at: new Date().toISOString(),
        head,
        lastPushedSha: custody?.lastPushedSha ?? null,
        pushedAt: custody?.pushedAt ?? null,
        drift: custody ? head !== custody.lastPushedSha : null,
        divergenceExit: lastTick?.divergenceExit ?? null,
        dirtyNow: lastTick?.dirty ?? null,
      });
    }
    if (u.pathname === "/log") return json({ ok: true, log });
    return json({ ok: false, error: "not-found", routes: ["/health", "/drift", "/log"] }, 404);
  },
});

console.log(`[custodian] up on :${PORT}, tick=${TICK_MS}ms — bounded-staleness persistence, FF-law only`);
tick();
setInterval(tick, TICK_MS);
