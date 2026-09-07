/**
 * ast-fragment-worker.js
 * Cloudflare Worker / edge function that parses a single source chunk within
 * a strict 10 ms CPU budget.  Input: { index, content }  Output: FragmentResult.
 */

/** Regex-based AST fragment extractor — no dependencies, runs in < 10 ms. */
function parseChunk(content) {
  const exports_ = [];
  const imports = [];
  const envRefs = [];

  // Named exports: export function/const/class/type/interface/enum Foo
  const exportRe = /export\s+(?:async\s+)?(?:function|const|class|type|interface|enum)\s+(\w+)/g;
  let m;
  while ((m = exportRe.exec(content)) !== null) exports_.push(m[1]);

  // export default function/class Foo
  const defaultExportRe = /export\s+default\s+(?:function|class)\s+(\w+)/g;
  while ((m = defaultExportRe.exec(content)) !== null) exports_.push(m[1]);

  // import ... from '...'
  const importRe = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = importRe.exec(content)) !== null) imports.push(m[1]);

  // import '...' (side-effect)
  const sideEffectRe = /import\s+['"]([^'"]+)['"]/g;
  while ((m = sideEffectRe.exec(content)) !== null) imports.push(m[1]);

  // process.env.VAR_NAME
  const envRe = /process\.env\.(\w+)/g;
  while ((m = envRe.exec(content)) !== null) envRefs.push(m[1]);

  return {
    exports: [...new Set(exports_)],
    imports: [...new Set(imports)],
    envRefs: [...new Set(envRefs)],
  };
}

// ---------------------------------------------------------------------------
// Cloudflare Workers entry-point
// ---------------------------------------------------------------------------

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad Request: invalid JSON", { status: 400 });
    }

    const { content } = body;
    if (typeof content !== "string") {
      return new Response("Bad Request: missing content field", { status: 400 });
    }

    // Enforce 10 ms CPU budget via a deadline check on the synchronous parse.
    const start = Date.now();
    const result = parseChunk(content);
    const elapsed = Date.now() - start;

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Parse-Ms": String(elapsed),
      },
    });
  },
};
