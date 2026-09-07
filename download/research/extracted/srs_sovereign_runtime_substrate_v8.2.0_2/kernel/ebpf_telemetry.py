#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ebpf_telemetry.py
=================

eBPF-based Unified Telemetry Bus (UTB) reference implementation.

This module provides the Python-side ring-buffer consumer and the
eBPF program source for the producer side.  In production, the eBPF
programs are loaded into the kernel and attached to perf-event or
tracepoint sources; this module provides the testable consumer API
and the program source for reproducibility.

Adm linkage:
  - The UTB feeds hardware-level invariants (power, clock jitter, ECR
    gate errors) into the agent's decision loop, which is governed by
    Adm_thermal (Chapter 7.4).
  - Every eBPF program is itself an AdmissibleMutation and must
    assemble SQA quorum before attachment.
"""

from __future__ import annotations

import ctypes
import json
import mmap
import os
import struct
import time
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# 1. Ring-buffer layout (matches the C-side eBPF struct)
# ---------------------------------------------------------------------------

# Each ring entry is 32 bytes (matching the SRS spec, Chapter 2.2).
RING_ENTRY_SIZE = 32
RING_SIZE = 4 * 1024 * 1024  # 4 MiB
RING_CAPACITY = RING_SIZE // RING_ENTRY_SIZE  # 131072 entries


class SignalClass(IntEnum):
    POWER_CLOCK    = 1   # power consumption + clock jitter
    MEMORY_PRESSURE= 2   # per-domain MPAM counters
    ECR_GATE_ERROR = 3   # FPGA ECR block
    PHOTONIC_BUS   = 4   # optical link counters
    NISQ_FIDELITY  = 5   # QPU calibration feed


@dataclass
class TelemetryEntry:
    """A single 32-byte ring-buffer entry."""
    ts_ns: int          # timestamp in nanoseconds
    signal_class: SignalClass
    source_id: int      # island id (0=APU, 1=RPU, 2=FPGA, 3=Photonic, 4=NISQ, 5=IO)
    value: float        # normalised signal value
    raw: int            # raw counter value
    flags: int = 0

    def pack(self) -> bytes:
        """Pack into 32 bytes: ts_ns(8=Q) + class(1=B) + src(1=B) + pad(2=H)
        + value(8=d double) + raw(8=q) + flags(4=i) = 32."""
        return struct.pack("<QBBHdqi",
                           self.ts_ns, int(self.signal_class),
                           self.source_id, 0,
                           float(self.value), int(self.raw),
                           int(self.flags))

    @classmethod
    def unpack(cls, data: bytes) -> "TelemetryEntry":
        ts_ns, sc, src, _pad, val, raw, flags = struct.unpack("<QBBHdqi", data)
        return cls(ts_ns=ts_ns, signal_class=SignalClass(sc), source_id=src,
                   value=val, raw=raw, flags=flags)


# ---------------------------------------------------------------------------
# 2. Ring buffer
# ---------------------------------------------------------------------------

class RingBuffer:
    """A lock-free single-producer single-consumer ring buffer.

    The producer (eBPF program) writes to `head`; the consumer (this
    module) reads from `tail`.  Both are atomic 64-bit counters.
    In the Python reference, we simulate the buffer with a list; in
    production this would be a mmap'd shared region.
    """

    def __init__(self, name: str, capacity: int = RING_CAPACITY) -> None:
        self.name = name
        self.capacity = capacity
        self._buf: List[TelemetryEntry] = []
        self.head: int = 0   # producer writes here
        self.tail: int = 0   # consumer reads here
        self.dropped: int = 0

    def push(self, entry: TelemetryEntry) -> bool:
        """Producer side: push an entry.  Returns False if ring is full."""
        if len(self._buf) >= self.capacity:
            self.dropped += 1
            return False
        self._buf.append(entry)
        self.head += 1
        return True

    def pop(self) -> Optional[TelemetryEntry]:
        """Consumer side: pop the oldest entry."""
        if self.tail >= self.head:
            return None
        e = self._buf[self.tail % self.capacity]
        self.tail += 1
        return e

    def drain(self, max_n: int = 1000) -> List[TelemetryEntry]:
        """Drain up to `max_n` entries."""
        out = []
        for _ in range(max_n):
            e = self.pop()
            if e is None:
                break
            out.append(e)
        return out

    def stats(self) -> Dict[str, object]:
        return {
            "name": self.name, "capacity": self.capacity,
            "head": self.head, "tail": self.tail,
            "pending": self.head - self.tail, "dropped": self.dropped,
        }


# ---------------------------------------------------------------------------
# 3. Unified Telemetry Bus
# ---------------------------------------------------------------------------

class UnifiedTelemetryBus:
    """Aggregates per-island ring buffers into a single consumer view.

    The UTB is the single source of truth for all downstream reasoning.
    Agents that need historical telemetry issue FILTER operations
    against the AgeMem LTM store, where snapshots are persisted.
    """

    ISLAND_NAMES = ("APU", "RPU", "FPGA", "Photonic", "NISQ", "IO")

    def __init__(self) -> None:
        self.rings: Dict[str, RingBuffer] = {
            name: RingBuffer(name) for name in self.ISLAND_NAMES
        }
        # Attached eBPF programs (each is an AdmissibleMutation)
        self.attached_programs: List[Dict[str, Any]] = []

    def attach_ebpf(self, program_name: str, signal_class: SignalClass,
                    source_island: str, esr_id: str) -> bool:
        """Attach an eBPF program (subject to SEG certification).

        In production, this loads a BPF program into the kernel and
        attaches it to a perf-event source.  Here we record the
        attachment for audit.
        """
        self.attached_programs.append({
            "program": program_name,
            "signal_class": signal_class.name,
            "source_island": source_island,
            "esr_id": esr_id,   # SEG certification reference
            "attached_at": time.time(),
        })
        return True

    def emit(self, island: str, signal_class: SignalClass,
             value: float, raw: int = 0) -> bool:
        """Emit a telemetry entry from the given island."""
        if island not in self.rings:
            return False
        entry = TelemetryEntry(
            ts_ns=int(time.time_ns()),
            signal_class=signal_class,
            source_id=self.ISLAND_NAMES.index(island),
            value=value, raw=raw,
        )
        return self.rings[island].push(entry)

    def snapshot(self) -> Dict[str, Any]:
        """Take a unified snapshot of all islands' latest values."""
        islands: Dict[str, Dict[str, Any]] = {}
        for name, ring in self.rings.items():
            latest = ring._buf[-1] if ring._buf else None
            islands[name] = {
                "stats": ring.stats(),
                "latest": {
                    "signal_class": latest.signal_class.name if latest else None,
                    "value": latest.value if latest else None,
                    "ts_ns": latest.ts_ns if latest else None,
                },
            }
        snap: Dict[str, Any] = {"ts": time.time(), "islands": islands}
        return snap

    def drain_all(self, max_n: int = 100) -> Dict[str, List[Dict]]:
        """Drain up to `max_n` entries from every island's ring."""
        out = {}
        for name, ring in self.rings.items():
            entries = ring.drain(max_n)
            out[name] = [
                {"ts_ns": e.ts_ns, "signal": e.signal_class.name,
                 "value": e.value, "raw": e.raw}
                for e in entries
            ]
        return out


