import { NextResponse } from "next/server";
import { guardAiBridge, shieldReject } from "@/lib/exposureShield";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * T-49 · IMAGE-GENERATION BRIDGE (engine-called, backend-only law) — the
 * second content-team rung (T-33-NEXT ladder): ORIGINAL artwork, no external
 * source to rot or hijack (the T-45 dlease lesson).
 *
 * MEASURED (live probes, 2026-10-03):
 *  · the SDK's images.generations.create discards the hosted URL (it
 *    downloads to base64) — this route calls the RAW endpoint and keeps the
 *    URL, the only shape that can ride Steem markdown;
 *  · the raw endpoint demands a size whose sides are 32-multiples in
 *    512..2880 with ≤2^22 pixels — the SDK's advertised "1440x720" FAILS
 *    that law (error #1214, live-probed); 1344x768 passes;
 *  · Bearer-only auth is 401 — the full SDK header set (X-Chat-Id, X-User-Id,
 *    X-Token from the same .z-ai-config the SDK reads) is 200;
 *  · the returned URL is SIGNED (Expires ≈ +8 days measured) and serves
 *    IMAGE BYTES via GET while refusing HEAD (403) — verification is
 *    magic-bytes-on-GET, never HEAD.
 *
 * LAWS: URL-only across the bridge (base64 never crosses — bounded payload);
 * https + no-whitespace; bounded GET verify (first bytes, image magic) so a
 * URL that does not serve image bytes never reaches a draft; prompt ≤600
 * chars; fail 502 typed — a digest without a banner still queues.
 */

/* ── pure laws (live-probed both directions) ── */
export function imagegenSizeLaw(size: unknown): string | null {
  const raw = typeof size === "string" ? size.trim() : "";
  const m = /^(\d+)x(\d+)$/.exec(raw);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isInteger(w) || !Number.isInteger(h)) return null;
  if (w < 512 || h < 512 || w > 2880 || h > 2880) return null;
  if (w % 32 !== 0 || h % 32 !== 0) return null; // measured error #1214
  if (w * h > 4194304) return null; // ≤ 2^22 pixels (measured bound)
  return `${w}x${h}`;
}

export function imagegenPromptLaw(prompt: unknown): string | null {
  const raw = typeof prompt === "string" ? prompt.trim() : "";
  if (raw.length < 3) return null;
  return raw.slice(0, 600);
}

export function imagegenHeadersLaw(cfg: Record<string, unknown>): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${String(cfg.apiKey ?? "")}`,
    "X-Z-AI-From": "Z",
  };
  if (cfg.chatId) h["X-Chat-Id"] = String(cfg.chatId);
  if (cfg.userId) h["X-User-Id"] = String(cfg.userId);
  if (cfg.token) h["X-Token"] = String(cfg.token);
  return h;
}

export function imageMagicOk(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true; // png
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true; // jpeg (measured)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true; // gif
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true; // webp
  return false;
}

export function extractGenUrl(payload: unknown): string | null {
  const data = (payload as { data?: Array<{ url?: unknown; base64?: unknown }> })?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const url = data[0]?.url;
  if (typeof url !== "string") return null; // base64-only payload → no hosted url → honest null
  const u = url.trim();
  if (!/^https:\/\//.test(u) || /\s/.test(u) || u.length > 2048) return null;
  return u;
}

/* SDK-priority config law: cwd → home → /etc (measured from the SDK source) */
function loadGenConfig(): Record<string, unknown> | null {
  for (const p of [path.join(process.cwd(), ".z-ai-config"), path.join(os.homedir(), ".z-ai-config"), "/etc/.z-ai-config"]) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
      if (cfg && typeof cfg.baseUrl === "string" && typeof cfg.apiKey === "string" && cfg.baseUrl && cfg.apiKey) return cfg;
    } catch { /* try next priority */ }
  }
  return null;
}

/* bounded GET verify — this host refuses HEAD (403, measured); the law reads
 * the first bytes and cancels the stream, never the whole image */
async function verifyImageBytes(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok || !res.body) return false;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < 16) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.length; }
    }
    await reader.cancel().catch(() => {});
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    return imageMagicOk(merged);
  } catch { return false; }
}

const DEFAULT_PROMPT = "minimalist abstract technology illustration, warm amber and deep teal palette, geometric network garden, no text";

export async function POST(req: Request) {
  /* T-35 EXPOSURE SHIELD: same law as every AI bridge — same-origin (browser)
   * or token-carried (engine) only, never public */
  const refused = shieldReject(guardAiBridge(req));
  if (refused) return refused;
  let body: { prompt?: unknown; size?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body → default prompt */ }
  const prompt = imagegenPromptLaw(body.prompt) ?? DEFAULT_PROMPT;
  const size = imagegenSizeLaw(body.size) ?? "1344x768";
  if (body.prompt !== undefined && imagegenPromptLaw(body.prompt) === null) {
    return NextResponse.json({ ok: false, error: "imagegen-prompt-refused" }, { status: 422 });
  }
  if (body.size !== undefined && imagegenSizeLaw(body.size) === null) {
    return NextResponse.json({ ok: false, error: "imagegen-size-refused", law: "sides 512..2880, 32-multiples, ≤2^22 pixels (measured #1214)" }, { status: 422 });
  }
  const cfg = loadGenConfig();
  if (!cfg) return NextResponse.json({ ok: false, error: "imagegen-config-missing" }, { status: 502 });
  try {
    const t0 = Date.now();
    const res = await fetch(`${String(cfg.baseUrl)}/images/generations`, {
      method: "POST",
      headers: imagegenHeadersLaw(cfg),
      body: JSON.stringify({ prompt, size }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: "imagegen-upstream", status: res.status, detail: errText.slice(0, 160) },
        { status: 502 }
      );
    }
    const url = extractGenUrl(await res.json());
    if (!url) return NextResponse.json({ ok: false, error: "imagegen-no-url" }, { status: 502 });
    if (!(await verifyImageBytes(url))) return NextResponse.json({ ok: false, error: "imagegen-unverified" }, { status: 502 });
    return NextResponse.json({ ok: true, url, kind: "generated", ms: Date.now() - t0, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "imagegen-failed", detail: String((e as Error)?.message ?? e).slice(0, 160) },
      { status: 502 }
    );
  }
}
