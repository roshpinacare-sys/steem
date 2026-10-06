import { brainChat, brainPoolStatus, brainProbeAll, type BrainChatMessage } from "@/lib/weave/brain";

export const runtime = "nodejs";

/** GET /api/weave/brain — מצב המאגר (מסכה מלאה, אפס סודות) + ?probe=1 לאימות-אמת חי. */
export async function GET(req: Request) {
  try {
    const probe = new URL(req.url).searchParams.get("probe");
    const status = await brainPoolStatus();
    const probed = probe === "1" ? await brainProbeAll() : undefined;
    return Response.json({
      ok: true,
      brain: {
        ...status,
        probed,
        doctrine:
          "המוח הריבוני: מאגר מפתחות NVIDIA NIM אטום תחת גזירת מפתח-הרשת · רוטציה אוטומטית (429→90ש', 401/403→30ד', הבא משרת מיד) · אימות-אמת = 1-token chat חי · אפס סוד ב-API לעולם",
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת מוח" },
      { status: 500 }
    );
  }
}

const MAX_MESSAGES = 32;
const MAX_CONTENT = 8_000;
const MAX_TOKENS = 1_024;

/** POST /api/weave/brain — המוח מדבר. { messages: [{role,content}], model?, maxTokens? } */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      messages?: Array<{ role?: string; content?: string }>;
      model?: string;
      maxTokens?: number;
      temperature?: number;
    } | null;

    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return Response.json({ ok: false, error: "נדרש מערך messages לא-ריק" }, { status: 400 });
    }
    if (body.messages.length > MAX_MESSAGES) {
      return Response.json({ ok: false, error: `מקסימום ${MAX_MESSAGES} הודעות` }, { status: 400 });
    }
    const messages: BrainChatMessage[] = [];
    for (const m of body.messages) {
      const role = m.role === "system" || m.role === "assistant" ? m.role : "user";
      const content = String(m.content ?? "");
      if (!content.trim()) continue;
      if (content.length > MAX_CONTENT) {
        return Response.json({ ok: false, error: `הודעה ארוכה מ-${MAX_CONTENT} תווים` }, { status: 400 });
      }
      messages.push({ role, content });
    }
    if (messages.length === 0) {
      return Response.json({ ok: false, error: "כל ההודעות ריקות" }, { status: 400 });
    }

    const result = await brainChat(messages, {
      model: typeof body.model === "string" && /^[\w\-./:]{1,80}$/.test(body.model) ? body.model : undefined,
      maxTokens: Math.min(Math.max(1, Number(body.maxTokens) || 256), MAX_TOKENS),
      temperature: Math.min(Math.max(0, Number(body.temperature) ?? 0.2), 1),
    });

    return Response.json({ ok: result.ok, brain: result }, { status: result.ok ? 200 : 503 });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת מוח" },
      { status: 500 }
    );
  }
}
