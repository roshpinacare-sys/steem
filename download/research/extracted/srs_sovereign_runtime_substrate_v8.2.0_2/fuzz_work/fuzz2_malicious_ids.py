"""Fuzz 2 — Malicious task_ids.

Sends a fixed legitimate payload but overrides task.task_id with a
zoo of hostile strings (path traversal, shell metachars, null bytes,
control chars, oversize blobs, unicode). Validation should reject
unsafe ids; anything that propagates an unexpected exception or
silently accepts a dangerous id is a defect.
"""
from __future__ import annotations
import json
import os
import sys
import traceback
import hashlib
from pathlib import Path

sys.path.insert(0, '/home/z/my-project/download')
from srs import Runtime, Task

RT_HOME = Path('/tmp/fuzz_test_f2')
if RT_HOME.exists():
    import shutil; shutil.rmtree(RT_HOME)
RT_HOME.mkdir(parents=True)

rt = Runtime(home=RT_HOME)
crashes = []
silently_accepted_dangerous = []
expected_rejections = 0

# Build a vanilla payload so the only variable is task_id.
hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
payload = {"hypotheses": hyps, "target_idx": 7, "n_features": 12}

MALICIOUS_IDS = [
    "", " ", "a" * 1000, "../../etc/passwd", "test\x00null",
    "test\nnewline", "test\\backslash", "test'quote", 'test"quote',
    "test; rm -rf /", "test$(whoami)", "test`whoami`",
    "test|pipe", "test>redirect", "test&background",
    "test\x01\x02\x03", "test\x7f", "test\x80\x81",
    "a/b/c", "a\\b\\c", "a:b", "a*b", "a?b",
    # Extra hostile vectors
    "test\rCRLF", "test\x1b[31mANSI", "test\xff\xfe",
    "test\u202eRTL", "test\x00\x00\x00", "test/../../",
    "../", "..%2f", "..%5c", "CON", "PRN", "AUX", "NUL",
    "com1", "lpt1", "test.", "test ", ".test",
]

for mid in MALICIOUS_IDS:
    try:
        task = Task(kind="identify", payload=dict(payload), budget=16)
        task.task_id = mid  # override post-init
        result = rt.execute(task)
        # If we got here, the task_id was accepted. Some are safe
        # (long-but-clean, weird unicode, etc.) but those containing
        # path traversal / shell metachars / null bytes / control chars
        # are dangerous if they ever reach filesystem or shell.
        dangerous_chars = ['/', '\\', '\x00', ';', '|', '&', '`', '$',
                           '>', '<', '\n', '\r', '\x1b', '?', '*', ':']
        is_dangerous = any(c in mid for c in dangerous_chars) or mid == ""
        if is_dangerous:
            silently_accepted_dangerous.append({
                "task_id": mid, "task_id_repr": repr(mid)[:120],
                "result_correct": result.correct,
            })
    except (ValueError, TypeError) as e:
        expected_rejections += 1
    except Exception as e:
        tb_lines = traceback.format_exc().splitlines()
        last_frame = next((l for l in reversed(tb_lines) if l.startswith('  File')), '?')
        crashes.append({
            "task_id": mid, "task_id_repr": repr(mid)[:120],
            "exception": type(e).__name__,
            "module": type(e).__module__,
            "message": str(e)[:240],
            "frame": last_frame[:120],
        })

out = {
    "attempts": len(MALICIOUS_IDS),
    "expected_rejections": expected_rejections,
    "crash_count": len(crashes),
    "silently_accepted_dangerous_count": len(silently_accepted_dangerous),
    "crashes": crashes,
    "silently_accepted_dangerous": silently_accepted_dangerous[:50],
}
with open('/home/z/my-project/download/fuzz_work/fuzz2_results.json', 'w') as f:
    json.dump(out, f, indent=2, default=str)

print(f"Fuzz 2: attempts={len(MALICIOUS_IDS)}, "
      f"expected_rejections={expected_rejections}, crashes={len(crashes)}, "
      f"silently_accepted_dangerous={len(silently_accepted_dangerous)}")
for c in crashes[:10]:
    print(" CRASH:", c)
for s in silently_accepted_dangerous[:10]:
    print(" ACCEPTED-DANGEROUS:", s['task_id_repr'])
