import { NextResponse } from "next/server";
import { runWorkflow, type WorkflowDefinition } from "@/lib/workflow/workflow-engine";

export const runtime = "nodejs";

interface WorkflowRequest {
  projectId: string;
  workflowId: string;
  steps: { id: string; description?: string }[];
  idempotencyKey?: string;
}

/**
 * POST /api/workflow — runs a synthetic durable workflow over the supplied
 * step ids. Each step records a "stage_passed" patch into the workflow
 * state and triggers a checkpoint. Returns the full WorkflowResult so
 * smoke tests can assert checkpoint / replay behaviour.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as WorkflowRequest;
  if (!body?.projectId || !body?.workflowId || !body?.steps?.length) {
    return NextResponse.json({ error: "projectId + workflowId + steps required" }, { status: 400 });
  }

  type State = { stages: string[] };
  const def: WorkflowDefinition<State> = {
    workflowId: body.workflowId,
    initialState: { stages: [] },
    idempotencyKey: body.idempotencyKey,
    steps: body.steps.map((s) => ({
      id: s.id,
      description: s.description,
      run: async (state, ctx) => {
        ctx.recordEvidence({
          kind: "build_verified",
          status: "passed",
          message: `Stage ${s.id} executed`,
          timestamp: new Date().toISOString(),
        });
        return { stages: [...state.stages, s.id] };
      },
    })),
  };

  const result = await runWorkflow(body.projectId, def);
  return NextResponse.json(result);
}
