/**
 * SBOM Generator — produces a CycloneDX 1.4 JSON Software Bill of Materials
 * by reading the resolved package-lock.json of the workspace root.
 *
 * Optional enrichment: when SOCKET_API_KEY is set, components are annotated
 * with Socket.dev supply-chain risk scores after the initial SBOM is built.
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, isAbsolute, relative } from 'path';
import { log as logger } from './logger.js';
import { fetchSocketRisk } from './integrations/socket-risk.js';
import type { SocketScore } from './integrations/socket-risk.js';

export interface SbomComponent {
  type: 'library';
  name: string;
  version: string;
  purl: string;
  hashes: { alg: 'SHA-256'; content: string }[];
  licenses?: { license: { id: string } }[];
  /** Optional Socket.dev supply-chain risk annotation. Present when
   *  SOCKET_API_KEY is set and Socket.dev has data for this package. */
  socketRisk?: SocketScore & { flagged: boolean };
}

export interface Sbom {
  bomFormat: 'CycloneDX';
  specVersion: '1.4';
  version: number;
  serialNumber: string;
  metadata: { timestamp: string; tools: { name: string; version: string }[] };
  components: SbomComponent[];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeLicense(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (
    value &&
    typeof value === 'object' &&
    'type' in value &&
    typeof (value as Record<string, unknown>).type === 'string'
  ) {
    return ((value as { type: string }).type).trim();
  }
  return '';
}

function uuidFromHash(hex: string): string {
  // Format first 32 hex chars as RFC-4122-style UUID (version bits are cosmetic here).
  const h = hex.slice(0, 32).padEnd(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function generateSbom(workspaceRoot: string): Sbom {
  const lockPath = resolve(workspaceRoot, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

  const components: SbomComponent[] = [];
  const packages: Record<
    string,
    { version: string; license?: string; resolved?: string }
  > = lock.packages ?? lock.dependencies ?? {};

  for (const [pkgKey, pkgData] of Object.entries(packages)) {
    if (!pkgKey || pkgKey === '') continue; // skip root
    const name = pkgKey
      .replace(/^node_modules\//, '')
      .replace(/node_modules\//g, '/');
    const version = pkgData.version ?? '0.0.0';
    const purl = `pkg:npm/${encodeURIComponent(name)}@${version}`;
    const hashInput = `${name}@${version}:${pkgData.resolved ?? ''}`;
    const component: SbomComponent = {
      type: 'library',
      name,
      version,
      purl,
      hashes: [{ alg: 'SHA-256', content: sha256(hashInput) }],
    };
    const licenseId = normalizeLicense(pkgData.license);
    if (licenseId) {
      component.licenses = [{ license: { id: licenseId } }];
    }
    components.push(component);
  }

  const sbom: Sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.4',
    version: 1,
    serialNumber: `urn:uuid:${uuidFromHash(sha256(Date.now().toString()))}`,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ name: 'qodo-sbom-generator', version: '1.0.0' }],
    },
    components,
  };

  logger.info('SBOM generated', { componentCount: components.length });
  return sbom;
}

/**
 * Enrich an existing SBOM with Socket.dev supply-chain risk scores.
 *
 * Returns a new Sbom object with `socketRisk` populated on each component
 * that Socket.dev has data for. A no-op (returns the input unchanged) when
 * SOCKET_API_KEY is not set.
 */
export async function enrichSbomWithSocketRisk(
  sbom: Sbom,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Promise<Sbom> {
  if (!env.SOCKET_API_KEY) return sbom;

  const results = await fetchSocketRisk(
    sbom.components.map((c) => ({ name: c.name, version: c.version })),
    { env },
  );

  if (results.length === 0) return sbom;

  // Build lookup by "name@version"
  const riskMap = new Map(
    results.map((r) => [`${r.name}@${r.version}`, r]),
  );

  const enrichedComponents: SbomComponent[] = sbom.components.map((comp) => {
    const key = `${comp.name}@${comp.version}`;
    const risk = riskMap.get(key);
    if (!risk || Object.keys(risk.score).length === 0) return comp;
    return {
      ...comp,
      socketRisk: {
        supplyChain: risk.score.supplyChain,
        quality: risk.score.quality,
        maintenance: risk.score.maintenance,
        vulnerability: risk.score.vulnerability,
        license: risk.score.license,
        flagged: risk.highSupplyChainRisk,
      },
    };
  });

  const flaggedCount = enrichedComponents.filter((c) => c.socketRisk?.flagged).length;
  logger.info('SBOM enriched with Socket.dev risk scores', {
    enriched: results.length,
    flagged: flaggedCount,
  });

  return { ...sbom, components: enrichedComponents };
}

export function saveSbom(sbom: Sbom, outPath: string, workspaceRoot?: string): void {
  const target = resolve(outPath);
  if (workspaceRoot) {
    const root = resolve(workspaceRoot);
    const rel = relative(root, target);
    if (isAbsolute(rel) || rel.startsWith('..') || rel === '') {
      throw new Error(
        `Refusing to save SBOM outside workspace: ${outPath} is not under ${workspaceRoot}`,
      );
    }
  }
  writeFileSync(target, JSON.stringify(sbom, null, 2));
  logger.info('SBOM saved', { outPath: target });
}
