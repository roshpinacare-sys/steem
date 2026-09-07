"""Tests for kernel/smpu_sppu.py — SmpuDriver, SppuDriver, DynamicSmpuController.

Target: push coverage from 46% to 70%+ by directly exercising:
  - SmpuDriver.program() / clear() / check_access() / dump()
  - SppuDriver.program() / check_access() / dump()
  - DynamicSmpuController.consume_telemetry() (ECR, thermal, photonic paths)
  - DynamicSmpuController.restore()
  - default_config()
"""
from __future__ import annotations

import pytest

from kernel.smpu_sppu import (
    SmpuDriver, SppuDriver, SmpuRegion, Perm, Peripheral, SppuRule,
    DynamicSmpuController, TelemetrySnapshot,
    ECR_CASCADE_THRESHOLD, THERMAL_REPARTITION_THRESHOLD,
    default_config,
)


# ---------------------------------------------------------------------------
# SmpuDriver
# ---------------------------------------------------------------------------

def test_smpu_program_returns_slot_index():
    """program() returns the slot index."""
    smpu = SmpuDriver()
    region = SmpuRegion(base=0x1000, size=0x100, owner="APU", perm=Perm.RWX)
    slot = smpu.program(region)
    assert slot == 0
    assert smpu.regions[0] is region


def test_smpu_program_multiple_regions():
    """Multiple program() calls return incrementing slot indices."""
    smpu = SmpuDriver()
    slot0 = smpu.program(SmpuRegion(base=0x1000, size=0x100, owner="APU", perm=Perm.RWX))
    slot1 = smpu.program(SmpuRegion(base=0x2000, size=0x100, owner="RPU", perm=Perm.RW))
    assert slot0 == 0
    assert slot1 == 1


def test_smpu_program_returns_negative_one_when_full():
    """program() returns -1 when all slots are used."""
    smpu = SmpuDriver()
    for i in range(smpu.MAX_REGIONS):
        smpu.program(SmpuRegion(base=0x1000 * i, size=0x100, owner="APU", perm=Perm.RWX))
    # Next program should fail
    slot = smpu.program(SmpuRegion(base=0xFFFF, size=0x100, owner="APU", perm=Perm.RWX))
    assert slot == -1


def test_smpu_clear_removes_region():
    """clear() removes the region at the given slot."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x1000, size=0x100, owner="APU", perm=Perm.RWX))
    assert smpu.clear(0) is True
    assert smpu.regions[0] is None


def test_smpu_clear_invalid_slot_returns_false():
    """clear() returns False for out-of-range slots."""
    smpu = SmpuDriver()
    assert smpu.clear(-1) is False
    assert smpu.clear(smpu.MAX_REGIONS) is False


def test_smpu_check_access_owner_allowed():
    """Owner domain can access its own region."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x1000, size=0x100, owner="APU", perm=Perm.RWX))
    assert smpu.check_access("APU", 0x1050, write=False) is True
    assert smpu.check_access("APU", 0x1050, write=True) is True


def test_smpu_check_access_non_owner_ti_denied():
    """Non-owner domain is denied access to TI-marked regions."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x1000, size=0x100, owner="APU",
                            perm=Perm.RWX, ti=True))
    assert smpu.check_access("RPU", 0x1050, write=False) is False


def test_smpu_check_access_non_owner_sc_with_seg_cert_allowed():
    """Non-owner domain can access SC-marked regions when SEG-certified."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x1000, size=0x100, owner="APU",
                            perm=Perm.RWX, ti=True, sc=True))
    assert smpu.check_access("RPU", 0x1050, write=False, seg_certified=True) is True


