import { fetchWithTimeout } from "../utils/fetch-timeout.js";

export interface ShadowPathResult {
  path: string;
  status: number;
  error?: string;
}

export async function shadowTraffic(
  url: string,
  bypassSecret?: string,
): Promise<{ allowed: boolean; skipped?: boolean; results: ShadowPathResult[] }> {
  if (!url) return { allowed: true, skipped: true, results: [] };
  const paths = ["/", "/api/health", "/robots.txt"];
  const results = await Promise.all(paths.map(async (p) => {
    try {
      const r = await fetchWithTimeout(
        url + p,
        { headers: { "x-vercel-protection-bypass": bypassSecret ?? "" } },
        15_000,
      );
      return { path: p, status: r.status };
    } catch (e: unknown) {
      return { path: p, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }));
  const bad = results.filter((r) => r.status >= 500).length;
  return { allowed: bad === 0, results };
}
