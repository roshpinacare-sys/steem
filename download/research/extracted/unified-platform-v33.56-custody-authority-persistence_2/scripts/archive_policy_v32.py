#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, os, stat, unicodedata, zipfile
from pathlib import Path, PurePosixPath
FIXED_TIME=(1980,1,1,0,0,0)
EXCLUDED={'.git','node_modules','dist','coverage','.cache','__pycache__'}
EXCLUDED_PREFIXES=('evidence/generated/','evidence/quarantine/','evidence/runs/')
RUNTIME_FILE_PREFIXES=('.validation-', '.mutation-')

def normalize_name(name:str)->str:
    if '\\' in name or '\x00' in name: raise ValueError('archive_path_invalid')
    value=unicodedata.normalize('NFC',name)
    path=PurePosixPath(value)
    if path.is_absolute() or any(part in ('','.', '..') for part in path.parts): raise ValueError('archive_path_invalid')
    return path.as_posix()

def is_excluded(name:str)->bool:
    parts=PurePosixPath(name).parts
    return any(part in EXCLUDED for part in parts) or any(name.startswith(prefix) for prefix in EXCLUDED_PREFIXES) or any(part.startswith(RUNTIME_FILE_PREFIXES) for part in parts)


def _hardlink_forbidden(st:os.stat_result)->bool:
    return st.st_nlink != 1

def collect(root:Path)->list[tuple[str,Path,tuple[int,int,int,int,int,int]]]:
    root=root.resolve(); rows=[]; seen=set(); inodes=set()
    for directory,dirs,files in os.walk(root,topdown=True,followlinks=False):
        dpath=Path(directory)
        kept=[]
        for name in sorted(dirs):
            path=dpath/name; rel=normalize_name(path.relative_to(root).as_posix())
            mode=path.lstat().st_mode
            if stat.S_ISLNK(mode): raise ValueError(f'archive_symlink_forbidden:{rel}')
            if is_excluded(rel): continue
            if not stat.S_ISDIR(mode): raise ValueError(f'archive_non_directory:{rel}')
            kept.append(name)
        dirs[:]=kept
        for name in sorted(files):
            path=dpath/name; rel=normalize_name(path.relative_to(root).as_posix())
            if is_excluded(rel): continue
            st=path.lstat()
            if stat.S_ISLNK(st.st_mode): raise ValueError(f'archive_symlink_forbidden:{rel}')
            if not stat.S_ISREG(st.st_mode): raise ValueError(f'archive_non_regular_forbidden:{rel}')
            key=unicodedata.normalize('NFC',rel).casefold()
            if key in seen: raise ValueError(f'archive_name_collision:{rel}')
            seen.add(key)
            inode=(st.st_dev,st.st_ino)
            if _hardlink_forbidden(st): raise ValueError(f'archive_hardlink_forbidden:{rel}')
            if inode in inodes: raise ValueError(f'archive_inode_duplicate_forbidden:{rel}')
            inodes.add(inode); rows.append((rel,path,(st.st_dev,st.st_ino,st.st_mode,st.st_nlink,st.st_size,st.st_mtime_ns)))
    return sorted(rows)

def _safe_snapshot_read(path:Path,expected:tuple[int,int,int,int,int,int])->bytes:
    flags=os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)
    fd=os.open(path,flags)
    try:
        before=os.fstat(fd); actual=(before.st_dev,before.st_ino,before.st_mode,before.st_nlink,before.st_size,before.st_mtime_ns)
        if actual!=expected or not stat.S_ISREG(before.st_mode) or _hardlink_forbidden(before): raise ValueError(f'archive_source_drift:{path}')
        chunks=[]; remaining=before.st_size
        while remaining:
            chunk=os.read(fd,min(1024*1024,remaining))
            if not chunk: raise ValueError(f'archive_source_truncated:{path}')
            chunks.append(chunk); remaining-=len(chunk)
        if os.read(fd,1): raise ValueError(f'archive_source_grew:{path}')
        after=os.fstat(fd); final=(after.st_dev,after.st_ino,after.st_mode,after.st_nlink,after.st_size,after.st_mtime_ns)
        if final!=expected: raise ValueError(f'archive_source_changed_during_read:{path}')
        return b''.join(chunks)
    finally:
        os.close(fd)

def build(root:Path,target:Path)->dict:
    rows=collect(root); target.parent.mkdir(parents=True,exist_ok=True); entries=[]
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9,strict_timestamps=True) as archive:
        for rel,path,fingerprint in rows:
            data=_safe_snapshot_read(path,fingerprint); info=zipfile.ZipInfo(rel,FIXED_TIME); info.create_system=3; info.external_attr=(stat.S_IFREG|0o644)<<16; info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
            entries.append({'path':rel,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    raw=target.read_bytes()
    return {'version':32,'files':len(rows),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'entries':entries}

def verify(path:Path)->dict:
    raw=path.read_bytes(); seen=set(); entries=[]
    with zipfile.ZipFile(path,'r') as archive:
        for info in archive.infolist():
            rel=normalize_name(info.filename)
            key=unicodedata.normalize('NFC',rel).casefold()
            if key in seen: raise ValueError(f'archive_duplicate_or_case_collision:{rel}')
            seen.add(key)
            mode=(info.external_attr>>16)&0xffff
            if stat.S_ISLNK(mode): raise ValueError(f'archive_symlink_entry_forbidden:{rel}')
            if not stat.S_ISREG(mode): raise ValueError(f'archive_non_regular_entry:{rel}')
            if mode&0o111: raise ValueError(f'archive_executable_bit_forbidden:{rel}')
            if info.date_time!=FIXED_TIME: raise ValueError(f'archive_timestamp_not_deterministic:{rel}')
            if is_excluded(rel): raise ValueError(f'archive_excluded_path_present:{rel}')
            data=archive.read(info)
            entries.append({'path':rel,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    return {'version':32,'status':'passed','files':len(entries),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'entries':entries}