def test_smpu_check_access_non_owner_sc_without_seg_cert_denied():
    """Non-owner domain is denied SC-marked regions without SEG cert."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x1000, size=0x100, owner="APU",
                            perm=Perm.RWX, ti=True, sc=True))
    assert smpu.check_access("RPU", 0x1050, write=False, seg_certified=False) is False


def test_smpu_check_access_write_to_read_only_denied():
    """Write access to a read-only region is denied."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x1000, size=0x100, owner="APU", perm=Perm.RO))
    assert smpu.check_access("APU", 0x1050, write=True) is False
    assert smpu.check_access("APU", 0x1050, write=False) is True


def test_smpu_check_access_unmapped_address_denied():
    """Access to an unmapped address is default-denied."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x1000, size=0x100, owner="APU", perm=Perm.RWX))
    assert smpu.check_access("APU", 0xFFFF, write=False) is False


def test_smpu_check_access_non_ti_non_owner_allowed():
    """Non-owner domain can access non-TI regions (shared memory)."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x1000, size=0x100, owner="APU",
                            perm=Perm.RW, ti=False))
    assert smpu.check_access("RPU", 0x1050, write=False) is True


def test_smpu_dump_returns_list_of_dicts():
    """dump() returns a list of region dicts."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x1000, size=0x100, owner="APU", perm=Perm.RWX))
    smpu.program(SmpuRegion(base=0x2000, size=0x200, owner="RPU", perm=Perm.RW))
    dumped = smpu.dump()
    assert len(dumped) == 2
    assert dumped[0]["slot"] == 0
    assert dumped[0]["owner"] == "APU"
    assert dumped[1]["slot"] == 1
    assert dumped[1]["owner"] == "RPU"


def test_smpu_dump_empty_returns_empty_list():
    """dump() on an empty driver returns []."""
    smpu = SmpuDriver()
    assert smpu.dump() == []


# ---------------------------------------------------------------------------
# SppuDriver
# ---------------------------------------------------------------------------

def test_sppu_program_stores_rule():
    """program() stores the rule keyed by (peripheral, domain)."""
    sppu = SppuDriver()
    rule = SppuRule(peripheral=Peripheral.NISQ_CAL_BUS, domain="APU",
                    perm=Perm.RW, requires_seg_cert=True)
    sppu.program(rule)
    assert (Peripheral.NISQ_CAL_BUS, "APU") in sppu.rules


def test_sppu_check_access_owner_allowed():
    """Domain with a rule can access the peripheral."""
    sppu = SppuDriver()
    sppu.program(SppuRule(peripheral=Peripheral.FPGA_JTAG, domain="APU",
                          perm=Perm.RW, requires_seg_cert=False))
    assert sppu.check_access("APU", Peripheral.FPGA_JTAG, write=False) is True
    assert sppu.check_access("APU", Peripheral.FPGA_JTAG, write=True) is True


def test_sppu_check_access_unknown_domain_denied():
    """Unknown domain is default-denied."""
    sppu = SppuDriver()
    sppu.program(SppuRule(peripheral=Peripheral.FPGA_JTAG, domain="APU",
                          perm=Perm.RW, requires_seg_cert=False))
    assert sppu.check_access("RPU", Peripheral.FPGA_JTAG, write=False) is False


def test_sppu_check_access_seg_cert_required():
    """requires_seg_cert=True blocks access without SEG cert."""
    sppu = SppuDriver()
    sppu.program(SppuRule(peripheral=Peripheral.NISQ_CAL_BUS, domain="APU",
                          perm=Perm.RW, requires_seg_cert=True))
    assert sppu.check_access("APU", Peripheral.NISQ_CAL_BUS,
                             write=False, seg_certified=False) is False
    assert sppu.check_access("APU", Peripheral.NISQ_CAL_BUS,
                             write=False, seg_certified=True) is True


def test_sppu_check_access_write_to_read_only_denied():
    """Write access to a read-only peripheral is denied."""
    sppu = SppuDriver()
    sppu.program(SppuRule(peripheral=Peripheral.FPGA_JTAG, domain="APU",
                          perm=Perm.RO, requires_seg_cert=False))
    assert sppu.check_access("APU", Peripheral.FPGA_JTAG, write=True) is False
    assert sppu.check_access("APU", Peripheral.FPGA_JTAG, write=False) is True


def test_sppu_dump_returns_sorted_list():
    """dump() returns a list sorted by (peripheral, domain)."""
    sppu = SppuDriver()
    sppu.program(SppuRule(peripheral=Peripheral.FPGA_JTAG, domain="RPU",
                          perm=Perm.RW, requires_seg_cert=False))
    sppu.program(SppuRule(peripheral=Peripheral.NISQ_CAL_BUS, domain="APU",
                          perm=Perm.RW, requires_seg_cert=True))
    dumped = sppu.dump()
    assert len(dumped) == 2
    # Sorted by peripheral.value then domain
    assert dumped[0]["peripheral"] == Peripheral.FPGA_JTAG.value
    assert dumped[1]["peripheral"] == Peripheral.NISQ_CAL_BUS.value


# ---------------------------------------------------------------------------
# DynamicSmpuController
# ---------------------------------------------------------------------------

def _make_controller_with_regions():
    """Build a DynamicSmpuController with APU/RPU/FPGA regions programmed."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x40000000, size=0x100000,
                            owner="APU", perm=Perm.RWX, ti=True, sc=True))
    smpu.program(SmpuRegion(base=0x41000000, size=0x040000,
                            owner="RPU", perm=Perm.RWX, ti=True))
    smpu.program(SmpuRegion(base=0x42000000, size=0x080000,
                            owner="FPGA", perm=Perm.RWX, ti=True))
    return DynamicSmpuController(smpu)


