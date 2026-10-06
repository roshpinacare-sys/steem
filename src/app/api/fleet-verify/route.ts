// GET /api/fleet-verify — מפעל האימות המקומי (R109)
//
// תשעת סוכני-האימות של הרשת שבו לחיים — מקומית, בלי תלות במכסת
// ה-Actions של הארגון. ה-API קורא את קובץ-האמת שהדיבון כותב
// (sovereign/fleet-verify/state.json) — אותה אמת שהדפדפן רואה.
import { NextResponse } from "next/server";
import fs from "node:fs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = fs.readFileSync("/home/z/my-project/sovereign/fleet-verify/state.json", "utf8");
    const state = JSON.parse(raw);
    const jobs = Array.isArray(state.jobs) ? state.jobs : [];
    const pass = jobs.filter((j: { verdict?: string }) => j.verdict === "PASS").length;
    const fail = jobs.filter((j: { verdict?: string }) => j.verdict === "FAIL").length;
    const pending = jobs.filter((j: { verdict?: string }) => !["PASS", "FAIL", "ERROR"].includes(j.verdict ?? "")).length;
    return NextResponse.json({
      ok: true,
      service: state.service ?? "fleet-verify",
      version: state.version,
      bootedAt: state.bootedAt,
      beats: state.beats ?? 0,
      patAvailable: state.patAvailable ?? false,
      current: state.current ?? null,
      lastDecision: state.lastDecision ?? null,
      summary: { total: jobs.length, pass, fail, pending },
      jobs,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "קובץ-האמת של המפעל לא נקרא — הדיבון לא כתב עדיין או שאינו חי",
        summary: { total: 0, pass: 0, fail: 0, pending: 0 },
        jobs: [],
      },
      { status: 503 }
    );
  }
}
