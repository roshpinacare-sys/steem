#!/usr/bin/env python3
from __future__ import annotations
import json, os, signal, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated/v33-liveness'; OUT.mkdir(parents=True,exist_ok=True)
LOG=OUT/'full-suite.tap'
source=sorted(path.stem.removesuffix('.test') for path in (ROOT/'tests').glob('*.test.ts'))
files=[f'dist/tests/{name}.test.js' for name in source]
cmd=['node','--report-on-signal','--report-signal=SIGUSR2','--report-directory='+str(OUT),'--test','--test-concurrency=4','--test-reporter=tap',*files]
with LOG.open('w',encoding='utf-8') as stream:
    p=subprocess.Popen(cmd,cwd=ROOT,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''},stdout=stream,stderr=subprocess.STDOUT,text=True,start_new_session=True)
started=time.monotonic(); summary_seen=None
while time.monotonic()-started < 150:
    time.sleep(1)
    text=LOG.read_text(encoding='utf-8',errors='replace') if LOG.exists() else ''
    if '\n# duration_ms ' in text or text.startswith('# duration_ms '): summary_seen=summary_seen or time.monotonic()
    if p.poll() is not None: break
    if summary_seen and time.monotonic()-summary_seen >= 8: break
snapshot={'pid':p.pid,'summarySeen':bool(summary_seen),'processExitCode':p.poll(),'elapsedSec':round(time.monotonic()-started,3)}
ps=subprocess.run(['ps','-eo','pid,ppid,pgid,stat,etime,cmd'],capture_output=True,text=True).stdout
pgid=os.getpgid(p.pid) if p.poll() is None else None
relevant=[]
for line in ps.splitlines():
    parts=line.split(None,5)
    if len(parts)>=6 and pgid is not None:
        try:
            if int(parts[2])==pgid: relevant.append(line)
        except ValueError: pass
snapshot['processGroup']=relevant
if p.poll() is None:
    proc=Path(f'/proc/{p.pid}')
    fds=[]
    for fd in sorted((proc/'fd').iterdir(),key=lambda x:int(x.name)):
        try: target=os.readlink(fd)
        except OSError as e: target=f'<error:{e}>'
        fds.append({'fd':fd.name,'target':target})
    snapshot['fds']=fds
    for name in ('status','wchan','stack'):
        try: snapshot[name]=(proc/name).read_text()
        except OSError: pass
    os.kill(p.pid,signal.SIGUSR2); time.sleep(3)
    snapshot['reports']=[x.name for x in sorted(OUT.glob('report.*.json'))]
    try: os.killpg(p.pid,signal.SIGTERM)
    except ProcessLookupError: pass
    try: p.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try: os.killpg(p.pid,signal.SIGKILL)
        except ProcessLookupError: pass
        p.wait(timeout=5)
else:
    snapshot['reports']=[x.name for x in sorted(OUT.glob('report.*.json'))]
snapshot['finalExitCode']=p.returncode
(OUT/'diagnostic.json').write_text(json.dumps(snapshot,indent=2)+'\n')
print(json.dumps(snapshot,indent=2))
