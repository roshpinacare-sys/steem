// ─────────────────────────────────────────────────────────────────────
// דפדפן הסוכנים · ערוץ z.ai — החיבור החי של האתר לשירותי ה-AI.
//
// "להתחבר ל-z.ai דרך האתר עצמו": כל היכולות (קריאת עמודים, חיפוש
// רשת, צ'אט LLM) זורמות מה-frontend של האתר ← ה-API שלו ← z-ai-web-dev-sdk
// בצד השרת בלבד. ה-SDK לעולם לא נחשף לקליינט; המפתחות נשארים בשרת.
//
// "שום טענה בלי מדידה": כל קריאה נמדדת — מונה, זמן-תגובה ממוצע וחותמת
// אחרונה. הסטטוס שמוצג למשתמש הוא מדידה גולמה, לא סיסמא "מחובר".
// ─────────────────────────────────────────────────────────────────────

import ZAI from "z-ai-web-dev-sdk";

// ── סינגלטון ZAI (יצירה אחת, שימוש חוזר) ────────────────────────────

let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null;

export function getZai() {
  if (!zaiPromise) {
    zaiPromise = ZAI.create();
  }
  return zaiPromise;
}

// ── מוני שימוש נמדדים (זיכרון-מקומי, מתאפסים בהפעלה מחדש — אמת גולמית) ──

export interface ChannelStats {
  count: number;
  avgMs: number;
  lastAt: string | null;
  lastOk: boolean | null;
}

interface ChannelsState {
  read: ChannelStats;
  search: ChannelStats;
  chat: ChannelStats;
}

const state: ChannelsState = {
  read: { count: 0, avgMs: 0, lastAt: null, lastOk: null },
  search: { count: 0, avgMs: 0, lastAt: null, lastOk: null },
  chat: { count: 0, avgMs: 0, lastAt: null, lastOk: null },
};

function record(
  channel: keyof ChannelsState,
  ok: boolean,
  tookMs: number,
): void {
  const s = state[channel];
  s.avgMs = Math.round((s.avgMs * s.count + tookMs) / (s.count + 1));
  s.count += 1;
  s.lastAt = new Date().toISOString();
  s.lastOk = ok;
}

export function channelStats() {
  return JSON.parse(JSON.stringify(state)) as ChannelsState;
}

// ── עטיפות מדודות ───────────────────────────────────────────────────

export interface ReadPageResult {
  ok: true;
  url: string;
  finalUrl: string;
  title: string;
  publishedTime: string | null;
  text: string; // טקסט נקי (תגיות הוסרו), עד READ_TEXT_CAP
  links: Array<{ url: string; label: string }>; // עד LINKS_CAP
  tokens: number | null;
  tookMs: number;
}

export interface SearchResultItem {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  date: string;
  rank: number;
}

const READ_TEXT_CAP = 24_000;
const LINKS_CAP = 40;

function stripTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function extractLinks(html: string): Array<{ url: string; label: string }> {
  const out = new Map<string, string>();
  const re = /<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    const label = stripTags(m[2]).slice(0, 120) || url;
    if (!out.has(url)) out.set(url, label);
    if (out.size >= LINKS_CAP) break;
  }
  return [...out.entries()].map(([url, label]) => ({ url, label }));
}

export async function readPage(url: string): Promise<ReadPageResult> {
  const t0 = Date.now();
  try {
    const zai = await getZai();
    const result = await zai.functions.invoke("page_reader", { url });
    const data = result?.data ?? result;
    const html: string = String(data?.html ?? "");
    const title: string = String(data?.title ?? "");
    if (!html && !title) {
      throw new Error("העמוד חזר ריק משירות הקריאה");
    }
    const text = stripTags(html).slice(0, READ_TEXT_CAP);
    const res: ReadPageResult = {
      ok: true,
      url,
      finalUrl: String(data?.url ?? url),
      title: title || url,
      publishedTime: data?.publishedTime ? String(data.publishedTime) : null,
      text,
      links: extractLinks(html),
      tokens:
        data?.usage?.tokens != null ? Number(data.usage.tokens) : null,
      tookMs: Date.now() - t0,
    };
    record("read", true, res.tookMs);
    return res;
  } catch (e) {
    record("read", false, Date.now() - t0);
    throw e;
  }
}

export async function webSearch(
  query: string,
  num = 8,
): Promise<{ items: SearchResultItem[]; tookMs: number }> {
  const t0 = Date.now();
  try {
    const zai = await getZai();
    const raw = await zai.functions.invoke("web_search", { query, num });
    const items: SearchResultItem[] = Array.isArray(raw)
      ? (raw as SearchResultItem[])
      : ((raw as { data?: SearchResultItem[] })?.data ?? []);
    const res = { items, tookMs: Date.now() - t0 };
    record("search", items.length > 0, res.tookMs);
    return res;
  } catch (e) {
    record("search", false, Date.now() - t0);
    throw e;
  }
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function agentChat(
  messages: ChatMessage[],
  context?: { url?: string; title?: string; text?: string },
): Promise<{ reply: string; tookMs: number }> {
  const t0 = Date.now();
  try {
    const zai = await getZai();
    const contextBlock = context?.text
      ? `\n\n[הקשר — העמוד שפתוח כרגע בדפדפן הסוכנים]\nכתובת: ${context.url ?? "—"}\nכותרת: ${context.title ?? "—"}\nתוכן (קטע):\n${context.text.slice(0, 8_000)}`
      : "";
    const system =
      "אתה הסוכן החי של אתר THE WEAVE — עוזר AI ריבוני שפועל מתוך האתר עצמו דרך שירותי z.ai. " +
      "ענה בעברית ברורה ומדויקת, בתמציתיות ובנימה מקצועית. " +
      "כשיש הקשר של עמוד שצוין — היעזר בו לתשובות מדויקות וציין שהשתמשת בו." +
      contextBlock;
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: system },
        ...messages.slice(-16),
      ],
      thinking: { type: "disabled" },
    });
    const reply = completion.choices[0]?.message?.content ?? "";
    if (!reply.trim()) throw new Error("התשובה חזרה ריקה");
    const res = { reply, tookMs: Date.now() - t0 };
    record("chat", true, res.tookMs);
    return res;
  } catch (e) {
    record("chat", false, Date.now() - t0);
    throw e;
  }
}

// ── עזרי תקינות ──────────────────────────────────────────────────────

export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const looksLikeUrl =
    /^https?:\/\//i.test(s) ||
    (/^[\w-]+(\.[\w-]+)+(\/|$|\?)/.test(s) && !s.includes(" "));
  if (!looksLikeUrl) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newSlug(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  }
  return s;
}

export function domainValid(domain: string): boolean {
  return (
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
      domain,
    ) && domain.length <= 253
  );
}
