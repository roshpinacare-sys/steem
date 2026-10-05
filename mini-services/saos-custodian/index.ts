// SAOS CUSTODIAN — bounded-staleness persistence service (R215)
// Mission: shrink the "last minutes of cognitive state live only on disk" window
// (audit/r213/VERDICT.json currentCaveat) to <= TICK_MS, deterministically.
// LAW: SOVEREIGN-WRITER-LAW.md v1 — persistence ONLY via:
//   divergence-check (read-only) -> jq validation -> git commit -> scripts/sovereign-push.sh (FF-only gate)
// NEVER: force, merge autonomy, non-canonical branches, commits of invalid (torn) JSON.
import { spawnSync } from "node:child_process";
import { thinkGate, executeAs, masterAccount, credentialFingerprint } from "../saos-engine/signer.mjs";
import { appendFileSync, writeFileSync, readFileSync, readdirSync } from "node:fs";

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
async function anchorWitness(): Promise<void> {
  try {
    if (Date.now() - lastAnchorAt < 3600000) return;
    const acct: string = masterAccount() as any;
    const tip = sh("git", ["rev-parse", "HEAD"]).out;
    const ops: any = [["custom_json", { required_auths: [], required_posting_auths: [acct], id: "saos-git-custody-v1", json: JSON.stringify({ branch: "saos-cockpit", tip, at: new Date().toISOString(), src: "R216-custodian", fp: credentialFingerprint(acct) }) }]];
    const gate: any = thinkGate(acct, ops, { source: "custody-witness" });
    if (gate.verdict !== "ALLOW") { appendAlert("anchor-refused", (gate.reasons ?? []).join(";")); return; }
    const r: any = await executeAs(acct, ops, { tag: "custody-witness", role: "posting" } as any);
    lastAnchorAt = Date.now();
    appendAlert("anchor-ok", JSON.stringify({ txid: r?.txid ?? null, tip }));
  } catch (e) { appendAlert("anchor-error", String(e).slice(0, 200)); }
}

let lastTick: TickResult | null = null;
let log: TickResult[] = [];

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
    res.head = sh("git", ["rev-parse", "HEAD"]).out;

    // 1) divergence visibility (read-only)
    const dc = sh("bash", ["scripts/divergence-check.sh"]);
    res.divergenceExit = dc.code;

    // 2) dirty census
    const st = sh("git", ["status", "--porcelain=v1"]);
    res.dirty = st.out ? st.out.split("\n").filter(Boolean).length : 0;

    if (dc.code !== 0) {
      // LAW: divergence => stop, alert, decide later. Never force, never auto-merge.
      appendAlert("divergence", `exit=${dc.code} :: ${dc.out} ${dc.err}`);
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
        sh("git", ["add", "-A"]);
        const staged = sh("git", ["diff", "--cached", "--name-only"]);
        if (staged.out) {
          const cm = sh("git", ["commit", "-S", "-m", "R215-custodian: bounded-staleness persistence (jq-validated state, FF law)"]);
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
        }
      }
    }
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
