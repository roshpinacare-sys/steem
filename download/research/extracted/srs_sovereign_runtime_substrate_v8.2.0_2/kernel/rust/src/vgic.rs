// SPDX-License-Identifier: Apache-2.0
//
//! Virtual GIC v3 driver.
//!
//! Minimal driver for the ARM Generic Interrupt Controller v3 in
//! virtualisation mode. The QEMU `virt` machine with `-machine
//! virtualization=on` exposes a GICv3 with:
//!
//!   * Distributor (GICD) at `0x0800_0000`.
//!   * Redistributor frame 0 (RD_base + SGI_base) at `0x080A_0000`.
//!   * CPU interface accessed via `ICC_*` system registers (enabled
//!     by `ICC_SRE_EL1 = 1`).
//!
//! # Adm linkage
//!
//! The Adm orchestrator routes physical IRQs to VMs via the VGIC.
//! Each VM owns a subset of the SPI (Shared Peripheral Interrupt)
//! space; the hypervisor uses [`VgicV3::enable_irq`] to admit a
//! physical IRQ, [`VgicV3::acknowledge`] to read the highest-priority
//! pending IRQ, and [`VgicV3::eoi`] to drop priority after the guest
//! has handled it. True virtual-IRQ injection (using the GICv3 list
//! registers `ICH_LR<n>_EL2`) is stubbed out — the skeleton
//! "injects" by setting the pending bit on the physical distributor,
//! which is correct for the single-VM case but not for multi-VM
//! dispatch.
//!
//! # Memory map
//!
//! ```text
//!   0x0800_0000  GICD_BASE   — Distributor
//!   0x080A_0000  GICR_RD(0)  — Redistributor 0, RD_base frame
//!   0x080B_0000  GICR_SGI(0) — Redistributor 0, SGI_base frame
//! ```
//!
//! IRQ numbering: 0–15 are SGIs, 16–31 are PPIs (per-CPU), 32+ are
//! SPIs (system-wide). On QEMU virt, the PL011 UART is SPI 33.

use core::arch::asm;
use core::ptr::{read_volatile, write_volatile};

// =====================================================================
// MMIO base addresses (QEMU virt default)
// =====================================================================

const GICD_BASE: u64    = 0x0800_0000;
const GICR_RD_BASE: u64 = 0x080A_0000;
const GICR_SGI_BASE: u64 = GICR_RD_BASE + 0x1_0000;

// ---------------------------------------------------------------------
// GICD (Distributor) register offsets.
// ---------------------------------------------------------------------
const GICD_CTLR: u64       = GICD_BASE + 0x0000;
const GICD_TYPER: u64      = GICD_BASE + 0x0004;
const GICD_IGROUPR: u64    = GICD_BASE + 0x0080; // 32 IRQs per reg
const GICD_ISENABLER: u64  = GICD_BASE + 0x0100;
const GICD_ICENABLER: u64  = GICD_BASE + 0x0180;
const GICD_ISPENDR: u64    = GICD_BASE + 0x0200;
const GICD_ICPENDR: u64    = GICD_BASE + 0x0280;
const GICD_ISACTIVER: u64  = GICD_BASE + 0x0300;
const GICD_ICACTIVER: u64  = GICD_BASE + 0x0380;
const GICD_IPRIORITYR: u64 = GICD_BASE + 0x0400; // 1 byte per IRQ
const GICD_ICFGR: u64      = GICD_BASE + 0x0C00; // 2 bits per IRQ
const GICD_ITARGETSR: u64  = GICD_BASE + 0x0800; // 1 byte per IRQ (RO on GICv3)

// ---------------------------------------------------------------------
// GICR (Redistributor) register offsets.
// ---------------------------------------------------------------------
const GICR_CTLR: u64       = GICR_RD_BASE + 0x0000;
const GICR_TYPER: u64      = GICR_RD_BASE + 0x0008;
const GICR_WAKER: u64      = GICR_RD_BASE + 0x0014;

const GICR_IGROUPR0: u64   = GICR_SGI_BASE + 0x0080;
const GICR_ISENABLER0: u64 = GICR_SGI_BASE + 0x0100;
const GICR_ICENABLER0: u64 = GICR_SGI_BASE + 0x0180;
const GICR_ISPENDR0: u64   = GICR_SGI_BASE + 0x0200;
const GICR_ICPENDR0: u64   = GICR_SGI_BASE + 0x0280;
const GICR_IGRPMODR0: u64  = GICR_SGI_BASE + 0x0D00;

// =====================================================================
// Constants
// =====================================================================

/// Number of IRQs the driver tracks. QEMU virt exposes 192 SPIs by
/// default; we round up to 256 (8 × 32-bit registers) for simplicity.
pub const MAX_IRQS: usize = 256;

/// Spurious IRQ number returned by `ICC_IAR1_EL1` when no IRQ is
/// pending.
pub const SPURIOUS_IRQ: u32 = 1023;

// =====================================================================
// VgicV3
// =====================================================================

