import { sha256 } from '../contracts/crypto.js';

export type IntegrationCriticality = 'normal' | 'high' | 'critical';

export interface IntegrationContractEvidence {
  readonly edgeId: string;
  readonly sourceCapability: string;
  readonly targetCapability: string;
  readonly contractVersion: string;
  readonly criticality: IntegrationCriticality;
  readonly ownerIds: readonly string[];
  readonly reviewerIds: readonly string[];
  readonly stateful: boolean;
  readonly crossTenant: boolean;
  readonly authorityBearing: boolean;
  readonly successTestRefs: readonly string[];
  readonly rejectionTestRefs: readonly string[];
  readonly timeoutTestRefs: readonly string[];
  readonly replayTestRefs: readonly string[];
  readonly concurrencyTestRefs: readonly string[];
  readonly tamperTestRefs: readonly string[];
  readonly rollbackTestRefs: readonly string[];
  readonly tenantIsolationTestRefs: readonly string[];
  readonly observabilityRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface IntegrationContractAssuranceReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly metrics: {
    readonly edges: number;
    readonly closedEdges: number;
    readonly criticalEdges: number;
    readonly authorityEdges: number;
    readonly authorityCycles: number;
    readonly testReferences: number;
  };
  readonly results: readonly { readonly edgeId: string; readonly status: 'CLOSED' | 'OPEN'; readonly reasons: readonly string[] }[];
  readonly authorityCycles: readonly string[][];
  readonly reportDigest: string;
}

/** Validates integration contracts and their negative-path proof obligations. */
export function evaluateIntegrationContractAssurance(rows: readonly IntegrationContractEvidence[]): IntegrationContractAssuranceReport {
  const ids = new Set<string>();
  const normalized = rows.map((raw) => normalize(raw, ids)).sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  const cycles = authorityCycles(normalized.filter((row) => row.authorityBearing));
  const cycleEdges = new Set(cycles.flatMap((cycle) => cycle.slice(0, -1).map((source, index) => `${source}->${cycle[index + 1]}`)));

  const results = normalized.map((row) => {
    const reasons: string[] = [];
    if (row.sourceCapability === row.targetCapability) reasons.push('self_integration_forbidden');
    if (!/^\d+\.\d+\.\d+$/.test(row.contractVersion)) reasons.push('contract_version_invalid');
    if (row.ownerIds.length === 0) reasons.push('owner_missing');
    if (row.reviewerIds.some((reviewer) => row.ownerIds.includes(reviewer))) reasons.push('owner_reviewer_conflict');
    if (row.criticality === 'critical' && new Set(row.reviewerIds).size < 2) reasons.push('independent_reviewers_insufficient');
    if (row.successTestRefs.length === 0) reasons.push('success_test_missing');
    if (row.rejectionTestRefs.length === 0) reasons.push('rejection_test_missing');
    if (row.criticality !== 'normal' && row.timeoutTestRefs.length === 0) reasons.push('timeout_test_missing');
    if (row.criticality !== 'normal' && row.replayTestRefs.length === 0) reasons.push('replay_test_missing');
    if (row.criticality === 'critical' && row.concurrencyTestRefs.length === 0) reasons.push('concurrency_test_missing');
    if (row.criticality === 'critical' && row.tamperTestRefs.length === 0) reasons.push('tamper_test_missing');
    if (row.stateful && row.rollbackTestRefs.length === 0) reasons.push('rollback_test_missing');
    if (row.crossTenant && row.tenantIsolationTestRefs.length === 0) reasons.push('tenant_isolation_test_missing');
    if (row.observabilityRefs.length === 0) reasons.push('observability_missing');
    if (row.evidenceRefs.length === 0) reasons.push('evidence_missing');
    if (cycleEdges.has(`${row.sourceCapability}->${row.targetCapability}`)) reasons.push('authority_cycle');
    return { edgeId: row.edgeId, status: reasons.length === 0 ? 'CLOSED' as const : 'OPEN' as const, reasons: reasons.sort() };
  });

  const material = {
    status: results.every((row) => row.status === 'CLOSED') ? 'PASS' as const : 'BLOCK' as const,
    metrics: {
      edges: normalized.length,
      closedEdges: results.filter((row) => row.status === 'CLOSED').length,
      criticalEdges: normalized.filter((row) => row.criticality === 'critical').length,
      authorityEdges: normalized.filter((row) => row.authorityBearing).length,
      authorityCycles: cycles.length,
      testReferences: new Set(normalized.flatMap(allTestRefs)).size,
    },
    results,
    authorityCycles: cycles,
  };
  return { ...material, reportDigest: sha256(material) };
}

