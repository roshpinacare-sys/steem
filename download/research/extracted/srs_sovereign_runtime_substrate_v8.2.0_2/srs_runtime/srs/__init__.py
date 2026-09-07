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
  - plan(task)            : choose primitives for a task
  - store_state(snapshot) : persist to disk
  - recover()             : reload last snapshot
  - verify(result)        : probabilistic check
  - improve(experience)   : update advice table from outcomes
  - capabilities()        : measurable capability report
"""
from __future__ import annotations

__version__ = "7.0.0"

# Re-export the main Runtime class for convenience
from .runtime import Runtime
from .types import Task, Result, Snapshot

__all__ = ["Runtime", "Task", "Result", "Snapshot", "__version__"]

