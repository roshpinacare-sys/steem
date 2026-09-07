import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ContentAddressedArtifactStore } from '../src/artifacts/content-addressed-store.js';
function root(prefix='artifact-edge-v27-'){return mkdtempSync(join(tmpdir(),prefix));}

test('artifact input, identifiers, metadata and revocation validation fail closed',()=>{
  const store=new ContentAddressedArtifactStore(root());
  for(const tenant of ['','A','ab','bad/tenant'])assert.throws(()=>store.put({tenantId:tenant,kind:'k',mediaType:'text/plain',bytes:Buffer.from('x')}),/invalid_artifact_tenant/);
  assert.throws(()=>store.put({tenantId:'tenant-1',kind:' ',mediaType:'text/plain',bytes:Buffer.from('x')}),/artifact_kind_required/);
  assert.throws(()=>store.put({tenantId:'tenant-1',kind:'k',mediaType:' ',bytes:Buffer.from('x')}),/artifact_media_type_required/);
  assert.throws(()=>store.put({tenantId:'tenant-1',kind:'k',mediaType:'text/plain',bytes:'x' as unknown as Buffer}),/artifact_bytes_required/);
  assert.throws(()=>store.put({tenantId:'tenant-1',kind:'k',mediaType:'text/plain',bytes:Buffer.from('x'),metadata:{'bad key':'x'}}),/metadata_key/);
  assert.throws(()=>store.put({tenantId:'tenant-1',kind:'k',mediaType:'text/plain',bytes:Buffer.from('x'),metadata:{ok:'x'.repeat(2049)}}),/metadata_value/);
  assert.throws(()=>store.get('tenant-1','bad'),/record_id/);assert.throws(()=>store.revoke('tenant-1','0'.repeat(32),' '),/revocation_reason/);
  assert.deepEqual(store.list('tenant-1'),[]);
});

test('artifact listing discovers records, duplicate blobs remain immutable, and record/blob tampering is detected',()=>{
  process.env.NODE_ENV='test';const live=root();const store=new ContentAddressedArtifactStore(live);
  const one=store.put({tenantId:'tenant-1',kind:'a',mediaType:'text/plain',bytes:Buffer.from('same'),createdAt:new Date('2026-01-02Z')});
  const two=store.put({tenantId:'tenant-1',kind:'b',mediaType:'text/plain',bytes:Buffer.from('same'),createdAt:new Date('2026-01-01Z')});
  assert.deepEqual(store.list('tenant-1').map(x=>x.recordId),[two.recordId,one.recordId]);
  store.unsafeTamperRecordForTest('tenant-1',one.recordId);assert.throws(()=>store.get('tenant-1',one.recordId),/tampered/);
  const other=new ContentAddressedArtifactStore(root());const blob=other.put({tenantId:'tenant-1',kind:'a',mediaType:'text/plain',bytes:Buffer.from('blob')});other.unsafeTamperBlobForTest(blob,Buffer.from('longer-tamper'));assert.throws(()=>other.read('tenant-1',blob.recordId),/blob_tampered/);
  delete process.env.NODE_ENV;assert.throws(()=>other.unsafeTamperBlobForTest(blob,Buffer.from('x')),/unsafe_test_api/);assert.throws(()=>other.unsafeTamperRecordForTest('tenant-1',blob.recordId),/unsafe_test_api/);
});

test('backup restore rejects missing, tampered manifest, tampered files and unsafe paths',()=>{
  const live=root(),backup=join(root('backup-parent-v27-'),'backup');const store=new ContentAddressedArtifactStore(live);store.put({tenantId:'tenant-1',kind:'a',mediaType:'text/plain',bytes:Buffer.from('data')});store.createBackup(backup);
  const manifestPath=join(backup,'BACKUP_MANIFEST.json');const original=JSON.parse(readFileSync(manifestPath,'utf8')) as {files:{path:string;digest:string;bytes:number}[];manifestDigest:string};
  writeFileSync(manifestPath,JSON.stringify({...original,manifestDigest:'0'.repeat(64)}));assert.throws(()=>ContentAddressedArtifactStore.restoreFromBackup(backup,root()),/manifest_tampered/);
  writeFileSync(manifestPath,JSON.stringify(original));const first=original.files[0]!;writeFileSync(join(backup,...first.path.split('/')),Buffer.from('tamper'));assert.throws(()=>ContentAddressedArtifactStore.restoreFromBackup(backup,root()),/file_tampered/);
  const missing=root();assert.throws(()=>ContentAddressedArtifactStore.restoreFromBackup(missing,root()),/manifest_missing/);
  const unsafe=root();writeFileSync(join(unsafe,'BACKUP_MANIFEST.json'),JSON.stringify({files:[{path:'../escape',digest:'0'.repeat(64)}],manifestDigest:'bad'}));assert.throws(()=>ContentAddressedArtifactStore.restoreFromBackup(unsafe,root()),/manifest_tampered/);
});

test('cross-tenant supersession and record key substitution remain impossible',()=>{
  const live=root();const store=new ContentAddressedArtifactStore(live);const record=store.put({tenantId:'tenant-1',kind:'a',mediaType:'text/plain',bytes:Buffer.from('x')});
  assert.throws(()=>store.put({tenantId:'tenant-2',kind:'b',mediaType:'text/plain',bytes:Buffer.from('y'),supersedesRecordId:record.recordId}),/not_found/);
  const recordFile=findRecord(live,'tenant-1');const parsed=JSON.parse(readFileSync(recordFile,'utf8')) as Record<string,unknown>;writeFileSync(recordFile,JSON.stringify({...parsed,tenantId:'tenant-2'}));assert.throws(()=>store.get('tenant-1',record.recordId),/tenant_mismatch/);
});
function findRecord(live:string,tenant:string){const dir=join(live,'tenants',tenant,'records');return join(dir,readdirSync(dir).find(name=>name.endsWith('.json'))!);}
