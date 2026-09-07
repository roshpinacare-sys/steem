import { Project, SyntaxKind, Node, type SourceFile } from "ts-morph";
import type { CoderOutput } from "../schemas/coder-schema.js";
import type { RedisState } from "../services/redis-state.js";
import type { Telemetry } from "../services/telemetry.js";
import { recordWardenRejection } from "../services/warden-memory.js";

export class WardenRejectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WardenRejectionError";
  }
}

function isInsideTryStatement(node: Node): boolean {
  let current: Node | undefined = node;
  while (current) {
    if (current.getKind() === SyntaxKind.TryStatement) return true;
    current = current.getParent();
  }
  return false;
}

export function inspectFile(path: string, content: string): string | null {
  const project = new Project({ useInMemoryFileSystem: true });
  let sourceFile: SourceFile;
  try {
    sourceFile = project.createSourceFile(path, content, { overwrite: true });
  } catch {
    return `Warden: file ${path} has syntax errors`;
  }

  // createSourceFile parses tolerantly and never throws on malformed input;
  // syntax errors surface as syntactic diagnostics instead. (Semantic
  // diagnostics are deliberately ignored — the in-memory FS has no libs, so
  // valid code would produce spurious type errors.)
  const syntactic = project
    .getProgram()
    .compilerObject.getSyntacticDiagnostics(sourceFile.compilerNode);
  if (syntactic.length > 0) {
    return `Warden: file ${path} has syntax errors`;
  }

  for (const node of sourceFile.getDescendants()) {
    if (node.getKind() === SyntaxKind.AnyKeyword) {
      return `Warden: explicit "any" found in ${path}. Use concrete types.`;
    }
  }

  for (const node of sourceFile.getDescendants()) {
    if (node.getKind() === SyntaxKind.ExpressionStatement) {
      const expr = node.asKind(SyntaxKind.ExpressionStatement);
      const call = expr?.getExpression();
      if (call && call.getKind() === SyntaxKind.CallExpression) {
        const prop = call.asKind(SyntaxKind.CallExpression)?.getExpression();
        if (prop && prop.getText() === "console.log") {
          return `Warden: console.log found in ${path}. Use a proper logger.`;
        }
      }
    }
  }

  for (const node of sourceFile.getDescendants()) {
    if (node.getKind() === SyntaxKind.AwaitExpression && !isInsideTryStatement(node)) {
      return `Warden: unwrapped await found in ${path}. Wrap awaits in try/catch.`;
    }
  }

  return null;
}

export async function wardenGuard(
  patch: CoderOutput,
  state?: RedisState,
  owner?: string,
  repo?: string,
  telemetry?: Telemetry,
): Promise<void> {
  for (const file of patch.files) {
    const rejection = inspectFile(file.path, file.content);
    if (rejection) {
      if (owner && repo && state) {
        await recordWardenRejection(owner, repo, file.path, rejection, state);
      }
      await telemetry?.decision("warden", "rejection", { path: file.path, rule: rejection });
      throw new WardenRejectionError(rejection);
    }
  }
}
