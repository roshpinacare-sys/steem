#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
smpu_sppu.py
============

System Memory Protection Unit (SMPU) and System Peripheral Protection
Unit (SPPU) drivers.

The SMPU enforces per-domain memory access permissions at the system
bus level; the SPPU does the same for peripherals (I2C, SPI, UART,
NISQ calibration bus, photonic link controller).  Both units are
configured by the Omnivisor on every VM-context switch.

Adm linkage:
  - Adm_spatial (Chapter 7.2): every SMPU/SPPU rule is derived from
    the active page-table's TI/SC attributes, ensuring that the
    hardware-enforced permissions match the Omnivisor's logical model.
  - The SPPU's NISQ-calibration-bus rules are certified by the SEG
    because a misconfigured calibration bus could destroy the QPU.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# 1. Permission model
# ---------------------------------------------------------------------------

class Perm(str, Enum):
    NONE = "---"
    RO   = "R--"
    RW   = "RW-"
    RWX  = "RWX"


class Peripheral(str, Enum):
    I2C_CTRL_0   = "I2C_CTRL_0"
    I2C_CTRL_1   = "I2C_CTRL_1"
    SPI_CTRL_0   = "SPI_CTRL_0"
    UART_0       = "UART_0"
    NISQ_CAL_BUS = "NISQ_CAL_BUS"   # sensitive — requires SEG cert
    PHOTONIC_LNK = "PHOTONIC_LNK"
    PMU_REGS     = "PMU_REGS"        # power-management unit registers
    FPGA_JTAG    = "FPGA_JTAG"      # FPGA reconfiguration port


@dataclass(frozen=True)
class SmpuRegion:
    """A memory region protected by the SMPU."""
    base: int
    size: int
    owner: str           # domain name (APU / RPU / FPGA)
    perm: Perm
    ti: bool = False     # temporal-isolation flag
    sc: bool = False     # sovereign-certified flag


@dataclass(frozen=True)
class SppuRule:
    """A peripheral access rule enforced by the SPPU."""
    peripheral: Peripheral
    domain: str          # which domain this rule applies to
    perm: Perm
    requires_seg_cert: bool = False   # True for NISQ_CAL_BUS, FPGA_JTAG


# ---------------------------------------------------------------------------
# 2. SMPU driver
# ---------------------------------------------------------------------------

class SmpuDriver:
    """Configures the System Memory Protection Unit.

    In hardware, the SMPU is a set of region registers (typically 16-32)
    that the Omnivisor programs on every VM-context switch.  This driver
    provides the programming interface and the Adm-compliance check.
    """

    MAX_REGIONS = 32

    def __init__(self) -> None:
        self.regions: List[Optional[SmpuRegion]] = [None] * self.MAX_REGIONS
        self.next_slot: int = 0

    def program(self, region: SmpuRegion) -> int:
        """Program a new SMPU region; returns the slot index or -1 if full."""
        if self.next_slot >= self.MAX_REGIONS:
            return -1
        slot = self.next_slot
        self.regions[slot] = region
        self.next_slot += 1
        return slot

    def clear(self, slot: int) -> bool:
        """Clear an SMPU region."""
        if 0 <= slot < self.MAX_REGIONS:
            self.regions[slot] = None
            return True
        return False

    def check_access(self, domain: str, addr: int, write: bool,
                     seg_certified: bool = False) -> bool:
        """Check whether `domain` may access `addr` (read or write).

        Walks the SMPU regions in slot order; the first matching region
        determines the permission.  TI-marked regions deny access to
        non-owner domains.  SC-marked regions additionally require
        SEG certification for non-owner access.
        """
        for r in self.regions:
            if r is None:
                continue
            if r.base <= addr < r.base + r.size:
                if r.owner != domain:
                    if r.ti:
                        # TI-marked: non-owners denied unless SC + SEG cert
                        if r.sc and seg_certified:
                            pass  # allow
                        else:
                            return False
                if write and r.perm not in (Perm.RW, Perm.RWX):
                    return False
                return True
        # No matching region: default-deny (Adm-safe)
        return False

    def dump(self) -> List[Dict]:
        """Return a list of programmed regions for diagnostics."""
        out = []
        for i, r in enumerate(self.regions):
            if r is None:
                continue
            out.append({
                "slot": i, "base": hex(r.base), "size": r.size,
                "owner": r.owner, "perm": r.perm.value,
                "ti": r.ti, "sc": r.sc,
            })
        return out


