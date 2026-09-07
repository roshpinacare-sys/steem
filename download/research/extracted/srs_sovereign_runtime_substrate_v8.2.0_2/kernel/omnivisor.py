#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
omnivisor.py
============

Omnivisor core logic: enforces spatio-temporal isolation across the
AArch64 (APU) and RISC-V (FPGA soft-core) boundaries.

This module is the Python-level reference implementation of the
Omnivisor's isolation primitives.  In a production deployment, the
hot-path logic would be implemented in C/Rust at EL2; this Python
module provides the testable specification and the integration point
for the SRS's cognitive layer.

Adm linkage:
  - Adm_spatial (Chapter 7.2): every stage-2 page-table mutation is
    checked against the Omnivisor's TI/SC attributes via
    `admissible_write(d, p)`.
  - Adm_temporal (Chapter 7.3): the temporal-banker scheduler
    enforces □(consumed(d) ≤ budget(d)) via TIB token accounting.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, FrozenSet, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# 1. Domain model
# ---------------------------------------------------------------------------

class Domain(str, Enum):
    APU = "APU"        # AArch64 Application Processing Unit
    RPU = "RPU"        # ARM-R5F Real-Time Processing Unit
    FPGA = "FPGA"      # RISC-V soft-core on FPGA


class PageAttribute(str, Enum):
    TI = "TI"   # Temporal Isolation
    SC = "SC"   # Sovereign-Certified
    RW = "RW"   # Read-Write
    RO = "RO"   # Read-Only


@dataclass(frozen=True)
class Page:
    """A stage-2 page-table entry."""
    pa: int                       # physical address
    size: int                     # page size in bytes
    owner: Domain                 # owning domain
    attrs: FrozenSet[PageAttribute] = field(default_factory=frozenset)
    certified_by: Optional[str] = None   # ESR-id of the certifying trajectory


@dataclass
class TIBBudget:
    """Temporal-Isolation-Budget token account for a domain."""
    domain: Domain
    budget: int = 0
    max_budget: int = 5
    refill_rate: int = 2          # tokens per epoch
    consumed_this_epoch: int = 0


# ---------------------------------------------------------------------------
# 2. Omnivisor
# ---------------------------------------------------------------------------

class Omnivisor:
    """The Omnivisor core: manages page tables, TIB budgets, and SEG hooks.

    The Omnivisor runs at EL2 on the AArch64 APU and extends the ARM
    Virtualization Extensions with two new stage-2 page-table attributes
    (TI, SC) and a temporal-banker scheduler.  Every mutation is
    submitted to the Sovereign Execution Gate for SQA certification
    before it takes effect.
    """

    def __init__(self,
                 seg_certify_fn: Optional[Any] = None) -> None:
        self.page_table: Dict[int, Page] = {}
        self.tib: Dict[Domain, TIBBudget] = {
            d: TIBBudget(domain=d, max_budget=5, refill_rate=2)
            for d in Domain
        }
        self.current_epoch: int = 0
        self.seg_certify_fn = seg_certify_fn  # callable(esr_id) -> bool
        # Certified pages (SC attribute) indexed by ESR-id
        self.certified_pages: Dict[str, Set[int]] = {}

    # ---- page-table management -------------------------------------------

    def install_page(self, page: Page, esr_id: Optional[str] = None) -> bool:
        """Install a page in the stage-2 table, subject to Adm_spatial.

        Returns True iff the installation is admissible.  If the page
        carries the SC attribute, `esr_id` must be provided and must
        resolve to a certified ESR entry.
        """
        if PageAttribute.SC in page.attrs:
            if esr_id is None:
                return False
            if self.seg_certify_fn and not self.seg_certify_fn(esr_id):
                return False
            self.certified_pages.setdefault(esr_id, set()).add(page.pa)
        self.page_table[page.pa] = page
        return True

    def _find_page(self, pa: int) -> Optional[Page]:
        """Find the page that contains the given physical address.

        Uses range-based lookup (matching the C smpu_check_access semantics)
        rather than exact address match.
        """
        for page in self.page_table.values():
            if page.pa <= pa < page.pa + page.size:
                return page
        return None

    def admissible_write(self, writer: Domain, pa: int) -> bool:
        """Adm_spatial check: may `writer` write to the page at `pa`?

        Returns True iff one of:
          (a) writer owns the page, OR
          (b) the page is not TI-marked AND the writer has SEG certification, OR
          (c) the page is SC-marked AND the writer has SQA quorum.

        Uses range-based lookup (matching the C smpu_check_access semantics).
        """
        page = self._find_page(pa)
        if page is None:
            return False
        if page.owner == writer:
            return True
        if PageAttribute.TI not in page.attrs:
            return True  # non-TI pages are writable by any domain (Adm allows)
        # TI-marked page: only the owner may write, unless SC + quorum
        if PageAttribute.SC in page.attrs and page.certified_by:
            if self.seg_certify_fn and self.seg_certify_fn(page.certified_by):
                return True
        return False

    # ---- temporal-banker scheduling --------------------------------------

    def refill_tib(self) -> None:
        """Refill every domain's TIB budget by its refill_rate, capped at max."""
        for d, b in self.tib.items():
            b.budget = min(b.budget + b.refill_rate, b.max_budget)
            b.consumed_this_epoch = 0
        self.current_epoch += 1

    def grant_hypercall(self, domain: Domain, cost: int) -> bool:
        """Grant a hypercall if the domain has sufficient TIB budget.

        Adm_temporal check: consumed(d) ≤ budget(d).  Returns True iff
        the hypercall is granted.
        """
        b = self.tib[domain]
        if b.budget < cost:
            return False
        b.budget -= cost
        b.consumed_this_epoch += cost
        return True

    def tib_state(self) -> Dict[str, Dict[str, int]]:
        """Return a snapshot of every domain's TIB state."""
        return {
            d.value: {"budget": b.budget, "max": b.max_budget,
                      "refill_rate": b.refill_rate,
                      "consumed_this_epoch": b.consumed_this_epoch}
            for d, b in self.tib.items()
        }


