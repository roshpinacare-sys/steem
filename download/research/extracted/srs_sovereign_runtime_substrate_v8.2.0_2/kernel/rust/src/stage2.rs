// SPDX-License-Identifier: Apache-2.0
//
//! Stage-2 page-table management for the SRS Omnivisor.
//!
//! Implements the ARMv8-A stage-2 translation regime used by the
//! hypervisor to map a guest's Intermediate Physical Address (IPA)
//! space to host-physical addresses. The walk is three levels deep —
//! L1 → L2 → L3 — with a 4 KiB granule, matching `VTCR_EL2.SL0 = 1`
//! and `T0SZ = 24` programmed in [`crate::main`].
//!
//! # Adm linkage
//!
//! The SMPU driver (see [`crate::smpu`]) calls back into this module
//! to reprogram stage-2 attributes when a region is quarantined or has
//! its permissions changed. The `TI` (Tainted-In) and `SC`
//! (Sovereign-Clean) bits are SRS-private status flags stored in the
//! Res0 region of the L3 page descriptor (bits 48 and 49); they are
//! never consumed by hardware but are readable back via [`Stage2PageTable::get_pte`]
//! so the hypervisor can audit a region's state.
//!
//! # Stage-2 descriptor layout (canonical ARMv8-A)
//!
//! L3 page descriptor (4 KiB page):
//!
//! ```text
//!   bits  field       meaning
//!   ----  ----------- -----------------------------------------------
//!   [1:0] type        0b11 = valid page
//!   [3:2] MemAttr[1:0] memory attribute index (Device / NC / WT / WB)
//!   [4]   NS          Non-secure bit
//!   [6:5] AP[2:1]     access permission (00 = R/W EL1, none EL0;
//!                                 10 = R/O EL1, none EL0)
//!   [7]   XN[1]       EL1 execute-never
//!   [8]   XN[0]       EL0 execute-never
//!   [10]  AF          Access Flag (must be 1 to avoid fault)
//!   [11]  nT          Not Table (reserved for L3)
//!   [47:12] OA[47:12] output address (4 KiB-aligned physical address)
//!   [48]  TI          SRS-private Tainted-In flag (Res0)
//!   [49]  SC          SRS-private Sovereign-Clean flag (Res0)
//!   [51:50] Res0
//!   [63:52] Res0 / PBHA
//! ```
//!
//! L1/L2 table descriptor (pointer to next level) uses the same
//! `type = 0b11` encoding with the OA field pointing at the next
//! 4 KiB-aligned table.

use core::arch::asm;

// =====================================================================
// Constants
// =====================================================================

/// Number of entries per page-table level. Each entry is 8 bytes; a
/// full table is 4 KiB, matching the page granularity.
pub const ENTRIES_PER_TABLE: usize = 512;

/// Page size in bytes (4 KiB).
pub const PAGE_SIZE: usize = 4096;

/// Page-frame address mask for a 4 KiB page (bits [47:12]).
const PAGE_ADDR_MASK: u64 = 0x0000_FFFF_FFFF_F000;

// ---------------------------------------------------------------------
// Descriptor type bits [1:0].
// ---------------------------------------------------------------------
pub const DESC_INVALID: u64 = 0b00;
pub const DESC_BLOCK: u64   = 0b01; // only valid at L1/L2
pub const DESC_TABLE: u64   = 0b11; // pointer to next level
pub const DESC_PAGE: u64    = 0b11; // 4 KiB page at L3

// ---------------------------------------------------------------------
// Canonical ARMv8-A stage-2 descriptor bits.
// ---------------------------------------------------------------------
/// Access Flag (bit 10). Must be 1 to avoid permission faults on
/// access. The hypervisor pre-sets AF rather than trapping on first
/// access.
pub const PTE_AF: u64 = 1 << 10;

/// EL1 execute-never (bit 7).
pub const PTE_XN1: u64 = 1 << 7;
/// EL0 execute-never (bit 8).
pub const PTE_XN0: u64 = 1 << 8;

/// AP[2:1] = 0b00 — R/W EL1, no access EL0.
pub const PTE_AP_RW: u64 = 0b00 << 5;
/// AP[2:1] = 0b10 — R/O EL1, no access EL0.
pub const PTE_AP_RO: u64 = 0b10 << 5;

/// Non-secure bit (bit 4). Set for normal non-secure guest memory.
pub const PTE_NS: u64 = 1 << 4;

