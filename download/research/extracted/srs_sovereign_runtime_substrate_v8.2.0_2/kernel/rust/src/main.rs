// SPDX-License-Identifier: Apache-2.0
//
//! SRS Omnivisor — ARMv8-A EL2 hypervisor entry point.
//!
//! This crate is the bare-metal kernel-side implementation of the SRS
//! (Sovereign Runtime Substrate) "Omnivisor hyper-kernel". It replaces
//! the Python `OmnivisorSpec` dataclass with a real `aarch64-unknown-none`
//! binary that boots at EL2 on QEMU's `virt` machine
//! (`-machine virtualization=on -cpu cortex-a57`) and on real ARMv8-A
//! hardware that enters EL2.
//!
//! # Adm linkage
//!
//! * Loaded by the SRS Boot Module as the first EL2 image.
//! * Owns the stage-2 translation regime (`VTTBR_EL2`, `VTCR_EL2`) and
//!   the virtual GIC v3 (`VGIC`).
//! * Enforces the SMPU policy emitted by the Python-side `smpu_sppu.py`
//!   reference driver by reprogramming stage-2 attributes (TI/SC bits,
//!   AP, MemAttr) on policy changes.
//! * Reports exceptions back to the Adm orchestrator via the PL011
//!   serial console; a future patch will route them over a hypercall
//!   channel.
//!
//! # Layout
//!
//! The crate consists of four modules:
//!   * [`main`]    — boot, EL2 register setup, exception vector table.
//!   * [`stage2`]  — three-level stage-2 page table (L1→L2→L3, 4 KiB).
//!   * [`smpu`]    — Sovereign Memory Protection Unit driver.
//!   * [`vgic`]    — virtual GIC v3 (enable/inject/eoi).
//!
//! # Boot flow
//!
//! ```text
//!   QEMU/loader  →  _start (EL2, asm)
//!                     │  verify CurrentEL == 2
//!                     │  install boot stack & VBAR_EL2
//!                     │  program HCR_EL2 / VTCR_EL2 / SCTLR_EL2
//!                     ▼
//!                 hypervisor_main (Rust)
//!                     │  init stage-2 page table
//!                     │  install VTTBR_EL2
//!                     │  program sample SMPU region
//!                     │  init VGIC v3
//!                     │  WFE idle loop
//! ```
//!
//! Exceptions taken at EL2 (sync/irq/fiq/serror) are routed through the
//! 16-entry vector table at [`EL2_VECTORS`] into [`el2_exception_handler`].

#![no_std]
#![no_main]
// `tock-registers` is referenced by `cortex-a` and reserved for future
// typed bitfield use in stage-2 PTE construction. It is declared as a
// direct dependency so callers can use it without going through cortex-a.
#![allow(unused_crate_dependencies)]
// `global_asm!` (stable since 1.59) is used for the boot stub and the
// exception vector table, so we do not need `#![feature(naked_functions)]`
// here. Add it back if you convert the vector stubs to `#[naked] fn`s.

use core::arch::asm;
use core::panic::PanicInfo;

mod stage2;
mod smpu;
mod vgic;

// =====================================================================
// Constants
// =====================================================================

/// Boot stack size in bytes. 64 KiB is plenty for the hypervisor's own
/// Rust stack; guest VMs use their own stacks allocated from guest RAM.
const BOOT_STACK_SIZE: usize = 64 * 1024;

/// QEMU `virt` PL011 UART base address. The PL011 is the only serial
/// console on the virt machine; we use it for all Adm diagnostic output.
const UART_BASE: u64 = 0x0900_0000;
const UART_DR: u64 = UART_BASE + 0x000; // Data register
const UART_FR: u64 = UART_BASE + 0x018; // Flag register
const UART_FR_TXFF: u32 = 1 << 5; // Transmit FIFO full

/// `HCR_EL2` — Hypervisor Configuration Register.
///
/// Bits set:
///   * `RW`  (31) — EL1 must run AArch64.
///   * `TGE` (27) — trap guest exceptions to EL2 (skeleton visibility).
///   * `AMO` (5)  — route SError exceptions to EL2.
///   * `FMO` (4)  — route physical FIQ to EL2.
///   * `IMO` (3)  — route physical IRQ to EL2 (virtual IRQ injection
///     uses the GIC list registers instead).
///   * `VM`  (0)  — enable stage-2 translation.
///
/// Computed value: `0x8800_0039`.
const HCR_EL2_VALUE: u64 =
    (1u64 << 31) // RW
    | (1u64 << 27) // TGE
    | (1u64 << 5)  // AMO
    | (1u64 << 4)  // FMO
    | (1u64 << 3)  // IMO
    | (1u64 << 0); // VM

