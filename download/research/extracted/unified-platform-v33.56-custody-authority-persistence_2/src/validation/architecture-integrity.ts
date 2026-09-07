import { sha256 } from '../contracts/crypto.js';

export type ArchitectureNodeKind = 'SOURCE' | 'TEST' | 'ENTRYPOINT';
export interface ArchitectureNode {
  readonly nodeId: string;
  readonly layer: string;
  readonly kind: ArchitectureNodeKind;
  readonly imports: readonly string[];
}
export interface ArchitectureCapabilityPath {
  readonly capabilityId: string;
  readonly componentIds: readonly string[];
  readonly requiredTestIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly operationalControl: string;
  readonly limitations: readonly string[];
}
export interface ArchitectureIntegrityInput {
  readonly nodes: readonly ArchitectureNode[];
  readonly allowedLayerDependencies: Readonly<Record<string, readonly string[]>>;
  readonly capabilityPaths: readonly ArchitectureCapabilityPath[];
}
export interface ArchitectureFinding {
  readonly code: string;
  readonly severity: 'ERROR' | 'WARNING';
  readonly subject: string;
  readonly message: string;
}
export interface ArchitectureIntegrityReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly findings: readonly ArchitectureFinding[];
  readonly metrics: {
    readonly nodeCount: number;
    readonly sourceCount: number;
    readonly testCount: number;
    readonly entrypointCount: number;
    readonly importEdgeCount: number;
    readonly sourceCycleCount: number;
    readonly untestedSourceCount: number;
    readonly capabilityPathCount: number;
    readonly closedCapabilityPathCount: number;
    readonly layerCount: number;
  };
  readonly sourceCycles: readonly (readonly string[])[];
  readonly untestedSources: readonly string[];
  readonly capabilityClosure: readonly {
    readonly capabilityId: string;
    readonly status: 'CLOSED' | 'OPEN';
    readonly missingComponents: readonly string[];
    readonly missingTests: readonly string[];
    readonly missingEvidenceOrControl: boolean;
  }[];
  readonly graphDigest: string;
}

