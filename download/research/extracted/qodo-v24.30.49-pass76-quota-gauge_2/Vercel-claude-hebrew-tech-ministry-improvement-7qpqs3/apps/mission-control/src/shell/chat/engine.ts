/**
 * chat/engine.ts — the central console brain.
 *
 * Three ways to answer, all real:
 *   • Commands (keyless): typed verbs execute genuine operations on the
 *     connected repo — inspect runs, PRs, commits, branches, files, search
 *     code, dispatch a run, navigate. No API key needed.
 *   • Agent (LLM + tools): when a model is configured, freeform messages drive
 *     a tool-use loop — the model reads files, searches, checks runs, and can
 *     act (dispatch/commit) after you confirm. Works on ANY provider via a
 *     plain-JSON tool protocol, so it never depends on native function-calling.
 *   • Guidance: with no model, freeform text points you at the commands.
 */
import type { PageId } from "../nav.js";
import { getGitHubConfig, getGitHubUser } from "../github/config.js";
import {
  ghListRuns, ghListJobs, ghListPrs, ghListCommits, ghListBranches,
  ghListContents, ghGetFile, ghSearchCode, ghWorkflowExists, ghDispatchPipeline,
} from "../github/client.js";
import { hasAnyLlm, getSelected } from "../llm/store.js";
import { llmChat, type ChatMessage } from "../llm/client.js";
import { providerById } from "../llm/providers.js";
import { activeSource } from "../dataSource.js";
import { plural } from "../../utils/plural.js";
import { TOOLS, toolByName, toolCatalog, type ToolCtx } from "./tools.js";

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  observation: string;
  ok: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  soft?: boolean;
  via?: string;
  steps?: AgentStep[];
}

export interface ChatCtx {
  navigate: (p: PageId) => void;
  /** Ask the human to approve a mutating action. */
  confirm: (summary: string) => Promise<boolean>;
  /** Live callback as the agent takes each tool step. */
  onStep?: (step: AgentStep) => void;
}

const PAGE_ALIASES: Record<string, PageId> = {
  chat: "chat", runs: "runs", tasks: "tasks", files: "files", studio: "studio", overview: "overview",
  activity: "activity", pipeline: "pipeline", insights: "insights", agents: "ministry",
  ministry: "ministry", safety: "safety", cost: "cost", automations: "automations",
  governance: "governance", connections: "connections", releases: "releases", docs: "docs", settings: "settings",
};

const HELP = [
  "**Console commands** (no API key needed):",
  "• `status` — connection, repo, identity, readiness",
  "• `runs [n]` · `run <id>` — recent runs / a run's jobs",
  "• `prs` · `pr <n>` — open pull requests / one PR",
  "• `commits [n]` · `branches` — history / branches",
  "• `ls [path]` · `read <path>` — browse / show a file",
  "• `search <query>` — code search in the repo",
  "• `task <objective>` — dispatch a REAL agent run",
  "• `open <page>` — jump to a page",
  "• `providers` — your configured AI models",
  "",
  "**Skills:** `triage` (find failing runs, keyless) · `review <pr>` · `explain <path>` · `plan <objective>`.",
  "",
  "**With an AI model connected** (Settings → AI providers), just talk to me — I can read files, search, check runs, review PRs, and even commit, open PRs, or dispatch (with your confirmation).",
].join("\n");

function firstWord(s: string): string { return s.trim().split(/\s+/)[0]?.toLowerCase() ?? ""; }
function rest(s: string): string { return s.trim().replace(/^\S+\s*/, ""); }

// ── Skills: curated, higher-level capabilities the chat can run ──────────────
export interface Skill {
  id: string;
  label: string;
  /** Placeholder for the argument, or null when the skill takes none. */
  arg: "pr" | "path" | "objective" | null;
  hint: string;
  /** Needs an AI model (agent-backed) vs a keyless deterministic skill. */
  needsLlm: boolean;
}

export const SKILLS: Skill[] = [
  { id: "triage", label: "Triage failures", arg: null, hint: "find failing runs and what broke", needsLlm: false },
  { id: "review", label: "Review a PR", arg: "pr", hint: "read a PR + files, give a code review", needsLlm: true },
  { id: "explain", label: "Explain a file", arg: "path", hint: "read a file and explain it", needsLlm: true },
  { id: "plan", label: "Plan a change", arg: "objective", hint: "draft a plan, then dispatch it", needsLlm: true },
];

const SKILL_IDS = new Set(SKILLS.map((s) => s.id));