def test_dyn_consume_telemetry_no_events_returns_empty():
    """Telemetry with no triggers produces no events."""
    dyn = _make_controller_with_regions()
    snap = TelemetrySnapshot(
        theta={"APU": 0.30, "RPU": 0.20, "FPGA": 0.30},
        ecr_rate={"APU": 0.001, "RPU": 0.001, "FPGA": 0.001},
        photonic_saturation=0.50,
        f_total=1.50,
    )
    events = dyn.consume_telemetry(
        snap, {"APU": 0, "RPU": 1, "FPGA": 2},
        seg_certify_fn=lambda esr_id: True,
    )
    assert events == []


def test_dyn_consume_telemetry_ecr_cascade_triggers_quarantine():
    """ECR rate above threshold triggers quarantine (perm → RO)."""
    dyn = _make_controller_with_regions()
    snap = TelemetrySnapshot(
        theta={"APU": 0.30, "RPU": 0.20, "FPGA": 0.30},
        ecr_rate={"APU": 0.001, "RPU": 0.001,
                  "FPGA": ECR_CASCADE_THRESHOLD + 0.01},  # above threshold
        photonic_saturation=0.50,
        f_total=1.50,
    )
    events = dyn.consume_telemetry(
        snap, {"APU": 0, "RPU": 1, "FPGA": 2},
        seg_certify_fn=lambda esr_id: True,
    )
    quarantine_events = [e for e in events if e["action"] == "ecr_quarantine"]
    assert len(quarantine_events) >= 1
    # FPGA region should now be RO
    fpga_region = dyn.smpu.regions[2]
    assert fpga_region is not None
    assert fpga_region.perm == Perm.RO


def test_dyn_consume_telemetry_thermal_surge_triggers_shrink():
    """Thermal above threshold triggers region shrink (size halved)."""
    dyn = _make_controller_with_regions()
    original_size = dyn.smpu.regions[2].size
    snap = TelemetrySnapshot(
        theta={"APU": 0.30, "RPU": 0.20, "FPGA": 0.90},  # high theta
        ecr_rate={"APU": 0.001, "RPU": 0.001, "FPGA": 0.001},
        photonic_saturation=0.50,
        f_total=1.50,
    )
    events = dyn.consume_telemetry(
        snap, {"APU": 0, "RPU": 1, "FPGA": 2},
        seg_certify_fn=lambda esr_id: True,
    )
    shrink_events = [e for e in events if e["action"] == "thermal_shrink"]
    assert len(shrink_events) >= 1
    # FPGA region should be shrunk
    fpga_region = dyn.smpu.regions[2]
    assert fpga_region is not None
    assert fpga_region.size == original_size // 2


