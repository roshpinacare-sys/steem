# SRS Omnivisor — ARMv8-A EL2 Hypervisor Skeleton

This directory contains a real, compilable Rust skeleton for the SRS
(Sovereign Runtime Substrate) "Omnivisor" hyper-kernel. It targets
ARMv8-A Exception Level 2 (EL2) on QEMU's `virt` machine and on real
ARMv8-A hardware that enters EL2.

This is the kernel-side counterpart to the Python `omnivisor.py`
dataclass identified as the #1 critical gap in the SRS engineering
audit: instead of *describing* the hyper-kernel as metadata, this
crate *is* the hyper-kernel — compiled to a bare-metal
`aarch64-unknown-none` binary that boots at EL2, programs the stage-2
translation regime, manages SMPU regions, and drives a virtual GIC v3.

---

## Project layout

```
kernel/rust/
├── Cargo.toml              # package manifest (no_std, no_main)
├── .cargo/config.toml      # cross-build configuration (see below)
├── linker.ld               # bare-metal linker script (see below)
├── README.md               # this file
└── src/
    ├── main.rs             # EL2 entry, vector table, hypervisor_main()
    ├── stage2.rs           # 3-level stage-2 page table (L1→L2→L3, 4 KiB)
    ├── smpu.rs             # Sovereign Memory Protection Unit driver
    └── vgic.rs             # virtual GIC v3 (enable/inject/eoi)
```

---

## Build prerequisites

* **Rust** 1.74 or newer (stable is fine; `global_asm!` has been
  stable since 1.59 and we no longer use any nightly feature gate).
* **`aarch64-unknown-none` target**:
  ```sh
  rustup target add aarch64-unknown-none
  ```
* **QEMU** 7.0+ for AArch64:
  ```sh
  sudo apt install qemu-system-aarch64
  ```
* **A linker**. The bare-metal `aarch64-unknown-none` target ships
  without a linker script; you must provide one (see below). Either
  GNU `ld` from `aarch64-linux-gnu-gcc` or LLVM's `lld` will work.

---

## Required files NOT shipped in this skeleton

This skeleton ships six files (`Cargo.toml`, four `src/*.rs`, this
README). To make `cargo build` actually produce a loadable binary you
need two more files in this directory. Create them now:

### `linker.ld`

```ld
ENTRY(_start)

SECTIONS
{
    /* QEMU `-kernel` loads raw/ELF binaries at 0x4008_0000 on virt. */
    . = 0x40080000;

    .text : {
        KEEP(*(.text.boot))   /* _start lives here */
        *(.text*)
    }

    .rodata : { *(.rodata*) }

    .data : { *(.data*) }

    .bss : {
        __bss_start = .;
        *(.bss*)
        *(COMMON)
        __bss_end = .;
    }

    . = ALIGN(16);
    .stack : {
        *(.stack)
    }

    /DISCARD/ : {
        *(.comment)
        *(.note*)
        *(.eh_frame*)
        *(.eh_frame_hdr*)
        *(.ARM.exidx*)
        *(.ARM.extab*)
    }
}
```

### `.cargo/config.toml`

```toml
[build]
target = "aarch64-unknown-none"

[target.aarch64-unknown-none]
rustflags = [
    "-C", "link-arg=-Tlinker.ld",
    "-C", "link-arg=-nostdlib",
    "-C", "link-arg=-static",
    "-C", "panic-strategy=abort",
    # Optional: use LLVM's linker for faster links.
    # "-C", "linker=lld",
    # "-C", "link-arg=-fuse-ld=lld",
]
```

---

## Build

```sh
cargo build --release
```

The resulting ELF is at:

```
target/aarch64-unknown-none/release/srs-hypervisor
```

For a raw binary suitable for `qemu -kernel`, also run:

```sh
cargo objcopy --release -- -O binary target/srs-hypervisor.bin
```

(`cargo objcopy` is provided by `cargo-binutils`:
`cargo install cargo-binutils`.)

---

## Run with QEMU

### Option A: load the ELF directly (recommended)

```sh
qemu-system-aarch64 \
    -M virt \
    -machine virtualization=on \
    -cpu cortex-a57 \
    -smp 1 \
    -m 1024 \
    -kernel target/aarch64-unknown-none/release/srs-hypervisor \
    -nographic \
    -serial mon:stdio
```

### Option B: load a raw binary

```sh
qemu-system-aarch64 \
    -M virt \
    -machine virtualization=on \
    -cpu cortex-a57 \
    -smp 1 \
    -m 1024 \
    -kernel target/srs-hypervisor.bin \
    -nographic \
    -serial mon:stdio
```

The important flags:

| flag | meaning |
|------|---------|
| `-M virt` | QEMU "virt" generic AArch64 platform. |
| `-machine virtualization=on` | CPU starts at EL2 with virtualisation extensions. |
| `-cpu cortex-a57` | ARMv8-A Cortex-A57 (implements EL2, GICv3, FEAT_FWB, etc.). |
| `-nographic -serial mon:stdio` | PL011 UART on stdio, `Ctrl-A X` exits QEMU. |

