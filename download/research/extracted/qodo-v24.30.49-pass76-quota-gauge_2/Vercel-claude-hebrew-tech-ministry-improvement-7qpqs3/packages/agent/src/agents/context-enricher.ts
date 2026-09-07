import { Project, SyntaxKind } from "ts-morph";
import type { Telemetry } from "../services/telemetry.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";

export interface ReferenceContext {
  sourceRepo: string;
  sourcePath: string;
  summary: string;
}

/**
 * Searches GitHub's public Code Search API for a TypeScript implementation
 * related to the objective, parses the top result with ts-morph, and returns
 * a compact structural summary the Architect can use as reference context.
 *
 * @param githubToken - The GitHub personal access token for API authentication.
 *   Callers should pass the already-validated env value rather than reading
 *   process.env directly, ensuring the token has passed schema checks.
 */
export async function runContextEnricher(
  objective: string,
  telemetry?: Telemetry,
  githubToken?: string,
): Promise<ReferenceContext | null> {
  const token = githubToken;
  if (!token) {
    await telemetry?.decision("context-enricher", "skipped", { reason: "missing GITHUB_TOKEN" });
    return null;
  }

  const query = encodeURIComponent(`${objective} language:typescript`);
  const searchUrl = `https://api.github.com/search/code?q=${query}&per_page=1`;

  try {
    const searchRes = await fetchWithTimeout(
      searchUrl,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "qodo-v24",
        },
      },
      30_000,
    );

    if (!searchRes.ok) {
      const text = await searchRes.text().catch(() => "unknown");
      await telemetry?.decision("context-enricher", "search-failed", { status: searchRes.status, text });
      return null;
    }

    const searchData = (await searchRes.json()) as { items?: Array<{ html_url: string; repository: { full_name: string }; path: string; url: string }> };
    const top = searchData.items?.[0];
    if (!top) {
      await telemetry?.decision("context-enricher", "no-results", {});
      return null;
    }

    const rawUrl = top.html_url
      .replace("github.com", "raw.githubusercontent.com")
      .replace("/blob/", "/");

    const rawRes = await fetchWithTimeout(
      rawUrl,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.raw",
          "User-Agent": "qodo-v24",
        },
      },
      30_000,
    );

    if (!rawRes.ok) {
      await telemetry?.decision("context-enricher", "raw-failed", { status: rawRes.status });
      return null;
    }

    const sourceCode = await rawRes.text();
    const summary = summarizeTypeScript(sourceCode, top.path);

    await telemetry?.decision("context-enricher", "reference-extracted", {
      repo: top.repository.full_name,
      path: top.path,
    });

    return {
      sourceRepo: top.repository.full_name,
      sourcePath: top.path,
      summary,
    };
  } catch (err: unknown) {
    await telemetry?.decision("context-enricher", "error", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function summarizeTypeScript(sourceCode: string, path: string): string {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile(`reference-${Date.now()}.ts`, sourceCode, { overwrite: true });

  const exports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];
  const imports: string[] = [];

  for (const decl of file.getExportedDeclarations().values()) {
    for (const d of decl) {
      if (d.getKind() === SyntaxKind.FunctionDeclaration) {
        exports.push(`function ${d.asKind(SyntaxKind.FunctionDeclaration)?.getName?.() || "anonymous"}()`);
      } else if (d.getKind() === SyntaxKind.ClassDeclaration) {
        exports.push(`class ${d.asKind(SyntaxKind.ClassDeclaration)?.getName?.() || "anonymous"}`);
      } else if (d.getKind() === SyntaxKind.VariableDeclaration) {
        exports.push(`const ${d.asKind(SyntaxKind.VariableDeclaration)?.getName?.() || "anonymous"}`);
      }
    }
  }

  for (const fn of file.getFunctions()) {
    const name = fn.getName();
    if (name) functions.push(name);
  }
  for (const cls of file.getClasses()) {
    const name = cls.getName();
    if (name) classes.push(name);
  }
  for (const imp of file.getImportDeclarations()) {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    const named = imp.getNamedImports().map((n) => n.getName()).join(", ");
    imports.push(named ? `{ ${named} } from '${moduleSpecifier}'` : `'${moduleSpecifier}'`);
  }

  const lineCount = sourceCode.split("\n").length;
  const parts = [
    `File: ${path}`,
    `Lines: ${lineCount}`,
    imports.length ? `Imports: ${imports.slice(0, 8).join("; ")}` : "",
    exports.length ? `Exports: ${exports.slice(0, 8).join("; ")}` : "",
    functions.length ? `Functions: ${functions.slice(0, 10).join(", ")}` : "",
    classes.length ? `Classes: ${classes.join(", ")}` : "",
  ].filter(Boolean);

  return parts.join("\n");
}
