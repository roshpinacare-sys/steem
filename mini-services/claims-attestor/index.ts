/**
 * CLAIMS-ATTESTOR ORGAN (:3045) — R314/R315, "architecture-as-owner: honest level, continuously"
 *
 * Owner directive honored (R314):
 *  - "תוודא רמה בכנות בלי לשקר" — honesty of level, verified CONTINUOUSLY, not on demand.
 *  - Every 15 min: re-run the falsifiable-claims ledger fresh, append the verdict to
 *    an append-only attestation history (jsonl), expose it. No trust, no memory, no lying.
 *
 * R315 capabilities (measured):
 *  - publisher-kicker: GitHub cron throttles the constitutional decider publisher to
 *    ~5h; past 90min staleness (or missing D6) this organ self-kicks workflow_dispatch
 *    with the same authority it pushes with — zero asks (R314 law 2).
 *  - evidence-driven self-heal: when the ledger refutes yield-rail-live but the root
 *    state file (army-custody.json) proves FLEET-CUSTODY-ALIVE verified>=total, the
 *    refutation was a stale race snapshot — heal via the engine's own lawful /yield-run.
 *    Real custody debt (evidence not green) is NEVER healed — no self-deception.
 *
 * Laws honored:
 *  - MEASURE-DON'T-TRUST: every attestation is a fresh subprocess run; only parsing.
 *  - APPEND-ONLY: history is jsonl append; no rewriting, no pruning of refutations.
 *  - NON-BLOCKING: async Bun.spawn throughout — the HTTP surface stays responsive
 *    while the ledger runs (the self-referential claim taught us this: spawnSync
 *    froze the loop and refuted the attestor by its own ruler; lying-by-freezing).
 *  - DETERMINISM: plain `bun index.ts` (no --hot), deliberate kill -> respawn.
 *
 * Endpoints:
 *  GET /health        — {ok, service, counters, lastVerdict}
 *  GET /attestations  — last 20 entries (full history on disk)
 *  POST /run          — trigger a fresh attestation now (awaited)
 */

import fs from "fs";
import path from "path";

const PORT = 3045;
const EVERY_MS = 15 * 60_000; // 15 min standing rhythm
const KICK_EVERY_MS = 30 * 60_000; // publisher freshness check (R315)
const PUBLISH_STALE_MS = 90 * 60_000; // GitHub throttles cron to ~5h; kick past 90min
const PUBLISHED_URL =
  "https://raw.githubusercontent.com/roshpinacare-sys/Autonomy/main/ops/sovereign/DECIDER/state.json";
const DISPATCH_URL =
  "https://api.github.com/repos/roshpinacare-sys/Autonomy/actions/workflows/sovereign-decider.yml/dispatches";
const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE_FILE = path.join(DIR, "state", "attestations.jsonl");
const LEDGER_SH =
  process.env.CLAIMS_LEDGER_SH || path.join(DIR, "run-claims-ledger.sh");
const ARMY_CUSTODY_JSON =
  "/home/z/audit/repos/steem/mini-services/saos-engine/state/army-custody.json";

fs.mkdirSync(path.join(DIR, "state"), { recursive: true });

const bootedAt = new Date().toISOString();
let running = false;
let lastAt: string | null = null;
let lastEntry: any = null;
let runs = 0;
// R315 publisher-kicker state (measured, never fabricated)
let publisherKicks = 0;
let lastKickAt: string | null = null;
let lastPublishedAt: string | null = null;
let lastPublishedHasD6: boolean | null = null;
// R315 evidence-driven self-heal state
let selfHeals = 0;
let lastHealAt: string | null = null;
let lastHealWhat: string | null = null;

function ledgerPresent(): boolean {
  try {
    return fs.existsSync(LEDGER_SH);
  } catch {
    return false;
  }
}

function readEntries(): any[] {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8").trim();
    if (!raw) return [];
    return raw.split("\n").map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function parseLedger(out: string) {
  const m = out.match(/== LEDGER: (\d+) MEASURED-TRUE \/ (\d+) REFUTED \(of (\d+)\)/);
  const refLine = out.match(/== refuted:(.*)/);
  const refuted = refLine
    ? refLine[1].trim().split(/\s+/).filter(Boolean)
    : [];
  if (!m) return null;
  return { pass: Number(m[1]), fail: Number(m[2]), total: Number(m[3]), refuted };
}

async function runCmd(cmd: string[], timeoutMs: number): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, stdout };
}

async function runAttestation(): Promise<any> {
  if (running) return { skipped: true, reason: "already-running" };
  if (!ledgerPresent()) return { skipped: true, reason: "ledger-script-missing" };
  running = true;
  const t0 = Date.now();
  try {
    const { code, stdout } = await runCmd(["bash", LEDGER_SH], 240_000);
    const durSec = Math.round((Date.now() - t0) / 1000);
    const parsed = parseLedger(stdout);
    const entry: any = {
      at: new Date().toISOString(),
      durSec,
      rc: code,
      ...(parsed ?? { parse: "FAILED", head: stdout.slice(-200) }),
    };
    fs.appendFileSync(STATE_FILE, JSON.stringify(entry) + "\n");
    runs += 1;
    lastAt = entry.at;
    lastEntry = entry;
    await selfHeal(entry); // R315: evidence-driven rail self-heal (only when root state proves green)
    return entry;
  } catch (e: any) {
    const entry = {
      at: new Date().toISOString(),
      durSec: Math.round((Date.now() - t0) / 1000),
      error: String(e?.message || e).slice(0, 120),
    };
    fs.appendFileSync(STATE_FILE, JSON.stringify(entry) + "\n");
    lastAt = entry.at;
    lastEntry = entry;
    return entry;
  } finally {
    running = false;
  }
}

