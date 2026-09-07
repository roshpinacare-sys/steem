#!/usr/bin/env python3
"""Run a command and collect process-level socket evidence from /proc plus Node attempt logs."""
from __future__ import annotations
import argparse, json, os, socket, subprocess, sys, time
from pathlib import Path

TCP_STATES = {"01":"ESTABLISHED","02":"SYN_SENT","03":"SYN_RECV","04":"FIN_WAIT1","05":"FIN_WAIT2","06":"TIME_WAIT","07":"CLOSE","08":"CLOSE_WAIT","09":"LAST_ACK","0A":"LISTEN","0B":"CLOSING"}

def decode_addr(value: str, ipv6: bool=False):
    addr_hex, port_hex = value.split(":")
    port = int(port_hex, 16)
    try:
        if ipv6:
            packed = bytes.fromhex(addr_hex)
            # proc exposes four little-endian u32 words
            packed = b"".join(packed[i:i+4][::-1] for i in range(0, 16, 4))
            addr = socket.inet_ntop(socket.AF_INET6, packed)
        else:
            addr = socket.inet_ntop(socket.AF_INET, bytes.fromhex(addr_hex)[::-1])
    except Exception:
        addr = addr_hex
    return addr, port

def sockets():
    result = {}
    for name, ipv6, proto in [("tcp",False,"tcp"),("tcp6",True,"tcp6"),("udp",False,"udp"),("udp6",True,"udp6")]:
        path = Path("/proc/net") / name
        if not path.exists(): continue
        lines = path.read_text().splitlines()[1:]
        for line in lines:
            parts = line.split()
            if len(parts) < 10: continue
            local = decode_addr(parts[1], ipv6); remote = decode_addr(parts[2], ipv6)
            inode = parts[9]
            result[inode] = {"protocol":proto,"localAddress":local[0],"localPort":local[1],"remoteAddress":remote[0],"remotePort":remote[1],"state":TCP_STATES.get(parts[3],parts[3])}
    return result

def descendants(root_pid: int):
    pids = {root_pid}; changed = True
    while changed:
        changed = False
        for entry in Path('/proc').iterdir():
            if not entry.name.isdigit(): continue
            try:
                stat = (entry/'stat').read_text().split()
                ppid = int(stat[3])
                pid = int(entry.name)
                if ppid in pids and pid not in pids: pids.add(pid); changed = True
            except Exception: pass
    return pids

def process_info(pid: int):
    try:
        exe = os.readlink(f"/proc/{pid}/exe")
    except Exception: exe = None
    try:
        cmd = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace").strip()
    except Exception: cmd = None
    return exe, cmd

def collect(root_pid: int, known: set):
    table = sockets(); records=[]
    for pid in descendants(root_pid):
        fd_dir = Path(f"/proc/{pid}/fd")
        if not fd_dir.exists(): continue
        exe, cmd = process_info(pid)
        try: entries=list(fd_dir.iterdir())
        except Exception: continue
        for fd in entries:
            try: target=os.readlink(fd)
            except Exception: continue
            if not target.startswith('socket:['): continue
            inode=target[8:-1]
            item=table.get(inode)
            if not item: continue
            key=(pid,inode,item['remoteAddress'],item['remotePort'],item['state'])
            if key in known: continue
            known.add(key)
            records.append({"observedAt":time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),"pid":pid,"executable":exe,"command":cmd,"socketInode":inode,**item})
    return records

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--output',required=True); parser.add_argument('--attempt-log',required=True); parser.add_argument('command',nargs=argparse.REMAINDER)
    args=parser.parse_args(); command=args.command
    if command and command[0]=='--': command=command[1:]
    if not command: parser.error('command required after --')
    output=Path(args.output); attempts=Path(args.attempt_log); output.parent.mkdir(parents=True,exist_ok=True); attempts.parent.mkdir(parents=True,exist_ok=True)
    attempts.write_text('')
    env=os.environ.copy(); preload=str((Path(__file__).parent/'network-audit-preload.cjs').resolve())
    env['TITAI_NETWORK_ATTEMPT_LOG']=str(attempts.resolve())
    env['NODE_OPTIONS']=(env.get('NODE_OPTIONS','')+' --require='+preload).strip()
    start=time.time(); proc=subprocess.Popen(command,env=env,cwd=os.getcwd(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    known=set(); observed=[]
    while proc.poll() is None:
        observed.extend(collect(proc.pid,known)); time.sleep(0.01)
    observed.extend(collect(proc.pid,known))
    stdout,stderr=proc.communicate()
    attempt_records=[]
    for line in attempts.read_text().splitlines():
        try: attempt_records.append(json.loads(line))
        except Exception: pass
    evidence={"format":"titai-process-network-evidence","version":1,"startedAt":time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(start)),"durationMs":round((time.time()-start)*1000),"command":command,"exitCode":proc.returncode,"stdout":stdout,"stderr":stderr,"osSocketObservations":observed,"instrumentedAttempts":attempt_records,"summary":{"osSockets":len(observed),"attempts":len(attempt_records),"remoteSocketObservations":sum(1 for r in observed if r['remoteAddress'] not in ('0.0.0.0','::','127.0.0.1','::1') and r['remotePort']!=0)}}
    output.write_text(json.dumps(evidence,indent=2)+'\n')
    print(json.dumps(evidence['summary']))
    return proc.returncode
if __name__=='__main__': raise SystemExit(main())