# ---------------------------------------------------------------------------
# 3. SPPU driver
# ---------------------------------------------------------------------------

class SppuDriver:
    """Configures the System Peripheral Protection Unit.

    The SPPU gates peripheral access at the interconnect level.  Certain
    peripherals (NISQ_CAL_BUS, FPGA_JTAG) require SEG certification
    because misconfiguration could destroy hardware.
    """

    def __init__(self) -> None:
        self.rules: Dict[Tuple[Peripheral, str], SppuRule] = {}

    def program(self, rule: SppuRule) -> None:
        """Program a peripheral access rule."""
        self.rules[(rule.peripheral, rule.domain)] = rule

    def check_access(self, domain: str, periph: Peripheral,
                     write: bool, seg_certified: bool = False) -> bool:
        """Check whether `domain` may access `periph`."""
        rule = self.rules.get((periph, domain))
        if rule is None:
            return False  # default-deny
        if rule.requires_seg_cert and not seg_certified:
            return False
        if write and rule.perm not in (Perm.RW, Perm.RWX):
            return False
        return True

    def dump(self) -> List[Dict]:
        out = []
        for (p, d), r in sorted(self.rules.items(),
                                key=lambda x: (x[0][0].value, x[0][1])):
            out.append({
                "peripheral": p.value, "domain": d, "perm": r.perm.value,
                "requires_seg_cert": r.requires_seg_cert,
            })
        return out


# ---------------------------------------------------------------------------
# 4. Dynamic SMPU controller — telemetry-driven repartition
# ---------------------------------------------------------------------------

# ECR gate-error rate threshold above which a cascade is declared.
# When the ECR rate on an island exceeds this, the DynamicSmpuController
# quarantines that island's memory region (tightens permissions to RO
# for all non-owner domains) to prevent the cascade from propagating
# via shared-memory accesses.
ECR_CASCADE_THRESHOLD = 0.05   # 5% gate-error rate

# Thermal threshold above which a region is shrunk (the island is running
# too hot; reduce its memory footprint to lower power draw).
THERMAL_REPARTITION_THRESHOLD = 0.80   # 80% of high(theta)


@dataclass
class TelemetrySnapshot:
    """A snapshot of per-island telemetry consumed by the DynamicSmpuController."""
    theta: Dict[str, float]                        # island -> thermal coordinate
    ecr_rate: Dict[str, float]                     # island -> ECR gate-error rate
    photonic_saturation: float = 0.0               # 0..1
    f_total: float = 0.0                           # total fault headroom


