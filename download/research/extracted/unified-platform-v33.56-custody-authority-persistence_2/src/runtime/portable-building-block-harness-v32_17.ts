import { canonicalJson, sha256 } from '../contracts/crypto.js';

export interface PortableBuildingBlockAdapterV32_17 {
  readonly adapterId: string;
  putState(key: string, value: unknown, expectedVersion: number): Promise<number>;
  getState(key: string): Promise<{ readonly value: unknown; readonly version: number } | undefined>;
  publish(topic: string, event: unknown): Promise<void>;
  drain(topic: string): Promise<readonly unknown[]>;
  invoke(service: string, method: string, input: unknown): Promise<unknown>;
  readSecret(name: string): Promise<string>;
  readConfiguration(key: string): Promise<string>;
  acquireLock(resource: string, owner: string): Promise<boolean>;
  releaseLock(resource: string, owner: string): Promise<boolean>;
  runWorkflow(instanceId: string, input: unknown): Promise<unknown>;
}

export interface PortableConformanceReportV32_17 {
  readonly schemaVersion: '32.17';
  readonly adapterId: string;
  readonly state: 'PASSED' | 'FAILED';
  readonly trace: readonly { readonly sequence: number; readonly operation: string; readonly resultDigest: string }[];
  readonly findings: readonly string[];
  readonly traceDigest: string;
  readonly reportDigest: string;
}