/// Virtual GIC v3 driver.
///
/// The driver is single-VM in the skeleton. A real driver would have a
/// per-VM list-register file (`ICH_LR<n>_EL2`) and per-VM
/// enable/pending bitmaps; here we just use the physical distributor's
/// state as a single-VM proxy.
pub struct VgicV3 {
    /// Bitmap of IRQs currently enabled at the GICD/GICR.
    enabled: [u32; MAX_IRQS / 32],
    /// Bitmap of IRQs currently injected (pending) for the boot VM.
    pending: [u32; MAX_IRQS / 32],
    /// Number of SPIs reported by `GICD_TYPER.ITLinesNumber`.
    spi_count: u32,
}

impl VgicV3 {
    /// Construct an uninitialized VGIC driver. Call [`VgicV3::init`]
    /// before any other method.
    pub const fn new() -> Self {
        Self {
            enabled:  [0; MAX_IRQS / 32],
            pending:  [0; MAX_IRQS / 32],
            spi_count: 0,
        }
    }

    // -----------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------

    /// Initialise the GIC: enable system-register CPU interface
    /// access, enable Group 1 IRQs, wake the redistributor, default
    /// all IRQs to Group 1, and disable all IRQs at startup.
    ///
    /// # Safety
    ///
    /// Writes to MMIO registers and system registers. Must be called
    /// after the GIC is memory-mapped (always true on QEMU virt at
    /// boot).
    pub fn init(&mut self) {
        unsafe {
            // 1. Enable system-register access for the CPU interface.
            //    ICC_SRE_EL1 = 0x7: SRE=1 (enable), DFB=1, DIB=1.
            asm!(
                "msr icc_sre_el1, {val}",
                "isb",
                val = in(reg) 0x7u64,
                options(nostack, preserves_flags),
            );

            // 2. Enable Group 1 IRQ delivery at the CPU interface.
            asm!(
                "msr icc_igrpen1_el1, {val}",
                "isb",
                val = in(reg) 0x1u64,
                options(nostack, preserves_flags),
            );

            // 3. Enable the distributor (Group 1 + EnableGrp1A).
            write_volatile(GICD_CTLR as *mut u32, 0x37);

            // 4. Wake the redistributor (clear ProcessorSleep).
            let waker = read_volatile(GICR_WAKER as *const u32);
            write_volatile(GICR_WAKER as *mut u32, waker & !0x2);
            // Wait for ChildrenAsleep to clear.
            while read_volatile(GICR_WAKER as *const u32) & 0x4 != 0 { }

            // 5. Discover IRQ count from GICD_TYPER.ITLinesNumber
            //    (5 bits, value = (N+1)*32 SPIs).
            let typer = read_volatile(GICD_TYPER as *const u32);
            self.spi_count = ((typer & 0x1F) + 1) * 32;

            // 6. Default all SPIs (IRQ 32+) to Group 1, edge-triggered,
            //    priority 0xa0, targeting PE 0.
            for irq in 32..MAX_IRQS as u32 {
                let reg  = (irq / 32) as u64;
                let bit  = 1u32 << (irq % 32);

                // Group 1.
                write_volatile((GICD_IGROUPR + reg * 4) as *mut u32,
                    read_volatile((GICD_IGROUPR + reg * 4) as *const u32) | bit);

                // Priority 0xa0 (higher than default 0x00 to allow
                // preemption by lower-priority SGIs).
                let prio_reg = GICD_IPRIORITYR + irq as u64;
                write_volatile(prio_reg as *mut u8, 0xa0);

                // Edge-triggered (ICFGR: 2 bits per IRQ, 0b10 = edge).
                let icfgr_reg = GICD_ICFGR + ((irq / 16) as u64) * 4;
                let shift = (irq % 16) * 2 + 1;
                let v = read_volatile(icfgr_reg as *const u32);
                write_volatile(icfgr_reg as *mut u32, v | (1u32 << shift));
            }

            // 7. SGIs + PPIs (IRQ 0-31) → Group 1 in the redistributor.
            write_volatile(GICR_IGROUPR0  as *mut u32, 0xFFFF_FFFF);
            write_volatile(GICR_IGRPMODR0 as *mut u32, 0x0);

            // 8. Disable all IRQs at startup. Caller enables them via
            //    `enable_irq`.
            for i in 1..(MAX_IRQS / 32) {
                write_volatile((GICD_ICENABLER + (i as u64) * 4) as *mut u32,
                    0xFFFF_FFFF);
            }
            write_volatile(GICR_ICENABLER0 as *mut u32, 0xFFFF_FFFF);

            // 9. Default priority mask: admit all priorities.
            asm!(
                "msr icc_pmr_el1, {val}",
                "isb",
                val = in(reg) 0xFFu64,
                options(nostack, preserves_flags),
            );
        }
    }

    // -----------------------------------------------------------------
    // IRQ enable / disable
    // -----------------------------------------------------------------