---

## Expected serial output

A successful boot looks like this on the serial console:

```
============================================
 SRS Omnivisor v0.1.0
 ARMv8-A EL2 hypervisor skeleton
 (c) SRS Project — Apache-2.0
============================================
HCR_EL2 = 0x0000000088000039
VTCR_EL2= 0x0000000000013558
Booting at EL2...
Stage-2 page table installed: L1@0x0000000040xxxxxx  4 KiB pages mapped: 0x0000000000000200
VTTBR_EL2 = 0x0000000040xxxxxx
Programming SMPU region: base=0x0000000040000000 size=0x0000000000100000 dom=0x0000000000000001
  SMPU region programmed OK
  check_access(0x40000000, R) = true
VGIC v3 initialised; SPI 33 (PL011) enabled

Hypervisor idle. Press Ctrl-A X to exit QEMU.
```

If an EL2 exception is taken (for example, a guest stage-2 fault), the
handler prints:

```
=== EL2 EXCEPTION ===
  vector = 0x0000000000000008
  ESR_EL2  = 0x0000000096000046
  ELR_EL2  = 0x0000000040080xxx
  FAR_EL2  = 0x0000000040000000
  HPFAR_EL2= 0x0000000040000000
  EC       = 0x0000000000000025
```

…and then parks in a `WFE` loop. `EC = 0x25` is "data abort from
lower EL" (the typical stage-2 fault); decode the rest of `ESR_EL2`
per the ARMv8-A ARM.

---

## What the skeleton actually does

1. **`_start`** (in `src/main.rs`, `global_asm!`):
   * Verifies `CurrentEL == 2`.
   * Installs a 64 KiB boot stack and `VBAR_EL2`.
   * Programs `HCR_EL2` (route IRQ/FIQ/SError to EL2, enable stage-2),
     `VTCR_EL2` (4 KiB granule, 3-level walk, 40-bit IPA),
     `SCTLR_EL2 = 0` (no EL2 stage-1 MMU), `SPSel = 1` (use SP_EL2).
   * Branches to `hypervisor_main()`.

2. **`hypervisor_main()`**:
   * Prints a banner and the live `HCR_EL2` / `VTCR_EL2` values.
   * Identity-maps the first 2 MiB of DRAM (`0x4000_0000`) into the
     stage-2 page table at 4 KiB granularity (so the 3-level walk is
     exercised).
   * Installs the L1 table base into `VTTBR_EL2` and flushes the
     stage-2 TLB.
   * Programs a sample SMPU region (`0x4000_0000`, 1 MiB, RW,
     Sovereign-Clean) and runs a sanity check through
     `SmpuDriver::check_access`.
   * Initialises the GICv3 (distributor, redistributor, CPU
     interface) and enables SPI 33 (the PL011 UART IRQ).
   * Parks in a `WFE` loop, handling exceptions via
     `el2_exception_handler`.

3. **`el2_exception_handler()`**: dumps `ESR_EL2`, `ELR_EL2`,
   `FAR_EL2`, `HPFAR_EL2`, and the decoded `EC` field, then parks.

---

## Adm linkage

| Concern | Owner | Notes |
|---------|-------|-------|
| Boot | SRS Boot Module | Loads this ELF as the first EL2 image. |
| Stage-2 translation | `stage2.rs` | 4 KiB / 3-level / 40-bit IPA. |
| SMPU policy | `smpu.rs` | Rust analogue of Python `smpu_sppu.py`. |
| Interrupt routing | `vgic.rs` | GICv3, single-VM; list registers stubbed. |
| Diagnostics | PL011 UART @ `0x0900_0000` | Routed via QEMU `-serial mon:stdio`. |
| Exceptions | `el2_exception_handler` | Sync/IRQ/FIQ/SError → dump + park. |

The skeleton is intentionally minimal — it boots, configures EL2
system registers, builds an identity stage-2 mapping for a single VM,
programs a sample SMPU region, initialises the VGIC, and parks in a
WFE loop handling exceptions. Extending it to dispatch multiple VMs,
to implement the full Adm quarantine protocol, to use the GICv3 list
registers for true virtual-IRQ injection, and to drop to EL1 to
execute a guest is left to subsequent patches.

---

## Testing

The stage-2 and SMPU modules include host-side unit tests guarded by
`#[cfg(test)]`. They are skipped under `cargo build
--target=aarch64-unknown-none` (no `test` cfg) but can be run on a
host target:

```sh
cargo test --target=x86_64-unknown-linux-gnu
```

(You may need to add a `[[bin]]` section or `[[example]]` override to
prevent `cargo test` from trying to build the `no_main` binary for the
host; the easiest workaround is `cargo test --lib` after splitting
the modules into a `lib.rs`. This is left as an exercise.)

---

## License

Apache-2.0, same as the rest of the SRS project.
