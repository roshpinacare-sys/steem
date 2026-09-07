# SRS Architecture Overview

This document provides a visual and narrative overview of the Sovereign
Runtime Substrate's architecture. For the full technical specification,
see `SRS_Architecture.pdf` (27 pages, 13 chapters).

## System Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Sovereign Runtime Substrate (SRS)                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │    APU      │  │    RPU      │  │    FPGA     │  │   NISQ    │ │
│  │ (AArch64)   │  │ (ARM-R5F)   │  │ (RISC-V)    │  │   QPU     │ │
│  │ Cognitive   │  │ Hard RT     │  │ Soft cores  │  │ Quantum   │ │
│  │ agents      │  │ control     │  │ + RTL       │  │ sim       │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘ │
│         │                │                │               │       │
│         └────────────────┴────────┬───────┴───────────────┘       │
│                                   │                                 │
│                          ┌────────▼────────┐                       │
│                          │   Omnivisor     │  ◄── Spatio-temporal  │
│                          │   (EL2)         │      isolation        │
│                          │   SMPU/SPPU     │                       │
│                          └────────┬────────┘                       │
│                                   │                                 │
│                          ┌────────▼────────┐                       │
│                          │  Unified        │  ◄── eBPF ring bufs   │
│                          │  Telemetry Bus  │      (32-byte entries)│
│                          └────────┬────────┘                       │
│                                   │                                 │
│         ┌─────────────────────────┼─────────────────────────┐     │
│         ▼                         ▼                         ▼     │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────┐  │
│  │  AgeMem      │         │  Z3 Proof    │         │ AdaQC    │  │
│  │  Controller  │         │  Engine      │         │ Compiler │  │
│  │  (GRPO)      │         │  (4 modes)   │         │ (DP)     │  │
│  └──────┬───────┘         └──────┬───────┘         └────┬─────┘  │
│         │                        │                      │         │
│         └────────────┬───────────┘                      │         │
│                      ▼                                  ▼         │
│              ┌──────────────┐                   ┌──────────────┐  │
│              │  SEG + SQA   │                   │ Photonic Bus │  │
│              │  (BLS quorum)│                   │ (102 Tbps)   │  │
│              └──────┬───────┘                   └──────┬───────┘  │
│                     │                                  │          │
│                     ▼                                  ▼          │
│              ┌──────────────┐                   ┌──────────────┐  │
│              │  ESR Persist │ ◄──────────────── │ Self-Healing │  │
│              │  (v2.0)      │   evidence chain  │ (DNA + Ab)   │  │
│              └──────────────┘                   └──────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Phase Mapping

| Phase | Directory | Role | Adm Linkage |
|-------|-----------|------|-------------|
| 1 | `kernel/` | Omnivisor isolation + telemetry | Adm_spatial, Adm_temporal, Adm_thermal |
| 2 | `cognition/` | AgeMem + ESR + Adm mapper | Adm_behavioural |
| 3 | `verification/` | Z3 + TLA+ + SVA | Adm_thermal, Adm_temporal |
| 3b | `governance/` | SQA + BLS + SEG | Adm_behavioural |
| 4 | `simulation/` | AdaQC + photonic bus | Adm_thermal |
| 5 | `self_healing/` | Digital DNA + antibodies | Adm_behavioural |

## Data Flow

1. **eBPF telemetry** streams hardware signals (power, ECR, photonic)
   into the Unified Telemetry Bus ring buffers.
2. The **DynamicSmpuController** consumes telemetry snapshots and
   repartitions memory regions (quarantine, shrink, promote) in response
   to ECR cascades and thermal surges.
3. The **AgeMem controller** (trained via Step-wise GRPO) makes
   Adm-gated decisions via `decide_adm()`, producing evidence chains.
4. The **SEG** evaluates each mutation's evidence chain against 5 checks
   (admissibility, seq epoch, SQA quorum, witness hash, certificate ref).
5. The **SQA aggregator** assembles a risk-adaptive 3-of-4 quorum with
   BLS aggregate signatures binding c_i to the Z3 witness hash.
6. Certified mutations are persisted as **ESR entries** (v2.0) and
   replicated via the **photonic bus** (102 Tbps).
7. The **self-healing** layer scans committed artefacts' Digital DNA
   against the Antibody Repertoire; matches trigger the CI/CD loop.

## Adm Linkage

Every component is mathematically linked to the Admissible Behavior Set:

- **Adm_spatial** (Ch 7.2): Omnivisor, SMPU/SPPU enforce TI/SC page
  permissions.
- **Adm_temporal** (Ch 7.3): TIB budgets, TLA+ NoDeadlock theorem.
- **Adm_thermal** (Ch 7.4): Z4 power-thermal proof, AdaQC depth-reduction.
- **Adm_behavioural** (Ch 7.6): Adm intent mapper, SEG, SQA, evidence
  chains.

See `adm_linker_manifest.json` for the full file-to-rule mapping.
