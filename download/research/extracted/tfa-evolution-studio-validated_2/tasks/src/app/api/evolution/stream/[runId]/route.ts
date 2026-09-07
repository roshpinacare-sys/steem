import { NextRequest } from "next/server";
import { getActivePipelineRun, subscribePipelineRun } from "@/lib/engine/pipeline-engine";
import { getActiveRun, subscribeRun } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRun = { complete?: boolean; status?: string };

function isRunDone(run: AnyRun): boolean {
  if (run.complete === true) return true;
  if (run.status === "complete" || run.status === "completed" || run.status === "failed") return true;
  return false;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;

  const run = (getActivePipelineRun(runId) ?? getActiveRun(runId)) as AnyRun | undefined;
  if (!run) return new Response("Run not found", { status: 404 });

  const subscribeFn = getActivePipelineRun(runId) ? subscribePipelineRun : subscribeRun;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (data: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

      send({ type: "snapshot", run });

      const unsub = (subscribeFn as (id: string, cb: (entry: unknown) => void) => () => void)(runId, (entry) => {
        send({ type: "log", entry, run });
        if (isRunDone(run)) {
          send({ type: "done", run });
          clearInterval(interval);
          unsub();
          try { controller.close(); } catch { /* ignore */ }
        }
      });

      const interval = setInterval(() => {
        if (isRunDone(run)) {
          send({ type: "done", run });
          clearInterval(interval);
          unsub();
          try { controller.close(); } catch { /* ignore */ }
        }
      }, 2000);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        unsub();
        try { controller.close(); } catch { /* ignore */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
