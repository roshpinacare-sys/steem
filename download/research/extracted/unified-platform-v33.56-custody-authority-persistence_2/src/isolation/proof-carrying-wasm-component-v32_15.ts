import { sha256, sha256Bytes } from '../contracts/crypto.js';
import { inspectBinaryArtifactV32_14, type BinaryInspectionPolicyV32_14 } from '../binary/proof-carrying-binary-v32_14.js';

export type WasiProfileV32_15 = 'wasi-0.2' | 'wasi-0.3';
export type ComponentEvidenceClassV32_15 = 'SYNTHETIC' | 'OBSERVED_LOCAL' | 'OBSERVED_EXTERNAL';
export type ComponentAdmissionV32_15 = 'REJECT' | 'DRY_RUN_ONLY' | 'ADMIT';

export interface WitInterfaceV32_15 { readonly interfaceId: string; readonly version: string; }
export interface WasmCapabilityGrantV32_15 {
  readonly capability: 'filesystem-read' | 'filesystem-write' | 'network-client' | 'network-listen' | 'clocks-monotonic' | 'clocks-wall' | 'random-secure' | 'environment' | 'secrets';
  readonly resources: readonly string[];
}
export interface ProofCarryingWasmComponentManifestV32_15 {
  readonly schemaVersion: '32.15';
  readonly componentId: string;
  readonly version: string;
  readonly tenantId: string;
  readonly world: string;
  readonly wasiProfile: WasiProfileV32_15;
  readonly binaryDigest: string;
  readonly sourceDigest: string;
  readonly toolchainDigest: string;
  readonly policyDigest: string;
  readonly imports: readonly WitInterfaceV32_15[];
  readonly exports: readonly WitInterfaceV32_15[];
  readonly grants: readonly WasmCapabilityGrantV32_15[];
  readonly deterministic: boolean;
  readonly maximumMemoryBytes: number;
  readonly maximumExecutionMs: number;
  readonly maximumFuel: number;
  readonly publisherId: string;
  readonly reviewerId: string;
  readonly publisherKeyFingerprint: string;
  readonly reviewerKeyFingerprint: string;
  readonly evidenceClass: ComponentEvidenceClassV32_15;
  readonly runtimeQualified: boolean;
  readonly synthetic: boolean;
}
export interface WasmComponentPolicyV32_15 {
  readonly policyDigest: string;
  readonly allowedWasiProfiles: readonly WasiProfileV32_15[];
  readonly allowedImports: readonly string[];
  readonly allowedExports: readonly string[];
  readonly allowedCapabilities: readonly WasmCapabilityGrantV32_15['capability'][];
  readonly deniedCapabilities: readonly WasmCapabilityGrantV32_15['capability'][];
  readonly maximumMemoryBytes: number;
  readonly maximumExecutionMs: number;
  readonly maximumFuel: number;
  readonly requireDeterminism: boolean;
  readonly requireIndependentReview: boolean;
  readonly production: boolean;
}
export interface WasmComponentAdmissionReportV32_15 {
  readonly schemaVersion: '32.15';
  readonly componentId: string;
  readonly admission: ComponentAdmissionV32_15;
  readonly findings: readonly string[];
  readonly binaryDigest: string;
  readonly interfaceDigest: string;
  readonly manifestDigest: string;
  readonly proofDigest: string;
}
export interface WasmComponentCompositionV32_15 {
  readonly componentId: string;
  readonly imports: readonly WitInterfaceV32_15[];
  readonly exports: readonly WitInterfaceV32_15[];
}
export interface WasmCompositionReportV32_15 { readonly valid: boolean; readonly bindings: readonly string[]; readonly findings: readonly string[]; readonly graphDigest: string; }

