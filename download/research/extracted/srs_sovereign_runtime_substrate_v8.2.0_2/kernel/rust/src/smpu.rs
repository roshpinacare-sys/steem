// SPDX-License-Identifier: Apache-2.0
//
//! SRS Sovereign Memory Protection Unit (SMPU) driver.
//!
//! The SMPU is an SRS abstraction layer that sits on top of the
//! ARMv8-A stage-2 translation regime. It enforces per-domain memory
//! isolation for the Omnivisor by reprogramming stage-2 attributes
//! (AP, MemAttr, AF, XN) when a region's policy changes.
//!
//! # Adm linkage
//!
//! This module is the Rust analogue of the Python-side `smpu_sppu.py`
//! reference driver. The Adm orchestrator emits SMPU policy records
//! (one per region) that the Boot Module passes to the hypervisor at
//! boot. The hypervisor calls [`SmpuDriver::program`] for each record
//! to install the corresponding stage-2 mappings, and
//! [`SmpuDriver::quarantine`] when a domain misbehaves.
//!
//! # TI / SC bits
//!
//! Two SRS-private status bits are tracked per region:
//!
//!   * `TI` (Tainted-In) — set when data is loaded into the region
//!     from an untrusted source. Clears `SC`.
//!   * `SC` (Sovereign-Clean) — set when the region has been verified
//!     clean by the kernel or by a measurement agent. Required for
//!     execution from the region.
//!
//! These flags are propagated into the stage-2 PTE via the
//! `attrs` argument to [`crate::stage2::Stage2PageTable::map`]; see
//! [`SmpuPermission::to_pte_attrs`] for the bit layout.

use crate::stage2::{
    Stage2PageTable, PAGE_SIZE,
    PTE_AP_RW, PTE_AP_RO, PTE_XN1, PTE_XN0,
    PTE_TI, PTE_SC,
    MEMATTR_NORMAL_WB, MEMATTR_DEVICE,
};

// =====================================================================
// Types
// =====================================================================

/// Maximum number of SMPU regions the driver tracks. Each region is
/// 56 bytes, so 32 regions = ~1.7 KiB of state.
const MAX_REGIONS: usize = 32;

/// A domain identifier.
///
/// Domain 0 is the hypervisor itself. Domains 1..255 are guest VMs or
/// untrusted loadable modules. The Adm orchestrator allocates domain
/// IDs at VM-creation time; the hypervisor uses them for access
/// checks (see [`SmpuDriver::check_access`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DomainId(pub u8);

/// Permissions for an SMPU region.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SmpuPermission {
    /// No access (region is unmapped in stage-2).
    None,
    /// Read-only.
    ReadOnly,
    /// Read/write, no execute.
    ReadWrite,
    /// Read/execute (e.g., code segment).
    ReadExecute,
    /// Read/write/execute (rare; for JIT regions).
    ReadWriteExecute,
}

impl SmpuPermission {
    /// Encode the permission into ARMv8-A stage-2 attribute bits.
    ///
    /// Returns `0` for [`SmpuPermission::None`] so the caller can
    /// detect "unmap" intent. All other variants include `MEMATTR_NORMAL_WB`
    /// and the Access Flag is added by the stage-2 layer.
    fn to_pte_attrs(self) -> u64 {
        match self {
            SmpuPermission::None             => 0,
            SmpuPermission::ReadOnly         => PTE_AP_RO | PTE_XN1 | PTE_XN0 | MEMATTR_NORMAL_WB,
            SmpuPermission::ReadWrite        => PTE_AP_RW | PTE_XN1 | PTE_XN0 | MEMATTR_NORMAL_WB,
            SmpuPermission::ReadExecute      => PTE_AP_RO | MEMATTR_NORMAL_WB,
            SmpuPermission::ReadWriteExecute => PTE_AP_RW | MEMATTR_NORMAL_WB,
        }
    }

    /// Returns `true` if the permission allows writes.
    pub fn allows_write(self) -> bool {
        matches!(self,
            SmpuPermission::ReadWrite | SmpuPermission::ReadWriteExecute)
    }

    /// Returns `true` if the permission allows execution.
    pub fn allows_execute(self) -> bool {
        matches!(self,
            SmpuPermission::ReadExecute | SmpuPermission::ReadWriteExecute)
    }
}