    /// Enable a physical IRQ at the GICD (for SPIs) or GICR (for
    /// SGIs/PPIs). Safe to call multiple times.
    pub fn enable_irq(&mut self, irq: u32) {
        if irq as usize >= MAX_IRQS { return; }
        let reg = (irq / 32) as u64;
        let bit = 1u32 << (irq % 32);

        unsafe {
            if irq < 32 {
                write_volatile(GICR_ISENABLER0 as *mut u32, bit);
            } else {
                write_volatile((GICD_ISENABLER + reg * 4) as *mut u32, bit);
            }
        }
        self.enabled[(irq / 32) as usize] |= bit;
    }

    /// Disable a physical IRQ. Safe to call multiple times.
    pub fn disable_irq(&mut self, irq: u32) {
        if irq as usize >= MAX_IRQS { return; }
        let reg = (irq / 32) as u64;
        let bit = 1u32 << (irq % 32);

        unsafe {
            if irq < 32 {
                write_volatile(GICR_ICENABLER0 as *mut u32, bit);
            } else {
                write_volatile((GICD_ICENABLER + reg * 4) as *mut u32, bit);
            }
        }
        self.enabled[(irq / 32) as usize] &= !bit;
    }

    /// Returns `true` if `irq` is currently enabled.
    pub fn is_enabled(&self, irq: u32) -> bool {
        if irq as usize >= MAX_IRQS { return false; }
        let bit = 1u32 << (irq % 32);
        self.enabled[(irq / 32) as usize] & bit != 0
    }

    // -----------------------------------------------------------------
    // Virtual IRQ injection
    // -----------------------------------------------------------------

    /// Inject a virtual IRQ into the VM identified by `vm_id`.
    ///
    /// For the skeleton we set the pending bit on the physical
    /// distributor (single-VM case). A real GICv3 hypervisor would
    /// write to one of the `ICH_LR<n>_EL2` list registers with the
    /// `vINTID` and `pINTID` to deliver the interrupt directly to the
    /// guest without involving the physical distributor.
    pub fn inject_irq(&mut self, vm_id: u32, irq: u32) {
        if irq as usize >= MAX_IRQS { return; }
        let _ = vm_id; // single-VM skeleton

        let reg = (irq / 32) as u64;
        let bit = 1u32 << (irq % 32);

        unsafe {
            if irq < 32 {
                write_volatile(GICR_ISPENDR0 as *mut u32, bit);
            } else {
                write_volatile((GICD_ISPENDR + reg * 4) as *mut u32, bit);
            }
        }
        self.pending[(irq / 32) as usize] |= bit;
    }

    /// Returns `true` if `irq` is currently pending for the boot VM.
    pub fn is_pending(&self, irq: u32) -> bool {
        if irq as usize >= MAX_IRQS { return false; }
        let bit = 1u32 << (irq % 32);
        self.pending[(irq / 32) as usize] & bit != 0
    }

    // -----------------------------------------------------------------
    // IRQ acknowledgement & EOI
    // -----------------------------------------------------------------

    /// Acknowledge the highest-priority pending IRQ by reading
    /// `ICC_IAR1_EL1`. Returns [`SPURIOUS_IRQ`] (1023) if no IRQ is
    /// pending.
    ///
    /// After handling the IRQ in the guest, the caller must invoke
    /// [`VgicV3::eoi`] with the same IRQ number to drop priority
    /// and allow the next IRQ to be delivered.
    pub fn acknowledge(&self) -> u32 {
        let iar: u64;
        unsafe {
            asm!(
                "mrs {iar}, icc_iar1_el1",
                iar = out(reg) iar,
                options(nostack, preserves_flags),
            );
        }
        iar as u32
    }

    /// End-of-interrupt: write `ICC_EOIR1_EL1` to drop priority and
    /// clear the active state for `irq`.
    ///
    /// Must be called exactly once for each [`VgicV3::acknowledge`]
    /// that returned a non-spurious IRQ number.
    pub fn eoi(&self, irq: u32) {
        unsafe {
            asm!(
                "msr icc_eoir1_el1, {val}",
                "isb",
                val = in(reg) irq as u64,
                options(nostack, preserves_flags),
            );
        }
    }

    /// Deactivate (without dropping priority): write `ICC_DIR_EL1`.
    ///
    /// Used in the priority-drop / deactivate split when the guest
    /// has not yet finished handling the IRQ.
    pub fn dir(&self, irq: u32) {
        unsafe {
            asm!(
                "msr icc_dir_el1, {val}",
                "isb",
                val = in(reg) irq as u64,
                options(nostack, preserves_flags),
            );
        }
    }

    /// Read the current interrupt priority. Lower number = higher
    /// priority. Returns 0xff when no IRQ is pending.
    pub fn read_priority(&self) -> u8 {
        let rpr: u64;
        unsafe {
            asm!(
                "mrs {rpr}, icc_rpr_el1",
                rpr = out(reg) rpr,
                options(nostack, preserves_flags),
            );
        }
        rpr as u8
    }

    // -----------------------------------------------------------------
    // Introspection
    // -----------------------------------------------------------------

    /// Number of SPIs reported by the hardware (`GICD_TYPER`).
    pub fn spi_count(&self) -> u32 {
        self.spi_count
    }
}
