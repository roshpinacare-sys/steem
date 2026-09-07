import { JSDOM } from "jsdom";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";

const MAX_HTML_BYTES = 5_000_000;
const PARSE_TIMEOUT_MS = 10_000;

function parseDom(html: string): { errors: number; hasRoot: boolean } {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const errors = Array.from(doc.querySelectorAll("[data-error], .error")).length;
  const hasRoot = !!doc.querySelector("#root, #__next, main, [data-app-root]");
  return { errors, hasRoot };
}

export async function domXray(url: string, bypassSecret?: string) {
  if (!url) return { allowed: true, skipped: true };
  const res = await fetchWithTimeout(
    url,
    { headers: { "x-vercel-protection-bypass": bypassSecret ?? "" } },
    15_000,
  );
  const html = await res.text();

  // Pathological payloads can bog down the HTML parser. Cap size before
  // parsing and wrap parsing in a timeout so the gate fails fast instead of
  // hanging the pipeline.
  if (html.length > MAX_HTML_BYTES) {
    return { allowed: false, status: res.status, errors: 0, hasRoot: false, error: "HTML payload too large for DOM parse" };
  }

  const parseTask = new Promise<{ errors: number; hasRoot: boolean }>((resolve) => resolve(parseDom(html)));
  const timeoutTask = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("DOM parse timeout")), PARSE_TIMEOUT_MS),
  );

  try {
    const { errors, hasRoot } = await Promise.race([parseTask, timeoutTask]);
    return {
      allowed: hasRoot && errors === 0,
      status: res.status,
      errors,
      hasRoot,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { allowed: false, status: res.status, errors: 0, hasRoot: false, error: msg };
  }
}