/// MemAttr[1:0] encodings (without FEAT_FWB):
///   0b00 = Device-nGnRnE
///   0b01 = Normal, Outer Non-cacheable
///   0b10 = Normal, Outer Write-Through
///   0b11 = Normal, Outer Write-Back
pub const MEMATTR_DEVICE: u64    = 0b00 << 2;
pub const MEMATTR_NORMAL_NC: u64 = 0b01 << 2;
pub const MEMATTR_NORMAL_WT: u64 = 0b10 << 2;
pub const MEMATTR_NORMAL_WB: u64 = 0b11 << 2;

// ---------------------------------------------------------------------
// SRS-private status bits (software-only; stored in Res0).
// ---------------------------------------------------------------------
/// Tainted-In: data was loaded from an untrusted source.
pub const PTE_TI: u64 = 1 << 48;
/// Sovereign-Clean: region has been measured and verified.
pub const PTE_SC: u64 = 1 << 49;

/// Mask of all SRS-private bits.
pub const PTE_SRS_MASK: u64 = PTE_TI | PTE_SC;

// =====================================================================
// Page-table structure
// =====================================================================

/// A single 4 KiB page-table page (512 entries).
#[repr(C, align(4096))]
#[derive(Clone, Copy)]
pub struct PageTable {
    pub entries: [u64; ENTRIES_PER_TABLE],
}

impl PageTable {
    /// Construct an empty page table. `const` so it can be used in
    /// `static` initialisers.
    pub const fn new() -> Self {
        Self { entries: [0; ENTRIES_PER_TABLE] }
    }

    #[inline]
    fn entry(&self, idx: usize) -> u64 {
        // Volatile read so the compiler does not elide table walks.
        unsafe { core::ptr::read_volatile(&self.entries[idx]) }
    }

    #[inline]
    fn set_entry(&mut self, idx: usize, pte: u64) {
        unsafe { core::ptr::write_volatile(&mut self.entries[idx], pte) }
    }
}

// =====================================================================
// Stage2PageTable
// =====================================================================

/// Three-level stage-2 page table.
///
/// A single root L1 table maps a 512 GiB IPA space at 1 GiB per L1
/// entry. L1 entries point to L2 tables (2 MiB per L2 entry); L2
/// entries point to L3 tables (4 KiB per L3 entry).
///
/// For the skeleton we pre-allocate up to 4 L2 tables and up to 4 L3
/// tables per L2 (16 L3 tables total) — enough to map 64 MiB of guest
/// memory at 4 KiB granularity. A real hypervisor would use a dynamic
/// allocator (bump or buddy) for table pages.
pub struct Stage2PageTable {
    /// L1 root table.
    pub l1: PageTable,
    /// Pre-allocated L2 tables.
    pub l2: [PageTable; 4],
    /// Pre-allocated L3 tables, indexed `[l2_slot][l3_slot]`.
    pub l3: [[PageTable; 4]; 4],
    /// L2 allocation bitmap.
    l2_used: [bool; 4],
    /// L3 allocation bitmap.
    l3_used: [[bool; 4]; 4],
}

impl Stage2PageTable {
    /// Construct an empty stage-2 page table.
    pub const fn new() -> Self {
        Self {
            l1: PageTable::new(),
            l2: [PageTable::new(); 4],
            l3: [[PageTable::new(); 4]; 4],
            l2_used: [false; 4],
            l3_used: [[false; 4]; 4],
        }
    }

    // --- index helpers ----------------------------------------------

    #[inline]
    fn l1_index(ipa: u64) -> usize { ((ipa >> 30) & 0x1FF) as usize }

    #[inline]
    fn l2_index(ipa: u64) -> usize { ((ipa >> 21) & 0x1FF) as usize }

    #[inline]
    fn l3_index(ipa: u64) -> usize { ((ipa >> 12) & 0x1FF) as usize }

    // --- slot lookup ------------------------------------------------

    /// Find the L2 slot whose table address matches the L1 entry at
    /// `ipa`'s L1 index. Returns `Some(slot)` if found.
    fn find_l2_slot(&self, ipa: u64) -> Option<usize> {
        let l1e = self.l1.entry(Self::l1_index(ipa));
        if l1e & 0b11 != DESC_TABLE {
            return None;
        }
        let target_pa = l1e & PAGE_ADDR_MASK;
        for (i, used) in self.l2_used.iter().enumerate() {
            if *used && (&self.l2[i] as *const _ as u64) == target_pa {
                return Some(i);
            }
        }
        None
    }

