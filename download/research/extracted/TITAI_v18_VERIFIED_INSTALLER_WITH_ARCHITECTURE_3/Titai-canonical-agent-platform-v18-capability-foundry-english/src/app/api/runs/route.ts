import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { startAgentRun } from "@/lib/engine/start";
import { runManager } from "@/lib/engine/runner";
import { listRuns } from "@/lib/db/queries/runs";
import { PROVIDERS } from "@/lib/constants";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";

export const runtime = "nodejs";

const startSchema = z.object({
  objective: z.string().min(1).max(4000),
  agentId: z.string().min(1),
  provider: z.enum(PROVIDERS as [string, ...string[]]).optional(),
  model: z.string().max(120).optional(),
  dryRun: z.boolean().optional(),
  deadlineSeconds: z.number().int().min(30).max(86_400).optional(),
  maxOutputTokens: z.number().int().min(256).max(16_384).optional(),
  maxContextTokens: z.number().int().min(2_000).max(200_000).optional(),
  useDurableRunner: z.boolean().optional(),
  includeMemory: z.boolean().optional(),
  tenantId: z.string().min(1).max(120).optional(),
  workspaceId: z.string().min(1).max(120).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const scope = resolvePilotScope(session.user.id);
  void runManager.recoverDurableRuns(session.user.id);
  return NextResponse.json({ runs: listRuns(session.user.id, 50, scope), scope });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { checkRateLimit } = await import("@/lib/rate-limit");
  if (!checkRateLimit(`run-start:${session.user.id}`, { limit: 12, windowMs: 60_000 })) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = startSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: "invalid_idempotency_key" }, { status: 400 });
  }
  const result = await startAgentRun({
    userId: session.user.id,
    objective: parsed.data.objective,
    agentId: parsed.data.agentId,
    providerOverride: parsed.data.provider as never,
    modelOverride: parsed.data.model,
    dryRun: parsed.data.dryRun,
    idempotencyKey,
    deadlineSeconds: parsed.data.deadlineSeconds,
    maxOutputTokens: parsed.data.maxOutputTokens,
    maxContextTokens: parsed.data.maxContextTokens,
    useDurableRunner: parsed.data.useDurableRunner,
    includeMemory: parsed.data.includeMemory,
    tenantId: parsed.data.tenantId,
    workspaceId: parsed.data.workspaceId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(
    { runId: result.runId, reused: result.reused ?? false },
    { status: result.reused ? 200 : 201 },
  );
}
