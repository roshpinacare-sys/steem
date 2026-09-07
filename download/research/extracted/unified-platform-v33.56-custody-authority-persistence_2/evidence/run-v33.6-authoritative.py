from pathlib import Path
import subprocess, json, hashlib, time
base=Path(__file__).resolve().parent.parent
cmd=json.loads((base/'evidence/v33.6-regression.cmd.json').read_text())
out=base/'evidence/v33.6-regression.stdout'
err=base/'evidence/v33.6-regression.stderr'
exitf=base/'evidence/v33.6-regression.exit'
metaf=base/'evidence/v33.6-regression.meta.json'
start=time.time()
with out.open('wb') as fo, err.open('wb') as fe:
    cp=subprocess.run(cmd,cwd=base,stdout=fo,stderr=fe,check=False,timeout=300)
end=time.time()
exitf.write_text(str(cp.returncode)+'\n')
meta={'command':cmd,'exitCode':cp.returncode,'startedAtEpochMs':round(start*1000),'completedAtEpochMs':round(end*1000),'durationMs':round((end-start)*1000),'stdoutSha256':hashlib.sha256(out.read_bytes()).hexdigest(),'stderrSha256':hashlib.sha256(err.read_bytes()).hexdigest()}
metaf.write_text(json.dumps(meta,indent=2)+'\n')