def test_dyn_consume_telemetry_photonic_saturation_triggers_sc_promote():
    """Photonic saturation > 0.95 triggers SC promotion."""
    dyn = _make_controller_with_regions()
    snap = TelemetrySnapshot(
        theta={"APU": 0.30, "RPU": 0.20, "FPGA": 0.30},
        ecr_rate={"APU": 0.001, "RPU": 0.001, "FPGA": 0.001},
        photonic_saturation=0.97,  # above 0.95
        f_total=1.50,
    )
    events = dyn.consume_telemetry(
        snap, {"APU": 0, "RPU": 1, "FPGA": 2, "Photonic": 2},
        seg_certify_fn=lambda esr_id: True,
    )
    sc_events = [e for e in events if e["action"] == "sc_promote"]
    assert len(sc_events) >= 1


def test_dyn_consume_telemetry_seg_certify_false_blocks_events():
    """When seg_certify_fn returns False, no events are certified."""
    dyn = _make_controller_with_regions()
    snap = TelemetrySnapshot(
        theta={"APU": 0.30, "RPU": 0.20, "FPGA": 0.90},
        ecr_rate={"APU": 0.001, "RPU": 0.001, "FPGA": ECR_CASCADE_THRESHOLD + 0.01},
        photonic_saturation=0.50,
        f_total=1.50,
    )
    events = dyn.consume_telemetry(
        snap, {"APU": 0, "RPU": 1, "FPGA": 2},
        seg_certify_fn=lambda esr_id: False,  # reject all
    )
    assert events == []


def test_dyn_restore_returns_true_for_shrunk_region():
    """restore() returns True and restores the original size."""
    dyn = _make_controller_with_regions()
    original_size = dyn.smpu.regions[2].size
    # Trigger a shrink
    snap = TelemetrySnapshot(
        theta={"APU": 0.30, "RPU": 0.20, "FPGA": 0.90},
        ecr_rate={"APU": 0.001, "RPU": 0.001, "FPGA": 0.001},
        photonic_saturation=0.50, f_total=1.50,
    )
    dyn.consume_telemetry(snap, {"APU": 0, "RPU": 1, "FPGA": 2},
                          seg_certify_fn=lambda esr_id: True)
    # Restore
    assert dyn.restore(2) is True
    restored = dyn.smpu.regions[2]
    assert restored is not None
    assert restored.size == original_size


def test_dyn_restore_returns_false_for_unknown_slot():
    """restore() returns False for a slot that has no original_sizes entry
    (i.e. a slot that was never programmed)."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x1000, size=0x100, owner="APU", perm=Perm.RWX))
    dyn = DynamicSmpuController(smpu)
    # Slot 1 was never programmed → no original_sizes entry → restore fails
    assert dyn.restore(1) is False


# ---------------------------------------------------------------------------
# default_config()
# ---------------------------------------------------------------------------

def test_default_config_returns_smpu_and_sppu():
    """default_config() returns a (SmpuDriver, SppuDriver) tuple."""
    smpu, sppu = default_config()
    assert isinstance(smpu, SmpuDriver)
    assert isinstance(sppu, SppuDriver)
    # At least 3 regions programmed (APU, RPU, FPGA)
    assert smpu.next_slot >= 3
    # At least 1 SPPU rule programmed
    assert len(sppu.rules) >= 1


def test_default_config_apu_region_has_ti_and_sc():
    """The APU region in default_config has TI=True and SC=True."""
    smpu, _ = default_config()
    apu_region = smpu.regions[0]
    assert apu_region is not None
    assert apu_region.owner == "APU"
    assert apu_region.ti is True
    assert apu_region.sc is True
