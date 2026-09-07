// GET /api/health — Platform health probe
// Returns status of workspace storage, project registry, control plane, and agent teams.
// Health is evaluated relative to the ACTIVE provider mode — a missing OPENAI_API_KEY
// is only an error when the active provider actually requires it (kind === "openai").
import { NextResponse } from "next/server";
import fs from "fs";
import { WORKSPACE_ROOT, CONTROL_PLANE_FILE, TEAMS_FILE } from "@/lib/paths";
import { listProjects, getActiveProvider } from "@/lib/project-store";
import { PLATFORM_VERSION } from "@/lib/version-coherence";

export const runtime = "nodejs";

interface SubsystemHealth {
  name: string;
  status: "ok" | "warn" | "error";
  detail: string;
}

function checkSubsystem(name: string, fn: () => { status: "ok" | "warn" | "error"; detail: string }): SubsystemHealth {
  try {
    const result = fn();
    return { name, ...result };
  } catch (e) {
    return { name, status: "error", detail: (e as Error).message };
  }
}

export async function GET() {
  const startMs = Date.now();
  const subsystems: SubsystemHealth[] = [];

  // 1. Workspace storage
  subsystems.push(checkSubsystem("workspace_storage", () => {
    if (!fs.existsSync(WORKSPACE_ROOT)) {
      fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
      return { status: "ok", detail: `Created at ${WORKSPACE_ROOT}` };
    }
    const stat = fs.statSync(WORKSPACE_ROOT);
    if (!stat.isDirectory()) throw new Error(`${WORKSPACE_ROOT} exists but is not a directory`);
    return { status: "ok", detail: `Accessible at ${WORKSPACE_ROOT}` };
  }));

  // 2. Project registry
  subsystems.push(checkSubsystem("project_registry", () => {
    const projects = listProjects();
    return { status: "ok", detail: `${projects.length} project(s) registered` };
  }));

  // 3. Control plane state file
  subsystems.push(checkSubsystem("control_plane", () => {
    if (!fs.existsSync(CONTROL_PLANE_FILE)) {
      return { status: "ok", detail: "No state file yet (first run)" };
    }
    const raw = fs.readFileSync(CONTROL_PLANE_FILE, "utf-8");
    const state = JSON.parse(raw);
    const running = (state.runningJobs ?? []).length;
    const queued = (state.jobQueue ?? []).length;
    return {
      status: "ok",
      detail: `Status: ${state.status ?? "unknown"} · running: ${running} · queued: ${queued}`,
    };
  }));

  // 4. Agent teams file
  subsystems.push(checkSubsystem("agent_teams", () => {
    if (!fs.existsSync(TEAMS_FILE)) {
      return { status: "ok", detail: "No teams file yet (will be initialized on first use)" };
    }
    const teams = JSON.parse(fs.readFileSync(TEAMS_FILE, "utf-8"));
    return { status: "ok", detail: `${teams.length} team(s) loaded` };
  }));

  // 5. Provider / environment check
  // Missing OPENAI_API_KEY is only an error when the active provider requires it.
  // Local/mock/ollama/anthropic setups are treated as fully valid operating modes.
  subsystems.push(checkSubsystem("environment", () => {
    const nodeVer = process.version;
    const wsRoot = process.env.TFA_WORKSPACE_ROOT ? "TFA_WORKSPACE_ROOT set" : "using default /tmp";

    const activeProvider = getActiveProvider();
    const providerKind = activeProvider ?? "openai";
    const providerLabel = activeProvider ?? "OpenAI (Default)";

    const openaiPresent = Boolean(process.env.OPENAI_API_KEY);
    const anthropicPresent = Boolean(process.env.ANTHROPIC_API_KEY);

    // Determine whether the active provider needs a key that is actually missing
    let keyStatus: "ok" | "warn" | "error" = "ok";
    let keyDetail: string;
    if (providerKind === "openai" && !openaiPresent) {
      keyStatus = "error";
      keyDetail = `OPENAI_API_KEY missing (required by active provider "${providerLabel}")`;
    } else if (providerKind === "anthropic" && !anthropicPresent) {
      keyStatus = "warn";
      keyDetail = `ANTHROPIC_API_KEY missing (active provider "${providerLabel}" may fail)`;
    } else if (providerKind === "mock" || providerKind === "ollama") {
      keyStatus = "ok";
      keyDetail = `Active provider "${providerLabel}" (${providerKind}) — no remote API key required`;
    } else {
      keyDetail = `Active provider "${providerLabel}" (${providerKind}) — key present`;
    }

    const detail = `Node ${nodeVer} · ${wsRoot} · ${keyDetail}`;
    return { status: keyStatus, detail };
  }));

  const allOk = subsystems.every((s) => s.status === "ok");
  const anyError = subsystems.some((s) => s.status === "error");
  const overallStatus = anyError ? "degraded" : allOk ? "healthy" : "warn";

  return NextResponse.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - startMs,
    subsystems,
    version: PLATFORM_VERSION,
  }, { status: anyError ? 503 : 200 });
}