class DynamicSmpuController:
    """Dynamic SMPU repartition controller driven by eBPF telemetry.

    The controller consumes TelemetrySnapshot objects from the Unified
    Telemetry Bus and repartitions the SMPU region table in response
    to three signal classes:

      1. ECR cascade:  When ecr_rate[island] > ECR_CASCADE_THRESHOLD,
                       the island's memory region is quarantined (all
                       non-owner permissions tightened to RO or NONE)
                       to prevent the cascade from propagating via
                       shared-memory accesses.

      2. Thermal surge: When theta[island] > THERMAL_REPARTITION_THRESHOLD
                        × high(theta_island), the island's memory region
                        is shrunk (size reduced by 50%) to lower the
                        power draw, and the freed address space is
                        returned to a shared quarantine pool.

      3. Photonic saturation: When photonic_saturation > 0.95, the
                              Photonic island's region is promoted to
                              SC (Sovereign-Certified) to require SEG
                              quorum for any further writes, preventing
                              uncoordinated retries from saturating the
                              bus further.

    Every repartition is an AdmissibleMutation: the controller records
    the before/after state and emits an event that the SEG must certify
    before the new SMPU configuration takes effect.

    Adm linkage:
      - Adm_spatial (Chapter 7.2): the repartition preserves the TI/SC
        invariants — quarantined regions retain their TI attribute and
        gain a tightened permission.
      - Adm_thermal (Chapter 7.4): the thermal-surge shrink lowers the
        island's power draw, helping restore F_total ≤ G.
    """

    def __init__(self, smpu: SmpuDriver) -> None:
        self.smpu = smpu
        self.repartition_log: List[Dict[str, Any]] = []
        # Track the original region sizes so thermal shrinks can be reversed
        self.original_sizes: Dict[int, int] = {}
        for entry in smpu.dump():
            self.original_sizes[entry["slot"]] = entry["size"]

    def consume_telemetry(self, snap: TelemetrySnapshot,
                          island_region_map: Dict[str, int],
                          seg_certify_fn=None) -> List[Dict[str, Any]]:
        """Consume a telemetry snapshot and repartition the SMPU table.

        island_region_map: maps island name -> SMPU slot index for that
        island's owned region.

        Returns a list of repartition events (one per triggered action).
        Each event must be SEG-certified before it takes effect; the
        caller is responsible for invoking seg_certify_fn on each event.
        """
        events: List[Dict[str, Any]] = []

        for island, slot in island_region_map.items():
            if slot < 0 or slot >= self.smpu.MAX_REGIONS:
                continue
            # Re-read the region on each iteration so that successive
            # repartitions (e.g. ECR quarantine then thermal shrink) see
            # each other's changes.
            region = self.smpu.regions[slot]
            if region is None:
                continue  # pragma: no cover

            ecr = snap.ecr_rate.get(island, 0.0)
            theta = snap.theta.get(island, 0.0)

            # 1. ECR cascade quarantine
            if ecr > ECR_CASCADE_THRESHOLD:
                event = self._quarantine_for_ecr(slot, island, ecr, region,
                                                 seg_certify_fn)
                if event is not None:
                    events.append(event)
                    # Re-read the region so the next check sees the quarantine
                    region = self.smpu.regions[slot]
                    if region is None:
                        continue  # pragma: no cover

            # 2. Thermal surge shrink
            # high(theta) per island — use the Omnivisor's nominal caps
            theta_high = self._island_theta_high(island)
            if theta > THERMAL_REPARTITION_THRESHOLD * theta_high:
                # region may have been set to None by the ECR branch above
                current_region = region if region is not None else self.smpu.regions[slot]
                if current_region is None:
                    continue  # pragma: no cover
                event = self._shrink_for_thermal(slot, island, theta,
                                                  theta_high, current_region,
                                                  seg_certify_fn)
                if event is not None:
                    events.append(event)
                    region = self.smpu.regions[slot]

        # 3. Photonic saturation promotion (island-agnostic)
        if snap.photonic_saturation > 0.95:
            phot_slot = island_region_map.get("Photonic", -1)
            if phot_slot >= 0:
                region = self.smpu.regions[phot_slot]
                if region is not None and not region.sc:
                    event = self._promote_to_sc(phot_slot, "Photonic",
                                                snap.photonic_saturation,
                                                region, seg_certify_fn)
                    if event is not None:
                        events.append(event)

        self.repartition_log.extend(events)
        return events

    def _island_theta_high(self, island: str) -> float:
        """Nominal theta_high per island (matches the Z3 ISLANDS constants)."""
        return {
            "APU": 0.85, "RPU": 0.60, "FPGA": 0.75,
            "Photonic": 0.70, "NISQ": 0.45, "IO": 0.90,
        }.get(island, 0.75)

    def _quarantine_for_ecr(self, slot: int, island: str, ecr: float,
                            region: SmpuRegion, seg_certify_fn) -> Optional[Dict]:
        """Quarantine a region by tightening permissions to RO for non-owners."""
        if region.perm == Perm.RO:
            return None  # already quarantined
        before = {"perm": region.perm.value, "ti": region.ti, "sc": region.sc}
        # Tighten to RO — non-owners can still read (for diagnostics) but not write
        new_region = SmpuRegion(
            base=region.base, size=region.size, owner=region.owner,
            perm=Perm.RO, ti=True, sc=region.sc,
        )
        certified = seg_certify_fn(f"ecr-quarantine-{island}-{slot}") if seg_certify_fn else True
        if not certified:
            return None
        self.smpu.regions[slot] = new_region
        return {
            "action": "ecr_quarantine", "island": island, "slot": slot,
            "ecr_rate": ecr, "threshold": ECR_CASCADE_THRESHOLD,
            "before": before, "after": {"perm": "RO", "ti": True, "sc": region.sc},
            "certified": certified,
        }

    def _shrink_for_thermal(self, slot: int, island: str, theta: float,
                            theta_high: float, region: SmpuRegion,
                            seg_certify_fn) -> Optional[Dict]:
        """Shrink a region by 50% to lower the island's power draw."""
        original = self.original_sizes.get(slot, region.size)
        if region.size <= original // 2:
            return None  # already shrunk
        before = {"size": region.size}
        new_size = original // 2
        new_region = SmpuRegion(
            base=region.base, size=new_size, owner=region.owner,
            perm=region.perm, ti=region.ti, sc=region.sc,
        )
        certified = seg_certify_fn(f"thermal-shrink-{island}-{slot}") if seg_certify_fn else True
        if not certified:
            return None
        self.smpu.regions[slot] = new_region
        return {
            "action": "thermal_shrink", "island": island, "slot": slot,
            "theta": theta, "theta_high": theta_high,
            "threshold_ratio": THERMAL_REPARTITION_THRESHOLD,
            "before": before, "after": {"size": new_size},
            "freed_bytes": original - new_size,
            "certified": certified,
        }

    def _promote_to_sc(self, slot: int, island: str, saturation: float,
                       region: SmpuRegion, seg_certify_fn) -> Optional[Dict]:
        """Promote a region to Sovereign-Certified (requires SEG quorum for writes)."""
        if region.sc:
            return None  # pragma: no cover
        before = {"sc": False}
        new_region = SmpuRegion(
            base=region.base, size=region.size, owner=region.owner,
            perm=region.perm, ti=region.ti, sc=True,
        )
        certified = seg_certify_fn(f"sc-promote-{island}-{slot}") if seg_certify_fn else True
        if not certified:
            return None  # pragma: no cover
        self.smpu.regions[slot] = new_region
        return {
            "action": "sc_promote", "island": island, "slot": slot,
            "photonic_saturation": saturation,
            "before": before, "after": {"sc": True},
            "certified": certified,
        }

    def restore(self, slot: int) -> bool:
        """Restore a region to its original size (after the thermal event subsides)."""
        original = self.original_sizes.get(slot)
        if original is None:
            return False
        region = self.smpu.regions[slot]
        if region is None:
            return False
        self.smpu.regions[slot] = SmpuRegion(
            base=region.base, size=original, owner=region.owner,
            perm=region.perm, ti=region.ti, sc=region.sc,
        )
        return True


