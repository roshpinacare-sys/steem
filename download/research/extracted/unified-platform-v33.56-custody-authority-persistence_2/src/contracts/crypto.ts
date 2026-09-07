import { createHash, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from 'node:crypto';
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export function canonicalJson(value: unknown): string { return JSON.stringify(normalizeJson(value, '$', new Set<object>())); }
function normalizeJson(value: unknown, path: string, seen: Set<object>): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error(`canonical_json_non_finite_number:${path}`); return Object.is(value,-0)?0:value; }
  if (typeof value === 'undefined') throw new Error(`canonical_json_undefined:${path}`);
  if (typeof value === 'bigint') throw new Error(`canonical_json_bigint:${path}`);
  if (typeof value === 'symbol') throw new Error(`canonical_json_symbol:${path}`);
  if (typeof value === 'function') throw new Error(`canonical_json_function:${path}`);
  if (typeof value !== 'object') throw new Error(`canonical_json_unsupported:${path}`);
  if (seen.has(value)) throw new Error(`canonical_json_cycle:${path}`); seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result: JsonValue[]=[]; for(let i=0;i<value.length;i++){ if(!Object.prototype.hasOwnProperty.call(value,i))throw new Error(`canonical_json_sparse_array:${path}[${i}]`); result.push(normalizeJson(value[i],`${path}[${i}]`,seen)); }
      const extras=Reflect.ownKeys(value).filter(k=>typeof k==='symbol'||(typeof k==='string'&&k!=='length'&&!/^\d+$/.test(k))); if(extras.length)throw new Error(`canonical_json_array_extra_property:${path}`); return result;
    }
    const proto=Object.getPrototypeOf(value); if(proto!==Object.prototype&&proto!==null)throw new Error(`canonical_json_non_plain_object:${path}`);
    if(Object.getOwnPropertySymbols(value).length)throw new Error(`canonical_json_symbol_key:${path}`);
    const descriptors=Object.getOwnPropertyDescriptors(value); const result:Record<string,JsonValue>={};
    for(const key of Object.keys(descriptors).sort()){const d=descriptors[key]!;if(d.get!==undefined||d.set!==undefined)throw new Error(`canonical_json_accessor:${path}.${key}`);if(!d.enumerable)throw new Error(`canonical_json_non_enumerable:${path}.${key}`);result[key]=normalizeJson(d.value,`${path}.${key}`,seen);} return result;
  } finally { seen.delete(value); }
}
export function sha256(value: unknown): string { if(Buffer.isBuffer(value)||ArrayBuffer.isView(value)||value instanceof ArrayBuffer)throw new Error('sha256_binary_requires_sha256Bytes'); return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
export function sha256Bytes(value: Uint8Array|ArrayBuffer): string { const bytes=value instanceof ArrayBuffer?new Uint8Array(value):value; return createHash('sha256').update(bytes).digest('hex'); }
export interface SigningIdentity { readonly keyId:string; readonly publicKey:KeyObject; readonly privateKey:KeyObject; }
export function generateSigningIdentity(keyId:string):SigningIdentity{if(keyId.trim()==='')throw new Error('key_id_required');const pair=generateKeyPairSync('ed25519');return{keyId,publicKey:pair.publicKey,privateKey:pair.privateKey};}
export interface SignedEnvelope<T>{readonly payload:T;readonly issuerKeyId:string;readonly algorithm:'Ed25519';readonly signature:string;}
export function signEnvelope<T>(payload:T,identity:SigningIdentity):SignedEnvelope<T>{const material=Buffer.from(canonicalJson(payload));const signature=cryptoSign(null,material,identity.privateKey).toString('base64url');return{payload,issuerKeyId:identity.keyId,algorithm:'Ed25519',signature};}
export interface ExportedPublicKeyRecord {
 readonly keyId:string;
 readonly spkiDerBase64:string;
 readonly fingerprint:string;
 readonly revoked:boolean;
 readonly revokedAt?:string;
}
export class KeyRegistry {
 readonly #keys=new Map<string,{key:KeyObject;fingerprint:string}>();
 readonly #revokedAt=new Map<string,string>();
 register(keyId:string,publicKey:KeyObject):void{if(keyId.trim()==='')throw new Error('key_id_required');if(publicKey.type!=='public')throw new Error('public_key_required');const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');const existing=this.#keys.get(keyId);if(existing!==undefined&&existing.fingerprint!==fingerprint)throw new Error('key_id_conflict');this.#keys.set(keyId,{key:publicKey,fingerprint});}
 registerExported(record:ExportedPublicKeyRecord):void{if(record.keyId.trim()===''||record.spkiDerBase64.trim()===''||!/^[0-9a-f]{64}$/.test(record.fingerprint))throw new Error('exported_public_key_invalid');let key:KeyObject;try{key=createPublicKey({key:Buffer.from(record.spkiDerBase64,'base64'),type:'spki',format:'der'});}catch{throw new Error('exported_public_key_invalid');}this.register(record.keyId,key);if(this.fingerprint(record.keyId)!==record.fingerprint)throw new Error('exported_public_key_fingerprint_mismatch');if(record.revokedAt!==undefined)this.revokeAt(record.keyId,record.revokedAt);else if(record.revoked)this.revokeAt(record.keyId,new Date(0));}
 revoke(keyId:string, effectiveAt:Date|string=new Date()):void{this.revokeAt(keyId,effectiveAt);}
 revokeAt(keyId:string,effectiveAt:Date|string):void{if(!this.#keys.has(keyId))throw new Error('key_not_found');const parsed=typeof effectiveAt==='string'?Date.parse(effectiveAt):effectiveAt.getTime();if(!Number.isFinite(parsed))throw new Error('key_revocation_time_invalid');const iso=new Date(parsed).toISOString();const prior=this.#revokedAt.get(keyId);if(prior!==undefined&&prior!==iso)throw new Error('key_revocation_conflict');this.#revokedAt.set(keyId,iso);}
 verify<T>(envelope:SignedEnvelope<T>):boolean{return this.verifyAt(envelope,new Date());}
 verifyAt<T>(envelope:SignedEnvelope<T>,at:Date|string):boolean{const parsed=typeof at==='string'?Date.parse(at):at.getTime();if(!Number.isFinite(parsed)||envelope.algorithm!=='Ed25519')return false;const revokedAt=this.#revokedAt.get(envelope.issuerKeyId);if(revokedAt!==undefined&&Date.parse(revokedAt)<=parsed)return false;const registered=this.#keys.get(envelope.issuerKeyId);if(registered===undefined)return false;try{return cryptoVerify(null,Buffer.from(canonicalJson(envelope.payload)),registered.key,Buffer.from(envelope.signature,'base64url'));}catch{return false;}}
 isRevoked(keyId:string,at:Date|string=new Date()):boolean{const parsed=typeof at==='string'?Date.parse(at):at.getTime();const revokedAt=this.#revokedAt.get(keyId);return revokedAt!==undefined&&Number.isFinite(parsed)&&Date.parse(revokedAt)<=parsed;}
 revocationEffectiveAt(keyId:string):string|undefined{return this.#revokedAt.get(keyId);}
 fingerprint(keyId:string):string|undefined{return this.#keys.get(keyId)?.fingerprint;}
 exportPublicKey(keyId:string):ExportedPublicKeyRecord{const registered=this.#keys.get(keyId);if(registered===undefined)throw new Error('key_not_found');const revokedAt=this.#revokedAt.get(keyId);return{keyId,spkiDerBase64:Buffer.from(registered.key.export({type:'spki',format:'der'})).toString('base64'),fingerprint:registered.fingerprint,revoked:revokedAt!==undefined,...(revokedAt===undefined?{}:{revokedAt})};}
 listPublicKeys():readonly ExportedPublicKeyRecord[]{return[...this.#keys.keys()].sort().map((keyId)=>this.exportPublicKey(keyId));}
}