/** The seed instruction that turns a skill into a grounded agent mission. */
function skillPrompt(id: string, arg: string): string {
  switch (id) {
    case "review":
      return `Review pull request #${arg}. Call get_pr to read its description and changed files, then give a concise, actionable code review: risks, missing tests, and concrete suggestions. Don't modify anything.`;
    case "explain":
      return `Read the file \`${arg}\` (use read_file) and explain what it does and how it fits the codebase, concisely. If it's large, summarize the key parts.`;
    case "plan":
      return `Draft a short, concrete implementation plan for this objective: "${arg}". Use search_code/read_file to ground it in the real repo, list the files likely to change and the steps, then tell me I can dispatch it with \`task ${arg}\`. Do not modify anything.`;
    default:
      return arg;
  }
}

const COMMAND_VERBS = new Set([
  "help", "status", "whoami", "runs", "run", "prs", "pulls", "pr", "commits",
  "branches", "ls", "files", "read", "cat", "search", "grep", "find",
  "task", "dispatch", "open", "go", "providers",
]);

export const COMMAND_HINTS: { cmd: string; hint: string }[] = [
  { cmd: "status", hint: "connection + readiness" },
  { cmd: "runs", hint: "recent workflow runs" },
  { cmd: "run ", hint: "jobs for a run id" },
  { cmd: "prs", hint: "open pull requests" },
  { cmd: "commits", hint: "recent commits" },
  { cmd: "branches", hint: "repo branches" },
  { cmd: "ls ", hint: "list a folder" },
  { cmd: "read ", hint: "show a file" },
  { cmd: "search ", hint: "code search" },
  { cmd: "task ", hint: "dispatch a real run" },
  { cmd: "open ", hint: "go to a page" },
  { cmd: "triage", hint: "skill · find failing runs" },
  { cmd: "review ", hint: "skill · review a PR" },
  { cmd: "explain ", hint: "skill · explain a file" },
  { cmd: "plan ", hint: "skill · plan a change" },
  { cmd: "help", hint: "all commands" },
];

