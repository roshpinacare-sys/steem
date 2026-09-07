"""R17.3 Advice poisoning bypass attempt.

Tests whether the SHA-256 advice hash check can be bypassed by an attacker
who knows the hash algorithm (which is public — it's in the source code).
"""
import sys, json, hashlib, tempfile
from pathlib import Path
sys.path.insert(0, '/home/z/my-project/download')
from srs import Runtime, Task

# Create a legitimate snapshot
with tempfile.TemporaryDirectory() as tmp:
    rt = Runtime(home=Path(tmp))
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    task = Task(kind="identify",
                payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
                budget=16)
    r = rt.execute(task)
    print(f"Pre-tamper result: correct={r.correct} answer={r.answer}")
    path = rt.store_state()
    print(f"Snapshot path: {path}")

    # Read the snapshot
    with open(path, encoding="utf-8") as f:
        snap = json.load(f)
    print(f"Original advice_table: {snap['advice_table']}")
    print(f"Original advice_hash: {snap['advice_hash']}")

    # Tamper: change advice to point to wrong target
    snap["advice_table"] = {k: 999 for k in snap["advice_table"]}
    print(f"\nTampered advice_table: {snap['advice_table']}")

    # Recompute hash (attacker knows the hash algorithm from the source)
    advice_json = json.dumps(snap["advice_table"], sort_keys=True, default=str)
    recomputed_hash = hashlib.sha256(advice_json.encode()).hexdigest()
    snap["advice_hash"] = recomputed_hash
    print(f"Recomputed advice_hash: {recomputed_hash}")

    # Write back
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snap, f)

    # Try to load
    rt2 = Runtime(home=Path(tmp))
    print(f"\nAfter tamper-load: advice_table = {rt2.advice._table}")
    print(f"Lookup returns: {rt2.advice.lookup(hyps, 7)}")
    print(f"Was the tampered advice loaded? {bool(rt2.advice._table)}")

    # If the tampered advice is loaded, attempt to use it
    r2 = rt2.execute(task)
    print(f"\nPost-tamper result: correct={r2.correct} answer={r2.answer}")
    print(f"  advice_hit={r2.notes.get('advice_hit')}")
    print(f"  used_advice={r2.notes.get('used_advice')}")
    print(f"\nVerdict: Tampered advice {'WAS' if rt2.advice._table else 'WAS NOT'} loaded")
