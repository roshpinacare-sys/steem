import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/**
 * /api/nvidia-nim — חוליה-חיה למוח-ה-NIM הריבוני (NVIDIA NIM, תואם-OpenAI).
 *
 * מה-זה מוכיח: הקישורות-והטביעה מדודות-חי — כמה-מודלים, איזו-זמן-תגובה, וטביעת-אצבע
 * של-המפתח (12 תווי-hash ראשונים) כדי-לאמת איזה-מפתח-חתום-בלי-לחשוף-אף-תו-ממנו.
 * ?probe=1 — בדיקת-הסקה-זעירה-אחת (glm-5.3-flash, ≤200 טוקנים) בדרישה-בלבד:
 * אפס-שריפת-טוקנים-ברענון-האוטומטי. רישומת-מפתח: NVIDIA_NIM_API_KEY (env) או
 * קובץ-אטום NVIDIA_NIM_KEY_FILE (ברירת-מחדל /home/z/my-project/upload/nvidia-nim.env).
 * אפס-סוד-בפלט — תמיד.
 */

export const dynamic = "force-dynamic";

const KEY_FILE = process.env.NVIDIA_NIM_KEY_FILE || "/home/z/my-project/upload/nvidia-nim.env";
const BASE = process.env.NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1";
const PROBE_MODEL = "z-ai/glm-5.3-flash";
const TTL_MS = 5 * 60 * 1000;

interface NimStatus {
  ok: boolean;
  hasKey: boolean;
  fingerprint: string | null;
  models: number | null;
  latencyMs: number | null;
  checkedAt: string | null;
  error?: string;
  probe?: {
    ok: boolean;
    model: string;
    latencyMs: number;
    finishReason: string | null;
    hasContent: boolean;
    totalTokens: number | null;
    error?: string;
  } | null;
}

let cache: { at: number; data: NimStatus } | null = null;
let inflight: Promise<NimStatus> | null = null;

async function readKey(): Promise<string | null> {
  const envKey = process.env.NVIDIA_NIM_API_KEY;
  if (envKey && envKey.trim().length > 10) return envKey.trim();
  try {
    const raw = await readFile(KEY_FILE, "utf8");
    const m = raw.match(/nvapi-[A-Za-z0-9_-]+/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

async function measure(): Promise<NimStatus> {
  const key = await readKey();
  if (!key) {
    return {
      ok: false,
      hasKey: false,
      fingerprint: null,
      models: null,
      latencyMs: null,
      checkedAt: new Date().toISOString(),
      error: "key-not-sealed-locally (נאמת-כנה — אין-מפתח-בסביבה-זו)",
    };
  }
  const fingerprint = createHash("sha256").update(key).digest("hex").slice(0, 12);
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    const latencyMs = Date.now() - t0;
    if (!r.ok) {
      cache = null; // טיהור-על-התיישבות — אף-תמונה-זקנה-לא-שורדת (שיעור-G4)
      return {
        ok: false,
        hasKey: true,
        fingerprint,
        models: null,
        latencyMs,
        checkedAt: new Date().toISOString(),
        error: `upstream HTTP ${r.status}`,
      };
    }
    const d = (await r.json()) as { data?: unknown[] };
    return {
      ok: true,
      hasKey: true,
      fingerprint,
      models: Array.isArray(d.data) ? d.data.length : null,
      latencyMs,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    cache = null;
    return {
      ok: false,
      hasKey: true,
      fingerprint,
      models: null,
      latencyMs: Date.now() - t0,
      checkedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message.slice(0, 120) : "fetch-failed",
    };
  }
}

async function runProbe(key: string): Promise<NimStatus["probe"]> {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PROBE_MODEL,
        messages: [{ role: "user", content: "Reply with exactly: ALIVE" }],
        max_tokens: 200,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const latencyMs = Date.now() - t0;
    if (!r.ok) {
      return { ok: false, model: PROBE_MODEL, latencyMs, finishReason: null, hasContent: false, totalTokens: null, error: `upstream HTTP ${r.status}` };
    }
    const d = (await r.json()) as {
      choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }>;
      usage?: { total_tokens?: number } | null;
    };
    const msg = d.choices?.[0]?.message ?? {};
    const hasContent = Boolean((msg.content ?? "").trim() || (msg.reasoning_content ?? "").trim());
    return {
      ok: Boolean(d.choices?.length) && hasContent,
      model: PROBE_MODEL,
      latencyMs,
      finishReason: d.choices?.[0]?.finish_reason ?? null,
      hasContent,
      totalTokens: d.usage?.total_tokens ?? null,
    };
  } catch (e) {
    return { ok: false, model: PROBE_MODEL, latencyMs: Date.now() - t0, finishReason: null, hasContent: false, totalTokens: null, error: e instanceof Error ? e.message.slice(0, 120) : "probe-failed" };
  }
}

export async function GET(req: Request): Promise<Response> {
  const wantProbe = new URL(req.url).searchParams.get("probe") === "1";

  let status: NimStatus;
  if (cache && Date.now() - cache.at < TTL_MS) {
    status = cache.data;
  } else {
    if (!inflight) {
      inflight = measure().finally(() => {
        inflight = null;
      });
    }
    status = await inflight;
    if (status.ok) cache = { at: Date.now(), data: status };
  }

  if (wantProbe) {
    const key = await readKey();
    status = { ...status, probe: key ? await runProbe(key) : null };
  }

  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