function normalize(row: IntegrationContractEvidence, ids: Set<string>): IntegrationContractEvidence {
  if (row.edgeId.trim() === '' || ids.has(row.edgeId)) throw new Error(`integration_edge_identity_invalid:${row.edgeId}`);
  ids.add(row.edgeId);
  if (row.sourceCapability.trim() === '' || row.targetCapability.trim() === '') throw new Error(`integration_capability_invalid:${row.edgeId}`);
  return {
    ...row,
    edgeId: row.edgeId.trim(),
    sourceCapability: row.sourceCapability.trim(),
    targetCapability: row.targetCapability.trim(),
    ownerIds: sortedUnique(row.ownerIds),
    reviewerIds: sortedUnique(row.reviewerIds),
    successTestRefs: sortedUnique(row.successTestRefs),
    rejectionTestRefs: sortedUnique(row.rejectionTestRefs),
    timeoutTestRefs: sortedUnique(row.timeoutTestRefs),
    replayTestRefs: sortedUnique(row.replayTestRefs),
    concurrencyTestRefs: sortedUnique(row.concurrencyTestRefs),
    tamperTestRefs: sortedUnique(row.tamperTestRefs),
    rollbackTestRefs: sortedUnique(row.rollbackTestRefs),
    tenantIsolationTestRefs: sortedUnique(row.tenantIsolationTestRefs),
    observabilityRefs: sortedUnique(row.observabilityRefs),
    evidenceRefs: sortedUnique(row.evidenceRefs),
  };
}

function authorityCycles(rows: readonly IntegrationContractEvidence[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const row of rows) graph.set(row.sourceCapability, sortedUnique([...(graph.get(row.sourceCapability) ?? []), row.targetCapability]));
  const cycles: string[][] = [];
  const visiting: string[] = [];
  const active = new Set<string>();
  const visited = new Set<string>();
  const walk = (node: string): void => {
    if (active.has(node)) {
      const index = visiting.indexOf(node);
      const cycle = [...visiting.slice(index), node];
      const canonical = canonicalCycle(cycle);
      if (!cycles.some((row) => row.join('\0') === canonical.join('\0'))) cycles.push(canonical);
      return;
    }
    if (visited.has(node)) return;
    active.add(node); visiting.push(node);
    for (const next of graph.get(node) ?? []) walk(next);
    visiting.pop(); active.delete(node); visited.add(node);
  };
  [...graph.keys()].sort().forEach(walk);
  return cycles.sort((a, b) => a.join('\0').localeCompare(b.join('\0')));
}

function canonicalCycle(cycle: readonly string[]): string[] {
  const body = cycle.slice(0, -1);
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
  rotations.sort((a, b) => a.join('\0').localeCompare(b.join('\0')));
  return [...rotations[0]!, rotations[0]![0]!];
}
function allTestRefs(row: IntegrationContractEvidence): readonly string[] { return [...row.successTestRefs, ...row.rejectionTestRefs, ...row.timeoutTestRefs, ...row.replayTestRefs, ...row.concurrencyTestRefs, ...row.tamperTestRefs, ...row.rollbackTestRefs, ...row.tenantIsolationTestRefs]; }
function sortedUnique(values: readonly string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(); }
