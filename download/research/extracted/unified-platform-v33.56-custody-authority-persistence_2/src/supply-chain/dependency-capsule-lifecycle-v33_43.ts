import { KeyRegistry, sha256, sha256Bytes, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import { sha512IntegrityV33_42, type DependencyCapsuleEntryV33_42, type HermeticDependencyQualificationVerdictV33_42 } from './hermetic-dependency-capsule-v33_42.js';

export type LifecycleExecutionClassV33_43 = 'LOCAL_DEPENDENCY_CAPSULE_LIFECYCLE_REHEARSAL';

export interface TarballProvenancePayloadV33_43 {
  readonly version: '33.43';
  readonly statementId: string;
  readonly sequence: number;
  readonly predecessorStatementDigest: string | null;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly tarballPath: string;
  readonly tarballSha256: string;
  readonly sourceAuthorityOrganization: string;
  readonly sourceEvidenceDigest: string;
  readonly acquiredAt: string;
  readonly statementDigest: string;
}

export interface VulnerabilityIntelAdvisoryPayloadV33_43 {
  readonly version: '33.43';
  readonly feedId: string;
  readonly sequence: number;
  readonly predecessorAdvisoryDigest: string | null;
  readonly advisoryId: string;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly action: 'REVOKE_PROVENANCE';
  readonly affectedProvenanceDigests: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly advisoryDigest: string;
}

export interface LifecycleCapsuleEntryV33_43 extends DependencyCapsuleEntryV33_42 {
  readonly provenanceStatementDigest: string;
}

export interface LifecycleCapsuleManifestPayloadV33_43 {
  readonly version: '33.43';
  readonly capsuleId: string;
  readonly sequence: number;
  readonly predecessorManifestDigest: string;
  readonly rollbackManifestDigest: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageJsonDigest: string;
  readonly packageLockDigest: string;
  readonly entries: readonly LifecycleCapsuleEntryV33_43[];
  readonly executionClass: LifecycleExecutionClassV33_43;
  readonly generatedAt: string;
  readonly manifestDigest: string;
}

export interface RevocationVotePayloadV33_43 {
  readonly version: '33.43';
  readonly revokedManifestDigest: string;
  readonly advisoryDigest: string;
  readonly organization: string;
  readonly decision: 'REVOKE';
  readonly votedAt: string;
  readonly voteDigest: string;
}

export interface CapsuleRevocationCertificatePayloadV33_43 {
  readonly version: '33.43';
  readonly sequence: number;
  readonly predecessorRevocationDigest: string | null;
  readonly revokedManifestDigest: string;
  readonly advisoryDigest: string;
  readonly voteDigests: readonly string[];
  readonly effectiveAt: string;
  readonly reason: 'PROVENANCE_AUTHORITY_COMPROMISE';
  readonly certificateDigest: string;
}

export interface CapsuleRollbackCertificatePayloadV33_43 {
  readonly version: '33.43';
  readonly fromManifestDigest: string;
  readonly toManifestDigest: string;
  readonly revocationCertificateDigest: string;
  readonly baseVerdictDigest: string;
  readonly rolledBackAt: string;
  readonly certificateDigest: string;
}

export interface LifecycleInstallReceiptPayloadV33_43 {
  readonly version: '33.43';
  readonly manifestDigest: string;
  readonly command: 'npm ci --offline';
  readonly cacheInitiallyEmpty: true;
  readonly networkRequestsObserved: 0;
  readonly exitCode: 0;
  readonly installedPackages: readonly { readonly name: string; readonly version: string }[];
  readonly nodeModulesTreeDigest: string;
  readonly installLogDigest: string;
  readonly installedAt: string;
  readonly receiptDigest: string;
}

export interface DependencyCapsuleLifecycleVerdictV33_43 {
  readonly version: '33.43';
  readonly status: 'LOCAL_DEPENDENCY_CAPSULE_LIFECYCLE_PROVEN';
  readonly baseManifestDigest: string;
  readonly revokedManifestDigest: string;
  readonly rollbackManifestDigest: string;
  readonly activeManifestDigest: string;
  readonly vulnerabilityAdvisoryDigest: string;
  readonly revocationCertificateDigest: string;
  readonly rollbackCertificateDigest: string;
  readonly replacementInstallReceiptDigest: string;
  readonly packageCount: number;
  readonly provenanceRebound: true;
  readonly rollbackProven: true;
  readonly replacementOfflineInstallProven: true;
  readonly vulnerabilityIntelligenceExternalObserved: false;
  readonly externalHumanParticipants: 0;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verifiedAt: string;
  readonly verdictDigest: string;
}

export interface DependencyCapsuleLifecycleTrustV33_43 {
  readonly provenanceRegistry: KeyRegistry;
  readonly trustedProvenanceSignerIds: readonly string[];
  readonly advisoryRegistry: KeyRegistry;
  readonly trustedAdvisorySignerIds: readonly string[];
  readonly manifestRegistry: KeyRegistry;
  readonly trustedManifestSignerIds: readonly string[];
  readonly revocationVoteRegistry: KeyRegistry;
  readonly trustedRevocationVoterIds: readonly string[];
  readonly revocationCertificateRegistry: KeyRegistry;
  readonly trustedRevocationCertificateSignerIds: readonly string[];
  readonly rollbackRegistry: KeyRegistry;
  readonly trustedRollbackSignerIds: readonly string[];
  readonly installReceiptRegistry: KeyRegistry;
  readonly trustedInstallReceiptSignerIds: readonly string[];
}

function nonEmpty(value: string, error: string): void { if (value.trim() === '') throw new Error(error); }
function hex64(value: string, error: string): void { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(error); }
function iso(value: string, error: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(error); return parsed; }
function safeTarballPath(value: string): void {
  if (!value.startsWith('vendor/dependency-capsule/tarballs/') || value.includes('..') || value.includes('\\') || !value.endsWith('.tgz')) throw new Error('lifecycle_tarball_path_invalid');
}
function sortedUniqueStrings(rows: readonly string[], error: string): string[] {
  const sorted = [...rows].sort(); if (new Set(sorted).size !== sorted.length) throw new Error(error); return sorted;
}
function sortedUniqueByName<T extends { readonly name: string }>(rows: readonly T[], error: string): T[] {
  const sorted = [...rows].sort((a,b)=>a.name.localeCompare(b.name)); if (new Set(sorted.map(x=>x.name)).size !== sorted.length) throw new Error(error); return sorted;
}
function verifyEnvelope<T>(envelope: SignedEnvelope<T>, registry: KeyRegistry, trustedIds: readonly string[], at: Date, error: string): void {
  if (!trustedIds.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error(error);
}
function digestWithout<T extends Record<string, unknown>>(payload: T, digestField: keyof T): string {
  const material = { ...payload }; delete material[digestField]; return sha256(material);
}
function assertDigestPayload<T extends Record<string, unknown>>(payload: T, digestField: keyof T, error: string): void {
  if (payload[digestField] !== digestWithout(payload, digestField)) throw new Error(error);
}

export function createSignedTarballProvenanceV33_43(input: {
  readonly signer: SigningIdentity;
  readonly statementId: string;
  readonly sequence: number;
  readonly predecessorStatementDigest: string | null;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly tarballPath: string;
  readonly tarballSha256: string;
  readonly sourceAuthorityOrganization: string;
  readonly sourceEvidenceDigest: string;
  readonly acquiredAt: Date;
}): SignedEnvelope<TarballProvenancePayloadV33_43> {
  for (const [value,error] of [[input.statementId,'provenance_statement_id_required'],[input.packageName,'provenance_package_name_required'],[input.packageVersion,'provenance_package_version_required'],[input.sourceAuthorityOrganization,'provenance_source_org_required']] as const) nonEmpty(value,error);
  if (!Number.isInteger(input.sequence) || input.sequence < 1) throw new Error('provenance_sequence_invalid');
  if (input.predecessorStatementDigest !== null) hex64(input.predecessorStatementDigest,'provenance_predecessor_invalid');
  safeTarballPath(input.tarballPath); hex64(input.tarballSha256,'provenance_tarball_digest_invalid'); hex64(input.sourceEvidenceDigest,'provenance_source_evidence_invalid');
  const material = { version:'33.43' as const, statementId:input.statementId, sequence:input.sequence, predecessorStatementDigest:input.predecessorStatementDigest, packageName:input.packageName, packageVersion:input.packageVersion, tarballPath:input.tarballPath, tarballSha256:input.tarballSha256, sourceAuthorityOrganization:input.sourceAuthorityOrganization, sourceEvidenceDigest:input.sourceEvidenceDigest, acquiredAt:input.acquiredAt.toISOString() };
  return signEnvelope({ ...material, statementDigest:sha256(material) }, input.signer);
}

export function createSignedVulnerabilityAdvisoryV33_43(input: {
  readonly signer: SigningIdentity;
  readonly feedId: string;
  readonly sequence: number;
  readonly predecessorAdvisoryDigest: string | null;
  readonly advisoryId: string;
  readonly severity: VulnerabilityIntelAdvisoryPayloadV33_43['severity'];
  readonly affectedProvenanceDigests: readonly string[];
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<VulnerabilityIntelAdvisoryPayloadV33_43> {
  nonEmpty(input.feedId,'vulnerability_feed_id_required'); nonEmpty(input.advisoryId,'vulnerability_advisory_id_required');
  if (!Number.isInteger(input.sequence) || input.sequence < 1) throw new Error('vulnerability_sequence_invalid');
  if ((input.sequence === 1) !== (input.predecessorAdvisoryDigest === null)) throw new Error('vulnerability_predecessor_sequence_mismatch');
  if (input.predecessorAdvisoryDigest !== null) hex64(input.predecessorAdvisoryDigest,'vulnerability_predecessor_invalid');
  const affectedProvenanceDigests = sortedUniqueStrings(input.affectedProvenanceDigests,'vulnerability_duplicate_target'); if (affectedProvenanceDigests.length === 0) throw new Error('vulnerability_target_required'); for (const d of affectedProvenanceDigests) hex64(d,'vulnerability_target_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('vulnerability_window_invalid');
  const material = { version:'33.43' as const, feedId:input.feedId, sequence:input.sequence, predecessorAdvisoryDigest:input.predecessorAdvisoryDigest, advisoryId:input.advisoryId, severity:input.severity, action:'REVOKE_PROVENANCE' as const, affectedProvenanceDigests, issuedAt:input.issuedAt.toISOString(), expiresAt:input.expiresAt.toISOString() };
  return signEnvelope({ ...material, advisoryDigest:sha256(material) }, input.signer);
}

export function createSignedLifecycleCapsuleManifestV33_43(input: {
  readonly signer: SigningIdentity;
  readonly capsuleId: string;
  readonly sequence: number;
  readonly predecessorManifestDigest: string;
  readonly rollbackManifestDigest: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageJsonBytes: Uint8Array;
  readonly packageLockBytes: Uint8Array;
  readonly entries: readonly LifecycleCapsuleEntryV33_43[];
  readonly generatedAt: Date;
}): SignedEnvelope<LifecycleCapsuleManifestPayloadV33_43> {
  nonEmpty(input.capsuleId,'lifecycle_capsule_id_required'); nonEmpty(input.packageName,'lifecycle_package_name_required'); nonEmpty(input.packageVersion,'lifecycle_package_version_required');
  if (!Number.isInteger(input.sequence) || input.sequence < 2) throw new Error('lifecycle_manifest_sequence_invalid');
  hex64(input.predecessorManifestDigest,'lifecycle_manifest_predecessor_invalid'); hex64(input.rollbackManifestDigest,'lifecycle_manifest_rollback_invalid');
  const entries = sortedUniqueByName(input.entries,'lifecycle_duplicate_entry'); if (entries.length === 0) throw new Error('lifecycle_entry_required');
  for (const e of entries) { nonEmpty(e.name,'lifecycle_entry_name_required'); nonEmpty(e.version,'lifecycle_entry_version_required'); safeTarballPath(e.tarballPath); hex64(e.tarballSha256,'lifecycle_entry_tarball_digest_invalid'); hex64(e.packageJsonSha256,'lifecycle_entry_package_json_digest_invalid'); hex64(e.sourcePathDigest,'lifecycle_entry_source_path_invalid'); hex64(e.contentTreeDigest,'lifecycle_entry_tree_digest_invalid'); hex64(e.provenanceStatementDigest,'lifecycle_entry_provenance_invalid'); }
  const material = { version:'33.43' as const, capsuleId:input.capsuleId, sequence:input.sequence, predecessorManifestDigest:input.predecessorManifestDigest, rollbackManifestDigest:input.rollbackManifestDigest, packageName:input.packageName, packageVersion:input.packageVersion, packageJsonDigest:sha256Bytes(input.packageJsonBytes), packageLockDigest:sha256Bytes(input.packageLockBytes), entries, executionClass:'LOCAL_DEPENDENCY_CAPSULE_LIFECYCLE_REHEARSAL' as const, generatedAt:input.generatedAt.toISOString() };
  return signEnvelope({ ...material, manifestDigest:sha256(material) }, input.signer);
}

export function createSignedRevocationVoteV33_43(input: { readonly signer: SigningIdentity; readonly revokedManifestDigest:string; readonly advisoryDigest:string; readonly organization:string; readonly votedAt:Date }): SignedEnvelope<RevocationVotePayloadV33_43> {
  hex64(input.revokedManifestDigest,'revocation_vote_manifest_invalid'); hex64(input.advisoryDigest,'revocation_vote_advisory_invalid'); nonEmpty(input.organization,'revocation_vote_org_required');
  const material={version:'33.43' as const,revokedManifestDigest:input.revokedManifestDigest,advisoryDigest:input.advisoryDigest,organization:input.organization,decision:'REVOKE' as const,votedAt:input.votedAt.toISOString()};
  return signEnvelope({...material,voteDigest:sha256(material)},input.signer);
}

export function createSignedRevocationCertificateV33_43(input:{ readonly signer:SigningIdentity; readonly sequence:number; readonly predecessorRevocationDigest:string|null; readonly revokedManifestDigest:string; readonly advisoryDigest:string; readonly voteDigests:readonly string[]; readonly effectiveAt:Date }):SignedEnvelope<CapsuleRevocationCertificatePayloadV33_43>{
  if(!Number.isInteger(input.sequence)||input.sequence<1)throw new Error('revocation_certificate_sequence_invalid'); if((input.sequence===1)!==(input.predecessorRevocationDigest===null))throw new Error('revocation_certificate_predecessor_mismatch'); if(input.predecessorRevocationDigest!==null)hex64(input.predecessorRevocationDigest,'revocation_certificate_predecessor_invalid'); hex64(input.revokedManifestDigest,'revocation_certificate_manifest_invalid'); hex64(input.advisoryDigest,'revocation_certificate_advisory_invalid'); const voteDigests=sortedUniqueStrings(input.voteDigests,'revocation_certificate_duplicate_vote'); if(voteDigests.length<2)throw new Error('revocation_certificate_quorum_insufficient'); for(const d of voteDigests)hex64(d,'revocation_certificate_vote_invalid');
  const material={version:'33.43' as const,sequence:input.sequence,predecessorRevocationDigest:input.predecessorRevocationDigest,revokedManifestDigest:input.revokedManifestDigest,advisoryDigest:input.advisoryDigest,voteDigests,effectiveAt:input.effectiveAt.toISOString(),reason:'PROVENANCE_AUTHORITY_COMPROMISE' as const}; return signEnvelope({...material,certificateDigest:sha256(material)},input.signer);
}

export function createSignedRollbackCertificateV33_43(input:{readonly signer:SigningIdentity;readonly fromManifestDigest:string;readonly toManifestDigest:string;readonly revocationCertificateDigest:string;readonly baseVerdictDigest:string;readonly rolledBackAt:Date}):SignedEnvelope<CapsuleRollbackCertificatePayloadV33_43>{
  for(const [v,e] of [[input.fromManifestDigest,'rollback_from_invalid'],[input.toManifestDigest,'rollback_to_invalid'],[input.revocationCertificateDigest,'rollback_revocation_invalid'],[input.baseVerdictDigest,'rollback_base_verdict_invalid']] as const)hex64(v,e);
  if(input.fromManifestDigest===input.toManifestDigest)throw new Error('rollback_same_manifest_invalid'); const material={version:'33.43' as const,fromManifestDigest:input.fromManifestDigest,toManifestDigest:input.toManifestDigest,revocationCertificateDigest:input.revocationCertificateDigest,baseVerdictDigest:input.baseVerdictDigest,rolledBackAt:input.rolledBackAt.toISOString()}; return signEnvelope({...material,certificateDigest:sha256(material)},input.signer);
}

export function createLifecycleInstallReceiptV33_43(input:{readonly signer:SigningIdentity;readonly manifestDigest:string;readonly installedPackages:readonly {readonly name:string;readonly version:string}[];readonly nodeModulesTreeDigest:string;readonly installLogDigest:string;readonly installedAt:Date}):SignedEnvelope<LifecycleInstallReceiptPayloadV33_43>{
  hex64(input.manifestDigest,'lifecycle_install_manifest_invalid'); hex64(input.nodeModulesTreeDigest,'lifecycle_install_tree_invalid'); hex64(input.installLogDigest,'lifecycle_install_log_invalid'); const installedPackages=sortedUniqueByName(input.installedPackages,'lifecycle_install_duplicate_package'); if(installedPackages.length===0)throw new Error('lifecycle_install_package_required');
  const material={version:'33.43' as const,manifestDigest:input.manifestDigest,command:'npm ci --offline' as const,cacheInitiallyEmpty:true as const,networkRequestsObserved:0 as const,exitCode:0 as const,installedPackages,nodeModulesTreeDigest:input.nodeModulesTreeDigest,installLogDigest:input.installLogDigest,installedAt:input.installedAt.toISOString()}; return signEnvelope({...material,receiptDigest:sha256(material)},input.signer);
}

function lockPackages(lock: unknown): Map<string, Record<string,unknown>> {
  if (typeof lock !== 'object' || lock === null) throw new Error('lifecycle_lockfile_invalid'); const row=lock as {lockfileVersion?:unknown,packages?:unknown}; if(row.lockfileVersion!==3||typeof row.packages!=='object'||row.packages===null)throw new Error('lifecycle_lockfile_invalid'); const out=new Map<string,Record<string,unknown>>(); for(const [path,value] of Object.entries(row.packages)){if(path==='')continue;if(typeof value!=='object'||value===null)throw new Error('lifecycle_lockfile_entry_invalid');out.set(path.replace(/^node_modules\//,''),value as Record<string,unknown>);}return out;
}

function verifyBaseVerdict(verdict:HermeticDependencyQualificationVerdictV33_42):void{
  if(verdict.version!=='33.42'||verdict.status!=='LOCAL_HERMETIC_OFFLINE_INSTALL_PROVEN'||verdict.npmCiOfflineProven!==true||verdict.productionAuthority!=='NONE'||verdict.externalEffectsExecuted!==0)throw new Error('lifecycle_base_verdict_invalid'); assertDigestPayload(verdict as unknown as Record<string,unknown>,'verdictDigest','lifecycle_base_verdict_digest_invalid');
}

function verifyProvenanceSet(input:{readonly statements:readonly SignedEnvelope<TarballProvenancePayloadV33_43>[];readonly entries:readonly LifecycleCapsuleEntryV33_43[];readonly tarballBytesByPath:ReadonlyMap<string,Uint8Array>;readonly trust:DependencyCapsuleLifecycleTrustV33_43;readonly verifiedAt:Date;readonly errorPrefix:string}):Map<string,TarballProvenancePayloadV33_43>{
  if(input.statements.length!==input.entries.length)throw new Error(`${input.errorPrefix}_provenance_count_mismatch`); const byDigest=new Map<string,TarballProvenancePayloadV33_43>(); const byPackage=new Map<string,TarballProvenancePayloadV33_43>();
  for(const envelope of input.statements){verifyEnvelope(envelope,input.trust.provenanceRegistry,input.trust.trustedProvenanceSignerIds,input.verifiedAt,`${input.errorPrefix}_provenance_signature_invalid`);const p=envelope.payload;if(p.version!=='33.43')throw new Error(`${input.errorPrefix}_provenance_version_invalid`);assertDigestPayload(p as unknown as Record<string,unknown>,'statementDigest',`${input.errorPrefix}_provenance_digest_invalid`);if(byDigest.has(p.statementDigest)||byPackage.has(p.packageName))throw new Error(`${input.errorPrefix}_provenance_duplicate`);if(iso(p.acquiredAt,`${input.errorPrefix}_provenance_time_invalid`)>input.verifiedAt.getTime())throw new Error(`${input.errorPrefix}_provenance_future`);byDigest.set(p.statementDigest,p);byPackage.set(p.packageName,p);}
  for(const e of input.entries){const p=byDigest.get(e.provenanceStatementDigest);if(!p||p.packageName!==e.name||p.packageVersion!==e.version||p.tarballPath!==e.tarballPath||p.tarballSha256!==e.tarballSha256)throw new Error(`${input.errorPrefix}_provenance_entry_mismatch`);const bytes=input.tarballBytesByPath.get(e.tarballPath);if(!bytes||sha256Bytes(bytes)!==e.tarballSha256||sha512IntegrityV33_42(bytes)!==e.tarballIntegrity)throw new Error(`${input.errorPrefix}_tarball_digest_mismatch`);}
  return byPackage;
}

function verifyCandidateProject(input:{readonly manifest:LifecycleCapsuleManifestPayloadV33_43;readonly packageJsonBytes:Uint8Array;readonly packageLockBytes:Uint8Array}):void{
  if(input.manifest.packageJsonDigest!==sha256Bytes(input.packageJsonBytes)||input.manifest.packageLockDigest!==sha256Bytes(input.packageLockBytes))throw new Error('lifecycle_candidate_project_digest_mismatch'); const text=Buffer.from(input.packageLockBytes).toString('utf8'); if(/https?:\/\//i.test(text))throw new Error('lifecycle_remote_lock_resolution_forbidden'); const pkg=JSON.parse(Buffer.from(input.packageJsonBytes).toString('utf8')); const lock=JSON.parse(text); if(pkg.name!==input.manifest.packageName||pkg.version!==input.manifest.packageVersion)throw new Error('lifecycle_candidate_identity_mismatch'); const locked=lockPackages(lock); if(locked.size!==input.manifest.entries.length)throw new Error('lifecycle_candidate_lock_count_mismatch'); for(const e of input.manifest.entries){const row=locked.get(e.name);if(!row||row.version!==e.version||row.resolved!==`file:${e.tarballPath}`||row.integrity!==e.tarballIntegrity)throw new Error('lifecycle_candidate_lock_entry_mismatch');if(pkg.devDependencies?.[e.name]!==`file:${e.tarballPath}`)throw new Error('lifecycle_candidate_package_json_mismatch');}
}

export function verifyDependencyCapsuleLifecycleV33_43(input:{
  readonly baseVerdict:HermeticDependencyQualificationVerdictV33_42;
  readonly baseManifestDigest:string;
  readonly candidateA:SignedEnvelope<LifecycleCapsuleManifestPayloadV33_43>;
  readonly candidateB:SignedEnvelope<LifecycleCapsuleManifestPayloadV33_43>;
  readonly candidateAProvenance:readonly SignedEnvelope<TarballProvenancePayloadV33_43>[];
  readonly candidateBProvenance:readonly SignedEnvelope<TarballProvenancePayloadV33_43>[];
  readonly vulnerabilityAdvisory:SignedEnvelope<VulnerabilityIntelAdvisoryPayloadV33_43>;
  readonly revocationVotes:readonly SignedEnvelope<RevocationVotePayloadV33_43>[];
  readonly revocationCertificate:SignedEnvelope<CapsuleRevocationCertificatePayloadV33_43>;
  readonly rollbackCertificate:SignedEnvelope<CapsuleRollbackCertificatePayloadV33_43>;
  readonly candidateBPackageJsonBytes:Uint8Array;
  readonly candidateBPackageLockBytes:Uint8Array;
  readonly tarballBytesByPath:ReadonlyMap<string,Uint8Array>;
  readonly replacementInstallReceipt:SignedEnvelope<LifecycleInstallReceiptPayloadV33_43>;
  readonly trust:DependencyCapsuleLifecycleTrustV33_43;
  readonly verifiedAt:Date;
}):DependencyCapsuleLifecycleVerdictV33_43{
  verifyBaseVerdict(input.baseVerdict); hex64(input.baseManifestDigest,'lifecycle_base_manifest_invalid');
  verifyEnvelope(input.candidateA,input.trust.manifestRegistry,input.trust.trustedManifestSignerIds,input.verifiedAt,'lifecycle_candidate_a_signature_invalid'); verifyEnvelope(input.candidateB,input.trust.manifestRegistry,input.trust.trustedManifestSignerIds,input.verifiedAt,'lifecycle_candidate_b_signature_invalid');
  const a=input.candidateA.payload,b=input.candidateB.payload; assertDigestPayload(a as unknown as Record<string,unknown>,'manifestDigest','lifecycle_candidate_a_digest_invalid'); assertDigestPayload(b as unknown as Record<string,unknown>,'manifestDigest','lifecycle_candidate_b_digest_invalid');
  if(a.version!=='33.43'||b.version!=='33.43'||a.executionClass!=='LOCAL_DEPENDENCY_CAPSULE_LIFECYCLE_REHEARSAL'||b.executionClass!=='LOCAL_DEPENDENCY_CAPSULE_LIFECYCLE_REHEARSAL')throw new Error('lifecycle_candidate_version_invalid');
  if(a.sequence!==2||a.predecessorManifestDigest!==input.baseManifestDigest||a.rollbackManifestDigest!==input.baseManifestDigest)throw new Error('lifecycle_candidate_a_sequence_invalid');
  if(b.sequence!==3||b.predecessorManifestDigest!==a.manifestDigest||b.rollbackManifestDigest!==input.baseManifestDigest)throw new Error('lifecycle_candidate_b_sequence_invalid');
  if(iso(a.generatedAt,'lifecycle_candidate_a_time_invalid')>=iso(b.generatedAt,'lifecycle_candidate_b_time_invalid'))throw new Error('lifecycle_candidate_time_order_invalid');
  const aEntries=sortedUniqueByName(a.entries,'lifecycle_candidate_a_duplicate_entry'); const bEntries=sortedUniqueByName(b.entries,'lifecycle_candidate_b_duplicate_entry'); if(aEntries.length!==bEntries.length||aEntries.some((x,i)=>x.name!==bEntries[i]!.name||x.version!==bEntries[i]!.version||x.tarballSha256!==bEntries[i]!.tarballSha256))throw new Error('lifecycle_replacement_package_set_mismatch');
  const aProv=verifyProvenanceSet({statements:input.candidateAProvenance,entries:aEntries,tarballBytesByPath:input.tarballBytesByPath,trust:input.trust,verifiedAt:input.verifiedAt,errorPrefix:'candidate_a'}); const bProv=verifyProvenanceSet({statements:input.candidateBProvenance,entries:bEntries,tarballBytesByPath:input.tarballBytesByPath,trust:input.trust,verifiedAt:input.verifiedAt,errorPrefix:'candidate_b'});
  for(const [name,p] of aProv){const q=bProv.get(name);if(!q||q.sourceAuthorityOrganization===p.sourceAuthorityOrganization||q.statementDigest===p.statementDigest)throw new Error('lifecycle_provenance_rebind_not_independent');}
  verifyEnvelope(input.vulnerabilityAdvisory,input.trust.advisoryRegistry,input.trust.trustedAdvisorySignerIds,input.verifiedAt,'lifecycle_advisory_signature_invalid'); const advisory=input.vulnerabilityAdvisory.payload; assertDigestPayload(advisory as unknown as Record<string,unknown>,'advisoryDigest','lifecycle_advisory_digest_invalid'); if(advisory.sequence!==1||advisory.predecessorAdvisoryDigest!==null||advisory.action!=='REVOKE_PROVENANCE'||advisory.severity!=='CRITICAL')throw new Error('lifecycle_advisory_contract_invalid'); const verifiedMs=input.verifiedAt.getTime(); if(iso(advisory.issuedAt,'lifecycle_advisory_issue_time_invalid')>verifiedMs||iso(advisory.expiresAt,'lifecycle_advisory_expiry_invalid')<verifiedMs)throw new Error('lifecycle_advisory_not_current'); const affected=new Set(advisory.affectedProvenanceDigests); if(affected.size!==aEntries.length||aEntries.some(e=>!affected.has(e.provenanceStatementDigest))||bEntries.some(e=>affected.has(e.provenanceStatementDigest)))throw new Error('lifecycle_advisory_target_set_invalid');
  if(input.revocationVotes.length<2)throw new Error('lifecycle_revocation_quorum_insufficient'); const voteDigests:string[]=[]; const voteIssuers=new Set<string>(); const voteOrgs=new Set<string>(); for(const vote of input.revocationVotes){verifyEnvelope(vote,input.trust.revocationVoteRegistry,input.trust.trustedRevocationVoterIds,input.verifiedAt,'lifecycle_revocation_vote_signature_invalid');const p=vote.payload;assertDigestPayload(p as unknown as Record<string,unknown>,'voteDigest','lifecycle_revocation_vote_digest_invalid');if(p.revokedManifestDigest!==a.manifestDigest||p.advisoryDigest!==advisory.advisoryDigest||p.decision!=='REVOKE')throw new Error('lifecycle_revocation_vote_contract_invalid');if(voteIssuers.has(vote.issuerKeyId)||voteOrgs.has(p.organization))throw new Error('lifecycle_revocation_vote_not_independent');voteIssuers.add(vote.issuerKeyId);voteOrgs.add(p.organization);voteDigests.push(p.voteDigest);} if(voteIssuers.size<2||voteOrgs.size<2)throw new Error('lifecycle_revocation_quorum_insufficient');
  verifyEnvelope(input.revocationCertificate,input.trust.revocationCertificateRegistry,input.trust.trustedRevocationCertificateSignerIds,input.verifiedAt,'lifecycle_revocation_certificate_signature_invalid'); const rev=input.revocationCertificate.payload; assertDigestPayload(rev as unknown as Record<string,unknown>,'certificateDigest','lifecycle_revocation_certificate_digest_invalid'); if(rev.sequence!==1||rev.predecessorRevocationDigest!==null||rev.revokedManifestDigest!==a.manifestDigest||rev.advisoryDigest!==advisory.advisoryDigest||JSON.stringify(rev.voteDigests)!==JSON.stringify(sortedUniqueStrings(voteDigests,'lifecycle_revocation_duplicate_vote')))throw new Error('lifecycle_revocation_certificate_contract_invalid'); if(iso(rev.effectiveAt,'lifecycle_revocation_effective_time_invalid')<iso(advisory.issuedAt,'lifecycle_advisory_issue_time_invalid'))throw new Error('lifecycle_revocation_before_advisory');
  verifyEnvelope(input.rollbackCertificate,input.trust.rollbackRegistry,input.trust.trustedRollbackSignerIds,input.verifiedAt,'lifecycle_rollback_signature_invalid'); const rollback=input.rollbackCertificate.payload; assertDigestPayload(rollback as unknown as Record<string,unknown>,'certificateDigest','lifecycle_rollback_digest_invalid'); if(rollback.fromManifestDigest!==a.manifestDigest||rollback.toManifestDigest!==input.baseManifestDigest||rollback.revocationCertificateDigest!==rev.certificateDigest||rollback.baseVerdictDigest!==input.baseVerdict.verdictDigest)throw new Error('lifecycle_rollback_contract_invalid'); if(iso(rollback.rolledBackAt,'lifecycle_rollback_time_invalid')<iso(rev.effectiveAt,'lifecycle_revocation_effective_time_invalid')||iso(rollback.rolledBackAt,'lifecycle_rollback_time_invalid')>=iso(b.generatedAt,'lifecycle_candidate_b_time_invalid'))throw new Error('lifecycle_rollback_time_order_invalid');
  verifyCandidateProject({manifest:b,packageJsonBytes:input.candidateBPackageJsonBytes,packageLockBytes:input.candidateBPackageLockBytes});
  verifyEnvelope(input.replacementInstallReceipt,input.trust.installReceiptRegistry,input.trust.trustedInstallReceiptSignerIds,input.verifiedAt,'lifecycle_install_receipt_signature_invalid'); const receipt=input.replacementInstallReceipt.payload; assertDigestPayload(receipt as unknown as Record<string,unknown>,'receiptDigest','lifecycle_install_receipt_digest_invalid'); if(receipt.manifestDigest!==b.manifestDigest||receipt.command!=='npm ci --offline'||receipt.cacheInitiallyEmpty!==true||receipt.networkRequestsObserved!==0||receipt.exitCode!==0)throw new Error('lifecycle_install_receipt_contract_invalid'); const installed=sortedUniqueByName(receipt.installedPackages,'lifecycle_install_duplicate_package'); if(installed.length!==bEntries.length||installed.some((x,i)=>x.name!==bEntries[i]!.name||x.version!==bEntries[i]!.version))throw new Error('lifecycle_install_package_set_mismatch'); if(iso(receipt.installedAt,'lifecycle_install_time_invalid')<iso(b.generatedAt,'lifecycle_candidate_b_time_invalid'))throw new Error('lifecycle_install_before_manifest');
  const material={version:'33.43' as const,status:'LOCAL_DEPENDENCY_CAPSULE_LIFECYCLE_PROVEN' as const,baseManifestDigest:input.baseManifestDigest,revokedManifestDigest:a.manifestDigest,rollbackManifestDigest:input.baseManifestDigest,activeManifestDigest:b.manifestDigest,vulnerabilityAdvisoryDigest:advisory.advisoryDigest,revocationCertificateDigest:rev.certificateDigest,rollbackCertificateDigest:rollback.certificateDigest,replacementInstallReceiptDigest:receipt.receiptDigest,packageCount:bEntries.length,provenanceRebound:true as const,rollbackProven:true as const,replacementOfflineInstallProven:true as const,vulnerabilityIntelligenceExternalObserved:false as const,externalHumanParticipants:0 as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const,verifiedAt:input.verifiedAt.toISOString()}; return {...material,verdictDigest:sha256(material)};
}
