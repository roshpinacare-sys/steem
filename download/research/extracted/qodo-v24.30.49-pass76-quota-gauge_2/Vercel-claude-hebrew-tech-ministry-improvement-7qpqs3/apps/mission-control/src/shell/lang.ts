/**
 * lang.ts — filename → highlighter language. Kept dependency-free and OUT of
 * CodeView so callers can compute languages without pulling the syntax
 * highlighter into their chunk.
 */
const EXT_LANG: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  json: "json", yml: "yaml", yaml: "yaml", md: "markdown", markdown: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", css: "css",
  html: "markup", htm: "markup", xml: "markup", svg: "markup",
  py: "python", java: "java", diff: "diff", patch: "diff",
};

/** Best-effort language from a filename; "text" when unknown. */
export function langForFile(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "text";
}
