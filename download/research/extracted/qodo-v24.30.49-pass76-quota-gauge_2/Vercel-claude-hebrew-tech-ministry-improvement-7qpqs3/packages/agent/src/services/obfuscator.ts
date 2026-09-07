import {
  Project,
  SourceFile,
  SyntaxKind,
  Node,
  type VariableDeclaration,
  type ParameterDeclaration,
  type PropertyDeclaration,
  type PropertyAssignment,
} from "ts-morph";

export interface ObfuscationMapping {
  [token: string]: string;
}

export interface ObfuscatedBundle {
  content: string;
  mapping: ObfuscationMapping;
}

type RenameableDecl =
  | VariableDeclaration
  | ParameterDeclaration
  | PropertyDeclaration
  | PropertyAssignment;

function isRenameableDecl(node: Node): node is RenameableDecl {
  return (
    Node.isVariableDeclaration(node) ||
    Node.isParameterDeclaration(node) ||
    Node.isPropertyDeclaration(node) ||
    Node.isPropertyAssignment(node)
  );
}

function getDeclName(decl: RenameableDecl): string | undefined {
  try {
    return decl.getName();
  } catch {
    return undefined;
  }
}

function collectRenameableDeclarations(sourceFile: SourceFile): RenameableDecl[] {
  const decls: RenameableDecl[] = [];
  for (const node of sourceFile.getDescendants()) {
    if (!isRenameableDecl(node)) continue;
    const name = getDeclName(node);
    if (!name || name.startsWith("_")) continue;
    decls.push(node);
  }
  return decls;
}

/**
 * Scan the source for any pre-existing VAR_N tokens so we can start token
 * numbering above the highest existing one. This prevents collisions when
 * the original code already contains identifiers that look like our tokens.
 */
function existingTokenOffset(sourceFile: SourceFile): number {
  const re = /\bVAR_(\d+)\b/g;
  const text = sourceFile.getFullText();
  let max = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    max = Math.max(max, Number(match[1]));
  }
  return max;
}

/**
 * @param tokenOffset - Index at which token numbering starts (VAR_{offset+1},
 *   VAR_{offset+2}, …).  When obfuscating multiple files the caller must pass
 *   the cumulative count of tokens already assigned to earlier files so that
 *   every token across the entire batch is globally unique and the combined
 *   mapping is unambiguous when reconstituteCode() is called later.
 */
export function obfuscateCode(content: string, filePath = "snippet.ts", tokenOffset = 0): ObfuscatedBundle {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(filePath, content, { overwrite: true });
  const decls = collectRenameableDeclarations(sourceFile);
  const mapping: ObfuscationMapping = {};

  // Avoid collisions with pre-existing VAR_N identifiers in the source.
  const baseOffset = tokenOffset + existingTokenOffset(sourceFile);

  decls.forEach((decl, index) => {
    const name = getDeclName(decl);
    if (!name) return;
    const token = `VAR_${baseOffset + index + 1}`;
    mapping[token] = name;
    // Rename the declaration once and let ts-morph update all references in
    // the correct scope. This prevents identically-named identifiers in
    // different, shadowed scopes from being folded into the same token.
    try {
      decl.rename(token, { renameInComments: false });
    } catch {
      // If a particular declaration cannot be safely renamed (e.g. ambient
      // declarations), fall back to leaving it untouched.
    }
  });

  return { content: sourceFile.getFullText(), mapping };
}

export function reconstituteCode(content: string, mapping: ObfuscationMapping): string {
  let result = content;
  // Replace longest tokens first. VAR_N tokens share a common prefix, so
  // iterating in insertion order (VAR_1, VAR_2, …, VAR_10) causes VAR_10 to
  // be partially rewritten by the VAR_1 substitution, corrupting the output
  // and potentially leaving VAR_N-like tokens in the final patch.
  const entries = Object.entries(mapping).sort((a, b) => b[0].length - a[0].length);
  for (const [token, original] of entries) {
    const re = new RegExp(`\\b${token}\\b`, "g");
    result = result.replace(re, original);
  }
  return result;
}

export function hasUnmappedTokens(content: string, mapping: ObfuscationMapping): boolean {
  const tokens = new Set<string>();
  const re = /\bVAR_\d+\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    tokens.add(match[0]);
  }
  for (const token of tokens) {
    if (!(token in mapping)) return true;
  }
  return false;
}

export function obfuscatePrefetch(prefetch: Record<string, string>): { prefetch: Record<string, string>; mapping: ObfuscationMapping } {
  const obfuscated: Record<string, string> = {};
  const combinedMapping: ObfuscationMapping = {};
  // Track a cumulative token offset so every file's tokens are globally unique.
  // Without this, each file independently generates VAR_1, VAR_2, … and the
  // last file's mapping silently overwrites earlier files' entries in the
  // merged object, causing reconstituteCode() to substitute the wrong original
  // identifiers back into earlier files' content.
  let tokenOffset = 0;
  for (const [path, content] of Object.entries(prefetch)) {
    const bundle = obfuscateCode(content, path, tokenOffset);
    obfuscated[path] = bundle.content;
    Object.assign(combinedMapping, bundle.mapping);
    tokenOffset += Object.keys(bundle.mapping).length;
  }
  return { prefetch: obfuscated, mapping: combinedMapping };
}
