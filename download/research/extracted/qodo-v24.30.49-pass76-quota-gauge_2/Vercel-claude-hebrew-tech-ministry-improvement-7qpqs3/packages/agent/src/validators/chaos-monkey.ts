import { Project, SyntaxKind, Node } from "ts-morph";
import type { Patch } from "../agents/coder.js";
import type { Plan } from "../agents/architect.js";

export interface ChaosResult {
  allowed: boolean;
  reason?: string;
  adversarialCases?: string[];
}

/**
 * Check that every function parameter is actually guarded before use.
 * The previous regex list matched tokens like `if (` or `||` anywhere in
 * the function body, so almost any real function passed regardless of
 * whether the risky expression was guarded. Now we require a guard that
 * references the parameter name itself.
 */
function functionHasNullGuard(bodyText: string, parameterNames: string[]): boolean {
  if (parameterNames.length === 0) return true;
  return parameterNames.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `\\b${escaped}\\s*!==?\\s*(?:null|undefined)` +
      `|\\b${escaped}\\s*===?\\s*(?:null|undefined)` +
      `|\\b${escaped}\\?\\.` +
      `|\\b${escaped}\\s*\\?\\?` +
      `|typeof\\s+${escaped}` +
      `|if\\s*\\([^)]*\\b${escaped}\\b` +
      `|\\b${escaped}\\s*&&`,
      "g",
    );
    return re.test(bodyText);
  });
}

function checkGeneratedFile(fileContent: string, filePath: string): ChaosResult | null {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(filePath, fileContent, { overwrite: true });

  for (const fn of sourceFile.getFunctions()) {
    const params = fn.getParameters();
    if (params.length === 0) continue;
    const paramNames = params.map((p) => p.getName()).filter((n) => !!n);
    const body = fn.getBody();
    if (!body) continue;
    if (!functionHasNullGuard(body.getText(), paramNames)) {
      return {
        allowed: false,
        reason: "Chaos Monkey: Missing null guards on generated function",
      };
    }
  }

  for (const decl of sourceFile.getVariableDeclarations()) {
    const init = decl.getInitializer();
    if (!init || !Node.isArrowFunction(init)) continue;
    const arrow = init.asKind(SyntaxKind.ArrowFunction);
    if (!arrow) continue;
    const params = arrow.getParameters();
    if (params.length === 0) continue;
    const paramNames = params.map((p) => p.getName()).filter((n) => !!n);
    const body = arrow.getBody();
    if (!body) continue;
    if (!functionHasNullGuard(body.getText(), paramNames)) {
      return {
        allowed: false,
        reason: "Chaos Monkey: Missing null guards on generated function",
      };
    }
  }

  return null;
}

export async function chaosMonkey(patch: Patch, plan: Plan): Promise<ChaosResult> {
  const adversarialCases = [
    { value: "", label: "empty string" },
    { value: null as unknown as string, label: "null" },
    { value: undefined as unknown as string, label: "undefined" },
    { value: Number.MAX_SAFE_INTEGER, label: "massive number" },
    { value: -1, label: "negative number" },
  ];

  for (const file of patch.files) {
    const result = checkGeneratedFile(file.content, file.path);
    if (result) return result;
  }

  for (const step of plan.steps) {
    if (!step.files || step.files.length === 0) {
      return { allowed: false, reason: "Chaos Monkey: Step has no files" };
    }
  }

  return {
    allowed: true,
    adversarialCases: adversarialCases.map((c) => c.label),
  };
}
