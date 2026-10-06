// llm-bridge — r166 sovereign fleet service (port 3048).
// OpenAI-compatible chat-completions endpoint over z-ai-web-dev-sdk (backend only).
// Purpose: any OpenAI/litellm-client agent (mini-swe-agent, reef-infra route, etc.)
// can run against OUR OWN LLM capability — no third-party API keys.
//
// Endpoints:
//   GET  /health                    -> {ok, model, completions}
//   GET  /v1/models                 -> OpenAI list payload
//   POST /v1/chat/completions       -> OpenAI chat.completion payload (non-streaming)
//
// Mapping notes: z-ai SDK takes system prompts in the first message; we keep
// role "system" if the SDK accepts it and fall back to "assistant" mapping
// (per SDK docs) when system role is refused. thinking stays disabled.

import ZAI from "z-ai-web-dev-sdk";

const PORT = 3048;
const MODEL_ID = "sovereign-zai";

let zai: any = null;
let completions = 0;
// r177 — תצפית-מיכסה: ה-429-היום-היה-בלתי-נראה (חיובי-שקר-ב-health) — מעתה
// המיכסה-נמדדת: מתי-נחסמנו, כמה-פעמים, וכמה-מתחים-החזירו-אותנו-לחיים.
let last429At: string | null = null;
let rateLimitedCount = 0;
let retriesRecovered = 0;
let lastUpstreamError: string | null = null;

async function getZai() {
  if (!zai) zai = await ZAI.create();
  return zai;
}

function json(_unused: unknown, code: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: code,
    headers: { "Content-Type": "application/json" },
  });
}

type Msg = { role: string; content: string };

function mapMessages(messages: Msg[]): Msg[] {
  // SDK docs: system prompt travels in the first message; "assistant" role is
  // its documented carrier. Merge leading system messages into one, mapped to
  // "assistant", keep user/assistant messages in order.
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  const out: Msg[] = [];
  if (sys) out.push({ role: "assistant", content: sys });
  out.push(...rest);
  if (out.length === 0) out.push({ role: "user", content: "" });
  return out;
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 240, // long agent turns
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return json(null, 200, {
        ok: true,
        service: "llm-bridge",
        engine: "z-ai-web-dev-sdk (backend)",
        model: MODEL_ID,
        completions,
        // r177 — תצפית-מיכסה (שקיפות-מלאה — גם-חסימה-היא-מצב)
        quota: {
          rateLimited: last429At != null && Date.now() - Date.parse(last429At) < 15 * 60_000,
          last429At,
          rateLimitedCount,
          retriesRecovered,
          lastUpstreamError,
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      return json(null, 200, {
        object: "list",
        data: [{ id: MODEL_ID, object: "model", created: 1735689600, owned_by: "sovereign" }],
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json(null, 400, { error: { message: "invalid_json", type: "bad_request" } });
      }
      const messages = Array.isArray(body?.messages) ? body.messages : null;
      if (!messages) {
        return json(null, 400, { error: { message: "messages array required", type: "bad_request" } });
      }
      const t0 = Date.now();
      // r176-b: ניסיון-חוזר-אחד-מהיר — לא-הספיק. r176-c — השורש-האמיתי-נמדד:
      // ה-backend-מחזיר **429 Too many requests** (חשבון-מגביל-קצב, במיוחד-בבורסטים-
      // של-pushes-עם-קוד — כל-push-זה-2-קריאות-סקירה-בדיפ-24K). סדרת-מתחים-מודעת-429:
      // 1.5ש' → 20ש' → 45ש' (סה"כ ~67ש' — בתוך-ה-CALL_TIMEOUT-120ש'-של-ה-gate).
      // 502-רשתי-אמיתי-מקבל-מתח-מהיר; 429-מקבל-המתנה-ארוכה. כישלון-אמיתי-נשאר-כנה (R123).
      let completion: any = null;
      let lastErr: any = null;
      let usedRetries = false; // r177 — קבלה-כנה: רק-מתח-שבאמת-הציל
      const BACKOFFS_MS = [1_500, 20_000, 45_000];
      for (let attempt = 1; attempt <= BACKOFFS_MS.length + 1; attempt++) {
        try {
          const client = await getZai();
          completion = await client.chat.completions.create({
            messages: mapMessages(messages),
            thinking: { type: "disabled" },
          });
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e;
          usedRetries = true;
          const msg = String(e?.message || e);
          lastUpstreamError = msg.slice(0, 200);
          if (/429|too many/i.test(msg)) {
            rateLimitedCount += 1;
            last429At = new Date().toISOString();
          }
          if (attempt <= BACKOFFS_MS.length) {
            const wait = /429|too many/i.test(msg) ? BACKOFFS_MS[attempt - 1] : Math.min(BACKOFFS_MS[attempt - 1], 1_500);
            console.log(`[llm-bridge] upstream error (attempt ${attempt}) — retrying in ${Math.round(wait / 1000)}s: ${msg.slice(0, 160)}`);
            await new Promise((r) => setTimeout(r, wait));
          }
        }
      }
      try {
        if (lastErr || !completion) throw lastErr ?? new Error("no_completion");
        if (usedRetries) retriesRecovered += 1; // r177 — קבלה: מתח-החזיר-לחיים
        const content: string = completion?.choices?.[0]?.message?.content ?? "";
        completions++;
        return json(null, 200, {
          id: `chatcmpl-sovereign-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body?.model || MODEL_ID,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: {
            // honest estimation: characters/4 (we do not receive token counts)
            prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4),
            completion_tokens: Math.ceil((content || "").length / 4),
            total_tokens: 0,
          },
          sovereign: { took_ms: Date.now() - t0, upstream: "z-ai" },
        });
      } catch (err: any) {
        return json(null, 502, {
          error: { message: String(err?.message || err).slice(0, 300), type: "upstream_error" },
        });
      }
    }

    return json(null, 404, { error: { message: "not_found", type: "bad_request" } });
  },
});

function noop() {}

console.log(`[llm-bridge] OpenAI-compatible endpoint on :${PORT} model=${MODEL_ID}`);