# ---------------------------------------------------------------------------
# 4. eBPF program source (for the producer side)
# ---------------------------------------------------------------------------

EBPF_POWER_CLOCK_SRC = r"""
/* eBPF program: power_clock_probe
 * Attached to: perf-event (hardware PMU counter)
 * Output: ring buffer `telemetry_ring`
 * Entry layout: 32 bytes (see TelemetryEntry.pack)
 */
struct telemetry_entry {
    u64 ts_ns;
    u8  signal_class;   /* 1 = POWER_CLOCK */
    u8  source_id;      /* island id */
    u16 pad;
    double value;       /* normalised power consumption */
    u64 raw;            /* raw PMU counter */
    u32 flags;
} __attribute__((packed));

BPF_PERF_OUTPUT(telemetry_ring);

int power_clock_probe(struct bpf_perf_event_data *ctx) {
    struct telemetry_entry e = {};
    e.ts_ns = bpf_ktime_get_ns();
    e.signal_class = 1;
    e.source_id = 0;  /* APU */
    e.value = (double)ctx->sample_period / 1000000.0;
    e.raw = ctx->counter;
    telemetry_ring.perf_submit(ctx, &e, sizeof(e));
    return 0;
}
"""

EBPF_ECR_GATE_ERROR_SRC = r"""
/* eBPF program: ecr_gate_error_probe
 * Attached to: tracepoint (FPGA soft-IP ECR block interrupt)
 * Output: ring buffer `telemetry_ring`
 */
struct telemetry_entry {
    u64 ts_ns;
    u8  signal_class;   /* 3 = ECR_GATE_ERROR */
    u8  source_id;      /* island id (2 = FPGA) */
    u16 pad;
    double value;       /* normalised error rate */
    u64 raw;            /* raw error count */
    u32 flags;
} __attribute__((packed));

BPF_PERF_OUTPUT(telemetry_ring);

TRACEPOINT_PROBE(fpga_ecr, error_interrupt) {
    struct telemetry_entry e = {};
    e.ts_ns = bpf_ktime_get_ns();
    e.signal_class = 3;
    e.source_id = 2;  /* FPGA */
    e.value = (double)args->error_count / 1000.0;
    e.raw = args->error_count;
    e.flags = args->error_type;
    telemetry_ring.perf_submit(args, &e, sizeof(e));
    return 0;
}
"""