export function isCommand(input: string): boolean {
  return COMMAND_VERBS.has(firstWord(input.replace(/^\//, "")));
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

function didYouMean(verb: string): string | null {
  let best: string | null = null, dist = 3;
  for (const v of COMMAND_VERBS) { const d = levenshtein(verb, v); if (d < dist) { dist = d; best = v; } }
  return best;
}

async function runCommand(input: string): Promise<ChatTurn> {
  const line = input.trim().replace(/^\//, "");
  const verb = firstWord(line);
  const arg = rest(line);
  const cfg = getGitHubConfig();

  if (verb === "help") return { role: "assistant", content: HELP };

  if (verb === "providers") {
    const sel = getSelected();
    if (!sel) return { role: "assistant", content: "No AI provider yet. Add a key in **Settings → AI providers** to unlock the agent.", soft: true };
    const p = providerById(sel);
    return { role: "assistant", content: `Active AI model: **${p?.label ?? sel}** (\`${p?.model ?? "?"}\`). Change it in Settings → AI providers.` };
  }

  if (verb === "open" || verb === "go") {
    const target = PAGE_ALIASES[firstWord(arg)];
    if (!target) return { role: "assistant", content: `Unknown page "${arg}". Try: runs, files, tasks, studio, cost, governance, settings.`, soft: true };
    return { role: "assistant", content: `__navigate__:${target}` };
  }

  if (verb === "status" || verb === "whoami") {
    const user = getGitHubUser();
    const src = activeSource();
    if (!cfg) return { role: "assistant", content: `Source: **${src}**. Not connected to GitHub — sign in on the Connections page.`, soft: true };
    const wf = await ghWorkflowExists(cfg).catch(() => null);
    return {
      role: "assistant",
      content: [
        `Signed in as **${user?.login ?? "?"}**${user?.name ? ` (${user.name})` : ""}.`,
        `Repository: \`${cfg.owner}/${cfg.repo}\` · branch \`${cfg.branch}\`.`,
        `Agent workflow: ${wf === true ? "present ✓ — `task` dispatches a real run." : wf === false ? "**missing** — add agent-pipeline.yml to enable dispatch." : "unknown."}`,
        hasAnyLlm() ? "AI model: connected ✓ — the agent can read, search, and act." : "AI model: none — add one in Settings → AI providers.",
      ].join("\n"),
    };
  }

  if (!cfg) return { role: "assistant", content: "Not connected to GitHub. Sign in on the Connections page, then I can read runs, files, PRs, and dispatch tasks.", soft: true };

  if (verb === "runs") {
    const runs = await ghListRuns(cfg, Math.min(Math.max(parseInt(arg, 10) || 8, 1), 20));
    if (!runs.length) return { role: "assistant", content: "No workflow runs yet." };
    return { role: "assistant", content: `**${plural(runs.length, "recent run")}:**\n${runs.map((r) => `• #${r.runNumber} \`${r.status}${r.conclusion ? `/${r.conclusion}` : ""}\` — ${r.title || r.workflowName} (${r.branch})  [id ${r.id}]`).join("\n")}` };
  }
  if (verb === "run") {
    const id = parseInt(arg, 10);
    if (!id) return { role: "assistant", content: "Usage: `run <id>`.", soft: true };
    const jobs = await ghListJobs(cfg, id);
    if (!jobs.length) return { role: "assistant", content: `No jobs for run ${id}.` };
    return { role: "assistant", content: `**Run ${id} — ${plural(jobs.length, "job")}:**\n${jobs.map((j) => `• ${j.name} — \`${j.status}${j.conclusion ? `/${j.conclusion}` : ""}\``).join("\n")}` };
  }
  if (verb === "prs" || verb === "pulls" || verb === "pr") {
    const prs = await ghListPrs(cfg);
    if (verb === "pr" && arg) {
      const n = parseInt(arg, 10);
      const p = prs.find((x) => x.number === n);
      return p ? { role: "assistant", content: `**PR #${p.number}** ${p.title}\n@${p.author} · branch \`${p.branch}\` · ${p.state}\n${p.htmlUrl}` } : { role: "assistant", content: `PR #${n} not found among open PRs.`, soft: true };
    }
    if (!prs.length) return { role: "assistant", content: "No open pull requests." };
    return { role: "assistant", content: `**${plural(prs.length, "open PR")}:**\n${prs.map((p) => `• #${p.number} ${p.title} — @${p.author} (${p.branch})`).join("\n")}` };
  }
  if (verb === "commits") {
    const commits = await ghListCommits(cfg, Math.min(Math.max(parseInt(arg, 10) || 8, 1), 20));
    return { role: "assistant", content: `**${plural(commits.length, "recent commit")}:**\n${commits.map((c) => `• \`${c.sha.slice(0, 7)}\` ${c.message} — ${c.author}`).join("\n")}` };
  }
  if (verb === "branches") {
    const b = await ghListBranches(cfg);
    return { role: "assistant", content: `**${plural(b.length, "branch", "branches")}:**\n${b.map((x) => `• ${x.name}${x.protected ? " (protected)" : ""}`).join("\n")}` };
  }
  if (verb === "ls" || verb === "files") {
    const entries = await ghListContents(cfg, arg || "");
    if (!entries.length) return { role: "assistant", content: `Empty: \`${arg || "/"}\`` };
    return { role: "assistant", content: `**\`${arg || "/"}\` — ${plural(entries.length, "entry", "entries")}:**\n${entries.slice(0, 60).map((e) => `${e.type === "dir" ? "📁" : "📄"} ${e.name}`).join("\n")}` };
  }
  if (verb === "read" || verb === "cat") {
    if (!arg) return { role: "assistant", content: "Usage: `read <path>`", soft: true };
    const f = await ghGetFile(cfg, arg);
    const text = f.encoding === "base64" ? decodeB64(f.content) : f.content;
    const clipped = text.length > 4000 ? text.slice(0, 4000) + "\n… (truncated — open in Files for the full file)" : text;
    return { role: "assistant", content: `**\`${f.path}\`** (${f.size} bytes):\n\`\`\`\n${clipped}\n\`\`\`` };
  }
  if (verb === "search" || verb === "grep" || verb === "find") {
    if (!arg) return { role: "assistant", content: "Usage: `search <query>`", soft: true };
    const hits = await ghSearchCode(cfg, arg);
    if (!hits.length) return { role: "assistant", content: `No code matches for "${arg}".` };
    return { role: "assistant", content: `**${plural(hits.length, "match", "matches")} for "${arg}":**\n${hits.map((h) => `• \`${h.path}\``).join("\n")}` };
  }
  if (verb === "task" || verb === "dispatch") {
    if (!arg) return { role: "assistant", content: "Usage: `task <objective>`.", soft: true };
    const wf = await ghWorkflowExists(cfg).catch(() => null);
    if (wf === false) return { role: "assistant", content: "This repo has no `agent-pipeline.yml`, so there's nothing to dispatch.", soft: true };
    await ghDispatchPipeline(cfg, arg);
    return { role: "assistant", content: `Dispatched a real agent run on \`${cfg.owner}/${cfg.repo}\`:\n> ${arg}\n\nWatch it on the Runs page.` };
  }

  const guess = didYouMean(verb);
  return { role: "assistant", content: `Unknown command "${verb}"${guess ? ` — did you mean \`${guess}\`?` : ""}. Type \`help\` for the list.`, soft: true };
}

