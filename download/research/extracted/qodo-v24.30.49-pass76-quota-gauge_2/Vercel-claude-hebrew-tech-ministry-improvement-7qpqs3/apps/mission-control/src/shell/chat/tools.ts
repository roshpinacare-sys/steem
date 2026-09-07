/**
 * chat/tools.ts — the console's tool registry.
 *
 * These are the REAL operations the agentic loop can perform on the connected
 * repository. Each tool returns a compact text "observation" the model reads
 * back. Read tools run automatically; mutating tools (dispatch/write) are
 * flagged so the loop can require an explicit human confirmation first.
 *
 * The same executors back the keyless slash-commands, so "list runs" behaves
 * identically whether a human or the model asked for it.
 */
import type { PageId } from "../nav.js";
import { getGitHubConfig } from "../github/config.js";
import {
  ghListRuns, ghListJobs, ghListPrs, ghListCommits, ghListBranches,
  ghListContents, ghGetFile, ghSearchCode, ghWorkflowExists,
  ghDispatchPipeline, ghPutFile, ghGetPr, ghListPrFiles,
  ghCreateBranch, ghCreatePr, ghCommentPr, ghDispatchMode, type AgentMode,
} from "../github/client.js";
import { encodeUtf8Base64, decodeBase64Utf8 } from "../github/encoding.js";

export interface ToolCtx {
  navigate: (p: PageId) => void;
}

export interface ToolDef {
  name: string;
  /** One-line description shown to the model. */
  desc: string;
  /** Argument spec shown to the model, e.g. `{path: string}`. */
  args: string;
  /** Mutating tools require explicit confirmation before executing. */
  mutating: boolean;
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}
function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}
function cfgOrThrow() {
  const cfg = getGitHubConfig();
  if (!cfg) throw new Error("Not connected to a GitHub repository.");
  return cfg;
}