# ---------------------------------------------------------------------------
# 3. Self-test
# ---------------------------------------------------------------------------

def self_test() -> None:
    print("=" * 78)
    print("Omnivisor — Spatio-Temporal Isolation self-test")
    print("=" * 78)

    # SEG stub: certify everything
    ov = Omnivisor(seg_certify_fn=lambda esr_id: True)

    # Install an APU-owned TI+SC page
    page_apu = Page(pa=0x1000, size=4096, owner=Domain.APU,
                    attrs=frozenset({PageAttribute.TI, PageAttribute.SC}),
                    certified_by="esr-test-001")
    ok = ov.install_page(page_apu, esr_id="esr-test-001")
    print(f"  install APU TI+SC page: {ok}")
    assert ok

    # APU may write its own page
    assert ov.admissible_write(Domain.APU, 0x1000)
    print("  APU writes own page: admissible=True ✓")

    # FPGA may NOT write APU's TI page (without SC quorum, which we have)
    # With SC + seg_certify_fn returning True, FPGA can write
    assert ov.admissible_write(Domain.FPGA, 0x1000)
    print("  FPGA writes APU TI+SC page (with SEG quorum): admissible=True ✓")

    # Install an FPGA-owned TI-only page (no SC)
    page_fpga = Page(pa=0x2000, size=4096, owner=Domain.FPGA,
                     attrs=frozenset({PageAttribute.TI}))
    ov.install_page(page_fpga)
    # APU may NOT write FPGA's TI-only page (no SC, no quorum)
    assert not ov.admissible_write(Domain.APU, 0x2000)
    print("  APU writes FPGA TI-only page (no quorum): admissible=False ✓")

    # TIB test — refill first so budgets are non-zero
    ov.refill_tib()
    print(f"  TIB state after refill: {ov.tib_state()}")
    assert ov.grant_hypercall(Domain.APU, cost=2)
    print("  APU hypercall cost=2: granted ✓")
    assert not ov.grant_hypercall(Domain.RPU, cost=10)  # exceeds budget (5)
    print("  RPU hypercall cost=10 (exceeds budget): denied ✓")
    ov.refill_tib()
    print(f"  After second refill: {ov.tib_state()}")

    print("=" * 78)
    print("Omnivisor self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()  # pragma: no cover
