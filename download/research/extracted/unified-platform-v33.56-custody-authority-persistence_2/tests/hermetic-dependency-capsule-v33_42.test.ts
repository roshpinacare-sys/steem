import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyRegistry, generateSigningIdentity, sha256, sha256Bytes, signEnvelope } from '../src/contracts/crypto.js';
import {
  createDependencySbomV33_42,
  createOfflineInstallReceiptV33_42,
  createSignedDependencyCapsuleManifestV33_42,
  createToolchainProvenanceV33_42,
  sha512IntegrityV33_42,
  verifyHermeticDependencyQualificationV33_42,
  type DependencyCapsuleEntryV33_42,
} from '../src/supply-chain/hermetic-dependency-capsule-v33_42.js';

const now = new Date('2026-07-23T12:00:00.000Z');
function registry(ids: ReturnType<typeof generateSigningIdentity>[]) { const r=new KeyRegistry(); for(const id of ids) r.register(id.keyId,id.publicKey); return r; }
function treeDigest(name:string,version:string){ return sha256({name,version,files:['package.json','index.d.ts']}); }
function setup(){
  const manifestSigner=generateSigningIdentity('dependency-capsule-signer');
  const receiptSigner=generateSigningIdentity('offline-install-runner');
  const specs=[
    {name:'@types/node',version:'22.19.7',file:'types-node-22.19.7.tgz'},
    {name:'typescript',version:'5.8.3',file:'typescript-5.8.3.tgz'},
    {name:'undici-types',version:'6.21.0',file:'undici-types-6.21.0.tgz'},
  ];
  const tarballBytesByPath=new Map<string,Uint8Array>(); const packageJsonByTarballPath=new Map<string,Uint8Array>(); const contentTreeDigestByTarballPath=new Map<string,string>();
  const entries:DependencyCapsuleEntryV33_42[]=specs.map(s=>{
    const path=`vendor/dependency-capsule/tarballs/${s.file}`; const bytes=Buffer.from(`tarball:${s.name}@${s.version}`); const pj=Buffer.from(JSON.stringify({name:s.name,version:s.version}));
    tarballBytesByPath.set(path,bytes); packageJsonByTarballPath.set(path,pj); contentTreeDigestByTarballPath.set(path,treeDigest(s.name,s.version));
    return {name:s.name,version:s.version,tarballPath:path,tarballSha256:sha256Bytes(bytes),tarballIntegrity:sha512IntegrityV33_42(bytes),packageJsonSha256:sha256Bytes(pj),sourceClass:'REPACKED_FROM_PREINSTALLED_EXACT_VERSION',sourcePathDigest:sha256({source:`/installed/${s.name}/${s.version}`}),contentTreeDigest:treeDigest(s.name,s.version)};
  });
  const devDependencies=Object.fromEntries(entries.map(e=>[e.name,`file:${e.tarballPath}`]));
  const packageJsonBytes=Buffer.from(JSON.stringify({name:'@sovereign-foundry/canonical-proof',version:'0.32.0',devDependencies}));
  const packages:any={'':{name:'@sovereign-foundry/canonical-proof',version:'0.32.0',devDependencies}};
  for(const e of entries) packages[`node_modules/${e.name}`]={version:e.version,resolved:`file:${e.tarballPath}`,integrity:e.tarballIntegrity};
  const packageLockBytes=Buffer.from(JSON.stringify({name:'@sovereign-foundry/canonical-proof',version:'0.32.0',lockfileVersion:3,requires:true,packages}));
  const sbom=createDependencySbomV33_42({version:'33.42',format:'CYCLONEDX_LITE_1_5',serialNumber:'urn:uuid:v33.42-test',components:entries.map(e=>({name:e.name,version:e.version,purl:`pkg:npm/${encodeURIComponent(e.name)}@${e.version}`,integrity:e.tarballIntegrity,tarballSha256:e.tarballSha256,scope:'development'})),generatedAt:now.toISOString()});
  const toolchain=createToolchainProvenanceV33_42({version:'33.42',nodeVersion:'v22.16.0',npmVersion:'10.9.2',typescriptVersion:'5.8.3',platform:'linux',architecture:'x64',sourceClass:'PREINSTALLED_TOOLCHAIN_REPACK_SOURCE',generatedAt:now.toISOString()});
  const manifest=createSignedDependencyCapsuleManifestV33_42({signer:manifestSigner,packageName:'@sovereign-foundry/canonical-proof',packageVersion:'0.32.0',packageJsonBytes,packageLockBytes,entries,sbom,toolchain,generatedAt:now});
  const receipt=createOfflineInstallReceiptV33_42({signer:receiptSigner,manifestDigest:manifest.payload.manifestDigest,installedPackages:entries.map(e=>({name:e.name,version:e.version})),nodeModulesTreeDigest:sha256({installed:entries.map(e=>[e.name,e.version])}),installLogDigest:sha256({log:'npm ci --offline passed'}),installedAt:now.toISOString()});
  const trust={manifestSignerRegistry:registry([manifestSigner]),trustedManifestSignerIds:[manifestSigner.keyId],receiptSignerRegistry:registry([receiptSigner]),trustedReceiptSignerIds:[receiptSigner.keyId]};
  const args={manifest,sbom,toolchain,packageJsonBytes,packageLockBytes,tarballBytesByPath,packageJsonByTarballPath,contentTreeDigestByTarballPath,installReceipt:receipt,trust,verifiedAt:now};
  return {...args,entries,manifestSigner,receiptSigner};
}
function clone<T>(x:T):T{return structuredClone(x)}