function decodeB64(b64: string): string {
  try { return decodeURIComponent(escape(window.atob(b64))); }
  catch { try { return window.atob(b64); } catch { return "(could not decode)"; } }
}

function agentSystemPrompt(): string {
  const cfg = getGitHubConfig();
  const user = getGitHubUser();
  const where = cfg
    ? `Connected to GitHub repo ${cfg.owner}/${cfg.repo} on branch ${cfg.branch}, signed in as ${user?.login ?? "unknown"}.`
    : "Not connected to a GitHub repo yet — tools will fail until the operator connects on the Connections page.";
  return [
    "You are the agent inside Qodo Mission Control, a mobile console for autonomous software delivery.",
    where,
    "You can call TOOLS to inspect and act on the repository. Available tools:",
    toolCatalog(),
    "",
    "To call a tool, reply with ONLY a fenced json block and nothing else:",
    '```json',
    '{"tool":"read_file","args":{"path":"src/index.ts"}}',
    '```',
    "You will then receive a TOOL_RESULT message and can call another tool or give your final answer.",
    "Call tools one at a time. Prefer read_file/search_code/list_runs to ground answers in real data.",
    "Mutating tools (dispatch_task, write_file) will pause for the operator's confirmation — use them only when clearly asked.",
    "When you have enough information, reply in plain, concise prose (no json block) as your final answer.",
  ].join("\n");
}

interface ToolCall { tool: string; args: Record<string, unknown> }

function parseToolCall(text: string): ToolCall | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let candidate = fence ? fence[1] : text.trim().startsWith("{") ? text.trim() : "";
  if (!candidate) return null;
  // Only treat it as a tool call if it actually mentions a tool key.
  if (!/["']tool["']\s*:/.test(candidate)) return null;
  const tryParse = (s: string): ToolCall | null => {
    try {
      const obj = JSON.parse(s) as { tool?: unknown; args?: unknown };
      if (typeof obj.tool === "string") {
        return { tool: obj.tool, args: (obj.args && typeof obj.args === "object" ? obj.args : {}) as Record<string, unknown> };
      }
    } catch { /* fall through to repair */ }
    return null;
  };
  const direct = tryParse(candidate);
  if (direct) return direct;
  // Lenient repair: strip trailing commas and any prose around the object.
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (objMatch) candidate = objMatch[0];
  candidate = candidate.replace(/,\s*([}\]])/g, "$1");
  return tryParse(candidate);
}

const MAX_STEPS = 8;

async function runAgent(input: string, history: ChatTurn[], ctx: ChatCtx): Promise<ChatTurn> {
  const toolCtx: ToolCtx = { navigate: ctx.navigate };
  const messages: ChatMessage[] = [
    { role: "system", content: agentSystemPrompt() },
    ...history.slice(-6).filter((t) => !t.soft).map((t): ChatMessage => ({ role: t.role, content: t.content })),
    { role: "user", content: input },
  ];
  const steps: AgentStep[] = [];
  let via: string | undefined;

  for (let i = 0; i < MAX_STEPS; i++) {
    // One transient-failure retry so a flaky network doesn't abort a
    // multi-step run mid-way (a genuinely bad key still surfaces on retry).
    let res: Awaited<ReturnType<typeof llmChat>>;
    try {
      res = await llmChat(messages);
    } catch {
      await new Promise((r) => setTimeout(r, 600));
      res = await llmChat(messages);
    }
    via = providerById(res.provider)?.label ?? res.provider;
    const call = parseToolCall(res.content);
    if (!call) {
      return { role: "assistant", content: res.content || "(no response)", via, steps: steps.length ? steps : undefined };
    }
    const tool = toolByName(call.tool);
    let observation: string;
    let ok = true;
    if (!tool) {
      observation = `Unknown tool "${call.tool}".`; ok = false;
    } else if (tool.mutating && !(await ctx.confirm(`${tool.name}: ${JSON.stringify(call.args)}`))) {
      observation = "The operator declined this action."; ok = false;
    } else {
      try { observation = await tool.run(call.args, toolCtx); }
      catch (e: unknown) { observation = `Error: ${e instanceof Error ? e.message : String(e)}`; ok = false; }
    }
    const step: AgentStep = { tool: call.tool, args: call.args, observation, ok };
    steps.push(step);
    ctx.onStep?.(step);
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: `TOOL_RESULT ${call.tool}:\n${observation.slice(0, 6000)}` });
  }
  return { role: "assistant", content: "I reached the step limit for this turn. Ask me to continue if you'd like more.", via, steps };
}

