/**
 * CLAIMS-ATTESTOR ORGAN (:3045) — R314, "architecture-as-owner: honest level, continuously"
 *
 * Owner directive honored (R314):
 *  - "תוודא רמה בכנות בלי לשקר" — honesty of level, verified CONTINUOUSLY, not on demand.
 *  - The falsifiable-claims ledger (17 claims, cmd + expect.regex) was measured by
 *    humans/agents on demand. This organ makes measurement a standing rhythm:
 *    every 15 min it re-runs the ledger fresh, appends a verdict to the attestation
 *    history (append-only jsonl), and exposes it. No trust, no memory, no lying.
 *
 * Laws honored:
 *  - MEASURE-DON'T-TRUST: every attestation is a fresh subprocess run of the ledger
 *    script; the organ only parses output, never fabricates.
 *  - APPEND-ONLY: history is jsonl append; no rewriting, no pruning of refutations.
 *  - ZERO-ASKS (R314 law 2): the organ serves itself; no owner in any flow.
 *  - DETERMINISM: plain `bun index.ts` (no --hot), deliberate kill -> respawn.
 *
 * Endpoints:
 *  GET /health        — {ok, service, ledgerPresent, entries, last, running}
 *  GET /attestations  — last 20 entries (full history on disk)
 *  POST /run          — trigger a fresh attestation now (returns the entry)
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const PORT = 3045;
const EVERY_MS = 15 * 60_000; // 15 min standing rhythm
const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE_FILE = path.join(DIR, "state", "attestations.jsonl");
const LEDGER_SH =
  process.env.CLAIMS_LEDGER_SH || "/home/z/audit/run-claims-ledger.sh";

fs.mkdirSync(path.join(DIR, "state"), { recursive: true });

const bootedAt = new Date().toISOString();
let running = false;
let lastAt: string | null = null;
let lastEntry: any = null;
let runs = 0;

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

function runAttestation(): any {
  if (running) return { skipped: true, reason: "already-running" };
  if (!ledgerPresent()) {
    return { skipped: true, reason: "ledger-script-missing" };
  }
  running = true;
  const t0 = Date.now();
  try {
    const r = spawnSync("bash", [LEDGER_SH], { timeout: 240_000, encoding: "utf8" });
    const durSec = Math.round((Date.now() - t0) / 1000);
    const parsed = parseLedger(r.stdout || "");
    const entry: any = {
      at: new Date().toISOString(),
      durSec,
      rc: r.status,
      ...(parsed ?? { parse: "FAILED", head: (r.stdout || "").slice(-200) }),
    };
    fs.appendFileSync(STATE_FILE, JSON.stringify(entry) + "\n");
    runs += 1;
    lastAt = entry.at;
    lastEntry = entry;
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

function handleRun(): any {
  const entry = runAttestation();
  return entry;
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
      return Response.json({ ok: true, entry: handleRun() });
    }
    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  },
});

console.log(
  `[claims-attestor] alive :${PORT} · ledger=${LEDGER_SH} present=${ledgerPresent()} · every ${EVERY_MS / 60_000}min`
);

// first attestation at boot (after short grace), then standing rhythm
setTimeout(() => {
  const e = runAttestation();
  console.log(`[claims-attestor] boot attestation: ${JSON.stringify(e).slice(0, 160)}`);
}, 20_000);
setInterval(() => {
  const e = runAttestation();
  if (!e.skipped) console.log(`[claims-attestor] attestation: ${JSON.stringify(e).slice(0, 160)}`);
}, EVERY_MS);