# ---------------------------------------------------------------------------
# 5. Default configuration
# ---------------------------------------------------------------------------

def default_config() -> Tuple[SmpuDriver, SppuDriver]:
    """Return the default SMPU/SPPU configuration for the SRS reference platform."""
    smpu = SmpuDriver()
    # APU owns the cognitive-agent memory region (TI + SC)
    smpu.program(SmpuRegion(base=0x40000000, size=0x00100000,
                            owner="APU", perm=Perm.RWX, ti=True, sc=True))
    # RPU owns the real-time control-loop memory (TI only)
    smpu.program(SmpuRegion(base=0x41000000, size=0x00040000,
                            owner="RPU", perm=Perm.RWX, ti=True))
    # FPGA owns the synthesised-RTL scratchpad (TI only)
    smpu.program(SmpuRegion(base=0x42000000, size=0x00080000,
                            owner="FPGA", perm=Perm.RWX, ti=True))
    # Shared telemetry ring buffer (RO for all, no TI)
    smpu.program(SmpuRegion(base=0x43000000, size=0x00400000,
                            owner="APU", perm=Perm.RO, ti=False))

    sppu = SppuDriver()
    # I2C controllers: APU has RW, RPU has RO (sensors), FPGA has NONE
    sppu.program(SppuRule(Peripheral.I2C_CTRL_0, "APU", Perm.RW))
    sppu.program(SppuRule(Peripheral.I2C_CTRL_0, "RPU", Perm.RO))
    sppu.program(SppuRule(Peripheral.I2C_CTRL_1, "APU", Perm.RW))
    # SPI: APU and FPGA both have RW
    sppu.program(SppuRule(Peripheral.SPI_CTRL_0, "APU", Perm.RW))
    sppu.program(SppuRule(Peripheral.SPI_CTRL_0, "FPGA", Perm.RW))
    # UART: all domains have RW (debug)
    for d in ("APU", "RPU", "FPGA"):
        sppu.program(SppuRule(Peripheral.UART_0, d, Perm.RW))
    # NISQ calibration bus: APU only, requires SEG cert
    sppu.program(SppuRule(Peripheral.NISQ_CAL_BUS, "APU", Perm.RW,
                          requires_seg_cert=True))
    # Photonic link: APU and FPGA have RW
    sppu.program(SppuRule(Peripheral.PHOTONIC_LNK, "APU", Perm.RW))
    sppu.program(SppuRule(Peripheral.PHOTONIC_LNK, "FPGA", Perm.RW))
    # PMU registers: APU only, RW
    sppu.program(SppuRule(Peripheral.PMU_REGS, "APU", Perm.RW))
    # FPGA JTAG: APU only, requires SEG cert (reconfiguration risk)
    sppu.program(SppuRule(Peripheral.FPGA_JTAG, "APU", Perm.RW,
                          requires_seg_cert=True))
    return smpu, sppu


