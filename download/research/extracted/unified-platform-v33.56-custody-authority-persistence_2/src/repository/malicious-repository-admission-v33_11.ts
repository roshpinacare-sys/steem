import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { KeyRegistry, type SignedEnvelope, type SigningIdentity, sha256, sha256Bytes, signEnvelope } from '../contracts/crypto.js';

export type RepositoryAdmissionFindingKindV33_11 =
  | 'SYMLINK'
  | 'ACTIVE_GIT_HOOK'
  | 'SUBMODULE'
  | 'PROMPT_INJECTION'
  | 'SECRET_CANDIDATE'
  | 'UNSAFE_LIFECYCLE_SCRIPT'
  | 'UNSAFE_DEPENDENCY_LOCATOR'
  | 'EXECUTABLE_SCRIPT'
  | 'NATIVE_OR_BINARY_ARTIFACT'
  | 'OVERSIZED_FILE'
  | 'SCAN_BUDGET_EXCEEDED'
  | 'MALFORMED_MANIFEST';

export interface RepositoryAdmissionFindingV33_11 {
  readonly kind: RepositoryAdmissionFindingKindV33_11;
  readonly severity: 'medium' | 'high' | 'critical';
  readonly path: string;
  readonly ruleId: string;
  readonly summary: string;
  readonly evidenceDigest: string;
}

export interface RepositoryAdmissionPolicyV33_11 {
  readonly version: '33.11';
  readonly policyId: string;
  readonly maximumFiles: number;
  readonly maximumTotalBytes: number;
  readonly maximumSingleFileBytes: number;
  readonly maximumTextScanBytes: number;
  readonly allowExecutableScripts: false;
  readonly allowSubmodules: false;
  readonly allowSymlinks: false;
  readonly allowLifecycleScripts: false;
  readonly allowNativeArtifacts: false;
  readonly executionBoundary: 'QUALIFIED_ISOLATION_REQUIRED';
  readonly productionPromotion: 'blocked';
  readonly policyDigest: string;
}

export interface RepositoryAdmissionReportV33_11 {
  readonly version: '33.11';
  readonly reportId: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly repositoryRootDigest: string;
  readonly policyDigest: string;
  readonly scannedFileCount: number;
  readonly scannedTotalBytes: number;
  readonly findings: readonly RepositoryAdmissionFindingV33_11[];
  readonly decision: 'QUARANTINE' | 'QUALIFIED_ISOLATION_REQUIRED';
  readonly blockingFindingCount: number;
  readonly executionEligible: false;
  readonly commandsExecuted: 0;
  readonly hooksExecuted: 0;
  readonly filesModified: 0;
  readonly externalEffectsExecuted: 0;
  readonly evidenceClass: 'LOCAL_MALICIOUS_REPOSITORY_ADMISSION';
  readonly generatedAt: string;
  readonly reportDigest: string;
}

const TEXT_PATTERN=/(?:^|\/)(?:README|SECURITY|CONTRIBUTING|CLAUDE|AGENTS)(?:\.[^/]*)?$|\.(?:md|txt|json|ya?ml|toml|js|mjs|cjs|ts|tsx|jsx|css|html|xml|sql|sh|bash|zsh|py|rs|c|h|cpp|java|go|env)$/i;
const BINARY_PATTERN=/\.(?:exe|dll|so|dylib|node|wasm|class|jar|bin|o|a|pyc)$/i;
const SCRIPT_PATTERN=/\.(?:sh|bash|zsh|ps1|cmd|bat)$/i;
const PROMPT_RULES=[
 ['PI-OVERRIDE',/ignore\s+(?:(?:all|any|the)\s+)?(?:(?:previous|prior)\s+)?(?:instructions?|rules?|policy)/i,'Repository content attempts to override governing instructions.'],
 ['PI-EXFIL',/(?:exfiltrat|send|upload|post).{0,100}(?:secret|credential|token|environment|private key)/i,'Repository content requests possible credential or data exfiltration.'],
 ['PI-BYPASS',/(?:disable|delete|remove|skip|bypass).{0,70}(?:test|security|audit|review|authorization|guard)/i,'Repository content requests weakening or bypassing validation.'],
 ['PI-AUTHORITY',/(?:system prompt|developer message|hidden instruction|act as root|assume administrator)/i,'Repository content contains authority-confusion language.'],
] as const;
const SECRET_RULES=[
 ['SEC-PRIVATE-KEY',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,'Private-key material candidate detected.'],
 ['SEC-AWS',/AKIA[0-9A-Z]{16}/,'AWS access-key identifier candidate detected.'],
 ['SEC-GITHUB',/gh[pousr]_[A-Za-z0-9]{30,}/,'GitHub credential candidate detected.'],
 ['SEC-TOKEN',/(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-\/+=]{16,}/i,'Credential-like assignment detected.'],
] as const;
const LIFECYCLE=new Set(['preinstall','install','postinstall','prepare','prepublish','prepublishOnly']);

