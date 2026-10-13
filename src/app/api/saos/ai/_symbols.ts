/**
 * _symbols.ts — R283 · THE SYMBOL LAW (operator order 2026-10-08).
 * The operator banned three glyph families in ALL outbound text — posts,
 * titles, replies, comments — in any state, anywhere:
 *   - every dash glyph (em, en, figure, horizontal bar),
 *   - every double-quote glyph (straight and curly),
 *   - the colon.
 * The old prompt even TAUGHT the model to prefer colons over dashes; the
 * chain audit measured 120 of 235 live bodies carrying banned glyphs.
 * This module normalizes a draft into safe readable punctuation and FAILS
 * CLOSED when a banned glyph survives (the route answers 502 and the
 * engine falls to its lawful floor, which now runs the same law).
 * Markdown link and image targets are protected — a URL is not visible
 * prose and must stay a working URL.
 */
const BANNED = /[\u2014\u2013\u2012\u2015:"\u201c\u201d]/;

export function enforceSymbolLaw(text: string): string | null {
  let t = String(text ?? "");
  if (!t) return "";
  const urls: string[] = [];
  t = t.replace(/\]\(([^)\s]+)\)/g, (_m, u: string) => {
    urls.push(u);
    return `]\u0000${urls.length - 1}\u0000)`;
  });
  t = t.replace(/\bhttps:\/\/[^\s)]+/g, (u) => {
    urls.push(u);
    return `\u0000${urls.length - 1}\u0000`;
  });
  t = t
    .replace(/(\s*)[\u2014\u2013\u2012\u2015](\s*)/g, ", ")
    .replace(/["\u201c\u201d]/g, "")
    .replace(/:\s*([a-z])/g, (_m, c: string) => `. ${c.toUpperCase()}`)
    .replace(/(\s*):(\s*)/g, ". ")
    .replace(/\s+([.,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  t = t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => urls[Number(i)] ?? "");
  if (BANNED.test(t)) return null;
  return t;
}

/**
 * R283 · THE PROMPT LAW: appended to every drafting system prompt so the
 * model never produces the banned glyphs in the first place.
 */
export const SYMBOL_PROMPT_LAW = `ABSOLUTE SYMBOL BAN (violations make the output unusable, this outranks every style instruction below):
- Never use any dash glyph — no em dash, no en dash, no hyphen used as a pause. Use a comma or a period instead.
- Never use double quotes, straight or curly, anywhere. If you refer to a word or phrase, just write the words bare.
- Never use a colon anywhere. A place where a colon feels natural becomes a period followed by a new sentence, or a comma.
- Apostrophes inside contractions and singular possessives are fine (dont's contractions like "you're" are allowed).
- Write in plain flowing sentences. End sentences with a period. Nothing else is needed.`;

/**
 * R283 · ANTI-TEMPLATE LAW: the chain audit showed form-letter framings.
 * These framings are banned as openers in the first sentence.
 */
export const ANTI_TEMPLATE_LAW = `ANTI-TEMPLATE LAW:
- Never open with a framing phrase. Banned framings include "Let's measure it", "Bottom line up front", "The trigger point is", "One more layer", "This is exactly the thread worth pulling", "Here's the thing". Start inside the substance itself.
- Never reuse a sentence skeleton across replies. Vary where the specific detail lands, vary the rhythm, sometimes end on a statement, sometimes on a specific question, sometimes mid-thought.`;

/** validate + normalize a drafted body; null means REFUSED (fail-closed) */
export function validateDraftBody(body: string): string | null {
  const t = enforceSymbolLaw(String(body ?? ""));
  if (t === null) return null;
  if (t.length < 20) return null;
  return t;
}
