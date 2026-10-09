/**
 * _llmRetry.ts: R263 · THE LLM RETRY (shared by the saos/ai bridge routes).
 *
 * THE MEASURED ROOT CAUSE (live, 2026-10-08 01:09Z): the LLM provider
 * returned `429 Too many requests` mid-round; the content bridge answered
 * 502; the engine honestly marked BRIDGE-DOWN and the draft queue starved
 * to zero while 15 published posts were still climbing. A rate limit is a
 * TRANSIENT weather event; a starving writers' room is structural damage.
 *
 * THE LAW: retry a provider call on 429 / 5xx / network weather with
 * escalating backoff (2.5s → 6s → 12s, +≤0.8s jitter). This helper NEVER
 * fabricates output, on final failure the caller answers 502 and the
 * engine falls to its lawful persona seed floor (the conversation never
 * depends on one machine being up). Engine-side pure laws are unaffected:
 * sanitizeDraft / sanitizeReply / dedupe still own the gate.
 */
export async function withLlmRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message ?? e);
      const retriable = /\b429\b|too many requests|status 5\d\d|timeout|ECONN|fetch failed|network|socket/i.test(msg);
      if (!retriable || i === attempts - 1) break;
      const backoff = [2500, 6000, 12000][Math.min(i, 2)] + Math.floor(Math.random() * 800);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/**
 * R263 · THE VOICE WRAP: the engine now sends a full persona brief with
 * every conversational call ("אינטלגנציה וסגנון כתיבה אישי יעודי לכל אחד").
 * When a brief is present it becomes a hard in-voice law appended to the
 * system prompt; when absent the base system prompt stands alone.
 */
export function withVoice(systemPrompt: string, personaBrief: string | null | undefined): string {
  const brief = String(personaBrief ?? "").trim().slice(0, 1800);
  if (!brief) return systemPrompt;
  return `${systemPrompt}

YOUR VOICE (you ARE this writer this time):
${brief}
IN-VOICE LAW: the reaction, the example, and the question must be ones THIS writer would actually make. Honor the signature slang at most once, naturally, never forced. Keep the register dial exactly as written (professional lean stays crisp, neighborhood lean stays warm). Never mention the persona mechanics themselves.`;
}

/* ── R298 · THE SECOND PROVIDER (NVIDIA NIM, OpenAI-compatible) ──────────
 * The operator supplied an agents' key (nvapi-…). Law: the key NEVER enters
 * the repo — it lives in .env.local (git-ignored) and is read via env only.
 * Measured 2026-10-09: auth valid (GET /models → 200) but the account had
 * no deployed chat functions (404 function-not-found on probes). The chain
 * law is exactly right for this: an env-gated LAST candidate with a tight
 * timeout — it never delays the happy path, fails honestly (metadata only)
 * when NVIDIA's provisioning is down, and starts working the moment their
 * side recovers, with zero code change. Model override: NVIDIA_MODEL. */
const NV_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
export function nvidiaKeyPresent(): boolean {
  return Boolean(String(process.env.NVIDIA_API_KEY ?? "").trim());
}
export async function nvidiaChat(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string> {
  const key = String(process.env.NVIDIA_API_KEY ?? "").trim();
  if (!key) throw new Error("nvidia: no api key (env NVIDIA_API_KEY absent)");
  const model = String(process.env.NVIDIA_MODEL ?? "nvidia/llama-3.1-nemotron-70b-instruct");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  try {
    const r = await fetch(NV_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        max_tokens: opts.maxTokens ?? 700,
        temperature: opts.temperature ?? 0.7,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`nvidia status ${r.status}: ${detail.slice(0, 140)}`);
    }
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    return String(j?.choices?.[0]?.message?.content ?? "");
  } finally {
    clearTimeout(t);
  }
}
