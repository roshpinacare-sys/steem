// /api/agent-browser/chat — הסוכן החי של האתר: צ'אט LLM דרך z.ai עם
// הקשר העמוד הפתוח. זהו "לעבוד על z.ai מתוך האתר" — הערוץ החי עצמו.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentChat, type ChatMessage } from "@/lib/agent-browser/zai";

export const dynamic = "force-dynamic";

const MAX_MSG = 24;
const MAX_LEN = 8_000;

export async function POST(req: Request) {
  let messages: ChatMessage[] = [];
  let sessionSlug: string | null = null;
  let context: { url?: string; title?: string; text?: string } | undefined;

  try {
    const body = (await req.json()) as {
      messages?: unknown;
      context?: { url?: unknown; title?: unknown; text?: unknown };
      s?: unknown;
    };
    if (Array.isArray(body?.messages)) {
      messages = body.messages
        .filter(
          (m): m is { role: "user" | "assistant"; content: string } =>
            !!m &&
            typeof m === "object" &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            m.content.trim().length > 0,
        )
        .slice(0, MAX_MSG)
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_LEN) }));
    }
    sessionSlug = typeof body?.s === "string" && body.s ? body.s : null;
    if (body?.context && typeof body.context === "object") {
      const c = body.context as Record<string, unknown>;
      context = {
        url: typeof c.url === "string" ? c.url.slice(0, 500) : undefined,
        title:
          typeof c.title === "string" ? c.title.slice(0, 300) : undefined,
        text:
          typeof c.text === "string" ? c.text.slice(0, 12_000) : undefined,
      };
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "גוף הבקשה אינו JSON תקין" },
      { status: 400 },
    );
  }

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json(
      { ok: false, error: "נדרשת הודעת משתמש אחרונה בשיחה" },
      { status: 400 },
    );
  }

  try {
    const { reply, tookMs } = await agentChat(messages, context);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (sessionSlug && lastUser) {
      void db.browserVisit
        .create({
          data: {
            sessionId: sessionSlug,
            kind: "CHAT",
            url: `chat:${context?.url ?? "—"}`,
            title: lastUser.content.slice(0, 160),
          },
        })
        .catch(() => {});
    }
    return NextResponse.json({ ok: true, reply, tookMs });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof Error ? `הצ'אט נכשל: ${e.message}` : "הצ'אט נכשל",
      },
      { status: 502 },
    );
  }
}
