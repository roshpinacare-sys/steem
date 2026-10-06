// /api/agent-browser/status — מצב ערוצי z.ai כפי שנמדד בפועל.
// GET  → מונים נצברים (כמה קריאות, זמן ממוצע, מתי לאחרונה).
// POST → בדיקת-חיבור חיה אמיתית: קריאת LLM מזערית ומדידת ההשהיה.

import { NextResponse } from "next/server";
import { agentChat, channelStats } from "@/lib/agent-browser/zai";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    channels: channelStats(),
  });
}

export async function POST() {
  const t0 = Date.now();
  try {
    const { reply, tookMs } = await agentChat([
      { role: "user", content: "בדיקת חיבור. ענה בדיוק במילה אחת: שלום" },
    ]);
    return NextResponse.json({
      ok: true,
      roundTripMs: Date.now() - t0,
      llmMs: tookMs,
      sample: reply.slice(0, 120),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        roundTripMs: Date.now() - t0,
        error: e instanceof Error ? e.message : "בדיקת החיבור נכשלה",
      },
      { status: 502 },
    );
  }
}