export function validateArchitectureIntegrity(input: ArchitectureIntegrityInput): ArchitectureIntegrityReport {
  const findings: ArchitectureFinding[] = [];
  const byId = new Map<string, ArchitectureNode>();
  for (const node of input.nodes) {
    if (node.nodeId.trim() === '' || node.layer.trim() === '') {
      findings.push(finding('ARCH_NODE_INVALID', 'ERROR', node.nodeId || '<empty>', 'Architecture nodes require identifiers and layers.'));
      continue;
    }
    if (byId.has(node.nodeId)) findings.push(finding('ARCH_NODE_DUPLICATE', 'ERROR', node.nodeId, 'Architecture node identifiers must be unique.'));
    else byId.set(node.nodeId, node);
  }
  for (const node of byId.values()) {
    const allowed = input.allowedLayerDependencies[node.layer];
    if (allowed === undefined) findings.push(finding('ARCH_LAYER_POLICY_MISSING', 'ERROR', node.layer, 'Every architecture layer requires an explicit dependency policy.'));
    const imports = new Set<string>();
    for (const dependencyId of node.imports) {
      if (imports.has(dependencyId)) findings.push(finding('ARCH_IMPORT_DUPLICATE', 'WARNING', node.nodeId, `Duplicate import edge: ${dependencyId}.`));
      imports.add(dependencyId);
      const dependency = byId.get(dependencyId);
      if (dependency === undefined) {
        findings.push(finding('ARCH_IMPORT_UNRESOLVED', 'ERROR', node.nodeId, `Unresolved local import: ${dependencyId}.`));
        continue;
      }
      if (node.kind !== 'TEST' && dependency.kind === 'TEST') findings.push(finding('ARCH_SOURCE_IMPORTS_TEST', 'ERROR', node.nodeId, 'Production source may not import test code.'));
      if (allowed !== undefined && !allowed.includes(dependency.layer)) {
        findings.push(finding('ARCH_LAYER_VIOLATION', 'ERROR', node.nodeId, `${node.layer} may not depend on ${dependency.layer}.`));
      }
    }
  }

  const sourceNodes = [...byId.values()].filter((node) => node.kind !== 'TEST');
  const sourceCycles = findCycles(sourceNodes, byId);
  for (const cycle of sourceCycles) findings.push(finding('ARCH_SOURCE_CYCLE', 'ERROR', cycle[0] ?? '<unknown>', cycle.join(' -> ')));

  const reachedByTests = new Set<string>();
  for (const testNode of byId.values()) {
    if (testNode.kind !== 'TEST') continue;
    walk(testNode.nodeId, byId, reachedByTests, new Set<string>());
  }
  const untestedSources = sourceNodes.filter((node) => node.kind === 'SOURCE' && !reachedByTests.has(node.nodeId)).map((node) => node.nodeId).sort();
  for (const nodeId of untestedSources) findings.push(finding('ARCH_SOURCE_UNTESTED', 'ERROR', nodeId, 'Non-entrypoint source is not reachable from any test.'));

  const capabilityIds = new Set<string>();
  const capabilityClosure = input.capabilityPaths.map((path) => {
    if (path.capabilityId.trim() === '' || capabilityIds.has(path.capabilityId)) findings.push(finding('ARCH_CAPABILITY_ID_INVALID', 'ERROR', path.capabilityId || '<empty>', 'Capability identifiers must be unique and non-empty.'));
    capabilityIds.add(path.capabilityId);
    const missingComponents = path.componentIds.filter((id) => !byId.has(id));
    const missingTests = path.requiredTestIds.filter((id) => byId.get(id)?.kind !== 'TEST');
    const missingEvidenceOrControl = path.evidenceRefs.length === 0 || path.evidenceRefs.some((ref) => ref.trim() === '') || path.operationalControl.trim() === '' || path.limitations.length === 0;
    if (missingComponents.length > 0) findings.push(finding('ARCH_CAPABILITY_COMPONENT_MISSING', 'ERROR', path.capabilityId, missingComponents.join(',')));
    if (missingTests.length > 0) findings.push(finding('ARCH_CAPABILITY_TEST_MISSING', 'ERROR', path.capabilityId, missingTests.join(',')));
    if (missingEvidenceOrControl) findings.push(finding('ARCH_CAPABILITY_EVIDENCE_OR_CONTROL_MISSING', 'ERROR', path.capabilityId, 'Capability closure requires evidence, an operational control and limitations.'));
    const status = missingComponents.length === 0 && missingTests.length === 0 && !missingEvidenceOrControl ? 'CLOSED' as const : 'OPEN' as const;
    return { capabilityId: path.capabilityId, status, missingComponents, missingTests, missingEvidenceOrControl };
  });

  const metrics = {
    nodeCount: byId.size,
    sourceCount: sourceNodes.filter((node) => node.kind === 'SOURCE').length,
    testCount: [...byId.values()].filter((node) => node.kind === 'TEST').length,
    entrypointCount: sourceNodes.filter((node) => node.kind === 'ENTRYPOINT').length,
    importEdgeCount: [...byId.values()].reduce((sum, node) => sum + node.imports.length, 0),
    sourceCycleCount: sourceCycles.length,
    untestedSourceCount: untestedSources.length,
    capabilityPathCount: capabilityClosure.length,
    closedCapabilityPathCount: capabilityClosure.filter((item) => item.status === 'CLOSED').length,
    layerCount: new Set([...byId.values()].map((node) => node.layer)).size,
  };
  const material = { findings, metrics, sourceCycles, untestedSources, capabilityClosure };
  return { status: findings.some((item) => item.severity === 'ERROR') ? 'BLOCK' : 'PASS', ...material, graphDigest: sha256(material) };
}

function walk(nodeId: string, byId: ReadonlyMap<string, ArchitectureNode>, reached: Set<string>, visiting: Set<string>): void {
  if (visiting.has(nodeId)) return;
  visiting.add(nodeId);
  for (const dependency of byId.get(nodeId)?.imports ?? []) {
    const node = byId.get(dependency);
    if (node === undefined) continue;
    if (node.kind !== 'TEST') reached.add(node.nodeId);
    walk(node.nodeId, byId, reached, visiting);
  }
  visiting.delete(nodeId);
}
function findCycles(nodes: readonly ArchitectureNode[], byId: ReadonlyMap<string, ArchitectureNode>): string[][] {
  const cycles: string[][] = []; const done = new Set<string>(); const stack: string[] = []; const active = new Set<string>(); const seen = new Set<string>();
  const visit = (nodeId: string): void => {
    if (done.has(nodeId)) return;
    if (active.has(nodeId)) {
      const start = stack.indexOf(nodeId); const cycle = [...stack.slice(start), nodeId];
      const canonical = canonicalCycle(cycle); if (!seen.has(canonical)) { seen.add(canonical); cycles.push(cycle); }
      return;
    }
    active.add(nodeId); stack.push(nodeId);
    for (const dependency of byId.get(nodeId)?.imports ?? []) if (byId.get(dependency)?.kind !== 'TEST') visit(dependency);
    stack.pop(); active.delete(nodeId); done.add(nodeId);
  };
  for (const node of nodes) visit(node.nodeId);
  return cycles.sort((a, b) => a.join('|').localeCompare(b.join('|')));
}
function canonicalCycle(cycle: readonly string[]): string {
  const body = cycle.slice(0, -1); if (body.length === 0) return '';
  const variants = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)].join('|'));
  return variants.sort()[0] ?? '';
}
function finding(code: string, severity: ArchitectureFinding['severity'], subject: string, message: string): ArchitectureFinding { return { code, severity, subject, message }; }
