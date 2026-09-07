/**
 * socket-risk.ts — Integration: Socket.dev Supply-Chain Risk API
 *
 * Fetches per-package supply-chain risk scores from the Socket.dev npm score
 * endpoint. Scores are 0.0–1.0 where lower means higher risk. Covers threat
 * categories that CVE IDs never capture: typosquatting, obfuscated install
 * scripts, dependency confusion, and protestware.
 *
 * Authentication: Basic auth with SOCKET_API_KEY as the username and an empty
 * password (Socket.dev free-tier convention). Opt-in: if SOCKET_API_KEY is
 * absent the functions return empty results and log a debug notice.
 *
 * Doc: https://docs.socket.dev/reference/npm-score
 */
import { log as logger } from '../logger.js';
import { fetchWithTimeout } from '../../utils/fetch-timeout.js';

const SOCKET_BASE = 'https://api.socket.dev/v0/npm';
/** Packages with supplyChain score below this are flagged as high risk. */
export const SOCKET_SUPPLY_CHAIN_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SocketScore {
  /** 0.0–1.0. Lower = riskier. Missing if Socket has no data for the package. */
  supplyChain?: number;
  quality?: number;
  maintenance?: number;
  vulnerability?: number;
  license?: number;
}

export interface SocketAlert {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | string;
  category: string;
}

export interface SocketPackageResult {
  name: string;
  version: string;
  score: SocketScore;
  alerts: SocketAlert[];
  /** True when supplyChain score is below SOCKET_SUPPLY_CHAIN_THRESHOLD. */
  highSupplyChainRisk: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface SocketApiResponse {
  status?: string;
  score?: {
    supplyChain?: number;
    quality?: number;
    maintenance?: number;
    vulnerability?: number;
    license?: number;
  };
  alerts?: Array<{ type?: string; severity?: string; category?: string }>;
}

function buildAuthHeader(apiKey: string): string {
  // Socket.dev uses HTTP Basic auth: base64("apiKey:")
  const credentials = Buffer.from(`${apiKey}:`).toString('base64');
  return `Basic ${credentials}`;
}

async function fetchScore(
  packageName: string,
  packageVersion: string,
  authHeader: string,
): Promise<SocketPackageResult> {
  const encodedName = encodeURIComponent(packageName);
  const encodedVersion = encodeURIComponent(packageVersion);
  const url = `${SOCKET_BASE}/${encodedName}/${encodedVersion}/score`;

  const fallback: SocketPackageResult = {
    name: packageName,
    version: packageVersion,
    score: {},
    alerts: [],
    highSupplyChainRisk: false,
  };

  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Authorization: authHeader, Accept: 'application/json' } },
      15_000,
    );

    if (res.status === 404) {
      // Package not in Socket's index — not unusual for niche packages
      return fallback;
    }

    if (!res.ok) {
      logger.warn('Socket.dev score fetch non-OK', { package: packageName, status: res.status });
      return fallback;
    }

    const data = (await res.json()) as SocketApiResponse;
    const score: SocketScore = {
      supplyChain: data.score?.supplyChain,
      quality: data.score?.quality,
      maintenance: data.score?.maintenance,
      vulnerability: data.score?.vulnerability,
      license: data.score?.license,
    };
    const alerts: SocketAlert[] = (data.alerts ?? []).map((a) => ({
      type: a.type ?? 'unknown',
      severity: a.severity ?? 'unknown',
      category: a.category ?? 'unknown',
    }));
    const highSupplyChainRisk =
      typeof score.supplyChain === 'number' &&
      score.supplyChain < SOCKET_SUPPLY_CHAIN_THRESHOLD;

    return { name: packageName, version: packageVersion, score, alerts, highSupplyChainRisk };
  } catch (err) {
    logger.warn('Socket.dev fetch error; skipping package', {
      package: packageName,
      err: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch Socket.dev supply-chain risk scores for a list of packages.
 *
 * Runs at most `concurrency` requests in parallel (default 8) to stay
 * within Socket.dev's free-tier rate limits.
 *
 * Returns an empty array when SOCKET_API_KEY is not set.
 */
export async function fetchSocketRisk(
  packages: Array<{ name: string; version: string }>,
  options: { concurrency?: number; env?: Record<string, string | undefined> } = {},
): Promise<SocketPackageResult[]> {
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const apiKey = env.SOCKET_API_KEY;
  if (!apiKey) {
    logger.debug('SOCKET_API_KEY not set; skipping Socket.dev supply-chain enrichment');
    return [];
  }

  const concurrency = options.concurrency ?? 8;
  const authHeader = buildAuthHeader(apiKey);
  const results: SocketPackageResult[] = [];

  // Process in chunks to respect rate limits
  for (let i = 0; i < packages.length; i += concurrency) {
    const chunk = packages.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map((pkg) => fetchScore(pkg.name, pkg.version, authHeader)),
    );
    results.push(...chunkResults);
  }

  const flagged = results.filter((r) => r.highSupplyChainRisk).length;
  logger.info('Socket.dev risk scan complete', {
    checked: results.length,
    flagged,
    skipped: packages.length - results.length,
  });

  return results;
}

/**
 * Convenience: filter results to only those flagged as high supply-chain risk.
 */
export function flaggedPackages(results: SocketPackageResult[]): SocketPackageResult[] {
  return results.filter((r) => r.highSupplyChainRisk);
}
