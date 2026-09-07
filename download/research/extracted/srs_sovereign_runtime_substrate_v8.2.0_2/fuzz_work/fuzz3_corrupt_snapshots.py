"""Fuzz 3 — Corrupt snapshot files.

1. Build a valid snapshot via a normal execute() + store_state().
2. For each corruption vector, overwrite the snap_*.json with the
   corrupt bytes.
3. Try to construct a fresh Runtime pointed at the home dir.
   Runtime.__init__ should NEVER crash; load_latest already returns
   None on JSONDecodeError. So any exception here is a defect.

Also separately exercises load_latest() directly so we can tell apart
"construction caught it" vs "load_latest itself crashed".

Adds an extra corruption vector: deeply nested JSON, which is the
classic json.load() DoS via RecursionError (not caught by the
try/except JSONDecodeError, OSError).
"""
from __future__ import annotations
import json
import os
import sys
import traceback
import hashlib
import shutil
from pathlib import Path

sys.path.insert(0, '/home/z/my-project/download')
from srs import Runtime, Task
from srs import persistence

HOME = Path('/tmp/fuzz_corrupt_f3')
if HOME.exists():
    shutil.rmtree(HOME)
HOME.mkdir(parents=True)

# Build a valid snapshot to corrupt.
rt = Runtime(home=HOME)
hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
task = Task(kind="identify",
            payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
            budget=16)
rt.execute(task)
snap_path = rt.store_state()
# Find the actual snapshot file path (snap_*.json under HOME).
snap_files = list(HOME.glob("snap_*.json"))
assert snap_files, "snapshot file must exist"
snap_file = snap_files[0]

corruptions = [
    ("empty", b""),
    ("truncated", snap_file.read_bytes()[:100]),
    ("invalid_json", b"{invalid json}}}"),
    ("wrong_types",
     b'{"snapshot_id":"x","timestamp":"2025-01-01T00:00:00+00:00",'
     b'"advice_table":"should be dict","primitive_stats":123}'),
    ("huge_string",
     b'{"snapshot_id":"x","timestamp":"2025-01-01T00:00:00+00:00",'
     b'"advice_table":{"key":"' + b"A" * 100000 + b'"}}'),
    ("deeply_nested", b"[" * 10000 + b"]" * 10000),
    ("null_bytes",
     b'\x00\x00\x00{"snapshot_id":"x","timestamp":"2025-01-01T00:00:00+00:00",'
     b'"advice_table":{}}'),
    ("binary_garbage", os.urandom(1000)),
    ("primitive_stats_string",
     json.dumps({
         "snapshot_id":"x","timestamp":"2025-01-01T00:00:00+00:00",
         "advice_table":{}, "primitive_stats":"i_am_not_a_dict",
     }).encode()),
    ("execution_history_string",
     json.dumps({
         "snapshot_id":"x","timestamp":"2025-01-01T00:00:00+00:00",
         "advice_table":{}, "primitive_stats":{"execution_history":"not_list"},
     }).encode()),
    ("total_tasks_string",
     json.dumps({
         "snapshot_id":"x","timestamp":"2025-01-01T00:00:00+00:00",
         "advice_table":{},
         "primitive_stats":{"_total_tasks":"not_an_int"},
     }).encode()),
]

crashes = []
silently_handled = []

for name, content in corruptions:
    # Write corruption to the snap file.
    snap_file.write_bytes(content)
    # Also overwrite latest.json to point at it.
    latest_path = HOME / "latest.json"
    latest_path.write_text(json.dumps({
        "snapshot_id": "x",
        "path": str(snap_file),
        "timestamp": "2025-01-01T00:00:00+00:00",
    }))
    # Probe 1: load_latest directly.
    print(f"--- {name}: snap_file size={snap_file.stat().st_size}, latest.json={latest_path.read_text()[:120]}")
    try:
        snap = persistence.load_latest(HOME)
        print(f"    load_latest returned: {type(snap).__name__ if snap is not None else 'None'}")
        silently_handled.append({"corruption": name, "load_latest": "returned None" if snap is None else "returned Snapshot"})
    except Exception as e:
        tb_lines = traceback.format_exc().splitlines()
        last_frame = next((l for l in reversed(tb_lines) if l.startswith('  File')), '?')
        crashes.append({
            "corruption": name, "probe": "load_latest",
            "exception": type(e).__name__,
            "module": type(e).__module__,
            "message": str(e)[:240],
            "frame": last_frame[:140],
        })
        continue
    # Probe 2: Runtime.__init__ on the corrupt home.
    try:
        rt2 = Runtime(home=HOME)
        # And try to execute on the recovered (or empty-state) runtime.
        rt2.execute(task)
    except Exception as e:
        tb_lines = traceback.format_exc().splitlines()
        last_frame = next((l for l in reversed(tb_lines) if l.startswith('  File')), '?')
        crashes.append({
            "corruption": name, "probe": "Runtime()/execute()",
            "exception": type(e).__name__,
            "module": type(e).__module__,
            "message": str(e)[:240],
            "frame": last_frame[:140],
        })

out = {
    "attempts": len(corruptions),
    "crash_count": len(crashes),
    "silently_handled_count": len(silently_handled),
    "crashes": crashes,
    "silently_handled": silently_handled,
}
with open('/home/z/my-project/download/fuzz_work/fuzz3_results.json', 'w') as f:
    json.dump(out, f, indent=2, default=str)

print(f"Fuzz 3: attempts={len(corruptions)}, crashes={len(crashes)}, "
      f"silently_handled={len(silently_handled)}")
for c in crashes[:10]:
    print(" CRASH:", c)
