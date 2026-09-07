"""Tests for the kernel/ module (Omnivisor, SMPU/SPPU, eBPF telemetry)."""
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_omnivisor_self_test():
    """Run omnivisor.py self-test and verify exit code 0."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "kernel" / "omnivisor.py")],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0
    assert "PASSED" in result.stdout


def test_smpu_sppu_self_test():
    """Run smpu_sppu.py self-test (includes dynamic repartition)."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "kernel" / "smpu_sppu.py")],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0
    assert "PASSED" in result.stdout
    assert "Dynamic SMPU repartition" in result.stdout


def test_ebpf_telemetry_self_test():
    """Run ebpf_telemetry.py self-test."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "kernel" / "ebpf_telemetry.py")],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0
    assert "PASSED" in result.stdout


def test_omnivisor_admissible_write():
    """Unit test: Omnivisor admissible_write enforces TI/SC."""
    sys.path.insert(0, str(REPO_ROOT))
    from kernel.omnivisor import Omnivisor, Domain, Page, PageAttribute

    ov = Omnivisor(seg_certify_fn=lambda esr_id: True)
    page = Page(pa=0x1000, size=4096, owner=Domain.APU,
                attrs=frozenset({PageAttribute.TI, PageAttribute.SC}),
                certified_by="esr-001")
    ov.install_page(page, esr_id="esr-001")
    assert ov.admissible_write(Domain.APU, 0x1000)       # owner
    assert ov.admissible_write(Domain.FPGA, 0x1000)      # SC + SEG cert


def test_smpu_dynamic_repartition_ecr_quarantine():
    """Unit test: ECR cascade triggers RO quarantine."""
    sys.path.insert(0, str(REPO_ROOT))
    from kernel.smpu_sppu import (
        SmpuDriver, SmpuRegion, Perm, DynamicSmpuController, TelemetrySnapshot,
    )

    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x40000000, size=0x100000,
                            owner="FPGA", perm=Perm.RWX, ti=True))
    dyn = DynamicSmpuController(smpu)
    snap = TelemetrySnapshot(
        theta={"FPGA": 0.5}, ecr_rate={"FPGA": 0.08},
        photonic_saturation=0.5, f_total=1.9,
    )
    events = dyn.consume_telemetry(snap, {"FPGA": 0},
                                    seg_certify_fn=lambda x: True)
    assert len(events) >= 1
    assert events[0]["action"] == "ecr_quarantine"
    assert smpu.regions[0].perm == Perm.RO


def test_ebpf_ring_buffer_pack_unpack():
    """Unit test: TelemetryEntry pack/unpack round-trip at 32 bytes."""
    sys.path.insert(0, str(REPO_ROOT))
    from kernel.ebpf_telemetry import TelemetryEntry, SignalClass, RING_ENTRY_SIZE

    e = TelemetryEntry(ts_ns=12345, signal_class=SignalClass.POWER_CLOCK,
                       source_id=0, value=0.75, raw=42, flags=0)
    packed = e.pack()
    assert len(packed) == RING_ENTRY_SIZE
    e2 = TelemetryEntry.unpack(packed)
    assert e2.ts_ns == e.ts_ns
    assert e2.signal_class == e.signal_class
    assert abs(e2.value - e.value) < 1e-9