/** Keyless triage: which recent runs failed, and which jobs broke. */
async function triageSkill(): Promise<ChatTurn> {
  const cfg = getGitHubConfig();
  if (!cfg) return { role: "assistant", content: "Connect GitHub first, then I can triage your runs.", soft: true };
  const runs = await ghListRuns(cfg, 20);
  const failing = runs.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out");
  if (!failing.length) return { role: "assistant", content: "All recent runs are green ✓ — nothing to triage." };
  const latest = failing[0];
  const jobs = await ghListJobs(cfg, latest.id).catch(() => []);
  const failed = jobs.filter((j) => j.conclusion === "failure" || j.conclusion === "timed_out");
  const lines = [
    `**${plural(failing.length, "failing run")}** in the last ${runs.length}.`,
    `Most recent: #${latest.runNumber} — ${latest.title || latest.workflowName} (${latest.branch}).`,
    failed.length
      ? `Failed jobs:\n${failed.map((j) => `• ${j.name}${j.steps.some((s) => s.conclusion === "failure") ? " → " + j.steps.filter((s) => s.conclusion === "failure").map((s) => s.name).join(", ") : ""}`).join("\n")}`
      : "No job-level detail available for that run.",
    "Open the run on the Runs page for full logs, or ask me to `review` a PR or `plan` a fix.",
  ];
  return { role: "assistant", content: lines.join("\n\n") };
}

/** Answer a message: skill, command (keyless), or agent (LLM + tools). */
export async function respond(input: string, history: ChatTurn[], ctx: ChatCtx): Promise<ChatTurn> {
  const trimmed = input.trim();
  if (!trimmed) return { role: "assistant", content: "" };

  // ── Skills (curated) ──────────────────────────────────────────────────────
  const skillVerb = firstWord(trimmed.replace(/^\//, ""));
  if (SKILL_IDS.has(skillVerb)) {
    const arg = rest(trimmed.replace(/^\//, ""));
    if (skillVerb === "triage") {
      try { return await triageSkill(); }
      catch (e: unknown) { return { role: "assistant", content: `Triage failed: ${e instanceof Error ? e.message : String(e)}`, soft: true }; }
    }
    const skill = SKILLS.find((s) => s.id === skillVerb)!;
    if (skill.needsLlm && !hasAnyLlm()) {
      const alt = skillVerb === "explain" ? `Try \`read ${arg || "<path>"}\`` : skillVerb === "review" ? `Try \`pr ${arg || "<n>"}\`` : "Add an AI model in Settings → AI providers";
      return { role: "assistant", soft: true, content: `**${skill.label}** needs an AI model. ${alt}, or connect a model for the full skill.` };
    }
    if (!arg && skill.arg) {
      const ex = skill.arg === "pr" ? "review 42" : skill.arg === "path" ? "explain src/index.ts" : "plan add rate limiting";
      return { role: "assistant", soft: true, content: `Usage: \`${skillVerb} <${skill.arg}>\` — e.g. \`${ex}\`.` };
    }
    try { return await runAgent(skillPrompt(skillVerb, arg), history, ctx); }
    catch (e: unknown) { return { role: "assistant", soft: true, content: `Skill failed: ${e instanceof Error ? e.message : String(e)}` }; }
  }

  if (isCommand(trimmed)) {
    try {
      const turn = await runCommand(trimmed);
      if (turn.content.startsWith("__navigate__:")) {
        const page = turn.content.slice("__navigate__:".length) as PageId;
        ctx.navigate(page);
        return { role: "assistant", content: `Opening **${page}**.` };
      }
      return turn;
    } catch (e: unknown) {
      return { role: "assistant", content: `That command failed: ${e instanceof Error ? e.message : String(e)}`, soft: true };
    }
  }

  if (!hasAnyLlm()) {
    return {
      role: "assistant", soft: true,
      content: `I can run console commands right now with no AI key — type \`help\`.\n\nFor a real assistant that reads your code, searches, and acts, add one of your own AI models in **Settings → AI providers** (OpenRouter, Groq, and Gemini have free tiers).`,
    };
  }

  try {
    return await runAgent(trimmed, history, ctx);
  } catch (e: unknown) {
    return { role: "assistant", soft: true, content: `AI request failed: ${e instanceof Error ? e.message : String(e)}\n\nIn a plain browser some providers block direct calls — this works in the Android app, or use OpenRouter/Gemini which allow browser access.` };
  }
}

export { HELP, TOOLS };
