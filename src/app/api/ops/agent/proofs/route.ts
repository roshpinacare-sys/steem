import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

/**
 * Deck — machine-proof bridge (devgate doctrine adopted: a claim without
 * machine-verified evidence does not promote).
 *
 * The local proof matrix (agent/verify_system.cjs) writes agent/verify_last.json
 * after every run: { at, account, verdict, allPass, results:[{name,pass,evidence}] }.
 *
 * GET  /api/ops/agent/proofs → { exists, age, proofs }  (read-only, never 500)
 * POST /api/ops/agent/proofs → 202 { started:true }     (spawn detached re-run;
 *                              the client polls GET until `at` changes)
 *
 * The evidence strings contain no secrets — they are measured facts
 * (balances, txids, on-chain counts) distilled from the chain itself.
 */

const PROOFS_PATH = path.join(process.cwd(), "agent", "verify_last.json");
const VERIFY_SCRIPT = path.join(process.cwd(), "agent", "verify_system.cjs");

export interface ProofResult {
  name: string;
  pass: boolean;
  evidence: string;
}

export interface ProofsFile {
  at: string;
  account: string;
  verdict: string;
  allPass: boolean;
  results: ProofResult[];
}

export async function GET() {
  try {
    const [raw, st] = await Promise.all([
      readFile(PROOFS_PATH, "utf8"),
      stat(PROOFS_PATH),
    ]);
    const parsed = JSON.parse(raw) as ProofsFile;
    if (!parsed || !Array.isArray(parsed.results)) {
      return NextResponse.json({ exists: false });
    }
    return NextResponse.json({
      exists: true,
      ageMs: Date.now() - st.mtimeMs,
      proofs: parsed,
    });
  } catch {
    // never 500 — an unproven state is a state, not an error
    return NextResponse.json({ exists: false });
  }
}

export async function POST(_req: NextRequest) {
  try {
    await stat(VERIFY_SCRIPT);
  } catch {
    return NextResponse.json({ ok: false, error: "verify script missing" }, { status: 404 });
  }
  const child = spawn(process.execPath, [VERIFY_SCRIPT], {
    cwd: path.dirname(VERIFY_SCRIPT),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}
