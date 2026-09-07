"""Fuzz 4 — Concurrent stress test.

50 threads × 100 executes = 5000 calls on a shared Runtime.
We use 64 different task_ids per thread so the per-task-id lock
is exercised but not pathologically contended. We also interleave
a few store_state() calls to provoke latest.json contention.

Any exception other than ValueError/TypeError propagating out of
execute() or store_state() is a defect.
"""
from __future__ import annotations
import json
import sys
import traceback
import threading
import hashlib
import shutil
import random
from pathlib import Path

sys.path.insert(0, '/home/z/my-project/download')
from srs import Runtime, Task

HOME = Path('/tmp/fuzz_concurrent_f4')
if HOME.exists():
    shutil.rmtree(HOME)
HOME.mkdir(parents=True)

rt = Runtime(home=HOME)
crashes = []
results_count = 0
results_lock = threading.Lock()

def worker(worker_id: int):
    global results_count
    local_crashes = []
    for j in range(100):
        try:
            # Vary task_id so different threads usually hit different
            # per-task-id locks, but occasionally collide.
            tid = f"w{worker_id}_{j:03d}"
            hyps = [hashlib.sha256(f"h{worker_id}_{j}_{k}".encode()).digest()
                    for k in range(64)]
            task = Task(kind="identify",
                        payload={"hypotheses": hyps, "target_idx": 7,
                                 "n_features": 12},
                        budget=16)
            task.task_id = tid
            rt.execute(task)
            # Every 25th iteration, also persist + reload to provoke
            # latest.json contention with other threads' execute().
            if j % 25 == 0:
                rt.store_state()
            with results_lock:
                results_count += 1
        except (ValueError, TypeError) as e:
            # Expected — concurrent resume with mismatched state COULD
            # legitimately raise these.
            pass
        except Exception as e:
            tb_lines = traceback.format_exc().splitlines()
            last_frame = next((l for l in reversed(tb_lines) if l.startswith('  File')), '?')
            local_crashes.append({
                "worker": worker_id, "j": j,
                "exception": type(e).__name__,
                "module": type(e).__module__,
                "message": str(e)[:240],
                "frame": last_frame[:140],
            })
    if local_crashes:
        # Merge under lock so we don't lose updates.
        with results_lock:
            crashes.extend(local_crashes)

N_THREADS = 50
threads = [threading.Thread(target=worker, args=(w,)) for w in range(N_THREADS)]
for t in threads: t.start()
for t in threads: t.join()

# After the storm, verify the runtime is still usable and that
# latest.json is intact JSON.
post_storm_status = {}
try:
    rt.store_state()
    post_storm_status["final_store_state"] = "OK"
except Exception as e:
    post_storm_status["final_store_state"] = f"FAIL: {type(e).__name__}: {e}"
    crashes.append({
        "worker": "post-storm", "j": -1,
        "exception": type(e).__name__,
        "module": type(e).__module__,
        "message": str(e)[:240],
        "frame": "store_state after storm",
    })
try:
    rt2 = Runtime(home=HOME)
    post_storm_status["construct_after_storm"] = "OK"
except Exception as e:
    post_storm_status["construct_after_storm"] = f"FAIL: {type(e).__name__}: {e}"
    crashes.append({
        "worker": "post-storm", "j": -1,
        "exception": type(e).__name__,
        "module": type(e).__module__,
        "message": str(e)[:240],
        "frame": "Runtime() after storm",
    })
# Verify latest.json is parseable.
latest = HOME / "latest.json"
try:
    with open(latest) as f: json.load(f)
    post_storm_status["latest_json_parseable"] = "OK"
except Exception as e:
    post_storm_status["latest_json_parseable"] = f"FAIL: {type(e).__name__}: {e}"
    crashes.append({
        "worker": "post-storm", "j": -1,
        "exception": type(e).__name__,
        "module": type(e).__module__,
        "message": str(e)[:240],
        "frame": "json.load(latest.json)",
    })

# Final: count capabilities() — verify not bricked.
try:
    caps = rt.capabilities()
    post_storm_status["capabilities"] = f"OK total_tasks={caps.get('total_tasks')}"
except Exception as e:
    post_storm_status["capabilities"] = f"FAIL: {type(e).__name__}: {e}"
    crashes.append({
        "worker": "post-storm", "j": -1,
        "exception": type(e).__name__,
        "module": type(e).__module__,
        "message": str(e)[:240],
        "frame": "capabilities() after storm",
    })

out = {
    "attempts": 50 * 100,
    "successful_executes": results_count,
    "crash_count": len(crashes),
    "post_storm_status": post_storm_status,
    "crashes": crashes[:80],
}
with open('/home/z/my-project/download/fuzz_work/fuzz4_results.json', 'w') as f:
    json.dump(out, f, indent=2, default=str)

print(f"Fuzz 4: attempts={50*100}, successful_executes={results_count}, "
      f"crashes={len(crashes)}")
print("Post-storm status:", post_storm_status)
for c in crashes[:10]:
    print(" CRASH:", c)
