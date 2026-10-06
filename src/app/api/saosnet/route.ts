// ─────────────────────────────────────────────────────────────────────
// /api/saosnet — מפת המטבע המאוחדת: איפה כל SAOS נמצא.
//
// שלושה מקורות אמת, כל אחד עם חותמת מדידה משלו:
//  · v0 (SAOS-NET) — replay מתמטי מהארכיון (sovereign/saosnet-snapshot.json)
//  · v1 (SAOS-LIVE) — הספר החי על Steem (sovereign/saos-live-state.json למצב הדמון, מתעדכן בלב)
//  · DEX — הבורסה הריבונית החיה (127.0.0.1:3010, snapshot מיידי)
// אין כאן דבר מומצא: קובץ לא קיים → null + הסבר כנה.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

async function readJsonSafe(rel: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), rel), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function GET() {
  const [v0, live] = await Promise.all([
    readJsonSafe("sovereign/saosnet-snapshot.json"),
    readJsonSafe("sovereign/saos-live-state.json"), // R57: מצב הדמון — השם saos-live.json שמור לספר הציבורי
  ]);

  // הדקס: snapshot מיידי מהשרת המקומי (לא long-poll — תשובה מהירה)
  let dex: { ok: boolean; height?: number; version?: number; error?: string } = {
    ok: false,
    error: "לא נמדד",
  };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch("http://127.0.0.1:3010/saos-dex/api/dex/state", {
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (res.ok) {
      const j = (await res.json()) as {
        version?: number;
        state?: { height?: number; stateRoot?: string };
      };
      dex = {
        ok: true,
        height: j.state?.height ?? undefined,
        version: j.version ?? undefined,
      };
    } else {
      dex = { ok: false, error: `HTTP ${res.status}` };
    }
  } catch (e) {
    dex = { ok: false, error: e instanceof Error ? e.message.slice(0, 80) : "שגיאה" };
  }

  return NextResponse.json({
    ok: true,
    v0: v0
      ? {
          net: (v0 as { net?: Record<string, unknown> }).net ?? null,
          economy: (v0 as { economy?: Record<string, unknown> }).economy ?? null,
          wallets: (v0 as { wallets?: Record<string, unknown> }).wallets ?? null,
          harvest: (v0 as { harvest?: Record<string, unknown> }).harvest ?? null,
          measuredBy: "node scripts/saosnet-status.cjs — replay מתמטי מלא",
        }
      : null,
    live: live
      ? {
          stateRoot: (live as { lastStateRoot?: string }).lastStateRoot ?? null,
          updatedAt: (live as { updatedAt?: string }).updatedAt ?? null,
          genesis: (live as { genesis?: Record<string, unknown> }).genesis ?? null,
        }
      : null,
    dex,
    servedAt: new Date().toISOString(),
  });
}
