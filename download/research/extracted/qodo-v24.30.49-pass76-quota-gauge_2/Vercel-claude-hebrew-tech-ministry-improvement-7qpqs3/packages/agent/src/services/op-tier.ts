import { Project, SyntaxKind } from "ts-morph";
import type { Tier } from "./ai-router.js";

const CODE_EXTS = /\.(ts|tsx|js)$/;
const NO_CODE_EXTS = /\.(md|json|yml|yaml)$/;

const HEAVY_SIGNALS = [
  SyntaxKind.ClassDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.EnumDeclaration,
  SyntaxKind.Decorator,
];

const FAST_SIGNALS = [SyntaxKind.TypeAliasDeclaration, SyntaxKind.VariableStatement];

function extractAddedLines(fileDiff: string): string {
  return fileDiff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
}

function scoreSource(code: string): { heavy: number; fast: number; lines: number } {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const source = project.createSourceFile("snippet.ts", code, { overwrite: true });
  let heavy = 0, fast = 0;
  for (const node of source.getDescendants()) {
    const kind = node.getKind();
    if (HEAVY_SIGNALS.includes(kind)) heavy += 2;
    if (FAST_SIGNALS.includes(kind)) fast += 1;
  }
  return { heavy, fast, lines: code.split("\n").length };
}

export function classifyOpTier(diff: string): Tier {
  const fileNames = (diff.match(/\+\+\+ b\/(.+?)(?:\t|\n)/g) || [])
    .map((m) => m.replace(/^\+\+\+ b\//, "").split("\t")[0].trim());
  if (fileNames.length && fileNames.every((f) => NO_CODE_EXTS.test(f))) {
    return "fast";
  }

  const blocks = diff.split("\n+++ b/").slice(1);
  let heavyScore = 0;
  let fastScore = 0;
  let totalLines = 0;

  for (const block of blocks) {
    const fileName = block.split("\n")[0].trim().split("\t")[0];
    if (!CODE_EXTS.test(fileName)) continue;
    const code = extractAddedLines(block);
    if (!code.trim()) continue;
    const score = scoreSource(code);
    heavyScore += score.heavy;
    fastScore += score.fast;
    totalLines += score.lines;
  }

  // Structural risk heuristics
  if (totalLines > 200) heavyScore += 3;
  else if (totalLines > 80) heavyScore += 1;

  return heavyScore > fastScore ? "heavy" : "fast";
}
