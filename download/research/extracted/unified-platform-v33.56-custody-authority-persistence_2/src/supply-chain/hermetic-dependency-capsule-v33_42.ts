import { createHash } from 'node:crypto';
import { KeyRegistry, sha256, sha256Bytes, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';

export type DependencySourceClassV33_42 = 'REPACKED_FROM_PREINSTALLED_EXACT_VERSION';
export type DependencyExecutionClassV33_42 = 'LOCAL_HERMETIC_INSTALL_REHEARSAL';

export interface DependencyCapsuleEntryV33_42 {
  readonly name: string;
  readonly version: string;
  readonly tarballPath: string;
  readonly tarballSha256: string;
  readonly tarballIntegrity: string;
  readonly packageJsonSha256: string;
  readonly sourceClass: DependencySourceClassV33_42;
  readonly sourcePathDigest: string;
  readonly contentTreeDigest: string;
}

export interface DependencyCapsuleManifestPayloadV33_42 {
  readonly version: '33.42';
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageJsonDigest: string;
  readonly packageLockDigest: string;
  readonly entries: readonly DependencyCapsuleEntryV33_42[];
  readonly sbomDigest: string;
  readonly toolchainProvenanceDigest: string;
  readonly executionClass: DependencyExecutionClassV33_42;
  readonly generatedAt: string;
  readonly manifestDigest: string;
}

export interface DependencySbomComponentV33_42 {
  readonly name: string;
  readonly version: string;
  readonly purl: string;
  readonly integrity: string;
  readonly tarballSha256: string;
  readonly scope: 'development';
}
export interface DependencySbomV33_42 {
  readonly version: '33.42';
  readonly format: 'CYCLONEDX_LITE_1_5';
  readonly serialNumber: string;
  readonly components: readonly DependencySbomComponentV33_42[];
  readonly generatedAt: string;
  readonly sbomDigest: string;
}
export interface ToolchainProvenanceV33_42 {
  readonly version: '33.42';
  readonly nodeVersion: string;
  readonly npmVersion: string;
  readonly typescriptVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly sourceClass: 'PREINSTALLED_TOOLCHAIN_REPACK_SOURCE';
  readonly generatedAt: string;
  readonly provenanceDigest: string;
}
export interface InstalledDependencyV33_42 { readonly name: string; readonly version: string; }
export interface OfflineInstallReceiptPayloadV33_42 {
  readonly version: '33.42';
  readonly manifestDigest: string;
  readonly command: 'npm ci --offline';
  readonly cacheInitiallyEmpty: true;
  readonly networkRequestsObserved: 0;
  readonly exitCode: 0;
  readonly buildExitCode: 0;
  readonly installedPackages: readonly InstalledDependencyV33_42[];
  readonly nodeModulesTreeDigest: string;
  readonly installLogDigest: string;
  readonly executionClass: DependencyExecutionClassV33_42;
  readonly installedAt: string;
  readonly receiptDigest: string;
}
export interface HermeticDependencyQualificationVerdictV33_42 {
  readonly version: '33.42';
  readonly status: 'LOCAL_HERMETIC_OFFLINE_INSTALL_PROVEN';
  readonly manifestDigest: string;
  readonly receiptDigest: string;
  readonly dependencyCount: number;
  readonly npmCiOfflineProven: true;
  readonly lockfileBound: true;
  readonly sbomBound: true;
  readonly provenanceBound: true;
  readonly externalDependencyRegistryObserved: false;
  readonly externalHumanParticipants: 0;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verifiedAt: string;
  readonly verdictDigest: string;
}
export interface HermeticDependencyTrustV33_42 {
  readonly manifestSignerRegistry: KeyRegistry;
  readonly trustedManifestSignerIds: readonly string[];
  readonly receiptSignerRegistry: KeyRegistry;
  readonly trustedReceiptSignerIds: readonly string[];
}

function nonEmpty(value: string, error: string): void { if (value.trim() === '') throw new Error(error); }
function hex64(value: string, error: string): void { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(error); }
function sri512(value: string, error: string): void { if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(error); }
function safeTarballPath(value: string): void {
  if (!value.startsWith('vendor/dependency-capsule/tarballs/') || value.includes('..') || value.startsWith('/') || value.includes('\\')) throw new Error('dependency_capsule_path_invalid');
  if (!value.endsWith('.tgz')) throw new Error('dependency_capsule_tarball_extension_invalid');
}
function sortedUniqueNames<T extends {name:string}>(rows: readonly T[], error: string): T[] {
  const sorted=[...rows].sort((a,b)=>a.name.localeCompare(b.name));
  if(new Set(sorted.map(x=>x.name)).size!==sorted.length) throw new Error(error);
  return sorted;
}
export function sha512IntegrityV33_42(bytes: Uint8Array): string { return `sha512-${createHash('sha512').update(bytes).digest('base64')}`; }

export function createDependencySbomV33_42(input: Omit<DependencySbomV33_42,'sbomDigest'>): DependencySbomV33_42 {
  const components=sortedUniqueNames(input.components,'dependency_sbom_duplicate_component');
  for(const c of components){ nonEmpty(c.name,'dependency_sbom_name_required'); nonEmpty(c.version,'dependency_sbom_version_required'); hex64(c.tarballSha256,'dependency_sbom_sha256_invalid'); sri512(c.integrity,'dependency_sbom_integrity_invalid'); if(c.purl!==`pkg:npm/${encodeURIComponent(c.name)}@${c.version}`) throw new Error('dependency_sbom_purl_invalid'); }
  const material={...input,components}; return {...material,sbomDigest:sha256(material)};
}
export function createToolchainProvenanceV33_42(input: Omit<ToolchainProvenanceV33_42,'provenanceDigest'>): ToolchainProvenanceV33_42 {
  for(const [v,e] of [[input.nodeVersion,'toolchain_node_required'],[input.npmVersion,'toolchain_npm_required'],[input.typescriptVersion,'toolchain_typescript_required'],[input.platform,'toolchain_platform_required'],[input.architecture,'toolchain_arch_required']] as const) nonEmpty(v,e);
  const material={...input}; return {...material,provenanceDigest:sha256(material)};
}
export function createSignedDependencyCapsuleManifestV33_42(input: {
  signer: SigningIdentity; packageName:string; packageVersion:string; packageJsonBytes:Uint8Array; packageLockBytes:Uint8Array;
  entries: readonly DependencyCapsuleEntryV33_42[]; sbom:DependencySbomV33_42; toolchain:ToolchainProvenanceV33_42; generatedAt:Date;
}): SignedEnvelope<DependencyCapsuleManifestPayloadV33_42> {
  const entries=sortedUniqueNames(input.entries,'dependency_capsule_duplicate_entry');
  for(const e of entries){ nonEmpty(e.name,'dependency_capsule_name_required'); nonEmpty(e.version,'dependency_capsule_version_required'); safeTarballPath(e.tarballPath); hex64(e.tarballSha256,'dependency_capsule_sha256_invalid'); sri512(e.tarballIntegrity,'dependency_capsule_integrity_invalid'); hex64(e.packageJsonSha256,'dependency_capsule_package_json_sha256_invalid'); hex64(e.sourcePathDigest,'dependency_capsule_source_path_digest_invalid'); hex64(e.contentTreeDigest,'dependency_capsule_content_tree_digest_invalid'); }
  if(input.sbom.components.length!==entries.length) throw new Error('dependency_capsule_sbom_count_mismatch');
  const material={version:'33.42' as const,packageName:input.packageName,packageVersion:input.packageVersion,packageJsonDigest:sha256Bytes(input.packageJsonBytes),packageLockDigest:sha256Bytes(input.packageLockBytes),entries,sbomDigest:input.sbom.sbomDigest,toolchainProvenanceDigest:input.toolchain.provenanceDigest,executionClass:'LOCAL_HERMETIC_INSTALL_REHEARSAL' as const,generatedAt:input.generatedAt.toISOString()};
  return signEnvelope({...material,manifestDigest:sha256(material)},input.signer);
}
export function createOfflineInstallReceiptV33_42(input: Omit<OfflineInstallReceiptPayloadV33_42,'version'|'command'|'cacheInitiallyEmpty'|'networkRequestsObserved'|'exitCode'|'buildExitCode'|'executionClass'|'receiptDigest'> & { signer:SigningIdentity }): SignedEnvelope<OfflineInstallReceiptPayloadV33_42> {
  const installedPackages=sortedUniqueNames(input.installedPackages,'offline_install_duplicate_package');
  hex64(input.manifestDigest,'offline_install_manifest_digest_invalid'); hex64(input.nodeModulesTreeDigest,'offline_install_tree_digest_invalid'); hex64(input.installLogDigest,'offline_install_log_digest_invalid');
  const material={version:'33.42' as const,manifestDigest:input.manifestDigest,command:'npm ci --offline' as const,cacheInitiallyEmpty:true as const,networkRequestsObserved:0 as const,exitCode:0 as const,buildExitCode:0 as const,installedPackages,nodeModulesTreeDigest:input.nodeModulesTreeDigest,installLogDigest:input.installLogDigest,executionClass:'LOCAL_HERMETIC_INSTALL_REHEARSAL' as const,installedAt:input.installedAt};
  return signEnvelope({...material,receiptDigest:sha256(material)},input.signer);
}

function lockPackages(lock: any): Map<string, any> {
  if(lock?.lockfileVersion!==3 || typeof lock?.packages!=='object') throw new Error('dependency_lockfile_invalid');
  const out=new Map<string,any>(); for(const [path,row] of Object.entries(lock.packages)){ if(path==='') continue; const name=path.replace(/^node_modules\//,''); out.set(name,row); } return out;
}
export function verifyHermeticDependencyQualificationV33_42(input: {
  manifest:SignedEnvelope<DependencyCapsuleManifestPayloadV33_42>; sbom:DependencySbomV33_42; toolchain:ToolchainProvenanceV33_42;
  packageJsonBytes:Uint8Array; packageLockBytes:Uint8Array; tarballBytesByPath:ReadonlyMap<string,Uint8Array>;
  packageJsonByTarballPath:ReadonlyMap<string,Uint8Array>; contentTreeDigestByTarballPath:ReadonlyMap<string,string>;
  installReceipt:SignedEnvelope<OfflineInstallReceiptPayloadV33_42>; trust:HermeticDependencyTrustV33_42; verifiedAt:Date;
}): HermeticDependencyQualificationVerdictV33_42 {
  const m=input.manifest.payload;
  if(!input.trust.trustedManifestSignerIds.includes(input.manifest.issuerKeyId)||!input.trust.manifestSignerRegistry.verifyAt(input.manifest,input.verifiedAt)) throw new Error('dependency_manifest_signature_invalid');
  if(!input.trust.trustedReceiptSignerIds.includes(input.installReceipt.issuerKeyId)||!input.trust.receiptSignerRegistry.verifyAt(input.installReceipt,input.verifiedAt)) throw new Error('offline_install_receipt_signature_invalid');
  if(m.version!=='33.42'||m.executionClass!=='LOCAL_HERMETIC_INSTALL_REHEARSAL') throw new Error('dependency_manifest_version_invalid');
  const {manifestDigest,...manifestMaterial}=m; if(manifestDigest!==sha256(manifestMaterial)) throw new Error('dependency_manifest_digest_invalid');
  if(m.packageJsonDigest!==sha256Bytes(input.packageJsonBytes)||m.packageLockDigest!==sha256Bytes(input.packageLockBytes)) throw new Error('dependency_project_files_digest_mismatch');
  const sbomMaterial={...input.sbom}; delete (sbomMaterial as any).sbomDigest; if(input.sbom.sbomDigest!==sha256(sbomMaterial)||m.sbomDigest!==input.sbom.sbomDigest) throw new Error('dependency_sbom_digest_invalid');
  const toolMaterial={...input.toolchain}; delete (toolMaterial as any).provenanceDigest; if(input.toolchain.provenanceDigest!==sha256(toolMaterial)||m.toolchainProvenanceDigest!==input.toolchain.provenanceDigest) throw new Error('dependency_toolchain_digest_invalid');
  const packageJson=JSON.parse(Buffer.from(input.packageJsonBytes).toString('utf8')); const lock=JSON.parse(Buffer.from(input.packageLockBytes).toString('utf8')); const locked=lockPackages(lock);
  if(packageJson.name!==m.packageName||packageJson.version!==m.packageVersion) throw new Error('dependency_package_identity_mismatch');
  const entries=sortedUniqueNames(m.entries,'dependency_capsule_duplicate_entry'); if(locked.size!==entries.length) throw new Error('dependency_lock_entry_count_mismatch');
  const sbomByName=new Map(input.sbom.components.map(c=>[c.name,c]));
  for(const e of entries){
    const bytes=input.tarballBytesByPath.get(e.tarballPath); if(!bytes) throw new Error('dependency_tarball_missing');
    if(sha256Bytes(bytes)!==e.tarballSha256||sha512IntegrityV33_42(bytes)!==e.tarballIntegrity) throw new Error('dependency_tarball_digest_mismatch');
    const pj=input.packageJsonByTarballPath.get(e.tarballPath); if(!pj||sha256Bytes(pj)!==e.packageJsonSha256) throw new Error('dependency_tarball_package_json_mismatch');
    const parsed=JSON.parse(Buffer.from(pj).toString('utf8')); if(parsed.name!==e.name||parsed.version!==e.version) throw new Error('dependency_tarball_identity_mismatch');
    if(input.contentTreeDigestByTarballPath.get(e.tarballPath)!==e.contentTreeDigest) throw new Error('dependency_content_tree_digest_mismatch');
    const row=locked.get(e.name); if(!row||row.version!==e.version||row.resolved!==`file:${e.tarballPath}`||row.integrity!==e.tarballIntegrity) throw new Error('dependency_lock_entry_mismatch');
    if(packageJson.devDependencies?.[e.name]!==`file:${e.tarballPath}`) throw new Error('dependency_package_json_dependency_mismatch');
    const s=sbomByName.get(e.name); if(!s||s.version!==e.version||s.integrity!==e.tarballIntegrity||s.tarballSha256!==e.tarballSha256) throw new Error('dependency_sbom_component_mismatch');
  }
  if(sbomByName.size!==entries.length) throw new Error('dependency_sbom_extra_component');
  const r=input.installReceipt.payload; const {receiptDigest,...receiptMaterial}=r; if(receiptDigest!==sha256(receiptMaterial)) throw new Error('offline_install_receipt_digest_invalid');
  if(r.manifestDigest!==m.manifestDigest||r.command!=='npm ci --offline'||r.cacheInitiallyEmpty!==true||r.networkRequestsObserved!==0||r.exitCode!==0||r.buildExitCode!==0) throw new Error('offline_install_receipt_contract_invalid');
  const installed=sortedUniqueNames(r.installedPackages,'offline_install_duplicate_package'); if(installed.length!==entries.length||installed.some((x,i)=>x.name!==entries[i]!.name||x.version!==entries[i]!.version)) throw new Error('offline_install_package_set_mismatch');
  const material={version:'33.42' as const,status:'LOCAL_HERMETIC_OFFLINE_INSTALL_PROVEN' as const,manifestDigest:m.manifestDigest,receiptDigest:r.receiptDigest,dependencyCount:entries.length,npmCiOfflineProven:true as const,lockfileBound:true as const,sbomBound:true as const,provenanceBound:true as const,externalDependencyRegistryObserved:false as const,externalHumanParticipants:0 as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const,verifiedAt:input.verifiedAt.toISOString()};
  return {...material,verdictDigest:sha256(material)};
}