export function createRepositoryAdmissionPolicyV33_11(input:{readonly policyId:string;readonly maximumFiles?:number;readonly maximumTotalBytes?:number;readonly maximumSingleFileBytes?:number;readonly maximumTextScanBytes?:number}):RepositoryAdmissionPolicyV33_11{
  const material={version:'33.11' as const,policyId:required(input.policyId,'admission_policy_id_required'),maximumFiles:positive(input.maximumFiles??10_000,'admission_max_files_invalid'),maximumTotalBytes:positive(input.maximumTotalBytes??256*1024*1024,'admission_max_total_invalid'),maximumSingleFileBytes:positive(input.maximumSingleFileBytes??16*1024*1024,'admission_max_file_invalid'),maximumTextScanBytes:positive(input.maximumTextScanBytes??512*1024,'admission_max_text_invalid'),allowExecutableScripts:false as const,allowSubmodules:false as const,allowSymlinks:false as const,allowLifecycleScripts:false as const,allowNativeArtifacts:false as const,executionBoundary:'QUALIFIED_ISOLATION_REQUIRED' as const,productionPromotion:'blocked' as const};
  if(material.maximumSingleFileBytes>material.maximumTotalBytes||material.maximumTextScanBytes>material.maximumSingleFileBytes)throw new Error('admission_budget_relationship_invalid');
  return{...material,policyDigest:sha256(material)};
}

