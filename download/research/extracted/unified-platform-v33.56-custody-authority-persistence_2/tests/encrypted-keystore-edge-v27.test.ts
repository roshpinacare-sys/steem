import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv, createPrivateKey, createPublicKey, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, generateSigningIdentity } from '../src/contracts/crypto.js';
import { EncryptedKeyStore } from '../src/security/encrypted-keystore.js';
const password='correct horse battery staple v27';const now=new Date('2026-07-17T00:00:00Z');
function path(){return join(mkdtempSync(join(tmpdir(),'keystore-edge-v27-')),'store.json');}

test('keystore path, passphrase, duplicate creation and missing values are rejected',()=>{
  const p=path();assert.throws(()=>EncryptedKeyStore.create(p,'short'),/passphrase/);assert.throws(()=>EncryptedKeyStore.open(p,password),/not_found/);
  const store=EncryptedKeyStore.create(p,password,now);assert.throws(()=>EncryptedKeyStore.create(p,password),/already_exists/);assert.throws(()=>store.getIdentity('missing'),/identity_not_found/);assert.throws(()=>store.getSecret('missing'),/secret_not_found/);assert.throws(()=>store.getTrustSnapshot(),/snapshot_not_found/);
  for(const name of ['A','x','bad name'])assert.throws(()=>store.setSecret(name,'x'.repeat(16)),/invalid_secret_name/);assert.throws(()=>store.setSecret('valid.name','short'),/too_short/);
  assert.deepEqual(store.metadata,{createdAt:now.toISOString(),updatedAt:now.toISOString(),identityCount:0,secretCount:0});
});

test('identity id conflicts and idempotent re-add preserve the original key',()=>{
  const p=path();const store=EncryptedKeyStore.create(p,password,now);const first=generateSigningIdentity('same-id');store.addIdentity(first,now);store.addIdentity(first,now);assert.deepEqual(store.listIdentityIds(),['same-id']);const second=generateSigningIdentity('same-id');assert.throws(()=>store.addIdentity(second,now),/key_id_conflict/);
});

test('unsupported envelope formats, crypto and KDF parameters fail distinctly',()=>{
  for(const patch of [
    {format:'other'},
    {version:2},
    {kdf:{name:'pbkdf2'}},
    {cipher:{name:'aes-128-cbc'}},
    {kdf:{cost:1}},
    {kdf:{blockSize:1}},
    {kdf:{parallelization:2}},
  ]){
    const p=path();EncryptedKeyStore.create(p,password,now);const envelope=JSON.parse(readFileSync(p,'utf8')) as Record<string,unknown>;const merged:any={...envelope,...patch,kdf:{...(envelope.kdf as object),...((patch as {kdf?:object}).kdf??{})},cipher:{...(envelope.cipher as object),...((patch as {cipher?:object}).cipher??{})}};if('format'in patch||'version'in patch){if(!('kdf'in patch))merged.kdf=envelope.kdf;if(!('cipher'in patch))merged.cipher=envelope.cipher;}writeFileSync(p,JSON.stringify(merged),{mode:0o600});assert.throws(()=>EncryptedKeyStore.open(p,password),/unsupported_keystore_/);
  }
});

test('encrypted payload validation rejects invalid versions, timestamps, duplicate identities, key mismatch and invalid trust snapshots',()=>{
  const identity=generateSigningIdentity('identity-1');const privatePem=identity.privateKey.export({type:'pkcs8',format:'pem'}).toString();const publicPem=identity.publicKey.export({type:'spki',format:'pem'}).toString();
  const other=generateSigningIdentity('other');const otherPublic=other.publicKey.export({type:'spki',format:'pem'}).toString();
  const base={formatVersion:1,createdAt:now.toISOString(),updatedAt:now.toISOString(),identities:[{keyId:'identity-1',publicKeyPem:publicPem,privateKeyPem:privatePem}],secrets:{}};
  const cases=[
    {...base,formatVersion:2},
    {...base,createdAt:'bad'},
    {...base,updatedAt:'bad'},
    {...base,identities:[...base.identities,...base.identities]},
    {...base,identities:[{...base.identities[0],keyId:''}]},
    {...base,identities:[{...base.identities[0],publicKeyPem:otherPublic}]},
    {...base,trustSnapshot:{version:1,createdAt:now.toISOString(),entries:[],events:[],root:'bad'}},
  ];
  for(const payload of cases){const p=path();writeFileSync(p,JSON.stringify(encrypt(payload,password)),{mode:0o600});assert.throws(()=>EncryptedKeyStore.open(p,password));}
});

test('bad permissions and malformed ciphertext remain closed after a valid encrypted payload is written',()=>{
  const p=path();EncryptedKeyStore.create(p,password,now);chmodSync(p,0o644);assert.throws(()=>EncryptedKeyStore.open(p,password),/permissions/);chmodSync(p,0o600);const envelope=JSON.parse(readFileSync(p,'utf8')) as {cipher:{tag:string}};envelope.cipher.tag='bad';writeFileSync(p,JSON.stringify(envelope),{mode:0o600});assert.throws(()=>EncryptedKeyStore.open(p,password),/decryption_failed/);
});
function encrypt(payload:unknown,passphrase:string){const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(passphrase,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});const cipher=createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([cipher.update(Buffer.from(canonicalJson(payload))),cipher.final()]);return{format:'sovereign-encrypted-keystore',version:1,kdf:{name:'scrypt',salt:salt.toString('base64url'),cost:16384,blockSize:8,parallelization:1},cipher:{name:'aes-256-gcm',iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url')},ciphertext:ciphertext.toString('base64url'),encryptedAt:now.toISOString()};}
