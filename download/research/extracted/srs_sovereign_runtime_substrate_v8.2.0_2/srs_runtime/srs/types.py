"""Data classes shared across the SRS runtime."""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple
import hashlib
import json
import time
import uuid


@dataclass
class Task:
    """A unit of work submitted to the runtime.

    kind: 'identify' | 'search' | 'optimize' | 'verify' | 'compute'
    payload: arbitrary dict with problem-specific data
    budget: max queries / steps / time-units allowed
    required_primitives: explicit override (otherwise planner chooses)
    """
    kind: str
    payload: Dict[str, Any]
    budget: int = 16
    required_primitives: Optional[List[str]] = None
    task_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])

    def fingerprint(self) -> str:
        h = hashlib.sha256(json.dumps({
            "kind": self.kind,
            "payload": self.payload,
            "budget": self.budget,
        }, sort_keys=True, default=str).encode()).hexdigest()
        return h[:16]


@dataclass
class Result:
    """Outcome of executing a Task."""
    task_id: str
    answer: Any
    correct: Optional[bool] = None
    verified: Optional[bool] = None
    primitives_used: List[str] = field(default_factory=list)
    queries: int = 0
    storage_bytes: int = 0
    work_units: int = 0
    depth: int = 0
    communication_bits: int = 0
    verification_calls: int = 0
    wall_time_ms: float = 0.0
    notes: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Snapshot:
    """A persistent runtime state snapshot."""
    snapshot_id: str
    timestamp: float
    advice_table: Dict[str, Any]
    primitive_stats: Dict[str, Any]
    last_task_id: Optional[str] = None
    last_result: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Snapshot":
        return cls(**d)


def now_ms() -> float:
    return time.perf_counter() * 1000.0