    /// Find the L3 slot whose table address matches the L2 entry at
    /// `ipa`'s L2 index. Returns `Some(slot)` if found.
    fn find_l3_slot(&self, l2_slot: usize, ipa: u64) -> Option<usize> {
        let l2 = &self.l2[l2_slot];
        let l2e = l2.entry(Self::l2_index(ipa));
        if l2e & 0b11 != DESC_TABLE {
            return None;
        }
        let target_pa = l2e & PAGE_ADDR_MASK;
        for (i, used) in self.l3_used[l2_slot].iter().enumerate() {
            if *used && (&self.l3[l2_slot][i] as *const _ as u64) == target_pa {
                return Some(i);
            }
        }
        None
    }

    // --- table allocation -------------------------------------------

    /// Allocate (or reuse) the L2 table for `ipa`'s L1 slot.
    fn ensure_l2(&mut self, ipa: u64) -> Result<usize, &'static str> {
        // Already present?
        if let Some(slot) = self.find_l2_slot(ipa) {
            return Ok(slot);
        }

        // Find a free L2 slot.
        let slot = self.l2_used.iter().position(|&u| !u)
            .ok_or("out of L2 tables")?;
        self.l2_used[slot] = true;

        // Install L1 table pointer. Output address is the physical
        // address of the new L2 table.
        let l2_pa = &self.l2[slot] as *const _ as u64;
        let pte = (l2_pa & PAGE_ADDR_MASK) | DESC_TABLE | PTE_AF;
        self.l1.set_entry(Self::l1_index(ipa), pte);
        Ok(slot)
    }

    /// Allocate (or reuse) the L3 table for `ipa`'s L2 slot.
    fn ensure_l3(&mut self, ipa: u64) -> Result<(usize, usize), &'static str> {
        let l2_slot = self.ensure_l2(ipa)?;
        if let Some(l3_slot) = self.find_l3_slot(l2_slot, ipa) {
            return Ok((l2_slot, l3_slot));
        }

        let l3_slot = self.l3_used[l2_slot].iter().position(|&u| !u)
            .ok_or("out of L3 tables")?;
        self.l3_used[l2_slot][l3_slot] = true;

        let l3_pa = &self.l3[l2_slot][l3_slot] as *const _ as u64;
        let pte = (l3_pa & PAGE_ADDR_MASK) | DESC_TABLE | PTE_AF;
        self.l2[l2_slot].set_entry(Self::l2_index(ipa), pte);
        Ok((l2_slot, l3_slot))
    }

    // --- public API -------------------------------------------------

    /// Map a single 4 KiB guest-physical page (`ipa`) to a
    /// host-physical address (`pa`) with the given attributes.
    ///
    /// `attrs` carries both canonical ARMv8-A stage-2 attribute bits
    /// (AP, MemAttr, AF, XN, …) and SRS-private `TI`/`SC` flags. The
    /// latter are stored in Res0 bits and do not affect hardware.
    ///
    /// Returns `Err` if the address is misaligned or the table pool is
    /// exhausted.
    pub fn map(&mut self, ipa: u64, pa: u64, attrs: u64) -> Result<(), &'static str> {
        if ipa & 0xFFF != 0 || pa & 0xFFF != 0 {
            return Err("ipa/pa not 4 KiB-aligned");
        }

        let (l2_slot, l3_slot) = self.ensure_l3(ipa)?;
        let l3 = &mut self.l3[l2_slot][l3_slot];
        let pte = (pa & PAGE_ADDR_MASK)
            | DESC_PAGE
            | PTE_AF
            | (attrs & !(PAGE_ADDR_MASK | 0b11)); // strip any low bits
        l3.set_entry(Self::l3_index(ipa), pte);
        Ok(())
    }

    /// Unmap a single 4 KiB guest-physical page. Returns `Err` if no
    /// L3 table exists for the IPA (i.e. the address was never mapped).
    pub fn unmap(&mut self, ipa: u64) -> Result<(), &'static str> {
        if ipa & 0xFFF != 0 {
            return Err("ipa not 4 KiB-aligned");
        }

        let l2_slot = self.find_l2_slot(ipa)
            .ok_or("no L2 table for ipa")?;
        let l3_slot = self.find_l3_slot(l2_slot, ipa)
            .ok_or("no L3 table for ipa")?;

        self.l3[l2_slot][l3_slot].set_entry(Self::l3_index(ipa), DESC_INVALID);
        Ok(())
    }

    /// Read the L3 PTE for `ipa`, or `None` if any level is missing
    /// or the L3 entry is invalid.
    pub fn get_pte(&self, ipa: u64) -> Option<u64> {
        let l2_slot = self.find_l2_slot(ipa)?;
        let l3_slot = self.find_l3_slot(l2_slot, ipa)?;
        let pte = self.l3[l2_slot][l3_slot].entry(Self::l3_index(ipa));
        if pte & 0b11 != DESC_PAGE {
            return None;
        }
        Some(pte)
    }

    /// Invalidate the entire stage-2 TLB for the current VMID.
    ///
    /// `TLBI VMALLS2E1IS` invalidates all stage-2 entries for the
    /// current VMID, Inner Shareable. Cheaper than a per-IPA flush
    /// when many mappings change at once (e.g. on VM context switch).
    pub fn flush_tlb(&self) {
        // SAFETY: `tlbi vmalls2e1is` is a system instruction with no
        // memory operands; `dsb ish` + `isb` complete the
        // invalidation ordering.
        unsafe {
            asm!(
                "tlbi vmalls2e1is",
                "dsb ish",
                "isb",
                options(nostack, preserves_flags),
            );
        }
    }

    /// Invalidate a single 4 KiB IPA from the stage-2 TLB.
    ///
    /// `TLBI IPAS2E1IS, <Xt>` takes the IPA in bits [47:12] of the
    /// register operand, so we right-shift the page address by 12.
    pub fn flush_tlb_ipa(&self, ipa: u64) {
        let ipa_shifted = (ipa >> 12) & 0x0000_0FFF_FFFF_FFFF;
        unsafe {
            asm!(
                "tlbi ipas2e1is, {}",
                "dsb ish",
                "isb",
                in(reg) ipa_shifted,
                options(nostack, preserves_flags),
            );
        }
    }

    /// Return the physical address of the L1 root table.
    ///
    /// This is what `VTTBR_EL2.BADDR` must point at. On QEMU `virt`
    /// loaded with `-kernel`, the hypervisor runs on physical
    /// addresses (no stage-1 MMU), so the Rust pointer value is also
    /// the physical address. On real hardware with an EL2 stage-1
    /// MMU, this would need translation via the kernel's own tables.
    pub fn l1_phys(&self) -> u64 {
        &self.l1 as *const _ as u64
    }

    /// Number of L2 tables currently in use (diagnostic).
    pub fn l2_tables_in_use(&self) -> usize {
        self.l2_used.iter().filter(|&&u| u).count()
    }

    /// Number of L3 tables currently in use (diagnostic).
    pub fn l3_tables_in_use(&self) -> usize {
        self.l3_used.iter().flatten().filter(|&&u| u).count()
    }
}