export class NativePortableAdapterV32_17 implements PortableBuildingBlockAdapterV32_17 {
  readonly adapterId = 'native-portable-v32.17';
  readonly #state = new Map<string, { value: unknown; version: number }>();
  readonly #topics = new Map<string, unknown[]>();
  readonly #locks = new Map<string, string>();
  readonly #secrets = new Map([['service-token','synthetic-token']]);
  readonly #configuration = new Map([['mode','dry-run']]);
  async putState(key:string,value:unknown,expectedVersion:number):Promise<number>{const current=this.#state.get(key);const version=current?.version??0;if(version!==expectedVersion)throw new Error('state_version_conflict');const next=version+1;this.#state.set(key,{value:structuredClone(value),version:next});return next;}
  async getState(key:string){const value=this.#state.get(key);return value===undefined?undefined:structuredClone(value);}
  async publish(topic:string,event:unknown):Promise<void>{const queue=this.#topics.get(topic)??[];queue.push(structuredClone(event));this.#topics.set(topic,queue);}
  async drain(topic:string):Promise<readonly unknown[]>{const values=this.#topics.get(topic)??[];this.#topics.set(topic,[]);return structuredClone(values);}
  async invoke(service:string,method:string,input:unknown):Promise<unknown>{if(service!=='calculator'||method!=='double')throw new Error('invocation_target_missing');if(typeof input!=='number'||!Number.isSafeInteger(input))throw new Error('invocation_input_invalid');return input*2;}
  async readSecret(name:string):Promise<string>{const value=this.#secrets.get(name);if(value===undefined)throw new Error('secret_not_found');return value;}
  async readConfiguration(key:string):Promise<string>{const value=this.#configuration.get(key);if(value===undefined)throw new Error('configuration_not_found');return value;}
  async acquireLock(resource:string,owner:string):Promise<boolean>{if(this.#locks.has(resource))return false;this.#locks.set(resource,owner);return true;}
  async releaseLock(resource:string,owner:string):Promise<boolean>{if(this.#locks.get(resource)!==owner)return false;this.#locks.delete(resource);return true;}
  async runWorkflow(instanceId:string,input:unknown):Promise<unknown>{return{instanceId,status:'completed',input:structuredClone(input),steps:['validate','execute','persist']};}
}

export class EnvelopePortableAdapterV32_17 implements PortableBuildingBlockAdapterV32_17 {
  readonly adapterId = 'dapr-envelope-profile-v32.17';
  readonly #records: { kind:string; key:string; body:string; version:number }[]=[];
  readonly #locks: {resource:string;owner:string}[]=[];
  #roundTrip<T>(value:T):T{return JSON.parse(canonicalJson(value)) as T;}
  async putState(key:string,value:unknown,expectedVersion:number):Promise<number>{const current=[...this.#records].reverse().find((item)=>item.kind==='state'&&item.key===key);const version=current?.version??0;if(version!==expectedVersion)throw new Error('state_version_conflict');const next=version+1;this.#records.push({kind:'state',key,body:canonicalJson(value),version:next});return next;}
  async getState(key:string){const current=[...this.#records].reverse().find((item)=>item.kind==='state'&&item.key===key);return current===undefined?undefined:{value:JSON.parse(current.body) as unknown,version:current.version};}
  async publish(topic:string,event:unknown):Promise<void>{this.#records.push({kind:'event',key:topic,body:canonicalJson({specversion:'1.0',type:'sovereign.event',source:'upp://v32.17',data:event}),version:1});}
  async drain(topic:string):Promise<readonly unknown[]>{const values=this.#records.filter((item)=>item.kind==='event'&&item.key===topic);for(const value of values)this.#records.splice(this.#records.indexOf(value),1);return values.map((item)=>(JSON.parse(item.body) as {data:unknown}).data);}
  async invoke(service:string,method:string,input:unknown):Promise<unknown>{const request=this.#roundTrip({appId:service,method,input});if(request.appId!=='calculator'||request.method!=='double'||typeof request.input!=='number'||!Number.isSafeInteger(request.input))throw new Error('invocation_target_missing');return this.#roundTrip(request.input*2);}
  async readSecret(name:string):Promise<string>{if(name!=='service-token')throw new Error('secret_not_found');return this.#roundTrip('synthetic-token');}
  async readConfiguration(key:string):Promise<string>{if(key!=='mode')throw new Error('configuration_not_found');return this.#roundTrip('dry-run');}
  async acquireLock(resource:string,owner:string):Promise<boolean>{if(this.#locks.some((item)=>item.resource===resource))return false;this.#locks.push({resource,owner});return true;}
  async releaseLock(resource:string,owner:string):Promise<boolean>{const index=this.#locks.findIndex((item)=>item.resource===resource&&item.owner===owner);if(index<0)return false;this.#locks.splice(index,1);return true;}
  async runWorkflow(instanceId:string,input:unknown):Promise<unknown>{return this.#roundTrip({instanceId,status:'completed',input,steps:['validate','execute','persist']});}
}

export async function runPortableBuildingBlockConformanceV32_17(adapter:PortableBuildingBlockAdapterV32_17):Promise<PortableConformanceReportV32_17>{
  if(adapter.adapterId.trim()==='')throw new Error('portable_adapter_id_required');
  const trace:{sequence:number;operation:string;resultDigest:string}[]=[];const findings:string[]=[];
  const record=(operation:string,result:unknown):void=>{trace.push({sequence:trace.length+1,operation,resultDigest:sha256(result===undefined?null:result)});};
  try{
    record('lock.acquire',await adapter.acquireLock('order/42','workflow/42'));
    record('state.put.v1',await adapter.putState('order/42',{status:'new',amount:21},0));
    record('pubsub.publish',await adapter.publish('orders',{id:42,status:'new'}));
    record('service.invoke',await adapter.invoke('calculator','double',21));
    record('workflow.run',await adapter.runWorkflow('workflow/42',{orderId:42}));
    record('secret.read',await adapter.readSecret('service-token'));
    record('configuration.read',await adapter.readConfiguration('mode'));
    record('state.put.v2',await adapter.putState('order/42',{status:'processed',amount:42},1));
    record('state.get',await adapter.getState('order/42'));
    record('pubsub.drain',await adapter.drain('orders'));
    record('lock.release',await adapter.releaseLock('order/42','workflow/42'));
    const reacquired=await adapter.acquireLock('order/42','workflow/43');record('lock.reacquire',reacquired);
    if(!reacquired)findings.push('portable-lock-reacquire-failed');
  }catch(error){findings.push(`portable-conformance-failed:${sanitize(error instanceof Error?error.message:String(error))}`);}
  const normalized=trace.map(({sequence,operation,resultDigest})=>({sequence,operation,resultDigest}));
  const material={schemaVersion:'32.17' as const,adapterId:adapter.adapterId,state:(findings.length===0?'PASSED':'FAILED') as PortableConformanceReportV32_17['state'],trace:normalized,findings:findings.sort(),traceDigest:sha256(normalized)};
  return{...material,reportDigest:sha256(material)};
}

export function comparePortableConformanceV32_17(reports:readonly PortableConformanceReportV32_17[]):{readonly equivalent:boolean;readonly traceDigest:string|null;readonly findings:readonly string[];readonly reportDigest:string}{
  if(reports.length<2)throw new Error('portable_comparison_requires_two_reports');
  const findings:string[]=[];if(reports.some((report)=>report.state!=='PASSED'))findings.push('portable-comparison-report-failed');
  const digests=new Set(reports.map((report)=>report.traceDigest));if(digests.size!==1)findings.push('portable-comparison-trace-divergence');
  const material={equivalent:findings.length===0,traceDigest:digests.size===1?reports[0]!.traceDigest:null,findings:findings.sort()};return{...material,reportDigest:sha256(material)};
}
function sanitize(value:string):string{const cleaned=value.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'');return(cleaned||'unknown').slice(0,160);}
