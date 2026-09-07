#!/usr/bin/env python3
from pathlib import Path
from tempfile import TemporaryDirectory
import json,os,stat,zipfile
from archive_policy_v25 import FIXED_TIME,build,verify

def malicious(path:Path,entries):
    with zipfile.ZipFile(path,'w') as z:
        for name,mode in entries:
            i=zipfile.ZipInfo(name,FIXED_TIME);i.create_system=3;i.external_attr=mode<<16;z.writestr(i,b'x')

def main():
  checks={}
  with TemporaryDirectory(prefix='archive-v25-') as temp:
    root=Path(temp)/'root';root.mkdir();(root/'a.txt').write_text('alpha\n');(root/'dir').mkdir();(root/'dir/b.sh').write_text('#!/bin/sh\necho hi\n');os.chmod(root/'dir/b.sh',0o755)
    (root/'node_modules').mkdir();(root/'node_modules/x').write_text('excluded')
    a=Path(temp)/'a.zip';b=Path(temp)/'b.zip';ra=build(root,a);rb=build(root,b);checks['deterministic']=a.read_bytes()==b.read_bytes() and ra['sha256']==rb['sha256'];v=verify(a);checks['normalizedModes']=all(((i.external_attr>>16)&0o777)==0o644 for i in zipfile.ZipFile(a).infolist());checks['excluded']=all(not e['path'].startswith('node_modules/') for e in v['entries'])
    symlink=root/'link';symlink.symlink_to(root/'a.txt');
    try: build(root,Path(temp)/'bad-source.zip'); checks['sourceSymlinkRejected']=False
    except ValueError: checks['sourceSymlinkRejected']=True
    cases={'traversal':[('../escape',stat.S_IFREG|0o644)],'caseCollision':[('A.txt',stat.S_IFREG|0o644),('a.txt',stat.S_IFREG|0o644)],'symlinkEntry':[('link',stat.S_IFLNK|0o777)],'executableEntry':[('run.sh',stat.S_IFREG|0o755)]}
    for name,entries in cases.items():
      z=Path(temp)/f'{name}.zip';malicious(z,entries)
      try: verify(z);checks[name+'Rejected']=False
      except ValueError:checks[name+'Rejected']=True
  result={'version':25,'status':'passed' if all(checks.values()) else 'failed','checks':checks}
  print(json.dumps(result))
  return 0 if result['status']=='passed' else 1
if __name__=='__main__':raise SystemExit(main())
