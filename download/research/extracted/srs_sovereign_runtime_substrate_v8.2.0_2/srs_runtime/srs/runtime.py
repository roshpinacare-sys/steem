"""SRS Runtime — the unified entry point.

Wires together the 7 primitives, planner, persistence, and self-improvement
into a single executable platform.
"""
from __future__ import annotations
import hashlib
import json
import random
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .types import Task, Result, Snapshot, now_ms
from .planner import plan
from . import persistence
from .improvement import improve
from .primitives.advice import AdviceTable
from .primitives.execution import hash_bit


class Runtime:
    """The SRS Runtime. Execute, plan, persist, recover, verify, improve."""

    def __init__(self, home: Optional[Path] = None) -> None:
        self.home = home or persistence.default_path()
        self.advice = AdviceTable()
        self.primitive_stats: Dict[str, Dict[str, float]] = {}
        self.last_snapshot: Optional[Snapshot] = None
        # Try to recover from disk
        recovered = persistence.load_latest(self.home)
        if recovered is not None:
            self.advice = AdviceTable.from_dict(recovered.advice_table)
            self.primitive_stats = recovered.primitive_stats
            self.last_snapshot = recovered

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    def execute(self, task: Task) -> Result:
        """Execute a task. Dispatches by task.kind."""
        t0 = now_ms()
        axis, primitives = plan(task.kind, task.required_primitives)
        rng = random.Random(hash(task.task_id) & 0xFFFFFFFF)

        # Hypothesis-identification family
        if task.kind in ("identify", "identify_hard", "search"):
            r = self._execute_identify(task, primitives, rng)
        elif task.kind == "verify":
            r = self._execute_verify(task, rng)
        elif task.kind == "compute":
            r = self._execute_compute(task, rng)
        else:
            r = self._execute_identify(task, primitives, rng)

        t1 = now_ms()
        r.wall_time_ms = t1 - t0
        r.primitives_used = primitives

        # Update stats
        for p in primitives:
            stats = self.primitive_stats.setdefault(p, {"runs": 0, "successes": 0})
            stats["runs"] += 1
            if r.correct:
                stats["successes"] += 1

        # Self-improvement: seed advice on success
        if task.kind in ("identify", "identify_hard") and r.correct:
            hyps = task.payload.get("hypotheses")
            tgt = task.payload.get("target_idx")
            if hyps is not None and tgt is not None:
                improve(self.advice, hyps, tgt, r.correct)

        return r

    def plan_task(self, task: Task) -> Dict[str, Any]:
        """Plan a task without executing. Returns the chosen primitives."""
        axis, primitives = plan(task.kind, task.required_primitives)
        return {"task_id": task.task_id, "primary_axis": axis,
                "primitives": primitives, "task_kind": task.kind}

    def store_state(self) -> Path:
        """Persist current state to disk."""
        snap = Snapshot(
            snapshot_id=hashlib.sha256(str(time.time()).encode()).hexdigest()[:12],
            timestamp=time.time(),
            advice_table=self.advice.to_dict(),
            primitive_stats=self.primitive_stats,
        )
        path = persistence.save(snap, self.home)
        self.last_snapshot = snap
        return path

    def recover(self) -> bool:
        """Reload last snapshot from disk."""
        snap = persistence.load_latest(self.home)
        if snap is None:
            return False
        self.advice = AdviceTable.from_dict(snap.advice_table)
        self.primitive_stats = snap.primitive_stats
        self.last_snapshot = snap
        return True

    def capabilities(self) -> Dict[str, Any]:
        """Measurable capability report."""
        return {
            "version": "7.0.0",
            "primitives": ["E", "C", "A", "S", "V", "Adv", "Q"],
            "primitive_stats": self.primitive_stats,
            "advice_entries": len(self.advice._table),
            "advice_size_bytes": self.advice.size_bytes(),
            "snapshots": len(persistence.list_snapshots(self.home)),
            "last_snapshot_id": self.last_snapshot.snapshot_id if self.last_snapshot else None,
        }

    # ------------------------------------------------------------------
    # Internal dispatchers
    # ------------------------------------------------------------------

    def _execute_identify(self, task: Task, primitives: List[str],
                          rng: random.Random) -> Result:
        from .primitives import execution, compression, adaptivity, scheduling, verification, advice, quantum

        hyps: List[bytes] = task.payload["hypotheses"]
        target_idx: int = task.payload["target_idx"]
        n_features: int = task.payload.get("n_features", 12)
        budget: int = task.budget

        # Try advice first if available
        if "Adv" in primitives:
            cached = self.advice.lookup(hyps)
            if cached is not None:
                return Result(
                    task_id=task.task_id, answer=cached,
                    correct=cached == target_idx, verified=None,
                    primitives_used=primitives,
                    queries=0, storage_bytes=self.advice.size_bytes(),
                    work_units=1, depth=1,
                    notes={"used_advice": True, "advice_hit": True},
                )

        # Choose the most advanced primitive available, in order
        if "V" in primitives:
            r = verification.execute_identify(hyps, target_idx, n_features, budget, rng)
        elif "S" in primitives:
            r = scheduling.execute_identify(hyps, target_idx, n_features, budget, rng)
        elif "A" in primitives:
            r = adaptivity.execute_identify(hyps, target_idx, n_features, budget, rng)
        elif "C" in primitives:
            r = compression.execute_identify(hyps, target_idx, n_features, budget, rng)
        elif "Q" in primitives:
            r = quantum.execute_identify(hyps, target_idx, n_features, budget, rng)
        else:
            r = execution.execute_identify(hyps, target_idx, n_features, budget, rng)

        return Result(
            task_id=task.task_id, answer=r["best_idx"],
            correct=r["correct"], verified=r.get("verified"),
            primitives_used=primitives,
            queries=r["queries"], storage_bytes=r["storage_bytes"],
            work_units=r["work_units"], depth=r["depth"],
            communication_bits=r["communication_bits"],
            verification_calls=r["verification_calls"],
            notes=r.get("notes", {}),
        )

    def _execute_verify(self, task: Task, rng: random.Random) -> Result:
        from .primitives.verification import verify
        hyps = task.payload["hypotheses"]
        target = task.payload["target_idx"]
        candidate = task.payload["candidate_idx"]
        n_features = task.payload.get("n_features", 12)
        k = task.payload.get("verify_budget", 5)
        v = verify(hyps, target, candidate, n_features, k, rng)
        return Result(
            task_id=task.task_id, answer=v["verified"],
            correct=v["verified"], verified=v["verified"],
            primitives_used=["V"],
            verification_calls=v["verification_calls"],
            notes={"soundness_epsilon": v["soundness_epsilon"]},
        )

    def _execute_compute(self, task: Task, rng: random.Random) -> Result:
        """Generic compute: just run execution with budget steps."""
        n = task.payload.get("n", 1000)
        work = min(n, task.budget * 100)
        # Simulate: hash a counter
        h = hashlib.sha256()
        for i in range(work):
            h.update(i.to_bytes(8, "big"))
        return Result(
            task_id=task.task_id, answer=h.hexdigest()[:16],
            correct=True, primitives_used=["E", "S"],
            queries=0, storage_bytes=32,
            work_units=work, depth=work,
            notes={"hash": h.hexdigest()[:16]},
        )


def self_test() -> str:
    """End-to-end self-test."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        # Build a task
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
                    budget=16)
        r = rt.execute(task)
        assert r.correct, "identify failed"
        assert "A" in r.primitives_used
        # Plan
        p = rt.plan_task(task)
        assert "V" in p["primitives"]
        # Persist + recover
        path = rt.store_state()
        assert path.exists()
        rt2 = Runtime(home=Path(tmp))
        assert rt2.recover()
        assert rt2.advice.size_bytes() > 0  # advice was seeded by improve
        # Capabilities
        c = rt2.capabilities()
        assert c["version"] == "7.0.0"
        assert c["advice_entries"] >= 1
    return "runtime OK"


if __name__ == "__main__":
    print(self_test())
