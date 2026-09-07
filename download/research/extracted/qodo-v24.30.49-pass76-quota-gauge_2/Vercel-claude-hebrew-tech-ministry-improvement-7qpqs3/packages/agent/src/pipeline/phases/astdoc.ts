import { generateDocMarkdown, generateGlobalArchitectureMarkdown } from "../../services/ast-doc.js";
import { saveCheckpoint } from "../helpers.js";
import type { PhaseContext } from "../context.js";

/** AST auto-documentation — commit per-run diagram + global architecture map. */
export async function runAstdocPhase(ctx: PhaseContext): Promise<void> {
  const { s, objective, owner, repo, prNumber, gh, state } = ctx;

  s.phase = "astdoc";
  const perRunMarkdown = generateDocMarkdown(s.patch!.files as { path: string; content: string }[], s.runId);
  const globalMarkdown = generateGlobalArchitectureMarkdown(s.patch!.files as { path: string; content: string }[]);
  const docCommit = await gh.commitViaGitDB(
    prNumber,
    [
      { path: `docs/auto-diagrams/${s.runId}.md`, content: perRunMarkdown },
      { path: "ARCHITECTURE.md", content: globalMarkdown },
    ],
    `qodo(v24): auto-diagram and architecture map for ${objective}`,
  );
  s.commitSha = docCommit.commitSha;
  await saveCheckpoint(owner, repo, prNumber, state, s);
}
