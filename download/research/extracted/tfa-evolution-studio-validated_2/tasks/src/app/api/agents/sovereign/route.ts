import { NextResponse } from "next/server";
import {
  runSovereignLoop,
  makeDeterministicVoice,
  type SovereignInput,
} from "@/lib/agents/sovereign-orchestrator";

export const runtime = "nodejs";

interface SovereignRequest {
  projectId: string;
  topic: string;
  // Optional: caller can pre-seed evidence counts per role for testing.
  evidenceByRole?: Record<string, number>;
}

/**
 * POST /api/agents/sovereign — runs the debate→critique→synthesis→verification
 * loop with deterministic placeholder voices. Real callers wire LLM-backed
 * voices through the SovereignInput contract.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as SovereignRequest;
  if (!body?.projectId || !body?.topic) {
    return NextResponse.json({ error: "projectId + topic required" }, { status: 400 });
  }

  const mkEv = (role: string, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      kind: "build_verified" as const,
      status: "passed" as const,
      message: `${role} evidence #${i + 1}`,
      timestamp: new Date().toISOString(),
    }));

  const ev = body.evidenceByRole ?? { architect: 2, builder: 2, critic: 1 };

  const input: SovereignInput = {
    projectId: body.projectId,
    topic: body.topic,
    voices: {
      architect: makeDeterministicVoice("architect", {
        stance: "support",
        proposal: `Adopt sovereign synthesis for ${body.topic}`,
        reasoning: "Structurally clean and reuses existing kernels.",
        evidence: mkEv("architect", ev.architect ?? 0),
      }),
      builder: makeDeterministicVoice("builder", {
        stance: "amend",
        proposal: `with workflow-engine checkpointing per phase`,
        reasoning: "Concrete implementable shape.",
        evidence: mkEv("builder", ev.builder ?? 0),
      }),
      critic: makeDeterministicVoice("critic", {
        stance: "object",
        proposal: `Holds: needs deeper verification`,
        reasoning: "Risk surface around recovery semantics.",
        evidence: mkEv("critic", ev.critic ?? 0),
      }),
    },
    governor: async () => ({ allowed: true, blockers: [] }),
    evidenceFloor: 2,
    maxRounds: 2,
  };

  const outcome = await runSovereignLoop(input);
  return NextResponse.json(outcome);
}