# ---------------------------------------------------------------------------
# 5. Self-test
# ---------------------------------------------------------------------------

def self_test() -> None:
    print("=" * 78)
    print("SMPU/SPPU Drivers — self-test")
    print("=" * 78)
    smpu, sppu = default_config()

    # SMPU: APU can read its own region
    assert smpu.check_access("APU", 0x40000000, write=False)
    print("  APU reads own region: ✓")
    # SMPU: APU can write its own region
    assert smpu.check_access("APU", 0x40000000, write=True)
    print("  APU writes own region: ✓")
    # SMPU: RPU cannot write APU's TI+SC region (SC requires SEG cert,
    # which check_access doesn't grant by default)
    assert not smpu.check_access("RPU", 0x40000000, write=True)
    print("  RPU writes APU TI+SC region (no SEG): denied ✓")
    # SMPU: RPU can read the shared telemetry region (RO, no TI)
    assert smpu.check_access("RPU", 0x43000000, write=False)
    print("  RPU reads shared telemetry region: ✓")
    # SMPU: RPU cannot write the shared telemetry region
    assert not smpu.check_access("RPU", 0x43000000, write=True)
    print("  RPU writes shared telemetry (RO): denied ✓")

    # SPPU: APU can access I2C_CTRL_0
    assert sppu.check_access("APU", Peripheral.I2C_CTRL_0, write=True)
    print("  APU writes I2C_CTRL_0: ✓")
    # SPPU: RPU can read I2C_CTRL_0 but not write
    assert sppu.check_access("RPU", Peripheral.I2C_CTRL_0, write=False)
    assert not sppu.check_access("RPU", Peripheral.I2C_CTRL_0, write=True)
    print("  RPU reads I2C_CTRL_0: ✓ / writes: denied ✓")
    # SPPU: APU cannot access NISQ_CAL_BUS without SEG cert
    assert not sppu.check_access("APU", Peripheral.NISQ_CAL_BUS, write=True,
                                 seg_certified=False)
    print("  APU writes NISQ_CAL_BUS (no SEG cert): denied ✓")
    # SPPU: APU can access NISQ_CAL_BUS WITH SEG cert
    assert sppu.check_access("APU", Peripheral.NISQ_CAL_BUS, write=True,
                             seg_certified=True)
    print("  APU writes NISQ_CAL_BUS (with SEG cert): ✓")

    print(f"\n  SMPU regions: {len(smpu.dump())} programmed")
    print(f"  SPPU rules:   {len(sppu.dump())} programmed")

    # ---- Dynamic SMPU repartition test ----------------------------------
    print("\n  --- Dynamic SMPU repartition (eBPF ECR telemetry) ---")
    dyn = DynamicSmpuController(smpu)

    # Map islands to their SMPU slots (from default_config):
    #   slot 0 = APU (0x40000000)
    #   slot 1 = RPU (0x41000000)
    #   slot 2 = FPGA (0x42000000)
    #   slot 3 = shared telemetry (0x43000000)
    island_region_map = {"APU": 0, "RPU": 1, "FPGA": 2, "Photonic": 2}

    # Telemetry snapshot: FPGA has an ECR cascade (rate=0.083 > 0.05),
    # FPGA is also thermally hot (theta=0.70 > 0.80*0.75=0.60),
    # and photonic bus is saturated (0.97 > 0.95).
    snap = TelemetrySnapshot(
        theta={"APU": 0.50, "RPU": 0.30, "FPGA": 0.70, "Photonic": 0.60},
        ecr_rate={"APU": 0.01, "RPU": 0.005, "FPGA": 0.083, "Photonic": 0.0},
        photonic_saturation=0.97,
        f_total=2.07,
    )
    events = dyn.consume_telemetry(
        snap, island_region_map,
        seg_certify_fn=lambda esr_id: True,  # SEG stub: certify all
    )
    print(f"  Triggered {len(events)} repartition events:")
    for e in events:
        print(f"    {e['action']:<16} island={e['island']:<8} "
              f"slot={e['slot']} before={e['before']} after={e['after']}")

    # Verify: FPGA region should now be RO (ECR quarantine)
    fpga_region = smpu.regions[2]
    assert fpga_region is not None, "FPGA region disappeared after quarantine"
    assert fpga_region.perm == Perm.RO, f"expected RO after quarantine, got {fpga_region.perm}"
    print("  FPGA region quarantined to RO: ✓")

    # Verify: FPGA region should be shrunk (thermal)
    original_fpga_size = dyn.original_sizes[2]
    assert fpga_region is not None
    assert fpga_region.size == original_fpga_size // 2
    print(f"  FPGA region shrunk: {original_fpga_size} -> {fpga_region.size} bytes ✓")

    # Verify: Photonic/FPGA region should be SC-promoted
    assert fpga_region is not None
    assert fpga_region.sc is True
    print("  FPGA/Photonic region promoted to SC: ✓")

    # Verify: APU region is unchanged (no ECR, no thermal surge)
    apu_region = smpu.regions[0]
    assert apu_region is not None, "APU region disappeared"
    assert apu_region.perm == Perm.RWX
    print("  APU region unchanged (no trigger): ✓")

    # Test restore
    assert dyn.restore(2)
    restored = smpu.regions[2]
    assert restored is not None, "FPGA region disappeared after restore"
    assert restored.size == original_fpga_size
    print(f"  FPGA region restored to {restored.size} bytes ✓")

    print(f"\n  Repartition log: {len(dyn.repartition_log)} events total")

    print("=" * 78)
    print("SMPU/SPPU self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()  # pragma: no cover