# ---------------------------------------------------------------------------
# 5. Self-test
# ---------------------------------------------------------------------------

def self_test() -> None:
    print("=" * 78)
    print("eBPF Unified Telemetry Bus — self-test")
    print("=" * 78)

    utb = UnifiedTelemetryBus()

    # Attach eBPF programs (with SEG stub)
    utb.attach_ebpf("power_clock_probe", SignalClass.POWER_CLOCK,
                    "APU", esr_id="esr-ebpf-001")
    utb.attach_ebpf("ecr_gate_error_probe", SignalClass.ECR_GATE_ERROR,
                    "FPGA", esr_id="esr-ebpf-002")
    print(f"  Attached eBPF programs: {len(utb.attached_programs)}")

    # Emit some telemetry
    for i in range(5):
        utb.emit("APU", SignalClass.POWER_CLOCK, value=0.5 + 0.1 * i,
                 raw=1000 * (i + 1))
        utb.emit("FPGA", SignalClass.ECR_GATE_ERROR, value=0.083,
                 raw=83 + i)

    snap = utb.snapshot()
    print(f"  APU latest: {snap['islands']['APU']['latest']}")
    print(f"  FPGA latest: {snap['islands']['FPGA']['latest']}")

    drained = utb.drain_all(max_n=10)
    print(f"  Drained APU entries: {len(drained['APU'])}")
    print(f"  Drained FPGA entries: {len(drained['FPGA'])}")

    assert len(drained["APU"]) == 5
    assert len(drained["FPGA"]) == 5
    assert drained["APU"][0]["signal"] == "POWER_CLOCK"
    assert drained["FPGA"][0]["signal"] == "ECR_GATE_ERROR"

    # Verify pack/unpack round-trip
    e = TelemetryEntry(ts_ns=12345, signal_class=SignalClass.POWER_CLOCK,
                       source_id=0, value=0.75, raw=42, flags=0)
    packed = e.pack()
    assert len(packed) == RING_ENTRY_SIZE, f"packed size {len(packed)} != {RING_ENTRY_SIZE}"
    e2 = TelemetryEntry.unpack(packed)
    assert e2.ts_ns == e.ts_ns
    assert e2.signal_class == e.signal_class
    assert e2.value == e.value
    print(f"  Pack/unpack round-trip: {RING_ENTRY_SIZE} bytes ✓")

    print("=" * 78)
    print("eBPF UTB self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()  # pragma: no cover
