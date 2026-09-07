"""R17.5 Test latest.json path traversal via snap_path field.

The latest.json contains a 'path' field that points to the snapshot file.
The persistence.py load_latest() validates this via resolve().relative_to().
But what if the path is a symlink, or if there are TOCTOU issues?
"""
import sys, json, hashlib, tempfile, os
from pathlib import Path
sys.path.insert(0, '/home/z/my-project/download')
from srs import Runtime, Task

# Test 1: latest.json points to /etc/passwd (rejected by relative_to check)
with tempfile.TemporaryDirectory() as tmp:
    home = Path(tmp)
    # Create a real snapshot first
    rt = Runtime(home=home)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    task = Task(kind="identify",
                payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
                budget=16)
    rt.execute(task)
    rt.store_state()

    # Tamper latest.json to point to /etc/passwd
    latest = home / "latest.json"
    with open(latest) as f:
        meta = json.load(f)
    print(f"Original meta: {meta}")
    meta["path"] = "/etc/passwd"
    with open(latest, "w") as f:
        json.dump(meta, f)

    rt2 = Runtime(home=home)
    print(f"After tampering path=/etc/passwd: advice loaded? {bool(rt2.advice._table)}")

# Test 2: latest.json path is a symlink that escapes home
with tempfile.TemporaryDirectory() as tmp:
    home = Path(tmp)
    rt = Runtime(home=home)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    task = Task(kind="identify",
                payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
                budget=16)
    rt.execute(task)
    rt.store_state()

    # Create a symlink inside home that points outside
    target = home / "snap_evil.json"
    if target.exists():
        target.unlink()
    os.symlink("/etc/passwd", target)

    # Tamper latest.json
    latest = home / "latest.json"
    with open(latest) as f:
        meta = json.load(f)
    meta["path"] = str(target)
    meta["snapshot_id"] = "evil"
    with open(latest, "w") as f:
        json.dump(meta, f)

    # Try to load — the symlink resolves outside home, should be rejected
    rt2 = Runtime(home=home)
    print(f"After symlink attack: advice loaded? {bool(rt2.advice._table)}")

# Test 3: latest.json path contains ../ that resolves INSIDE home
# (legitimate but tricky)
with tempfile.TemporaryDirectory() as tmp:
    home = Path(tmp)
    rt = Runtime(home=home)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    task = Task(kind="identify",
                payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
                budget=16)
    rt.execute(task)
    rt.store_state()

    # Get the snapshot path
    latest = home / "latest.json"
    with open(latest) as f:
        meta = json.load(f)
    real_path = meta["path"]

    # Create a snapshot with a path that uses ./.. (which resolves inside home)
    # e.g. /tmp/XXX/sub/../snap_xxx.json (resolves to /tmp/XXX/snap_xxx.json)
    sub_dir = home / "sub"
    sub_dir.mkdir(exist_ok=True)
    fake_path = str(sub_dir / ".." / Path(real_path).name)
    print(f"\nFake path with subdir/..: {fake_path}")
    print(f"  resolves to: {Path(fake_path).resolve()}")

    meta["path"] = fake_path
    with open(latest, "w") as f:
        json.dump(meta, f)

    rt2 = Runtime(home=home)
    print(f"After subdir/.. path attack: advice loaded? {bool(rt2.advice._table)}")

# Test 4: snapshot_id bypass — what if snapshot_id is empty string?
with tempfile.TemporaryDirectory() as tmp:
    home = Path(tmp)
    latest = home / "latest.json"
    latest.parent.mkdir(parents=True, exist_ok=True)
    # Tamper latest.json with empty snapshot_id
    meta = {"snapshot_id": "", "path": "/etc/passwd", "timestamp": 1.0}
    with open(latest, "w") as f:
        json.dump(meta, f)
    rt = Runtime(home=home)
    print(f"\nEmpty snapshot_id: snapshot loaded? {rt.last_snapshot is not None}")

# Test 5: snapshot_id with only valid chars but a path that points to something else
with tempfile.TemporaryDirectory() as tmp:
    home = Path(tmp)
    rt = Runtime(home=home)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    task = Task(kind="identify",
                payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
                budget=16)
    rt.execute(task)
    rt.store_state()
    # Now also save a second snapshot
    rt.execute(task)
    rt.store_state()

    # Try to make latest.json point to a different snapshot inside home
    snaps = list(home.glob("snap_*.json"))
    print(f"\nSnapshots on disk: {[s.name for s in snaps]}")
    if len(snaps) >= 2:
        # Point to the OLDER snapshot, but the snapshot_id should mismatch
        # actually... no, latest.json's snapshot_id is just metadata. The path is what loads.
        # But what if path points to a DIFFERENT snapshot than snapshot_id claims?
        older = snaps[0]
        newer = snaps[1]
        latest = home / "latest.json"
        with open(latest) as f:
            meta = json.load(f)
        meta["path"] = str(older)  # claim the older snapshot
        meta["snapshot_id"] = newer.stem.replace("snap_", "")  # but say the id is the newer one
        with open(latest, "w") as f:
            json.dump(meta, f)
        rt2 = Runtime(home=home)
        print(f"Mismatched snapshot_id vs path: snapshot loaded? {rt2.last_snapshot is not None}")
        if rt2.last_snapshot:
            print(f"  loaded snapshot_id: {rt2.last_snapshot.snapshot_id}")