export function evaluateWasmComponentAdmissionV32_15(options: {
  readonly bytes: Buffer;
  readonly manifest: ProofCarryingWasmComponentManifestV32_15;
  readonly policy: WasmComponentPolicyV32_15;
}): WasmComponentAdmissionReportV32_15 {
  const { bytes, manifest, policy } = options;
  validateManifest(manifest); validatePolicy(policy);
  const findings: string[] = [];
  if (sha256Bytes(bytes) !== manifest.binaryDigest) findings.push('component-binary-digest-mismatch');
  if (manifest.policyDigest !== policy.policyDigest) findings.push('component-policy-digest-mismatch');
  if (!policy.allowedWasiProfiles.includes(manifest.wasiProfile)) findings.push('component-wasi-profile-denied');
  if (policy.requireDeterminism && !manifest.deterministic) findings.push('component-nondeterministic');
  if (manifest.maximumMemoryBytes > policy.maximumMemoryBytes || manifest.maximumExecutionMs > policy.maximumExecutionMs || manifest.maximumFuel > policy.maximumFuel) findings.push('component-resource-limit-exceeded');
  const importIds = manifest.imports.map(interfaceKey);
  const exportIds = manifest.exports.map(interfaceKey);
  if (importIds.some((item) => !policy.allowedImports.includes(item))) findings.push('component-import-denied');
  if (exportIds.some((item) => !policy.allowedExports.includes(item))) findings.push('component-export-denied');
  const grants = manifest.grants.map((grant) => grant.capability);
  if (grants.some((item) => policy.deniedCapabilities.includes(item) || !policy.allowedCapabilities.includes(item))) findings.push('component-capability-denied');
  for (const grant of manifest.grants) {
    if (grant.resources.length === 0 || new Set(grant.resources).size !== grant.resources.length) findings.push(`component-grant-resources-invalid:${grant.capability}`);
    if (grant.capability.startsWith('filesystem-') && grant.resources.some((resource) => !resource.startsWith('/data/') || resource.includes('..') || resource.includes('\\'))) findings.push(`component-filesystem-resource-invalid:${grant.capability}`);
    if (grant.capability.startsWith('network-') && grant.resources.some((resource) => !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(resource))) findings.push(`component-network-resource-invalid:${grant.capability}`);
  }
  if (policy.requireIndependentReview && (manifest.publisherId === manifest.reviewerId || manifest.publisherKeyFingerprint === manifest.reviewerKeyFingerprint)) findings.push('component-independent-review-missing');
  const binaryPolicy: BinaryInspectionPolicyV32_14 = {
    policyId: 'wasm-component-v32.15', maximumBytes: 32 * 1024 * 1024, chunkBytes: 1024 * 1024,
    maximumArchiveEntries: 1, maximumCompressionRatio: 1, rejectUnknown: true, rejectPolyglot: true, rejectExecutables: false,
    rejectActivePdf: true, rejectArchiveTraversal: true, allowedKinds: ['WASM'], maximumEntropy: 8,
  };
  const binary = inspectBinaryArtifactV32_14(`${manifest.componentId}.wasm`, bytes, binaryPolicy);
  if (binary.detectedKind !== 'WASM' || binary.verdict !== 'ACCEPT') findings.push('component-binary-structure-invalid');
  if (policy.production && (manifest.synthetic || manifest.evidenceClass !== 'OBSERVED_EXTERNAL' || !manifest.runtimeQualified)) findings.push('component-production-evidence-insufficient');
  const interfaceDigest = sha256({ world: manifest.world, wasiProfile: manifest.wasiProfile, imports: [...manifest.imports].sort(compareInterface), exports: [...manifest.exports].sort(compareInterface) });
  const manifestDigest = sha256(manifest);
  const admission: ComponentAdmissionV32_15 = findings.length > 0 ? 'REJECT' : policy.production ? 'ADMIT' : 'DRY_RUN_ONLY';
  const material = { schemaVersion: '32.15' as const, componentId: manifest.componentId, admission, findings, binaryDigest: manifest.binaryDigest, interfaceDigest, manifestDigest };
  return { ...material, proofDigest: sha256(material) };
}

