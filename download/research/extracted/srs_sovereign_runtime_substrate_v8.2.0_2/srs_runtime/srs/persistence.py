"""Persistence — snapshot runtime state to disk for recovery.

Recovers from `self_healing/digital_dna.py` pattern: each snapshot
is a JSON document with a version tag.
"""
from __future__ import annotations
import json
import os
import time
from pathlib import Path
from typing import Optional

from .types import Snapshot


def default_path() -> Path:
    return Path(os.environ.get("SRS_HOME", str(Path.home() / ".srs"))) / "snapshots"


def save(snap: Snapshot, path: Optional[Path] = None) -> Path:
    p = path or default_path()
    p.mkdir(parents=True, exist_ok=True)
    fname = f"snap_{snap.snapshot_id}.json"
    fpath = p / fname
    with open(fpath, "w") as f:
        json.dump(snap.to_dict(), f, indent=2)
    # Update 'latest' pointer
    latest = p / "latest.json"
    with open(latest, "w") as f:
        json.dump({"snapshot_id": snap.snapshot_id, "path": str(fpath),
                    "timestamp": snap.timestamp}, f)
    return fpath


def load_latest(path: Optional[Path] = None) -> Optional[Snapshot]:
    p = path or default_path()
    latest = p / "latest.json"
    if not latest.exists():
        return None
    with open(latest) as f:
        meta = json.load(f)
    snap_path = Path(meta["path"])
    if not snap_path.exists():
        return None
    with open(snap_path) as f:
        d = json.load(f)
    return Snapshot.from_dict(d)


def list_snapshots(path: Optional[Path] = None) -> list:
    p = path or default_path()
    if not p.exists():
        return []
    snaps = []
    for f in sorted(p.glob("snap_*.json")):
        try:
            with open(f) as fh:
                d = json.load(fh)
            snaps.append({"snapshot_id": d["snapshot_id"],
                          "timestamp": d["timestamp"], "path": str(f)})
        except (json.JSONDecodeError, KeyError):
            continue
    return snaps


def self_test() -> str:
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        s = Snapshot(snapshot_id="test1", timestamp=time.time(),
                     advice_table={"x": 1}, primitive_stats={"E": 1})
        fpath = save(s, p)
        assert fpath.exists()
        loaded = load_latest(p)
        assert loaded is not None
        assert loaded.snapshot_id == "test1"
        assert loaded.advice_table == {"x": 1}
        snaps = list_snapshots(p)
        assert len(snaps) == 1
    return "persistence OK"


if __name__ == "__main__":
    print(self_test())