// =====================================================================
// Tests (host-side, run with `cargo test --target=x86_64-unknown-linux-gnu`)
// =====================================================================
//
// The tests below exercise the table-walk logic without touching
// hardware. They use ordinary Rust tests rather than `#[no_std]` test
// harness so they only compile on a hosted target — the bare-metal
// build does not include this item because `cfg(test)` is not set
// under `cargo build --target=aarch64-unknown-none`.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_helpers_are_sensible() {
        // 0x4000_0000 is the start of DRAM on QEMU virt.
        let ipa = 0x4000_0000u64;
        assert_eq!(Stage2PageTable::l1_index(ipa), 1);
        assert_eq!(Stage2PageTable::l2_index(ipa), 0);
        assert_eq!(Stage2PageTable::l3_index(ipa), 0);
    }

    #[test]
    fn map_and_unmap_roundtrip() {
        let mut pt = Stage2PageTable::new();
        let attrs = PTE_AP_RW | MEMATTR_NORMAL_WB | PTE_AF | PTE_SC;
        let ipa  = 0x4000_0000u64;
        let pa   = 0x4000_0000u64;

        pt.map(ipa, pa, attrs).unwrap();
        let pte = pt.get_pte(ipa).expect("page should be mapped");
        assert_ne!(pte & 0b11, 0b00, "descriptor must be valid");
        assert_eq!(pte & PAGE_ADDR_MASK, pa & PAGE_ADDR_MASK);
        assert_ne!(pte & PTE_SC, 0, "SC bit must be set");

        pt.unmap(ipa).unwrap();
        assert!(pt.get_pte(ipa).is_none(), "page should be unmapped");
    }
}
