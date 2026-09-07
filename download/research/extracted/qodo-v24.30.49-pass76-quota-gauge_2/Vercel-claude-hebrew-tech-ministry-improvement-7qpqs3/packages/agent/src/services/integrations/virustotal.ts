/**
 * virustotal.ts — Integration: VirusTotal File Hash Reputation API
 *
 * Checks package SHA-256 hashes against VirusTotal's known-bad database.
 * Uses the VirusTotal API v3 `/files/{hash}` endpoint — a lightweight lookup
 * that returns detection statistics (malicious, suspicious, undetected counts)
 * without uploading any bytes.
 *
 * Gated on VT_API_KEY env var (VirusTotal free public API key required).
 * If the key is absent all functions return empty results.
 *
 * Rate limit (free tier): 4 requests/minute. The public API allows 500/day.
 * This integration batches lookups with a conservative delay to stay within
 * both constraints.
 *
 * Doc: https://developers.virustotal.com/reference/file-info
 */
import { log as logger } from '../logger.js';
import { fetchWithTimeout } from '../../utils/fetch-timeout.js';

const VT_BASE = 'https://www.virustotal.com/api/v3';
/**
 * Packages whose malicious detection count is at or above this threshold
 * are flagged as potentially malicious.
 */
export const VT_MALICIOUS_THRESHOLD = 1;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VirusTotalStats {
  malicious: number;
  suspicious: number;
  undetected: number;
  harmless: number;
  failure: number;
  'type-unsupported': number;
}

export interface VirusTotalFinding {
  hash: string;
  packageName: string;
  packageVersion: string;
  stats: VirusTotalStats;
  /** True when malicious count >= VT_MALICIOUS_THRESHOLD. */
  flagged: boolean;
  /** True when the hash was not found in VirusTotal's database. */
  unknown: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface VtApiResponse {
  data?: {
    attributes?: {
      last_analysis_stats?: Partial<VirusTotalStats>;
    };
  };
}

const EMPTY_STATS: VirusTotalStats = {
  malicious: 0,
  suspicious: 0,
  undetected: 0,
  harmless: 0,
  failure: 0,
  'type-unsupported': 0,
};

async function lookupHash(
  hash: string,
  packageName: string,
  packageVersion: string,
  apiKey: string,
): Promise<VirusTotalFinding> {
  const url = `${VT_BASE}/files/${hash}`;
  const fallbackUnknown: VirusTotalFinding = {
    hash,
    packageName,
    packageVersion,
    stats: { ...EMPTY_STATS },
    flagged: false,
    unknown: true,
  };

  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { 'x-apikey': apiKey, Accept: 'application/json' } },
      20_000,
    );

    if (res.status === 404) {
      // Hash not in VT database — benign absence (new/unlisted package)
      return fallbackUnknown;
    }

    if (res.status === 429) {
      logger.warn('VirusTotal rate limit hit; pausing lookups', { hash });
      // Caller handles rate-limit backoff via delay-per-chunk
      return fallbackUnknown;
    }

    if (!res.ok) {
      logger.warn('VirusTotal non-OK response', { hash, status: res.status });
      return fallbackUnknown;
    }

    const data = (await res.json()) as VtApiResponse;
    const rawStats = data.data?.attributes?.last_analysis_stats ?? {};
    const stats: VirusTotalStats = {
      malicious: rawStats.malicious ?? 0,
      suspicious: rawStats.suspicious ?? 0,
      undetected: rawStats.undetected ?? 0,
      harmless: rawStats.harmless ?? 0,
      failure: rawStats.failure ?? 0,
      'type-unsupported': rawStats['type-unsupported'] ?? 0,
    };
    const flagged = stats.malicious >= VT_MALICIOUS_THRESHOLD;

    return { hash, packageName, packageVersion, stats, flagged, unknown: false };
  } catch (err) {
    logger.warn('VirusTotal lookup error; skipping hash', {
      hash,
      err: err instanceof Error ? err.message : String(err),
    });
    return fallbackUnknown;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up SHA-256 hashes of SBOM packages against VirusTotal.
 *
 * Free-tier rate limit is 4 req/min (500/day). This function sends at most
 * `batchSize` requests (default 4) per interval with a `delayMs` pause
 * (default 60 000 ms — one full minute per batch) to stay within the 4 req/min cap.
 *
 * Only returns results for packages that have a non-empty hash. Skips
 * packages with no SHA-256 hash in their `hashes` array.
 *
 * Returns an empty array when VT_API_KEY is not set.
 */
export async function scanHashesWithVirusTotal(
  packages: Array<{ name: string; version: string; sha256: string }>,
  options: {
    batchSize?: number;
    delayMs?: number;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<VirusTotalFinding[]> {
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const apiKey = env.VT_API_KEY;
  if (!apiKey) {
    logger.debug('VT_API_KEY not set; skipping VirusTotal hash reputation check');
    return [];
  }

  // Filter out packages with empty hashes (first pass)
  const scannable = packages.filter((p) => p.sha256 && p.sha256.length === 64);
  if (scannable.length === 0) return [];

  const batchSize = options.batchSize ?? 4;
  const delayMs = options.delayMs ?? 60_000;
  const results: VirusTotalFinding[] = [];

  for (let i = 0; i < scannable.length; i += batchSize) {
    if (i > 0) {
      // Respect the 4 req/min rate limit between batches
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const batch = scannable.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((pkg) => lookupHash(pkg.sha256, pkg.name, pkg.version, apiKey)),
    );
    results.push(...batchResults);
  }

  const flagged = results.filter((r) => r.flagged).length;
  const unknown = results.filter((r) => r.unknown).length;
  logger.info('VirusTotal hash scan complete', {
    checked: results.length,
    flagged,
    unknown,
    skipped: packages.length - scannable.length,
  });

  return results;
}

/**
 * Filter VirusTotalFinding results to only those flagged as malicious.
 */
export function flaggedFindings(results: VirusTotalFinding[]): VirusTotalFinding[] {
  return results.filter((r) => r.flagged);
}