/// `VTCR_EL2` — Virtualisation Translation Control Register.
///
/// Stage-2 uses a 4 KiB granule, starts at level 1 (3-level walk →
/// L1 → L2 → L3), with a 40-bit IPA (`T0SZ = 24`) — enough to cover
/// the full 1 GiB of DRAM on the QEMU virt machine plus MMIO windows.
/// Cache/shareability follow the inner-shareable, write-back
/// write-allocate convention so stage-2 walks cohere with the L1
/// d-side caches.
///
/// Bit layout (ARMv8-A ARM DDI 0487):
///   * `PS`    [17:16] = 0b01 — 40-bit PA size.
///   * `TG0`   [15:14] = 0b00 — 4 KiB granule.
///   * `SH0`   [13:12] = 0b11 — inner shareable.
///   * `ORGN0` [11:10] = 0b01 — outer WB-WA.
///   * `IRGN0` [9:8]   = 0b01 — inner WB-WA.
///   * `SL0`   [7:6]   = 0b01 — start walk at level 1.
///   * `T0SZ`  [5:0]   = 24   — 40-bit IPA.
///
/// Computed value: `0x0001_3558`.
const VTCR_EL2_VALUE: u64 =
    (0b01u64 << 16) // PS    = 40-bit PA
    | (0b00u64 << 14) // TG0   = 4 KiB
    | (0b11u64 << 12) // SH0   = inner shareable
    | (0b01u64 << 10) // ORGN0 = WB-WA
    | (0b01u64 << 8)  // IRGN0 = WB-WA
    | (0b01u64 << 6)  // SL0   = 1 (start at L1)
    | (24u64 << 0);     // T0SZ  = 24 (40-bit IPA)

/// `SCTLR_EL2` — System Control Register (EL2).
///
/// The hypervisor itself runs on physical addresses; the EL2 stage-1
/// MMU is left off (`M = 0`). The stage-2 translation regime (for
/// EL1/EL0 guests) is enabled separately via `HCR_EL2.VM`.
const SCTLR_EL2_VALUE: u64 = 0;

// =====================================================================
// Static data
// =====================================================================

/// 64 KiB boot stack. 16-byte aligned by virtue of the `[u8; N]` array
/// alignment. The boot stub points `SP` at the *top* of this array
/// (stack grows down).
static mut BOOT_STACK: [u8; BOOT_STACK_SIZE] = [0u8; BOOT_STACK_SIZE];

/// Global stage-2 page table. A real hypervisor would have one per VM;
/// the skeleton uses a single table for the boot VM (id 0).
static mut STAGE2: stage2::Stage2PageTable = stage2::Stage2PageTable::new();

/// Global SMPU driver. Tracks per-region TI/SC state and the
/// active-domain pointer for access checks.
static mut SMPU: smpu::SmpuDriver = smpu::SmpuDriver::new();

/// Global virtual GIC v3 driver.
static mut VGIC: vgic::VgicV3 = vgic::VgicV3::new();

// =====================================================================
// Boot assembly
// =====================================================================
//
// The boot stub:
//   1. Verifies we entered at EL2.
//   2. Installs the boot stack and `VBAR_EL2`.
//   3. Programs `HCR_EL2`, `VTCR_EL2`, `SCTLR_EL2`, `SPSel`.
//   4. Branches to `hypervisor_main` (Rust).
//
// The vector table consists of 16 entries at 128-byte stride (2 KiB
// total, 2 KiB-aligned). Each entry invokes `el2_exception_handler`
// with its vector index in `x0`.