export function scanRepositoryAdmissionV33_11(input:{readonly root:string;readonly tenantId:string;readonly repositoryId:string;readonly policy:RepositoryAdmissionPolicyV33_11;readonly signer:SigningIdentity;readonly generatedAt:string}):SignedEnvelope<RepositoryAdmissionReportV33_11>{
  verifyPolicy(input.policy);const root=resolve(input.root);const rootStat=lstatSync(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error('admission_root_invalid');
  const generatedAt=parseIso(input.generatedAt,'admission_generated_at_invalid');
  const findings:RepositoryAdmissionFindingV33_11[]=[];let fileCount=0,totalBytes=0;const contentRows:{path:string,size:number,digest:string}[]=[];
  const add=(kind:RepositoryAdmissionFindingKindV33_11,severity:'medium'|'high'|'critical',path:string,ruleId:string,summary:string,evidence:string)=>{findings.push({kind,severity,path,ruleId,summary,evidenceDigest:sha256(evidence)});};
  const walk=(dir:string)=>{
    const entries=readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      const absolute=join(dir,entry.name);const rel=normalize(root,absolute);const st=lstatSync(absolute);
      if(rel==='.git'||rel==='.git/hooks'){if(st.isDirectory())walk(absolute);continue;}
      if(rel.startsWith('.git/')){
        if(rel.startsWith('.git/hooks/')&&st.isFile()&&!entry.name.endsWith('.sample'))add('ACTIVE_GIT_HOOK','critical',rel,'GIT-HOOK','Active Git hook is forbidden before qualified isolation.',`${st.mode}:${st.size}`);
        continue;
      }
      if(st.isSymbolicLink()){add('SYMLINK','critical',rel,'FS-SYMLINK','Symbolic link can escape repository boundaries and is quarantined.',readlinkEvidence(absolute));continue;}
      if(st.isDirectory()){walk(absolute);continue;}
      if(!st.isFile())continue;
      fileCount+=1;totalBytes+=st.size;
      if(fileCount>input.policy.maximumFiles){add('SCAN_BUDGET_EXCEEDED','critical',rel,'BUDGET-FILES','Repository exceeds the bounded file-count budget.',String(fileCount));return;}
      if(totalBytes>input.policy.maximumTotalBytes){add('SCAN_BUDGET_EXCEEDED','critical',rel,'BUDGET-TOTAL','Repository exceeds the bounded total-byte budget.',String(totalBytes));return;}
      if(st.size>input.policy.maximumSingleFileBytes){add('OVERSIZED_FILE','critical',rel,'FILE-SIZE','File exceeds the single-file admission limit.',String(st.size));continue;}
      const raw=readFileSync(absolute);contentRows.push({path:rel,size:st.size,digest:sha256Bytes(raw)});
      if(rel==='.gitmodules')add('SUBMODULE','critical',rel,'GIT-SUBMODULE','Submodules are forbidden before independent source qualification.',raw.toString('utf8'));
      if(BINARY_PATTERN.test(rel)||looksBinary(raw))add('NATIVE_OR_BINARY_ARTIFACT','high',rel,'BINARY-ARTIFACT','Native or binary artifact requires separate binary qualification.',raw.subarray(0,4096).toString('base64'));
      if(SCRIPT_PATTERN.test(rel)&&(st.mode&0o111)!==0)add('EXECUTABLE_SCRIPT','high',rel,'EXEC-SCRIPT','Executable repository script is not admitted to local execution.',`${st.mode}:${sha256Bytes(raw)}`);
      if(!TEXT_PATTERN.test(rel)||st.size>input.policy.maximumTextScanBytes)continue;
      const text=raw.toString('utf8');
      for(const [id,pattern,summary] of PROMPT_RULES)if(pattern.test(text))add('PROMPT_INJECTION','high',rel,id,summary,text.match(pattern)?.[0]??id);
      for(const [id,pattern,summary] of SECRET_RULES)if(pattern.test(text))add('SECRET_CANDIDATE','critical',rel,id,summary,text.match(pattern)?.[0]??id);
      if(rel==='package.json')scanPackage(text,rel,add);
    }
  };
  walk(root);
  findings.sort((a,b)=>`${a.path}:${a.ruleId}`.localeCompare(`${b.path}:${b.ruleId}`));contentRows.sort((a,b)=>a.path.localeCompare(b.path));
  const repositoryRootDigest=sha256(contentRows);const blocking=findings.filter((f)=>f.severity==='critical'||f.severity==='high').length;
  const material={version:'33.11' as const,reportId:sha256({tenantId:input.tenantId,repositoryId:input.repositoryId,repositoryRootDigest,policyDigest:input.policy.policyDigest}).slice(0,32),tenantId:required(input.tenantId,'admission_tenant_required'),repositoryId:required(input.repositoryId,'admission_repository_id_required'),repositoryRootDigest,policyDigest:input.policy.policyDigest,scannedFileCount:fileCount,scannedTotalBytes:totalBytes,findings,decision:(blocking>0?'QUARANTINE':'QUALIFIED_ISOLATION_REQUIRED') as 'QUARANTINE'|'QUALIFIED_ISOLATION_REQUIRED',blockingFindingCount:blocking,executionEligible:false as const,commandsExecuted:0 as const,hooksExecuted:0 as const,filesModified:0 as const,externalEffectsExecuted:0 as const,evidenceClass:'LOCAL_MALICIOUS_REPOSITORY_ADMISSION' as const,generatedAt:new Date(generatedAt).toISOString()};
  const report:RepositoryAdmissionReportV33_11={...material,reportDigest:sha256(material)};return signEnvelope(report,input.signer);
}