export const TOOLS: ToolDef[] = [
  {
    name: "list_files", desc: "List files/folders at a repo path (root if empty).", args: "{path?: string}", mutating: false,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const path = str(a.path);
      const entries = await ghListContents(cfg, path);
      return entries.slice(0, 80).map((e) => `${e.type === "dir" ? "dir " : "file"} ${e.path}`).join("\n") || "(empty)";
    },
  },
  {
    name: "read_file", desc: "Read a file's text content.", args: "{path: string}", mutating: false,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const path = str(a.path);
      if (!path) throw new Error("read_file needs a path");
      const f = await ghGetFile(cfg, path);
      const text = f.encoding === "base64" ? decodeBase64Utf8(f.content) : f.content;
      return text.length > 6000 ? text.slice(0, 6000) + "\n…(truncated)" : text;
    },
  },
  {
    name: "search_code", desc: "Search code in the repo for a string/symbol.", args: "{query: string}", mutating: false,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const hits = await ghSearchCode(cfg, str(a.query));
      return hits.length ? hits.map((h) => h.path).join("\n") : "(no matches)";
    },
  },
  {
    name: "list_runs", desc: "Recent workflow runs with status.", args: "{limit?: number}", mutating: false,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const runs = await ghListRuns(cfg, Math.min(num(a.limit, 8), 20));
      return runs.map((r) => `#${r.runNumber} id=${r.id} ${r.status}${r.conclusion ? "/" + r.conclusion : ""} ${r.title || r.workflowName} (${r.branch})`).join("\n") || "(no runs)";
    },
  },
  {
    name: "run_status", desc: "Jobs + conclusions for a run id.", args: "{id: number}", mutating: false,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const jobs = await ghListJobs(cfg, num(a.id, 0));
      return jobs.map((j) => `${j.name}: ${j.status}${j.conclusion ? "/" + j.conclusion : ""}`).join("\n") || "(no jobs)";
    },
  },
  {
    name: "list_prs", desc: "Open pull requests.", args: "{}", mutating: false,
    run: async () => {
      const cfg = cfgOrThrow();
      const prs = await ghListPrs(cfg);
      return prs.map((p) => `#${p.number} ${p.title} — @${p.author} (${p.branch})`).join("\n") || "(none open)";
    },
  },
  {
    name: "get_pr", desc: "One PR's detail + the files it changes.", args: "{number: number}", mutating: false,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const n = num(a.number, 0);
      if (!n) throw new Error("get_pr needs a number");
      const pr = await ghGetPr(cfg, n);
      const files = await ghListPrFiles(cfg, n).catch(() => []);
      const head = `#${pr.number} ${pr.title}\nby @${pr.author} · ${pr.branch} → ${pr.base} · ${pr.state}`;
      const bodyText = pr.body ? `\n\n${pr.body.slice(0, 1500)}` : "";
      const fileList = files.length ? `\n\nFiles (${files.length}):\n${files.slice(0, 60).map((f) => `${f.status} ${f.filename} (+${f.additions}/-${f.deletions})`).join("\n")}` : "";
      return head + bodyText + fileList;
    },
  },
  {
    name: "list_commits", desc: "Recent commits.", args: "{limit?: number}", mutating: false,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const commits = await ghListCommits(cfg, Math.min(num(a.limit, 8), 20));
      return commits.map((c) => `${c.sha.slice(0, 7)} ${c.message} — ${c.author}`).join("\n") || "(none)";
    },
  },
  {
    name: "list_branches", desc: "Repository branches.", args: "{}", mutating: false,
    run: async () => {
      const cfg = cfgOrThrow();
      const b = await ghListBranches(cfg);
      return b.map((x) => `${x.name}${x.protected ? " (protected)" : ""}`).join("\n") || "(none)";
    },
  },
  {
    name: "navigate", desc: "Open a page in the app.", args: "{page: string}", mutating: false,
    run: async (a, ctx) => {
      const page = str(a.page) as PageId;
      ctx.navigate(page);
      return `Opened ${page}.`;
    },
  },
  {
    name: "dispatch_task", desc: "Dispatch a REAL agent delivery run (workflow_dispatch).", args: "{objective: string}", mutating: true,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const objective = str(a.objective);
      if (!objective) throw new Error("dispatch_task needs an objective");
      const wf = await ghWorkflowExists(cfg).catch(() => null);
      if (wf === false) throw new Error("Repo has no agent-pipeline.yml — nothing to dispatch.");
      await ghDispatchPipeline(cfg, objective);
      return `Dispatched a real agent run: ${objective}`;
    },
  },
  {
    name: "create_branch", desc: "Create a new branch from the current branch.", args: "{name: string, from?: string}", mutating: true,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const name = str(a.name);
      if (!name) throw new Error("create_branch needs a name");
      await ghCreateBranch(cfg, name, str(a.from) || undefined);
      return `Created branch ${name} from ${str(a.from) || cfg.branch}.`;
    },
  },
  {
    name: "create_pr", desc: "Open a pull request.", args: "{title: string, head: string, base?: string, body?: string}", mutating: true,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const title = str(a.title), head = str(a.head);
      if (!title || !head) throw new Error("create_pr needs a title and a head branch");
      const pr = await ghCreatePr(cfg, { title, head, base: str(a.base) || undefined, body: str(a.body) || undefined });
      return `Opened PR #${pr.number}: ${pr.htmlUrl}`;
    },
  },
  {
    name: "comment_pr", desc: "Add a comment to a pull request.", args: "{number: number, body: string}", mutating: true,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const n = num(a.number, 0), body = str(a.body);
      if (!n || !body) throw new Error("comment_pr needs a number and body");
      await ghCommentPr(cfg, n, body);
      return `Commented on PR #${n}.`;
    },
  },
  {
    name: "run_mode", desc: "Dispatch an autonomous agent mode.", args: "{mode: 'janitor'|'evolve'|'compliance'|'support'|'drain'}", mutating: true,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const mode = str(a.mode) as AgentMode;
      if (!["janitor", "evolve", "compliance", "support", "drain"].includes(mode)) throw new Error("run_mode needs a valid mode");
      const wf = await ghWorkflowExists(cfg).catch(() => null);
      if (wf === false) throw new Error("Repo has no agent-pipeline.yml.");
      await ghDispatchMode(cfg, mode, `Autonomous ${mode} run (dispatched from chat).`);
      return `Dispatched the ${mode} mode run.`;
    },
  },
  {
    name: "write_file", desc: "Create or update a file (a REAL commit).", args: "{path: string, content: string, message?: string}", mutating: true,
    run: async (a) => {
      const cfg = cfgOrThrow();
      const path = str(a.path);
      const content = str(a.content);
      if (!path) throw new Error("write_file needs a path");
      // Include the current sha when updating an existing file.
      let sha: string | undefined;
      try { sha = (await ghGetFile(cfg, path)).sha; } catch { sha = undefined; }
      await ghPutFile(cfg, path, encodeUtf8Base64(content), str(a.message) || `Update ${path} via Mission Control chat`, { sha });
      return `Committed ${path} (${content.length} bytes) on ${cfg.branch}.`;
    },
  },
];

export function toolByName(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** The tool catalog block injected into the agent system prompt. */
export function toolCatalog(): string {
  return TOOLS.map((t) => `- ${t.name}${t.mutating ? " (asks for confirmation)" : ""}: ${t.desc} args ${t.args}`).join("\n");
}
