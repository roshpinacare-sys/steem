#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,os,platform,re,subprocess
from datetime import datetime,timezone
from pathlib import Path
from typing import Iterable
ROOT=Path(__file__).resolve().parents[1]; EVIDENCE_ROOT=ROOT/'evidence'; RUNS_ROOT=EVIDENCE_ROOT/'runs'; CURRENT_POINTER=EVIDENCE_ROOT/'V32_6_CURRENT_RUN.json'
STATIC_SOURCE_ITEMS=['package.json','package-lock.json','tsconfig.json','.github','config','src','tests','scripts','e2e','governance-state','infra','isolation','schemas','docs','external-qualification','verifier-only','formal','benchmark-kits']
SOURCE_ROOT_FILES=['CLAUDE.md','MASTER_DIRECTIVE.md','PROGRAM_CHARTER.md','README.md','MASTER_PROMPT_v22.md','LICENSE']
def source_items():
 items=set(STATIC_SOURCE_ITEMS+SOURCE_ROOT_FILES)
 items.update(p.name for p in ROOT.glob('CLAUDE_HANDOFF_v*.md') if p.is_file())
 return sorted(items)
def utc(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def _hash(records:Iterable[tuple[str,bytes]]):
 h=hashlib.sha256()
 for n,p in records:h.update(n.encode());h.update(b'\0');h.update(p);h.update(b'\0')
 return h.hexdigest()
def _files(p:Path): return [] if not p.exists() else ([p] if p.is_file() else sorted(x for x in p.rglob('*') if x.is_file()))
def source_digest():
 rec=[]
 for item in source_items():
  for p in _files(ROOT/item):
   r=p.relative_to(ROOT).as_posix()
   if r.startswith(('dist/','node_modules/','.cache/','evidence/')) or '__pycache__' in r:continue
   rec.append((r,p.read_bytes()))
 return _hash(rec)
def compiled_artifact_digest():
 rec=[(p.relative_to(ROOT).as_posix(),p.read_bytes()) for p in _files(ROOT/'dist')]
 return _hash(rec) if rec else ''
def test_manifest():
 src=sorted(p.stem.removesuffix('.test') for p in (ROOT/'tests').glob('*.test.ts')); comp=sorted(p.stem.removesuffix('.test') for p in (ROOT/'dist/tests').glob('*.test.js'))
 return {'source':src,'compiled':comp,'missingCompiled':sorted(set(src)-set(comp)),'unexpectedCompiled':sorted(set(comp)-set(src))}
def test_manifest_digest(): return hashlib.sha256(json.dumps(test_manifest(),sort_keys=True,separators=(',',':')).encode()).hexdigest()
def test_files_digest():
 rec=[]
 for base,suffix in [(ROOT/'tests','.test.ts'),(ROOT/'dist/tests','.test.js')]:
  for p in sorted(base.glob(f'*{suffix}')):rec.append((p.relative_to(ROOT).as_posix(),p.read_bytes()))
 return _hash(rec)
def package_lock_digest(): return hashlib.sha256((ROOT/'package-lock.json').read_bytes()).hexdigest()
def node_version():
 p=subprocess.run(['node','--version'],cwd=ROOT,text=True,capture_output=True);return (p.stdout or p.stderr).strip()
def environment_identity(): return {'nodeVersion':node_version(),'pythonVersion':platform.python_version(),'system':platform.system(),'machine':platform.machine(),'ci':bool(os.getenv('CI')),'runnerOs':os.getenv('RUNNER_OS',''),'runnerArch':os.getenv('RUNNER_ARCH','')}
def environment_digest(): return hashlib.sha256(json.dumps(environment_identity(),sort_keys=True,separators=(',',':')).encode()).hexdigest()
def execution_identity(): return {'sourceDigest':source_digest(),'compiledArtifactDigest':compiled_artifact_digest(),'testManifestDigest':test_manifest_digest(),'testFilesDigest':test_files_digest(),'packageLockDigest':package_lock_digest(),'environmentDigest':environment_digest(),'environment':environment_identity()}
def sanitize_run_id(v:str):
 c=re.sub(r'[^A-Za-z0-9._-]+','-',v).strip('-')
 if not c or len(c)>120:raise ValueError('invalid_v32_6_run_id')
 return c
def new_run_id(): return sanitize_run_id(os.getenv('V32_6_RUN_ID') or f"v32.6.1-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{source_digest()[:12]}")
def run_dir(create=True):
 d=Path(os.getenv('V32_6_RUN_DIR','')).resolve() if os.getenv('V32_6_RUN_DIR') else RUNS_ROOT/new_run_id()
 if EVIDENCE_ROOT.resolve() not in d.parents:raise ValueError('run_directory_must_be_under_evidence')
 if create:d.mkdir(parents=True,exist_ok=True)
 return d
def atomic_write_json(path:Path,value):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,indent=2)+'\n');os.replace(tmp,path)
def assert_identity(expected,current=None):
 actual=current or execution_identity(); fields=['sourceDigest','compiledArtifactDigest','testManifestDigest','testFilesDigest','packageLockDigest','environmentDigest']; drift={f:{'expected':expected.get(f),'actual':actual.get(f)} for f in fields if expected.get(f)!=actual.get(f)}
 if drift:raise RuntimeError('execution_identity_changed:'+json.dumps(drift,sort_keys=True))
if __name__=='__main__':
 import argparse
 ap=argparse.ArgumentParser();ap.add_argument('--identity',action='store_true');a=ap.parse_args()
 if a.identity:print(json.dumps(execution_identity(),sort_keys=True))
