import { auth } from "@/auth";
import { getRun } from "@/lib/db/queries/runs";
import { getEventsAfter, subscribeRun } from "@/lib/engine/events";
import type { RunEvent } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("unauthorized", { status: 401 });
  }
  const { runId } = await params;
  const run = getRun(session.user.id, runId);
  if (!run) return new Response("not found", { status: 404 });

  const url = new URL(req.url);
  const lastEventIdHeader = req.headers.get("last-event-id");
  const afterParam = url.searchParams.get("after");
  const initialAfter = Number(lastEventIdHeader ?? afterParam ?? 0) || 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: RunEvent) => {
        if (closed) return;
        const frame =
          `id: ${event.id}\n` +
          `event: ${event.type}\n` +
          `data: ${JSON.stringify({ id: event.id, seq: event.seq, type: event.type, payload: event.payload })}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };

      // 1) Replay everything since the client's last id.
      const backlog = getEventsAfter(runId, initialAfter);
      let lastId = initialAfter;
      for (const e of backlog) {
        send(e);
        lastId = e.id;
      }

      // If the run is already terminal and fully replayed, close.
      const fresh = getRun(session.user!.id, runId);
      const alreadyDone = fresh && TERMINAL.has(fresh.status);

      // 2) Subscribe to live events (dedupe against replayed ids).
      const unsub = subscribeRun(runId, (e) => {
        if (e.id > lastId) {
          lastId = e.id;
          send(e);
          if (TERMINAL_EVENT.has(e.type)) {
            cleanup();
          }
        }
      });

      // Heartbeat so proxies keep the connection open.
      const heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsub();
        try {
          controller.enqueue(encoder.encode(`event: end\ndata: {}\n\n`));
          controller.close();
        } catch {
          /* already closed */
        }
      };

      if (alreadyDone) {
        // Give the subscribe a tick in case new events arrived mid-replay.
        setTimeout(cleanup, 50);
      }

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

const TERMINAL_EVENT = new Set([
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.interrupted",
]);