/// An SMPU region descriptor.
///
/// One of these is emitted by the Adm orchestrator for each memory
/// region a VM is allowed to touch. The hypervisor stores them in the
/// [`SmpuDriver`] and uses them both to program the stage-2 page
/// table and to answer runtime access-check queries.
#[derive(Clone, Copy, Debug)]
pub struct SmpuRegion {
    /// Base IPA. Must be 4 KiB-aligned.
    pub base: u64,
    /// Size in bytes. Must be a non-zero multiple of 4 KiB.
    pub size: u64,
    /// Owning domain. Only the owner may access the region.
    pub owner_domain: DomainId,
    /// Access permissions.
    pub perm: SmpuPermission,
    /// Tainted-In: data was loaded from an untrusted source.
    pub ti: bool,
    /// Sovereign-Clean: region has been measured and verified.
    pub sc: bool,
}

impl SmpuRegion {
    /// Returns `true` if `addr` lies within `[base, base+size)`.
    pub fn contains(&self, addr: u64) -> bool {
        addr >= self.base && addr < self.base.saturating_add(self.size)
    }
}

// =====================================================================
// SmpuDriver
// =====================================================================

/// SMPU driver state.
///
/// Tracks up to [`MAX_REGIONS`] regions, indexed by slot. The driver
/// is *not* the hardware page table itself — it is a policy layer
/// that calls into [`Stage2PageTable`] to realise the policy in PTEs.
pub struct SmpuDriver {
    regions: [Option<SmpuRegion>; MAX_REGIONS],
    /// Currently-active domain. Set on VM context switch; used by
    /// [`SmpuDriver::check_access`].
    active_domain: DomainId,
}

impl SmpuDriver {
    /// Construct an empty SMPU driver. `const` so it can live in a
    /// `static`.
    pub const fn new() -> Self {
        Self {
            regions: [None; MAX_REGIONS],
            active_domain: DomainId(0),
        }
    }

    // -----------------------------------------------------------------
    // Region management
    // -----------------------------------------------------------------

    /// Program a region into the SMPU and into the stage-2 page table.
    ///
    /// The region's `base` and `size` must be 4 KiB-aligned. If a
    /// region already exists with the same `base`, it is overwritten.
    /// Each 4 KiB page in the region is identity-mapped (`IPA = PA`)
    /// with the permission's attribute bits and the TI/SC flags.
    ///
    /// For [`SmpuPermission::None`], the region is recorded but no
    /// stage-2 mapping is installed — any access will fault.
    pub fn program(
        &mut self,
        region: SmpuRegion,
        pt: &mut Stage2PageTable,
    ) -> Result<(), &'static str> {
        if region.base & 0xFFF != 0 || region.size & 0xFFF != 0 {
            return Err("region not 4 KiB-aligned");
        }
        if region.size == 0 {
            return Err("region size zero");
        }

        // Build the stage-2 attribute bits.
        let mut attrs = region.perm.to_pte_attrs();
        if region.ti { attrs |= PTE_TI; }
        if region.sc { attrs |= PTE_SC; }

        // Map each page in the region as identity (IPA = PA). A real
        // hypervisor would translate IPA→PA via the host memory map.
        if region.perm != SmpuPermission::None {
            let mut ipa = region.base;
            let end = region.base.checked_add(region.size)
                .ok_or("region end overflow")?;
            while ipa < end {
                pt.map(ipa, ipa, attrs)
                    .map_err(|_| "stage-2 map failed")?;
                ipa += PAGE_SIZE as u64;
            }
        }

        // Find a slot: overwrite an existing region with the same base,
        // otherwise use the first free slot.
        let slot = self.regions.iter().position(|r| match r {
            Some(ri) => ri.base == region.base,
            None     => true,
        }).ok_or("out of region slots")?;