export function verifyRepositoryAdmissionReportV33_11(input:{readonly envelope:SignedEnvelope<RepositoryAdmissionReportV33_11>;readonly keys:KeyRegistry;readonly trustedSignerIds:readonly string[]}):boolean{
  const r=input.envelope.payload;const{reportDigest,...material}=r;return input.trustedSignerIds.includes(input.envelope.issuerKeyId)&&input.keys.verify(input.envelope)&&sha256(material)===reportDigest&&r.version==='33.11'&&r.executionEligible===false&&r.commandsExecuted===0&&r.hooksExecuted===0&&r.filesModified===0&&r.externalEffectsExecuted===0&&r.evidenceClass==='LOCAL_MALICIOUS_REPOSITORY_ADMISSION'&&((r.blockingFindingCount>0&&r.decision==='QUARANTINE')||(r.blockingFindingCount===0&&r.decision==='QUALIFIED_ISOLATION_REQUIRED'));
}

function scanPackage(text:string,path:string,add:(kind:RepositoryAdmissionFindingKindV33_11,severity:'medium'|'high'|'critical',path:string,ruleId:string,summary:string,evidence:string)=>void):void{
  try{
    const pkg=JSON.parse(text) as {scripts?:Record<string,unknown>;dependencies?:Record<string,unknown>;devDependencies?:Record<string,unknown>};
    for(const [name,value] of Object.entries(pkg.scripts??{}))if(LIFECYCLE.has(name)&&typeof value==='string'&&value.trim()!=='')add('UNSAFE_LIFECYCLE_SCRIPT','critical',path,`NPM-${name.toUpperCase()}`,'Package lifecycle script is forbidden for untrusted repository admission.',value);
    for(const [name,value] of Object.entries({...pkg.dependencies,...pkg.devDependencies}))if(typeof value!=='string'||value==='*'||value==='latest'||/^(?:https?|git\+|github:|file:|link:)/i.test(value))add('UNSAFE_DEPENDENCY_LOCATOR','high',path,'DEP-LOCATOR',`Dependency ${name} uses a mutable, network or local locator.`,String(value));
  }catch(error){add('MALFORMED_MANIFEST','high',path,'PKG-PARSE','package.json could not be parsed.',String(error));}
}
function normalize(root:string,path:string):string{const rel=relative(root,path);if(rel===''||rel==='..'||rel.startsWith(`..${sep}`))throw new Error('admission_path_escape');return rel.split(sep).join('/');}
function looksBinary(raw:Buffer):boolean{if(raw.length===0)return false;const sample=raw.subarray(0,Math.min(raw.length,8192));let nonText=0;for(const b of sample){if(b===0)return true;if((b<9)||(b>13&&b<32))nonText+=1;}return nonText/sample.length>0.15;}
function readlinkEvidence(path:string):string{const st=lstatSync(path);return `${basename(path)}:${st.mode}:${st.size}`;}
function required(v:string,code:string):string{if(v.trim()==='')throw new Error(code);return v;}
function positive(v:number,code:string):number{if(!Number.isInteger(v)||v<=0)throw new Error(code);return v;}
function parseIso(v:string,code:string):number{const n=Date.parse(v);if(!Number.isFinite(n)||new Date(n).toISOString()!==v)throw new Error(code);return n;}
function verifyPolicy(p:RepositoryAdmissionPolicyV33_11):void{const{policyDigest,...m}=p;if(sha256(m)!==policyDigest||p.version!=='33.11'||p.allowExecutableScripts||p.allowSubmodules||p.allowSymlinks||p.allowLifecycleScripts||p.allowNativeArtifacts||p.executionBoundary!=='QUALIFIED_ISOLATION_REQUIRED'||p.productionPromotion!=='blocked')throw new Error('admission_policy_invalid');}
