"""
SRS Runtime — Sovereign Runtime Substrate
==========================================

Unified executable platform integrating the 7-primitive taxonomy
(v6.46: C, A, S, V, E, Adv, Q) with the recovered codebase
(kernel, cognition, governance, self_healing, simulation).

Each primitive is bound to a concrete executable module:

  E  (Execution)      -> srs.primitives.execution      : baseline task runner
  C  (Compression)    -> srs.primitives.compression    : Lempel-Ziv + dictionary
  A  (Adaptivity)     -> srs.primitives.adaptivity     : information-gain query
  S  (Scheduling)     -> srs.primitives.scheduling     : parallel+locality-aware
  V  (Verification)   -> srs.primitives.verification   : PCP-style probe check
  Adv (Advice)        -> srs.primitives.advice         : non-uniform lookup table
  Q  (Quantum)        -> srs.primitives.quantum        : simulated BQP sampler

The runtime provides:
  - execute(task)         : run a task using selected primitives
  - plan_task(task)       : choose primitives for a task (returns cost estimate)
  - store_state()         : persist to disk (HMAC-protected snapshot)
  - recover()             : reload last snapshot (verifies HMAC)
  - resume_interrupted()  : check for and return interrupted task state
  - capabilities()        : measurable capability report
  - execute_async(task)   : async version of execute() (non-blocking)
"""
from __future__ import annotations

__version__ = "8.2.0"

# Re-export the main Runtime class for convenience
from .runtime import Runtime
from .types import Result, Snapshot, Task

__all__ = ["Runtime", "Task", "Result", "Snapshot", "__version__"]