export function evaluateWasmComponentCompositionV32_15(components: readonly WasmComponentCompositionV32_15[]): WasmCompositionReportV32_15 {
  const findings: string[] = []; const bindings: string[] = [];
  if (components.length === 0 || new Set(components.map((item) => item.componentId)).size !== components.length) throw new Error('component_composition_identity_invalid');
  const providers = new Map<string, string[]>();
  for (const component of components) for (const item of component.exports) providers.set(interfaceKey(item), [...(providers.get(interfaceKey(item)) ?? []), component.componentId]);
  const edges = new Map<string, Set<string>>(components.map((item) => [item.componentId, new Set<string>()]));
  for (const component of components) for (const item of component.imports) {
    const key = interfaceKey(item); const candidates = providers.get(key) ?? [];
    if (candidates.length === 0) findings.push(`component-import-unsatisfied:${component.componentId}:${key}`);
    else if (candidates.length > 1) findings.push(`component-import-ambiguous:${component.componentId}:${key}`);
    else { const provider=candidates[0]!; if (provider===component.componentId) findings.push(`component-self-binding:${component.componentId}:${key}`); else { edges.get(component.componentId)!.add(provider); bindings.push(`${component.componentId}:${key}->${provider}`); } }
  }
  if (hasCycle(edges)) findings.push('component-composition-cycle');
  const material = { valid: findings.length === 0, bindings: bindings.sort(), findings: findings.sort() };
  return { ...material, graphDigest: sha256(material) };
}

function validateManifest(manifest: ProofCarryingWasmComponentManifestV32_15): void {
  if (manifest.schemaVersion !== '32.15' || [manifest.componentId, manifest.version, manifest.tenantId, manifest.world, manifest.publisherId, manifest.reviewerId].some((item) => item.trim() === '')) throw new Error('component_manifest_identity_invalid');
  if (![manifest.binaryDigest, manifest.sourceDigest, manifest.toolchainDigest, manifest.policyDigest, manifest.publisherKeyFingerprint, manifest.reviewerKeyFingerprint].every(digest)) throw new Error('component_manifest_digest_invalid');
  if ([manifest.maximumMemoryBytes, manifest.maximumExecutionMs, manifest.maximumFuel].some((value) => !Number.isSafeInteger(value) || value <= 0)) throw new Error('component_manifest_limits_invalid');
  const imports=manifest.imports.map(interfaceKey), exports=manifest.exports.map(interfaceKey);
  if (new Set(imports).size !== imports.length || new Set(exports).size !== exports.length) throw new Error('component_manifest_interface_duplicate');
  if (new Set(manifest.grants.map((item) => item.capability)).size !== manifest.grants.length) throw new Error('component_manifest_grant_duplicate');
}
function validatePolicy(policy: WasmComponentPolicyV32_15): void {
  if (!digest(policy.policyDigest) || policy.allowedWasiProfiles.length===0 || [policy.maximumMemoryBytes, policy.maximumExecutionMs, policy.maximumFuel].some((value)=>!Number.isSafeInteger(value)||value<=0)) throw new Error('component_policy_invalid');
  if (policy.allowedCapabilities.some((item)=>policy.deniedCapabilities.includes(item))) throw new Error('component_policy_capability_conflict');
}
function interfaceKey(value: WitInterfaceV32_15): string { if (!/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(value.interfaceId) || !/^\d+\.\d+\.\d+$/.test(value.version)) throw new Error('component_interface_invalid'); return `${value.interfaceId}@${value.version}`; }
function compareInterface(a: WitInterfaceV32_15,b: WitInterfaceV32_15):number{return interfaceKey(a).localeCompare(interfaceKey(b));}
function digest(value:string):boolean{return /^[a-f0-9]{64}$/.test(value);}
function hasCycle(edges:Map<string,Set<string>>):boolean{const visiting=new Set<string>(),done=new Set<string>();const visit=(node:string):boolean=>{if(visiting.has(node))return true;if(done.has(node))return false;visiting.add(node);for(const next of edges.get(node)??[])if(visit(next))return true;visiting.delete(node);done.add(node);return false;};return [...edges.keys()].some(visit);}