core::arch::global_asm!(
    r#"
    .section .text.boot
    .global _start
    _start:
        // -----------------------------------------------------------
        // 1. Verify we are at EL2.
        // -----------------------------------------------------------
        mrs   x0, CurrentEL
        lsr   x0, x0, #2
        cmp   x0, #2
        b.ne  9f

        // -----------------------------------------------------------
        // 2. Install the boot stack (top of BOOT_STACK).
        // -----------------------------------------------------------
        adrp  x0, {stack}
        add   x0, x0, #:lo12:{stack}
        add   x0, x0, #{stack_size}
        mov   sp, x0

        // Use SP_ELx (not SP_EL0) at EL2.
        msr   SPSel, #1

        // Install the EL2 exception vector table.
        adrp  x0, {vectors}
        add   x0, x0, #:lo12:{vectors}
        msr   VBAR_EL2, x0
        isb

        // -----------------------------------------------------------
        // 3. Program EL2 system registers.
        // -----------------------------------------------------------
        // HCR_EL2 = 0x8800_0039  (RW|TGE|AMO|FMO|IMO|VM)
        movz  x0, #0x8800, lsl #16
        movk  x0, #0x0039
        msr   HCR_EL2, x0
        isb

        // VTCR_EL2 = 0x0001_3558
        movz  x0, #0x0001, lsl #16
        movk  x0, #0x3558
        msr   VTCR_EL2, x0
        isb

        // SCTLR_EL2 = 0  (no stage-1 MMU at EL2)
        msr   SCTLR_EL2, xzr
        isb

        // -----------------------------------------------------------
        // 4. Branch to Rust main.
        // -----------------------------------------------------------
        bl    hypervisor_main

    9:  // Hang if not at EL2.
        wfe
        b     9b

    // ===============================================================
    // EL2 exception vector table.
    //
    // 16 entries at 128-byte stride. Each saves x29/x30, passes the
    // vector index in x0, calls the Rust handler, and returns with
    // `eret` (which uses the hardware-saved SPSR_EL2 / ELR_EL2).
    // ===============================================================
    .section .text.vectors
    .align 11
    .global {vectors}
    {vectors}:
    .macro VECTOR n
        .align 7
        stp   x29, x30, [sp, #-16]!
        stp   x0,  x1,  [sp, #-16]!
        mov   x0, #\n
        bl    el2_exception_handler
        ldp   x0,  x1,  [sp], #16
        ldp   x29, x30, [sp], #16
        eret
    .endm
        VECTOR 0     // Current EL with SP_EL0, Sync
        VECTOR 1     // Current EL with SP_EL0, IRQ
        VECTOR 2     // Current EL with SP_EL0, FIQ
        VECTOR 3     // Current EL with SP_EL0, SError
        VECTOR 4     // Current EL with SP_ELx, Sync
        VECTOR 5     // Current EL with SP_ELx, IRQ
        VECTOR 6     // Current EL with SP_ELx, FIQ
        VECTOR 7     // Current EL with SP_ELx, SError
        VECTOR 8     // Lower EL, AArch64, Sync
        VECTOR 9     // Lower EL, AArch64, IRQ
        VECTOR 10    // Lower EL, AArch64, FIQ
        VECTOR 11    // Lower EL, AArch64, SError
        VECTOR 12    // Lower EL, AArch32, Sync
        VECTOR 13    // Lower EL, AArch32, IRQ
        VECTOR 14    // Lower EL, AArch32, FIQ
        VECTOR 15    // Lower EL, AArch32, SError
    .purgem VECTOR
    "#,
    stack = sym BOOT_STACK,
    stack_size = const BOOT_STACK_SIZE,
    vectors = sym EL2_VECTORS,
);

/// Declaration of the symbol defined in the `global_asm!` block above.
/// The linker resolves this to the 2 KiB-aligned vector table base.
extern "C" {
    static EL2_VECTORS: u8;
}

// =====================================================================
// Panic handler
// =====================================================================

#[panic_handler]
fn on_panic(info: &PanicInfo) -> ! {
    unsafe {
        uart_puts("\r\n!! SRS HYPERVISOR PANIC !!\r\n");
        if let Some(loc) = info.location() {
            uart_puts("  at ");
            uart_puts(loc.file());
            uart_putc(b':');
            uart_hex(loc.line() as u64);
            uart_puts("\r\n");
        }
        if let Some(msg) = info.payload().downcast_ref::<&'static str>() {
            uart_puts("  msg: ");
            uart_puts(msg);
            uart_puts("\r\n");
        }
    }
    loop {
        // wfe is a hint; it powers down the PE until an event arrives.
        // Used here so a panicked hypervisor doesn't spin hot.
        unsafe { asm!("wfe"); }
    }
}

// =====================================================================
// Helpers — UART output
// =====================================================================

/// Write a single byte to the PL011.
#[inline]
unsafe fn uart_putc(c: u8) {
    // Spin while the TX FIFO is full.
    loop {
        let fr = core::ptr::read_volatile(UART_FR as *const u32);
        if fr & UART_FR_TXFF == 0 {
            break;
        }
    }
    core::ptr::write_volatile(UART_DR as *mut u32, c as u32);
}

/// Write a NUL-terminated string slice to the PL011. LF is translated
/// to CRLF so the QEMU `-serial mon:stdio` console renders correctly.
#[inline]
unsafe fn uart_puts(s: &str) {
    for b in s.bytes() {
        if b == b'\n' {
            uart_putc(b'\r');
        }
        uart_putc(b);
    }
}

/// Write a 64-bit value as 0x-prefixed lowercase hex.
#[inline]
unsafe fn uart_hex(v: u64) {
    uart_puts("0x");
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut i: i32 = 64;
    while i > 0 {
        i -= 4;
        let nibble = ((v >> i) & 0xF) as usize;
        uart_putc(HEX[nibble]);
    }
}

// =====================================================================
// Helpers — system register access
// =====================================================================

#[inline]
unsafe fn read_esr_el2() -> u64 {
    let v: u64;
    asm!("mrs {}, ESR_EL2", out(reg) v, options(nostack, preserves_flags));
    v
}

#[inline]
unsafe fn read_elr_el2() -> u64 {
    let v: u64;
    asm!("mrs {}, ELR_EL2", out(reg) v, options(nostack, preserves_flags));
    v
}

#[inline]
unsafe fn read_far_el2() -> u64 {
    let v: u64;
    asm!("mrs {}, FAR_EL2", out(reg) v, options(nostack, preserves_flags));
    v
}

#[inline]
unsafe fn read_hpfar_el2() -> u64 {
    let v: u64;
    asm!("mrs {}, HPFAR_EL2", out(reg) v, options(nostack, preserves_flags));
    v
}

#[inline]
unsafe fn read_hcr_el2() -> u64 {
    let v: u64;
    asm!("mrs {}, HCR_EL2", out(reg) v, options(nostack, preserves_flags));
    v
}

#[inline]
unsafe fn read_vtcr_el2() -> u64 {
    let v: u64;
    asm!("mrs {}, VTCR_EL2", out(reg) v, options(nostack, preserves_flags));
    v
}

#[inline]
unsafe fn write_vttbr_el2(v: u64) {
    asm!("msr VTTBR_EL2, {}", in(reg) v, options(nostack, preserves_flags));
}

// =====================================================================
// EL2 exception handler
// =====================================================================

/// Rust-side EL2 exception handler, invoked from every entry in
/// [`EL2_VECTORS`].
///
/// `vector` is the index (0..16) of the exception vector that fired:
///
/// | range   | source / type                            |
/// |---------|------------------------------------------|
/// | 0..4    | current EL, SP_EL0,  sync/irq/fiq/serror |
/// | 4..8    | current EL, SP_ELx,  sync/irq/fiq/serror |
/// | 8..12   | lower EL, AArch64,  sync/irq/fiq/serror |
/// | 12..16  | lower EL, AArch32,  sync/irq/fiq/serror |
///
/// The handler dumps the saved architectural state (ESR, ELR, FAR,
/// HPFAR) and parks. A future patch will dispatch to per-VM handlers
/// and forward sychronous exceptions to the Adm orchestrator over a
/// hypercall channel.
#[no_mangle]
pub extern "C" fn el2_exception_handler(vector: u64) {
    let (esr, elr, far, hpfar) = unsafe {
        (read_esr_el2(), read_elr_el2(), read_far_el2(), read_hpfar_el2())
    };

    unsafe {
        uart_puts("\r\n=== EL2 EXCEPTION ===\r\n");
        uart_puts("  vector = "); uart_hex(vector); uart_puts("\r\n");
        uart_puts("  ESR_EL2  = "); uart_hex(esr); uart_puts("\r\n");
        uart_puts("  ELR_EL2  = "); uart_hex(elr); uart_puts("\r\n");
        uart_puts("  FAR_EL2  = "); uart_hex(far); uart_puts("\r\n");
        uart_puts("  HPFAR_EL2= "); uart_hex(hpfar); uart_puts("\r\n");

        // Decode the ESR EC field (bits [31:26]).
        let ec = (esr >> 26) & 0x3F;
        uart_puts("  EC       = "); uart_hex(ec); uart_puts("\r\n");
    }

    // Park: the skeleton does not recover from exceptions.
    loop {
        unsafe { asm!("wfe"); }
    }
}

// =====================================================================
// Hypervisor main
// =====================================================================

/// Entry point called from the boot stub after EL2 system-register
/// initialisation.
///
/// Sequence:
///   1. Print the boot banner.
///   2. Install the stage-2 page table (identity-map the first 2 MiB
///      of DRAM as a sample guest region).
///   3. Program a sample SMPU region over the first 1 MiB of DRAM.
///   4. Initialise the VGIC v3 and enable the PL011 UART IRQ.
///   5. Park in a WFE loop, handling exceptions via
///      [`el2_exception_handler`].
#[no_mangle]
pub extern "C" fn hypervisor_main() -> ! {
    // ---------------------------------------------------------------
    // 1. Banner & register dump.
    // ---------------------------------------------------------------
    unsafe {
        uart_puts("\r\n");
        uart_puts("============================================\r\n");
        uart_puts(" SRS Omnivisor v0.1.0\r\n");
        uart_puts(" ARMv8-A EL2 hypervisor skeleton\r\n");
        uart_puts(" (c) SRS Project — Apache-2.0\r\n");
        uart_puts("============================================\r\n");

        let (hcr, vtcr) = (read_hcr_el2(), read_vtcr_el2());
        uart_puts("HCR_EL2 = "); uart_hex(hcr); uart_puts("\r\n");
        uart_puts("VTCR_EL2= "); uart_hex(vtcr); uart_puts("\r\n");
        uart_puts("Booting at EL2...\r\n");
    }

    // ---------------------------------------------------------------
    // 2. Stage-2 page table.
    // ---------------------------------------------------------------
    let pt: &mut stage2::Stage2PageTable = unsafe { &mut STAGE2 };

    // Identity-map the first 2 MiB of guest DRAM (one 4 KiB page at a
    // time). Real hypervisors would use 2 MiB block descriptors for
    // large runs, but the skeleton uses 4 KiB throughout so the
    // 3-level walk is exercised.
    let map_attrs = stage2::PTE_AP_RW
        | stage2::MEMATTR_NORMAL_WB
        | stage2::PTE_AF
        | stage2::PTE_SC; // mark Sovereign-Clean

    let mut mapped = 0u64;
    let mut ipa = 0x4000_0000u64;          // start of DRAM on QEMU virt
    let map_end = ipa + (2 * 1024 * 1024); // 2 MiB
    while ipa < map_end {
        if pt.map(ipa, ipa, map_attrs).is_ok() {
            mapped += 1;
        }
        ipa += stage2::PAGE_SIZE as u64;
    }

    let pt_pa = pt.l1_phys();
    unsafe {
        write_vttbr_el2(pt_pa);
        asm!("isb", options(nostack, preserves_flags));
    }
    pt.flush_tlb();

    unsafe {
        uart_puts("Stage-2 page table installed: L1@");
        uart_hex(pt_pa);
        uart_puts("  4 KiB pages mapped: ");
        uart_hex(mapped);
        uart_puts("\r\n");
        uart_puts("VTTBR_EL2 = ");
        uart_hex(pt_pa);
        uart_puts("\r\n");
    }

    // ---------------------------------------------------------------
    // 3. SMPU sample region.
    // ---------------------------------------------------------------
    let smpu: &mut smpu::SmpuDriver = unsafe { &mut SMPU };
    let region = smpu::SmpuRegion {
        base: 0x4000_0000,
        size: 0x0010_0000, // 1 MiB
        owner_domain: smpu::DomainId(1),
        perm: smpu::SmpuPermission::ReadWrite,
        ti: false,
        sc: true,
    };

    unsafe {
        uart_puts("Programming SMPU region: base=");
        uart_hex(region.base);
        uart_puts(" size=");
        uart_hex(region.size);
        uart_puts(" dom=");
        uart_hex(region.owner_domain.0 as u64);
        uart_puts("\r\n");
    }

    match smpu.program(region, pt) {
        Ok(())  => unsafe { uart_puts("  SMPU region programmed OK\r\n"); },
        Err(e)  => unsafe {
            uart_puts("  SMPU ERROR: ");
            uart_puts(e);
            uart_puts("\r\n");
        },
    }

    // Sanity-check the access checker.
    let ok = smpu.check_access(0x4000_0000, 0x1000, false);
    unsafe {
        uart_puts("  check_access(0x40000000, R) = ");
        uart_puts(if ok { "true" } else { "false" });
        uart_puts("\r\n");
    }

    // ---------------------------------------------------------------
    // 4. VGIC v3.
    // ---------------------------------------------------------------
    let gic: &mut vgic::VgicV3 = unsafe { &mut VGIC };
    gic.init();
    // PL011 UART IRQ on QEMU virt is SPI 33.
    gic.enable_irq(33);

    unsafe {
        uart_puts("VGIC v3 initialised; SPI 33 (PL011) enabled\r\n");
    }

    // ---------------------------------------------------------------
    // 5. Idle.
    // ---------------------------------------------------------------
    unsafe {
        uart_puts("\r\nHypervisor idle. Press Ctrl-A X to exit QEMU.\r\n");
    }

    loop {
        // wfe hints the PE to enter a low-power state until an event
        // (exception, SEV, or interrupt) arrives. Used here as the
        // hypervisor's idle loop; a real implementation would call
        // the scheduler here.
        unsafe { asm!("wfe"); }
    }
}
