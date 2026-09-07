// ─────────────────────────────────────────────────────────────────────────────
// SAOS AI — backend-only wrapper around z-ai-web-dev-sdk.
// Every call degrades gracefully to a deterministic fallback so the simulation
// never stalls when the LLM is slow/unavailable. Used by module manual actions
// (e.g. "compose with real LLM") and light tick-time judgments.
// ─────────────────────────────────────────────────────────────────────────────
import ZAI from 'z-ai-web-dev-sdk'

export async function llmText(system: string, user: string, maxTokens = 350): Promise<string | null> {
  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
    })
    const text = completion.choices[0]?.message?.content?.trim()
    return text && text.length > 0 ? text : null
  } catch {
    return null
  }
}

/** Quick heuristic sentiment/quality score 0..1 (no LLM latency). */
export function heuristicScore(title: string, body: string): number {
  const len = Math.min(body.length / 600, 1)
  const hasQ = title.includes('?') ? 0.1 : 0
  const hasNum = /\d/.test(body) ? 0.05 : 0
  const uniq = new Set(body.split(/\s+/)).size / Math.max(body.split(/\s+/).length, 1)
  return Math.min(1, len * 0.5 + uniq * 0.3 + hasQ + hasNum)
}