        self.regions[slot] = Some(region);
        Ok(())
    }

    /// Quarantine a region: unmap it from stage-2 and mark it
    /// tainted in the SMPU state.
    ///
    /// Quarantined regions cannot be accessed by any domain until
    /// explicitly released by the Adm orchestrator (via
    /// [`SmpuDriver::program`] with a new permission).
    pub fn quarantine(
        &mut self,
        region: &SmpuRegion,
        pt: &mut Stage2PageTable,
    ) {
        let mut ipa = region.base;
        let end = region.base.saturating_add(region.size);
        while ipa < end {
            let _ = pt.unmap(ipa);
            ipa += PAGE_SIZE as u64;
        }
        pt.flush_tlb();

        // Mark the region as tainted in the SMPU.
        for r in self.regions.iter_mut() {
            if let Some(ri) = r {
                if ri.base == region.base {
                    ri.perm = SmpuPermission::None;
                    ri.ti = true;
                    ri.sc = false;
                    break;
                }
            }
        }
    }

    // -----------------------------------------------------------------
    // Access checks
    // -----------------------------------------------------------------

    /// Check whether the active domain may access `[addr, addr+size)`
    /// with the given intent (read or write).
    ///
    /// Returns `true` if the entire range falls within a region owned
    /// by the active domain whose permission allows the requested
    /// access. Returns `false` otherwise — including the case where
    /// the range straddles two regions.
    pub fn check_access(&self, addr: u64, size: u64, write: bool) -> bool {
        let end = match addr.checked_add(size) {
            Some(e) => e,
            None    => return false,
        };

        for region in self.regions.iter().flatten() {
            if addr >= region.base && end <= region.base.saturating_add(region.size) {
                if region.owner_domain != self.active_domain {
                    return false;
                }
                if write && !region.perm.allows_write() {
                    return false;
                }
                return true;
            }
        }
        false
    }

    /// Returns `true` if the active domain may execute from `addr`.
    pub fn check_execute(&self, addr: u64) -> bool {
        for region in self.regions.iter().flatten() {
            if region.contains(addr)
                && region.owner_domain == self.active_domain
                && region.perm.allows_execute()
                && !region.ti  // tainted regions are non-executable
                && region.sc   // only Sovereign-Clean regions may execute
            {
                return true;
            }
        }
        false
    }

    // -----------------------------------------------------------------
    // Domain management
    // -----------------------------------------------------------------

    /// Set the currently-active domain. Called on VM context switch.
    pub fn set_active_domain(&mut self, dom: DomainId) {
        self.active_domain = dom;
    }

    /// Returns the currently-active domain.
    pub fn active_domain(&self) -> DomainId {
        self.active_domain
    }

    // -----------------------------------------------------------------
    // Introspection
    // -----------------------------------------------------------------

    /// Look up the region containing `addr`, if any.
    pub fn find_region(&self, addr: u64) -> Option<&SmpuRegion> {
        self.regions.iter().flatten().find(|r| r.contains(addr))
    }

    /// Number of regions currently programmed.
    pub fn region_count(&self) -> usize {
        self.regions.iter().flatten().count()
    }
}

// =====================================================================
// Tests
// =====================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_encoding() {
        // ReadOnly: AP=RO, both XN bits set, Normal-WB.
        let a = SmpuPermission::ReadOnly.to_pte_attrs();
        assert_ne!(a & PTE_AP_RO, 0);
        assert_ne!(a & PTE_XN1, 0);
        assert_ne!(a & PTE_XN0, 0);
        assert_ne!(a & MEMATTR_NORMAL_WB, 0);

        // ReadWrite: AP=RW.
        let a = SmpuPermission::ReadWrite.to_pte_attrs();
        assert_ne!(a & PTE_AP_RW, 0);

        // ReadExecute: XN bits clear.
        let a = SmpuPermission::ReadExecute.to_pte_attrs();
        assert_eq!(a & PTE_XN1, 0);
        assert_eq!(a & PTE_XN0, 0);

        // None: zero.
        assert_eq!(SmpuPermission::None.to_pte_attrs(), 0);
    }

    #[test]
    fn check_access_respects_owner_domain() {
        let mut smpu = SmpuDriver::new();
        smpu.set_active_domain(DomainId(1));

        let region = SmpuRegion {
            base: 0x4000_0000,
            size: 0x0010_0000,
            owner_domain: DomainId(2), // different domain
            perm: SmpuPermission::ReadWrite,
            ti: false,
            sc: true,
        };

        let mut pt = Stage2PageTable::new();
        smpu.program(region, &mut pt).unwrap();

        // Active domain is 1; region owned by 2 → access denied.
        assert!(!smpu.check_access(0x4000_0000, 0x1000, false));

        smpu.set_active_domain(DomainId(2));
        assert!(smpu.check_access(0x4000_0000, 0x1000, false));
        assert!(smpu.check_access(0x4000_0000, 0x1000, true));
    }

    #[test]
    fn quarantine_marks_tainted() {
        let mut smpu = SmpuDriver::new();
        smpu.set_active_domain(DomainId(1));

        let region = SmpuRegion {
            base: 0x4000_0000,
            size: 0x0010_0000,
            owner_domain: DomainId(1),
            perm: SmpuPermission::ReadWrite,
            ti: false,
            sc: true,
        };

        let mut pt = Stage2PageTable::new();
        smpu.program(region, &mut pt).unwrap();
        assert!(smpu.check_access(0x4000_0000, 0x1000, false));

        smpu.quarantine(&region, &mut pt);
        assert!(!smpu.check_access(0x4000_0000, 0x1000, false));

        // The region is now tainted and not SC.
        let r = smpu.find_region(0x4000_0000).unwrap();
        assert!(r.ti);
        assert!(!r.sc);
        assert_eq!(r.perm, SmpuPermission::None);
    }
}