test('v33.42 accepts exact hermetic capsule and offline install receipt',()=>{const x=setup(); const v=verifyHermeticDependencyQualificationV33_42(x); assert.equal(v.status,'LOCAL_HERMETIC_OFFLINE_INSTALL_PROVEN'); assert.equal(v.npmCiOfflineProven,true); assert.equal(v.productionAuthority,'NONE');});
test('v33.42 sorts SBOM components deterministically',()=>{const x=setup(); assert.deepEqual(x.sbom.components.map(c=>c.name),['@types/node','typescript','undici-types']);});
test('v33.42 rejects duplicate SBOM component',()=>{const x=setup(); assert.throws(()=>createDependencySbomV33_42({...x.sbom,sbomDigest:undefined as never,components:[x.sbom.components[0]!,x.sbom.components[0]!]} as any),/duplicate/);});
test('v33.42 rejects invalid SBOM purl',()=>{const x=setup(); assert.throws(()=>createDependencySbomV33_42({version:'33.42',format:'CYCLONEDX_LITE_1_5',serialNumber:'x',components:[{...x.sbom.components[0]!,purl:'bad'}],generatedAt:now.toISOString()}),/purl/);});
test('v33.42 rejects duplicate capsule entry',()=>{const x=setup(); assert.throws(()=>createSignedDependencyCapsuleManifestV33_42({signer:x.manifestSigner,packageName:'x',packageVersion:'1',packageJsonBytes:x.packageJsonBytes,packageLockBytes:x.packageLockBytes,entries:[x.entries[0]!,x.entries[0]!],sbom:x.sbom,toolchain:x.toolchain,generatedAt:now}),/duplicate/);});
test('v33.42 rejects path traversal',()=>{const x=setup(); assert.throws(()=>createSignedDependencyCapsuleManifestV33_42({signer:x.manifestSigner,packageName:'x',packageVersion:'1',packageJsonBytes:x.packageJsonBytes,packageLockBytes:x.packageLockBytes,entries:[{...x.entries[0]!,tarballPath:'vendor/dependency-capsule/tarballs/../evil.tgz'}],sbom:createDependencySbomV33_42({version:'33.42',format:'CYCLONEDX_LITE_1_5',serialNumber:'x',components:[x.sbom.components[0]!],generatedAt:now.toISOString()}),toolchain:x.toolchain,generatedAt:now}),/path/);});
test('v33.42 rejects untrusted manifest signer',()=>{const x=setup(); x.trust.trustedManifestSignerIds=[]; assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/manifest_signature/);});
test('v33.42 rejects tampered manifest signature',()=>{const x=setup(); x.manifest={...x.manifest,signature:'bad'}; assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/manifest_signature/);});
test('v33.42 rejects untrusted receipt signer',()=>{const x=setup(); x.trust.trustedReceiptSignerIds=[]; assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/receipt_signature/);});
test('v33.42 rejects tampered receipt signature',()=>{const x=setup(); x.installReceipt={...x.installReceipt,signature:'bad'}; assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/receipt_signature/);});
test('v33.42 rejects package.json digest mismatch',()=>{const x=setup(); x.packageJsonBytes=Buffer.from('{}'); assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/project_files/);});
test('v33.42 rejects package-lock digest mismatch',()=>{const x=setup(); x.packageLockBytes=Buffer.from('{}'); assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/project_files/);});
test('v33.42 rejects SBOM digest tamper',()=>{const x=setup(); x.sbom={...x.sbom,serialNumber:'tampered'}; assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/sbom_digest/);});
test('v33.42 rejects toolchain provenance tamper',()=>{const x=setup(); x.toolchain={...x.toolchain,nodeVersion:'v99'}; assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/toolchain_digest/);});
test('v33.42 rejects missing tarball',()=>{const x=setup(); x.tarballBytesByPath.delete(x.entries[0]!.tarballPath); assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/tarball_missing/);});
test('v33.42 rejects changed tarball bytes',()=>{const x=setup(); x.tarballBytesByPath.set(x.entries[0]!.tarballPath,Buffer.from('changed')); assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/tarball_digest/);});
test('v33.42 rejects changed tarball package.json',()=>{const x=setup(); x.packageJsonByTarballPath.set(x.entries[0]!.tarballPath,Buffer.from('{}')); assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/package_json/);});
test('v33.42 rejects content tree mismatch',()=>{const x=setup(); x.contentTreeDigestByTarballPath.set(x.entries[0]!.tarballPath,sha256({bad:true})); assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/content_tree/);});
test('v33.42 rejects lockfile missing dependency',()=>{const x=setup(); const l=JSON.parse(Buffer.from(x.packageLockBytes).toString()); delete l.packages['node_modules/typescript']; const b=Buffer.from(JSON.stringify(l)); const p={...x.manifest.payload,packageLockDigest:sha256Bytes(b)}; const {manifestDigest,...m}=p; x.manifest=signEnvelope({...m,manifestDigest:sha256(m)},x.manifestSigner); x.packageLockBytes=b; assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/lock_entry_count/);});
test('v33.42 rejects lockfile registry URL',()=>{const x=setup(); const l=JSON.parse(Buffer.from(x.packageLockBytes).toString()); l.packages['node_modules/typescript'].resolved='https://registry.invalid/typescript.tgz'; const b=Buffer.from(JSON.stringify(l)); const p={...x.manifest.payload,packageLockDigest:sha256Bytes(b)}; const {manifestDigest,...m}=p; x.manifest=signEnvelope({...m,manifestDigest:sha256(m)},x.manifestSigner); x.packageLockBytes=b; assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/lock_entry_mismatch/);});
test('v33.42 rejects lockfile integrity mismatch',()=>{const x=setup(); const l=JSON.parse(Buffer.from(x.packageLockBytes).toString()); l.packages['node_modules/typescript'].integrity='sha512-AAAA'; const b=Buffer.from(JSON.stringify(l)); const p={...x.manifest.payload,packageLockDigest:sha256Bytes(b)}; const {manifestDigest,...m}=p; x.manifest=signEnvelope({...m,manifestDigest:sha256(m)},x.manifestSigner); x.packageLockBytes=b; assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/lock_entry_mismatch/);});
test('v33.42 rejects package.json non-local dependency',()=>{const x=setup(); const p=JSON.parse(Buffer.from(x.packageJsonBytes).toString()); p.devDependencies.typescript='5.8.3'; const b=Buffer.from(JSON.stringify(p)); const mp={...x.manifest.payload,packageJsonDigest:sha256Bytes(b)}; const {manifestDigest,...m}=mp; x.manifest=signEnvelope({...m,manifestDigest:sha256(m)},x.manifestSigner); x.packageJsonBytes=b; assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/package_json_dependency/);});
test('v33.42 rejects extra SBOM component',()=>{const x=setup(); const c={name:'extra',version:'1.0.0',purl:'pkg:npm/extra@1.0.0',integrity:sha512IntegrityV33_42(Buffer.from('x')),tarballSha256:sha256Bytes(Buffer.from('x')),scope:'development' as const}; x.sbom=createDependencySbomV33_42({version:'33.42',format:'CYCLONEDX_LITE_1_5',serialNumber:'x',components:[...x.sbom.components,c],generatedAt:now.toISOString()}); const p={...x.manifest.payload,sbomDigest:x.sbom.sbomDigest}; const {manifestDigest,...m}=p; x.manifest=signEnvelope({...m,manifestDigest:sha256(m)},x.manifestSigner); assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/sbom_extra|sbom_count/);});
test('v33.42 rejects receipt bound to another manifest',()=>{const x=setup(); const p={...x.installReceipt.payload,manifestDigest:sha256({other:true})}; const {receiptDigest,...m}=p; x.installReceipt=signEnvelope({...m,receiptDigest:sha256(m)},x.receiptSigner); assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/receipt_contract/);});
test('v33.42 rejects receipt package set mismatch',()=>{const x=setup(); const p={...x.installReceipt.payload,installedPackages:x.installReceipt.payload.installedPackages.slice(0,2)}; const {receiptDigest,...m}=p; x.installReceipt=signEnvelope({...m,receiptDigest:sha256(m)},x.receiptSigner); assert.throws(()=>verifyHermeticDependencyQualificationV33_42(x),/package_set/);});
test('v33.42 rejects duplicate installed package',()=>{const x=setup(); assert.throws(()=>createOfflineInstallReceiptV33_42({signer:x.receiptSigner,manifestDigest:x.manifest.payload.manifestDigest,installedPackages:[x.installReceipt.payload.installedPackages[0]!,x.installReceipt.payload.installedPackages[0]!],nodeModulesTreeDigest:sha256({x:1}),installLogDigest:sha256({x:2}),installedAt:now.toISOString()}),/duplicate/);});
test('v33.42 manifest digest is self-consistent',()=>{const x=setup(); const {manifestDigest,...m}=x.manifest.payload; assert.equal(manifestDigest,sha256(m));});
test('v33.42 receipt digest is self-consistent',()=>{const x=setup(); const {receiptDigest,...m}=x.installReceipt.payload; assert.equal(receiptDigest,sha256(m));});
test('v33.42 verdict remains local and production blocked',()=>{const x=setup(); const v=verifyHermeticDependencyQualificationV33_42(x); assert.equal(v.externalDependencyRegistryObserved,false); assert.equal(v.externalHumanParticipants,0); assert.equal(v.externalEffectsExecuted,0); assert.equal(v.productionAuthority,'NONE');});
test('v33.42 SRI is deterministic',()=>{const b=Buffer.from('same'); assert.equal(sha512IntegrityV33_42(b),sha512IntegrityV33_42(b));});