/** R315: when the ledger refutes a claim whose root state file proves GREEN,
 * the refutation was a stale race snapshot — heal through the engine's own
 * lawful route. Real custody debt (evidence not green) is never healed. */
async function selfHeal(entry: any) {
  try {
    const refuted: string[] = entry?.refuted ?? [];
    if (!refuted.includes("yield-rail-live")) return;
    const c = JSON.parse(fs.readFileSync(ARMY_CUSTODY_JSON, "utf8"));
    const green =
      c?.verdict === "FLEET-CUSTODY-ALIVE" &&
      Number(c?.after?.verified ?? 0) >= Number(c?.after?.total ?? 14) &&
      Number(c?.after?.total ?? 0) > 0;
    if (!green) return; // real custody debt — no self-deception, stays refuted
    const { stdout } = await runCmd(
      ["curl", "-s", "-m", "15", "-X", "POST", "http://127.0.0.1:3040/yield-run"],
      20_000
    );
    if (stdout.includes('"ok":true')) {
      selfHeals += 1;
      lastHealAt = new Date().toISOString();
      lastHealWhat = "yield-rail-unfreeze (evidence: army-custody FLEET-CUSTODY-ALIVE verified>=total)";
      console.log(`[claims-attestor] self-heal #${selfHeals}: ${lastHealWhat}`);
    }
  } catch (e: any) {
    console.log(`[claims-attestor] self-heal error: ${String(e?.message || e).slice(0, 120)}`);
  }
}

async function ghToken(): Promise<string> {
  const { stdout } = await runCmd(
    ["bash", "-c", 'printf "protocol=https\\nhost=github.com\\n" | git credential fill 2>/dev/null | grep ^password= | cut -d= -f2'],
    15_000
  );
  return stdout.trim();
}

/** R315: check published decider state freshness; self-kick workflow_dispatch when
 * GitHub cron throttling starves the constitutional publisher. Zero asks. */
async function checkPublisher() {
  try {
    const { stdout } = await runCmd(["curl", "-s", "-m", "15", PUBLISHED_URL], 20_000);
    const doc = JSON.parse(stdout || "{}");
    lastPublishedAt = doc.generatedAt || null;
    lastPublishedHasD6 = Array.isArray(doc.decisions)
      ? doc.decisions.some((x: any) => x?.id === "D6-architecture-as-owner")
      : false;
    const ageMs = lastPublishedAt ? Date.now() - Date.parse(lastPublishedAt) : Infinity;
    if (ageMs > PUBLISH_STALE_MS || lastPublishedHasD6 === false) {
      const token = await ghToken();
      if (!token) return;
      const { stdout: k } = await runCmd(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "15", "-X", "POST",
         "-H", `Authorization: Bearer ${token}`,
         "-H", "Accept: application/vnd.github+json",
         DISPATCH_URL, "-d", '{"ref":"main"}'],
        20_000
      );
      if (k.trim() === "204") {
        publisherKicks += 1;
        lastKickAt = new Date().toISOString();
        console.log(`[claims-attestor] publisher-kick #${publisherKicks} (publishedAt=${lastPublishedAt} hasD6=${lastPublishedHasD6})`);
      }
    }
  } catch (e: any) {
    console.log(`[claims-attestor] publisher-check error: ${String(e?.message || e).slice(0, 120)}`);
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/health") {
      const entries = readEntries();
      return Response.json({
        ok: true,
        service: "claims-attestor",
        at: new Date().toISOString(),
        bootedAt,
        ledgerPresent: ledgerPresent(),
        ledgerSh: LEDGER_SH,
        everyMin: EVERY_MS / 60_000,
        runs,
        entries: entries.length,
        running,
        lastAt,
        publisherKicks,
        lastKickAt,
        lastPublishedAt,
        lastPublishedHasD6,
        selfHeals,
        lastHealAt,
        lastHealWhat,
        lastVerdict: lastEntry
          ? `${lastEntry.pass ?? "?"}/${lastEntry.total ?? "?"} true · refuted=${(lastEntry.refuted ?? []).length}`
          : null,
      });
    }
    if (p === "/attestations") {
      const entries = readEntries();
      return Response.json({ ok: true, total: entries.length, last: entries.slice(-20) });
    }
    if (p === "/run" && req.method === "POST") {
      return Response.json({ ok: true, entry: await runAttestation() });
    }
    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  },
});

console.log(
  `[claims-attestor] alive :${PORT} · ledger=${LEDGER_SH} present=${ledgerPresent()} · every ${EVERY_MS / 60_000}min · async`
);

// first attestation at boot (after short grace), then standing rhythm
setTimeout(() => {
  void runAttestation().then((e) =>
    console.log(`[claims-attestor] boot attestation: ${JSON.stringify(e).slice(0, 160)}`)
  );
}, 20_000);
setInterval(() => {
  void runAttestation().then((e) => {
    if (!e.skipped) console.log(`[claims-attestor] attestation: ${JSON.stringify(e).slice(0, 160)}`);
  });
}, EVERY_MS);

// R315: publisher freshness standing check (first at boot+2min, then every 30min)
setTimeout(() => void checkPublisher(), 120_000);
setInterval(() => void checkPublisher(), KICK_EVERY_MS);
