import { Project, SourceFile, SyntaxKind } from "ts-morph";

export interface DocNode {
  file: string;
  name: string;
  kind: "interface" | "function";
}

function extractNodes(sourceFile: SourceFile): DocNode[] {
  const nodes: DocNode[] = [];
  for (const iface of sourceFile.getInterfaces()) {
    nodes.push({ file: sourceFile.getFilePath(), name: iface.getName(), kind: "interface" });
  }
  for (const fn of sourceFile.getFunctions()) {
    nodes.push({ file: sourceFile.getFilePath(), name: fn.getName() || "anonymous", kind: "function" });
  }
  for (const decl of sourceFile.getVariableDeclarations()) {
    const init = decl.getInitializer();
    if (init && init.getKind() === SyntaxKind.ArrowFunction) {
      nodes.push({ file: sourceFile.getFilePath(), name: decl.getName(), kind: "function" });
    }
  }
  return nodes;
}

function extractDependencies(sourceFile: SourceFile): Set<string> {
  const deps = new Set<string>();
  for (const imp of sourceFile.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (spec.startsWith(".")) {
      deps.add(spec);
    }
  }
  return deps;
}

export function generateMermaidDiagram(files: { path: string; content: string }[]): string {
  const project = new Project({ useInMemoryFileSystem: true });
  const allNodes: DocNode[] = [];
  for (const file of files) {
    const sf = project.createSourceFile(file.path, file.content, { overwrite: true });
    allNodes.push(...extractNodes(sf));
  }

  const fileNames = Array.from(new Set(allNodes.map((n) => n.file))).sort();
  const lines = ["sequenceDiagram"];
  for (const file of fileNames) {
    lines.push(`  participant ${file}`);
  }

  for (let i = 0; i < allNodes.length; i++) {
    const node = allNodes[i];
    const next = allNodes[i + 1];
    if (node.kind === "interface") {
      lines.push(`  Note over ${node.file}: interface ${node.name}`);
    } else if (next && next.file !== node.file) {
      lines.push(`  ${node.file}->>${next.file}: ${node.name}()`);
    } else {
      lines.push(`  Note over ${node.file}: function ${node.name}()`);
    }
  }

  return lines.join("\n");
}

export function generateMermaidGraph(files: { path: string; content: string }[]): string {
  const project = new Project({ useInMemoryFileSystem: true });
  const nodes: string[] = [];
  const edges: string[] = [];

  for (const file of files) {
    if (!/\.(ts|tsx|js|mjs)$/.test(file.path)) continue;
    const sf = project.createSourceFile(file.path, file.content, { overwrite: true });
    const id = sanitizeId(file.path);
    const decls = extractNodes(sf).map((n) => n.name).join("\\n");
    nodes.push(`    ${id}["${file.path}${decls ? `\\n${decls}` : ""}"]`);

    for (const dep of extractDependencies(sf)) {
      const resolved = resolveRelative(file.path, dep);
      edges.push(`    ${id} --> ${sanitizeId(resolved)}`);
    }
  }

  const lines = ["graph TD"];
  lines.push(...Array.from(new Set(nodes)).sort());
  lines.push(...Array.from(new Set(edges)).sort());
  return lines.join("\n");
}

function sanitizeId(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "_");
}

function resolveRelative(from: string, specifier: string): string {
  const parts = from.split("/");
  parts.pop();
  const specParts = specifier.split("/");
  for (const p of specParts) {
    if (p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  let resolved = parts.join("/");
  if (!resolved.includes(".")) resolved += ".ts";
  return resolved;
}

export function generateDocMarkdown(files: { path: string; content: string }[], runId: string): string {
  const diagram = generateMermaidDiagram(files);
  return `# Auto-Generated Architecture Diagram\n\nRun: \`${runId}\`\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`;
}

export function generateGlobalArchitectureMarkdown(files: { path: string; content: string }[]): string {
  const graph = generateMermaidGraph(files);
  return `# ARCHITECTURE.md\n\nAuto-generated global dependency map.\n\n\`\`\`mermaid\n${graph}\n\`\`\`\n`;
}
